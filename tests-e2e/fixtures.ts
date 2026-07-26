import { test as base, chromium, type BrowserContext } from '@playwright/test';
import path from 'node:path';

export const test = base.extend<{ context: BrowserContext; extensionId: string }>({
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
  extensionId: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    await use(new URL(sw.url()).host);
  },
});

export const expect = test.expect;

/** Seed extension settings via a real extension page; never evaluates in the service worker. */
export async function setExtensionSettings(
  context: BrowserContext,
  extensionId: string,
  settings: { defaultIntensity: 'light' | 'full'; useFakeProvider: boolean; disabledSites: string[] },
): Promise<void> {
  const page = await context.newPage();
  try {
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.evaluate(s => chrome.storage.local.set({ settings: s }), settings);
  } finally {
    await page.close();
  }
}
