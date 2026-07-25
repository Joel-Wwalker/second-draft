export type Intensity = 'light' | 'full';

export interface Span {
  start: number;
  end: number;
}

export interface DetectedTell {
  ruleId: string;
  span: Span;
  excerpt: string;
  reason: string;
}

export interface Change {
  /** Indexes into the rewritten text. */
  range: Span;
  ruleId?: string;
  reason: string;
}

export type EngineKind = 'nano' | 'byok' | 'rules' | 'fake';

export interface EngineInfo {
  kind: EngineKind;
  /** e.g. "claude-sonnet-5"; lets the UI name the model. */
  model?: string;
}

export interface HumanizeOptions {
  intensity: Intensity;
  voiceSample?: string;
  signal?: AbortSignal;
  /** Called with the full text so far as the provider streams. Provisional display only. */
  onChunk?: (textSoFar: string) => void;
}

export interface HumanizeResult {
  rewritten: string;
  changes: Change[];
  engine: EngineInfo;
}

export interface RewriteRequest {
  text: string;
  systemPrompt: string;
  signal?: AbortSignal;
  onChunk?: (textSoFar: string) => void;
}

export interface Provider {
  readonly info: EngineInfo;
  available(): Promise<boolean>;
  rewrite(req: RewriteRequest): Promise<string>;
}

export type HumanizerErrorKind =
  | 'nano-unavailable'
  | 'nano-downloading'
  | 'byok-auth'
  | 'byok-rate-limit'
  | 'network'
  | 'too-long'
  | 'aborted'
  | 'replace-failed'
  | 'internal';

export class HumanizerError extends Error {
  constructor(readonly kind: HumanizerErrorKind, message?: string) {
    super(message ?? kind);
    this.name = 'HumanizerError';
  }
}
