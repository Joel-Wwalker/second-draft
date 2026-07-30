// Aggregates a batch of rewrites against the signals the engine acts on, so a
// prompt change can be judged on many samples instead of on one paragraph that
// happened to be handy.
//
//   npm run eval eval/results.json
//
// Expects a JSON array of { topic, input, output }. eval/README.md explains how a
// batch is produced. Prints per-sample rows only for regressions, then a summary,
// because sixty rows of "fine" is not information.
import { readFileSync } from 'node:fs';

// Sentence-opening variety was measured here once and removed: over 1000
// human-written paragraphs it flagged 57.6%, and its repeated-opener half was
// backwards, 39.6% human against 3.3% machine. Length spread was the only style
// signal that separated the two, so it is the only one reported.

// Thresholds mirror src/shared/cadence.ts and src/shared/diction.ts.
const MIN_SENTENCES_CADENCE = 3;
const MIN_WORDS = 55;
const MIN_SPREAD = 0.22;
const MAX_LONG_WORD_RATE = 0.3;

// Same heading rule as src/shared/prose.ts, copied because this script cannot
// import TypeScript.
function proseOnly(text) {
  return text
    .split(/\n+/)
    .filter(line => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      return /[.!?]/.test(trimmed) || trimmed.split(/\s+/).length > 8;
    })
    .join('\n');
}

function measure(raw) {
  const text = proseOnly(raw);
  const sentences = text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
  const lengths = sentences.map(s => s.split(/\s+/).filter(Boolean).length).filter(n => n > 0);
  const words = lengths.reduce((a, b) => a + b, 0);
  const mean = words / (lengths.length || 1);
  const stdev = Math.sqrt(lengths.reduce((s, n) => s + (n - mean) ** 2, 0) / (lengths.length || 1));


  const spread = stdev / (mean || 1);
  const toks = text.split(/\s+/).map(t => t.replace(/[^A-Za-z’']/g, '')).filter(Boolean);
  const longRate = toks.filter(w => w.length >= 8).length / (toks.length || 1);

  return {
    words,
    sentences: lengths.length,
    mean,
    spread,
    longRate,
    flat: lengths.length >= MIN_SENTENCES_CADENCE && words >= MIN_WORDS && spread < MIN_SPREAD,
    heavy: words >= MIN_WORDS && longRate > MAX_LONG_WORD_RATE,
  };
}

const file = process.argv[2];
if (!file) {
  console.error('usage: npm run eval <results.json>');
  process.exit(1);
}
const samples = JSON.parse(readFileSync(file, 'utf8')).filter(s => s.output?.trim());

const rows = samples.map(s => ({ topic: s.topic, before: measure(s.input), after: measure(s.output) }));

const pct = (n, d) => `${((n / d) * 100).toFixed(0)}%`;
const avg = xs => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

const flatBefore = rows.filter(r => r.before.flat).length;
const flatAfter = rows.filter(r => r.after.flat).length;
const heavyBefore = rows.filter(r => r.before.heavy).length;
const heavyAfter = rows.filter(r => r.after.heavy).length;
const cleanAfter = rows.filter(r => !r.after.flat && !r.after.heavy).length;

// Regressions are the point: a rewrite that made a signal worse than its input.
const worse = rows.filter(
  r => (!r.before.flat && r.after.flat) || (!r.before.heavy && r.after.heavy),
);

console.log(`\n${rows.length} samples from ${file}\n`);
console.log('signal                       input      output');
console.log('------------------------------------------------');
console.log(`flat pacing            ${pct(flatBefore, rows.length).padStart(10)}${pct(flatAfter, rows.length).padStart(12)}`);
console.log(`heavy vocabulary       ${pct(heavyBefore, rows.length).padStart(10)}${pct(heavyAfter, rows.length).padStart(12)}`);
console.log(`mean spread            ${avg(rows.map(r => r.before.spread)).toFixed(3).padStart(10)}${avg(rows.map(r => r.after.spread)).toFixed(3).padStart(12)}`);
console.log(`mean long-word rate    ${avg(rows.map(r => r.before.longRate)).toFixed(3).padStart(10)}${avg(rows.map(r => r.after.longRate)).toFixed(3).padStart(12)}`);
console.log(`mean words             ${avg(rows.map(r => r.before.words)).toFixed(0).padStart(10)}${avg(rows.map(r => r.after.words)).toFixed(0).padStart(12)}`);
console.log(`\nclean on both signals: ${cleanAfter} of ${rows.length} (${pct(cleanAfter, rows.length)})`);

if (worse.length) {
  console.log(`\n${worse.length} rewrites made a signal worse than the input:`);
  for (const r of worse) {
    const why = [];
    if (!r.before.flat && r.after.flat) why.push(`pacing ${r.before.spread.toFixed(2)} to ${r.after.spread.toFixed(2)}`);
    if (!r.before.heavy && r.after.heavy) why.push(`vocabulary ${(r.before.longRate * 100).toFixed(0)}% to ${(r.after.longRate * 100).toFixed(0)}% long words`);
    console.log(`  ${r.topic}: ${why.join(', ')}`);
  }
} else {
  console.log('\nNo rewrite made either signal worse than its input.');
}
console.log('');
