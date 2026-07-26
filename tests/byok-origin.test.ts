import { expect, test } from 'vitest';
import { byokOrigin } from '../src/shared/byok-origin';

test('anthropic maps to the fixed API origin', () => {
  expect(byokOrigin({ provider: 'anthropic', apiKey: 'k', model: '', baseUrl: '' })).toBe('https://api.anthropic.com/*');
});

test('openai base urls map to hostname-only patterns with ports stripped', () => {
  expect(byokOrigin({ provider: 'openai', apiKey: 'k', model: '', baseUrl: 'https://ai.example.com:8443/v1' })).toBe('https://ai.example.com/*');
  expect(byokOrigin({ provider: 'openai', apiKey: 'k', model: '', baseUrl: 'http://localhost:11434/v1' })).toBe('http://localhost/*');
});

test('invalid or non-http urls yield null', () => {
  expect(byokOrigin({ provider: 'openai', apiKey: 'k', model: '', baseUrl: 'not a url' })).toBeNull();
  expect(byokOrigin({ provider: 'openai', apiKey: 'k', model: '', baseUrl: 'ftp://x' })).toBeNull();
});
