import { discardPending, discardPendingForTab, handOff } from '../background/handoff';

// The rewrite itself does not run here anymore. It used to, behind a streaming
// port, until a machine turned up where the worker's Prompt API view disagreed
// with every document context: pages ran eight hundred batch rewrites in a day
// while five popup requests silently fell back to the rules engine from this
// context. The engine now runs in the popup (src/shared/rewrite.ts), and this
// worker keeps only the jobs that genuinely need the background: the context
// menu, the keyboard command, and the lifecycle of parked selections.
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

  // Parked text belongs to one moment and one tab. Drop it when either is gone,
  // so it cannot turn up in a popup the user opened for something else.
  chrome.tabs.onRemoved.addListener(tabId => {
    void discardPendingForTab(tabId);
  });
  chrome.runtime.onStartup.addListener(() => {
    void discardPending();
  });

});
