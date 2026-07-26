import { beforeEach, expect, test } from 'vitest';

const store: Record<string, unknown> = {};
(globalThis as Record<string, unknown>)['chrome'] = {
  storage: {
    local: {
      get: async (key: string) => ({ [key]: store[key] }),
      set: async (items: Record<string, unknown>) => {
        Object.assign(store, items);
      },
    },
  },
} as unknown as typeof chrome;

import { DEFAULT_SETTINGS, getSettings, updateSettings } from '../src/shared/storage';

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
});

test('returns defaults when storage is empty', async () => {
  expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
});

test('updateSettings merges a patch and persists it', async () => {
  await updateSettings({ useFakeProvider: true });
  const settings = await getSettings();
  expect(settings.useFakeProvider).toBe(true);
  expect(settings.defaultIntensity).toBe(DEFAULT_SETTINGS.defaultIntensity);
});

test('toggleSiteDisabled adds then removes a host', async () => {
  const { isSiteDisabled, toggleSiteDisabled } = await import('../src/shared/storage');
  await toggleSiteDisabled('example.com');
  expect(await isSiteDisabled('example.com')).toBe(true);
  await toggleSiteDisabled('example.com');
  expect(await isSiteDisabled('example.com')).toBe(false);
});

test('settings stored before disabledSites existed still merge cleanly', async () => {
  const { getSettings } = await import('../src/shared/storage');
  const { DEFAULT_SETTINGS } = await import('../src/shared/storage');
  expect((await getSettings()).disabledSites).toEqual(DEFAULT_SETTINGS.disabledSites);
});
