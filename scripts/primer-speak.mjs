// Counts the words a rewrite reaches for when it is avoiding the work.
//
//   node scripts/primer-speak.mjs [eval/pairs100.json]
//
// The 100-pair review found the register floor pushing every paragraph toward a
// smaller vocabulary: "how" went from 12 uses across the corpus to 74, "problems"
// from 3 to 23, "things" from 11 to 28. None of that shows up in a per-paragraph
// check, because no single rewrite looks wrong; the damage is only visible with
// the whole corpus in view. So it is measured here, before and after, and the
// after column is expected to stay at or below the before column.
//
// Human rates come from the same 1000 Wikipedia introductions used to calibrate
// cadence and diction, normalized per 1000 words so the three columns compare.
import { readFileSync, existsSync } from 'node:fs';

const IN = process.argv[2] ?? 'eval/pairs100.json';
if (!existsSync(IN)) {
  console.error(`no ${IN}`);
  process.exit(1);
}

const WORDS = {
  how: /\bhow\b/gi,
  things: /\bthings?\b/gi,
  problems: /\bproblems?\b/gi,
  good: /\bgood\b/gi,
  important: /\bimportant\b/gi,
  'a lot': /\ba lot\b/gi,
  'a closer look': /\ba closer look\b/gi,
  stuff: /\bstuff\b/gi,
  really: /\breally\b/gi,
  'very': /\bvery\b/gi,
};

const pairs = JSON.parse(readFileSync(IN, 'utf8'));
const join = key => pairs.map(p => p[key] ?? '').join('\n');
const before = join('before');
const after = join('after');

const human = existsSync('eval/human.json')
  ? JSON.parse(readFileSync('eval/human.json', 'utf8')).map(h => h.text ?? h).join('\n')
  : '';

const words = t => t.split(/\s+/).filter(Boolean).length;
const count = (t, re) => {
  re.lastIndex = 0;
  return (t.match(re) ?? []).length;
};
const per1k = (t, re) => (words(t) ? (count(t, re) / words(t)) * 1000 : 0);

console.log(`${IN}: ${pairs.length} pairs, ${words(before)} words in, ${words(after)} words out\n`);
console.log('word            before   after   change    per 1k in/out   human per 1k');
let regressions = 0;
for (const [name, re] of Object.entries(WORDS)) {
  const b = count(before, re);
  const a = count(after, re);
  const delta = a - b;
  // Rates, because a rewrite that is 5% longer will show more of everything.
  const rb = per1k(before, re);
  const ra = per1k(after, re);
  const h = human ? per1k(human, re) : NaN;
  const worse = ra > rb * 1.1 && a > b;
  if (worse) regressions += 1;
  console.log(
    `${name.padEnd(15)} ${String(b).padStart(5)}  ${String(a).padStart(6)}  ${
      (delta > 0 ? `+${delta}` : String(delta)).padStart(6)
    }    ${rb.toFixed(2).padStart(5)}/${ra.toFixed(2).padEnd(5)}   ${
      human ? h.toFixed(2).padStart(5) : '  n/a'
    }${worse ? '   REGRESSION' : ''}`,
  );
}

console.log(
  `\n${regressions === 0 ? 'No regressions.' : `${regressions} word(s) got more common in the rewrites.`}`,
);
console.log(
  'A rewrite may use these words. It may not reach for them in place of the specific',
  '\nword the original had, which is what a corpus-wide rise means.',
);
process.exitCode = regressions > 0 ? 1 : 0;
