import { engineLabel, resultStatus } from '../shared/labels';
import { formatChanges } from '../shared/change-log';
import type { HumanizeResult, HumanizerErrorKind, Intensity } from '../shared/types';

export interface CardCallbacks {
  onApply(): void;
  onCopy(): void;
  onDismiss(): void;
  onIntensityChange(intensity: Intensity): void;
}

const CARD_CSS = `
  :host { all: initial; }
  .card { position: fixed; z-index: 2147483647; width: 380px; max-width: 92vw;
    max-height: calc(100vh - 16px); overflow: auto;
    background: #ffffff; color: #0f172a; font: 13.5px/1.55 system-ui, sans-serif;
    border: 1px solid #e2e8f0; border-radius: 10px; box-shadow: 0 12px 32px rgba(15,23,42,.18); }
  .body { max-height: 260px; overflow: auto; padding: 12px 14px; white-space: pre-wrap; }
  .rewritten mark { background: #e0e7ff; color: inherit; border-radius: 3px; }
  .bar { display: flex; gap: 8px; align-items: center; padding: 10px 14px;
    border-top: 1px solid #e2e8f0; }
  .status { padding: 0 14px 8px; color: #64748b; min-height: 16px; font-size: 12px; }
  .engine { color: #64748b; margin-right: auto; font-size: 11.5px; }
  button { font: 600 12.5px system-ui, sans-serif; padding: 5px 12px; border: 1px solid #e2e8f0;
    border-radius: 6px; background: #fff; color: #0f172a; cursor: pointer; }
  button:hover { border-color: #94a3b8; }
  button.apply { background: #4f46e5; border-color: #4f46e5; color: #fff; }
  button.apply:hover { background: #4338ca; }
  button[hidden] { display: none; }
  select { font: 12.5px system-ui, sans-serif; padding: 4px 8px; border: 1px solid #e2e8f0;
    border-radius: 6px; background: #fff; color: #0f172a; }
  .changes { border-top: 1px solid #e2e8f0; padding: 8px 14px; font-size: 12px; }
  .changes summary { cursor: pointer; color: #64748b; font-weight: 600; }
  .changes .rows { max-height: 150px; overflow: auto; margin-top: 6px; }
  .chg { padding: 6px 0; border-bottom: 1px solid #f1f5f9; }
  .chg:last-child { border-bottom: 0; }
  .chg .why { display: block; font-size: 10.5px; color: #64748b; margin-bottom: 2px; }
  .chg .b { color: #9f5f64; text-decoration-color: #d4a3a8; }
  .chg .a { color: #0f172a; font-weight: 550; }
  .changes[hidden] { display: none; }
`;

export class Card {
  private readonly doc: Document;
  private readonly cb: CardCallbacks;
  private readonly host: HTMLElement;
  private readonly cardEl: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly changesEl: HTMLDetailsElement;
  private readonly changeRowsEl: HTMLDivElement;
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

    this.changesEl = doc.createElement('details');
    this.changesEl.className = 'changes';
    const summary = doc.createElement('summary');
    summary.textContent = 'What changed';
    this.changeRowsEl = doc.createElement('div');
    this.changeRowsEl.className = 'rows';
    this.changesEl.append(summary, this.changeRowsEl);

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
    this.cardEl.append(this.bodyEl, this.statusEl, this.changesEl, bar);
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
    this.changesEl.hidden = true;
    this.changesEl.open = false;
    this.changeRowsEl.textContent = '';
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

  setResult(result: HumanizeResult, original: string): void {
    renderHighlights(this.doc, this.bodyEl, result);
    this.engineEl.textContent = engineLabel(result.engine);
    this.statusEl.textContent = resultStatus(result);
    this.changeRowsEl.textContent = '';
    const rows = formatChanges(result, original);
    this.changesEl.hidden = rows.length === 0;
    for (const row of rows) {
      const item = this.doc.createElement('div');
      item.className = 'chg';
      const why = this.doc.createElement('span');
      why.className = 'why';
      why.textContent = row.reason;
      const line = this.doc.createElement('div');
      const before = this.doc.createElement('s');
      before.className = 'b';
      before.textContent = row.before;
      const arrow = this.doc.createTextNode(' \u2192 ');
      const after = this.doc.createElement('span');
      after.className = 'a';
      after.textContent = row.after;
      line.append(before, arrow, after);
      item.append(why, line);
      this.changeRowsEl.append(item);
    }
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
