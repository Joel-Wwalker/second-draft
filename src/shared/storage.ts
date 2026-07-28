import type { Intensity } from './types';

export interface ByokSettings {
  provider: 'none' | 'anthropic' | 'openai';
  apiKey: string;
  model: string;
  /** OpenAI-compatible endpoints only (OpenAI, OpenRouter, Groq, local Ollama). */
  baseUrl: string;
}

export interface Settings {
  defaultIntensity: Intensity;
  /** Dev/e2e switch: route rewrites through FakeProvider. */
  useFakeProvider: boolean;
  /** Hosts where the selection chip must not appear (e.g. "mail.google.com"). */
  disabledSites: string[];
  /** Writing sample used for voice matching; empty means none. */
  voiceSample: string;
  /** User-defined phrases flagged as tells, one per entry, in addition to the built-in rules. */
  customTells: string[];
  byok: ByokSettings;
}

export const DEFAULT_SETTINGS: Settings = {
  defaultIntensity: 'full',
  useFakeProvider: false,
  disabledSites: [],
  voiceSample: '',
  customTells: [],
  byok: { provider: 'none', apiKey: '', model: '', baseUrl: 'https://api.openai.com/v1' },
};

const KEY = 'settings';

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(KEY);
  const partial = stored[KEY] as (Partial<Settings> & { byok?: Partial<ByokSettings> }) | undefined;
  return {
    ...DEFAULT_SETTINGS,
    ...partial,
    byok: { ...DEFAULT_SETTINGS.byok, ...partial?.byok },
  };
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
