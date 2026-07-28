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

beforeEach(async () => {
  vi.useFakeTimers();
  port = new FakePort();
  const store: Record<string, unknown> = {
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
