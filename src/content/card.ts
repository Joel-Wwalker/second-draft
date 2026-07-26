import { engineLabel } from '../shared/labels';
import type { HumanizeResult, HumanizerErrorKind, Intensity } from '../shared/types';

export interface CardCallbacks {
  onApply(): void;
  onCopy(): void;
  onDismiss(): void;
  onIntensityChange(intensity: Intensity): void;
}

const CARD_CSS = `
  :host { all: initial; }
  .card { position: fixed; z-index: 2147483647; width: 360px; max-width: 92vw;
    background: #fff; color: #202124; font: 13px/1.45 system-ui, sans-serif;
    border: 1px solid #dadce0; border-radius: 10px; box-shadow: 0 4px 16px rgba(0,0,0,.25);
    max-height: calc(100vh - 16px); overflow: auto; }
  .body { max-height: 260px; overflow: auto; padding: 10px 12px; white-space: pre-wrap; }
  .rewritten mark { background: #e8f0fe; color: inherit; border-radius: 3px; }
  .bar { display: flex; gap: 8px; align-items: center; padding: 8px 12px;
    border-top: 1px solid #eee; }
  .status { padding: 0 12px 6px; color: #5f6368; min-height: 16px; }
  .engine { color: #5f6368; margin-right: auto; }
  button { font: inherit; padding: 4px 12px; border: 1px solid #dadce0; border-radius: 6px;
    background: #fff; cursor: pointer; }
  button.apply { background: #1a73e8; border-color: #1a73e8; color: #fff; }
  button[hidden] { display: none; }
  select { font: inherit; }
`;

export class Card {
  private readonly doc: Document;
  private readonly cb: CardCallbacks;
  private readonly host: HTMLElement;
  private readonly cardEl: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly engineEl: HTMLElement;
  private readonly applyBtn: HTMLButtonElement;
  private readonly copyBtn: HTMLButtonElement;
  private readonly dismissBtn: HTMLButtonElement;
  private readonly intensitySel: HTMLSelectElement;
  private readonly onKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this.cb.onDismiss();
  };
  private open_ = false;

  constructor(doc: Document, cb: CardCallbacks) {
    this.doc = doc;
    this.cb = cb;
    this.host = doc.createElement('div');
    this.host.id = 'humanizer-card-host';
    const shadow = this.host.attachShadow({ mode: 'open' });
    const style = doc.createElement('style');
    style.textContent = CARD_CSS;

    this.cardEl = doc.createElement('div');
    this.cardEl.className = 'card';
    this.bodyEl = doc.createElement('div');
    this.bodyEl.className = 'body rewritten';
    this.statusEl = doc.createElement('div');
    this.statusEl.className = 'status';

    const bar = doc.createElement('div');
    bar.className = 'bar';
    this.engineEl = doc.createElement('span');
    this.engineEl.className = 'engine';
    this.intensitySel = doc.createElement('select');
    this.intensitySel.className = 'intensity';
    for (const [value, label] of [
      ['light', 'Light touch'],
      ['full', 'Full rewrite'],
    ] as const) {
      const opt = doc.createElement('option');
      opt.value = value;
      opt.textContent = label;
      this.intensitySel.append(opt);
    }
    this.intensitySel.addEventListener('change', () => {
      this.cb.onIntensityChange(this.intensitySel.value as Intensity);
    });
    this.applyBtn = doc.createElement('button');
    this.applyBtn.className = 'apply';
    this.applyBtn.textContent = 'Apply';
    this.applyBtn.addEventListener('click', () => this.cb.onApply());
    this.copyBtn = doc.createElement('button');
    this.copyBtn.className = 'copy';
    this.copyBtn.textContent = 'Copy';
    this.copyBtn.addEventListener('click', () => this.cb.onCopy());
    this.dismissBtn = doc.createElement('button');
    this.dismissBtn.className = 'dismiss';
    this.dismissBtn.textContent = 'Dismiss';
    this.dismissBtn.addEventListener('click', () => this.cb.onDismiss());

    bar.append(this.engineEl, this.intensitySel, this.applyBtn, this.copyBtn, this.dismissBtn);
    this.cardEl.append(this.bodyEl, this.statusEl, bar);
    shadow.append(style, this.cardEl);
  }

  get isOpen(): boolean {
    return this.open_;
  }

  open(rect: { left: number; bottom: number }, opts: { canApply: boolean; intensity: Intensity }): void {
    this.applyBtn.hidden = !opts.canApply;
    this.intensitySel.value = opts.intensity;
    this.bodyEl.textContent = '';
    this.engineEl.textContent = '';
    this.statusEl.textContent = 'Rewriting...';
    const win = this.doc.defaultView;
    const viewportW = win?.innerWidth ?? 800;
    const viewportH = win?.innerHeight ?? 600;
    const CARD_ESTIMATED_H = 340;
    const left = Math.max(8, Math.min(rect.left, viewportW - 376));
    let top = rect.bottom + 6;
    if (top + CARD_ESTIMATED_H > viewportH) top = Math.max(8, viewportH - CARD_ESTIMATED_H - 8);
    this.cardEl.style.left = `${Math.round(left)}px`;
    this.cardEl.style.top = `${Math.round(top)}px`;
    if (!this.host.isConnected) this.doc.body.append(this.host);
    this.doc.addEventListener('keydown', this.onKeydown, true);
    this.open_ = true;
  }

  setStreaming(textSoFar: string): void {
    this.bodyEl.textContent = textSoFar;
    this.statusEl.textContent = 'Rewriting...';
  }

  setResult(result: HumanizeResult): void {
    renderHighlights(this.doc, this.bodyEl, result);
    this.engineEl.textContent = engineLabel(result.engine);
    const n = result.changes.length;
    this.statusEl.textContent = `${n} change${n === 1 ? '' : 's'}`;
  }

  setError(kind: HumanizerErrorKind, message: string): void {
    this.statusEl.textContent = `Error: ${message}`;
    this.engineEl.textContent = kind;
  }

  /** Never-clobber refusal: flip to copy-primary. */
  showApplyFailed(): void {
    this.applyBtn.hidden = true;
    this.statusEl.textContent = 'The text changed since you selected it. Use Copy instead.';
  }

  close(): void {
    this.doc.removeEventListener('keydown', this.onKeydown, true);
    this.host.remove();
    this.open_ = false;
  }

  contains(target: EventTarget | null): boolean {
    return (
      target instanceof Node &&
      (this.host === target || (this.host.shadowRoot?.contains(target) ?? false))
    );
  }
}

function renderHighlights(doc: Document, container: HTMLElement, result: HumanizeResult): void {
  container.textContent = '';
  const { rewritten } = result;
  const changes = [...result.changes].sort((a, b) => a.range.start - b.range.start);
  let pos = 0;
  for (const change of changes) {
    if (change.range.start < pos || change.range.end <= change.range.start) continue;
    if (change.range.start > pos) container.append(rewritten.slice(pos, change.range.start));
    const mark = doc.createElement('mark');
    mark.textContent = rewritten.slice(change.range.start, change.range.end);
    mark.title = change.reason;
    container.append(mark);
    pos = change.range.end;
  }
  if (pos < rewritten.length) container.append(rewritten.slice(pos));
}
