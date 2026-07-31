// Builds the before-and-after review document from a batch.
//
//   node scripts/make-review.mjs            -> docs/review/README.md plus parts
//
// Reads eval/pairs500.json, which the review page writes as it goes, so this can
// be run on a partial batch. Every pair is shown in full: the point is reading
// them, not trusting a summary.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const IN = 'eval/pairs500.json';
const OUT_DIR = 'docs/review';
const PER_PART = 50;

if (!existsSync(IN)) {
  console.error(`no ${IN} yet`);
  process.exit(1);
}
const pairs = JSON.parse(readFileSync(IN, 'utf8')).sort((a, b) => a.index - b.index);
mkdirSync(OUT_DIR, { recursive: true });

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

// Worst offenders first, because those are the ones worth a human's attention.
const flatAfter = rows.filter(r => r.a.sents >= 3 && r.a.words >= 55 && r.a.spread < 0.22);
const heavyAfter = rows.filter(r => r.a.words >= 55 && r.a.longRate > 0.3);
const unchanged = rows.filter(r => (r.after ?? '').trim() === (r.before ?? '').trim());
const worseTells = rows.filter(r => r.tellsAfter > r.tellsBefore);
const lostContent = rows.filter(r => (r.fidelity ?? []).length > 0);

const summary = [
  `# Second Draft review: ${rows.length} rewrites`,
  '',
  'Every paragraph below was generated to order (its own topic, register, writer situation',
  'and sentence-structure constraint), then rewritten by the shipped engine running the real',
  'on-device model, including the retry. Nothing is hand-picked.',
  '',
  '## Where it stands',
  '',
  '| | before | after |',
  '| --- | --- | --- |',
  `| flat pacing (spread under 0.22) | ${pct(rows.filter(r => r.b.sents >= 3 && r.b.words >= 55 && r.b.spread < 0.22).length, rows.length)} | ${pct(flatAfter.length, rows.length)} |`,
  `| heavy vocabulary (over 30% long words) | ${pct(rows.filter(r => r.b.words >= 55 && r.b.longRate > 0.3).length, rows.length)} | ${pct(heavyAfter.length, rows.length)} |`,
  `| mean sentence-length spread | ${avg(rows.map(r => r.b.spread)).toFixed(3)} | ${avg(rows.map(r => r.a.spread)).toFixed(3)} |`,
  `| mean long-word rate | ${avg(rows.map(r => r.b.longRate)).toFixed(3)} | ${avg(rows.map(r => r.a.longRate)).toFixed(3)} |`,
  `| mean words | ${avg(rows.map(r => r.b.words)).toFixed(0)} | ${avg(rows.map(r => r.a.words)).toFixed(0)} |`,
  '',
  'Human writing, measured over 1000 Wikipedia introductions, runs a median spread of 0.41',
  'and a median long-word rate of 0.19. Those are the targets, not zero.',
  '',
  `- rewrites that needed a second pass: **${pct(rows.filter(r => r.retried).length, rows.length)}**`,
  `- tell count went up: **${worseTells.length}**`,
  `- came back byte-identical to the input: **${unchanged.length}**`,
  `- flagged for lost content: **${lostContent.length}**`,
  '',
  '## Read these first',
  '',
  'The ones most likely to show a real problem.',
  '',
];

const listOf = (label, set, note) => {
  if (set.length === 0) return [`### ${label}`, '', 'None.', ''];
  return [
    `### ${label} (${set.length})`,
    '',
    note,
    '',
    ...set.slice(0, 25).map(r => `- [${r.index}](${partFile(r.index)}#${anchor(r)}) ${r.register}, ${r.topic}`),
    set.length > 25 ? `- ...and ${set.length - 25} more` : '',
    '',
  ];
};

const anchor = r => `${r.index}-${r.topic}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const partFile = index => `part-${String(Math.floor(index / PER_PART) * PER_PART).padStart(3, '0')}.md`;

summary.push(
  ...listOf('Came back unchanged', unchanged, 'The engine had nothing to say about these, which is a failure on AI-written input.'),
  ...listOf('Tell count rose', worseTells, 'The rewrite introduced more tells than it removed.'),
  ...listOf('Still flat after rewriting', flatAfter, 'Sentence lengths still sit in one narrow band.'),
  ...listOf('Still heavy after rewriting', heavyAfter, 'Vocabulary is still above the human 90th percentile.'),
  ...listOf('Lost content', lostContent, 'The fidelity check found something missing that the retry could not restore.'),
  '## All pairs',
  '',
);

for (let start = 0; start < rows.length; start += PER_PART) {
  const part = rows.slice(start, start + PER_PART);
  const file = `part-${String(start).padStart(3, '0')}.md`;
  summary.push(`- [${file}](${file}) — ${part.length} pairs, ${part[0].index} to ${part.at(-1).index}`);

  const lines = [`# Pairs ${part[0].index} to ${part.at(-1).index}`, '', '[Back to summary](README.md)', ''];
  for (const r of part) {
    const tag = [];
    if ((r.after ?? '').trim() === (r.before ?? '').trim()) tag.push('UNCHANGED');
    if (r.tellsAfter > r.tellsBefore) tag.push('MORE TELLS');
    if (r.a.spread < 0.22 && r.a.words >= 55) tag.push('still flat');
    if (r.a.longRate > 0.3 && r.a.words >= 55) tag.push('still heavy');
    if ((r.fidelity ?? []).length > 0) tag.push('lost content');
    lines.push(
      `## ${r.index}. ${r.topic}`,
      '',
      `**${r.register}** · ${r.stance} · ${r.shape}`,
      '',
      `tells ${r.tellsBefore} to ${r.tellsAfter} · spread ${r.b.spread.toFixed(2)} to ${r.a.spread.toFixed(2)} · long words ${(r.b.longRate * 100).toFixed(0)}% to ${(r.a.longRate * 100).toFixed(0)}% · ${r.retried ? 'retried' : 'one pass'}${tag.length ? ` · **${tag.join(', ')}**` : ''}`,
      '',
      '**Before**',
      '',
      '> ' + (r.before ?? '').trim().replace(/\n+/g, '\n> '),
      '',
      '**After**',
      '',
      '> ' + (r.after ?? '').trim().replace(/\n+/g, '\n> '),
      '',
      ...((r.fidelity ?? []).length ? [`Fidelity: ${r.fidelity.join(' ')}`, ''] : []),
      '---',
      '',
    );
  }
  writeFileSync(`${OUT_DIR}/${file}`, lines.join('\n'));
}

writeFileSync(`${OUT_DIR}/README.md`, summary.join('\n'));
console.log(`wrote ${OUT_DIR}/README.md and ${Math.ceil(rows.length / PER_PART)} parts for ${rows.length} pairs`);
