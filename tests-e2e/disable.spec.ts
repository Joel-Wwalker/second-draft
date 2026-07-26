import { expect, setExtensionSettings, test } from './fixtures';

test('disabled site never shows the chip', async ({ context }) => {
  await setExtensionSettings(context, {
    defaultIntensity: 'full',
    useFakeProvider: true,
    disabledSites: ['localhost:8787'],
  });
  const page = await context.newPage();
  await page.goto('http://localhost:8787/page.html');
  await page.locator('#ta').evaluate(el => {
    const ta = el as HTMLTextAreaElement;
    ta.focus();
    ta.setSelectionRange(0, ta.value.length);
  });
  await page.waitForTimeout(600);
  await expect(page.locator('#humanizer-chip-host')).toHaveCount(0);
});
