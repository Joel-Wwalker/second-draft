import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'Humanizer',
    description: 'Make AI drafts sound like you. Rewrites run on your device.',
    minimum_chrome_version: '138',
    permissions: ['storage'],
  },
});
