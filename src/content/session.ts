import { getEditableSelection, getPlainSelection, isSensitiveTarget } from './selection';
import type { EditableSelection } from './selection';
import { applyReplacement, locate } from './replace';
import { isApplyRequest, isCaptureRequest, isUndoRequest } from '../shared/messages';
import type { ApplyResponse, CaptureResponse } from '../shared/messages';

/**
 * The page side of the extension. It draws nothing: the popup owns the UI now.
 * This hands over the selected text, writes a rewrite back where it came from,
 * and can put the original back.
 */
export class HumanizeSession {
  private readonly doc: Document;
  /** Where the captured text came from, so a later apply lands in the right place. */
  private captured: EditableSelection | null = null;
  /** Set after a successful apply so undo has something to restore. */
  private applied: { target: EditableSelection; appliedText: string; originalText: string } | null = null;
  private stopped = false;

  constructor(doc: Document) {
    this.doc = doc;
  }

  start(): void {
    chrome.runtime.onMessage.addListener(this.onMessage);
  }

  stop(): void {
    this.stopped = true;
    chrome.runtime.onMessage.removeListener(this.onMessage);
    this.captured = null;
    this.applied = null;
  }

  private readonly onMessage = (
    msg: unknown,
    sender?: chrome.runtime.MessageSender,
    sendResponse?: (res: CaptureResponse | ApplyResponse) => void,
  ): void => {
    if (this.stopped) return;
    // Same check the background router makes: only our own pages may ask.
    if (sender && sender.id !== chrome.runtime.id) return;
    if (isCaptureRequest(msg)) {
      sendResponse?.(this.capture());
    } else if (isApplyRequest(msg)) {
      sendResponse?.({ ok: this.apply(msg.text) });
    } else if (isUndoRequest(msg)) {
      sendResponse?.({ ok: this.undo() });
    }
  };

  private capture(): CaptureResponse {
    const editable = getEditableSelection(this.doc);
    if (editable) {
      this.captured = editable;
      return { ok: true, text: editable.text, canApply: true };
    }
    // Credential fields never get captured, including through the plain-text
    // path below.
    if (isSensitiveTarget(this.doc)) return { ok: false, reason: 'sensitive' };
    const plain = getPlainSelection(this.doc);
    if (!plain) return { ok: false, reason: 'none' };
    this.captured = null;
    return { ok: true, text: plain, canApply: false };
  }

  private apply(text: string): boolean {
    if (!this.captured) return false;
    const original = this.captured.text;
    if (!applyReplacement(this.captured, text, this.doc)) return false;
    this.applied = { target: this.captured, appliedText: text, originalText: original };
    return true;
  }

  private undo(): boolean {
    if (!this.applied) return false;
    const { target, appliedText, originalText } = this.applied;
    const current = this.locateApplied(target, appliedText);
    if (!current) return false;
    if (!applyReplacement(current, originalText, this.doc)) return false;
    this.applied = null;
    this.captured = current.kind === 'field' ? { ...current, text: originalText } : null;
    return true;
  }

  /** Describe where the applied text sits now, so undo goes through the same guards. */
  private locateApplied(target: EditableSelection, appliedText: string): EditableSelection | null {
    if (target.kind === 'field') {
      if (!target.el.isConnected) return null;
      const at = locate(target.el.value, appliedText);
      if (at === null) return null;
      return { kind: 'field', el: target.el, start: at, end: at + appliedText.length, text: appliedText };
    }
    if (!target.root.isConnected) return null;
    const at = locate(target.root.textContent ?? '', appliedText);
    if (at === null) return null;
    const range = rangeFromTextOffsets(target.root, at, at + appliedText.length, this.doc);
    if (!range) return null;
    return { kind: 'editable', root: target.root, range, text: appliedText };
  }
}

/**
 * A Range covering [start, end) of a root's text, walking its text nodes so a
 * span crossing element boundaries still resolves.
 */
function rangeFromTextOffsets(
  root: HTMLElement,
  start: number,
  end: number,
  doc: Document,
): Range | null {
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = doc.createRange();
  let seen = 0;
  let startSet = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (!startSet && seen + length >= start) {
      range.setStart(node, start - seen);
      startSet = true;
    }
    if (startSet && seen + length >= end) {
      range.setEnd(node, end - seen);
      return range;
    }
    seen += length;
  }
  return null;
}
