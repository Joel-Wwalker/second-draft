import { DEFAULT_SETTINGS, getSettings, updateSettings } from '../../shared/storage';
import type { EngineStatusRequest, EngineStatusResponse } from '../../shared/messages';
import type { ByokSettings, Settings } from '../../shared/storage';
import type { Intensity } from '../../shared/types';
import { HumanizerError } from '../../shared/types';
import { byokOrigin } from '../../shared/byok-origin';
import { checkVoiceFileName, checkVoiceFileSize, extractDocxText, formatLoadedStatus, truncateVoiceSample } from '../../shared/docx';
import { analyzeWriting } from '../../shared/profile';

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
const voiceFile = byId<HTMLInputElement>('voiceFile');
const voiceFileStatus = byId<HTMLParagraphElement>('voiceFileStatus');
const profilePanel = byId<HTMLDivElement>('profilePanel');
const profileHint = byId<HTMLParagraphElement>('profileHint');
const customTells = byId<HTMLTextAreaElement>('customTells');
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
const PROFILE_DEBOUNCE_MS = 400;
let profileDebounceTimer: ReturnType<typeof setTimeout> | null = null;

void init();

async function init(): Promise<void> {
  const settings = await getSettings();
  byokProvider.value = settings.byok.provider;
  byokKey.value = settings.byok.apiKey;
  byokModel.value = settings.byok.model;
  byokBaseUrl.value = settings.byok.baseUrl;
  voiceSample.value = settings.voiceSample;
  customTells.value = settings.customTells.join('\n');
  defaultIntensity.value = settings.defaultIntensity;
  renderSites(settings);
  syncByokRows();
  renderProfile();
  byokProvider.addEventListener('change', syncByokRows);
  voiceSample.addEventListener('input', () => {
    if (profileDebounceTimer !== null) clearTimeout(profileDebounceTimer);
    profileDebounceTimer = setTimeout(renderProfile, PROFILE_DEBOUNCE_MS);
  });
  voiceFile.addEventListener('change', () => {
    void loadVoiceFile();
  });
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

function renderProfile(): void {
  const profile = analyzeWriting(voiceSample.value);
  profilePanel.textContent = '';
  if (!profile) {
    profilePanel.hidden = true;
    profileHint.hidden = false;
    return;
  }
  profileHint.hidden = true;
  profilePanel.hidden = false;
  const rows: Array<[string, string]> = [
    ['Words', profile.words.toLocaleString('en-US')],
    ['Average sentence', pluralWords(profile.avgSentenceWords)],
    ['Variety', pluralWords(profile.sentenceVariety)],
    ['Contractions', asPercent(profile.contractionRate)],
    // An average, not a fraction: a comma-heavy writer passes one per sentence.
    ['Commas per sentence', profile.commasPerSentence.toFixed(2)],
  ];
  for (const [label, value] of rows) {
    const row = document.createElement('div');
    row.className = 'profile-row';
    const labelEl = document.createElement('span');
    labelEl.className = 'profile-label';
    labelEl.textContent = label;
    const valueEl = document.createElement('span');
    valueEl.className = 'profile-value';
    valueEl.textContent = value;
    row.append(labelEl, valueEl);
    profilePanel.append(row);
  }
}

function pluralWords(n: number): string {
  return `${n} word${n === 1 ? '' : 's'}`;
}

function asPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

async function loadVoiceFile(): Promise<void> {
  const file = voiceFile.files?.[0];
  voiceFile.value = ''; // clear now so picking the same file again still fires "change"
  if (!file) return;

  const nameError = checkVoiceFileName(file.name);
  if (nameError) {
    voiceFileStatus.textContent = nameError;
    return;
  }
  const sizeError = checkVoiceFileSize(file.size);
  if (sizeError) {
    voiceFileStatus.textContent = sizeError;
    return;
  }

  voiceFileStatus.textContent = 'Reading...';
  try {
    const raw = file.name.toLowerCase().endsWith('.docx')
      ? await extractDocxText(await file.arrayBuffer())
      : await file.text();
    const { text, truncated } = truncateVoiceSample(raw);
    voiceSample.value = text;
    renderProfile();
    voiceFileStatus.textContent = formatLoadedStatus(text, file.name, truncated);
  } catch (err) {
    voiceFileStatus.textContent = err instanceof HumanizerError ? err.message : 'Could not read that file.';
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
      customTells: customTells.value.split('\n').filter(line => line.trim() !== ''),
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
  // Ask the background worker, not this window. Rewrites run in the worker, and
  // the two contexts have disagreed in practice: this page said "Ready" while
  // five paragraphs fell back to the rules engine because the worker's answer
  // was not 'available'. Whatever the worker says is what the user will get.
  const fromWorker: unknown = await chrome.runtime
    .sendMessage({ type: 'engine-status' } satisfies EngineStatusRequest)
    .catch(() => null);
  const availability =
    typeof fromWorker === 'object' && fromWorker !== null
      ? String((fromWorker as EngineStatusResponse).availability)
      : 'error';

  if (availability === 'no-api') {
    nanoStatus.textContent =
      typeof LanguageModel === 'undefined'
        ? 'Not supported by this browser (needs Chrome 138 or newer).'
        : 'This page can see the on-device model but the engine cannot. Rewrites will fall back to mechanical fixes; restarting Chrome usually clears this.';
    return;
  }
  if (availability === 'error') {
    nanoStatus.textContent = 'Could not query the on-device model.';
    return;
  }
  nanoStatus.textContent = NANO_LABELS[availability as LanguageModelAvailability] ?? availability;
  nanoDownload.hidden = availability !== 'downloadable';
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
