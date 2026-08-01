/**
 * Ambient types for Chrome's built-in Prompt API (Gemini Nano), stable for
 * extensions since Chrome 138. Feature-detect with `typeof LanguageModel`.
 */
type LanguageModelAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

interface LanguageModelPromptOptions {
  signal?: AbortSignal;
}

interface LanguageModelSession {
  prompt(input: string, options?: LanguageModelPromptOptions): Promise<string>;
  promptStreaming(input: string, options?: LanguageModelPromptOptions): ReadableStream<string>;
  destroy(): void;
}

/** Declared per request; Chrome warns on, and may refuse, unattested output. */
interface LanguageModelExpected {
  readonly type: 'text';
  readonly languages: readonly string[];
}

interface LanguageModelCreateOptions {
  initialPrompts?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  expectedInputs?: readonly LanguageModelExpected[];
  expectedOutputs?: readonly LanguageModelExpected[];
  signal?: AbortSignal;
  monitor?(monitor: EventTarget): void;
}

interface LanguageModelStatic {
  availability(
    options?: Pick<LanguageModelCreateOptions, 'expectedInputs' | 'expectedOutputs'>,
  ): Promise<LanguageModelAvailability>;
  create(options?: LanguageModelCreateOptions): Promise<LanguageModelSession>;
}

// eslint-disable-next-line no-var
declare var LanguageModel: LanguageModelStatic | undefined;
