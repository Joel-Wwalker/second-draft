export const MIN_SELECTION_CHARS = 10;

export type EditableSelection =
  | { kind: 'field'; el: HTMLTextAreaElement | HTMLInputElement; start: number; end: number; text: string }
  | { kind: 'editable'; root: HTMLElement; range: Range; text: string };

// Input types whose selection API is readable in Chromium. email/number/date
// types throw on selectionStart reads; password is deliberately excluded so
// password text never reaches the engine.
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'tel']);

// Never capture fields that smell like credentials or payment data, even when
// type="text" (show-password toggles, card forms). Hard gate before any
// network provider ships.
const SENSITIVE_FIELD = /password|cc-|one-time-code|cvc|csc/i;

function isSensitiveField(el: HTMLInputElement): boolean {
  return (
    el.type === 'password' ||
    SENSITIVE_FIELD.test(el.autocomplete) ||
    SENSITIVE_FIELD.test(el.name) ||
    SENSITIVE_FIELD.test(el.id)
  );
}

/** Guard for capture paths that bypass getEditableSelection (context menu). */
export function isSensitiveTarget(doc: Document): boolean {
  const el = doc.activeElement;
  return el instanceof HTMLInputElement && isSensitiveField(el);
}

export function getEditableSelection(doc: Document): EditableSelection | null {
  const active = doc.activeElement;
  if (
    active instanceof HTMLTextAreaElement ||
    (active instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(active.type))
  ) {
    if (active instanceof HTMLInputElement && isSensitiveField(active)) return null;
    const start = active.selectionStart ?? 0;
    const end = active.selectionEnd ?? 0;
    if (end - start < MIN_SELECTION_CHARS) return null;
    return { kind: 'field', el: active, start, end, text: active.value.slice(start, end) };
  }

  const sel = doc.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  const root = editableRoot(range.commonAncestorContainer);
  if (!root) return null;
  const text = sel.toString();
  if (text.length < MIN_SELECTION_CHARS) return null;
  return { kind: 'editable', root, range: range.cloneRange(), text };
}

/** Selected text anywhere on the page (context-menu path; may be non-editable). */
export function getPlainSelection(doc: Document): string {
  return doc.getSelection()?.toString() ?? '';
}

const EDITABLE_SELECTOR = '[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]';

/** Outermost contenteditable ancestor, attribute-based so it works in jsdom too. */
function editableRoot(node: Node | null): HTMLElement | null {
  const el = node instanceof HTMLElement ? node : (node?.parentElement ?? null);
  let cur = el?.closest<HTMLElement>(EDITABLE_SELECTOR) ?? null;
  while (cur) {
    const above = cur.parentElement?.closest<HTMLElement>(EDITABLE_SELECTOR) ?? null;
    if (!above) return cur;
    cur = above;
  }
  return null;
}
