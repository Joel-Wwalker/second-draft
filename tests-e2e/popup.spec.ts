import { expect, setExtensionSettings, test } from './fixtures';

test('the popup humanizes pasted text and shows what changed', async ({ context, extensionId }) => {
  await setExtensionSettings(context, extensionId, {
    defaultIntensity: 'full',
    useFakeProvider: true,
    disabledSites: [],
  });
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);

  await page.locator('#input').fill('We delve into the vibrant tapestry of plans—boldly and often.');
  await page.locator('#go').click();

  const out = page.locator('#out');
  await expect(out).toContainText('dig into');
  // The enforcement pass runs on the model's output, so no dash survives.
  await expect(out).not.toContainText('—');
  await expect(page.locator('#changesBox')).toBeVisible();
  await expect(page.locator('#engine')).toContainText('Test engine');
});
