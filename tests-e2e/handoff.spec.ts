import { expect, setExtensionSettings, test } from './fixtures';

test('text handed over from a page selection humanizes on its own', async ({ context, extensionId }) => {
  await setExtensionSettings(context, extensionId, {
    defaultIntensity: 'full',
    useFakeProvider: true,
    disabledSites: [],
  });
  // Stand in for the right-click handoff: the background parks the selection and
  // opens the popup, which should pick it up and start without being told.
  const seed = await context.newPage();
  await seed.goto(`chrome-extension://${extensionId}/options.html`);
  await seed.evaluate(() =>
    chrome.storage.local.set({
      pendingSelection: {
        kind: 'text',
        text: 'We delve into the plan—boldly.',
        canApply: false,
        tabId: -1,
        at: Date.now(),
      },
    }),
  );
  await seed.close();

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);

  await expect(page.locator('#input')).toHaveValue(/delve/);
  await expect(page.locator('#out')).toContainText('dig into');
  await expect(page.locator('#out')).not.toContainText('—');
  // Nothing to write back to, so Apply stays hidden.
  await expect(page.locator('#apply')).toBeHidden();
});
