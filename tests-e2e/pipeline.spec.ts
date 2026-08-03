import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect, chromium } from '@playwright/test';

/**
 * The self-serve loop: the real popup, the real engine, real Gemini Nano, no
 * human in the middle.
 *
 * Runs in Chrome for Testing, which still allows --load-extension where branded
 * Chrome removed it in 137, using a persistent profile outside OneDrive so the
 * on-device model downloads once and stays. Phase one warms the model from the
 * extension's own options page, which is the same origin the popup rewrites
 * from; phase two drives the popup exactly as a person does: paste the text,
 * click Humanize, read what comes back.
 *
 * The paste is the five quote-wrapped paragraphs that produced seven identical
 * silent no-op reports. The assertion is the one that matters: the output is
 * not the input.
 */
const CFT = 'C:/second-draft-pipeline/browsers/chrome/win64-151.0.7922.71/chrome-win64/chrome.exe';
const PROFILE = 'C:/second-draft-pipeline/profile';

test('pipeline: the popup rewrites the quoted five-paragraph blob with real Nano', async () => {
  test.setTimeout(20 * 60_000);
  const dist = path.resolve('.output/chrome-mv3');
  const [blob] = JSON.parse(readFileSync('eval/quoted-input.json', 'utf8')) as [string];

  const context = await chromium.launchPersistentContext(PROFILE, {
    executablePath: CFT,
    headless: false,
    args: [
      `--disable-extensions-except=${dist}`,
      `--load-extension=${dist}`,
      '--no-first-run',
      '--no-default-browser-check',
      // A fresh automation profile has never fetched the on-device model and
      // answers 'unavailable' until the component exists. These opt the profile
      // in; the component itself is fetched from chrome://components below.
      '--enable-features=PromptAPIForGeminiNano,OptimizationGuideOnDeviceModel',
    ],
  });
  try {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 20_000 });
    const extensionId = new URL(sw.url()).host;

    // Phase 1: the model, warmed from the extension origin.
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    let state = await options.evaluate(async () => {
      const LM = (globalThis as { LanguageModel?: { availability(o?: object): Promise<string> } })
        .LanguageModel;
      if (!LM) return 'no-api';
      return LM.availability({
        expectedInputs: [{ type: 'text', languages: ['en'] }],
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
      });
    });
    console.log(`[pipeline] extension-origin availability: ${state}`);
    const recheck = async (): Promise<string> =>
      options.evaluate(async () => {
        const LM = (globalThis as { LanguageModel?: { availability(o?: object): Promise<string> } })
          .LanguageModel;
        if (!LM) return 'no-api';
        return LM.availability({
          expectedInputs: [{ type: 'text', languages: ['en'] }],
          expectedOutputs: [{ type: 'text', languages: ['en'] }],
        });
      });

    if (state === 'no-api') {
      throw new Error('No Prompt API in Chrome for Testing extension pages; pipeline impossible here.');
    }
    if (state === 'unavailable') {
      // The model component was never fetched into this profile. Fetch it the
      // way a person would, from chrome://components, which this browser lets
      // automation drive.
      console.log('[pipeline] model component missing; fetching via chrome://components');
      const components = await context.newPage();
      await components.goto('chrome://components');
      const row = components
        .locator('.component-wrapper, .component')
        .filter({ hasText: /Optimization Guide On Device Model/i })
        .first();
      await expect(row).toBeVisible({ timeout: 10_000 });
      await row.getByRole('button', { name: /check for update/i }).click();
      // Poll the row's status until the component lands; a 2 GB fetch, so log
      // as it goes and give it a quarter hour.
      const started = Date.now();
      for (;;) {
        await components.waitForTimeout(10_000);
        const text = (await row.textContent()) ?? '';
        const version = /Version:?\s*([\d.]+)/i.exec(text)?.[1] ?? '?';
        const status = /Status:?\s*([^\n]+)/i.exec(text)?.[1]?.trim() ?? '?';
        console.log(`[pipeline] component version ${version}; ${status.slice(0, 60)}`);
        if (version !== '?' && version !== '0.0.0.0') break;
        if (Date.now() - started > 15 * 60_000) {
          throw new Error(`component never arrived; last status: ${status}`);
        }
      }
      await components.close();
      // The component registering can take a beat to reach the API's answer.
      for (let i = 0; i < 12 && state !== 'available' && state !== 'downloadable'; i++) {
        await options.waitForTimeout(5_000);
        state = await recheck();
        console.log(`[pipeline] availability now: ${state}`);
      }
      if (state === 'unavailable') {
        throw new Error('component fetched but availability still unavailable');
      }
    }
    if (state !== 'available') {
      console.log('[pipeline] downloading the on-device model; first run only...');
      const landed = await options.evaluate(async () => {
        const LM = (globalThis as {
          LanguageModel?: {
            create(o: object): Promise<{ destroy(): void }>;
          };
        }).LanguageModel!;
        try {
          const session = await LM.create({
            expectedInputs: [{ type: 'text', languages: ['en'] }],
            expectedOutputs: [{ type: 'text', languages: ['en'] }],
            monitor(m: EventTarget) {
              m.addEventListener('downloadprogress', e => {
                const loaded = (e as ProgressEvent).loaded;
                console.log(`model download ${Math.round(loaded * 100)}%`);
              });
            },
          });
          session.destroy();
          return 'ok';
        } catch (e) {
          return `create failed: ${String(e).slice(0, 200)}`;
        }
      });
      console.log(`[pipeline] warm result: ${landed}`);
      if (landed !== 'ok') throw new Error(landed);
    }
    await options.close();

    // Phase 2: the popup, driven like a person.
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.locator('#input').fill(blob);
    // Full intensity is the stored default; make it explicit anyway.
    await popup.locator('.seg-opt[data-value="full"]').click();
    await popup.locator('#go').click();

    // Nano streams; wait for the run to settle rather than for first output.
    await expect(popup.locator('#status')).toContainText(/change|tell|unavailable|error/i, {
      timeout: 10 * 60_000,
    });

    const after = (await popup.locator('#out').textContent()) ?? '';
    const headline = (await popup.locator('#headline').textContent()) ?? '';
    const status = (await popup.locator('#status').textContent()) ?? '';
    const engine = (await popup.locator('#engine').textContent()) ?? '';

    console.log(`[pipeline] headline: ${headline}`);
    console.log(`[pipeline] status:   ${status}`);
    console.log(`[pipeline] engine:   ${engine}`);
    console.log(`[pipeline] output starts: ${after.slice(0, 200)}`);

    const norm = (t: string): string =>
      t.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();

    expect(engine).toContain('Gemini Nano');
    expect(norm(after)).not.toBe(norm(blob));
  } finally {
    await context.close();
  }
});
