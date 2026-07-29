import { humanize } from '../engine';
import { FakeProvider } from '../engine/providers/fake';
import { NanoProvider } from '../engine/providers/nano';
import { AnthropicProvider } from '../engine/providers/anthropic';
import { OpenAIProvider } from '../engine/providers/openai';
import { getSettings } from '../shared/storage';
import type { Settings } from '../shared/storage';
import { redactError } from '../shared/redact';
import { HumanizerError } from '../shared/types';
import type { Intensity, Provider } from '../shared/types';
import { HUMANIZE_PORT, PENDING_KEY, isCancelRequest, isHumanizeRequest } from '../shared/messages';
import type { CaptureRequest, CaptureResponse, HumanizeResponse, PortServerMessage } from '../shared/messages';

export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: 'humanize-selection',
        title: 'Humanize selection',
        contexts: ['selection'],
      });
    });
  });

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== 'humanize-selection' || tab?.id === undefined) return;
    void handOff(tab.id, info.selectionText ?? '');
  });

  // Keyboard shortcut (default Ctrl+Shift+H, see wxt.config.ts). Chrome gives no
  // selection text here, so the content script reads the live selection itself.
  chrome.commands.onCommand.addListener((command, tab) => {
    if (command !== 'humanize-selection' || tab?.id === undefined) return;
    void handOff(tab.id, '');
  });

  // One-shot path (popup).
  chrome.runtime.onMessage.addListener(
    (msg: unknown, sender, sendResponse: (res: HumanizeResponse) => void) => {
      if (sender.id !== chrome.runtime.id) return;
      if (!isHumanizeRequest(msg)) return;
      void runHumanize(msg.text, msg.intensity).then(sendResponse).catch(() => {});
      return true; // async response
    },
  );

  // Streaming path (content-script card).
  chrome.runtime.onConnect.addListener(port => {
    if (port.sender?.id !== chrome.runtime.id || port.name !== HUMANIZE_PORT) return;
    const running = new Map<string, AbortController>();

    port.onMessage.addListener((msg: unknown) => {
      if (isCancelRequest(msg)) {
        running.get(msg.id)?.abort();
        running.delete(msg.id);
        return;
      }
      if (!isHumanizeRequest(msg)) return;
      const ctl = new AbortController();
      running.set(msg.id, ctl);
      void runHumanize(msg.text, msg.intensity, ctl.signal, textSoFar => {
        post(port, { type: 'chunk', id: msg.id, textSoFar });
      }).then(res => {
        if (!running.delete(msg.id)) return; // cancelled meanwhile; stay silent
        if (res.ok) post(port, { type: 'done', id: msg.id, result: res.result });
        else post(port, { type: 'error', id: msg.id, kind: res.kind, message: res.message });
      });
    });

    port.onDisconnect.addListener(() => {
      for (const ctl of running.values()) ctl.abort();
      running.clear();
    });
  });
});

/** Shared by the context menu and the keyboard shortcut: both just tell the active tab's
 *  content script to humanize a selection, which reads the live selection itself. */
/**
 * Ask the page for the selected text, park it for the popup, and open the popup.
 * openPopup needs a user gesture and is not available in every Chrome build, so
 * a failure is not fatal: the text stays parked and a badge tells the user to
 * click the toolbar icon.
 */
async function handOff(tabId: number, fallbackText: string): Promise<void> {
  let text = '';
  let canApply = false;
  try {
    const res = await chrome.tabs.sendMessage<CaptureRequest, CaptureResponse>(tabId, { type: 'capture' });
    if (res.ok) {
      text = res.text;
      canApply = res.canApply;
    } else if (res.reason === 'sensitive') {
      return; // never hand over a password or card field
    }
  } catch {
    // No content script in this tab; fall back to whatever Chrome gave us.
  }
  if (!text) text = fallbackText;
  if (!text.trim()) return;
  await chrome.storage.local.set({ [PENDING_KEY]: { text, canApply, tabId } });
  try {
    await chrome.action.openPopup();
    void chrome.action.setBadgeText({ text: '' });
  } catch {
    // Could not open it for the user; point them at the toolbar instead.
    void chrome.action.setBadgeBackgroundColor({ color: '#4f46e5' });
    void chrome.action.setBadgeText({ text: '1' });
  }
}

function post(port: chrome.runtime.Port, msg: PortServerMessage): void {
  try {
    port.postMessage(msg);
  } catch {
    // Port closed mid-send; the disconnect handler aborts the work.
  }
}

async function runHumanize(
  text: string,
  intensity: Intensity,
  signal?: AbortSignal,
  onChunk?: (textSoFar: string) => void,
): Promise<HumanizeResponse> {
  try {
    const settings = await getSettings();
    const result = await humanize(
      text,
      {
        intensity,
        signal,
        onChunk,
        voiceSample: settings.voiceSample || undefined,
        customTells: settings.customTells,
      },
      { providers: buildProviders(settings) },
    );
    return { ok: true, result };
  } catch (err) {
    const e = err instanceof HumanizerError ? err : new HumanizerError('internal', redactError(String(err)));
    if (e.kind !== 'aborted') console.error('[second-draft]', e.kind, redactError(e.message));
    return { ok: false, kind: e.kind, message: redactError(e.message) };
  }
}

function buildProviders(settings: Settings): Provider[] {
  if (settings.useFakeProvider) return [new FakeProvider()];
  const providers: Provider[] = [];
  const { byok } = settings;
  if (byok.provider === 'anthropic' && byok.apiKey) {
    providers.push(new AnthropicProvider({ apiKey: byok.apiKey, model: byok.model || 'claude-sonnet-4-5' }));
  } else if (byok.provider === 'openai' && byok.apiKey) {
    providers.push(
      new OpenAIProvider({ baseUrl: byok.baseUrl, apiKey: byok.apiKey, model: byok.model || 'gpt-4o-mini' }),
    );
  }
  providers.push(new NanoProvider());
  return providers;
}
