import path from 'node:path';
import { test, expect, chromium } from '@playwright/test';

/**
 * Where does the Prompt API exist at all?
 *
 * Bundled Chromium has no model, but it has the API surface, and the surface is
 * what this measures: a context that answers 'unavailable' HAS the API, and a
 * context where the global is missing does not. If the popup document lacks the
 * global while a plain web page has it, then the engine's new home never had a
 * chance on any machine, model or no model, and the fix is exposure (a manifest
 * declaration), not architecture.
 */
test('the Prompt API global exists in the popup document, not only in web pages', async () => {
  const dist = path.resolve('.output/chrome-mv3');
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  try {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15_000 });
    const extensionId = new URL(sw.url()).host;

    const probe = async (url: string): Promise<string> => {
      const page = await context.newPage();
      try {
        await page.goto(url);
        return await page.evaluate(async () => {
          const LM = (globalThis as { LanguageModel?: { availability(): Promise<string> } })
            .LanguageModel;
          if (!LM) return 'no-api';
          try {
            return await LM.availability();
          } catch (e) {
            return `error: ${String(e).slice(0, 60)}`;
          }
        });
      } finally {
        await page.close();
      }
    };

    const webPage = await probe('https://example.com');
    const popup = await probe(`chrome-extension://${extensionId}/popup.html`);
    const options = await probe(`chrome-extension://${extensionId}/options.html`);

    console.log(
      `\n=== Prompt API exposure, bundled Chromium ===\n` +
        `  web page:         ${webPage}\n` +
        `  extension popup:  ${popup}\n` +
        `  extension options: ${options}\n`,
    );

    // The claim under test is exposure parity: wherever the API exists for a
    // web page, it must exist for the popup the engine now lives in.
    expect(popup === 'no-api' && webPage !== 'no-api').toBe(false);
  } finally {
    await context.close();
  }
});
