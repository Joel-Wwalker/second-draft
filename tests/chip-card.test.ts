// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest';
import { Chip } from '../src/content/chip';
import { Card } from '../src/content/card';
import type { HumanizeResult } from '../src/shared/types';

beforeEach(() => {
  document.body.innerHTML = '';
});

const noop = { onApply: () => {}, onCopy: () => {}, onDismiss: () => {}, onIntensityChange: () => {} };

test('chip mounts on show, fires on mousedown, unmounts on hide', () => {
  const onClick = vi.fn();
  const chip = new Chip(document, onClick);
  chip.showAt(10, 20);
  const host = document.getElementById('humanizer-chip-host')!;
  const btn = host.shadowRoot!.querySelector('button')!;
  expect(btn.textContent).toBe('Humanize');
  btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  expect(onClick).toHaveBeenCalledOnce();
  expect(chip.contains(btn)).toBe(true);
  expect(chip.contains(document.body)).toBe(false);
  chip.hide();
  expect(document.getElementById('humanizer-chip-host')).toBeNull();
});

test('card renders a result with highlight marks and engine label', () => {
  const card = new Card(document, noop);
  card.open({ left: 0, bottom: 0 }, { canApply: true, intensity: 'full' });
  const result: HumanizeResult = {
    rewritten: 'We dig in.',
    changes: [{ range: { start: 3, end: 6 }, ruleId: 'ai-vocab', reason: 'AI-associated vocabulary' }],
    engine: { kind: 'fake', model: 'fake-echo' },
  };
  card.setResult(result);
  const shadow = document.getElementById('humanizer-card-host')!.shadowRoot!;
  const mark = shadow.querySelector('.rewritten mark')!;
  expect(mark.textContent).toBe('dig');
  expect(mark.getAttribute('title')).toBe('AI-associated vocabulary');
  expect(shadow.querySelector('.engine')!.textContent).toContain('Test engine (fake-echo)');
  expect((shadow.querySelector('button.apply') as HTMLButtonElement).hidden).toBe(false);
  expect(card.contains(shadow.querySelector('button.apply'))).toBe(true);
  expect(card.contains(document.body)).toBe(false);
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
