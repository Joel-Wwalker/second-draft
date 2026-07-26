import { humanize } from '../engine';
import { FakeProvider } from '../engine/providers/fake';
import { getSettings } from '../shared/storage';
import { HumanizerError } from '../shared/types';
import type { Provider } from '../shared/types';
import type { BackgroundRequest, HumanizeRequest, HumanizeResponse } from '../shared/messages';

export default defineBackground(() => {
  chrome.runtime.onMessage.addListener(
    (msg: BackgroundRequest, _sender, sendResponse: (res: HumanizeResponse) => void) => {
      if (msg.type !== 'humanize') return;
      void handleHumanize(msg).then(sendResponse);
      return true; // keep the channel open for the async response
    },
  );
});

async function handleHumanize(msg: HumanizeRequest): Promise<HumanizeResponse> {
  try {
    const settings = await getSettings();
    // Real providers (nano, byok) are added in Plan 2; empty means rules-only.
    const providers: Provider[] = settings.useFakeProvider ? [new FakeProvider()] : [];
    const result = await humanize(msg.text, { intensity: msg.intensity }, { providers });
    return { ok: true, result };
  } catch (err) {
    const e = err instanceof HumanizerError ? err : new HumanizerError('internal', String(err));
    console.error('[humanizer]', e.kind, e.message);
    return { ok: false, kind: e.kind, message: e.message };
  }
}
