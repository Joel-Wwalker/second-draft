import type { Page } from '@playwright/test';
import { expect, setExtensionSettings, test } from './fixtures';

/**
 * The content script in a real page. Everything here is out of reach of the unit
 * tests: jsdom has no execCommand, so those only ever exercise the Range
 * fallback, and they cannot see whether the page's own undo stack survived.
 */

const PAGE = 'http://localhost:8787/page.html';
const CE_ALL = 'Head stays put. We delve into the vibrant tapestry of plans today. Tail stays put.';
const CE_MIDDLE = 'We delve into the vibrant tapestry of plans today.';
const CE_APPLIED = 'Head stays put. We dig into the plans today. Tail stays put.';
const REWRITE = 'We dig into the plans today.';

const SETTINGS = { defaultIntensity: 'full' as const, useFakeProvider: true, disabledSites: [] };

/** The fixture tab, identified by being the only one with a content script listening. */
async function pageTabId(ext: Page): Promise<number> {
  return ext.evaluate(async () => {
    for (const tab of await chrome.tabs.query({})) {
      if (tab.id === undefined) continue;
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'capture' });
        return tab.id;
      } catch {
        // No content script in this tab, so it is not the fixture page.
      }
    }
    throw new Error('no tab answered a capture request');
  });
}

function ask(ext: Page, tabId: number, msg: unknown): Promise<unknown> {
  return ext.evaluate(({ id, message }) => chrome.tabs.sendMessage(id, message), { id: tabId, message: msg });
}

async function selectWholeTextarea(page: Page): Promise<void> {
  await page.evaluate(() => {
    const ta = document.getElementById('ta') as HTMLTextAreaElement;
    ta.focus();
    ta.setSelectionRange(0, ta.value.length);
  });
}

/** Select only the middle sentence, so the text either side proves it was left alone. */
async function selectMiddleOfEditable(page: Page): Promise<void> {
  await page.evaluate(
    ({ all, middle }) => {
      const ce = document.getElementById('ce') as HTMLElement;
      ce.textContent = all;
      const at = all.indexOf(middle);
      const range = document.createRange();
      range.setStart(ce.firstChild!, at);
      range.setEnd(ce.firstChild!, at + middle.length);
      ce.focus();
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
    },
    { all: CE_ALL, middle: CE_MIDDLE },
  );
}

async function selectParagraph(page: Page): Promise<void> {
  await page.evaluate(() => {
    const p = document.getElementById('para')!;
    const range = document.createRange();
    range.selectNodeContents(p);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  });
}

/** A page tab and an extension tab that can talk to it. */
async function openBoth(
  context: import('@playwright/test').BrowserContext,
  extensionId: string,
): Promise<{ page: Page; ext: Page; tabId: number }> {
  await setExtensionSettings(context, extensionId, SETTINGS);
  const page = await context.newPage();
  await page.goto(PAGE);
  // The options page, not the popup: a popup would consume the parked selection
  // these tests are about handing to the real popup.
  const ext = await context.newPage();
  await ext.goto(`chrome-extension://${extensionId}/options.html`);
  return { page, ext, tabId: await pageTabId(ext) };
}

test('capture hands over a textarea selection from a real page', async ({ context, extensionId }) => {
  const { page, ext, tabId } = await openBoth(context, extensionId);
  await selectWholeTextarea(page);
  const original = await page.locator('#ta').inputValue();
  expect(await ask(ext, tabId, { type: 'capture' })).toEqual({ ok: true, text: original, canApply: true });
});

test('apply writes into a real textarea and undo puts the original back', async ({ context, extensionId }) => {
  const { page, ext, tabId } = await openBoth(context, extensionId);
  await selectWholeTextarea(page);
  const original = await page.locator('#ta').inputValue();

  await ask(ext, tabId, { type: 'capture' });
  expect(await ask(ext, tabId, { type: 'apply', text: REWRITE })).toEqual({ ok: true });
  // Read the live field, not the reply, so a lying reply cannot pass this.
  await expect(page.locator('#ta')).toHaveValue(REWRITE);

  expect(await ask(ext, tabId, { type: 'undo' })).toEqual({ ok: true });
  await expect(page.locator('#ta')).toHaveValue(original);
});

test('a partial contenteditable selection is replaced without disturbing the text around it', async ({
  context,
  extensionId,
}) => {
  const { page, ext, tabId } = await openBoth(context, extensionId);
  await selectMiddleOfEditable(page);

  expect(await ask(ext, tabId, { type: 'capture' })).toEqual({
    ok: true,
    text: CE_MIDDLE,
    canApply: true,
  });
  expect(await ask(ext, tabId, { type: 'apply', text: REWRITE })).toEqual({ ok: true });
  await expect(page.locator('#ce')).toHaveText(CE_APPLIED);

  // Chrome's insertText leaves one text node behind. The Range fallback, which is
  // all jsdom can run, splits the element into three. Seeing one node here is how
  // this test proves the production path ran and not the fallback.
  expect(await page.evaluate(() => document.getElementById('ce')!.childNodes.length)).toBe(1);

  expect(await ask(ext, tabId, { type: 'undo' })).toEqual({ ok: true });
  await expect(page.locator('#ce')).toHaveText(CE_ALL);
});

test("an apply leaves the site's own undo stack intact", async ({ context, extensionId }) => {
  // This is the whole reason insertText is preferred over rewriting the range:
  // the user can press Ctrl+Z in the page afterwards and the site behaves.
  const { page, ext, tabId } = await openBoth(context, extensionId);
  await selectMiddleOfEditable(page);
  await ask(ext, tabId, { type: 'capture' });
  await ask(ext, tabId, { type: 'apply', text: REWRITE });
  await expect(page.locator('#ce')).toHaveText(CE_APPLIED);

  await page.evaluate(() => document.execCommand('undo'));
  await expect(page.locator('#ce')).toHaveText(CE_ALL);
});

test('page text that cannot be written to is handed over but refuses an apply', async ({
  context,
  extensionId,
}) => {
  const { page, ext, tabId } = await openBoth(context, extensionId);
  await selectParagraph(page);
  const paragraph = (await page.locator('#para').textContent())!;

  expect(await ask(ext, tabId, { type: 'capture' })).toEqual({
    ok: true,
    text: paragraph,
    canApply: false,
  });
  expect(await ask(ext, tabId, { type: 'apply', text: REWRITE })).toEqual({ ok: false });
  await expect(page.locator('#para')).toHaveText(paragraph);
});

test('the popup applies its own rewrite to the page and undoes it', async ({ context, extensionId }) => {
  const { page, ext, tabId } = await openBoth(context, extensionId);
  await selectWholeTextarea(page);
  const original = await page.locator('#ta').inputValue();

  // What the background does on a right click: ask the page (which is what arms
  // the apply target), then park the answer for the popup.
  const captured = (await ask(ext, tabId, { type: 'capture' })) as { text: string };
  await ext.evaluate(
    ({ text, id }) =>
      chrome.storage.local.set({
        pendingSelection: { kind: 'text', text, canApply: true, tabId: id, at: Date.now() },
      }),
    { text: captured.text, id: tabId },
  );

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);

  // It starts on its own, with no click.
  await expect(popup.locator('#input')).toHaveValue(original);
  await expect(popup.locator('#out')).toContainText('dig into');
  const rewritten = (await popup.locator('#out').textContent())!;

  await popup.locator('#apply').click();
  await expect(popup.locator('#status')).toContainText('Replaced on the page');
  await expect(page.locator('#ta')).toHaveValue(rewritten);

  await popup.locator('#undo').click();
  await expect(page.locator('#ta')).toHaveValue(original);
});
