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

const FRONTED = new Set([
  'after', 'although', 'as', 'because', 'before', 'besides', 'beyond', 'but', 'by', 'despite',
  'during', 'even', 'except', 'for', 'from', 'given', 'if', 'in', 'inside', 'instead', 'like',
  'meanwhile', 'once', 'on', 'onto', 'other', 'outside', 'over', 'rather', 'since', 'so', 'though',
  'through', 'to', 'toward', 'under', 'unless', 'until', 'upon', 'when', 'whenever', 'where',
  'whereas', 'wherever', 'whether', 'while', 'with', 'within', 'without', 'yet', 'afterward',
  'again', 'already', 'eventually', 'finally', 'first', 'later', 'now', 'often', 'soon', 'still',
  'sometimes', 'then', 'today', 'usually', 'across', 'amid', 'among', 'beneath', 'behind',
  'throughout', 'unlike', 'according', 'alongside', 'against', 'about', 'above', 'below',
]);
const COMMA_GATED = new Set(['more', 'less', 'most', 'better', 'worse', 'far', 'long', 'much']);
const GATE_WORDS = 10;

// Thresholds mirror src/shared/cadence.ts and src/shared/structure.ts.
const MIN_SENTENCES_CADENCE = 3;
const MIN_WORDS = 55;
const MIN_SPREAD = 0.3;
const MIN_SENTENCES_STRUCTURE = 5;
const SENTENCES_PER_FRONTED = 4;
const MAX_SAME_OPENER = 3;

function measure(text) {
  const sentences = text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
  const lengths = sentences.map(s => s.split(/\s+/).filter(Boolean).length).filter(n => n > 0);
  const words = lengths.reduce((a, b) => a + b, 0);
  const mean = words / (lengths.length || 1);
  const stdev = Math.sqrt(lengths.reduce((s, n) => s + (n - mean) ** 2, 0) / (lengths.length || 1));

  const openers = sentences.map(s => (s.match(/[A-Za-z'’-]+/) ?? [''])[0].toLowerCase());
  const counts = new Map();
  for (const word of openers) counts.set(word, (counts.get(word) ?? 0) + 1);
  const fronted = sentences.filter((s, i) => {
    const word = openers[i];
    if (FRONTED.has(word)) return true;
    if (!COMMA_GATED.has(word)) return false;
    const comma = s.indexOf(',');
    return comma >= 0 && s.slice(0, comma).split(/\s+/).filter(Boolean).length <= GATE_WORDS;
  }).length;

  const spread = stdev / (mean || 1);
  const frontedTarget = Math.ceil(sentences.length / SENTENCES_PER_FRONTED);
  const repeated = Math.max(0, ...counts.values());

  return {
    words,
    sentences: lengths.length,
    mean,
    spread,
    frontedTarget,
    fronted,
    repeated,
    flat: lengths.length >= MIN_SENTENCES_CADENCE && words >= MIN_WORDS && spread < MIN_SPREAD,
    monotone:
      sentences.length >= MIN_SENTENCES_STRUCTURE &&
      (fronted < frontedTarget || repeated >= MAX_SAME_OPENER),
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
const monoBefore = rows.filter(r => r.before.monotone).length;
const monoAfter = rows.filter(r => r.after.monotone).length;
const cleanAfter = rows.filter(r => !r.after.flat && !r.after.monotone).length;

// Regressions are the point: a rewrite that made a signal worse than its input.
const worse = rows.filter(
  r => (!r.before.flat && r.after.flat) || (!r.before.monotone && r.after.monotone),
);

console.log(`\n${rows.length} samples from ${file}\n`);
console.log('signal                       input      output');
console.log('------------------------------------------------');
console.log(`flat pacing            ${pct(flatBefore, rows.length).padStart(10)}${pct(flatAfter, rows.length).padStart(12)}`);
console.log(`same-shaped sentences  ${pct(monoBefore, rows.length).padStart(10)}${pct(monoAfter, rows.length).padStart(12)}`);
console.log(`mean spread            ${avg(rows.map(r => r.before.spread)).toFixed(3).padStart(10)}${avg(rows.map(r => r.after.spread)).toFixed(3).padStart(12)}`);
console.log(`mean fronted openers   ${avg(rows.map(r => r.before.fronted)).toFixed(2).padStart(10)}${avg(rows.map(r => r.after.fronted)).toFixed(2).padStart(12)}`);
console.log(`mean words             ${avg(rows.map(r => r.before.words)).toFixed(0).padStart(10)}${avg(rows.map(r => r.after.words)).toFixed(0).padStart(12)}`);
console.log(`\nclean on both signals: ${cleanAfter} of ${rows.length} (${pct(cleanAfter, rows.length)})`);

if (worse.length) {
  console.log(`\n${worse.length} rewrites made a signal worse than the input:`);
  for (const r of worse) {
    const why = [];
    if (!r.before.flat && r.after.flat) why.push(`pacing ${r.before.spread.toFixed(2)} to ${r.after.spread.toFixed(2)}`);
    if (!r.before.monotone && r.after.monotone) why.push(`openings ${r.before.fronted}/${r.before.frontedTarget} to ${r.after.fronted}/${r.after.frontedTarget}`);
    console.log(`  ${r.topic}: ${why.join(', ')}`);
  }
} else {
  console.log('\nNo rewrite made either signal worse than its input.');
}
console.log('');
