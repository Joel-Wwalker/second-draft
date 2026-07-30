import { beforeEach, expect, test } from 'vitest';
import { PENDING_KEY } from '../src/shared/messages';
import type { PendingSelection } from '../src/shared/messages';
import { discardPendingForTab, handOff } from '../src/background/handoff';

const TAB = 7;
const SELECTED = 'We delve into the plan boldly.';

let store: Record<string, unknown>;
/** What the page answers when asked for its selection, or what it throws. */
let answer: () => unknown;
let openPopup: () => void;
let badges: string[];

beforeEach(() => {
  store = {};
  badges = [];
  answer = () => ({ ok: true, text: SELECTED, canApply: true });
  openPopup = () => {};
  (globalThis as Record<string, unknown>)['chrome'] = {
    tabs: { sendMessage: async (): Promise<unknown> => answer() },
    action: {
      openPopup: async (): Promise<void> => openPopup(),
      setBadgeText: async (details: { text: string }): Promise<void> => void badges.push(details.text),
      setBadgeBackgroundColor: async (): Promise<void> => {},
    },
    storage: {
      local: {
        get: async (key: string): Promise<Record<string, unknown>> =>
          key in store ? { [key]: store[key] } : {},
        set: async (items: Record<string, unknown>): Promise<void> => void Object.assign(store, items),
        remove: async (key: string): Promise<void> => void delete store[key],
      },
    },
  } as unknown as typeof chrome;
});

function parked(): PendingSelection | undefined {
  return store[PENDING_KEY] as PendingSelection | undefined;
}

test('the selected text is parked for the popup, with the tab it came from', async () => {
  await handOff(TAB, 'whatever Chrome supplied');
  expect(parked()).toMatchObject({ kind: 'text', text: SELECTED, canApply: true, tabId: TAB });
  // Stamped so the popup can refuse to run something stale.
  expect(typeof parked()?.at).toBe('number');
});

test('the popup is opened before the page is asked, so the click still counts as a gesture', async () => {
  const order: string[] = [];
  openPopup = (): void => void order.push('openPopup');
  answer = (): unknown => {
    order.push('ask the page');
    return { ok: true, text: SELECTED, canApply: true };
  };
  await handOff(TAB, '');
  expect(order).toEqual(['openPopup', 'ask the page']);
});

test('nothing is read when the page never answers, even though Chrome supplied the text', async () => {
  // A site the user switched the extension off for has no content script, so
  // neither the per-site switch nor the credential guard ever ran. Chrome's own
  // copy of the selection is not a substitute for them.
  answer = (): never => {
    throw new Error('Could not establish connection. Receiving end does not exist.');
  };
  await handOff(TAB, 'Text from a site the extension is switched off for.');
  expect(parked()).toMatchObject({ kind: 'refused', reason: 'unavailable' });
  expect(JSON.stringify(parked())).not.toContain('switched off');
});

test('a credential field parks a refusal and never the digits', async () => {
  answer = (): unknown => ({ ok: false, reason: 'sensitive' });
  await handOff(TAB, '4111111111111111');
  expect(parked()).toMatchObject({ kind: 'refused', reason: 'sensitive' });
  expect(JSON.stringify(parked())).not.toContain('4111');
});

test('a refusal never badges the toolbar, and is dropped when there is no popup to read it', async () => {
  answer = (): unknown => ({ ok: false, reason: 'sensitive' });
  openPopup = (): never => {
    throw new Error('No active browser window.');
  };
  await handOff(TAB, '4111111111111111');
  expect(parked()).toBeUndefined();
  expect(badges).toEqual([]);
});

test("Chrome's copy is used once the page answers that it has no selection of its own", async () => {
  // Canvas editors like Google Docs draw their own text, so there is no DOM
  // selection to read. The page answers 'none', which also confirms the field is
  // not a credential field, and Chrome's copy is all there is. It cannot be
  // written back, so Apply stays hidden.
  answer = (): unknown => ({ ok: false, reason: 'none' });
  await handOff(TAB, 'Text selected inside a Google Doc.');
  expect(parked()).toMatchObject({
    kind: 'text',
    text: 'Text selected inside a Google Doc.',
    canApply: false,
  });
});

test('an empty selection with nothing to fall back on parks a plain refusal', async () => {
  answer = (): unknown => ({ ok: false, reason: 'none' });
  await handOff(TAB, '   ');
  expect(parked()).toMatchObject({ kind: 'refused', reason: 'none' });
});

test('an answer of the wrong shape counts as no answer at all', async () => {
  answer = (): unknown => ({ ok: 'yes', text: 42 });
  await handOff(TAB, 'whatever Chrome supplied');
  expect(parked()).toMatchObject({ kind: 'refused', reason: 'unavailable' });
});

test('text captured but no popup leaves a badge pointing at the toolbar', async () => {
  openPopup = (): never => {
    throw new Error('openPopup requires a user gesture');
  };
  await handOff(TAB, '');
  expect(parked()).toMatchObject({ kind: 'text', text: SELECTED });
  expect(badges).toEqual(['1']);
});

test('opening the popup clears any badge left over from last time', async () => {
  await handOff(TAB, '');
  expect(badges).toEqual(['']);
});

test('closing the tab the text came from throws the text away', async () => {
  await handOff(TAB, '');
  await discardPendingForTab(TAB);
  expect(parked()).toBeUndefined();
});

test('closing some other tab leaves the text alone', async () => {
  await handOff(TAB, '');
  await discardPendingForTab(TAB + 1);
  expect(parked()).toMatchObject({ kind: 'text', tabId: TAB });
});
