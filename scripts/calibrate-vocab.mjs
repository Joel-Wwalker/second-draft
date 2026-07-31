// Scores candidate AI-vocabulary words one at a time before any of them ship.
//
//   node scripts/calibrate-vocab.mjs
//
// A word earns its place by appearing far more often in machine prose than in
// human prose. The last hand-picked signal that skipped this step flagged three
// quarters of human writing, so nothing goes in the list on taste alone.
//
// Human side: 1000 Wikipedia introductions. Machine side: the source paragraphs
// from the 100-pair batch, which the on-device model wrote to order.
import { readFileSync } from 'node:fs';

const human = JSON.parse(readFileSync('eval/human.json', 'utf8')).map(h => h.text ?? h);
const machine = JSON.parse(readFileSync('eval/pairs100.json', 'utf8')).map(p => p.before ?? '');

// Everything the 100-pair review named, plus the rest of the family each one
// belongs to. Grouped so a rejected word does not take its neighbours with it.
const CANDIDATES = {
  meticulous: /\bmeticulous(?:ly)?\b/gi,
  ultimately: /\bultimately\b/gi,
  consequently: /\bconsequently\b/gi,
  exacerbate: /\bexacerbat(?:e|es|ed|ing)\b/gi,
  proactive: /\bproactive(?:ly)?\b/gi,
  nuance: /\bnuanc(?:e|es|ed)\b/gi,
  compounded: /\bcompound(?:ed|ing)\b/gi,
  navigate: /\bnavigat(?:e|es|ed|ing)\b/gi,
  landscape: /\blandscape\b/gi,
  realm: /\brealm\b/gi,
  myriad: /\bmyriad\b/gi,
  plethora: /\bplethora\b/gi,
  facilitate: /\bfacilitat(?:e|es|ed|ing)\b/gi,
  leverage: /\bleverag(?:e|es|ed|ing)\b/gi,
  robust: /\brobust\b/gi,
  seamless: /\bseamless(?:ly)?\b/gi,
  streamline: /\bstreamlin(?:e|es|ed|ing)\b/gi,
  holistic: /\bholistic(?:ally)?\b/gi,
  paradigm: /\bparadigm\b/gi,
  multifaceted: /\bmultifaceted\b/gi,
  profound: /\bprofound(?:ly)?\b/gi,
  invaluable: /\binvaluable\b/gi,
  paramount: /\bparamount\b/gi,
  noteworthy: /\bnoteworthy\b/gi,
  significantly: /\bsignificantly\b/gi,
  substantially: /\bsubstantially\b/gi,
  notably: /\bnotably\b/gi,
  arguably: /\barguably\b/gi,
  essentially: /\bessentially\b/gi,
  effectively: /\beffectively\b/gi,
  'in-terms-of': /\bin terms of\b/gi,
  'a-testament': /\ba testament\b/gi,
  'plays-a-role': /\bplays? an? (?:\w+ )?role\b/gi,
  'serves-as': /\bserves? as\b/gi,
  'sheds-light': /\bshed(?:s|ding)? light\b/gi,
  'stands-as': /\bstands? as\b/gi,
  'when-it-comes-to': /\bwhen it comes to\b/gi,
  'it-is-worth-noting': /\bit is worth noting\b/gi,
  'a-double-edged': /\bdouble[- ]edged\b/gi,
  'the-fact-that': /\bthe fact that\b/gi,
  'rich-history': /\brich (?:history|tradition|tapestry|cultural)\b/gi,
  'deep-understanding': /\bdeep(?:er)? understanding\b/gi,
  'far-reaching': /\bfar[- ]reaching\b/gi,
  'ever-evolving': /\bever[- ](?:evolving|changing|growing)\b/gi,
  'complex-interplay': /\bcomplex (?:interplay|relationship|web)\b/gi,
};

const rate = (docs, re) =>
  docs.filter(d => {
    re.lastIndex = 0;
    return re.test(d);
  }).length / docs.length;

const rows = Object.entries(CANDIDATES).map(([name, re]) => {
  const h = rate(human, re);
  const m = rate(machine, re);
  return { name, h, m, lift: h === 0 ? (m > 0 ? Infinity : 0) : m / h };
});

rows.sort((a, b) => b.lift - a.lift || b.m - a.m);

const pc = n => `${(n * 100).toFixed(1)}%`;
console.log(`human n=${human.length}  machine n=${machine.length}\n`);
console.log('word                   human    machine   lift   verdict');
for (const r of rows) {
  // Keep a word when it is rare in human prose and common in machine prose.
  // Under 3% human is the bar the calibrated diction and cadence thresholds
  // already meet; 3x lift keeps out words that are simply common everywhere.
  const keep = r.h <= 0.03 && r.m >= 0.02 && r.lift >= 3;
  const verdict = keep ? 'KEEP' : r.h > 0.03 ? 'reject: common in human prose' : 'reject: rare in machine prose';
  console.log(
    `${r.name.padEnd(22)} ${pc(r.h).padStart(6)}  ${pc(r.m).padStart(7)}  ${
      (r.lift === Infinity ? 'inf' : r.lift.toFixed(1)).padStart(5)
    }   ${verdict}`,
  );
}
console.log(`\nKEEP list: ${rows.filter(r => r.h <= 0.03 && r.m >= 0.02 && r.lift >= 3).map(r => r.name).join(' ')}`);
