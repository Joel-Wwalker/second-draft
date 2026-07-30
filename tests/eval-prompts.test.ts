// @vitest-environment node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { buildSystemPrompt } from '../src/engine/prompts';
import { styleNotes } from '../src/engine';
import { detect } from '../src/engine/rules';

/**
 * A build step for evaluation batches, wearing a test's clothes because vitest is
 * the only TypeScript runner this project has and the point is to use the
 * engine's real prompt rather than a copy of it. styleNotes is imported from the
 * engine for the same reason: a private mirror of it drifted once already.
 * Skips when there is no batch waiting. See eval/README.md.
 */
const SOURCES = path.resolve('eval/sources.json');
const OUT = path.resolve('eval/prompts.json');

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
