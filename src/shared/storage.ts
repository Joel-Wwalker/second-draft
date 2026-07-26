import type { Intensity } from './types';

export interface Settings {
  defaultIntensity: Intensity;
  /** Dev/e2e switch: route rewrites through FakeProvider. */
  useFakeProvider: boolean;
  /** Hosts where the selection chip must not appear (e.g. "mail.google.com"). */
  disabledSites: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  defaultIntensity: 'full',
  useFakeProvider: false,
  disabledSites: [],
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

export async function isSiteDisabled(host: string): Promise<boolean> {
  return (await getSettings()).disabledSites.includes(host);
}

export async function toggleSiteDisabled(host: string): Promise<Settings> {
  const settings = await getSettings();
  const disabledSites = settings.disabledSites.includes(host)
    ? settings.disabledSites.filter(h => h !== host)
    : [...settings.disabledSites, host];
  return updateSettings({ disabledSites });
}
