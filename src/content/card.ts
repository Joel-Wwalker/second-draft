import { engineLabel, resultStatus } from '../shared/labels';
import { formatChanges } from '../shared/change-log';
import { findAlternatives, swapWord } from '../shared/alternatives';
import type { AltSpan } from '../shared/alternatives';
import type { Change, HumanizeResult, HumanizerErrorKind, Intensity } from '../shared/types';

export interface CardCallbacks {
  onApply(): void;
  onCopy(): void;
  onDismiss(): void;
  onIntensityChange(intensity: Intensity): void;
  onTextEdited(text: string): void;
  onUndo(): void;
}

/** How long the post-apply confirmation stays up before it auto-dismisses. */
const AUTO_DISMISS_MS = 10_000;

const CARD_CSS = `
  :host { all: initial; }
  .card { position: fixed; z-index: 2147483647; width: 396px; max-width: 92vw;
    max-height: calc(100vh - 16px); overflow: auto;
    background: #ffffff; color: #0f172a; font: 14px/1.6 system-ui, sans-serif;
    border: 1px solid rgba(15,23,42,.07); border-radius: 18px;
    box-shadow: 0 1px 2px rgba(15,23,42,.06), 0 12px 28px -6px rgba(15,23,42,.16), 0 32px 64px -12px rgba(15,23,42,.14); }
  .head { display: flex; align-items: center; gap: 12px; padding: 16px 18px 10px; }
  .ring { width: 44px; height: 44px; flex: none; position: relative; }
  .ring svg { transform: rotate(-90deg); display: block; }
  .ring .num { position: absolute; inset: 0; display: grid; place-items: center;
    font-size: 13px; font-weight: 800; color: #4338ca; }
  .headline { min-width: 0; }
  .headline .h { font-size: 15px; font-weight: 700; letter-spacing: -0.01em; }
  .status { font-size: 12px; color: #64748b; min-height: 15px; }
  .body { max-height: 220px; overflow: auto; padding: 2px 18px 14px; white-space: pre-wrap; }
  .rewritten mark { background: #e0e7ff; color: inherit; border-radius: 4px; padding: 0 2px;
    box-shadow: inset 0 -2px 0 rgba(79,70,229,.35); }
  .changes { padding: 0 18px 12px; font-size: 12.5px; }
  .changes summary { cursor: pointer; color: #64748b; font-weight: 600; padding: 6px 0; }
  .changes .rows { max-height: 168px; overflow: auto; border: 1px solid #eef1f5;
    border-radius: 12px; margin-top: 4px; }
  .chg { padding: 8px 12px; border-bottom: 1px solid #f4f6f9; }
  .chg:last-child { border-bottom: 0; }
  .chg .why { display: block; font-size: 10px; font-weight: 700; letter-spacing: .05em;
    text-transform: uppercase; color: #8b93a1; margin-bottom: 2px; }
  .chg .b { color: #9f5f64; text-decoration-color: #d4a3a8; }
  .chg .a { color: #0f172a; font-weight: 600; }
  .changes[hidden] { display: none; }
  .bar { display: flex; gap: 8px; align-items: center; padding: 12px 18px;
    background: #fbfbfd; border-top: 1px solid #eef1f5; }
  .engine { color: #64748b; margin-right: auto; font-size: 11.5px;
    display: inline-flex; align-items: center; gap: 6px; }
  .engine::before { content: ""; width: 7px; height: 7px; border-radius: 99px; background: #4f46e5; }
  button { font: 600 13px system-ui, sans-serif; padding: 8px 13px; border: 0;
    border-radius: 999px; background: transparent; color: #64748b; cursor: pointer; }
  button:hover { color: #0f172a; background: #eef1f5; }
  button.apply { background: #4f46e5; color: #fff; font-weight: 700; padding: 8px 20px;
    box-shadow: 0 1px 2px rgba(79,70,229,.4); }
  button.apply:hover { background: #4338ca; color: #fff; }
  button[hidden] { display: none; }
  select { font: 12.5px system-ui, sans-serif; padding: 5px 9px; border: 1px solid #e2e8f0;
    border-radius: 999px; background: #fff; color: #0f172a; }
  button.alt { display: inline; font: inherit; padding: 0 2px; border: 0; border-radius: 4px;
    background: #fff7ed; color: #9a3412; cursor: pointer;
    box-shadow: inset 0 -2px 0 rgba(234,88,12,.4); }
  button.alt:hover { background: #ffedd5; color: #7c2d12; }
  .alts { position: absolute; z-index: 2; background: #fff; border: 1px solid #e2e8f0;
    border-radius: 12px; padding: 8px; box-shadow: 0 10px 24px rgba(15,23,42,.18);
    display: flex; flex-direction: column; gap: 4px; min-width: 132px; }
  .alts-label { font-size: 10px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase;
    color: #8b93a1; padding: 0 6px 2px; }
  button.alt-opt { text-align: left; font: 600 13px system-ui, sans-serif; padding: 6px 10px;
    border-radius: 8px; background: transparent; color: #0f172a; }
  button.alt-opt:hover { background: #eef1f5; }
`;

export class Card {
  private readonly doc: Document;
  private readonly cb: CardCallbacks;
  private readonly host: HTMLElement;
  private readonly cardEl: HTMLElement;
  private readonly headEl: HTMLElement;
  private readonly headlineEl: HTMLElement;
  private readonly ringFg: SVGCircleElement;
  private readonly ringNum: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly changesEl: HTMLDetailsElement;
  private readonly changeRowsEl: HTMLDivElement;
  private readonly engineEl: HTMLElement;
  private readonly applyBtn: HTMLButtonElement;
  private readonly copyBtn: HTMLButtonElement;
  private readonly dismissBtn: HTMLButtonElement;
  private readonly undoBtn: HTMLButtonElement;
  private readonly intensitySel: HTMLSelectElement;
  private readonly onKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this.cb.onDismiss();
  };
  private open_ = false;
  private currentText = '';
  private currentChanges: Change[] = [];
  private popoverEl: HTMLElement | null = null;
  private autoDismissTimer: ReturnType<typeof setTimeout> | null = null;

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

    this.statusEl = doc.createElement('div');
    this.statusEl.className = 'status';

    this.headEl = doc.createElement('div');
    this.headEl.className = 'head';
    const ring = doc.createElement('div');
    ring.className = 'ring';
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '44');
    svg.setAttribute('height', '44');
    svg.setAttribute('viewBox', '0 0 44 44');
    const track = doc.createElementNS('http://www.w3.org/2000/svg', 'circle');
    track.setAttribute('cx', '22');
    track.setAttribute('cy', '22');
    track.setAttribute('r', '19');
    track.setAttribute('fill', 'none');
    track.setAttribute('stroke', '#eef1f5');
    track.setAttribute('stroke-width', '4');
    this.ringFg = doc.createElementNS('http://www.w3.org/2000/svg', 'circle');
    this.ringFg.setAttribute('cx', '22');
    this.ringFg.setAttribute('cy', '22');
    this.ringFg.setAttribute('r', '19');
    this.ringFg.setAttribute('fill', 'none');
    this.ringFg.setAttribute('stroke', '#4f46e5');
    this.ringFg.setAttribute('stroke-width', '4');
    this.ringFg.setAttribute('stroke-linecap', 'round');
    this.ringFg.setAttribute('stroke-dasharray', '119.4');
    this.ringFg.setAttribute('stroke-dashoffset', '119.4');
    svg.append(track, this.ringFg);
    this.ringNum = doc.createElement('div');
    this.ringNum.className = 'num';
    ring.append(svg, this.ringNum);
    const headline = doc.createElement('div');
    headline.className = 'headline';
    this.headlineEl = doc.createElement('div');
    this.headlineEl.className = 'h';
    headline.append(this.headlineEl, this.statusEl);
    this.headEl.append(ring, headline);

    this.bodyEl = doc.createElement('div');
    this.bodyEl.className = 'body rewritten';

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
    this.dismissBtn.addEventListener('click', () => {
      this.cancelAutoDismiss();
      this.cb.onDismiss();
    });
    this.undoBtn = doc.createElement('button');
    this.undoBtn.className = 'undo';
    this.undoBtn.textContent = 'Undo';
    this.undoBtn.hidden = true;
    this.undoBtn.addEventListener('click', () => {
      this.cancelAutoDismiss();
      this.cb.onUndo();
    });

    bar.append(this.engineEl, this.intensitySel, this.applyBtn, this.copyBtn, this.undoBtn, this.dismissBtn);
    this.cardEl.append(this.headEl, this.bodyEl, this.changesEl, bar);
    shadow.append(style, this.cardEl);
  }

  get isOpen(): boolean {
    return this.open_;
  }

  open(rect: { left: number; bottom: number }, opts: { canApply: boolean; intensity: Intensity }): void {
    this.cancelAutoDismiss();
    this.applyBtn.hidden = !opts.canApply;
    this.copyBtn.hidden = false;
    this.intensitySel.hidden = false;
    this.undoBtn.hidden = true;
    this.intensitySel.value = opts.intensity;
    this.bodyEl.textContent = '';
    this.engineEl.textContent = '';
    this.statusEl.textContent = 'Rewriting...';
    this.headlineEl.textContent = 'Humanizing';
    this.setRing(0, 0);
    this.changesEl.hidden = true;
    this.changesEl.open = false;
    this.changeRowsEl.textContent = '';
    this.currentText = '';
    this.currentChanges = [];
    this.closePopover();
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
    this.changesEl.open = rows.length > 0 && rows.length <= 3;
    const { before, after } = result.tells;
    this.setRing(before, after);
    this.headlineEl.textContent =
      before === 0 ? 'Looks human already' : after === 0 ? 'All clear' : `${after} tell${after === 1 ? '' : 's'} left`;
    this.currentText = result.rewritten;
    this.currentChanges = [...result.changes];
    this.renderBody();
  }

  setError(kind: HumanizerErrorKind, message: string): void {
    this.statusEl.textContent = `Error: ${message}`;
    this.engineEl.textContent = kind;
    this.headlineEl.textContent = 'Could not rewrite';
    this.setRing(0, 0);
  }

  /** Fill the ring by how many tells were cleared; empty when there were none to clear. */
  private setRing(before: number, after: number): void {
    const cleared = before === 0 ? 1 : Math.max(0, before - after) / before;
    const circumference = 119.4;
    this.ringFg.setAttribute('stroke-dashoffset', String(Math.round(circumference * (1 - cleared) * 10) / 10));
    this.ringNum.textContent = String(after);
  }

  /** Never-clobber refusal: flip to copy-primary. */
  showApplyFailed(): void {
    this.applyBtn.hidden = true;
    this.statusEl.textContent = 'The text changed since you selected it. Use Copy instead.';
  }

  /** Post-apply confirmation: Apply, Copy, and the intensity picker no longer apply. */
  showApplied(): void {
    this.closePopover();
    this.applyBtn.hidden = true;
    this.copyBtn.hidden = true;
    this.intensitySel.hidden = true;
    this.undoBtn.hidden = false;
    this.headlineEl.textContent = 'Applied';
    this.statusEl.textContent = '';
    this.bodyEl.textContent = 'Replaced in place.';
    this.armAutoDismiss();
  }

  close(): void {
    this.cancelAutoDismiss();
    this.doc.removeEventListener('keydown', this.onKeydown, true);
    this.closePopover();
    this.host.remove();
    this.open_ = false;
  }

  contains(target: EventTarget | null): boolean {
    return (
      target instanceof Node &&
      (this.host === target || (this.host.shadowRoot?.contains(target) ?? false))
    );
  }

  /** Render the rewrite with change highlights and clickable alternative words. */
  private renderBody(): void {
    this.closePopover();
    this.bodyEl.textContent = '';
    const text = this.currentText;
    const changes = [...this.currentChanges]
      .filter(c => c.range.end > c.range.start)
      .sort((a, b) => a.range.start - b.range.start);
    const alts = findAlternatives(text, changes.map(c => c.range));
    type Piece = { start: number; end: number; kind: 'mark'; reason: string } | { start: number; end: number; kind: 'alt'; span: AltSpan };
    const pieces: Piece[] = [
      ...changes.map(c => ({ start: c.range.start, end: c.range.end, kind: 'mark' as const, reason: c.reason })),
      ...alts.map(a => ({ start: a.start, end: a.end, kind: 'alt' as const, span: a })),
    ].sort((a, b) => a.start - b.start);

    let pos = 0;
    for (const piece of pieces) {
      if (piece.start < pos) continue;
      if (piece.start > pos) this.bodyEl.append(text.slice(pos, piece.start));
      if (piece.kind === 'mark') {
        const mark = this.doc.createElement('mark');
        mark.textContent = text.slice(piece.start, piece.end);
        mark.title = piece.reason;
        this.bodyEl.append(mark);
      } else {
        const btn = this.doc.createElement('button');
        btn.className = 'alt';
        btn.type = 'button';
        btn.textContent = piece.span.word;
        btn.title = `Swap for: ${piece.span.options.join(', ')}`;
        btn.addEventListener('click', e => {
          e.stopPropagation();
          this.openPopover(btn, piece.span);
        });
        this.bodyEl.append(btn);
      }
      pos = piece.end;
    }
    if (pos < text.length) this.bodyEl.append(text.slice(pos));
  }

  private openPopover(anchor: HTMLElement, span: AltSpan): void {
    this.closePopover();
    const pop = this.doc.createElement('div');
    pop.className = 'alts';
    const label = this.doc.createElement('div');
    label.className = 'alts-label';
    label.textContent = 'Swap for';
    pop.append(label);
    for (const option of span.options) {
      const choice = this.doc.createElement('button');
      choice.className = 'alt-opt';
      choice.type = 'button';
      choice.textContent = option;
      choice.addEventListener('click', e => {
        e.stopPropagation();
        this.applySwap(span, option);
      });
      pop.append(choice);
    }
    const anchorRect = anchor.getBoundingClientRect();
    const cardRect = this.cardEl.getBoundingClientRect();
    pop.style.left = `${Math.max(6, anchorRect.left - cardRect.left)}px`;
    pop.style.top = `${anchorRect.bottom - cardRect.top + 4}px`;
    this.cardEl.append(pop);
    this.popoverEl = pop;
  }

  private closePopover(): void {
    this.popoverEl?.remove();
    this.popoverEl = null;
  }

  private armAutoDismiss(): void {
    this.cancelAutoDismiss();
    this.autoDismissTimer = setTimeout(() => {
      this.autoDismissTimer = null;
      this.close();
    }, AUTO_DISMISS_MS);
  }

  private cancelAutoDismiss(): void {
    if (this.autoDismissTimer !== null) {
      clearTimeout(this.autoDismissTimer);
      this.autoDismissTimer = null;
    }
  }

  private applySwap(span: AltSpan, option: string): void {
    const before = this.currentText;
    this.currentText = swapWord(before, span, option);
    const delta = this.currentText.length - before.length;
    this.currentChanges = this.currentChanges.map(c =>
      c.range.start >= span.end
        ? { ...c, range: { start: c.range.start + delta, end: c.range.end + delta } }
        : c,
    );
    this.renderBody();
    this.cb.onTextEdited(this.currentText);
  }
}
