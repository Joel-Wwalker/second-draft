import { PENDING_KEY, isCaptureResponse } from '../shared/messages';
import type { CaptureRequest, PendingRefusal, PendingSelection } from '../shared/messages';
import { isSiteDisabled } from '../shared/storage';

/** Built by WXT from src/entrypoints/page.ts, and deliberately not in the manifest. */
const PAGE_SCRIPT = 'page.js';

/**
 * Handing a page selection to the popup. This lives outside the background
 * entrypoint so it can be tested directly: the per-site switch and the
 * credential guard both depend on getting the "the page did not answer" case
 * right, and that case is easy to get wrong and impossible to see.
 */

/**
 * Shared by the context menu and the keyboard shortcut. Open the popup, ask the
 * page what is selected, and park the answer for the popup to pick up.
 *
 * The popup is opened first and everything else follows, because openPopup()
 * needs the click's user gesture and every await spends it. The popup therefore
 * starts empty and waits a moment for the text to land.
 *
 * openPopup() is also not available in every Chrome build. That is not fatal:
 * the text stays parked and a badge tells the user to click the toolbar icon.
 */
export async function handOff(tabId: number, fallbackText: string): Promise<void> {
  let opened = true;
  try {
    await chrome.action.openPopup();
  } catch {
    opened = false;
  }

  const blocked = await attach(tabId);
  const pending = blocked ? refuse(blocked) : await capture(tabId, fallbackText);
  if (pending.kind === 'refused') {
    // Park the reason only if someone is watching. Never badge a refusal: a
    // toolbar badge over a password field would be the opposite of reassuring.
    if (opened) await chrome.storage.local.set({ [PENDING_KEY]: pending });
    return;
  }

  await chrome.storage.local.set({ [PENDING_KEY]: pending });
  if (opened) {
    void chrome.action.setBadgeText({ text: '' });
  } else {
    void chrome.action.setBadgeBackgroundColor({ color: '#4f46e5' });
    void chrome.action.setBadgeText({ text: '1' });
  }
}

function refuse(reason: PendingRefusal): PendingSelection {
  return { kind: 'refused', reason, at: Date.now() };
}

/**
 * Put the page script in place, and refuse before doing so if this site is one
 * the user turned off.
 *
 * The script is injected here rather than declared in the manifest, so the
 * extension asks for activeTab instead of access to every page. The gesture that
 * got us here is what grants that access, and it lasts until the tab navigates,
 * which covers the later Apply and Undo from the popup.
 *
 * Checking the switch before injecting is stronger than the old arrangement,
 * where the script loaded everywhere and then declined to listen.
 */
async function attach(tabId: number): Promise<PendingRefusal | null> {
  let url: string | undefined;
  try {
    url = (await chrome.tabs.get(tabId)).url;
  } catch {
    return 'unavailable';
  }
  // Restricted pages, and anything without an ordinary web address, cannot take
  // the script and have no selection worth reading.
  if (!url || !/^https?:/i.test(url)) return 'unavailable';
  if (await isSiteDisabled(new URL(url).host)) return 'disabled';

  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: [PAGE_SCRIPT] });
  } catch {
    return 'unavailable';
  }
  return null;
}

/**
 * Ask the page for its selection.
 *
 * Chrome hands the context menu its own copy of the selected text, which is
 * tempting as a fallback but is only safe once the content script has answered.
 * The per-site switch and the credential guard both live in that script, so a
 * round trip that throws means "cannot confirm this is safe to read", not
 * "assume it is". Using Chrome's copy in that case would read selections on
 * sites the user turned the extension off for, and out of card-number fields.
 */
async function capture(tabId: number, fallbackText: string): Promise<PendingSelection> {
  const at = Date.now();
  let res: unknown;
  try {
    res = await chrome.tabs.sendMessage<CaptureRequest, unknown>(tabId, { type: 'capture' });
  } catch {
    return { kind: 'refused', reason: 'unavailable', at };
  }
  if (!isCaptureResponse(res)) return { kind: 'refused', reason: 'unavailable', at };

  if (res.ok) {
    return res.text.trim()
      ? { kind: 'text', text: res.text, canApply: res.canApply, tabId, at }
      : { kind: 'refused', reason: 'none', at };
  }
  if (res.reason === 'sensitive') return { kind: 'refused', reason: 'sensitive', at };

  // The script answered, and answered that the field is not sensitive. Chrome's
  // copy of the selection is safe to use now, and it is the only thing that
  // works in canvas editors like Google Docs, where the page has no selection
  // the DOM can see. It cannot be written back, so Apply stays hidden.
  return fallbackText.trim()
    ? { kind: 'text', text: fallbackText, canApply: false, tabId, at }
    : { kind: 'refused', reason: 'none', at };
}

/** Parked text belongs to one tab. Drop it when that tab goes away. */
export async function discardPendingForTab(tabId: number): Promise<void> {
  const stored = await chrome.storage.local.get(PENDING_KEY);
  const parked = stored[PENDING_KEY] as PendingSelection | undefined;
  if (parked?.kind === 'text' && parked.tabId === tabId) await discardPending();
}

export async function discardPending(): Promise<void> {
  await chrome.storage.local.remove(PENDING_KEY);
  void chrome.action.setBadgeText({ text: '' });
}
