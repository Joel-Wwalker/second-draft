import type { DetectedTell, Intensity } from '../shared/types';
import { RULES } from './rules';

const TELL_NAMES: Record<string, string> = {
  'em-dash': 'em dash',
  'en-dash-range': 'en dash range',
  'double-hyphen': 'double hyphen',
  'curly-quote-double': 'curly quotes',
  'curly-quote-single': 'curly apostrophe',
  emoji: 'emoji',
  'chatbot-signoff': 'chatbot filler phrase',
  'ai-vocab': 'AI-associated word',
  'negative-parallelism': 'negative parallelism',
  'rule-of-three': 'rule of three list',
  'title-case-heading': 'title-case heading',
  'bold-header-list': 'bolded list header',
};

const CONTRACT =
  'Rewrite the text the user sends. Output only the rewritten text: no preamble, no explanation, ' +
  'no code fences. Preserve the meaning, approximate length, paragraph breaks, ' +
  'and all facts. Leave text inside quotation marks exactly as written. ' +
  'Use no em dashes or en dashes: replace each with the punctuation its job needs, and never delete ' +
  'one and close the gap, which jams two clauses together. A dash setting off an aside, or renaming ' +
  'what comes before it, takes a comma or a colon, never a semicolon, because a semicolon needs a ' +
  'whole sentence on each side. Paired dashes become paired commas or brackets, and the words ' +
  'between them stay. Hyphens in compound words are not dashes: keep cost-effective, mid-15th, ' +
  'error-prone as they are. Semicolons, colons and brackets are not tells; leave them where they are.';

const LIGHT_CORE = `${CONTRACT}
Change as little as possible. Only fix these AI tells where they appear:
- Replace every em dash and en dash with a comma, period, or colon.
- Replace AI-flavored words (delve, tapestry, testament, underscore, showcase, pivotal, crucial, vibrant, foster, garner, interplay, intricate, enduring, moreover, furthermore, additionally) with plain everyday words.
- Remove chatbot filler such as "I hope this helps" or "Would you like me to".
- Straighten curly quotes and remove emoji.
Keep everything else exactly as written.`;

// The sentence-mixing, contraction, and concrete-wording instructions were
// informed by the lever taxonomy in harshaneel/humanize (MIT). Its
// perplexity-injection lever is deliberately not adopted: choosing deliberately
// unpredictable vocabulary lowers a detector score at the cost of readability,
// which is the opposite of this product's goal. The no-invented-details clause
// is ours, because asking a model for specificity invites fabrication.
const FULL_CORE = `${CONTRACT}
Rewrite so the text reads like a person wrote it, keeping the meaning and register:
- Cut inflation and promotion: stands as, testament to, renowned, must-visit.
- Replace AI-flavored words with plain ones, and never swap a plain word for a fancier one.
- Cut signposting, fake-candid openers, aphorism formulas, false ranges, hedging filler, and generic upbeat closers.
- Prefer doing-verbs to happening-verbs: called in, ground on, not prompted, resulted in.
- Prefer concrete wording to abstract wording.
- Drop tacked-on "-ing" analysis clauses (highlighting, reflecting) and add none.
- Unwind "not just X, it's Y" and every other negative parallelism into a direct claim. "Not merely" does not count, and do not write one that was not there.
- Replace vague attributions (experts argue, observers note) with direct statements, and never add one.
- Prefer plain is/are/has over serves as, boasts, features.
- Break up forced rule-of-three lists; two items or four are fine.
- Mix sentence lengths in both directions. Merge two related sentences into one
  longer one as often as you split a long one, because variety needs long
  sentences as much as it needs short ones. A paragraph chopped into a run of
  short sentences is its own AI tell: never leave three in a row at roughly the
  same length.
- Use contractions where the register allows them. Most people write "it's" and
  "does not" in the same paragraph.
- Keep every specific already in the text: names, numbers, dates, places, and
  invent no details that were not there.
Voice. The enemy is generic phrasing, not long words or short ones:
- Swap stock frames for concrete wording. "This led to a war that lasted ten
  years" reads generated; "the fight ground on for ten years" reads written.
  Formally: "conducted an analysis of the results" reads generated, "analyzed
  the results" reads written. Precision is the professional voice, so never
  trade a precise word for a vague plain one.
- A field's own vocabulary is precise, not jargon. Collective action, illuminated
  manuscripts, vassal states, common law and their like stay exactly as written.
  Explaining one into a description, "vassal states" into "states under
  Byzantine control", loses the meaning and reads more generated, not less.
- Never reach for how, things, problems, good, important, a lot, or a closer look
  where the original had a specific word. That is what a rewrite falls back on
  when it is avoiding the work, and a wall of it is the generic-language flag
  detectors score against. Plain is not vague.
- Never open two consecutive sentences with This, and never open with However.
Every rule above says which words to keep. None of them protects sentence shape, and shape is what has to change: keep the right words and rebuild the sentences around them. A paragraph that comes back with its wording defended and its sentences in the same order and the same lengths has not been rewritten.
Rewrite even when no listed tell appears: evenly paced prose where every sentence has the same shape is itself a tell. Change structure, not words: split a long sentence, join two short ones, move a clause to the front. Do not make it different by swapping words for synonyms; a plain accurate word is already finished. Match the register, because plain wording is not casual wording: add no chatty intensifiers like really or very to formal text. Returning the text unchanged is a failure, and so is the same structure with the words shuffled.`;

/**
 * Rules that defend something in the input, added only when that something is
 * actually there.
 *
 * Every one of these is a "keep" instruction, and a run of 100 rewrites showed
 * what a pile of them costs: told to keep terms of art, hedges, voice markers and
 * the strength of feeling, the model generalized to keeping the sentences too.
 * Bigram overlap with the source went from 0.45 to 0.62 and de-flattening
 * collapsed from 22 of 29 flat inputs to 5. Defending a hedge in a paragraph that
 * contains no hedge buys nothing and costs that.
 *
 * So each is gated on its own trigger. A history paragraph with no first person
 * and no hedging now carries neither rule, and the budget goes to the work the
 * paragraph actually needs.
 */
const CONDITIONAL_RULES: { when: RegExp; rule: string }[] = [
  {
    when: /\b(?:purported(?:ly)?|alleged(?:ly)?|attributed to|ostensibly|reportedly|arguably|apparently|seemingly|is said to|claims? to)\b/i,
    rule:
      'Keep every hedge as strong as it arrived. Purported, alleged, attributed to, ostensibly, ' +
      'reportedly and arguably are claims about evidence: drop one and you assert as fact what the ' +
      'writer would not.',
  },
  {
    when: /(?:^|[^\w'])(?:I|I'm|I've|my|me|we|our|us)(?:[^\w']|$)|\b(?:honestly|frankly)\b/i,
    rule:
      "Keep the writer's own voice. First person, informality and stated opinions are the writer, " +
      'not tells: never sand "honestly, I\'m impressed" into a neutral report. Honestly, frankly, ' +
      'I think and the intensifiers around them stay where they stand, mid-sentence as much as at ' +
      'the front. Feeling keeps its strength, so "the emotional toll was immense" does not become ' +
      '"I felt a lot" and a paragraph about grief must not come back reading like a condolence card.',
  },
];

/** The conditional rules this text earns, as prompt lines. */
export function preservationNotes(text: string): string[] {
  return CONDITIONAL_RULES.filter(entry => entry.when.test(text)).map(entry => entry.rule);
}

/**
 * How many offending words a tell may name before the list reads as a checklist.
 *
 * Six, and tested rather than assumed. Naming the words hands the model a mean of
 * 2.15 targets with a third of paragraphs getting three or more, which looked
 * like the reason it had stopped restructuring and started swapping words. Turning
 * naming off entirely left bigram overlap with the source at 0.385 against 0.381,
 * so it is not the cause, and naming is what made tells actually get fixed.
 */
const NAMED_TELL_LIMIT = 6;

/**
 * The shaping pass, for text measured as flat before anything else runs.
 *
 * Deliberately the shortest prompt in the file and deliberately about one thing.
 * Seven batches over the same 100 sources established that the main prompt cannot
 * hold both dispositions at once: the rules protecting terms of art, hedges and
 * the writer's voice make the model cautious, and rebuilding sentence rhythm needs
 * the opposite. Rewording, reordering, rebalancing, shortening and gating them all
 * failed, six attempts, with bigram overlap pinned near 0.60 against the 0.45 of an
 * engine that had none of those rules.
 *
 * So the two instincts get separate calls. Nothing here defends anything, because
 * nothing here is allowed to change anything except where the sentences break.
 * The register pass runs afterwards on the result.
 */
export const RESTRUCTURE_PROMPT =
  'Rewrite the text the user sends, changing only where its sentences begin and end. ' +
  'Output only the rewritten text: no preamble, no explanation, no code fences.\n' +
  'Keep every fact, name, number, date, place and quotation. Keep every idea, in the ' +
  'order it arrives. Keep the vocabulary, the tone and the register exactly as they ' +
  'are: this pass is not about word choice, and a word swapped here is a mistake.\n' +
  'Change the rhythm and nothing else. Split a long sentence so a genuinely short one ' +
  'appears, and join two short related ones into a long one. Short next to long is the ' +
  'whole point, so do not even the result out.';

const VOICE_WORD_LIMIT = { nano: 350, byok: 2000 } as const;

/**
 * Whole-prompt ceiling in characters. Nano's is the tight one: instruction
 * quality falls off well before its context does, and the review batches were
 * all run under this figure.
 *
 * The voice sample is trimmed to whatever room is left rather than to a fixed
 * word count. A word cap alone cannot hold a budget it cannot see: the sample
 * was capped at 350 words no matter how much the tell summary, the cadence
 * measurement and the instructions had already spent, so a long selection with
 * many detected tells could push the total over on its own. The sample yields
 * because it is the one part that degrades gracefully; half a voice sample is
 * still a voice sample, while half an instruction is a broken one.
 */
const PROMPT_BUDGET = { nano: 6000, byok: 24_000 } as const;

export interface PromptOptions {
  intensity: Intensity;
  tells: DetectedTell[];
  voiceSample?: string;
  target: 'nano' | 'byok';
  /** Measured sentence rhythm, when the text is long enough to have one. */
  cadence?: string;
  /**
   * The text being rewritten, used only to decide which conditional rules it
   * earns. Optional: without it every conditional rule is included, which is the
   * older and more cautious behaviour.
   */
  text?: string;
}

export function buildSystemPrompt(opts: PromptOptions): string {
  const parts = [opts.intensity === 'light' ? LIGHT_CORE : FULL_CORE];
  if (opts.intensity !== 'light') {
    const earned =
      opts.text === undefined ? CONDITIONAL_RULES.map(r => r.rule) : preservationNotes(opts.text);
    if (earned.length > 0) parts.push(earned.map(rule => `- ${rule}`).join('\n'));
  }
  const summary = tellSummary(opts.tells);
  if (summary) {
    parts.push(`Detected in this text: ${summary}. Fix these along with anything else you find.`);
  }
  // Last of the instructions on purpose, and phrased as a measurement rather than
  // a preference. A small model reading a twenty-item bullet list acts on the
  // concrete number near the end, not on "vary sentence length" in the middle.
  if (opts.cadence) parts.push(opts.cadence);
  const sample = opts.voiceSample?.trim();
  if (sample) {
    const heading = 'Match the voice of this writing sample from the author:\n';
    // Two joins' worth of separator, for the block about to be appended.
    const spent = parts.join('\n\n').length + heading.length + 2;
    const room = PROMPT_BUDGET[opts.target] - spent;
    let block = sample.split(/\s+/).slice(0, VOICE_WORD_LIMIT[opts.target]).join(' ');
    // Cut back to a word boundary so the sample never ends mid-word, which would
    // read to the model as a typo worth imitating.
    if (block.length > room) block = block.slice(0, Math.max(0, room)).replace(/\s+\S*$/, '');
    if (block) parts.push(heading + block);
  }
  return parts.join('\n\n');
}

/**
 * Tells named with their own text, for a retry prompt. "rule of three list" on
 * its own was ignorable; naming the actual list gives the model a target. The
 * Roman Empire sample went through a retry that talked only about pacing while
 * two rule-of-three lists it knew about survived untouched.
 */
export function describeTells(tells: DetectedTell[], max = 4): string {
  const items = tells
    .slice(0, max)
    .map(tell => `${TELL_NAMES[tell.ruleId] ?? tell.ruleId} ("${tell.excerpt.slice(0, 60)}")`);
  const rest = tells.length > max ? ` and ${tells.length - max} more` : '';
  return items.join(', ') + rest;
}

function tellSummary(tells: DetectedTell[]): string {
  const counts = new Map<string, number>();
  // Custom tells are all one rule id, so name them by the phrase that matched.
  // "custom" on its own tells the model nothing it can act on.
  const customPhrases = new Map<string, number>();
  for (const tell of tells) {
    if (tell.ruleId === 'custom') {
      const phrase = tell.excerpt.toLowerCase();
      customPhrases.set(phrase, (customPhrases.get(phrase) ?? 0) + 1);
      continue;
    }
    counts.set(tell.ruleId, (counts.get(tell.ruleId) ?? 0) + 1);
  }
  const items: string[] = [];
  for (const [id, count] of counts) {
    const rule = RULES.find(r => r.id === id);
    if (count < (rule?.minCountForPrompt ?? 1)) continue;
    const name = TELL_NAMES[id] ?? id;
    // Name the actual words for anything code will not fix itself. "AI-associated
    // word (7x)" tells the model a number and leaves it to guess which seven,
    // which is worse than the static list this replaced: that at least named
    // delve and crucial. A fixable rule needs no words here, because applyFixes
    // guarantees it whatever the model does.
    if (rule && !rule.fixable) {
      const seen = new Map<string, string>();
      for (const tell of tells) {
        if (tell.ruleId !== id) continue;
        const excerpt = tell.excerpt.slice(0, 40);
        if (!seen.has(excerpt.toLowerCase())) seen.set(excerpt.toLowerCase(), excerpt);
      }
      const named = [...seen.values()].slice(0, NAMED_TELL_LIMIT);
      if (named.length > 0) {
        const more = seen.size > named.length ? ', and more' : '';
        items.push(`${name}: ${named.map(w => `"${w}"`).join(', ')}${more}`);
        continue;
      }
    }
    items.push(count > 1 ? `${name} (${count}x)` : name);
  }
  for (const [phrase, count] of customPhrases) {
    const name = `your phrase "${phrase}"`;
    items.push(count > 1 ? `${name} (${count}x)` : name);
  }
  return items.slice(0, 10).join(', ');
}
