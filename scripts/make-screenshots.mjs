// Renders the screenshots used by the README and the Chrome Web Store listing.
//
// These are generated rather than hand-taken so they can be refreshed after a UI
// change instead of going quietly out of date. Build first, then run:
//
//   npm run build && npm run screenshots
//
// Writes to docs/screenshots/. The composed shots are 1280x800, the size the
// Chrome Web Store wants.
//
// The deterministic test engine runs, so the images are reproducible and the
// engine caption says so.
//
// That caption is wrong for a store listing, and it cannot be fixed here:
// Playwright ships its own Chromium with an empty profile, which has no
// on-device model, so asking for the real engine only downgrades the caption to
// "no AI engine available". A genuine shot has to come from a browser where the
// model is installed.
//
// So: capture the popup yourself in that browser, save it as
// docs/screenshots/popup-real.png, and this script will frame that instead of
// its own render. Any size works; only the aspect ratio shows.
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const OUT = 'docs/screenshots';
const DIST = path.resolve('.output/chrome-mv3');

// Chosen to trip several rules at once, including the four the code fixes
// outright (em dash, curly quotes, emoji, chatbot filler), so the shot shows a
// realistic set of edits rather than the single word the test engine swaps.
const SAMPLE =
  'It’s important to note that our growth has been transformative — we ' +
  'delve into the vibrant tapestry of remote work, fostering robust alignment ' +
  'across teams. \u{1F680} We grew from 4 to 31 people between 2021 and 2024.';

mkdirSync(OUT, { recursive: true });

const ctx = await chromium.launchPersistentContext('', {
  headless: false,
  args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
  deviceScaleFactor: 2,
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');
const id = new URL(sw.url()).host;

const seed = await ctx.newPage();
await seed.goto(`chrome-extension://${id}/options.html`);
await seed.evaluate(() =>
  chrome.storage.local.set({
    settings: {
      defaultIntensity: 'full',
      useFakeProvider: true,
      disabledSites: [],
      voiceSample: '',
      customTells: [],
    },
  }),
);
await seed.close();

/** Screenshot the popup, cropped to its content rather than the viewport. */
async function popupShot(file, { expandChanges = false } = {}) {
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 460, height: 1000 });
  await page.goto(`chrome-extension://${id}/popup.html`);
  await page.locator('#input').fill(SAMPLE);
  await page.locator('#go').click();
  await page.locator('#out').waitFor({ timeout: 60_000 });
  const box = page.locator('#changesBox');
  const open = await box.evaluate(el => el.open);
  if (expandChanges !== open) await page.locator('#changesBox summary').click();
  await page.waitForTimeout(350);
  const clip = await page.evaluate(() => {
    const rect = document.body.getBoundingClientRect();
    return { x: 0, y: 0, width: Math.ceil(rect.width), height: Math.ceil(rect.height) };
  });
  await page.screenshot({ path: path.join(OUT, file), clip });
  await page.close();
}

await popupShot('popup.png');
await popupShot('popup-changes.png', { expandChanges: true });

const options = await ctx.newPage();
await options.setViewportSize({ width: 760, height: 1100 });
await options.goto(`chrome-extension://${id}/options.html`);
await options.waitForTimeout(300);
await options.screenshot({ path: path.join(OUT, 'options.png'), fullPage: true });
await options.close();

function frameHtml(source, headline, sub) {
  const data = readFileSync(path.join(OUT, source)).toString('base64');
  return `<!doctype html><meta charset="utf-8"><style>
    :root { color-scheme: light }
    * { margin: 0; box-sizing: border-box }
    body { width: 1280px; height: 800px; display: flex; align-items: center;
      justify-content: center; gap: 72px; padding: 0 60px; background: #f6f7fb;
      font: 16px/1.5 system-ui, sans-serif; color: #0f172a; overflow: hidden }
    .copy { max-width: 390px; flex: none }
    h1 { font-size: 43px; line-height: 1.08; letter-spacing: -0.025em; font-weight: 700;
      text-wrap: balance }
    p { margin-top: 18px; font-size: 18px; color: #55637a }
    .mark { display: inline-flex; align-items: center; gap: 10px; margin-bottom: 24px;
      font-size: 13.5px; font-weight: 650; letter-spacing: 0.03em; color: #4f46e5 }
    .mark i { width: 9px; height: 9px; border-radius: 3px; background: #4f46e5 }
    img { width: 420px; display: block; border-radius: 14px;
      box-shadow: 0 20px 44px rgba(15,23,42,.16), 0 2px 6px rgba(15,23,42,.08) }
  </style>
  <body>
    <div class="copy">
      <div class="mark"><i></i>SECOND DRAFT</div>
      <h1>${headline}</h1>
      <p>${sub}</p>
    </div>
    <img src="data:image/png;base64,${data}" alt="">
  </body>`;
}

/** The retina copy, for the README and the landing page. */
async function storeFrame(source, out, headline, sub) {
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.setContent(frameHtml(source, headline, sub));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, out) });
  await page.close();
}

/**
 * The copy the Chrome Web Store will accept, which the retina PNG above is not:
 * the store wants exactly 1280x800 or 640x400, and a PNG with no alpha channel. A
 * 2x screenshot is 2560x1600, so this renders at 1x in a plain browser.
 *
 * The alpha rule takes care of itself: the frame's background is opaque, so
 * Chromium writes a 24-bit PNG rather than RGBA. PNG over JPEG because the image
 * is mostly text, where lossless wins.
 */
async function storeUpload(source, out, headline, sub) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    await page.setContent(frameHtml(source, headline, sub));
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, out) });
  } finally {
    await browser.close();
  }
}

// A hand-captured shot from a browser with the on-device model wins, because its
// engine caption is the one a real user sees.
const REAL = 'popup-real.png';
const heroSource = existsSync(path.join(OUT, REAL)) ? REAL : 'popup.png';
console.log(
  heroSource === REAL
    ? `framing your own ${REAL}`
    : `framing the test-engine render; drop ${REAL} in ${OUT}/ to use a real one`,
);

const HERO_HEADLINE = 'Text that reads like you wrote it';
const HERO_SUB = 'Select anything, right click, and the rewrite starts on its own. Runs on your device.';

await storeFrame(heroSource, 'hero.png', HERO_HEADLINE, HERO_SUB);
await storeUpload(heroSource, 'store-screenshot.png', HERO_HEADLINE, HERO_SUB);
await storeFrame(
  'popup-changes.png',
  'hero-changes.png',
  'See every edit, and why',
  'Each change is listed as old text to new text, with the pattern it removed.',
);

await ctx.close();
console.log(`wrote screenshots to ${OUT}/`);
