import type { DetectedTell, HumanizeOptions, HumanizeResult, Provider } from '../shared/types';
import { HumanizerError } from '../shared/types';
import { diffChanges } from '../shared/diff';
import { checkFidelity } from '../shared/fidelity';
import type { FidelityIssue } from '../shared/fidelity';
import { cadenceInstruction, isFlat, measureCadence } from '../shared/cadence';
import { dictionInstruction, isOverwrought, measureDiction, vocabularyDrift } from '../shared/diction';
import { applyFixes, customRules, detect } from './rules';
import { RESTRUCTURE_PROMPT, buildSystemPrompt, describeTells } from './prompts';

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

  // Nothing to fix, so fix nothing. A review of 114 rewrites found the engine
  // rewriting clean input anyway and making it worse: with no tell to remove it
  // fell back on its default moves and manufactured new ones, which is where two
  // of the three tell-count regressions came from. Reading like a person already
  // is the goal, not an input to be processed.
  // Zero tells, not merely few, and only when the text is long enough for the
  // style checks to have an opinion: on a short selection they return nothing
  // because they cannot judge, which is not the same as nothing being wrong.
  if (tells.length === 0 && measureCadence(text) !== null && !styleNotes(text)) {
    return {
      rewritten: text,
      changes: [],
      engine: provider.info,
      tells: { before: tells.length, after: tells.length },
      fidelity: [],
      retried: false,
    };
  }

  // Shape first, on flat text only, and against the original. What comes back is
  // what the register pass rewrites; everything downstream still measures against
  // the text the user actually selected.
  const shaped = await reshape(text, provider, opts);

  // Rhythm and shape are measured, not requested. The prompt has asked for varied
  // sentences since the first version and models flatten them anyway.
  // What the register pass is working from. Identical to the input unless the
  // shaping pass ran and proved it helped, so every comparison below that judges
  // this pass judges it against what it was actually handed.
  const shapedTells = detect(shaped, extraRules);
  const systemPrompt = buildSystemPrompt({
    intensity: opts.intensity,
    tells: shapedTells,
    voiceSample: opts.voiceSample,
    target: provider.info.kind === 'nano' ? 'nano' : 'byok',
    cadence: styleNotes(shaped) || undefined,
    text: shaped,
  });

  const attempt = async (prompt: string, onChunk?: (textSoFar: string) => void): Promise<Attempt> => {
    let raw: string;
    try {
      raw = await provider.rewrite({ text: shaped, systemPrompt: prompt, signal: opts.signal, onChunk });
    } catch (err) {
      throw err instanceof HumanizerError ? err : new HumanizerError('internal', String(err));
    }
    throwIfAborted(opts.signal);
    const rewritten = applyFixes(stripAddedQuotes(stripWrapping(raw, shaped), shaped));
    if (text.trim() && !rewritten.trim()) {
      throw new HumanizerError('internal', 'The model returned an empty rewrite. Try again.');
    }
    return {
      rewritten,
      // Fidelity and drift answer to the text the user selected, not to the
      // shaping pass's output. A fact lost in shaping must still be reported,
      // and vocabulary is measured against what arrived.
      fidelity: checkFidelity(text, rewritten),
      style: styleNotes(rewritten),
      drift: vocabularyDrift(text, rewritten),
      remaining: detect(rewritten, extraRules),
      noop: isNoOp(rewritten, shaped),
    };
  };

  let best = await attempt(systemPrompt, opts.onChunk);
  let retried = false;

  // One silent second pass, told exactly what went wrong. Four triggers, each a
  // thing the first pass was asked to get right and did not: content it dropped,
  // a rhythm it flattened, vocabulary it made heavier, or detected tells it left
  // standing without fixing a single one. The last trigger is the Roman Empire
  // case: two rule-of-three lists in, the same two out, and a score of three to
  // three shown to the user while our one retry went unused on them. One retry
  // only, because the on-device model is slow enough that a third attempt costs
  // more waiting than it tends to buy.
  const noTellProgress = best.remaining.length >= shapedTells.length && best.remaining.length > 0;
  // A tell the input never had is a regression even when the total count fell.
  // The review found four rewrites that were handed clean prose and wrote "not
  // just X, it's Y" into it; each had removed enough other tells that the count
  // dropped and the retry never ran. Introducing a tell is worse than leaving
  // one, because the writer did not put it there.
  const introduced = introducedTells(shapedTells, best.remaining);
  if (best.fidelity.length > 0 || best.style || best.drift || noTellProgress || best.noop || introduced.length > 0) {
    throwIfAborted(opts.signal);
    const notes: string[] = [];
    if (best.noop) {
      notes.push(
        'A previous attempt returned the text exactly as it arrived. That is a failure, not a judgment that the text was already fine. Change the structure this time: split a long sentence, join two short ones, or move a clause to the front.',
      );
    }
    if (best.fidelity.length > 0) {
      const lost = best.fidelity.map(issue => issue.message).join(' ');
      notes.push(
        `A previous attempt lost content. ${lost} Keep every number, name, date, place, and quotation from the original text this time.`,
      );
    }
    if (best.style) {
      notes.push(`A previous attempt still read machine-made. ${best.style}`);
    }
    if (best.drift) {
      notes.push(best.drift);
    }
    if (introduced.length > 0) {
      notes.push(
        `Your rewrite added something the original did not have: ${describeTells(introduced)}. You wrote that, so do not write it again.`,
      );
    }
    if (best.remaining.length > 0) {
      notes.push(`Your rewrite still contains: ${describeTells(best.remaining)}. Fix these this time.`);
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
      // Flat rhythm and heavier-than-input vocabulary count as tells. Leaving
      // style out is why an evenly paced rewrite used to score well and still
      // read like a machine wrote it.
      before: tells.length + (styleNotes(text) ? 1 : 0),
      after: best.remaining.length + (best.style ? 1 : 0) + (best.drift ? 1 : 0),
    },
    fidelity: best.fidelity,
    retried,
  };
}

/**
 * What is wrong with this text's sentences, as an instruction a model can act on.
 * Empty when nothing is, or when the text is too short to judge.
 *
 * Only sentence length is measured here. An earlier version also required that
 * sentences vary how they open, and a run over 1000 human-written paragraphs
 * against 60 model-written ones showed why that was wrong: the opening-variety
 * rule flagged 57.6% of the human prose, and the repeated-opener rule was
 * backwards, firing on 39.6% of human paragraphs and 3.3% of machine ones,
 * because people repeat a sentence opening far more often than a model does.
 *
 * Sentence length spread separates the two cleanly. Nothing else tested did.
 */
export function styleNotes(text: string): string {
  const cadence = measureCadence(text);
  const diction = measureDiction(text);
  const flat = cadence !== null && isFlat(cadence);
  const heavy = diction !== null && isOverwrought(diction);
  if (!flat && !heavy) return '';

  const notes: string[] = [];
  if (flat) notes.push(cadenceInstruction(cadence));
  if (heavy) notes.push(dictionInstruction(diction));

  // Name what is already good, or the model trades it away. Told only to vary
  // sentence openings once, Nano did that and flattened lengths that had been
  // fine, taking the spread from 0.30 to 0.16.
  if (!flat && cadence) {
    notes.push(
      `The sentence lengths here already vary: ${cadence.lengths.join(', ')} words. Keep a spread like that while changing anything else.`,
    );
  }
  if (!heavy && diction) {
    notes.push('The word choice here is already plain. Keep it plain while changing anything else.');
  }
  return notes.join(' ');
}

/**
 * Losing content is worse than any style problem, so fidelity decides first.
 * Then fewer style problems, then fewer surviving tells. A second pass that
 * fixes the pacing but drops a date is not an improvement.
 */
function isBetter(candidate: Attempt, incumbent: Attempt): boolean {
  if (candidate.fidelity.length !== incumbent.fidelity.length) {
    return candidate.fidelity.length < incumbent.fidelity.length;
  }
  // Three bands, worst first. Drift is "you handed back something worse than
  // arrived", a no-op is "you handed back nothing", and style is "this is still
  // not very good". The first two are failures against the input and outrank the
  // third, which is a judgment about quality in the abstract.
  //
  // Ordering learned the hard way. Style and drift were scored together and
  // no-ops ranked below the pair, so an attempt that changed nothing scored zero
  // and beat any genuine rewrite carrying a single style note. A hundred-pair
  // run came back with ten unchanged rewrites, nine of which had retried and had
  // their retry discarded here. Splitting the two puts drift above the no-op,
  // which keeps a plain text intact rather than accepting an inflated rewrite,
  // and style below it, so nothing beats a real attempt by declining to make one.
  const worse = (a: Attempt, b: Attempt, score: (x: Attempt) => number): boolean | null =>
    score(a) === score(b) ? null : score(a) < score(b);

  const byDrift = worse(candidate, incumbent, a => (a.drift ? 1 : 0));
  if (byDrift !== null) return byDrift;
  if (candidate.noop !== incumbent.noop) return incumbent.noop;
  const byStyle = worse(candidate, incumbent, a => (a.style ? 1 : 0));
  if (byStyle !== null) return byStyle;
  return candidate.remaining.length < incumbent.remaining.length;
}

interface Attempt {
  rewritten: string;
  fidelity: FidelityIssue[];
  /** styleNotes for this rewrite; empty means pacing and weight are fine. */
  style: string;
  /** vocabularyDrift against the input; empty means no heavier than it arrived. */
  drift: string;
  /** Detected tells still present in the rewrite. */
  remaining: DetectedTell[];
  /** The model handed the text back; see isNoOp. */
  noop: boolean;
}

/**
 * A first pass that only changes where sentences break, for text that arrived
 * flat. Returns the original unchanged whenever it cannot prove it helped.
 *
 * Every exit here is the original text. A shaping pass that loses a date, drops a
 * word, throws, or fails to widen the spread it was called to widen has earned
 * nothing, and the register pass that follows is perfectly capable on its own.
 * The cost is one extra model call on the 29% of paragraphs measured as flat, and
 * nothing at all on the rest.
 */
async function reshape(
  text: string,
  provider: Provider,
  opts: HumanizeOptions,
): Promise<string> {
  const cadence = measureCadence(text);
  if (!cadence || !isFlat(cadence)) return text;
  try {
    const raw = await provider.rewrite({
      text,
      systemPrompt: `${RESTRUCTURE_PROMPT}\n\n${cadenceInstruction(cadence)}`,
      signal: opts.signal,
    });
    throwIfAborted(opts.signal);
    const shaped = applyFixes(stripAddedQuotes(stripWrapping(raw, text), text));
    if (!shaped.trim()) return text;
    // Shape is worth nothing at the cost of a fact.
    if (checkFidelity(text, shaped).length > 0) return text;
    const after = measureCadence(shaped);
    // It had one job. Keeping a pass that did not do it would trade the register
    // pass's input for no gain, and this pass is not allowed to cost anything.
    if (!after || after.spread <= cadence.spread) return text;
    return shaped;
  } catch (err) {
    if (err instanceof HumanizerError && err.kind === 'aborted') throw err;
    return text;
  }
}

/**
 * Tells present in the rewrite whose kind the input never had.
 *
 * By rule id rather than by count, because a text that arrived with one
 * rule-of-three list and left with one has not been made worse, while a text
 * that arrived with none and left with one has. Returns the offending matches
 * themselves so the retry can quote them back.
 */
export function introducedTells(before: DetectedTell[], after: DetectedTell[]): DetectedTell[] {
  const had = new Set(before.map(tell => tell.ruleId));
  return after.filter(tell => !had.has(tell.ruleId));
}

/**
 * Did the model return the text it was given?
 *
 * Not a byte comparison, because the mechanical fixes run before this and a
 * model that changes nothing still gets its curly quotes straightened on the way
 * out. Two rewrites in a hundred came back this way and were counted as changed
 * on the strength of an apostrophe. Case and run-length whitespace are folded in
 * for the same reason: neither is a rewrite.
 */
function isNoOp(rewritten: string, original: string): boolean {
  const normalize = (value: string): string =>
    value
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  return normalize(rewritten) === normalize(original);
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
