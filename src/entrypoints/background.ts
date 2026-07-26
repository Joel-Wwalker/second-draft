import { humanize } from '../engine';
import { FakeProvider } from '../engine/providers/fake';
import { getSettings } from '../shared/storage';
import { HumanizerError } from '../shared/types';
import type { Intensity, Provider } from '../shared/types';
import { HUMANIZE_PORT, isCancelRequest, isHumanizeRequest } from '../shared/messages';
import type { HumanizeResponse, PortServerMessage } from '../shared/messages';

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
    void chrome.tabs
      .sendMessage(tab.id, { type: 'context-humanize', selectionText: info.selectionText ?? '' })
      .catch(() => {
        // No content script in this tab (chrome:// page etc.); nothing to do.
      });
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
    // Real providers (nano, byok) land in Plan 3; empty means rules-only.
    const providers: Provider[] = settings.useFakeProvider ? [new FakeProvider()] : [];
    const result = await humanize(text, { intensity, signal, onChunk }, { providers });
    return { ok: true, result };
  } catch (err) {
    const e = err instanceof HumanizerError ? err : new HumanizerError('internal', String(err));
    if (e.kind !== 'aborted') console.error('[humanizer]', e.kind, e.message);
    return { ok: false, kind: e.kind, message: e.message };
  }
}
