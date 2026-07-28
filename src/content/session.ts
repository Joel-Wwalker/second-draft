import { getEditableSelection, getPlainSelection, isSensitiveTarget } from './selection';
import type { EditableSelection } from './selection';
import { applyReplacement, locate } from './replace';
import { Chip } from './chip';
import { Card } from './card';
import { detect } from '../engine/rules';
import { getSettings } from '../shared/storage';
import { analyzeWriting, compareToProfile } from '../shared/profile';
import type { WritingProfile } from '../shared/profile';
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
  private voiceProfile: WritingProfile | null = null;
  private requestId: string | null = null;
  private result: HumanizeResult | null = null;
  private applied: { target: EditableSelection; appliedText: string; originalText: string } | null = null;
  private stopped = false;

  constructor(doc: Document) {
    this.doc = doc;
    this.chip = new Chip(doc, () => this.onChipClick());
    this.card = new Card(doc, {
      onApply: () => this.onApply(),
      onCopy: () => this.onCopy(),
      onDismiss: () => this.dismissCard(),
      onIntensityChange: intensity => this.onIntensityChange(intensity),
      onRegenerate: () => this.onRegenerate(),
      onTextEdited: text => {
        if (this.result) this.result = { ...this.result, rewritten: text };
      },
      onUndo: () => this.onUndo(),
    });
  }

  start(): void {
    this.doc.addEventListener('selectionchange', this.onSelectionChange);
    this.doc.addEventListener('mousedown', this.onMouseDown, true);
    chrome.runtime.onMessage.addListener(this.onRuntimeMessage);
    chrome.storage.onChanged.addListener(this.onStorageChanged);
    void getSettings().then(s => {
      this.intensity = s.defaultIntensity;
      this.voiceProfile = analyzeWriting(s.voiceSample);
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
      if (this.voiceProfile) {
        const note = compareToProfile(msg.result.rewritten, this.voiceProfile);
        this.card.setResult(msg.result, this.capturedText, note ?? undefined);
      } else {
        this.card.setResult(msg.result, this.capturedText);
      }
    } else {
      this.clearRequestTimeout();
      this.card.setError(msg.kind, msg.message);
    }
  }

  private onApply(): void {
    if (!this.result || !this.captured) return;
    const target = this.captured;
    const appliedText = this.result.rewritten;
    const originalText = this.capturedText;
    const ok = applyReplacement(target, appliedText, this.doc);
    if (!ok) {
      this.card.showApplyFailed();
      return;
    }
    this.applied = { target, appliedText, originalText };
    this.card.showApplied();
  }

  private onUndo(): void {
    if (!this.applied) return;
    const { target, appliedText, originalText } = this.applied;
    const undoTarget = locateApplied(target, appliedText, this.doc);
    const ok = undoTarget !== null && applyReplacement(undoTarget, originalText, this.doc);
    if (!ok) {
      this.card.setError('replace-failed', 'Could not undo. The text changed again.');
      return;
    }
    this.applied = null;
    this.card.close();
  }

  private onCopy(): void {
    if (!this.result) return;
    const nav = this.doc.defaultView?.navigator;
    void nav?.clipboard?.writeText(this.result.rewritten).catch(() => {});
  }

  private onIntensityChange(intensity: Intensity): void {
    this.intensity = intensity;
    this.restartRequest();
  }

  /** Same path as onIntensityChange, minus the intensity edit: same text, same intensity, new id. */
  private onRegenerate(): void {
    this.restartRequest();
  }

  /** Cancels whatever is in flight, resets the card to its streaming state, and requests anew. */
  private restartRequest(): void {
    this.cancelInFlight();
    this.card.setStreaming('');
    this.request();
  }

  private dismissCard(): void {
    this.cancelInFlight();
    // Drop any stale post-apply selection/Range so it can't be reused once the card
    // is gone (also covers stop() and the card's own 10s auto-dismiss after apply,
    // both of which route through here via the onDismiss callback).
    this.applied = null;
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

/**
 * Selection describing where the applied text currently sits, so applyReplacement's
 * never-clobber checks can safely write the original back in its place.
 *
 * Field: replaceInField already relocates by matching `text` when the passed-in
 * offsets have drifted, so anchoring the guess at the original start (where the
 * applied text landed if nothing else in the field changed) is enough to hand off;
 * a stale guess just falls through to that existing relocate-or-refuse path.
 *
 * Editable: there is no such fallback inside replaceInEditable, so the current
 * location has to be found here, refusing when the applied text is missing or
 * no longer unique.
 */
function locateApplied(target: EditableSelection, appliedText: string, doc: Document): EditableSelection | null {
  if (target.kind === 'field') {
    return { kind: 'field', el: target.el, start: target.start, end: target.start + appliedText.length, text: appliedText };
  }
  if (!target.root.isConnected) return null;
  const text = target.root.textContent ?? '';
  const start = locate(text, appliedText);
  if (start === null) return null;
  const range = rangeFromTextOffsets(target.root, doc, start, start + appliedText.length);
  return range ? { kind: 'editable', root: target.root, range, text: appliedText } : null;
}

/**
 * Range spanning [start, end) of root's flattened text content, walking possibly
 * several sibling text nodes (a plain in-place edit commonly splits one text node
 * into several). Returns null if the DOM changed shape enough that the offsets no
 * longer land inside a text node.
 */
function rangeFromTextOffsets(root: HTMLElement, doc: Document, start: number, end: number): Range | null {
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let pos = 0;
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    const len = text.data.length;
    if (!startNode && start <= pos + len) {
      startNode = text;
      startOffset = start - pos;
    }
    if (!endNode && end <= pos + len) {
      endNode = text;
      endOffset = end - pos;
    }
    pos += len;
    if (startNode && endNode) break;
  }
  if (!startNode || !endNode) return null;
  const range = doc.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return range;
}
