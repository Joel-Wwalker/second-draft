import { expect, setExtensionSettings, test } from './fixtures';

test('contenteditable selection humanizes and applies in place', async ({ context, extensionId }) => {
  await setExtensionSettings(context, extensionId, { defaultIntensity: 'full', useFakeProvider: true, disabledSites: [] });
  const page = await context.newPage();
  await page.goto('http://localhost:8787/page.html');
  await page.locator('#ce').evaluate(el => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  });
  const chip = page.locator('#humanizer-chip-host button');
  await expect(chip).toBeVisible();
  await chip.dispatchEvent('mousedown');
  const card = page.locator('#humanizer-card-host');
  await expect(card.locator('.rewritten')).toContainText('dig into');
  await card.locator('button.apply').click();
  await expect(page.locator('#ce')).toContainText('dig into');
  await expect(page.locator('#ce')).not.toContainText('—');
});
