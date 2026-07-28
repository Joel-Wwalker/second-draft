import { getEditableSelection, getPlainSelection, isSensitiveTarget } from './selection';
import type { EditableSelection } from './selection';
import { applyReplacement } from './replace';
import { Chip } from './chip';
import { Card } from './card';
import { detect } from '../engine/rules';
import { getSettings } from '../shared/storage';
import { HUMANIZE_PORT } from '../shared/messages';
import type { HumanizeRequest, PortServerMessage } from '../shared/messages';
import type { HumanizeResult, Intensity } from '../shared/types';

const CHIP_DEBOUNCE_MS = 150;
const REQUEST_TIMEOUT_MS = 60_000;

let requestSeq = 0;
function newRequestId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${++requestSeq}-${Math.random().toString(36).slice(2)}`;
}

export class HumanizeSession {
  private readonly doc: Document;
  private readonly chip: Chip;
  private readonly card: Card;
  private port: chrome.runtime.Port | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private selection: EditableSelection | null = null;
  private captured: EditableSelection | null = null;
  private capturedText = '';
  private canApply = false;
  private intensity: Intensity = 'full';
  private requestId: string | null = null;
  private result: HumanizeResult | null = null;
  private stopped = false;

  constructor(doc: Document) {
    this.doc = doc;
    this.chip = new Chip(doc, () => this.onChipClick());
    this.card = new Card(doc, {
      onApply: () => this.onApply(),
      onCopy: () => this.onCopy(),
      onDismiss: () => this.dismissCard(),
      onIntensityChange: intensity => this.onIntensityChange(intensity),
    });
  }

  start(): void {
    this.doc.addEventListener('selectionchange', this.onSelectionChange);
    this.doc.addEventListener('mousedown', this.onMouseDown, true);
    chrome.runtime.onMessage.addListener(this.onRuntimeMessage);
    chrome.storage.onChanged.addListener(this.onStorageChanged);
    void getSettings().then(s => {
      this.intensity = s.defaultIntensity;
    });
  }

  stop(): void {
    this.stopped = true;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = null;
    this.clearRequestTimeout();
    this.doc.removeEventListener('selectionchange', this.onSelectionChange);
    this.doc.removeEventListener('mousedown', this.onMouseDown, true);
    chrome.runtime.onMessage.removeListener(this.onRuntimeMessage);
    chrome.storage.onChanged.removeListener(this.onStorageChanged);
    this.chip.hide();
    this.dismissCard();
    this.port?.disconnect();
    this.port = null;
  }

  private readonly onSelectionChange = (): void => {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.updateChip(), CHIP_DEBOUNCE_MS);
  };

  private readonly onMouseDown = (e: MouseEvent): void => {
    if (this.chip.contains(e.target) || this.card.contains(e.target)) return;
    this.chip.hide();
    if (this.card.isOpen) this.dismissCard();
  };

  private readonly onStorageChanged = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ): void => {
    if (area !== 'local' || !changes['settings']) return;
    const next = changes['settings'].newValue as { defaultIntensity?: Intensity } | undefined;
    if (next?.defaultIntensity === 'light' || next?.defaultIntensity === 'full') {
      this.intensity = next.defaultIntensity;
    }
  };

  private readonly onRuntimeMessage = (msg: unknown): void => {
    if (this.stopped) return;
    if (typeof msg !== 'object' || msg === null) return;
    const m = msg as Record<string, unknown>;
    if (m['type'] !== 'context-humanize') return;
    const editable = getEditableSelection(this.doc);
    if (editable) {
      this.captured = editable;
      this.capturedText = editable.text;
      this.canApply = true;
    } else {
      if (isSensitiveTarget(this.doc)) return;
      const fallback = typeof m['selectionText'] === 'string' ? m['selectionText'] : '';
      const text = getPlainSelection(this.doc) || fallback;
      if (!text) return;
      this.captured = null;
      this.capturedText = text;
      this.canApply = false;
    }
    this.chip.hide();
    this.openCardAtSelection();
    this.request();
  };

  private updateChip(): void {
    if (this.stopped) return;
    if (this.card.isOpen) return;
    this.selection = getEditableSelection(this.doc);
    if (!this.selection) {
      this.chip.hide();
      return;
    }
    const rect = selectionRect(this.doc, this.selection);
    const win = this.doc.defaultView;
    const tellCount = detect(this.selection.text).length;
    this.chip.showAt(rect.right + (win?.scrollX ?? 0) - 40, rect.bottom + (win?.scrollY ?? 0) + 6, tellCount);
  }

  private onChipClick(): void {
    if (!this.selection) return;
    this.captured = this.selection;
    this.capturedText = this.selection.text;
    this.canApply = true;
    this.chip.hide();
    this.openCardAtSelection();
    this.request();
  }

  private openCardAtSelection(): void {
    const rect = this.captured
      ? selectionRect(this.doc, this.captured)
      : { left: 40, bottom: 40, right: 40 };
    this.card.open({ left: rect.left, bottom: rect.bottom }, { canApply: this.canApply, intensity: this.intensity });
  }

  private ensurePort(): chrome.runtime.Port {
    if (!this.port) {
      this.port = chrome.runtime.connect({ name: HUMANIZE_PORT });
      this.port.onMessage.addListener(msg => this.onPortMessage(msg as PortServerMessage));
      this.port.onDisconnect.addListener(() => {
        this.port = null;
        if (!this.stopped && this.requestId && !this.result) {
          this.card.setError('internal', 'The extension restarted. Try again.');
        }
      });
    }
    return this.port;
  }

  private request(): void {
    this.result = null;
    const id = newRequestId();
    this.requestId = id;
    this.armTimeout(id);
    const req: HumanizeRequest = { type: 'humanize', id, text: this.capturedText, intensity: this.intensity };
    try {
      this.ensurePort().postMessage(req);
    } catch {
      this.card.setError('internal', 'The extension was updated or reloaded. Reload this page and try again.');
    }
  }

  private armTimeout(id: string): void {
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = setTimeout(() => {
      if (this.requestId === id && !this.result && !this.stopped) {
        this.cancelInFlight();
        this.card.setError('internal', 'No response from the engine. Try again.');
      }
    }, REQUEST_TIMEOUT_MS);
  }

  private clearRequestTimeout(): void {
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = null;
  }

  private cancelInFlight(): void {
    if (this.requestId && !this.result && this.port) {
      this.port.postMessage({ type: 'cancel', id: this.requestId });
    }
    this.requestId = null;
    this.clearRequestTimeout();
  }

  private onPortMessage(msg: PortServerMessage): void {
    if (msg.id !== this.requestId || this.stopped) return;
    if (msg.type === 'chunk') {
      this.armTimeout(msg.id);
      this.card.setStreaming(msg.textSoFar);
    } else if (msg.type === 'done') {
      this.clearRequestTimeout();
      this.result = msg.result;
      this.card.setResult(msg.result, this.capturedText);
    } else {
      this.clearRequestTimeout();
      this.card.setError(msg.kind, msg.message);
    }
  }

  private onApply(): void {
    if (!this.result || !this.captured) return;
    const ok = applyReplacement(this.captured, this.result.rewritten, this.doc);
    if (!ok) {
      this.card.showApplyFailed();
      return;
    }
    this.card.close();
  }

  private onCopy(): void {
    if (!this.result) return;
    const nav = this.doc.defaultView?.navigator;
    void nav?.clipboard?.writeText(this.result.rewritten).catch(() => {});
  }

  private onIntensityChange(intensity: Intensity): void {
    this.intensity = intensity;
    this.cancelInFlight();
    this.card.setStreaming('');
    this.request();
  }

  private dismissCard(): void {
    this.cancelInFlight();
    if (this.card.isOpen) this.card.close();
  }
}

function selectionRect(
  doc: Document,
  sel: EditableSelection,
): { left: number; right: number; bottom: number } {
  if (sel.kind === 'editable') {
    const r = sel.range.getBoundingClientRect();
    if (r.width > 0 || r.height > 0) return { left: r.left, right: r.right, bottom: r.bottom };
  }
  const el = sel.kind === 'field' ? sel.el : sel.root;
  const r = el.getBoundingClientRect();
  return { left: r.left, right: r.right, bottom: r.bottom };
}
