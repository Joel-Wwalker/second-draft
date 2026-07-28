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
  'no quotes around it, no code fences. Preserve the meaning, approximate length, paragraph breaks, ' +
  'and all facts. Never use em dashes or en dashes anywhere in the output. ' +
  'Leave text inside quotation marks exactly as written.';

const LIGHT_CORE = `${CONTRACT}
Change as little as possible. Only fix these AI tells where they appear:
- Replace every em dash and en dash with a comma, period, or colon.
- Replace AI-flavored words (delve, tapestry, testament, underscore, showcase, pivotal, crucial, vibrant, foster, garner, interplay, intricate, enduring, moreover, furthermore, additionally) with plain everyday words.
- Remove chatbot filler such as "I hope this helps" or "Would you like me to".
- Straighten curly quotes and remove emoji.
Keep everything else exactly as written.`;

const FULL_CORE = `${CONTRACT}
Rewrite so the text reads like a person wrote it, keeping the meaning and register:
- Cut significance inflation (stands as, testament to, pivotal moment, underscores).
- Cut promotional tone (vibrant, breathtaking, nestled, renowned, must-visit).
- Drop tacked-on "-ing" analysis clauses (highlighting, showcasing, reflecting).
- Replace vague attributions (experts argue, observers note) with direct statements.
- Prefer plain is/are/has over serves as, boasts, features.
- Unwind negative parallelisms (not just X but Y) into direct claims.
- Break up forced rule of three lists; two items or four are fine.
- Do not cycle synonyms; repeating the natural word is fine.
- Remove false ranges (from X to Y) that are not real scales.
- No runs of short dramatic fragments; vary sentence length naturally.
- No aphorism formulas (X is the Y of Z).
- No signposting (let's dive in, here's what you need to know).
- No fake-candid openers (Honestly? Look. Here's the thing.).
- Trim hedging and filler (in order to, it is important to note that).
- End without a generic upbeat conclusion.
- Replace AI-flavored words (delve, tapestry, testament, pivotal, crucial, vibrant, interplay, intricate) with plain ones.
- Replace every em dash and en dash. Straighten curly quotes. No emoji.
Rewrite even when none of the listed tells appear: smooth, generic, evenly paced prose where every sentence has the same shape is itself an AI tell. Vary sentence length, break parallel structures, and swap vague phrasing for concrete wording. Returning the text unchanged or nearly unchanged is a failure. The rewrite must read noticeably different while keeping the same meaning, register, and rough length.`;

const VOICE_WORD_LIMIT = { nano: 350, byok: 2000 } as const;

export interface PromptOptions {
  intensity: Intensity;
  tells: DetectedTell[];
  voiceSample?: string;
  target: 'nano' | 'byok';
}

export function buildSystemPrompt(opts: PromptOptions): string {
  const parts = [opts.intensity === 'light' ? LIGHT_CORE : FULL_CORE];
  const summary = tellSummary(opts.tells);
  if (summary) {
    parts.push(`Detected in this text: ${summary}. Fix these along with anything else you find.`);
  }
  const sample = opts.voiceSample?.trim();
  if (sample) {
    const words = sample.split(/\s+/).slice(0, VOICE_WORD_LIMIT[opts.target]);
    parts.push(`Match the voice of this writing sample from the author:\n${words.join(' ')}`);
  }
  return parts.join('\n\n');
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
    items.push(count > 1 ? `${name} (${count}x)` : name);
  }
  for (const [phrase, count] of customPhrases) {
    const name = `your phrase "${phrase}"`;
    items.push(count > 1 ? `${name} (${count}x)` : name);
  }
  return items.slice(0, 10).join(', ');
}
