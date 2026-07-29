import type {
  BackgroundRequest,
  HumanizeResponse,
  ScanClearRequest,
  ScanClearResponse,
  ScanRequest,
  ScanResponse,
} from '../../shared/messages';
import type { Intensity } from '../../shared/types';
import { getSettings, updateSettings, isSiteDisabled, toggleSiteDisabled } from '../../shared/storage';
import { engineLabel as engineLabelFor, resultStatus } from '../../shared/labels';
import { formatChanges } from '../../shared/change-log';

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const input = byId<HTMLTextAreaElement>('input');
const output = byId<HTMLTextAreaElement>('output');
const intensity = byId<HTMLSelectElement>('intensity');
const go = byId<HTMLButtonElement>('go');
const copy = byId<HTMLButtonElement>('copy');
const status = byId<HTMLParagraphElement>('status');
const engineLabel = byId<HTMLSpanElement>('engine');
const openOptions = byId<HTMLButtonElement>('openOptions');
const changesBox = byId<HTMLDetailsElement>('changesBox');
const changesList = byId<HTMLDivElement>('changesList');
const siteRow = byId<HTMLDivElement>('siteRow');
const siteToggle = byId<HTMLInputElement>('siteToggle');
const siteHost = byId<HTMLSpanElement>('siteHost');
const scanBtn = byId<HTMLButtonElement>('scan');
const scanClearBtn = byId<HTMLButtonElement>('scanClear');
const scanStatus = byId<HTMLParagraphElement>('scanStatus');

void init();

async function init(): Promise<void> {
  const settings = await getSettings();
  intensity.value = settings.defaultIntensity;
  intensity.addEventListener('change', () => {
    void updateSettings({ defaultIntensity: intensity.value as Intensity });
  });
  go.addEventListener('click', () => {
    void run();
  });
  copy.addEventListener('click', () => {
    void navigator.clipboard.writeText(output.value);
  });
  openOptions.addEventListener('click', () => {
    void chrome.runtime.openOptionsPage();
  });
  scanBtn.addEventListener('click', () => {
    void runScan();
  });
  scanClearBtn.addEventListener('click', () => {
    void clearScan();
  });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url;
  if (url && /^https?:/i.test(url)) {
    const host = new URL(url).host;
    siteHost.textContent = host;
    siteToggle.checked = await isSiteDisabled(host);
    siteRow.hidden = false;
    siteToggle.addEventListener('change', () => {
      siteToggle.disabled = true;
      void toggleSiteDisabled(host)
        .catch(() => {
          siteToggle.checked = !siteToggle.checked;
        })
        .finally(() => {
          siteToggle.disabled = false;
        });
    });
  }

  if (settings.byok.provider !== 'none' && settings.byok.apiKey) {
    const model =
      settings.byok.model || (settings.byok.provider === 'anthropic' ? 'claude-sonnet-4-5' : 'gpt-4o-mini');
    engineLabel.textContent = `Your API key (${model})`;
  } else if (typeof LanguageModel !== 'undefined' && LanguageModel) {
    const availability = await LanguageModel.availability().catch(() => 'unavailable' as const);
    engineLabel.textContent =
      availability === 'available'
        ? 'On-device AI ready'
        : 'On-device AI not ready. Open Settings.';
  } else {
    engineLabel.textContent = 'Quick clean only (no AI engine available)';
  }
}

async function run(): Promise<void> {
  const text = input.value.trim();
  if (!text) return;
  go.disabled = true;
  copy.disabled = true;
  output.value = '';
  status.textContent = 'Rewriting...';
  engineLabel.textContent = '';
  changesBox.hidden = true;
  changesBox.open = false;
  changesList.textContent = '';
  try {
    const req: BackgroundRequest = { type: 'humanize', id: crypto.randomUUID(), text, intensity: intensity.value as Intensity };
    const res = (await chrome.runtime.sendMessage(req)) as HumanizeResponse;
    if (res.ok) {
      output.value = res.result.rewritten;
      engineLabel.textContent = engineLabelFor(res.result.engine);
      status.textContent = resultStatus(res.result);
      const rows = formatChanges(res.result, text);
      changesBox.hidden = rows.length === 0;
      for (const row of rows) {
        const item = document.createElement('div');
        item.className = 'chg';
        const why = document.createElement('span');
        why.className = 'why';
        why.textContent = row.reason;
        const line = document.createElement('div');
        const before = document.createElement('s');
        before.className = 'b';
        before.textContent = row.before;
        const arrow = document.createTextNode(' → ');
        const after = document.createElement('span');
        after.className = 'a';
        after.textContent = row.after;
        line.append(before, arrow, after);
        item.append(why, line);
        changesList.append(item);
      }
      copy.disabled = false;
    } else {
      status.textContent = `Error: ${res.message}`;
    }
  } catch (err) {
    status.textContent = `Error: ${String(err)}`;
  } finally {
    go.disabled = false;
  }
}

function pluralize(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

async function runScan(): Promise<void> {
  const tabId = await activeTabId();
  if (tabId === undefined) {
    scanStatus.textContent = 'No active tab to scan.';
    return;
  }
  scanBtn.disabled = true;
  try {
    const req: ScanRequest = { type: 'scan' };
    const res = await chrome.tabs.sendMessage<ScanRequest, ScanResponse>(tabId, req);
    const { tells, blocks, highlightsSupported } = res.summary;
    if (blocks === 0) {
      // Canvas based editors (Google Docs is the common one) draw text as
      // pixels, so there are no paragraphs to read. Say that rather than
      // reporting a zero that looks like a failure.
      scanStatus.textContent =
        'No readable text on this page. Some editors, Google Docs among them, draw text on a canvas, so there is nothing to scan. Paste the text into the box above instead.';
      return;
    }
    let text = `${pluralize(tells, 'tell')} across ${pluralize(blocks, 'paragraph')}.`;
    if (!highlightsSupported) {
      text += ' Highlighting is not supported in this browser, so nothing is marked on the page.';
    }
    scanStatus.textContent = text;
  } catch {
    scanStatus.textContent = "Could not scan this page. It may not support the extension's content script.";
  } finally {
    scanBtn.disabled = false;
  }
}

async function clearScan(): Promise<void> {
  const tabId = await activeTabId();
  if (tabId !== undefined) {
    try {
      const req: ScanClearRequest = { type: 'scan-clear' };
      await chrome.tabs.sendMessage<ScanClearRequest, ScanClearResponse>(tabId, req);
    } catch {
      // No content script listening in this tab; nothing left to clear from the popup's side.
    }
  }
  scanStatus.textContent = '';
}
