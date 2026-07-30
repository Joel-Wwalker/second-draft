// @vitest-environment node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { buildSystemPrompt } from '../src/engine/prompts';
import { detect } from '../src/engine/rules';
import { cadenceInstruction, isFlat, measureCadence } from '../src/shared/cadence';
import { isMonotonous, measureStructure, structureInstruction } from '../src/shared/structure';

/**
 * A build step for evaluation batches, wearing a test's clothes because vitest is
 * the only TypeScript runner this project has and the point is to use the engine's
 * real prompt rather than a copy of it. Skips when there is no batch waiting, so
 * it costs nothing in the normal suite. See eval/README.md.
 */
const SOURCES = path.resolve('eval/sources.json');
const OUT = path.resolve('eval/prompts.json');

/** Mirrors the engine's styleNotes(), which is private to src/engine/index.ts. */
function styleNotes(text: string): string {
  const cadence = measureCadence(text);
  const structure = measureStructure(text);
  const notes: string[] = [];
  if (cadence && isFlat(cadence)) notes.push(cadenceInstruction(cadence));
  if (structure && isMonotonous(structure)) notes.push(structureInstruction(structure));
  if (notes.length === 0) return '';
  if (cadence && !isFlat(cadence)) {
    notes.push(
      `The sentence lengths here already vary: ${cadence.lengths.join(', ')} words. Keep a spread like that. Do not even the lengths out while changing anything else.`,
    );
  }
  if (structure && !isMonotonous(structure)) {
    notes.push('Sentence openings here already vary. Keep that while changing anything else.');
  }
  return notes.join(' ');
}

test.skipIf(!existsSync(SOURCES))('build prompts for the waiting batch', () => {
  const sources = JSON.parse(readFileSync(SOURCES, 'utf8')) as Array<{ topic: string; text: string }>;
  const prompts = sources.map(({ topic, text }) => ({
    topic,
    input: text,
    systemPrompt: buildSystemPrompt({
      intensity: 'full',
      tells: detect(text, []),
      target: 'nano',
      cadence: styleNotes(text) || undefined,
    }),
  }));
  writeFileSync(OUT, JSON.stringify(prompts));
  expect(prompts.length).toBeGreaterThan(0);
});
