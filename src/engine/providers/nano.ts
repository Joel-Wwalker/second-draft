import type { EngineInfo, Provider, RewriteRequest } from '../../shared/types';
import { HumanizerError } from '../../shared/types';

export const NANO_CHUNK_CHARS = 4000;

/** Chrome's on-device Gemini Nano via the Prompt API (extension SW context). */
export class NanoProvider implements Provider {
  readonly info: EngineInfo = { kind: 'nano', model: 'gemini-nano' };

  async available(): Promise<boolean> {
    if (typeof LanguageModel === 'undefined' || !LanguageModel) return false;
    try {
      return (await LanguageModel.availability()) === 'available';
    } catch {
      return false;
    }
  }

  async rewrite(req: RewriteRequest): Promise<string> {
    if (typeof LanguageModel === 'undefined' || !LanguageModel) {
      throw new HumanizerError('nano-unavailable', 'On-device AI is not supported by this browser.');
    }
    throwIfAborted(req.signal);
    let session: LanguageModelSession;
    try {
      session = await LanguageModel.create({
        initialPrompts: [{ role: 'system', content: req.systemPrompt }],
        signal: req.signal,
      });
    } catch (err) {
      throw abortOr(err, new HumanizerError('nano-unavailable', 'Could not start the on-device model.'));
    }
    try {
      const chunks = chunkText(req.text, NANO_CHUNK_CHARS);
      const outputs: string[] = [];
      for (const chunk of chunks) {
        throwIfAborted(req.signal);
        const prefix = outputs.length > 0 ? `${outputs.join('\n\n')}\n\n` : '';
        let chunkOut = '';
        const stream = session.promptStreaming(chunk, { signal: req.signal });
        const reader = stream.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunkOut = accumulate(chunkOut, value);
            req.onChunk?.(prefix + chunkOut);
          }
        } catch (err) {
          throw abortOr(err, new HumanizerError('internal', 'On-device rewrite failed.'));
        } finally {
          reader.releaseLock();
        }
        outputs.push(chunkOut.trim());
      }
      return outputs.join('\n\n');
    } finally {
      session.destroy();
    }
  }
}

/**
 * Streamed values may be deltas or cumulative snapshots; normalize to cumulative.
 * Known edge (accepted): a true delta that itself starts with the entire
 * previous text is misread as a cumulative snapshot.
 */
export function accumulate(prev: string, next: string): string {
  return next.startsWith(prev) ? next : prev + next;
}

/**
 * Split into chunks whose concatenation equals the input. Prefers paragraph
 * boundaries; hard-splits any piece that would push a chunk past max,
 * regardless of where it falls.
 */
export function chunkText(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const pieces = text.split(/(\n{2,})/);
  const chunks: string[] = [];
  let current = '';
  const flush = (): void => {
    if (current.length > 0) {
      chunks.push(current);
      current = '';
    }
  };
  for (const piece of pieces) {
    if (current.length > 0 && current.length + piece.length > max) flush();
    current += piece;
    while (current.length > max) {
      chunks.push(current.slice(0, max));
      current = current.slice(max);
    }
  }
  flush();
  return chunks;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new HumanizerError('aborted');
}

function abortOr(err: unknown, fallback: HumanizerError): HumanizerError {
  if (err instanceof HumanizerError) return err;
  if (err instanceof DOMException && err.name === 'AbortError') return new HumanizerError('aborted');
  return fallback;
}
