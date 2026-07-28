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
  /** Indexes into the original text (zero-width for pure insertions). */
  from?: Span;
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
  /** User-defined phrases to flag as tells, in addition to the built-in rules. */
  customTells?: string[];
  signal?: AbortSignal;
  /** Called with the full text so far as the provider streams. Provisional display only. */
  onChunk?: (textSoFar: string) => void;
}

export interface HumanizeResult {
  rewritten: string;
  changes: Change[];
  engine: EngineInfo;
  /** Detected AI-tell counts before and after the rewrite. */
  tells: { before: number; after: number };
}

export interface ScanSummary {
  /** Total detected tells across every scanned block. */
  tells: number;
  /** Number of blocks that met the length gate and were actually scanned (0-tell blocks count). */
  blocks: number;
  /**
   * True when the CSS Custom Highlight API was available this run, so hits were visually
   * marked on the page, not merely counted. False means the runtime lacks that API (a known
   * jsdom-test limit; real support started in Chrome 105, well under this extension's
   * minimum_chrome_version), and the popup must say so rather than implying marks appeared.
   */
  highlightsSupported: boolean;
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
