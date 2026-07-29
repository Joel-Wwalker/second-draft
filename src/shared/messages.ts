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

/** Streamed over a long-lived port to the content-script card. */
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

export interface PendingSelection {
  text: string;
  /** False when the text came from somewhere the popup cannot write back to. */
  canApply: boolean;
  tabId: number;
}
