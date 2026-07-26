import type { BackgroundRequest, HumanizeResponse } from '../../shared/messages';
import type { Intensity } from '../../shared/types';
import { getSettings, updateSettings } from '../../shared/storage';

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const input = byId<HTMLTextAreaElement>('input');
const output = byId<HTMLTextAreaElement>('output');
const intensity = byId<HTMLSelectElement>('intensity');
const go = byId<HTMLButtonElement>('go');
const copy = byId<HTMLButtonElement>('copy');
const status = byId<HTMLParagraphElement>('status');
const engineLabel = byId<HTMLSpanElement>('engine');

const ENGINE_LABELS: Record<string, string> = {
  rules: 'Quick clean (no AI engine available)',
  nano: 'On-device AI (Gemini Nano)',
  byok: 'Your API key',
  fake: 'Test engine',
};

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
}

async function run(): Promise<void> {
  const text = input.value.trim();
  if (!text) return;
  go.disabled = true;
  copy.disabled = true;
  output.value = '';
  status.textContent = 'Rewriting...';
  engineLabel.textContent = '';
  try {
    const req: BackgroundRequest = { type: 'humanize', id: crypto.randomUUID(), text, intensity: intensity.value as Intensity };
    const res = (await chrome.runtime.sendMessage(req)) as HumanizeResponse;
    if (res.ok) {
      output.value = res.result.rewritten;
      const label = ENGINE_LABELS[res.result.engine.kind] ?? res.result.engine.kind;
      engineLabel.textContent = res.result.engine.model ? `${label} (${res.result.engine.model})` : label;
      const n = res.result.changes.length;
      status.textContent = `${n} change${n === 1 ? '' : 's'}`;
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
