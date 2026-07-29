import type { HumanizeOptions, HumanizeResult, Provider } from '../shared/types';
import { HumanizerError } from '../shared/types';
import { diffChanges } from '../shared/diff';
import { checkFidelity } from '../shared/fidelity';
import { applyFixes, customRules, detect } from './rules';
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
    throw new HumanizerError('too-long', 'Selection is too long for this engine. Split it or add an API key.');
  }

  const extraRules = customRules(opts.customTells ?? []);
  const tells = detect(text, extraRules);
  const provider = await firstAvailable(deps.providers);

  if (!provider) {
    const rewritten = applyFixes(text);
    return {
      rewritten,
      changes: diffChanges(text, rewritten, tells),
      engine: { kind: 'rules' },
      tells: { before: tells.length, after: detect(rewritten, extraRules).length },
      fidelity: checkFidelity(text, rewritten),
    };
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
  if (text.trim() && !rewritten.trim()) {
    throw new HumanizerError('internal', 'The model returned an empty rewrite. Try again.');
  }
  return {
    rewritten,
    changes: diffChanges(text, rewritten, tells),
    engine: provider.info,
    tells: { before: tells.length, after: detect(rewritten, extraRules).length },
    fidelity: checkFidelity(text, rewritten),
  };
}

/** Models wrap output despite instructions; peel fences, preambles, and quotes the original did not have. */
export function stripWrapping(raw: string, original: string): string {
  let out = raw.trim();
  const orig = original.trim();
  const fenceRe = /^```[a-z]*\n([\s\S]*?)\n?```$/i;
  const fence = out.match(fenceRe);
  if (fence && !fenceRe.test(orig)) out = fence[1]!.trim();
  const preambleRe = /^here(?:'s| is)[^\n:]{0,60}:\s*/i;
  if (!preambleRe.test(orig)) out = out.replace(preambleRe, '');
  const wrapped = /^"[\s\S]*"$/.test(out) && !/^"[\s\S]*"$/.test(orig);
  if (wrapped) out = out.slice(1, -1).trim();
  return out;
}

async function firstAvailable(providers: Provider[]): Promise<Provider | null> {
  for (const provider of providers) {
    try {
      if (await provider.available()) return provider;
    } catch {
      // A throwing probe means unavailable; fall through to the next provider.
    }
  }
  return null;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new HumanizerError('aborted');
}
