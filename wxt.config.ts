import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'Second Draft: Humanize AI Text',
    short_name: 'Second Draft',
    description: 'Make AI drafts sound like you. Rewrites run on your device.',
    minimum_chrome_version: '138',
    // No host permissions and no declared content script. The page script is
    // injected on the gesture that asks for it, which activeTab grants, and
    // scripting is what performs that injection. Broad host access would flag the
    // listing for in-depth review and it is not needed.
    permissions: ['storage', 'contextMenus', 'activeTab', 'scripting'],
    optional_host_permissions: ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*'],
    commands: {
      'humanize-selection': {
        suggested_key: {
          default: 'Ctrl+Shift+H',
          mac: 'MacCtrl+Shift+H',
        },
        description: 'Humanize the selected text',
      },
    },
    icons: {
      16: 'icons/16.png',
      32: 'icons/32.png',
      48: 'icons/48.png',
      128: 'icons/128.png',
    },
    action: {
      default_icon: {
        16: 'icons/16.png',
        32: 'icons/32.png',
      },
    },
  },
});
