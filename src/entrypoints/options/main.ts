import { DEFAULT_SETTINGS, getSettings, updateSettings } from '../../shared/storage';
import type { ByokSettings, Settings } from '../../shared/storage';
import type { Intensity } from '../../shared/types';
import { byokOrigin } from '../../shared/byok-origin';

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const nanoStatus = byId<HTMLParagraphElement>('nanoStatus');
const nanoDownload = byId<HTMLButtonElement>('nanoDownload');
const byokProvider = byId<HTMLSelectElement>('byokProvider');
const keyRow = byId<HTMLLabelElement>('keyRow');
const modelRow = byId<HTMLLabelElement>('modelRow');
const baseUrlRow = byId<HTMLLabelElement>('baseUrlRow');
const byokKey = byId<HTMLInputElement>('byokKey');
const byokModel = byId<HTMLInputElement>('byokModel');
const byokBaseUrl = byId<HTMLInputElement>('byokBaseUrl');
const voiceSample = byId<HTMLTextAreaElement>('voiceSample');
const defaultIntensity = byId<HTMLSelectElement>('defaultIntensity');
const siteList = byId<HTMLUListElement>('siteList');
const noSites = byId<HTMLParagraphElement>('noSites');
const saveBtn = byId<HTMLButtonElement>('save');
const saveStatus = byId<HTMLSpanElement>('saveStatus');

const NANO_LABELS: Record<LanguageModelAvailability, string> = {
  available: 'Ready. Rewrites run on this device.',
  downloadable: 'Supported, but the model is not downloaded yet.',
  downloading: 'Downloading the model...',
  unavailable: 'Not supported on this device.',
};

const DEFAULT_MODELS = { anthropic: 'claude-sonnet-4-5', openai: 'gpt-4o-mini' } as const;

void init();

async function init(): Promise<void> {
  const settings = await getSettings();
  byokProvider.value = settings.byok.provider;
  byokKey.value = settings.byok.apiKey;
  byokModel.value = settings.byok.model;
  byokBaseUrl.value = settings.byok.baseUrl;
  voiceSample.value = settings.voiceSample;
  defaultIntensity.value = settings.defaultIntensity;
  renderSites(settings);
  syncByokRows();
  byokProvider.addEventListener('change', syncByokRows);
  saveBtn.addEventListener('click', () => {
    void save();
  });
  nanoDownload.addEventListener('click', () => {
    void downloadNano();
  });
  void refreshNano();
}

function syncByokRows(): void {
  const provider = byokProvider.value as ByokSettings['provider'];
  keyRow.hidden = provider === 'none';
  modelRow.hidden = provider === 'none';
  baseUrlRow.hidden = provider !== 'openai';
  if (provider !== 'none' && byokModel.value.trim() === '') {
    byokModel.placeholder = DEFAULT_MODELS[provider];
  }
}

async function save(): Promise<void> {
  saveBtn.disabled = true;
  saveStatus.textContent = 'Saving...';
  try {
    const provider = byokProvider.value as ByokSettings['provider'];
    const byok: ByokSettings = {
      provider,
      apiKey: byokKey.value.trim(),
      model: byokModel.value.trim(),
      baseUrl: byokBaseUrl.value.trim() || DEFAULT_SETTINGS.byok.baseUrl,
    };
    if (provider !== 'none' && byok.apiKey) {
      const granted = await requestByokPermission(byok);
      if (!granted) {
        saveStatus.textContent = 'Permission for the API domain was not granted; the key was saved but rewrites will fail until it is.';
      }
    }
    await updateSettings({
      byok,
      voiceSample: voiceSample.value,
      defaultIntensity: defaultIntensity.value as Intensity,
    });
    if (saveStatus.textContent === 'Saving...') saveStatus.textContent = 'Saved.';
  } catch {
    saveStatus.textContent = 'Save failed. Try again.';
  } finally {
    saveBtn.disabled = false;
  }
}

async function requestByokPermission(byok: ByokSettings): Promise<boolean> {
  const origin = byokOrigin(byok);
  if (!origin) return false;
  try {
    return await chrome.permissions.request({ origins: [origin] });
  } catch {
    return false;
  }
}

function renderSites(settings: Settings): void {
  siteList.textContent = '';
  noSites.hidden = settings.disabledSites.length > 0;
  for (const host of settings.disabledSites) {
    const li = document.createElement('li');
    li.textContent = host;
    const remove = document.createElement('button');
    remove.textContent = 'Enable';
    remove.addEventListener('click', () => {
      void updateSettings({ disabledSites: settings.disabledSites.filter(h => h !== host) }).then(next => {
        renderSites(next);
      });
    });
    li.append(remove);
    siteList.append(li);
  }
}

async function refreshNano(): Promise<void> {
  if (typeof LanguageModel === 'undefined' || !LanguageModel) {
    nanoStatus.textContent = 'Not supported by this browser (needs Chrome 138 or newer).';
    return;
  }
  try {
    const availability = await LanguageModel.availability();
    nanoStatus.textContent = NANO_LABELS[availability];
    nanoDownload.hidden = availability !== 'downloadable';
  } catch {
    nanoStatus.textContent = 'Could not query the on-device model.';
  }
}

async function downloadNano(): Promise<void> {
  if (typeof LanguageModel === 'undefined' || !LanguageModel) return;
  nanoDownload.disabled = true;
  try {
    const session = await LanguageModel.create({
      monitor(monitor) {
        monitor.addEventListener('downloadprogress', event => {
          const loaded = (event as ProgressEvent).loaded;
          nanoStatus.textContent = `Downloading: ${Math.round(loaded * 100)}%`;
        });
      },
    });
    session.destroy();
  } catch {
    nanoStatus.textContent = 'Download failed. Check your connection and disk space.';
  } finally {
    nanoDownload.disabled = false;
    void refreshNano();
  }
}
