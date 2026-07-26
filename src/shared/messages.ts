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
