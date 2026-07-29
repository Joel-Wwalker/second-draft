import type { HumanizeResult, HumanizerErrorKind, Intensity } from './types';

export interface HumanizeRequest {
  type: 'humanize';
  /** Correlation id; responses and cancels reference it. */
  id: string;
  text: string;
  intensity: Intensity;
}

export interface CancelRequest {
  type: 'cancel';
  id: string;
}

export type BackgroundRequest = HumanizeRequest | CancelRequest;

export type HumanizeResponse =
  | { ok: true; result: HumanizeResult }
  | { ok: false; kind: HumanizerErrorKind; message: string };

/** Streamed over a long-lived port to the popup. */
export type PortServerMessage =
  | { type: 'chunk'; id: string; textSoFar: string }
  | { type: 'done'; id: string; result: HumanizeResult }
  | { type: 'error'; id: string; kind: HumanizerErrorKind; message: string };

export const HUMANIZE_PORT = 'humanize';

export function isHumanizeRequest(msg: unknown): msg is HumanizeRequest {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return (
    m['type'] === 'humanize' &&
    typeof m['id'] === 'string' &&
    typeof m['text'] === 'string' &&
    (m['intensity'] === 'light' || m['intensity'] === 'full')
  );
}

export function isCancelRequest(msg: unknown): msg is CancelRequest {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return m['type'] === 'cancel' && typeof m['id'] === 'string';
}

/**
 * Popup to content-script messages, sent with chrome.tabs.sendMessage straight to
 * the active tab. The content script is a thin service now: it hands over the
 * selection, writes a rewrite back into it, and can undo that write.
 */
export interface CaptureRequest {
  type: 'capture';
}

export interface ApplyRequest {
  type: 'apply';
  text: string;
}

export interface UndoRequest {
  type: 'undo';
}

export type PageRequest = CaptureRequest | ApplyRequest | UndoRequest;

export type CaptureResponse =
  | { ok: true; text: string; canApply: boolean }
  | { ok: false; reason: 'none' | 'sensitive' };

export type ApplyResponse = { ok: boolean };

/**
 * Validate what came back from the page. The background has to tell three
 * outcomes apart: the page answered with text, the page answered that it will
 * not hand any over, and the page never answered at all. Only the first two
 * mean the credential guard and the per-site switch actually ran.
 */
export function isCaptureResponse(msg: unknown): msg is CaptureResponse {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  if (m['ok'] === true) return typeof m['text'] === 'string' && typeof m['canApply'] === 'boolean';
  if (m['ok'] === false) return m['reason'] === 'none' || m['reason'] === 'sensitive';
  return false;
}

export function isCaptureRequest(msg: unknown): msg is CaptureRequest {
  return isTagged(msg, 'capture');
}

export function isUndoRequest(msg: unknown): msg is UndoRequest {
  return isTagged(msg, 'undo');
}

export function isApplyRequest(msg: unknown): msg is ApplyRequest {
  if (!isTagged(msg, 'apply')) return false;
  return typeof (msg as Record<string, unknown>)['text'] === 'string';
}

function isTagged(msg: unknown, type: string): boolean {
  if (typeof msg !== 'object' || msg === null) return false;
  return (msg as Record<string, unknown>)['type'] === type;
}

/** Storage key holding text handed from a page selection to the popup. */
export const PENDING_KEY = 'pendingSelection';

/**
 * How long parked text stays good for. Long enough to cover a slow popup open,
 * short enough that a selection nobody read cannot resurface days later and
 * rewrite itself in a popup the user opened for something else.
 */
export const PENDING_TTL_MS = 60_000;

/**
 * What a right click hands to the popup. A refusal is parked too, so the popup
 * can say why it has nothing instead of sitting there empty.
 */
export type PendingSelection =
  | {
      kind: 'text';
      text: string;
      /** False when the text came from somewhere the popup cannot write back to. */
      canApply: boolean;
      tabId: number;
      at: number;
    }
  | { kind: 'refused'; reason: PendingRefusal; at: number };

export type PendingRefusal =
  /** Nothing was selected. */
  | 'none'
  /** A password, payment, or one-time-code field. Never captured. */
  | 'sensitive'
  /** The page never answered: turned off for this site, restricted, or still loading. */
  | 'unavailable';

export function isPendingSelection(value: unknown): value is PendingSelection {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v['at'] !== 'number') return false;
  if (v['kind'] === 'text') {
    return typeof v['text'] === 'string' && typeof v['canApply'] === 'boolean' && typeof v['tabId'] === 'number';
  }
  if (v['kind'] === 'refused') {
    return v['reason'] === 'none' || v['reason'] === 'sensitive' || v['reason'] === 'unavailable';
  }
  return false;
}

export function isPendingFresh(pending: PendingSelection, now: number): boolean {
  const age = now - pending.at;
  // A clock that jumped backwards must not make stale text look fresh forever.
  return age >= 0 && age <= PENDING_TTL_MS;
}
