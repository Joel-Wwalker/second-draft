// Writes the before-and-after pairs and nothing else.
//
//   node scripts/make-pairs.mjs
//
// No measurements, no scores, no triage: just the paragraph that went in and the
// paragraph that came out, in order, so they can be read as writing rather than
// as data.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

// Defaults to the first review batch; both paths can be given so a rerun can be
// read the same way without overwriting the batch it is being compared against.
//   node scripts/make-pairs.mjs eval/pairs100b.json docs/review/pairs-100-rerun.md
const [IN = 'eval/pairs100.json', OUT = 'docs/review/pairs-100.md'] = process.argv.slice(2);

if (!existsSync(IN)) {
  console.error(`no ${IN} yet`);
  process.exit(1);
}

const pairs = JSON.parse(readFileSync(IN, 'utf8')).sort((a, b) => a.index - b.index);
mkdirSync('docs/review', { recursive: true });

const out = [`# ${pairs.length} paragraphs, before and after`, ''];

for (const p of pairs) {
  out.push(
    `## ${p.index + 1}. ${p.topic}`,
    '',
    `*${p.band}*`,
    '',
    '**BEFORE**',
    '',
    (p.before ?? '').trim(),
    '',
    '**AFTER**',
    '',
    (p.after ?? '').trim(),
    '',
    '---',
    '',
  );
}

writeFileSync(OUT, out.join('\n'));
console.log(`wrote ${OUT}: ${pairs.length} pairs`);
