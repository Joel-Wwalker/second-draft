import { expect, test } from 'vitest';
import { isCancelRequest, isHumanizeRequest } from '../src/shared/messages';

test('isHumanizeRequest accepts a valid request', () => {
  expect(isHumanizeRequest({ type: 'humanize', id: 'a1', text: 'hello there', intensity: 'light' })).toBe(true);
});

test('isHumanizeRequest rejects malformed shapes', () => {
  expect(isHumanizeRequest(null)).toBe(false);
  expect(isHumanizeRequest('humanize')).toBe(false);
  expect(isHumanizeRequest({ type: 'humanize', id: 1, text: 't', intensity: 'light' })).toBe(false);
  expect(isHumanizeRequest({ type: 'humanize', id: 'a', text: 't', intensity: 'max' })).toBe(false);
  expect(isHumanizeRequest({ type: 'cancel', id: 'a' })).toBe(false);
});

test('isCancelRequest accepts cancel and rejects others', () => {
  expect(isCancelRequest({ type: 'cancel', id: 'a1' })).toBe(true);
  expect(isCancelRequest({ type: 'cancel' })).toBe(false);
  expect(isCancelRequest({ type: 'humanize', id: 'a1', text: 't', intensity: 'light' })).toBe(false);
});
