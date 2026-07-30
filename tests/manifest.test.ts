import { expect, test } from 'vitest';
import config from '../wxt.config';

/**
 * The permission surface is a product decision, not an implementation detail, so
 * it gets a test. Broad host access flags a listing for in-depth review, and the
 * page script is injected on a gesture precisely so none is needed.
 */
test('the extension asks for no host access at install', () => {
  const manifest = (config.manifest ?? {}) as Record<string, unknown>;
  expect(manifest['host_permissions']).toBeUndefined();
  expect(manifest['permissions']).toEqual(['storage', 'contextMenus', 'activeTab', 'scripting']);
});

test('the optional host permissions stay optional, for a user-supplied API endpoint', () => {
  const manifest = (config.manifest ?? {}) as Record<string, unknown>;
  // Optional means not granted at install; Chrome asks only when a key is saved.
  expect(manifest['optional_host_permissions']).toEqual([
    'https://*/*',
    'http://localhost/*',
    'http://127.0.0.1/*',
  ]);
});
