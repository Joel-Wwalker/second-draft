// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest';
import { Chip } from '../src/content/chip';
import { Card } from '../src/content/card';
import type { HumanizeResult } from '../src/shared/types';

beforeEach(() => {
  document.body.innerHTML = '';
});

const noop = {
  onApply: () => {},
  onCopy: () => {},
  onDismiss: () => {},
  onIntensityChange: () => {},
  onRegenerate: () => {},
  onTextEdited: () => {},
  onUndo: () => {},
};

test('chip mounts on show, fires on mousedown, unmounts on hide', () => {
  const onClick = vi.fn();
  const chip = new Chip(document, onClick);
  chip.showAt(10, 20);
  const host = document.getElementById('humanizer-chip-host')!;
  const btn = host.shadowRoot!.querySelector('button')!;
  expect(btn.textContent).toContain('Humanize');
  btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  expect(onClick).toHaveBeenCalledOnce();
  expect(chip.contains(btn)).toBe(true);
  expect(chip.contains(document.body)).toBe(false);
  chip.showAt(10, 20, 3);
  expect(host.shadowRoot!.querySelectorAll('span')[1]!.textContent).toBe('3');
  chip.hide();
  expect(document.getElementById('humanizer-chip-host')).toBeNull();
});

test('card renders a result with highlight marks and engine label', () => {
  const card = new Card(document, noop);
  card.open({ left: 0, bottom: 0 }, { canApply: true, intensity: 'full' });
  const result: HumanizeResult = {
    rewritten: 'We dig in.',
    changes: [
      { range: { start: 3, end: 6 }, from: { start: 3, end: 8 }, ruleId: 'ai-vocab', reason: 'AI-associated vocabulary' },
    ],
    engine: { kind: 'fake', model: 'fake-echo' },
    tells: { before: 1, after: 0 },
      fidelity: [],
      retried: false,
  };
  card.setResult(result, 'We delve in.');
  const shadow = document.getElementById('humanizer-card-host')!.shadowRoot!;
  const mark = shadow.querySelector('.rewritten mark')!;
  expect(mark.textContent).toBe('dig');
  expect(mark.getAttribute('title')).toBe('AI-associated vocabulary');
  expect(shadow.querySelector('.engine')!.textContent).toContain('Test engine (fake-echo)');
  expect(shadow.querySelector('.status')!.textContent).toBe('1 change · AI tells: 1 → 0');
  expect((shadow.querySelector('button.apply') as HTMLButtonElement).hidden).toBe(false);
  expect(card.contains(shadow.querySelector('button.apply'))).toBe(true);
  expect(card.contains(document.body)).toBe(false);
  const rows = shadow.querySelectorAll('.chg');
  expect(rows).toHaveLength(1);
  expect(rows[0]!.textContent).toContain('delve');
  expect(rows[0]!.textContent).toContain('dig');
  expect(shadow.querySelector('.headline .h')!.textContent).toBe('All clear');
  expect(shadow.querySelector('.ring .num')!.textContent).toBe('0');
});

test('setResult renders a profile note when one is given', () => {
  const card = new Card(document, noop);
  card.open({ left: 0, bottom: 0 }, { canApply: true, intensity: 'full' });
  card.setResult(
    { rewritten: 'We dig in.', changes: [], engine: { kind: 'fake', model: 'fake-echo' }, tells: { before: 1, after: 0 }, fidelity: [], retried: false },
    'We delve in.',
    'Your writing averages 10.8 word sentences; this runs 22.',
  );
  const shadow = document.getElementById('humanizer-card-host')!.shadowRoot!;
  const note = shadow.querySelector('.profile-note') as HTMLElement | null;
  expect(note).not.toBeNull();
  expect(note!.textContent).toBe('Your writing averages 10.8 word sentences; this runs 22.');
  expect(note!.hidden).toBe(false);
});

test('setResult leaves the profile note hidden and empty when no note is given', () => {
  const card = new Card(document, noop);
  card.open({ left: 0, bottom: 0 }, { canApply: true, intensity: 'full' });
  card.setResult(
    { rewritten: 'We dig in.', changes: [], engine: { kind: 'fake', model: 'fake-echo' }, tells: { before: 1, after: 0 }, fidelity: [], retried: false },
    'We delve in.',
  );
  const shadow = document.getElementById('humanizer-card-host')!.shadowRoot!;
  const note = shadow.querySelector('.profile-note') as HTMLElement | null;
  expect(note === null || (note.hidden && note.textContent === '')).toBe(true);
});

test('ring headline reports remaining tells when some survive', () => {
  const card = new Card(document, noop);
  card.open({ left: 0, bottom: 0 }, { canApply: true, intensity: 'full' });
  card.setResult(
    { rewritten: 'still delve here', changes: [], engine: { kind: 'rules' }, tells: { before: 3, after: 2 }, fidelity: [], retried: false },
    'still delve here',
  );
  const shadow = document.getElementById('humanizer-card-host')!.shadowRoot!;
  expect(shadow.querySelector('.headline .h')!.textContent).toBe('2 tells left');
  expect(shadow.querySelector('.ring .num')!.textContent).toBe('2');
});

test('card hides Apply when canApply is false', () => {
  const card = new Card(document, noop);
  card.open({ left: 0, bottom: 0 }, { canApply: false, intensity: 'light' });
  const shadow = document.getElementById('humanizer-card-host')!.shadowRoot!;
  expect((shadow.querySelector('button.apply') as HTMLButtonElement).hidden).toBe(true);
});

test('Escape while open triggers onDismiss', () => {
  const onDismiss = vi.fn();
  const card = new Card(document, { ...noop, onDismiss });
  card.open({ left: 0, bottom: 0 }, { canApply: true, intensity: 'full' });
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(onDismiss).toHaveBeenCalledOnce();
});

test('error state shows the message', () => {
  const card = new Card(document, noop);
  card.open({ left: 0, bottom: 0 }, { canApply: true, intensity: 'full' });
  card.setError('too-long', 'Input is too large.');
  const shadow = document.getElementById('humanizer-card-host')!.shadowRoot!;
  expect(shadow.querySelector('.status')!.textContent).toContain('Input is too large.');
});

test('alternative words are clickable and swapping edits the pending text', () => {
  const edits: string[] = [];
  const card = new Card(document, { ...noop, onTextEdited: t => edits.push(t) });
  card.open({ left: 0, bottom: 0 }, { canApply: true, intensity: 'full' });
  card.setResult(
    { rewritten: 'We delve here today.', changes: [], engine: { kind: 'rules' }, tells: { before: 1, after: 1 }, fidelity: [], retried: false },
    'We delve here today.',
  );
  const shadow = document.getElementById('humanizer-card-host')!.shadowRoot!;
  const alt = shadow.querySelector('button.alt') as HTMLButtonElement;
  expect(alt.textContent).toBe('delve');
  alt.click();
  const options = [...shadow.querySelectorAll('button.alt-opt')].map(b => b.textContent);
  expect(options).toEqual(['dig', 'look', 'get']);
  (shadow.querySelectorAll('button.alt-opt')[0] as HTMLButtonElement).click();
  expect(edits).toEqual(['We dig here today.']);
  expect(shadow.querySelector('.rewritten')!.textContent).toBe('We dig here today.');
});

test('showApplied switches to the undo confirmation state', () => {
  const card = new Card(document, noop);
  card.open({ left: 0, bottom: 0 }, { canApply: true, intensity: 'full' });
  card.setResult(
    { rewritten: 'We dig in.', changes: [], engine: { kind: 'fake', model: 'fake-echo' }, tells: { before: 1, after: 0 }, fidelity: [], retried: false },
    'We delve in.',
  );
  card.showApplied();
  const shadow = document.getElementById('humanizer-card-host')!.shadowRoot!;
  expect((shadow.querySelector('button.apply') as HTMLButtonElement).hidden).toBe(true);
  expect((shadow.querySelector('button.copy') as HTMLButtonElement).hidden).toBe(true);
  expect((shadow.querySelector('select.intensity') as HTMLSelectElement).hidden).toBe(true);
  // setResult (above) makes Try again visible; the applied confirmation is a
  // single-action bar (Undo next to Dismiss), so it must go back into hiding too.
  expect((shadow.querySelector('button.regen') as HTMLButtonElement).hidden).toBe(true);
  const undoBtn = shadow.querySelector('button.undo') as HTMLButtonElement;
  expect(undoBtn.hidden).toBe(false);
  expect(undoBtn.textContent).toBe('Undo');
  expect(shadow.querySelector('.headline .h')!.textContent).toBe('Applied');
  expect(shadow.querySelector('.rewritten')!.textContent).toBe('Replaced in place.');
});

test('button.regen sits left of Copy, hidden on open, visible after setResult, hidden again after setStreaming', () => {
  const card = new Card(document, noop);
  card.open({ left: 0, bottom: 0 }, { canApply: true, intensity: 'full' });
  const shadow = document.getElementById('humanizer-card-host')!.shadowRoot!;
  const regenBtn = shadow.querySelector('button.regen') as HTMLButtonElement;
  expect(regenBtn.textContent).toBe('Try again');
  expect(regenBtn.hidden).toBe(true);
  const barButtonClasses = [...shadow.querySelectorAll('.bar button')].map(b => b.className);
  expect(barButtonClasses.indexOf('regen')).toBeLessThan(barButtonClasses.indexOf('copy'));

  card.setResult(
    { rewritten: 'We dig in.', changes: [], engine: { kind: 'fake', model: 'fake-echo' }, tells: { before: 1, after: 0 }, fidelity: [], retried: false },
    'We delve in.',
  );
  expect(regenBtn.hidden).toBe(false);

  card.setStreaming('midway');
  expect(regenBtn.hidden).toBe(true);
});

test('clicking button.regen fires onRegenerate', () => {
  const onRegenerate = vi.fn();
  const card = new Card(document, { ...noop, onRegenerate });
  card.open({ left: 0, bottom: 0 }, { canApply: true, intensity: 'full' });
  card.setResult(
    { rewritten: 'We dig in.', changes: [], engine: { kind: 'fake', model: 'fake-echo' }, tells: { before: 1, after: 0 }, fidelity: [], retried: false },
    'We delve in.',
  );
  const shadow = document.getElementById('humanizer-card-host')!.shadowRoot!;
  (shadow.querySelector('button.regen') as HTMLButtonElement).click();
  expect(onRegenerate).toHaveBeenCalledOnce();
});

test('auto-dismiss timer fires onDismiss exactly 10s after showApplied, not before, and leaves closing to the callback', () => {
  vi.useFakeTimers();
  try {
    const onDismiss = vi.fn();
    const card = new Card(document, { ...noop, onDismiss });
    card.open({ left: 0, bottom: 0 }, { canApply: true, intensity: 'full' });
    card.showApplied();
    expect(card.isOpen).toBe(true);
    vi.advanceTimersByTime(9_999);
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onDismiss).toHaveBeenCalledOnce();
    // The card no longer closes itself on auto-dismiss (that bypassed session-level
    // cleanup); it routes through onDismiss, same as the Dismiss button, and leaves
    // actually closing to whatever the callback does (HumanizeSession.dismissCard).
    expect(card.isOpen).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

test('close() clears the pending auto-dismiss timer', () => {
  vi.useFakeTimers();
  try {
    const card = new Card(document, noop);
    card.open({ left: 0, bottom: 0 }, { canApply: true, intensity: 'full' });
    card.showApplied();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    card.close();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

test('open() clears a pending auto-dismiss timer left over from a previous cycle', () => {
  vi.useFakeTimers();
  try {
    const card = new Card(document, noop);
    card.open({ left: 0, bottom: 0 }, { canApply: true, intensity: 'full' });
    card.showApplied();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    card.open({ left: 0, bottom: 0 }, { canApply: true, intensity: 'full' });
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

test('a second open() after showApplied() restores apply/copy/intensity visibility and hides undo', () => {
  const card = new Card(document, noop);
  card.open({ left: 0, bottom: 0 }, { canApply: true, intensity: 'full' });
  card.showApplied();
  const shadow = document.getElementById('humanizer-card-host')!.shadowRoot!;
  expect((shadow.querySelector('button.apply') as HTMLButtonElement).hidden).toBe(true);
  expect((shadow.querySelector('button.copy') as HTMLButtonElement).hidden).toBe(true);
  expect((shadow.querySelector('select.intensity') as HTMLSelectElement).hidden).toBe(true);
  expect((shadow.querySelector('button.undo') as HTMLButtonElement).hidden).toBe(false);

  card.open({ left: 0, bottom: 0 }, { canApply: true, intensity: 'full' });

  expect((shadow.querySelector('button.apply') as HTMLButtonElement).hidden).toBe(false);
  expect((shadow.querySelector('button.copy') as HTMLButtonElement).hidden).toBe(false);
  expect((shadow.querySelector('select.intensity') as HTMLSelectElement).hidden).toBe(false);
  expect((shadow.querySelector('button.undo') as HTMLButtonElement).hidden).toBe(true);
});

test('open() hides button.regen when it was left visible by a previous result', () => {
  const card = new Card(document, noop);
  card.open({ left: 0, bottom: 0 }, { canApply: true, intensity: 'full' });
  card.setResult(
    { rewritten: 'We dig in.', changes: [], engine: { kind: 'fake', model: 'fake-echo' }, tells: { before: 1, after: 0 }, fidelity: [], retried: false },
    'We delve in.',
  );
  const shadow = document.getElementById('humanizer-card-host')!.shadowRoot!;
  const regenBtn = shadow.querySelector('button.regen') as HTMLButtonElement;
  expect(regenBtn.hidden).toBe(false);

  // A second open() -- e.g. the context menu, or a future keyboard shortcut,
  // reopening the card while it is still showing "Try again" from a prior result
  // -- must hide regen again. Nothing else in this sequence touches regen, so
  // this exercises open()'s own reset line specifically (unlike the "hidden on
  // open" clause of the regen-visibility test above, which starts from a freshly
  // constructed card whose regenBtn is already hidden by the constructor default).
  card.open({ left: 0, bottom: 0 }, { canApply: true, intensity: 'full' });
  expect(regenBtn.hidden).toBe(true);
});

test('a stale timer from an earlier cycle never force-closes a card that was closed and reopened', () => {
  vi.useFakeTimers();
  try {
    const card = new Card(document, noop);
    card.open({ left: 0, bottom: 0 }, { canApply: true, intensity: 'full' });
    card.showApplied();
    card.close();
    card.open({ left: 0, bottom: 0 }, { canApply: true, intensity: 'full' });
    vi.advanceTimersByTime(10_000);
    expect(card.isOpen).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

test('clicking Undo fires onUndo and cancels the auto-dismiss timer', () => {
  vi.useFakeTimers();
  try {
    const onUndo = vi.fn();
    const card = new Card(document, { ...noop, onUndo });
    card.open({ left: 0, bottom: 0 }, { canApply: true, intensity: 'full' });
    card.showApplied();
    const shadow = document.getElementById('humanizer-card-host')!.shadowRoot!;
    (shadow.querySelector('button.undo') as HTMLButtonElement).click();
    expect(onUndo).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(10_000);
    expect(card.isOpen).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

test('clicking Dismiss after showApplied cancels the auto-dismiss timer', () => {
  vi.useFakeTimers();
  try {
    const card = new Card(document, noop);
    card.open({ left: 0, bottom: 0 }, { canApply: true, intensity: 'full' });
    card.showApplied();
    const shadow = document.getElementById('humanizer-card-host')!.shadowRoot!;
    (shadow.querySelector('button.dismiss') as HTMLButtonElement).click();
    vi.advanceTimersByTime(10_000);
    expect(card.isOpen).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

test('the card shows a working state while a rewrite is in flight and drops it on a result', () => {
  const card = new Card(document, noop);
  card.open({ left: 0, bottom: 0 }, { canApply: true, intensity: 'full' });
  const shadow = document.getElementById('humanizer-card-host')!.shadowRoot!;
  expect(shadow.querySelector('.ring')!.classList.contains('working')).toBe(true);
  expect(shadow.querySelector('.status')!.classList.contains('working-dots')).toBe(true);
  card.setStreaming('partial text');
  expect(shadow.querySelector('.ring')!.classList.contains('working')).toBe(true);
  expect(shadow.querySelector('.rewritten')!.classList.contains('streaming')).toBe(true);
  card.setResult(
    { rewritten: 'done text', changes: [], engine: { kind: 'rules' }, tells: { before: 1, after: 0 }, fidelity: [], retried: false },
    'done text',
  );
  expect(shadow.querySelector('.ring')!.classList.contains('working')).toBe(false);
  expect(shadow.querySelector('.status')!.classList.contains('working-dots')).toBe(false);
  expect(shadow.querySelector('.rewritten')!.classList.contains('streaming')).toBe(false);
});

test('an error also drops the working state', () => {
  const card = new Card(document, noop);
  card.open({ left: 0, bottom: 0 }, { canApply: true, intensity: 'full' });
  card.setError('network', 'No connection.');
  const shadow = document.getElementById('humanizer-card-host')!.shadowRoot!;
  expect(shadow.querySelector('.ring')!.classList.contains('working')).toBe(false);
  expect(shadow.querySelector('.status')!.classList.contains('working-dots')).toBe(false);
});

test('a rewrite that may have lost content shows a warning and needs a second Apply click', () => {
  let applied = 0;
  const card = new Card(document, { ...noop, onApply: () => { applied += 1; } });
  card.open({ left: 0, bottom: 0 }, { canApply: true, intensity: 'full' });
  card.setResult(
    {
      rewritten: 'short',
      changes: [],
      engine: { kind: 'rules' },
      tells: { before: 1, after: 0 },
      fidelity: [{ kind: 'missing-facts', message: 'Missing from the rewrite: 1994.' }],
      retried: false,
    },
    'The company was founded in 1994 and grew steadily for a decade after that.',
  );
  const shadow = document.getElementById('humanizer-card-host')!.shadowRoot!;
  const warning = shadow.querySelector('.fidelity') as HTMLElement;
  expect(warning.hidden).toBe(false);
  expect(warning.textContent).toContain('1994');
  const apply = shadow.querySelector('button.apply') as HTMLButtonElement;
  apply.click();
  expect(applied).toBe(0);
  expect(apply.textContent).toBe('Apply anyway');
  apply.click();
  expect(applied).toBe(1);
});

test('a faithful rewrite hides the warning and applies on one click', () => {
  let applied = 0;
  const card = new Card(document, { ...noop, onApply: () => { applied += 1; } });
  card.open({ left: 0, bottom: 0 }, { canApply: true, intensity: 'full' });
  card.setResult(
    { rewritten: 'ok', changes: [], engine: { kind: 'rules' }, tells: { before: 1, after: 0 }, fidelity: [], retried: false },
    'ok',
  );
  const shadow = document.getElementById('humanizer-card-host')!.shadowRoot!;
  expect((shadow.querySelector('.fidelity') as HTMLElement).hidden).toBe(true);
  const apply = shadow.querySelector('button.apply') as HTMLButtonElement;
  expect(apply.textContent).toBe('Apply');
  apply.click();
  expect(applied).toBe(1);
});
