import { expect, test } from 'vitest';
import { applyContractions, isFirstPerson } from '../src/shared/contractions';

test('first-person prose contracts the safe subset and only that', () => {
  expect(applyContractions('I did not know anyone and I was not ready.')).toBe(
    "I didn't know anyone and I wasn't ready.",
  );
  expect(applyContractions('I am sure I have seen this before.')).toBe("I'm sure I've seen this before.");
  expect(applyContractions('I will call if I would rather stay.')).toBe("I'll call if I'd rather stay.");
  // Emphasis constructions are meaning, not stiffness.
  expect(applyContractions('He did not only lose; he did not, in fact, even start.')).toBe(
    'He did not only lose; he did not, in fact, even start.',
  );
  // "I have no idea" must not become "I've no idea" for American ears.
  expect(applyContractions('I have no idea what happened.')).toBe('I have no idea what happened.');
});

test('quoted speech is never contracted', () => {
  const t = 'She said "I did not do this" and I did not believe her.';
  expect(applyContractions(t)).toBe('She said "I did not do this" and I didn\'t believe her.');
});

test('isFirstPerson keys on the writer, not on any capital I', () => {
  expect(isFirstPerson('I stayed quiet at first because it was new.')).toBe(true);
  expect(isFirstPerson('My first day went badly, then better.')).toBe(true);
  expect(isFirstPerson('The committee approved the schedule for March.')).toBe(false);
});
