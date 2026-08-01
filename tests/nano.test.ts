import { afterEach, expect, test } from 'vitest';
import { NanoProvider, accumulate, chunkText , nanoAvailability } from '../src/engine/providers/nano';

function fakeSession(replies: string[][]): {
  session: LanguageModelSession;
  prompts: string[];
  destroyed: () => boolean;
} {
  const prompts: string[] = [];
  let destroyed = false;
  let call = 0;
  const session: LanguageModelSession = {
    prompt: async input => {
      prompts.push(input);
      return (replies[call++] ?? ['']).join('');
    },
    promptStreaming: input => {
      prompts.push(input);
      const parts = replies[call++] ?? [''];
      return new ReadableStream<string>({
        start(controller) {
          for (const part of parts) controller.enqueue(part);
          controller.close();
        },
      });
    },
    destroy: () => {
      destroyed = true;
    },
  };
  return { session, prompts, destroyed: () => destroyed };
}

function installLanguageModel(
  availability: LanguageModelAvailability,
  replies: string[][],
): ReturnType<typeof fakeSession> {
  const fake = fakeSession(replies);
  (globalThis as Record<string, unknown>)['LanguageModel'] = {
    availability: async () => availability,
    create: async () => fake.session,
  } satisfies LanguageModelStatic;
  return fake;
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>)['LanguageModel'];
});

test('accumulate handles delta and cumulative streams', () => {
  expect(accumulate('', 'He')).toBe('He');
  expect(accumulate('He', 'llo')).toBe('Hello');
  expect(accumulate('He', 'Hello')).toBe('Hello');
});

test('chunkText concatenation equals the input and respects paragraph bounds', () => {
  const text = 'para one\n\npara two\n\npara three';
  const chunks = chunkText(text, 12);
  expect(chunks.join('')).toBe(text);
  expect(chunks.length).toBeGreaterThan(1);
  const giant = 'x'.repeat(9001);
  expect(chunkText(giant, 4000).join('')).toBe(giant);
});

test('available means willing: downloadable and downloading are yes, only truly missing is no', async () => {
  // 'downloadable' => false was a bootstrap deadlock, and a test asserted it:
  // per-origin availability only becomes 'available' after the origin calls
  // create(), and the gate refused to create until 'available'. Five paragraphs
  // fell back to the rules engine on every run while pages that never check
  // rewrote the same text on the same machine.
  const provider = new NanoProvider();
  expect(await provider.available()).toBe(false);
  installLanguageModel('downloadable', []);
  expect(await provider.available()).toBe(true);
  installLanguageModel('downloading', []);
  expect(await provider.available()).toBe(true);
  installLanguageModel('unavailable', []);
  expect(await provider.available()).toBe(false);
  installLanguageModel('available', []);
  expect(await provider.available()).toBe(true);
});

test('rewrites via streaming, reports chunks, destroys the session', async () => {
  const fake = installLanguageModel('available', [['Rewritten ', 'text.']]);
  const provider = new NanoProvider();
  const seen: string[] = [];
  const out = await provider.rewrite({
    text: 'input text here',
    systemPrompt: 'SYSTEM',
    onChunk: t => seen.push(t),
  });
  expect(out).toBe('Rewritten text.');
  expect(seen).toEqual(['Rewritten ', 'Rewritten text.']);
  expect(fake.prompts).toEqual(['input text here']);
  expect(fake.destroyed()).toBe(true);
});

test('multi-chunk inputs are rewritten sequentially and joined', async () => {
  const fake = installLanguageModel('available', [['ONE'], ['TWO']]);
  const provider = new NanoProvider();
  const text = `${'a'.repeat(3000)}\n\n${'b'.repeat(3000)}`;
  const out = await provider.rewrite({ text, systemPrompt: 'S' });
  expect(fake.prompts).toHaveLength(2);
  expect(out).toBe('ONE\n\nTWO');
});

test('throws nano-unavailable without the global', async () => {
  const provider = new NanoProvider();
  await expect(provider.rewrite({ text: 't', systemPrompt: 's' })).rejects.toMatchObject({
    kind: 'nano-unavailable',
  });
});

test('aborts between chunks', async () => {
  installLanguageModel('available', [['ONE'], ['TWO']]);
  const provider = new NanoProvider();
  const ctl = new AbortController();
  const text = `${'a'.repeat(3000)}\n\n${'b'.repeat(3000)}`;
  const promise = provider.rewrite({
    text,
    systemPrompt: 'S',
    signal: ctl.signal,
    onChunk: () => ctl.abort(),
  });
  await expect(promise).rejects.toMatchObject({ kind: 'aborted' });
});

test('hard-splits an oversized paragraph even after prior content', () => {
  const text = `Intro\n\n${'y'.repeat(9000)}`;
  const chunks = chunkText(text, 4000);
  expect(chunks.join('')).toBe(text);
  expect(Math.max(...chunks.map(c => c.length))).toBeLessThanOrEqual(4000);
});

test('multi-chunk onChunk reports cumulative text across chunks', async () => {
  installLanguageModel('available', [['ONE'], ['TWO']]);
  const provider = new NanoProvider();
  const text = `${'a'.repeat(3000)}\n\n${'b'.repeat(3000)}`;
  const seen: string[] = [];
  await provider.rewrite({ text, systemPrompt: 'S', onChunk: t => seen.push(t) });
  expect(seen).toEqual(['ONE', 'ONE\n\nTWO']);
});

test('stream failures map to internal and mid-stream aborts to aborted', async () => {
  const failing = (error: unknown): LanguageModelStatic => ({
    availability: async () => 'available',
    create: async () => ({
      prompt: async () => '',
      promptStreaming: () =>
        new ReadableStream<string>({
          start(controller) {
            controller.error(error);
          },
        }),
      destroy: () => {},
    }),
  });
  (globalThis as Record<string, unknown>)['LanguageModel'] = failing(new Error('boom'));
  const provider = new NanoProvider();
  await expect(provider.rewrite({ text: 't', systemPrompt: 's' })).rejects.toMatchObject({ kind: 'internal' });
  (globalThis as Record<string, unknown>)['LanguageModel'] = failing(new DOMException('x', 'AbortError'));
  await expect(provider.rewrite({ text: 't', systemPrompt: 's' })).rejects.toMatchObject({ kind: 'aborted' });
});

test('nanoAvailability reports no-api, the value, and error without throwing', async () => {
  const g = globalThis as { LanguageModel?: unknown };
  const saved = g.LanguageModel;
  try {
    delete g.LanguageModel;
    expect(await nanoAvailability()).toBe('no-api');
    g.LanguageModel = { availability: async () => 'downloadable' };
    expect(await nanoAvailability()).toBe('downloadable');
    g.LanguageModel = {
      availability: async () => {
        throw new Error('boom');
      },
    };
    expect(await nanoAvailability()).toBe('error');
  } finally {
    if (saved === undefined) delete g.LanguageModel;
    else g.LanguageModel = saved;
  }
});
