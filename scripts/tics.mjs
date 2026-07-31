// Phrases the engine reaches for again and again across unrelated paragraphs.
//
//   node scripts/tics.mjs [eval/pairs100b.json]
//
// The 100-pair review found "But a closer look shows a..." opening three separate
// history paragraphs and "still disagree about how much" in three more. No single
// rewrite looks wrong: a phrase is only a tic when you can see the whole corpus,
// which is exactly the view a per-paragraph check never has.
//
// Only phrases absent from every source count. A phrase the sources already
// shared is the topic talking, not the engine.
import { readFileSync, existsSync } from 'node:fs';

const IN = process.argv[2] ?? 'eval/pairs100b.json';
if (!existsSync(IN)) {
  console.error(`no ${IN}`);
  process.exit(1);
}
const pairs = JSON.parse(readFileSync(IN, 'utf8'));

const MIN_WORDS = 4;
const MAX_WORDS = 7;
/** A phrase in this many separate paragraphs is a habit rather than a coincidence. */
const MIN_DOCS = 3;

const norm = t =>
  (t ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function grams(text, n) {
  const w = norm(text).split(' ').filter(Boolean);
  const out = [];
  for (let i = 0; i + n <= w.length; i++) out.push(w.slice(i, i + n).join(' '));
  return out;
}

// Every phrase any source used, at any length, so an inherited phrase is never
// blamed on the engine.
const inSources = new Set();
for (const p of pairs) {
  for (let n = MIN_WORDS; n <= MAX_WORDS; n++) for (const g of grams(p.before, n)) inSources.add(g);
}

// Phrase -> the set of paragraphs whose rewrite used it.
const byPhrase = new Map();
for (const p of pairs) {
  for (let n = MIN_WORDS; n <= MAX_WORDS; n++) {
    for (const g of new Set(grams(p.after, n))) {
      if (inSources.has(g)) continue;
      if (!byPhrase.has(g)) byPhrase.set(g, new Set());
      byPhrase.get(g).add(p.index);
    }
  }
}

let found = [...byPhrase.entries()]
  .filter(([, docs]) => docs.size >= MIN_DOCS)
  .map(([phrase, docs]) => ({ phrase, docs: [...docs].sort((a, b) => a - b) }));

// Drop any phrase wholly contained in a longer one that covers the same
// paragraphs, so a single tic is reported once at its full length.
found = found
  .filter(
    a =>
      !found.some(
        b =>
          b.phrase !== a.phrase &&
          b.phrase.includes(a.phrase) &&
          b.docs.length >= a.docs.length,
      ),
  )
  .sort((x, y) => y.docs.length - x.docs.length || y.phrase.length - x.phrase.length);

console.log(`${IN}: ${pairs.length} rewrites\n`);
if (found.length === 0) {
  console.log(`No phrase of ${MIN_WORDS}-${MAX_WORDS} words appears in ${MIN_DOCS}+ rewrites without`);
  console.log('coming from a source. No verbal tics at this threshold.');
} else {
  console.log(`${found.length} phrase(s) the engine wrote into ${MIN_DOCS}+ unrelated paragraphs:\n`);
  for (const { phrase, docs } of found.slice(0, 25)) {
    console.log(`  ${docs.length}x  "${phrase}"`);
    console.log(`       pairs ${docs.join(', ')}`);
  }
}
process.exitCode = found.length > 0 ? 1 : 0;
