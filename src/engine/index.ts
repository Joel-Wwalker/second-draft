import type { HumanizeOptions, HumanizeResult, Provider } from '../shared/types';
import { HumanizerError } from '../shared/types';
import { diffChanges } from '../shared/diff';
import { applyFixes, detect } from './rules';
import { buildSystemPrompt } from './prompts';

const MAX_INPUT_CHARS = 50_000;

export interface EngineDeps {
  /** Ordered by preference; first available provider wins. */
  providers: Provider[];
}

export async function humanize(
  text: string,
  opts: HumanizeOptions,
  deps: EngineDeps,
): Promise<HumanizeResult> {
  throwIfAborted(opts.signal);
  if (text.length > MAX_INPUT_CHARS) {
    throw new HumanizerError('too-long', `Input is ${text.length} chars; max is ${MAX_INPUT_CHARS}.`);
  }

  const tells = detect(text);
  const provider = await firstAvailable(deps.providers);

  if (!provider) {
    const rewritten = applyFixes(text);
    return { rewritten, changes: diffChanges(text, rewritten, tells), engine: { kind: 'rules' } };
  }

  const systemPrompt = buildSystemPrompt({
    intensity: opts.intensity,
    tells,
    voiceSample: opts.voiceSample,
    target: provider.info.kind === 'nano' ? 'nano' : 'byok',
  });

  let raw: string;
  try {
    raw = await provider.rewrite({
      text,
      systemPrompt,
      signal: opts.signal,
      onChunk: opts.onChunk,
    });
  } catch (err) {
    throw err instanceof HumanizerError ? err : new HumanizerError('internal', String(err));
  }

  throwIfAborted(opts.signal);
  const rewritten = applyFixes(stripWrapping(raw, text));
  return { rewritten, changes: diffChanges(text, rewritten, tells), engine: provider.info };
}

/** Models wrap output despite instructions; peel fences, preambles, and quotes. */
export function stripWrapping(raw: string, original: string): string {
  let out = raw.trim();
  const fence = out.match(/^```[a-z]*\n([\s\S]*?)\n?```$/i);
  if (fence) out = fence[1]!.trim();
  out = out.replace(/^here(?:'s| is)[^\n:]{0,60}:\s*/i, '');
  const wrapped = /^"[\s\S]*"$/.test(out) && !/^"[\s\S]*"$/.test(original.trim());
  if (wrapped) out = out.slice(1, -1).trim();
  return out;
}

async function firstAvailable(providers: Provider[]): Promise<Provider | null> {
  for (const provider of providers) {
    if (await provider.available()) return provider;
  }
  return null;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new HumanizerError('aborted');
}
