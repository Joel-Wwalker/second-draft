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
const DASHES = /[—–]/g;
const NEGPAR = /\bnot (?:just|only|merely)\b[^.!?\n]{0,80}\bbut\b/gi;

const hits = (t, re) => {
  re.lastIndex = 0;
  return (t.match(re) ?? []).length;
};
const words = t => t.split(/\s+/).filter(Boolean).length;

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
    spread: avg(m.map(x => x.spread)),
    longRate: avg(m.map(x => x.longRate)),
    sents: avg(m.map(x => x.sents)),
    flat: m.filter(x => x.sents >= 3 && x.words >= 55 && x.spread < 0.22).length,
    tellsAfter: avg(shared.map(i => get(i).tellsAfter ?? 0)),
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
  ['mean sentence spread', a.spread.toFixed(3), b.spread.toFixed(3), String(humanSpread), 'higher'],
  ['still flat after', a.flat, b.flat, '~8', 'lower'],
  ['mean long-word rate', a.longRate.toFixed(3), b.longRate.toFixed(3), String(humanLong), 'lower'],
  ['mean sentences per para', a.sents.toFixed(1), b.sents.toFixed(1), '', 'flat is fine'],
  ['mean tells after', a.tellsAfter.toFixed(2), b.tellsAfter.toFixed(2), '', 'lower'],
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
