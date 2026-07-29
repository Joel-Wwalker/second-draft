import { expect, test } from 'vitest';
import { isApplyRequest, isCancelRequest, isCaptureRequest, isHumanizeRequest, isUndoRequest } from '../src/shared/messages';

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




test('page requests are validated by tag', () => {
  expect(isCaptureRequest({ type: 'capture' })).toBe(true);
  expect(isCaptureRequest({ type: 'apply' })).toBe(false);
  expect(isUndoRequest({ type: 'undo' })).toBe(true);
  expect(isUndoRequest(null)).toBe(false);
});

test('an apply request needs text', () => {
  expect(isApplyRequest({ type: 'apply', text: 'hello' })).toBe(true);
  expect(isApplyRequest({ type: 'apply' })).toBe(false);
  expect(isApplyRequest({ type: 'apply', text: 7 })).toBe(false);
});
