import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'Humanizer',
    description: 'Make AI drafts sound like you. Rewrites run on your device.',
    minimum_chrome_version: '138',
    permissions: ['storage', 'contextMenus', 'activeTab'],
    optional_host_permissions: ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*'],
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
