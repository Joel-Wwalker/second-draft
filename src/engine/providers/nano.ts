import type { EngineInfo, Provider, RewriteRequest } from '../../shared/types';
import { HumanizerError } from '../../shared/types';

export const NANO_CHUNK_CHARS = 4000;

/**
 * What this context's Prompt API says about the on-device model, as a string
 * that never throws. 'no-api' when the global is missing entirely, 'error' when
 * asking it failed; otherwise Chrome's own availability value.
 *
 * Exists because contexts disagree. The options page asked its own window,
 * showed "Ready", and the engine meanwhile ran in the service worker, where the
 * answer decides between a real rewrite and the rules fallback. Whoever wants
 * to display engine status must ask the engine's context, and this is the
 * question they send.
 */
export async function nanoAvailability(): Promise<string> {
  if (typeof LanguageModel === 'undefined' || !LanguageModel) return 'no-api';
  try {
    return await LanguageModel.availability();
  } catch {
    return 'error';
  }
}

/** Chrome's on-device Gemini Nano via the Prompt API (extension SW context). */
export class NanoProvider implements Provider {
  readonly info: EngineInfo = { kind: 'nano' };

  async available(): Promise<boolean> {
    return (await nanoAvailability()) === 'available';
  }

  async rewrite(req: RewriteRequest): Promise<string> {
    if (typeof LanguageModel === 'undefined' || !LanguageModel) {
      throw new HumanizerError('nano-unavailable', 'On-device AI is not supported by this browser.');
    }
    throwIfAborted(req.signal);
    const chunks = chunkText(req.text, NANO_CHUNK_CHARS);
    const outputs: string[] = [];
    for (const chunk of chunks) {
      throwIfAborted(req.signal);
      // Fresh session per chunk: reuse would treat prior chunks as conversation turns.
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
      } finally {
        session.destroy();
      }
    }
    return outputs.join('\n\n');
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
