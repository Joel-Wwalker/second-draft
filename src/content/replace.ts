import type { EditableSelection } from './selection';

/**
 * Write the rewritten text back into the captured selection.
 * Never clobbers: if the target cannot be verifiably relocated, returns false
 * and the caller falls back to Copy.
 */
export function applyReplacement(target: EditableSelection, rewritten: string, doc: Document): boolean {
  if (target.kind === 'field') return replaceInField(target, rewritten);
  return replaceInEditable(target, rewritten, doc);
}

/** Index of the unique occurrence of needle in haystack, else null. */
export function locate(haystack: string, needle: string): number | null {
  if (!needle) return null;
  const first = haystack.indexOf(needle);
  if (first === -1) return null;
  if (haystack.indexOf(needle, first + 1) !== -1) return null;
  return first;
}

function replaceInField(
  target: Extract<EditableSelection, { kind: 'field' }>,
  rewritten: string,
): boolean {
  const { el } = target;
  if (!el.isConnected) return false;
  let { start, end } = target;
  if (el.value.slice(start, end) !== target.text) {
    const found = locate(el.value, target.text);
    if (found === null) return false;
    start = found;
    end = found + target.text.length;
  }
  el.focus();
  if (typeof el.setRangeText === 'function') {
    el.setSelectionRange(start, end);
    el.setRangeText(rewritten, start, end, 'end');
  } else {
    // Very old engines: manual splice.
    el.value = el.value.slice(0, start) + rewritten + el.value.slice(end);
    el.setSelectionRange(start + rewritten.length, start + rewritten.length);
  }
  el.dispatchEvent(
    new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: rewritten }),
  );
  return true;
}

function replaceInEditable(
  target: Extract<EditableSelection, { kind: 'editable' }>,
  rewritten: string,
  doc: Document,
): boolean {
  const { root, range } = target;
  if (!root.isConnected) return false;
  if (range.toString() !== target.text) return false;
  const sel = doc.getSelection();
  if (!sel) return false;
  sel.removeAllRanges();
  sel.addRange(range);
  // execCommand keeps the site's undo stack alive where supported.
  if (typeof doc.execCommand === 'function' && doc.execCommand('insertText', false, rewritten)) {
    return true;
  }
  // Fallback (jsdom, engines without execCommand): direct range surgery.
  range.deleteContents();
  range.insertNode(doc.createTextNode(rewritten));
  sel.removeAllRanges();
  return true;
}
