import { expect, setExtensionSettings, test } from './fixtures';

test('chip appears on textarea selection and Apply replaces the text', async ({ context }) => {
  await setExtensionSettings(context, { defaultIntensity: 'full', useFakeProvider: true, disabledSites: [] });
  const page = await context.newPage();
  await page.goto('http://localhost:8787/page.html');
  await page.locator('#ta').evaluate(el => {
    const ta = el as HTMLTextAreaElement;
    ta.focus();
    ta.setSelectionRange(0, ta.value.length);
  });
  const chip = page.locator('#humanizer-chip-host button');
  await expect(chip).toBeVisible();
  await chip.dispatchEvent('mousedown');
  const card = page.locator('#humanizer-card-host');
  await expect(card.locator('.rewritten')).toContainText('dig into');
  await card.locator('button.apply').click();
  await expect(page.locator('#ta')).toHaveValue(/dig into/);
  await expect(page.locator('#ta')).not.toHaveValue(/—/);
});
