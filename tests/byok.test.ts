import { expect, test } from 'vitest';
import { AnthropicProvider } from '../src/engine/providers/anthropic';
import { OpenAIProvider } from '../src/engine/providers/openai';

function sseResponse(events: string[], status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const event of events) controller.enqueue(encoder.encode(`data: ${event}\n\n`));
      controller.close();
    },
  });
  return new Response(body, { status });
}

const anthropicEvents = [
  JSON.stringify({ type: 'message_start' }),
  JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hel' } }),
  JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'lo.' } }),
  JSON.stringify({ type: 'message_stop' }),
];

test('anthropic streams deltas and returns the full text', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const provider = new AnthropicProvider({ apiKey: 'sk-ant-test', model: 'claude-sonnet-4-5' }, async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    return sseResponse(anthropicEvents);
  });
  const seen: string[] = [];
  const out = await provider.rewrite({ text: 'T', systemPrompt: 'S', onChunk: t => seen.push(t) });
  expect(out).toBe('Hello.');
  expect(seen).toEqual(['Hel', 'Hello.']);
  expect(calls[0]!.url).toBe('https://api.anthropic.com/v1/messages');
  const headers = calls[0]!.init.headers as Record<string, string>;
  expect(headers['x-api-key']).toBe('sk-ant-test');
  expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
  const body = JSON.parse(String(calls[0]!.init.body)) as { system: string; stream: boolean };
  expect(body.system).toBe('S');
  expect(body.stream).toBe(true);
});

test('anthropic maps auth and rate-limit statuses', async () => {
  const auth = new AnthropicProvider({ apiKey: 'k', model: 'm' }, async () => new Response('', { status: 401 }));
  await expect(auth.rewrite({ text: 't', systemPrompt: 's' })).rejects.toMatchObject({ kind: 'byok-auth' });
  const limited = new AnthropicProvider({ apiKey: 'k', model: 'm' }, async () => new Response('', { status: 429 }));
  await expect(limited.rewrite({ text: 't', systemPrompt: 's' })).rejects.toMatchObject({ kind: 'byok-rate-limit' });
});

test('anthropic maps network failures and aborts', async () => {
  const down = new AnthropicProvider({ apiKey: 'k', model: 'm' }, async () => {
    throw new TypeError('failed to fetch');
  });
  await expect(down.rewrite({ text: 't', systemPrompt: 's' })).rejects.toMatchObject({ kind: 'network' });
  const aborted = new AnthropicProvider({ apiKey: 'k', model: 'm' }, async () => {
    throw new DOMException('aborted', 'AbortError');
  });
  await expect(aborted.rewrite({ text: 't', systemPrompt: 's' })).rejects.toMatchObject({ kind: 'aborted' });
});

const openaiEvents = [
  JSON.stringify({ choices: [{ delta: { role: 'assistant' } }] }),
  JSON.stringify({ choices: [{ delta: { content: 'Hi ' } }] }),
  JSON.stringify({ choices: [{ delta: { content: 'there.' } }] }),
  '[DONE]',
];

test('openai-compatible streams deltas against the configured base url', async () => {
  const calls: string[] = [];
  const provider = new OpenAIProvider(
    { baseUrl: 'http://localhost:11434/v1/', apiKey: 'ollama', model: 'llama3' },
    async url => {
      calls.push(String(url));
      return sseResponse(openaiEvents);
    },
  );
  const out = await provider.rewrite({ text: 'T', systemPrompt: 'S' });
  expect(out).toBe('Hi there.');
  expect(calls[0]).toBe('http://localhost:11434/v1/chat/completions');
});

test('providers are available only with a key', async () => {
  expect(await new AnthropicProvider({ apiKey: '', model: 'm' }).available()).toBe(false);
  expect(await new OpenAIProvider({ baseUrl: 'https://api.openai.com/v1', apiKey: 'k', model: 'm' }).available()).toBe(true);
});

test('malformed stream json is skipped, not fatal', async () => {
  const provider = new OpenAIProvider(
    { baseUrl: 'https://api.openai.com/v1', apiKey: 'k', model: 'm' },
    async () => sseResponse(['{not json', JSON.stringify({ choices: [{ delta: { content: 'ok' } }] }), '[DONE]']),
  );
  expect(await provider.rewrite({ text: 't', systemPrompt: 's' })).toBe('ok');
});
