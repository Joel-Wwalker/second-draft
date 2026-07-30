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
let tabUrl: string | undefined;
let inject: () => void;
let badges: string[];
/** Everything the background did to the tab, in order. */
let order: string[];

beforeEach(() => {
  store = {};
  badges = [];
  order = [];
  tabUrl = 'https://example.com/article';
  answer = () => ({ ok: true, text: SELECTED, canApply: true });
  openPopup = () => {};
  inject = () => {};
  (globalThis as Record<string, unknown>)['chrome'] = {
    tabs: {
      get: async (): Promise<{ url: string | undefined }> => {
        if (tabUrl === undefined) throw new Error('No tab with that id.');
        return { url: tabUrl };
      },
      sendMessage: async (): Promise<unknown> => {
        order.push('ask the page');
        return answer();
      },
    },
    scripting: {
      executeScript: async (): Promise<void> => {
        order.push('inject');
        inject();
      },
    },
    action: {
      openPopup: async (): Promise<void> => {
        order.push('openPopup');
        openPopup();
      },
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

function turnOff(...hosts: string[]): void {
  store['settings'] = { disabledSites: hosts };
}

test('the selected text is parked for the popup, with the tab it came from', async () => {
  await handOff(TAB, 'whatever Chrome supplied');
  expect(parked()).toMatchObject({ kind: 'text', text: SELECTED, canApply: true, tabId: TAB });
  // Stamped so the popup can refuse to run something stale.
  expect(typeof parked()?.at).toBe('number');
});

test('the page script is injected on the gesture, before the page is asked anything', async () => {
  await handOff(TAB, '');
  // openPopup first so the click's gesture is still unspent, then the script has
  // to be in place before a message can reach it.
  expect(order).toEqual(['openPopup', 'inject', 'ask the page']);
});

test('a site the user turned off is never injected into and never read', async () => {
  turnOff('example.com');
  await handOff(TAB, 'Text from a site the extension is switched off for.');
  expect(parked()).toMatchObject({ kind: 'refused', reason: 'disabled' });
  expect(order).toEqual(['openPopup']); // no inject, no ask
  expect(JSON.stringify(parked())).not.toContain('switched off');
});

test('turning one site off leaves other sites working', async () => {
  turnOff('mail.google.com');
  await handOff(TAB, '');
  expect(parked()).toMatchObject({ kind: 'text', text: SELECTED });
});

test('a page Chrome will not let extensions touch is refused without injecting', async () => {
  tabUrl = 'chrome://settings/';
  await handOff(TAB, 'text Chrome offered anyway');
  expect(parked()).toMatchObject({ kind: 'refused', reason: 'unavailable' });
  expect(order).toEqual(['openPopup']);
  expect(JSON.stringify(parked())).not.toContain('offered anyway');
});

test('an injection that fails reads nothing, whatever Chrome supplied', async () => {
  inject = (): never => {
    throw new Error('Cannot access contents of the page.');
  };
  await handOff(TAB, 'Text from a page that refused the script.');
  expect(parked()).toMatchObject({ kind: 'refused', reason: 'unavailable' });
  expect(JSON.stringify(parked())).not.toContain('refused the script');
});

test('nothing is read when the page never answers, even though Chrome supplied the text', async () => {
  // The script went in but nothing came back. The credential guard lives in that
  // script, so silence means "cannot confirm this is safe to read".
  answer = (): never => {
    throw new Error('Could not establish connection. Receiving end does not exist.');
  };
  await handOff(TAB, 'Text from a page that went quiet.');
  expect(parked()).toMatchObject({ kind: 'refused', reason: 'unavailable' });
  expect(JSON.stringify(parked())).not.toContain('went quiet');
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
