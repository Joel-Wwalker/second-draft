// @vitest-environment jsdom
import { beforeEach, expect, test } from 'vitest';
import { ATTACHED, attachOnce } from '../src/content/attach';

type Listener = (
  msg: unknown,
  sender?: chrome.runtime.MessageSender,
  sendResponse?: (res: unknown) => void,
) => void;

let listeners: Listener[];

beforeEach(() => {
  listeners = [];
  (globalThis as Record<string, unknown>)['chrome'] = {
    runtime: {
      id: 'test',
      onMessage: {
        addListener: (fn: Listener): void => void listeners.push(fn),
        removeListener: (fn: Listener): void => {
          const i = listeners.indexOf(fn);
          if (i >= 0) listeners.splice(i, 1);
        },
      },
    },
  } as unknown as typeof chrome;
  document.body.innerHTML = '<textarea>We delve into the plan boldly.</textarea>';
});

/** Inject, the way executeScript does: run the file against the same scope again. */
function inject(scope: Record<string, unknown>): void {
  attachOnce(document, scope);
}

test('injecting once starts a session that answers', () => {
  const scope: Record<string, unknown> = {};
  inject(scope);
  expect(listeners).toHaveLength(1);
  expect(scope[ATTACHED]).toBe(true);
});

test('injecting again on the same page does not add a second listener', () => {
  // The user invoking Humanize twice without reloading runs the script twice. Two
  // listeners would answer every message twice, including apply.
  const scope: Record<string, unknown> = {};
  inject(scope);
  inject(scope);
  inject(scope);
  expect(listeners).toHaveLength(1);
});

test('one apply reaches the field once, however many times the script was injected', () => {
  const scope: Record<string, unknown> = {};
  inject(scope);
  inject(scope);

  const field = document.querySelector('textarea')!;
  field.focus();
  field.setSelectionRange(0, field.value.length);
  const send = (msg: unknown): unknown[] => {
    const answers: unknown[] = [];
    for (const fn of [...listeners]) fn(msg, { id: 'test' }, res => answers.push(res));
    return answers;
  };

  expect(send({ type: 'capture' })).toHaveLength(1);
  expect(send({ type: 'apply', text: 'We dig into the plan boldly.' })).toEqual([{ ok: true }]);
  expect(field.value).toBe('We dig into the plan boldly.');
  // A duplicate session would have applied over its own result and left the undo
  // record pointing at text that is no longer there.
  expect(send({ type: 'undo' })).toEqual([{ ok: true }]);
  expect(field.value).toBe('We delve into the plan boldly.');
});

test('a fresh page gets its own session', () => {
  inject({});
  inject({}); // different scope, as a new document would have
  expect(listeners).toHaveLength(2);
});
