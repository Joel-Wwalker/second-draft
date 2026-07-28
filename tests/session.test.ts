// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { PortServerMessage } from '../src/shared/messages';

// jsdom does not implement Range.getBoundingClientRect (every real browser does; it's
// standard CSSOM View). session.ts calls it while positioning the card over a
// contenteditable selection, so tests that drive a live contenteditable selection need
// this stub or they throw before reaching the behavior under test.
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = function (this: Range): DOMRect {
    return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) } as DOMRect;
  };
}

class FakePort {
  name = 'humanize';
  sent: unknown[] = [];
  private listeners: Array<(msg: unknown) => void> = [];
  onMessage = { addListener: (fn: (msg: unknown) => void): void => void this.listeners.push(fn) };
  onDisconnect = { addListener: (_fn: () => void): void => undefined };
  postMessage(msg: unknown): void {
    this.sent.push(msg);
  }
  emit(msg: PortServerMessage): void {
    for (const fn of this.listeners) fn(msg);
  }
  disconnect(): void {}
}

let port: FakePort;
let runtimeListeners: Array<(msg: unknown) => void> = [];
let storageListeners: Array<(changes: Record<string, { newValue?: unknown }>, area: string) => void> = [];
let session: import('../src/content/session').HumanizeSession;
/** Backing store for the chrome.storage.local mock below; re-seeded fresh in each
 * beforeEach. Kept at describe scope (rather than local to beforeEach) so tests that
 * need HumanizeSession.start() to read a non-default settings value -- e.g. a voice
 * sample -- can seed it via restartWithVoiceSample below. */
let store: Record<string, unknown>;

beforeEach(async () => {
  vi.useFakeTimers();
  port = new FakePort();
  store = {
    settings: { defaultIntensity: 'full', useFakeProvider: true, disabledSites: [] },
  };
  runtimeListeners = [];
  storageListeners = [];
  (globalThis as Record<string, unknown>)['chrome'] = {
    runtime: {
      id: 'test',
      connect: () => port,
      onMessage: {
        addListener: (fn: (msg: unknown) => void): void => void runtimeListeners.push(fn),
        removeListener: (fn: (msg: unknown) => void): void => {
          const i = runtimeListeners.indexOf(fn);
          if (i >= 0) runtimeListeners.splice(i, 1);
        },
      },
    },
    storage: {
      local: {
        get: async (key: string) => ({ [key]: store[key] }),
        set: async (items: Record<string, unknown>) => void Object.assign(store, items),
      },
      onChanged: {
        addListener: (fn: (changes: Record<string, { newValue?: unknown }>, area: string) => void): void =>
          void storageListeners.push(fn),
        removeListener: (fn: (changes: Record<string, { newValue?: unknown }>, area: string) => void): void => {
          const i = storageListeners.indexOf(fn);
          if (i >= 0) storageListeners.splice(i, 1);
        },
      },
    },
  } as unknown as typeof chrome;
  document.body.innerHTML = '<textarea>We delve into the plan boldly.</textarea>';
  const { HumanizeSession } = await import('../src/content/session');
  session = new HumanizeSession(document);
  session.start();
});

afterEach(() => {
  session.stop();
  vi.useRealTimers();
});

function selectInTextarea(): void {
  const ta = document.querySelector('textarea')!;
  ta.focus();
  ta.setSelectionRange(0, 30);
  document.dispatchEvent(new Event('selectionchange'));
  vi.advanceTimersByTime(200);
}

function clickChip(): void {
  const btn = document.getElementById('humanizer-chip-host')!.shadowRoot!.querySelector('button')!;
  btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
}

function selectWholeContentEditable(el: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = document.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
  vi.advanceTimersByTime(200);
}

/** Selects [start, end) of el's first (single) text node -- a partial span, not the whole element. */
function selectRangeInContentEditable(el: HTMLElement, start: number, end: number): void {
  const textNode = el.firstChild!;
  const range = document.createRange();
  range.setStart(textNode, start);
  range.setEnd(textNode, end);
  const sel = document.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
  vi.advanceTimersByTime(200);
}

/**
 * The shared beforeEach seeds no voiceSample, so HumanizeSession.start()'s
 * analyzeWriting call reads '' and caches a null profile for most tests. Tests that
 * need a real cached profile stop the auto-started session, seed the mock store's
 * settings with a voiceSample, and start a fresh session so its start() reads it.
 * Several microtask turns are flushed afterward: getSettings() awaits the mocked
 * chrome.storage.local.get, then start()'s own .then callback runs as a further
 * continuation, so a single microtask tick is not enough to observe the cached profile.
 */
async function restartWithVoiceSample(voiceSample: string): Promise<void> {
  session.stop();
  store['settings'] = { defaultIntensity: 'full', useFakeProvider: true, disabledSites: [], voiceSample };
  const { HumanizeSession } = await import('../src/content/session');
  session = new HumanizeSession(document);
  session.start();
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

test('selection shows the chip; chip click opens the card and sends a request', () => {
  selectInTextarea();
  expect(document.getElementById('humanizer-chip-host')).not.toBeNull();
  clickChip();
  expect(document.getElementById('humanizer-card-host')).not.toBeNull();
  expect(port.sent).toHaveLength(1);
  expect(port.sent[0]).toMatchObject({ type: 'humanize', intensity: 'full', text: 'We delve into the plan boldly.' });
});

test('done result renders and Apply replaces the field text', () => {
  selectInTextarea();
  clickChip();
  const req = port.sent[0] as { id: string };
  port.emit({
    type: 'done',
    id: req.id,
    result: {
      rewritten: 'We dig into the plan boldly.',
      changes: [],
      engine: { kind: 'fake', model: 'fake-echo' },
      tells: { before: 1, after: 0 },
    },
  });
  const shadow = document.getElementById('humanizer-card-host')!.shadowRoot!;
  expect(shadow.querySelector('.rewritten')!.textContent).toBe('We dig into the plan boldly.');
  (shadow.querySelector('button.apply') as HTMLButtonElement).click();
  expect(document.querySelector('textarea')!.value).toBe('We dig into the plan boldly.');
  expect(document.getElementById('humanizer-card-host')).not.toBeNull();
  expect(shadow.querySelector('.headline .h')!.textContent).toBe('Applied');
});

test('a voice-sample profile that a rewrite drifts from adds a profile note to the card', async () => {
  // Same fixture and math as profile.test.ts's "a rewrite with much longer sentences
  // reports the drift": avg 10.8 word sentences vs. this rewrite's single 22-word one.
  const voiceSample = [
    'I write in short bursts.',
    'Sometimes a sentence runs much longer than it really needs to, and I let it wander a bit.',
    "I don't fix that.",
    "It's just how the words come out when I am not thinking about it too hard.",
  ].join(' ');
  await restartWithVoiceSample(voiceSample);

  selectInTextarea();
  clickChip();
  const req = port.sent[0] as { id: string };
  const drifted =
    'The quality of the output depends entirely on how carefully the author has considered the structure of the argument being presented here.';
  port.emit({
    type: 'done',
    id: req.id,
    result: { rewritten: drifted, changes: [], engine: { kind: 'fake' }, tells: { before: 1, after: 0 } },
  });

  const shadow = document.getElementById('humanizer-card-host')!.shadowRoot!;
  const note = shadow.querySelector('.profile-note') as HTMLElement | null;
  expect(note).not.toBeNull();
  expect(note!.hidden).toBe(false);
  expect(note!.textContent).toBe('Your writing averages 10.8 word sentences; this runs 22.');
});

test('no voice sample means a done result never adds a profile note', () => {
  selectInTextarea();
  clickChip();
  const req = port.sent[0] as { id: string };
  port.emit({
    type: 'done',
    id: req.id,
    result: { rewritten: 'We dig into the plan boldly.', changes: [], engine: { kind: 'fake' }, tells: { before: 1, after: 0 } },
  });
  const shadow = document.getElementById('humanizer-card-host')!.shadowRoot!;
  const note = shadow.querySelector('.profile-note') as HTMLElement | null;
  expect(note === null || note.hidden).toBe(true);
});

test('dismiss sends a cancel for the in-flight request', () => {
  selectInTextarea();
  clickChip();
  const req = port.sent[0] as { id: string };
  const shadow = document.getElementById('humanizer-card-host')!.shadowRoot!;
  (shadow.querySelector('button.dismiss') as HTMLButtonElement).click();
  expect(port.sent).toContainEqual({ type: 'cancel', id: req.id });
  expect(document.getElementById('humanizer-card-host')).toBeNull();
});

test('stale responses for superseded ids are ignored', () => {
  selectInTextarea();
  clickChip();
  const first = port.sent[0] as { id: string };
  const shadow = document.getElementById('humanizer-card-host')!.shadowRoot!;
  (shadow.querySelector('select.intensity') as HTMLSelectElement).value = 'light';
  shadow.querySelector('select.intensity')!.dispatchEvent(new Event('change'));
  port.emit({
    type: 'done',
    id: first.id,
    result: { rewritten: 'STALE', changes: [], engine: { kind: 'fake' }, tells: { before: 1, after: 0 } },
  });
  expect(shadow.querySelector('.rewritten')!.textContent).not.toBe('STALE');
});

test('changing intensity mid-stream cancels the in-flight request and sends a fresh one with the new intensity', () => {
  selectInTextarea();
  clickChip();
  const first = port.sent[0] as { id: string; text: string; intensity: string };
  // A chunk (not done) keeps the request in flight: this.result stays null, so
  // the intensity change below must hit cancelInFlight()'s cancel-send branch.
  port.emit({ type: 'chunk', id: first.id, textSoFar: 'partial' });

  const shadow = document.getElementById('humanizer-card-host')!.shadowRoot!;
  (shadow.querySelector('select.intensity') as HTMLSelectElement).value = 'light';
  shadow.querySelector('select.intensity')!.dispatchEvent(new Event('change'));

  expect(port.sent).toContainEqual({ type: 'cancel', id: first.id });
  const humanizeMsgs = port.sent.filter(m => (m as { type: string }).type === 'humanize') as Array<{
    id: string;
    text: string;
    intensity: string;
  }>;
  expect(humanizeMsgs).toHaveLength(2);
  const second = humanizeMsgs[1]!;
  expect(second.id).not.toBe(first.id);
  expect(second.text).toBe(first.text);
  expect(second.intensity).toBe('light');
});

test('regenerate after a result has arrived sends a fresh humanize request with a new id for the same text and intensity, without cancelling the completed one', () => {
  selectInTextarea();
  clickChip();
  const first = port.sent[0] as { id: string; text: string; intensity: string };
  port.emit({
    type: 'done',
    id: first.id,
    result: {
      rewritten: 'We dig into the plan boldly.',
      changes: [],
      engine: { kind: 'fake', model: 'fake-echo' },
      tells: { before: 1, after: 0 },
    },
  });
  const shadow = document.getElementById('humanizer-card-host')!.shadowRoot!;
  expect((shadow.querySelector('button.regen') as HTMLButtonElement).hidden).toBe(false);

  (shadow.querySelector('button.regen') as HTMLButtonElement).click();

  const humanizeMsgs = port.sent.filter(m => (m as { type: string }).type === 'humanize') as Array<{
    id: string;
    text: string;
    intensity: string;
  }>;
  expect(humanizeMsgs).toHaveLength(2);
  const second = humanizeMsgs[1]!;
  expect(second.id).not.toBe(first.id);
  expect(second.text).toBe(first.text);
  expect(second.intensity).toBe(first.intensity);
  // The first request already completed, so regenerating must not cancel it.
  expect(port.sent).not.toContainEqual({ type: 'cancel', id: first.id });
});

test('regenerate while the previous request is still streaming cancels it and sends a fresh request with a new id', () => {
  selectInTextarea();
  clickChip();
  const first = port.sent[0] as { id: string; text: string; intensity: string };
  const shadow = document.getElementById('humanizer-card-host')!.shadowRoot!;
  // No `done` has arrived yet, so button.regen is still hidden per the card's own
  // contract (covered separately in chip-card.test.ts). Clicking it directly here
  // exercises HumanizeSession's cancel-in-flight branch regardless of the button's
  // visual state, the same way other tests in this file drive callbacks straight
  // off the DOM node rather than simulating pointer visibility.
  const regenBtn = shadow.querySelector('button.regen') as HTMLButtonElement;
  expect(regenBtn.hidden).toBe(true);

  regenBtn.click();

  expect(port.sent).toContainEqual({ type: 'cancel', id: first.id });
  const humanizeMsgs = port.sent.filter(m => (m as { type: string }).type === 'humanize') as Array<{
    id: string;
    text: string;
    intensity: string;
  }>;
  expect(humanizeMsgs).toHaveLength(2);
  const second = humanizeMsgs[1]!;
  expect(second.id).not.toBe(first.id);
  expect(second.text).toBe(first.text);
  expect(second.intensity).toBe(first.intensity);
});

test('a stale done for the id superseded by regenerate does not render', () => {
  selectInTextarea();
  clickChip();
  const first = port.sent[0] as { id: string };
  const shadow = document.getElementById('humanizer-card-host')!.shadowRoot!;
  port.emit({
    type: 'done',
    id: first.id,
    result: { rewritten: 'FIRST RESULT', changes: [], engine: { kind: 'fake' }, tells: { before: 1, after: 0 } },
  });
  expect(shadow.querySelector('.rewritten')!.textContent).toBe('FIRST RESULT');

  (shadow.querySelector('button.regen') as HTMLButtonElement).click();
  const second = port.sent.filter(m => (m as { type: string }).type === 'humanize')[1] as { id: string };

  // The superseded id's late response must be ignored even though the card is
  // back in its streaming state (existing id-guard in onPortMessage).
  port.emit({
    type: 'done',
    id: first.id,
    result: { rewritten: 'STALE REGEN RESULT', changes: [], engine: { kind: 'fake' }, tells: { before: 1, after: 0 } },
  });
  expect(shadow.querySelector('.rewritten')!.textContent).toBe('');
  expect(shadow.querySelector('.status')!.textContent).toBe('Rewriting...');

  // Sanity: the live (second) id still renders normally, proving the guard is
  // targeted at the superseded id rather than dropping every done message.
  port.emit({
    type: 'done',
    id: second.id,
    result: { rewritten: 'SECOND RESULT', changes: [], engine: { kind: 'fake' }, tells: { before: 1, after: 0 } },
  });
  expect(shadow.querySelector('.rewritten')!.textContent).toBe('SECOND RESULT');
});

test('repeated regeneration reuses the same port and does not accumulate timers', () => {
  let connectCalls = 0;
  const chromeGlobal = globalThis as unknown as { chrome: { runtime: { connect: () => FakePort } } };
  const baseConnect = chromeGlobal.chrome.runtime.connect;
  chromeGlobal.chrome.runtime.connect = () => {
    connectCalls++;
    return baseConnect();
  };

  selectInTextarea();
  clickChip();
  expect(connectCalls).toBe(1);

  for (let i = 0; i < 3; i++) {
    const lastId = (port.sent[port.sent.length - 1] as { id: string }).id;
    port.emit({
      type: 'done',
      id: lastId,
      result: { rewritten: `result ${i}`, changes: [], engine: { kind: 'fake' }, tells: { before: 1, after: 0 } },
    });
    const shadow = document.getElementById('humanizer-card-host')!.shadowRoot!;
    (shadow.querySelector('button.regen') as HTMLButtonElement).click();
  }

  // Still the one port from the first connect -- ensurePort() never reconnects
  // while a port is already open.
  expect(connectCalls).toBe(1);
  const humanizeMsgs = port.sent.filter(m => (m as { type: string }).type === 'humanize') as Array<{ id: string }>;
  expect(humanizeMsgs).toHaveLength(4); // one initial + three regenerations
  expect(new Set(humanizeMsgs.map(m => m.id)).size).toBe(4);
  // Only the current (fourth) request's 60s timeout should be pending -- no
  // leftover timers from the earlier regenerate cycles.
  expect(vi.getTimerCount()).toBe(1);
});

test('stop() removes the runtime listener and ignores late messages', () => {
  expect(runtimeListeners).toHaveLength(1);
  session.stop();
  expect(runtimeListeners).toHaveLength(0);
  expect(document.getElementById('humanizer-card-host')).toBeNull();
});

test('a debounce pending at stop() cannot resurrect the chip', () => {
  const ta = document.querySelector('textarea')!;
  ta.focus();
  ta.setSelectionRange(0, 30);
  document.dispatchEvent(new Event('selectionchange'));
  session.stop();
  vi.advanceTimersByTime(300);
  expect(document.getElementById('humanizer-chip-host')).toBeNull();
});

test('a retained runtime listener reference is inert after stop()', () => {
  const ta = document.querySelector('textarea')!;
  ta.focus();
  ta.setSelectionRange(0, 30);
  const [listener] = runtimeListeners;
  session.stop();
  listener?.({ type: 'context-humanize' });
  expect(document.getElementById('humanizer-card-host')).toBeNull();
});

test('a request with no response times out with an error', () => {
  selectInTextarea();
  clickChip();
  vi.advanceTimersByTime(60_001);
  const shadow = document.getElementById('humanizer-card-host')!.shadowRoot!;
  expect(shadow.querySelector('.status')!.textContent).toContain('No response from the engine');
});

test('a done response cancels the timeout', () => {
  selectInTextarea();
  clickChip();
  const req = port.sent[0] as { id: string };
  port.emit({
    type: 'done',
    id: req.id,
    result: { rewritten: 'ok result here', changes: [], engine: { kind: 'fake' }, tells: { before: 1, after: 0 } },
  });
  vi.advanceTimersByTime(120_000);
  const shadow = document.getElementById('humanizer-card-host')!.shadowRoot!;
  expect(shadow.querySelector('.status')!.textContent).not.toContain('No response');
});

test('changing the stored default intensity applies to the next request', () => {
  selectInTextarea();
  clickChip();
  for (const fn of storageListeners) {
    fn({ settings: { newValue: { defaultIntensity: 'light' } } }, 'local');
  }
  const shadow = document.getElementById('humanizer-card-host')!.shadowRoot!;
  (shadow.querySelector('button.dismiss') as HTMLButtonElement).click();
  selectInTextarea();
  clickChip();
  const second = port.sent.filter(m => (m as { type: string }).type === 'humanize')[1] as { intensity: string };
  expect(second.intensity).toBe('light');
});

test('stop() removes the storage listener', () => {
  expect(storageListeners.length).toBeGreaterThan(0);
  session.stop();
  expect(storageListeners).toHaveLength(0);
});

test('context-humanize ignores sensitive fields even with a selectionText fallback', () => {
  document.body.innerHTML = '<input type="text" autocomplete="cc-number" value="4111111111111111">';
  document.querySelector('input')!.focus();
  for (const fn of [...runtimeListeners]) fn({ type: 'context-humanize', selectionText: '4111111111111111' });
  expect(document.getElementById('humanizer-card-host')).toBeNull();
  expect(port.sent).toHaveLength(0);
});

// Shortcut shape: the background sends selectionText: '' for chrome.commands (unlike the
// context menu, chrome.commands.onCommand carries no selection text), relying entirely on
// this handler reading the live selection itself. These two tests drive that exact message
// shape through the same runtime-message path the context menu uses.
test('context-humanize with an empty selectionText still humanizes a live editable selection (shortcut shape)', () => {
  const ta = document.querySelector('textarea')!;
  ta.focus();
  ta.setSelectionRange(0, 30);
  for (const fn of [...runtimeListeners]) fn({ type: 'context-humanize', selectionText: '' });
  expect(document.getElementById('humanizer-card-host')).not.toBeNull();
  expect(port.sent).toHaveLength(1);
  expect(port.sent[0]).toMatchObject({ type: 'humanize', intensity: 'full', text: 'We delve into the plan boldly.' });
});

test('context-humanize ignores a password field even with a non-empty selectionText fallback (shortcut shape guard)', () => {
  // Uses a non-empty fallback (unlike the real shortcut, which always sends '') to prove the
  // guard itself blocks password fields unconditionally, not merely that an empty fallback
  // happens to fall through the `if (!text) return` below it. Mirrors the cc-number test
  // above, which proves the same thing for the autocomplete-based branch of the guard.
  document.body.innerHTML = '<input type="password" value="hunter2hunter2">';
  document.querySelector('input')!.focus();
  for (const fn of [...runtimeListeners]) fn({ type: 'context-humanize', selectionText: 'hunter2hunter2' });
  expect(document.getElementById('humanizer-card-host')).toBeNull();
  expect(port.sent).toHaveLength(0);
});

test('streaming chunks keep the request alive past the deadline', () => {
  selectInTextarea();
  clickChip();
  const req = port.sent[0] as { id: string };
  vi.advanceTimersByTime(45_000);
  port.emit({ type: 'chunk', id: req.id, textSoFar: 'partial' });
  vi.advanceTimersByTime(45_000);
  const shadow = document.getElementById('humanizer-card-host')!.shadowRoot!;
  expect(shadow.querySelector('.status')!.textContent).not.toContain('No response');
  vi.advanceTimersByTime(61_000);
  expect(shadow.querySelector('.status')!.textContent).toContain('No response');
});

test('apply then undo restores the original textarea value; no new humanize request is sent', () => {
  selectInTextarea();
  clickChip();
  const req = port.sent[0] as { id: string };
  port.emit({
    type: 'done',
    id: req.id,
    result: {
      rewritten: 'We dig into the plan boldly.',
      changes: [],
      engine: { kind: 'fake', model: 'fake-echo' },
      tells: { before: 1, after: 0 },
    },
  });
  const shadow = document.getElementById('humanizer-card-host')!.shadowRoot!;
  (shadow.querySelector('button.apply') as HTMLButtonElement).click();
  expect(document.querySelector('textarea')!.value).toBe('We dig into the plan boldly.');
  (shadow.querySelector('button.undo') as HTMLButtonElement).click();
  expect(document.querySelector('textarea')!.value).toBe('We delve into the plan boldly.');
  expect(document.getElementById('humanizer-card-host')).toBeNull();
  expect(port.sent.filter(m => (m as { type: string }).type === 'humanize')).toHaveLength(1);
});

test('undo when the field changed underneath surfaces the replace-failed error and leaves the field untouched', () => {
  selectInTextarea();
  clickChip();
  const req = port.sent[0] as { id: string };
  port.emit({
    type: 'done',
    id: req.id,
    result: {
      rewritten: 'We dig into the plan boldly.',
      changes: [],
      engine: { kind: 'fake', model: 'fake-echo' },
      tells: { before: 1, after: 0 },
    },
  });
  const shadow = document.getElementById('humanizer-card-host')!.shadowRoot!;
  (shadow.querySelector('button.apply') as HTMLButtonElement).click();
  const ta = document.querySelector('textarea')!;
  expect(ta.value).toBe('We dig into the plan boldly.');
  // The field changes underneath before the user clicks Undo:
  ta.value = 'Something else entirely.';
  (shadow.querySelector('button.undo') as HTMLButtonElement).click();
  expect(shadow.querySelector('.status')!.textContent).toContain('Could not undo. The text changed again.');
  expect(ta.value).toBe('Something else entirely.');
  expect(document.getElementById('humanizer-card-host')).not.toBeNull();
  expect((shadow.querySelector('button.undo') as HTMLButtonElement).hidden).toBe(false);
});

test('apply then undo restores contenteditable content by relocating the applied text', () => {
  document.body.innerHTML = '<div contenteditable="true">We delve into the plan boldly.</div>';
  const el = document.querySelector('div')!;
  selectWholeContentEditable(el);
  clickChip();
  const req = port.sent[0] as { id: string };
  port.emit({
    type: 'done',
    id: req.id,
    result: {
      rewritten: 'We dig into the plan boldly.',
      changes: [],
      engine: { kind: 'fake', model: 'fake-echo' },
      tells: { before: 1, after: 0 },
    },
  });
  const shadow = document.getElementById('humanizer-card-host')!.shadowRoot!;
  (shadow.querySelector('button.apply') as HTMLButtonElement).click();
  expect(el.textContent).toBe('We dig into the plan boldly.');
  (shadow.querySelector('button.undo') as HTMLButtonElement).click();
  expect(el.textContent).toBe('We delve into the plan boldly.');
  expect(document.getElementById('humanizer-card-host')).toBeNull();
});

test('undo on contenteditable refuses when the applied text becomes ambiguous, leaving content untouched', () => {
  document.body.innerHTML = '<div contenteditable="true">We delve into the plan boldly.</div>';
  const el = document.querySelector('div')!;
  selectWholeContentEditable(el);
  clickChip();
  const req = port.sent[0] as { id: string };
  port.emit({
    type: 'done',
    id: req.id,
    result: {
      rewritten: 'We dig into the plan boldly.',
      changes: [],
      engine: { kind: 'fake', model: 'fake-echo' },
      tells: { before: 1, after: 0 },
    },
  });
  const shadow = document.getElementById('humanizer-card-host')!.shadowRoot!;
  (shadow.querySelector('button.apply') as HTMLButtonElement).click();
  expect(el.textContent).toBe('We dig into the plan boldly.');
  // A second, identical occurrence appears elsewhere in the same editable root:
  el.append(document.createTextNode(' We dig into the plan boldly.'));
  const beforeUndo = el.textContent;
  (shadow.querySelector('button.undo') as HTMLButtonElement).click();
  expect(shadow.querySelector('.status')!.textContent).toContain('Could not undo. The text changed again.');
  expect(el.textContent).toBe(beforeUndo);
});

test('apply then undo on a partial mid-sentence span restores the exact original text across multiple text nodes', () => {
  // Unlike selectWholeContentEditable (whole-element selection), a PARTIAL span
  // selection means replaceInEditable's deleteContents+insertNode fallback splits the
  // element's single text node into several siblings ("We " | rewritten | " boldly,
  // said the team."). rangeFromTextOffsets's TreeWalker loop -- the thing under test
  // here -- is what lets undo re-locate the applied text across that multi-node shape;
  // a naive single-node implementation (e.g. treating root.firstChild as the only text
  // node) cannot find it. Confirmed empirically (see task report) that this DOM shape
  // is genuinely multi-node in jsdom, not just in theory.
  const original = 'We delve into the plan boldly, said the team.';
  document.body.innerHTML = `<div contenteditable="true">${original}</div>`;
  const el = document.querySelector('div')!;
  const start = original.indexOf('delve into the plan');
  const end = start + 'delve into the plan'.length;
  const selected = original.slice(start, end);
  expect(selected).toBe('delve into the plan'); // sanity: exactly the intended middle span, >= 10 chars

  selectRangeInContentEditable(el, start, end);
  clickChip();
  const req = port.sent[0] as { id: string };
  expect(req).toMatchObject({ text: selected });
  const rewrittenSpan = 'dug into the strategy';
  port.emit({
    type: 'done',
    id: req.id,
    result: {
      rewritten: rewrittenSpan,
      changes: [],
      engine: { kind: 'fake', model: 'fake-echo' },
      tells: { before: 1, after: 0 },
    },
  });
  const shadow = document.getElementById('humanizer-card-host')!.shadowRoot!;
  (shadow.querySelector('button.apply') as HTMLButtonElement).click();
  expect(el.textContent).toBe('We dug into the strategy boldly, said the team.');
  // Confirms the DOM genuinely has multiple text-node siblings after apply (not one
  // fresh node), so the undo below can only succeed by walking them.
  expect(el.childNodes.length).toBeGreaterThan(1);

  (shadow.querySelector('button.undo') as HTMLButtonElement).click();
  expect(el.textContent).toBe('We delve into the plan boldly, said the team.');
  expect(document.getElementById('humanizer-card-host')).toBeNull();
});

test('clicking Undo a second time after a successful undo is a safe no-op', () => {
  selectInTextarea();
  clickChip();
  const req = port.sent[0] as { id: string };
  port.emit({
    type: 'done',
    id: req.id,
    result: {
      rewritten: 'We dig into the plan boldly.',
      changes: [],
      engine: { kind: 'fake', model: 'fake-echo' },
      tells: { before: 1, after: 0 },
    },
  });
  const shadow = document.getElementById('humanizer-card-host')!.shadowRoot!;
  (shadow.querySelector('button.apply') as HTMLButtonElement).click();
  const undoBtn = shadow.querySelector('button.undo') as HTMLButtonElement;
  undoBtn.click();
  const ta = document.querySelector('textarea')!;
  expect(ta.value).toBe('We delve into the plan boldly.');
  expect(document.getElementById('humanizer-card-host')).toBeNull();
  const sentBeforeSecondClick = port.sent.length;

  expect(() => undoBtn.click()).not.toThrow();

  expect(ta.value).toBe('We delve into the plan boldly.');
  expect(port.sent).toHaveLength(sentBeforeSecondClick);
  expect(document.getElementById('humanizer-card-host')).toBeNull();
});

test('undo after the contenteditable root is removed from the DOM shows the error and does not throw', () => {
  document.body.innerHTML = '<div contenteditable="true">We delve into the plan boldly.</div>';
  const el = document.querySelector('div')!;
  selectWholeContentEditable(el);
  clickChip();
  const req = port.sent[0] as { id: string };
  port.emit({
    type: 'done',
    id: req.id,
    result: {
      rewritten: 'We dig into the plan boldly.',
      changes: [],
      engine: { kind: 'fake', model: 'fake-echo' },
      tells: { before: 1, after: 0 },
    },
  });
  const shadow = document.getElementById('humanizer-card-host')!.shadowRoot!;
  (shadow.querySelector('button.apply') as HTMLButtonElement).click();
  expect(el.textContent).toBe('We dig into the plan boldly.');
  el.remove();
  expect(el.isConnected).toBe(false);

  const undoBtn = shadow.querySelector('button.undo') as HTMLButtonElement;
  expect(() => undoBtn.click()).not.toThrow();

  expect(shadow.querySelector('.status')!.textContent).toContain('Could not undo. The text changed again.');
  expect(document.getElementById('humanizer-card-host')).not.toBeNull();
});

test('after the 10s auto-dismiss, a stale reference to the undo button can no longer undo the applied text', () => {
  selectInTextarea();
  clickChip();
  const req = port.sent[0] as { id: string };
  port.emit({
    type: 'done',
    id: req.id,
    result: {
      rewritten: 'We dig into the plan boldly.',
      changes: [],
      engine: { kind: 'fake', model: 'fake-echo' },
      tells: { before: 1, after: 0 },
    },
  });
  const shadow = document.getElementById('humanizer-card-host')!.shadowRoot!;
  (shadow.querySelector('button.apply') as HTMLButtonElement).click();
  const ta = document.querySelector('textarea')!;
  expect(ta.value).toBe('We dig into the plan boldly.');

  // Grab a reference to Undo before the auto-dismiss timer removes the card from
  // the document; a detached DOM node keeps its listener, so this is how a stray
  // or delayed click could still reach the session after the card is gone.
  const undoBtn = shadow.querySelector('button.undo') as HTMLButtonElement;

  vi.advanceTimersByTime(10_000);
  expect(document.getElementById('humanizer-card-host')).toBeNull();

  // The session's applied record has to be cleared through the same cleanup path
  // a manual dismiss uses (not just a card-local close()), or this stray click
  // would silently revert the field back to the original text.
  undoBtn.click();
  expect(ta.value).toBe('We dig into the plan boldly.');
});
