import { HumanizeSession } from '../content/session';
import { isSiteDisabled } from '../shared/storage';

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    void boot();
  },
});

async function boot(): Promise<void> {
  let session: HumanizeSession | null = null;
  const host = location.host;

  const sync = async (): Promise<void> => {
    const disabled = await isSiteDisabled(host);
    if (disabled && session) {
      session.stop();
      session = null;
    } else if (!disabled && !session) {
      session = new HumanizeSession(document);
      session.start();
    }
  };

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes['settings']) void sync();
  });
  await sync();
}
