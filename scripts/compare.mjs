// Measures one or more texts against the signals this extension acts on, so a
// change can be checked instead of guessed at, and so a competitor's output can be
// put next to ours on the same numbers.
//
//   npm run compare ours.txt theirs.txt
//   npm run compare samples/*.txt
//
// Reads stdin when given no files. Every metric here is one the engine uses, so if
// a column looks wrong the fix belongs in src/shared/, not in this script.
import { readFileSync } from 'node:fs';

const RULES = [
  ['em dash', /[—–]/g],
  ['curly quote', /[“”‘’]/g],
  ['ai vocab', /\b(delve|tapestry|testament|underscore|showcase|pivotal|crucial|vibrant|foster|garner|interplay|intricate|enduring|moreover|furthermore|additionally|multifaceted|holistic|robust|seamless|landscape|realm|myriad|plethora)\w*/gi],
  ['filler', /\b(it is important to note|it'?s important to note|in order to|needless to say|when it comes to)\b/gi],
  ['not just X but Y', /\bnot (just|only|merely)\b[^.!?]{0,60}\bbut\b/gi],
];

// Sentence-opening variety was measured here once and removed. Over 1000
// human-written paragraphs it flagged 57.6% of them, and the repeated-opener
// version was backwards: 39.6% of human paragraphs against 3.3% of machine ones.
// Sentence length spread was the only style signal that separated the two.

function measure(text) {
  const sentences = text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
  const lengths = sentences.map(s => s.split(/\s+/).filter(Boolean).length).filter(n => n > 0);
  const words = lengths.reduce((a, b) => a + b, 0);
  const mean = words / (lengths.length || 1);
  const stdev = Math.sqrt(lengths.reduce((s, n) => s + (n - mean) ** 2, 0) / (lengths.length || 1));


  const tells = RULES.map(([name, re]) => [name, (text.match(re) ?? []).length]).filter(([, n]) => n > 0);

  return {
    words,
    sentences: lengths.length,
    mean,
    spread: stdev / (mean || 1),
    shortest: Math.min(...lengths),
    longest: Math.max(...lengths),
    tells,
  };
}

const files = process.argv.slice(2);
const inputs = files.length
  ? files.map(f => [f, readFileSync(f, 'utf8')])
  : [['stdin', readFileSync(0, 'utf8')]];

const rows = inputs.map(([name, text]) => [name, measure(text)]);
const width = Math.max(12, ...rows.map(([name]) => name.length));
const cell = v => String(v).padStart(9);

console.log('');
console.log('label'.padEnd(width), cell('words'), cell('sents'), cell('mean'), cell('spread'), cell('short'), cell('long'));
console.log('-'.repeat(width + 9 * 6 + 6));
for (const [name, m] of rows) {
  console.log(
    name.padEnd(width),
    cell(m.words),
    cell(m.sentences),
    cell(m.mean.toFixed(1)),
    cell(m.spread.toFixed(2)),
    cell(m.shortest),
    cell(m.longest),
  );
}

console.log('');
for (const [name, m] of rows) {
  const problems = [];
  // Same thresholds as src/shared/cadence.ts and src/shared/structure.ts.
  if (m.sentences >= 3 && m.words >= 55 && m.spread < 0.22) problems.push(`flat pacing (spread ${m.spread.toFixed(2)}, wants 0.22+)`);
  for (const [tell, n] of m.tells) problems.push(`${tell} x${n}`);
  console.log(`${name}: ${problems.length ? problems.join('; ') : 'clean on every signal measured'}`);
}
console.log('');
console.log('spread is stdev/mean of sentence length. Under 0.22 reads as one length repeated.');
console.log('For scale: 1000 human-written paragraphs run a median spread of 0.41; 60 machine-written ones, 0.16.');
