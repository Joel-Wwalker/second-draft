// Builds one before-and-after document from a batch.
//
//   npm run review        -> docs/review/all-pairs.md
//
// Reads eval/pairs500.json, which the review page writes as it goes, so this can
// be run on a partial batch. Every pair appears in full, in one file: an earlier
// version split them across parts behind an index, which buried the thing the
// document exists for.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const IN = 'eval/pairs500.json';
const OUT = 'docs/review/all-pairs.md';

if (!existsSync(IN)) {
  console.error(`no ${IN} yet`);
  process.exit(1);
}
const pairs = JSON.parse(readFileSync(IN, 'utf8')).sort((a, b) => a.index - b.index);
mkdirSync('docs/review', { recursive: true });

const letters = w => w.replace(/[^A-Za-z’']/g, '');
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
  const sents = text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
  const lens = sents.map(s => s.split(/\s+/).filter(Boolean).length).filter(n => n > 0);
  if (lens.length === 0) return { words: 0, spread: 0, longRate: 0, sents: 0 };
  const words = lens.reduce((a, b) => a + b, 0);
  const mean = words / lens.length;
  const sd = Math.sqrt(lens.reduce((s, n) => s + (n - mean) ** 2, 0) / lens.length);
  const toks = text.split(/\s+/).map(letters).filter(Boolean);
  return {
    words,
    sents: lens.length,
    spread: sd / (mean || 1),
    longRate: toks.filter(w => w.length >= 8).length / (toks.length || 1),
  };
}

const rows = pairs.map(p => ({ ...p, b: measure(p.before), a: measure(p.after) }));
const avg = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(0)}%` : 'n/a');

const flatAfter = rows.filter(r => r.a.sents >= 3 && r.a.words >= 55 && r.a.spread < 0.22);
const heavyAfter = rows.filter(r => r.a.words >= 55 && r.a.longRate > 0.3);
const unchanged = rows.filter(r => (r.after ?? '').trim() === (r.before ?? '').trim());
const worseTells = rows.filter(r => r.tellsAfter > r.tellsBefore);
const lostContent = rows.filter(r => (r.fidelity ?? []).length > 0);
const shorter = rows.filter(r => r.b.words > 0 && r.a.words / r.b.words < 0.85);

const out = [
  `# ${rows.length} rewrites, before and after`,
  '',
  'Each paragraph was generated to order with its own topic, register, writer situation and',
  'sentence-structure constraint, then rewritten by the shipped engine running the on-device',
  'model, retry included. Nothing is hand-picked and nothing is edited.',
  '',
  '| | before | after | human writing |',
  '| --- | --- | --- | --- |',
  `| flat pacing (spread under 0.22) | ${pct(rows.filter(r => r.b.sents >= 3 && r.b.words >= 55 && r.b.spread < 0.22).length, rows.length)} | ${pct(flatAfter.length, rows.length)} | 8% |`,
  `| heavy vocabulary (over 30% long words) | ${pct(rows.filter(r => r.b.words >= 55 && r.b.longRate > 0.3).length, rows.length)} | ${pct(heavyAfter.length, rows.length)} | 6% |`,
  `| mean sentence-length spread | ${avg(rows.map(r => r.b.spread)).toFixed(3)} | ${avg(rows.map(r => r.a.spread)).toFixed(3)} | 0.41 |`,
  `| mean long-word rate | ${avg(rows.map(r => r.b.longRate)).toFixed(3)} | ${avg(rows.map(r => r.a.longRate)).toFixed(3)} | 0.19 |`,
  `| mean words | ${avg(rows.map(r => r.b.words)).toFixed(0)} | ${avg(rows.map(r => r.a.words)).toFixed(0)} | |`,
  '',
  'The human column comes from measuring 1000 Wikipedia introductions. Those are the targets.',
  '',
  `Needed a second pass: **${pct(rows.filter(r => r.retried).length, rows.length)}**.`,
  `Tell count rose: **${worseTells.length}**.`,
  `Came back byte-identical: **${unchanged.length}**.`,
  `Lost content: **${lostContent.length}**.`,
  `Lost more than 15% of their length: **${shorter.length}**.`,
  '',
];

const listOf = (label, set, note) => {
  if (set.length === 0) return [`**${label}:** none.`, ''];
  return [
    `**${label} (${set.length}):** ${note}`,
    '',
    ...set.slice(0, 30).map(r => `- ${r.index}. ${r.register}, ${r.topic}`),
    set.length > 30 ? `- ...and ${set.length - 30} more` : '',
    '',
  ];
};

out.push(
  '## Worth reading first',
  '',
  ...listOf('Came back unchanged', unchanged, 'the engine had nothing to say, which is a failure on AI-written input.'),
  ...listOf('Tell count rose', worseTells, 'the rewrite added more tells than it removed.'),
  ...listOf('Still flat', flatAfter, 'sentence lengths still sit in one narrow band.'),
  ...listOf('Still heavy', heavyAfter, 'vocabulary still above the human 90th percentile.'),
  ...listOf('Lost content', lostContent, 'the fidelity check found something the retry could not restore.'),
  ...listOf('Much shorter', shorter, 'under 85% of the original length, worth checking for lost meaning.'),
  '---',
  '',
);

for (const r of rows) {
  const tag = [];
  if ((r.after ?? '').trim() === (r.before ?? '').trim()) tag.push('UNCHANGED');
  if (r.tellsAfter > r.tellsBefore) tag.push('MORE TELLS');
  if (r.a.spread < 0.22 && r.a.words >= 55) tag.push('still flat');
  if (r.a.longRate > 0.3 && r.a.words >= 55) tag.push('still heavy');
  if ((r.fidelity ?? []).length > 0) tag.push('lost content');
  if (r.b.words > 0 && r.a.words / r.b.words < 0.85) tag.push('much shorter');
  out.push(
    `## ${r.index}. ${r.topic}`,
    '',
    `*${r.register} · ${r.stance} · ${r.shape}*`,
    '',
    `tells ${r.tellsBefore} to ${r.tellsAfter} · spread ${r.b.spread.toFixed(2)} to ${r.a.spread.toFixed(2)} · long words ${(r.b.longRate * 100).toFixed(0)}% to ${(r.a.longRate * 100).toFixed(0)}% · ${r.b.words} to ${r.a.words} words · ${r.retried ? 'retried' : 'one pass'}${tag.length ? ` · **${tag.join(', ')}**` : ''}`,
    '',
    '**BEFORE**',
    '',
    (r.before ?? '').trim(),
    '',
    '**AFTER**',
    '',
    (r.after ?? '').trim(),
    '',
    ...((r.fidelity ?? []).length ? [`*Fidelity: ${r.fidelity.join(' ')}*`, ''] : []),
    '---',
    '',
  );
}

writeFileSync(OUT, out.join('\n'));
console.log(`wrote ${OUT}: ${rows.length} pairs, ${(readFileSync(OUT, 'utf8').length / 1024).toFixed(0)} KB`);
