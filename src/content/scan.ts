import { detect } from '../engine/rules';
import type { Rule } from '../engine/rules';
import type { ScanSummary } from '../shared/types';

export type { ScanSummary };

/** Elements a scan treats as one "block" of prose. Matches selection.ts's editable-root
 *  attribute values so a rich-text editor's own contenteditable wrapper is included. */
const BLOCK_SELECTOR =
  'p, li, h1, h2, h3, h4, blockquote, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]';

/** Never read text out of these, even when nested inside an otherwise-scannable block. */
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'INPUT', 'TEXTAREA']);

/** The extension's own floating UI. Their real content lives in a shadow root (already
 *  invisible to the light-DOM walk below), but this is an explicit, defense-in-depth guard
 *  against any stray light-DOM content ending up inside one of these hosts. */
const EXTENSION_HOST_SELECTOR = '#humanizer-chip-host, #humanizer-card-host';

/** Blocks shorter than this are noise (captions, single-word headings, list bullets) and are
 *  skipped entirely: not scanned, not counted. */
const MIN_BLOCK_CHARS = 40;

const HIGHLIGHT_NAME = 'humanizer-scan';
const HIGHLIGHT_STYLE_ID = 'humanizer-scan-style';

interface NodeSpan {
  node: Text;
  start: number;
  end: number;
}

/**
 * Walks the page looking for AI tells without ever changing the page's text. Marking uses the
 * CSS Custom Highlight API (CSS.highlights + Range objects registered against a stylesheet
 * rule), which paints text decoration without touching the DOM at all -- no wrapping elements,
 * no textContent writes. Where that API is unavailable, run() still counts; it just cannot mark.
 */
export class PageScan {
  private readonly doc: Document;
  private readonly highlightApiAvailable: boolean;

  constructor(doc: Document) {
    this.doc = doc;
    this.highlightApiAvailable =
      typeof CSS !== 'undefined' && typeof CSS.highlights !== 'undefined' && typeof Highlight !== 'undefined';
  }

  /** Extra rules (the user's custom tells) count the same as the built-in ones. */
  run(extra: Rule[] = []): ScanSummary {
    this.clear();
    const candidates = Array.from(this.doc.body.querySelectorAll<HTMLElement>(BLOCK_SELECTOR));
    let tells = 0;
    let blocks = 0;
    const ranges: Range[] = [];

    for (const el of candidates) {
      if (this.isExtensionHost(el)) continue;
      if (!this.isVisible(el)) continue;
      const { text, spans } = this.collectBlockText(el);
      if (text.trim().length < MIN_BLOCK_CHARS) continue;
      blocks++;
      const hits = detect(text, extra);
      tells += hits.length;
      if (!this.highlightApiAvailable) continue;
      for (const hit of hits) {
        const range = this.rangeForSpan(spans, hit.span.start, hit.span.end);
        if (range) ranges.push(range);
      }
    }

    if (this.highlightApiAvailable && ranges.length > 0) {
      this.ensureStyle();
      CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...ranges));
    }

    return { tells, blocks, highlightsSupported: this.highlightApiAvailable };
  }

  /** Un-registers any highlight and removes the injected stylesheet. Never touches page text:
   *  CSS.highlights.delete() only unregisters Range pointers, and the style element it removes
   *  lives in <head>, never in <body>. Safe to call before any run(), and safe to call twice. */
  clear(): void {
    if (this.highlightApiAvailable) CSS.highlights.delete(HIGHLIGHT_NAME);
    this.doc.getElementById(HIGHLIGHT_STYLE_ID)?.remove();
  }

  private isExtensionHost(el: Element): boolean {
    return el.closest(EXTENSION_HOST_SELECTOR) !== null;
  }

  /** True unless el or any ancestor up to <body> is hidden. display is a non-inherited CSS
   *  property, so a visible element under a hidden ancestor still reports its own display as
   *  "block"; only walking the chain catches that. */
  private isVisible(el: HTMLElement): boolean {
    let cur: HTMLElement | null = el;
    while (cur && cur !== this.doc.body) {
      if (this.isHiddenSelf(cur)) return false;
      cur = cur.parentElement;
    }
    return true;
  }

  private isHiddenSelf(el: HTMLElement): boolean {
    if (el.hidden) return true;
    if (el.style.display === 'none' || el.style.visibility === 'hidden') return true;
    const view = this.doc.defaultView;
    if (!view) return false;
    try {
      const computed = view.getComputedStyle(el);
      return computed.display === 'none' || computed.visibility === 'hidden';
    } catch {
      return false;
    }
  }

  /**
   * Concatenates root's own text, skipping script/style/inputs/hidden nodes and pruning any
   * descendant that is itself a block candidate (so a <p> nested in a <blockquote> is counted
   * once, as its own block, not folded into the blockquote's total too). Returns the spans
   * needed to map a detect() hit's character offsets back to a live Range.
   */
  private collectBlockText(root: HTMLElement): { text: string; spans: NodeSpan[] } {
    const spans: NodeSpan[] = [];
    let text = '';
    const walker = this.doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (node: Node): number => {
        if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
        const el = node as Element;
        if (el === root) return NodeFilter.FILTER_SKIP;
        if (SKIP_TAGS.has(el.tagName)) return NodeFilter.FILTER_REJECT;
        if (this.isExtensionHost(el)) return NodeFilter.FILTER_REJECT;
        if (el.matches(BLOCK_SELECTOR)) return NodeFilter.FILTER_REJECT;
        if (el instanceof HTMLElement && this.isHiddenSelf(el)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_SKIP;
      },
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const t = node as Text;
      const start = text.length;
      text += t.data;
      spans.push({ node: t, start, end: text.length });
    }
    return { text, spans };
  }

  /** Maps a [start, end) offset pair in a block's collected text back to a Range over the
   *  original text node(s), the same node-walking shape session.ts's rangeFromTextOffsets uses
   *  for undo. Returns null if the offsets no longer land inside the recorded spans. */
  private rangeForSpan(spans: NodeSpan[], start: number, end: number): Range | null {
    let startNode: Text | null = null;
    let startOffset = 0;
    let endNode: Text | null = null;
    let endOffset = 0;
    for (const s of spans) {
      const len = s.end - s.start;
      if (!startNode && start <= s.start + len) {
        startNode = s.node;
        startOffset = start - s.start;
      }
      if (!endNode && end <= s.start + len) {
        endNode = s.node;
        endOffset = end - s.start;
      }
      if (startNode && endNode) break;
    }
    if (!startNode || !endNode || startOffset < 0 || endOffset < 0) return null;
    const range = this.doc.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    return range;
  }

  /** ::highlight() pseudo-elements have no default styling, so this rule is what actually
   *  makes a registered Highlight visible. Same family as the alternatives chip: amber
   *  underline, not a background fill, so the surrounding page's own colors stay untouched. */
  private ensureStyle(): void {
    if (this.doc.getElementById(HIGHLIGHT_STYLE_ID)) return;
    const style = this.doc.createElement('style');
    style.id = HIGHLIGHT_STYLE_ID;
    style.textContent = `::highlight(${HIGHLIGHT_NAME}) { text-decoration: underline; text-decoration-color: #9a3412; text-decoration-thickness: 2px; }`;
    this.doc.head.append(style);
  }
}
