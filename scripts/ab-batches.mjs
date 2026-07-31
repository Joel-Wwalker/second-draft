// Side-by-side on the findings of the 100-pair review.
//
//   node scripts/ab-batches.mjs eval/pairs100.json eval/pairs100b.json
//
// Both files hold the same 100 source paragraphs, so every difference between
// the two "after" columns is the engine and nothing else. Runs on a partial
// second file: only the indexes present in both are compared, and the count is
// printed so a half-finished batch is never mistaken for a whole one.
//
// Each row is a claim the review made. A row that does not move is a fix that
// did not land, whatever the code says.
import { readFileSync, existsSync } from 'node:fs';

const [aPath = 'eval/pairs100.json', bPath = 'eval/pairs100b.json'] = process.argv.slice(2);
for (const p of [aPath, bPath]) {
  if (!existsSync(p)) {
    console.error(`no ${p}`);
    process.exit(1);
  }
}

// Scored here rather than read from the batch files. Each file stores the count
// the engine computed when it ran, so the newer batch was scored by a detector
// the older one never saw: after 23 words joined the list, the same prose counts
// more tells without a single rewrite having got worse. One detector over both
// outputs is the only version of this number that compares anything.
//   npx esbuild eval/detect-entry.ts --bundle --format=esm --outfile=eval/detect.mjs
let detect = null;
try {
  ({ detect } = await import('../eval/detect.mjs'));
} catch {
  // Left null; the row prints n/a rather than a number that means two things.
}

const load = p => new Map(JSON.parse(readFileSync(p, 'utf8')).map(d => [d.index, d]));
const A = load(aPath);
const B = load(bPath);
const shared = [...B.keys()].filter(i => A.has(i)).sort((x, y) => x - y);

const human = existsSync('eval/human.json')
  ? JSON.parse(readFileSync('eval/human.json', 'utf8')).map(h => h.text ?? h)
  : [];

const proseOnly = t =>
  t
    .split(/\n+/)
    .filter(l => {
      const s = l.trim();
      return s && (/[.!?]/.test(s) || s.split(/\s+/).length > 8);
    })
    .join('\n');

function measure(raw) {
  const text = proseOnly(raw ?? '');
  const lens = text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim().split(/\s+/).filter(Boolean).length)
    .filter(n => n > 0);
  if (lens.length === 0) return { words: 0, spread: 0, longRate: 0, sents: 0 };
  const words = lens.reduce((a, b) => a + b, 0);
  const mean = words / lens.length;
  const sd = Math.sqrt(lens.reduce((s, n) => s + (n - mean) ** 2, 0) / lens.length);
  const toks = text.split(/\s+/).map(w => w.replace(/[^A-Za-z']/g, '')).filter(Boolean);
  return {
    words,
    sents: lens.length,
    spread: sd / (mean || 1),
    longRate: toks.filter(w => w.length >= 8).length / (toks.length || 1),
  };
}

// The same normalization the engine uses to decide a rewrite happened at all.
const normalize = v =>
  v.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();

const PRIMER = /\b(?:how|things?|problems?|good|important|a lot|a closer look|really|very)\b/gi;
const HEDGES = /\b(?:purported(?:ly)?|alleged(?:ly)?|attributed to|ostensibly|reportedly|arguably|apparently|seemingly)\b/gi;
// The writer showing up in their own sentence. A rewrite may move one; it may not
// quietly delete it, which is how a paragraph about grief came back reading like
// a condolence card.
const VOICE = /\b(?:honestly|frankly|I think|I mean|to be fair|of course)\b/gi;
const DASHES = /[—–]/g;
const NEGPAR = /\bnot (?:just|only|merely)\b[^.!?\n]{0,80}\bbut\b/gi;

const hits = (t, re) => {
  re.lastIndex = 0;
  return (t.match(re) ?? []).length;
};
const words = t => t.split(/\s+/).filter(Boolean).length;

// How much of the source survives structurally. The measurement that finally
// explained a pacing regression three reruns could not pin down: preservation
// rules aimed at word choice made the model stop restructuring, and nothing else
// in the report could see it, because every other row was either about which
// words appear or about the shape of the result rather than the distance
// travelled to get there.
const bigrams = text => {
  const w = (text ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const out = new Set();
  for (let i = 0; i + 2 <= w.length; i++) out.add(`${w[i]} ${w[i + 1]}`);
  return out;
};
const overlap = (x, y) => {
  const a2 = bigrams(x);
  const b2 = bigrams(y);
  let both = 0;
  for (const g of a2) if (b2.has(g)) both += 1;
  return both / Math.max(1, a2.size + b2.size - both);
};
const isFlatText = t => {
  const m = measure(t);
  return m.sents >= 3 && m.words >= 55 && m.spread < 0.22;
};

function summarize(get) {
  const after = shared.map(i => get(i).after ?? '');
  const before = shared.map(i => A.get(i).before ?? '');
  const joinedAfter = after.join('\n');
  const m = after.map(measure);
  const avg = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  return {
    noop: shared.filter((i, k) => normalize(after[k]) === normalize(before[k])).length,
    dashes: hits(joinedAfter, DASHES),
    negpar: shared.filter((i, k) => hits(after[k], NEGPAR) > hits(before[k], NEGPAR)).length,
    primer: (hits(joinedAfter, PRIMER) / words(joinedAfter)) * 1000,
    hedgeKept:
      hits(joinedAfter, HEDGES) / Math.max(1, hits(before.join('\n'), HEDGES)),
    // Per pair rather than per occurrence: losing one of a paragraph's three
    // markers is a different failure from flattening the paragraph entirely.
    voiceKept:
      shared.filter((i, k) => hits(before[k], VOICE) > 0 && hits(after[k], VOICE) > 0).length /
      Math.max(1, shared.filter((i, k) => hits(before[k], VOICE) > 0).length),
    spread: avg(m.map(x => x.spread)),
    longRate: avg(m.map(x => x.longRate)),
    sents: avg(m.map(x => x.sents)),
    flat: m.filter(x => x.sents >= 3 && x.words >= 55 && x.spread < 0.22).length,
    tellsAfter: detect ? avg(after.map(t => detect(t).length)) : NaN,
    tellsBefore: detect ? avg(before.map(t => detect(t).length)) : NaN,
    overlap: avg(shared.map((i, k) => overlap(before[k], after[k]))),
    // Of the sources that arrived flat, how many left that way. The engine's
    // actual job on this axis, and the number a whole-corpus flat count hides:
    // that count mixes paragraphs the engine failed to fix with paragraphs it
    // flattened itself, which have different causes and different fixes.
    deflattened: (() => {
      const flatIn = shared.filter((i, k) => isFlatText(before[k]));
      const fixed = flatIn.filter((i, k) => !isFlatText(after[shared.indexOf(i)]));
      return `${fixed.length}/${flatIn.length}`;
    })(),
    retried: shared.filter(i => get(i).retried).length,
  };
}

const a = summarize(i => A.get(i));
const b = summarize(i => B.get(i));

const hp = re => (human.length ? (hits(human.join('\n'), re) / words(human.join('\n'))) * 1000 : NaN);
const humanSpread = 0.41;
const humanLong = 0.19;

console.log(`${shared.length} of 100 indexes present in both batches.`);
console.log(`old: ${aPath}\nnew: ${bPath}\n`);

const rows = [
  ['no-op rewrites (normalized)', a.noop, b.noop, '0', 'lower'],
  ['em/en dashes surviving', a.dashes, b.dashes, '0', 'lower'],
  ['invented negative parallelism', a.negpar, b.negpar, '0', 'lower'],
  ['primer words per 1k', a.primer.toFixed(2), b.primer.toFixed(2), hp(PRIMER).toFixed(2), 'lower'],
  ['hedges kept vs input', a.hedgeKept.toFixed(2), b.hedgeKept.toFixed(2), '1.00', 'higher'],
  ['voice markers kept (per pair)', a.voiceKept.toFixed(2), b.voiceKept.toFixed(2), '1.00', 'higher'],
  ['mean sentence spread', a.spread.toFixed(3), b.spread.toFixed(3), String(humanSpread), 'higher'],
  ['still flat after', a.flat, b.flat, '~8', 'lower'],
  ['flat sources de-flattened', a.deflattened, b.deflattened, '', 'higher'],
  ['bigram overlap with source', a.overlap.toFixed(3), b.overlap.toFixed(3), '', 'lower = rebuilt more'],
  ['mean long-word rate', a.longRate.toFixed(3), b.longRate.toFixed(3), String(humanLong), 'lower'],
  ['mean sentences per para', a.sents.toFixed(1), b.sents.toFixed(1), '', 'flat is fine'],
  [
    'mean tells after (one detector)',
    detect ? a.tellsAfter.toFixed(2) : 'n/a',
    detect ? b.tellsAfter.toFixed(2) : 'n/a',
    detect ? a.tellsBefore.toFixed(2) : '',
    'lower than the source column',
  ],
  ['retried', a.retried, b.retried, '', ''],
];

const w = [30, 10, 10, 10];
console.log(
  'measure'.padEnd(w[0]) + 'old'.padStart(w[1]) + 'new'.padStart(w[2]) + 'target'.padStart(w[3]) + '   want',
);
for (const [name, oldV, newV, target, want] of rows) {
  console.log(
    String(name).padEnd(w[0]) +
      String(oldV).padStart(w[1]) +
      String(newV).padStart(w[2]) +
      String(target).padStart(w[3]) +
      `   ${want}`,
  );
}
console.log(
  '\nThe human column comes from 1000 Wikipedia introductions, except the two zeros,',
  '\nwhich are the only defensible target for a fault the engine introduces itself.',
);
