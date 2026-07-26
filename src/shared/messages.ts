import type { HumanizeResult, HumanizerErrorKind, Intensity } from './types';

export interface HumanizeRequest {
  type: 'humanize';
  text: string;
  intensity: Intensity;
}

export type BackgroundRequest = HumanizeRequest;

export type HumanizeResponse =
  | { ok: true; result: HumanizeResult }
  | { ok: false; kind: HumanizerErrorKind; message: string };
