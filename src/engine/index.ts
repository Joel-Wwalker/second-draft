import type { HumanizeOptions, HumanizeResult, Provider } from '../shared/types';
import { HumanizerError } from '../shared/types';
import { diffChanges } from '../shared/diff';
import { checkFidelity } from '../shared/fidelity';
import type { FidelityIssue } from '../shared/fidelity';
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
      retried: false,
    };
  }

  const systemPrompt = buildSystemPrompt({
    intensity: opts.intensity,
    tells,
    voiceSample: opts.voiceSample,
    target: provider.info.kind === 'nano' ? 'nano' : 'byok',
  });

  const attempt = async (prompt: string, onChunk?: (textSoFar: string) => void): Promise<Attempt> => {
    let raw: string;
    try {
      raw = await provider.rewrite({ text, systemPrompt: prompt, signal: opts.signal, onChunk });
    } catch (err) {
      throw err instanceof HumanizerError ? err : new HumanizerError('internal', String(err));
    }
    throwIfAborted(opts.signal);
    const rewritten = applyFixes(stripWrapping(raw, text));
    if (text.trim() && !rewritten.trim()) {
      throw new HumanizerError('internal', 'The model returned an empty rewrite. Try again.');
    }
    return { rewritten, fidelity: checkFidelity(text, rewritten) };
  };

  let best = await attempt(systemPrompt, opts.onChunk);
  let retried = false;

  // A rewrite that dropped facts gets one silent second pass, told exactly what
  // it lost. One retry only: the on-device model is slow enough that a third
  // attempt costs more waiting than it tends to buy.
  if (best.fidelity.length > 0) {
    throwIfAborted(opts.signal);
    const lost = best.fidelity.map(issue => issue.message).join(' ');
    try {
      const second = await attempt(
        `${systemPrompt}

A previous attempt lost content. ${lost} Keep every number, name, date, place, and quotation from the original text this time.`,
      );
      retried = true;
      if (second.fidelity.length < best.fidelity.length) best = second;
    } catch (err) {
      // A retry that fails must not be worse than no retry. The first rewrite
      // is finished and usable; keep it, and let the caller show what is
      // missing from it. An abort is the exception, since the caller asked.
      if (err instanceof HumanizerError && err.kind === 'aborted') throw err;
    }
  }

  return {
    rewritten: best.rewritten,
    changes: diffChanges(text, best.rewritten, tells),
    engine: provider.info,
    tells: { before: tells.length, after: detect(best.rewritten, extraRules).length },
    fidelity: best.fidelity,
    retried,
  };
}

interface Attempt {
  rewritten: string;
  fidelity: FidelityIssue[];
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
