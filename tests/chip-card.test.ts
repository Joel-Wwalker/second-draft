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
  onTextEdited: () => {},
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

test('ring headline reports remaining tells when some survive', () => {
  const card = new Card(document, noop);
  card.open({ left: 0, bottom: 0 }, { canApply: true, intensity: 'full' });
  card.setResult(
    { rewritten: 'still delve here', changes: [], engine: { kind: 'rules' }, tells: { before: 3, after: 2 } },
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
    { rewritten: 'We delve here today.', changes: [], engine: { kind: 'rules' }, tells: { before: 1, after: 1 } },
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
