import { expect, test } from 'vitest';
import { parseSSE } from '../src/shared/sse';

function streamOf(...parts: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
}

async function collect(body: ReadableStream<Uint8Array>): Promise<string[]> {
  const out: string[] = [];
  for await (const data of parseSSE(body)) out.push(data);
  return out;
}

test('yields data payloads split across events', async () => {
  const body = streamOf('data: one\n\ndata: two\n\n');
  expect(await collect(body)).toEqual(['one', 'two']);
});

test('reassembles events split across network chunks', async () => {
  const body = streamOf('data: hel', 'lo\n\nda', 'ta: world\n\n');
  expect(await collect(body)).toEqual(['hello', 'world']);
});

test('handles CRLF line endings and event fields', async () => {
  const body = streamOf('event: message\r\ndata: alpha\r\n\r\ndata: beta\r\n\r\n');
  expect(await collect(body)).toEqual(['alpha', 'beta']);
});

test('ignores comments and empty events', async () => {
  const body = streamOf(': keepalive\n\n\n\ndata: only\n\n');
  expect(await collect(body)).toEqual(['only']);
});
