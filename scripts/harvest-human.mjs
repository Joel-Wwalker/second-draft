// Collects human-written paragraphs to test the style detectors against.
//
//   node scripts/harvest-human.mjs 1000 > eval/human.json
//
// The detectors claim to spot machine-written prose. The only way to know whether
// they do is to run them over prose a person wrote: whatever they flag there is a
// false positive, and a false positive costs a user a pointless second pass and a
// score that calls their own writing robotic.
//
// Wikipedia article introductions are the control, because they are written and
// edited by people and they sit in the same encyclopedic register as the text this
// extension is usually pointed at. They are not a sample of all English prose and
// are not meant to be.
const WANT = Number(process.argv[2] ?? 200);
const PER_CALL = 20; // the API's generator limit for extracts
const UA = 'second-draft-eval/1.0 (https://github.com/Joel-Wwalker/second-draft)';

const url = new URL('https://en.wikipedia.org/w/api.php');
url.searchParams.set('action', 'query');
url.searchParams.set('generator', 'random');
url.searchParams.set('grnnamespace', '0');
url.searchParams.set('grnlimit', String(PER_CALL));
url.searchParams.set('prop', 'extracts');
url.searchParams.set('explaintext', '1');
url.searchParams.set('exintro', '1');
url.searchParams.set('format', 'json');
url.searchParams.set('formatversion', '2');

const out = [];
const seen = new Set();
let calls = 0;

while (out.length < WANT && calls < Math.ceil((WANT / PER_CALL) * 4)) {
  calls += 1;
  let pages;
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, 'accept-encoding': 'gzip' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    pages = (await res.json()).query?.pages ?? [];
  } catch (err) {
    process.stderr.write(`call ${calls} failed: ${err.message}\n`);
    await new Promise(r => setTimeout(r, 1500));
    continue;
  }

  for (const page of pages) {
    const text = (page.extract ?? '')
      .replace(/\s*\n+\s*/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    // Long enough for the detectors to have an opinion, short enough to be one
    // passage rather than a whole article. Stubs and list articles say nothing
    // about prose rhythm.
    const words = text.split(/\s+/).filter(Boolean).length;
    if (words < 70 || words > 260) continue;
    if (!/[.!?]\s/.test(text)) continue;
    if (seen.has(page.title)) continue;
    seen.add(page.title);
    out.push({ topic: page.title, text });
    if (out.length >= WANT) break;
  }
  // Courtesy pause: this is someone else's free API.
  await new Promise(r => setTimeout(r, 250));
}

process.stderr.write(`collected ${out.length} paragraphs in ${calls} calls\n`);
process.stdout.write(JSON.stringify(out));
