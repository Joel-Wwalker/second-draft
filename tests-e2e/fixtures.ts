import { test as base, chromium, type BrowserContext } from '@playwright/test';
import path from 'node:path';

export const test = base.extend<{ context: BrowserContext }>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const dist = path.resolve('.output/chrome-mv3');
    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
    });
    await use(context);
    await context.close();
  },
});

export const expect = test.expect;

export async function setExtensionSettings(
  context: BrowserContext,
  settings: { defaultIntensity: 'light' | 'full'; useFakeProvider: boolean; disabledSites: string[] },
): Promise<void> {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  await sw.evaluate(s => chrome.storage.local.set({ settings: s }), settings);
}
