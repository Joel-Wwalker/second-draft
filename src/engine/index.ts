import type { HumanizeOptions, HumanizeResult, Provider } from '../shared/types';
import { HumanizerError } from '../shared/types';
import { diffChanges } from '../shared/diff';
import { checkFidelity } from '../shared/fidelity';
import type { FidelityIssue } from '../shared/fidelity';
import { cadenceInstruction, isFlat, measureCadence } from '../shared/cadence';
import { isMonotonous, measureStructure, structureInstruction } from '../shared/structure';
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

  // Rhythm and shape are measured, not requested. The prompt has asked for varied
  // sentences since the first version and models flatten them anyway.
  const systemPrompt = buildSystemPrompt({
    intensity: opts.intensity,
    tells,
    voiceSample: opts.voiceSample,
    target: provider.info.kind === 'nano' ? 'nano' : 'byok',
    cadence: styleNotes(text) || undefined,
  });

  const stillFlat = (rewritten: string): boolean => styleNotes(rewritten).length > 0;

  const attempt = async (prompt: string, onChunk?: (textSoFar: string) => void): Promise<Attempt> => {
    let raw: string;
    try {
      raw = await provider.rewrite({ text, systemPrompt: prompt, signal: opts.signal, onChunk });
    } catch (err) {
      throw err instanceof HumanizerError ? err : new HumanizerError('internal', String(err));
    }
    throwIfAborted(opts.signal);
    const rewritten = applyFixes(stripAddedQuotes(stripWrapping(raw, text), text));
    if (text.trim() && !rewritten.trim()) {
      throw new HumanizerError('internal', 'The model returned an empty rewrite. Try again.');
    }
    return { rewritten, fidelity: checkFidelity(text, rewritten), flat: stillFlat(rewritten) };
  };

  let best = await attempt(systemPrompt, opts.onChunk);
  let retried = false;

  // One silent second pass, told exactly what went wrong, for either of the two
  // things the first pass was asked to get right and did not: content it dropped,
  // or a rhythm it flattened. One retry only, because the on-device model is slow
  // enough that a third attempt costs more waiting than it tends to buy.
  if (best.fidelity.length > 0 || best.flat) {
    throwIfAborted(opts.signal);
    const notes: string[] = [];
    if (best.fidelity.length > 0) {
      const lost = best.fidelity.map(issue => issue.message).join(' ');
      notes.push(
        `A previous attempt lost content. ${lost} Keep every number, name, date, place, and quotation from the original text this time.`,
      );
    }
    const styleNow = styleNotes(best.rewritten);
    if (best.flat && styleNow) {
      notes.push(`A previous attempt came back with sentences that were all built the same way. ${styleNow}`);
    }
    const corrections = notes.join('\n\n');
    try {
      // The second pass is not shown as it arrives, because a display that jumped
      // back to a half-finished rewrite would read as starting over. It still has
      // to be audible: a caller timing out on silence would otherwise cancel a
      // rewrite that has already succeeded. Each chunk re-sends the text we would
      // keep if this pass came to nothing, so the view holds still and stays live.
      const keepAlive = opts.onChunk;
      const second = await attempt(
        `${systemPrompt}\n\n${corrections}`,
        keepAlive && (() => keepAlive(best.rewritten)),
      );
      retried = true;
      if (isBetter(second, best)) best = second;
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
    tells: {
      // Flat rhythm counts as a tell. Leaving it out is why an evenly paced
      // rewrite used to score well and still read like a machine wrote it.
      before: tells.length + (styleNotes(text) ? 1 : 0),
      after: detect(best.rewritten, extraRules).length + (best.flat ? 1 : 0),
    },
    fidelity: best.fidelity,
    retried,
  };
}

/**
 * What is wrong with this text's sentences, as instructions a model can act on.
 * Empty when nothing is, or when the text is too short to judge.
 *
 * Two separate failures, because fixing the first exposed the second: sentences
 * that all run the same length, and sentences that all open the same way. A model
 * given only the length target produced varied lengths and identical shapes.
 */
function styleNotes(text: string): string {
  const notes: string[] = [];
  const cadence = measureCadence(text);
  if (cadence && isFlat(cadence)) notes.push(cadenceInstruction(cadence));
  const structure = measureStructure(text);
  if (structure && isMonotonous(structure)) notes.push(structureInstruction(structure));
  return notes.join(' ');
}

/**
 * Losing content is worse than keeping a flat rhythm, so fidelity decides first
 * and rhythm only breaks a tie. A second pass that fixes the pacing but drops a
 * date is not an improvement.
 */
function isBetter(candidate: Attempt, incumbent: Attempt): boolean {
  if (candidate.fidelity.length !== incumbent.fidelity.length) {
    return candidate.fidelity.length < incumbent.fidelity.length;
  }
  return !candidate.flat && incumbent.flat;
}

interface Attempt {
  rewritten: string;
  fidelity: FidelityIssue[];
  /** The rewrite came back with one sentence length repeated. */
  flat: boolean;
}

const DOUBLE_QUOTE = /["“”]/;

/**
 * Models like to put quotation marks around a sentence or two, which turns a
 * plain statement into something that reads as a quotation of someone. Gemini
 * Nano did exactly that on the first real run: a paragraph about Helen of Troy
 * came back with its opening sentence quoted.
 *
 * `stripWrapping` cannot catch it, because the quotes wrap part of the output
 * rather than all of it. The reliable signal is the original: if it contains no
 * double quotation marks at all, then none in the rewrite can be preserving
 * anything, so all of them are invention. When the original does quote
 * something, leave every mark alone rather than guess which are which.
 */
export function stripAddedQuotes(out: string, original: string): string {
  // Nothing quoted anything, so every mark in the rewrite is invention.
  if (!DOUBLE_QUOTE.test(original)) return out.replace(/["“”]/g, '');

  // The original does quote something, so most marks are real and guessing which
  // is which would destroy meaning. One case is still safe to call: a rewrite
  // that opens with a quotation mark when the original does not is the model
  // handing back "the text you asked for", quoted. Drop that pair and no others.
  const opensQuoted = (text: string): boolean => DOUBLE_QUOTE.test(text.trimStart().charAt(0));
  if (opensQuoted(original) || !opensQuoted(out)) return out;

  const open = out.search(/["“”]/);
  const rest = out.slice(open + 1).search(/["“”]/);
  if (rest === -1) return out.slice(0, open) + out.slice(open + 1); // unbalanced; drop the stray
  const close = open + 1 + rest;
  return out.slice(0, open) + out.slice(open + 1, close) + out.slice(close + 1);
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
