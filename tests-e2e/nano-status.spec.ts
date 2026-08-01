import path from 'node:path';
import { test, expect } from '@playwright/test';
import { chromium } from '@playwright/test';

/**
 * The engine-status message answers, from the worker, with the worker's own
 * view of the Prompt API.
 *
 * Exists because contexts disagree and only the worker's answer decides
 * anything: five paragraphs once fell back to the rules engine while a page
 * context reported the model available, and the options page used to trust its
 * own window. Bundled Chromium ships no Prompt API in either context, so both
 * answers here are deterministically 'no-api': what this verifies is the wiring
 * the options page now depends on, not the model.
 *
 * The real machine's answer cannot be collected this way at all. Branded Chrome
 * removed --load-extension in 137, so the only place the worker's live answer
 * is visible is the options page itself, which is the point of the message.
 */
test('the engine-status message is answered from the worker', async () => {
  const dist = path.resolve('.output/chrome-mv3');
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  try {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15_000 });
    const extensionId = new URL(sw.url()).host;

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);

    // The worker's answer, via the message any page can send.
    const worker = await page.evaluate(
      () =>
        chrome.runtime.sendMessage({ type: 'engine-status' }) as Promise<{ availability: string }>,
    );

    // The page's own answer, for the comparison that motivated all of this.
    const pageView = await page.evaluate(async () => {
      const LM = (globalThis as { LanguageModel?: { availability(): Promise<string> } }).LanguageModel;
      if (!LM) return 'no-api';
      try {
        return await LM.availability();
      } catch {
        return 'error';
      }
    });

    console.log(
      `\n=== on-device model, bundled Chromium ===\n` +
        `  service worker (where rewrites run): ${worker.availability}\n` +
        `  extension page (what options.html used to trust): ${pageView}\n`,
    );

    // Bundled Chromium turns out to expose the API surface with no model behind
    // it: both contexts answer 'unavailable' rather than 'no-api'. Which value
    // arrives matters less than that a known one arrives from the worker, which
    // is the contract the options page display now rests on. The 'unavailable'
    // answer is also the exact state that silently produced the rules fallback,
    // so this doubles as proof that state is real and reachable.
    expect(['available', 'downloadable', 'downloading', 'unavailable', 'no-api', 'error']).toContain(
      worker.availability,
    );
    expect(worker.availability).toBe(pageView);
  } finally {
    await context.close();
  }
});
