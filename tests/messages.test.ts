import { expect, test } from 'vitest';
import { isCancelRequest, isHumanizeRequest, isScanClearRequest, isScanRequest } from '../src/shared/messages';

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

test('isScanRequest accepts a valid request and rejects other shapes', () => {
  expect(isScanRequest({ type: 'scan' })).toBe(true);
  expect(isScanRequest({ type: 'scan-clear' })).toBe(false);
  expect(isScanRequest({ type: 'humanize', id: 'a', text: 't', intensity: 'light' })).toBe(false);
  expect(isScanRequest(null)).toBe(false);
  expect(isScanRequest('scan')).toBe(false);
  expect(isScanRequest(undefined)).toBe(false);
});

test('isScanClearRequest accepts a valid request and rejects other shapes', () => {
  expect(isScanClearRequest({ type: 'scan-clear' })).toBe(true);
  expect(isScanClearRequest({ type: 'scan' })).toBe(false);
  expect(isScanClearRequest(null)).toBe(false);
  expect(isScanClearRequest('scan-clear')).toBe(false);
});
