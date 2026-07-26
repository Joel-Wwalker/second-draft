import type { Intensity } from './types';

export interface Settings {
  defaultIntensity: Intensity;
  /** Dev/e2e switch: route rewrites through FakeProvider. */
  useFakeProvider: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  defaultIntensity: 'full',
  useFakeProvider: false,
};

const KEY = 'settings';

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(KEY);
  return { ...DEFAULT_SETTINGS, ...(stored[KEY] as Partial<Settings> | undefined) };
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}
