// Drives the real extension popup, with real Gemini Nano, in a branded Chrome
// over CDP, and prints what a user would see. Branded Chrome ignores the debug
// port on the default profile (136+), so this expects a cloned profile:
//
//   robocopy "%LOCALAPPDATA%/Google/Chrome/User Data" C:/second-draft-pipeline/chrome-user-data ...
//   chrome.exe --user-data-dir=C:/second-draft-pipeline/chrome-user-data --remote-debugging-port=9223
//   node scripts/drive-real.mjs
//
// This closed the seven-identical-reports saga: v1.4.2, the user's exact
// quote-wrapped blob, REWRITTEN, 13 changes, tells 7 to 2.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const EXT = 'mihlinjgoohjemkacomdhggjcjpfilin';
const [blob] = JSON.parse(readFileSync('eval/quoted-input.json', 'utf8'));

const browser = await chromium.connectOverCDP('http://localhost:9223');
const ctx = browser.contexts()[0];

// Ground truth 1: which build is actually loaded, from its own options page.
const opt = await ctx.newPage();
await opt.goto(`chrome-extension://${EXT}/options.html`);
await opt.waitForTimeout(1500);
const version = await opt.locator('#version').textContent().catch(() => '(no version element)');
const nano = await opt.locator('#nanoStatus').textContent().catch(() => '(no status)');
console.log(`[drive] options footer: ${version}`);
console.log(`[drive] on-device line: ${nano}`);
await opt.close();

// Ground truth 2: the popup, driven with the user's exact paste.
const popup = await ctx.newPage();
await popup.goto(`chrome-extension://${EXT}/popup.html`);
await popup.waitForTimeout(800);
await popup.locator('.seg-opt[data-value="full"]').click();
await popup.locator('#input').fill(blob);
await popup.locator('#go').click();
console.log('[drive] humanize clicked; waiting for the run to settle...');
await popup.locator('#status').filter({ hasText: /change|tell|unavailable|minute|error/i }).waitFor({ timeout: 8 * 60_000 });
await popup.waitForTimeout(500);

const headline = (await popup.locator('#headline').textContent()) ?? '';
const status = (await popup.locator('#status').textContent()) ?? '';
const engine = (await popup.locator('#engine').textContent()) ?? '';
const after = (await popup.locator('#out').textContent()) ?? '';

const norm = t => t.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
console.log(`[drive] headline: ${headline}`);
console.log(`[drive] status:   ${status}`);
console.log(`[drive] engine:   ${engine}`);
console.log(`[drive] verdict:  ${norm(after) === norm(blob) ? 'UNCHANGED' : 'REWRITTEN'}`);
console.log(`[drive] output starts: ${after.slice(0, 260)}`);
await popup.close();
await browser.close();
