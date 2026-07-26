// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { PortServerMessage } from '../src/shared/messages';

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
let session: import('../src/content/session').HumanizeSession;

beforeEach(async () => {
  vi.useFakeTimers();
  port = new FakePort();
  const store: Record<string, unknown> = {
    settings: { defaultIntensity: 'full', useFakeProvider: true, disabledSites: [] },
  };
  runtimeListeners = [];
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
      onChanged: { addListener: (): void => undefined },
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
    },
  });
  const shadow = document.getElementById('humanizer-card-host')!.shadowRoot!;
  expect(shadow.querySelector('.rewritten')!.textContent).toBe('We dig into the plan boldly.');
  (shadow.querySelector('button.apply') as HTMLButtonElement).click();
  expect(document.querySelector('textarea')!.value).toBe('We dig into the plan boldly.');
  expect(document.getElementById('humanizer-card-host')).toBeNull();
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
    result: { rewritten: 'STALE', changes: [], engine: { kind: 'fake' } },
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

test('selection changes after stop() never show the chip', () => {
  session.stop();
  selectInTextarea();
  expect(document.getElementById('humanizer-chip-host')).toBeNull();
});
