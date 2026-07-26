import { expect, test } from 'vitest';
import { redactError } from '../src/shared/redact';

test('strips key-like tokens', () => {
  expect(redactError('bad key sk-ant-abc123DEF456ghi789 used')).toBe('bad key sk-*** used');
});

test('reduces URLs to their host', () => {
  expect(redactError('fetch failed for https://api.example.com/v1/chat?key=zzz here')).toBe(
    'fetch failed for [api.example.com] here',
  );
});

test('truncates very long messages', () => {
  expect(redactError('x'.repeat(500)).length).toBeLessThanOrEqual(203);
});
