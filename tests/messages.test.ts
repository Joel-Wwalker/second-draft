import { expect, test } from 'vitest';
import {
  PENDING_TTL_MS,
  isApplyRequest,
  isCancelRequest,
  isCaptureRequest,
  isCaptureResponse,
  isHumanizeRequest,
  isPendingFresh,
  isPendingSelection,
  isUndoRequest,
} from '../src/shared/messages';

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

test('isCancelRequest accepts a cancel and rejects everything else', () => {
  expect(isCancelRequest({ type: 'cancel', id: 'a1' })).toBe(true);
  expect(isCancelRequest({ type: 'cancel' })).toBe(false);
  expect(isCancelRequest({ type: 'cancel', id: 7 })).toBe(false);
  expect(isCancelRequest({ type: 'humanize', id: 'a1', text: 't', intensity: 'light' })).toBe(false);
  expect(isCancelRequest(null)).toBe(false);
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

test('a capture response is only trusted when it is fully formed', () => {
  // The background decides whether the credential guard ran by whether the page
  // answered at all, so a half-formed answer has to read as no answer.
  expect(isCaptureResponse({ ok: true, text: 'hi', canApply: true })).toBe(true);
  expect(isCaptureResponse({ ok: false, reason: 'sensitive' })).toBe(true);
  expect(isCaptureResponse({ ok: false, reason: 'none' })).toBe(true);
  expect(isCaptureResponse({ ok: true, text: 'hi' })).toBe(false);
  expect(isCaptureResponse({ ok: true, canApply: true })).toBe(false);
  expect(isCaptureResponse({ ok: false, reason: 'whatever' })).toBe(false);
  expect(isCaptureResponse({ ok: 'yes' })).toBe(false);
  expect(isCaptureResponse(undefined)).toBe(false);
  expect(isCaptureResponse(null)).toBe(false);
});

test('a parked selection is only trusted when it is fully formed', () => {
  expect(isPendingSelection({ kind: 'text', text: 'hi', canApply: true, tabId: 3, at: 1 })).toBe(true);
  expect(isPendingSelection({ kind: 'refused', reason: 'unavailable', at: 1 })).toBe(true);
  // No timestamp means no way to expire it, so it does not count.
  expect(isPendingSelection({ kind: 'text', text: 'hi', canApply: true, tabId: 3 })).toBe(false);
  expect(isPendingSelection({ kind: 'text', text: 'hi', canApply: true, at: 1 })).toBe(false);
  expect(isPendingSelection({ kind: 'refused', reason: 'bored', at: 1 })).toBe(false);
  // The shape shipped before parked text was given an expiry.
  expect(isPendingSelection({ text: 'hi', canApply: true, tabId: 3 })).toBe(false);
  expect(isPendingSelection(null)).toBe(false);
});

test('parked text expires, so it cannot run itself in a popup opened later', () => {
  const now = 1_000_000;
  const parked = { kind: 'refused', reason: 'none', at: now } as const;
  expect(isPendingFresh({ ...parked, at: now }, now)).toBe(true);
  expect(isPendingFresh({ ...parked, at: now - PENDING_TTL_MS }, now)).toBe(true);
  expect(isPendingFresh({ ...parked, at: now - PENDING_TTL_MS - 1 }, now)).toBe(false);
  expect(isPendingFresh({ ...parked, at: now - 86_400_000 }, now)).toBe(false);
  // A clock that jumped backwards must not make old text look fresh forever.
  expect(isPendingFresh({ ...parked, at: now + 5_000 }, now)).toBe(false);
});
