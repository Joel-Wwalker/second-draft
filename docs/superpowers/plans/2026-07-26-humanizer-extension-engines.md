# Humanizer Extension Engines and Ship Implementation Plan (Plan 3 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real rewrite engines land: Chrome's on-device Gemini Nano (Prompt API) as the default, bring-your-own-key Anthropic and OpenAI-compatible providers as the quality upgrade, an options page to configure them plus voice sample and per-site list, the session/timeout hardening from the must-carry lists, and the ship kit (icons, privacy policy, store listing draft, manual test matrix, v0.3.0).

**Architecture:** Providers implement the existing `Provider` interface and slot into `humanize()` unchanged. Nano runs in the background service worker via the `LanguageModel` global (Chrome 138+); BYOK providers use `fetch` + SSE streaming with optional host permissions granted at options-save time. Options and popup are extension pages, so they query `LanguageModel` directly for status/download with no background plumbing.

**Tech Stack:** Existing (WXT, TS strict, Vitest, Playwright). Zero production dependencies, unchanged. No new dev dependencies.

## Global Constraints

- Everything from Plans 1-2 still binds: TS `strict` + `noUncheckedIndexedAccess`, no `any`; `src/engine/**` and `src/shared/{types,diff,messages,labels,sse,redact}.ts` never touch DOM or `chrome.*` (providers may use `fetch` and the `LanguageModel` global — those are platform, not `chrome.*`); no em/en dashes in user-visible strings; conventional commits.
- Network calls exist ONLY inside `src/engine/providers/anthropic.ts` and `openai.ts`, only to the user-configured endpoint, only during a user-initiated rewrite.
- Sensitive-field guard (Plan 2) is a hard gate this plan must not weaken: provider code never sees text that `selection.ts` refused to capture.
- Manifest: `permissions` stay exactly `['storage', 'contextMenus', 'activeTab']`; add `optional_host_permissions: ['https://*/*']` (granted per-origin at runtime when the user saves a BYOK config). Icons added.
- API keys live in `chrome.storage.local` only. Error messages surfaced to UI pass through `redactError` (no keys, no full URLs).
- Unit tests mock `LanguageModel` and `fetch`; real Nano/BYOK verification is the manual matrix (owner-run), not CI.
- All commands run from repo root `C:\Users\theag\OneDrive\Desktop\humanizer-extension`. Baseline at start: 71 unit + 3 e2e green, branch for this plan: `feature/engines` off `main`.

## File map (added/changed by Plan 3)

```
src/
├── types/language-model.d.ts    # NEW ambient types for the Prompt API
├── engine/
│   ├── index.ts                 # MODIFIED: firstAvailable try/catch
│   └── providers/
│       ├── nano.ts              # NEW: Gemini Nano (chunking, streaming, abort)
│       ├── anthropic.ts         # NEW: Anthropic Messages API (SSE)
│       └── openai.ts            # NEW: OpenAI-compatible chat completions (SSE)
├── shared/
│   ├── sse.ts                   # NEW: parseSSE async generator
│   ├── redact.ts                # NEW: redactError
│   └── storage.ts               # MODIFIED: voiceSample + byok (deep merge)
├── entrypoints/
│   ├── background.ts            # MODIFIED: buildProviders, voiceSample, redact
│   ├── options/                 # NEW: index.html, main.ts, style.css
│   └── popup/main.ts            # MODIFIED: engine status line, toggle .catch
├── content/session.ts           # MODIFIED: 60s timeout, live intensity
scripts/make-icons.mjs           # NEW: placeholder icon generator (no deps)
public/icons/{16,32,48,128}.png  # NEW: generated, committed
docs/privacy-policy.md           # NEW
docs/store-listing.md            # NEW: listing copy + permission justifications (draft)
docs/manual-test-matrix.md       # NEW
wxt.config.ts                    # MODIFIED: optional_host_permissions, icons
tests/  sse.test.ts, redact.test.ts, nano.test.ts, byok.test.ts, storage.test.ts (extended), session.test.ts (extended), engine.test.ts (extended)
```

Explicitly still deferred after Plan 3 (tracked in spec): `all_frames` iframes decision, shadow-DOM selection, multi-pass deep mode, hosted paid tier, other browsers.

---

### Task 1: Ambient Prompt API types, SSE parser, error redaction

**Files:**
- Create: `src/types/language-model.d.ts`, `src/shared/sse.ts`, `src/shared/redact.ts`
- Test: `tests/sse.test.ts`, `tests/redact.test.ts`

**Interfaces:**
- Produces:
  - Ambient: `LanguageModelAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available'`; `interface LanguageModelSession { prompt(input, opts?): Promise<string>; promptStreaming(input, opts?): ReadableStream<string>; destroy(): void }`; global `var LanguageModel: LanguageModelStatic | undefined`.
  - `parseSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<string>` yielding each `data:` payload.
  - `redactError(message: string): string` stripping key-like tokens and URLs.

- [ ] **Step 1: Write the failing tests**

`tests/sse.test.ts`:

```ts
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
```

`tests/redact.test.ts`:

```ts
import { expect, test } from 'vitest';
import { redactError } from '../src/shared/redact';

test('strips key-like tokens', () => {
  expect(redactError('bad key sk-ant-abc123DEF456ghi789 used')).toBe('bad key sk-*** used');
});

test('reduces URLs to their host', () => {
  expect(redactError('fetch failed for https://api.example.com/v1/chat?key=zzz here')).toBe(
    'fetch failed for [api.example.com] here',
  );
});

test('truncates very long messages', () => {
  expect(redactError('x'.repeat(500)).length).toBeLessThanOrEqual(203);
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `npx vitest run tests/sse.test.ts tests/redact.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Create `src/types/language-model.d.ts`**

```ts
/**
 * Ambient types for Chrome's built-in Prompt API (Gemini Nano), stable for
 * extensions since Chrome 138. Feature-detect with `typeof LanguageModel`.
 */
type LanguageModelAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

interface LanguageModelPromptOptions {
  signal?: AbortSignal;
}

interface LanguageModelSession {
  prompt(input: string, options?: LanguageModelPromptOptions): Promise<string>;
  promptStreaming(input: string, options?: LanguageModelPromptOptions): ReadableStream<string>;
  destroy(): void;
}

interface LanguageModelCreateOptions {
  initialPrompts?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  signal?: AbortSignal;
  monitor?(monitor: EventTarget): void;
}

interface LanguageModelStatic {
  availability(): Promise<LanguageModelAvailability>;
  create(options?: LanguageModelCreateOptions): Promise<LanguageModelSession>;
}

// eslint-disable-next-line no-var
declare var LanguageModel: LanguageModelStatic | undefined;
```

- [ ] **Step 4: Create `src/shared/sse.ts`**

```ts
/** Minimal server-sent-events parser: yields each `data:` payload as a string. */
export async function* parseSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        for (const line of rawEvent.split('\n')) {
          if (line.startsWith('data: ')) yield line.slice(6);
          else if (line.startsWith('data:')) yield line.slice(5);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
```

- [ ] **Step 5: Create `src/shared/redact.ts`**

```ts
const MAX_ERROR_CHARS = 200;

/** Strip secrets and URLs from error text before it reaches any UI or log. */
export function redactError(message: string): string {
  const redacted = message
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, 'sk-***')
    .replace(/https?:\/\/([^\s/?#]+)[^\s]*/g, '[$1]');
  return redacted.length > MAX_ERROR_CHARS ? `${redacted.slice(0, MAX_ERROR_CHARS)}...` : redacted;
}
```

- [ ] **Step 6: Verify**

Run: `npx vitest run tests/sse.test.ts tests/redact.test.ts` (7 pass), `npm run typecheck`, `npm test` (78 total) — all exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/types/language-model.d.ts src/shared/sse.ts src/shared/redact.ts tests/sse.test.ts tests/redact.test.ts
git commit -m "feat: prompt-api ambient types, sse parser, and error redaction"
```

---

### Task 2: Nano provider

**Files:**
- Create: `src/engine/providers/nano.ts`
- Test: `tests/nano.test.ts`

**Interfaces:**
- Consumes: ambient `LanguageModel`, `Provider`/`RewriteRequest`/`HumanizerError` from types.
- Produces: `class NanoProvider implements Provider` (`info = { kind: 'nano', model: 'gemini-nano' }`); exported helpers `chunkText(text: string, max: number): string[]` (concatenation of chunks equals input; splits on paragraph boundaries, hard-splits oversized paragraphs) and `accumulate(prev: string, next: string): string` (handles both cumulative and delta streaming styles). `NANO_CHUNK_CHARS = 4000`.

- [ ] **Step 1: Write the failing tests**

`tests/nano.test.ts`:

```ts
import { afterEach, expect, test } from 'vitest';
import { NanoProvider, accumulate, chunkText } from '../src/engine/providers/nano';

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

test('unavailable when the global is missing or not ready', async () => {
  const provider = new NanoProvider();
  expect(await provider.available()).toBe(false);
  installLanguageModel('downloadable', []);
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
```

- [ ] **Step 2: Run, confirm failure**

Run: `npx vitest run tests/nano.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Create `src/engine/providers/nano.ts`**

```ts
import type { EngineInfo, Provider, RewriteRequest } from '../../shared/types';
import { HumanizerError } from '../../shared/types';

export const NANO_CHUNK_CHARS = 4000;

/** Chrome's on-device Gemini Nano via the Prompt API (extension SW context). */
export class NanoProvider implements Provider {
  readonly info: EngineInfo = { kind: 'nano', model: 'gemini-nano' };

  async available(): Promise<boolean> {
    if (typeof LanguageModel === 'undefined' || !LanguageModel) return false;
    try {
      return (await LanguageModel.availability()) === 'available';
    } catch {
      return false;
    }
  }

  async rewrite(req: RewriteRequest): Promise<string> {
    if (typeof LanguageModel === 'undefined' || !LanguageModel) {
      throw new HumanizerError('nano-unavailable', 'On-device AI is not supported by this browser.');
    }
    throwIfAborted(req.signal);
    let session: LanguageModelSession;
    try {
      session = await LanguageModel.create({
        initialPrompts: [{ role: 'system', content: req.systemPrompt }],
        signal: req.signal,
      });
    } catch (err) {
      throw abortOr(err, new HumanizerError('nano-unavailable', 'Could not start the on-device model.'));
    }
    try {
      const chunks = chunkText(req.text, NANO_CHUNK_CHARS);
      const outputs: string[] = [];
      for (const chunk of chunks) {
        throwIfAborted(req.signal);
        const prefix = outputs.length > 0 ? `${outputs.join('\n\n')}\n\n` : '';
        let chunkOut = '';
        const stream = session.promptStreaming(chunk, { signal: req.signal });
        const reader = stream.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunkOut = accumulate(chunkOut, value);
            req.onChunk?.(prefix + chunkOut);
          }
        } catch (err) {
          throw abortOr(err, new HumanizerError('internal', 'On-device rewrite failed.'));
        } finally {
          reader.releaseLock();
        }
        outputs.push(chunkOut.trim());
      }
      return outputs.join('\n\n');
    } finally {
      session.destroy();
    }
  }
}

/**
 * Streamed values may be deltas or cumulative snapshots; normalize to cumulative.
 * Known edge (accepted): a true delta that itself starts with the entire
 * previous text is misread as a cumulative snapshot.
 */
export function accumulate(prev: string, next: string): string {
  return next.startsWith(prev) ? next : prev + next;
}

/**
 * Split into chunks whose concatenation equals the input. Prefers paragraph
 * boundaries; hard-splits any piece that would push a chunk past max,
 * regardless of where it falls.
 */
export function chunkText(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const pieces = text.split(/(\n{2,})/);
  const chunks: string[] = [];
  let current = '';
  const flush = (): void => {
    if (current.length > 0) {
      chunks.push(current);
      current = '';
    }
  };
  for (const piece of pieces) {
    if (current.length > 0 && current.length + piece.length > max) flush();
    current += piece;
    while (current.length > max) {
      chunks.push(current.slice(0, max));
      current = current.slice(max);
    }
  }
  flush();
  return chunks;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new HumanizerError('aborted');
}

function abortOr(err: unknown, fallback: HumanizerError): HumanizerError {
  if (err instanceof HumanizerError) return err;
  if (err instanceof DOMException && err.name === 'AbortError') return new HumanizerError('aborted');
  return fallback;
}
```

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/nano.test.ts` (7 pass), `npm run typecheck`, `npm test` (85 total) — all exit 0.
(Trace note for the abort test: the first chunk's onChunk fires `ctl.abort()`; the second chunk's leading `throwIfAborted` raises `aborted`.)

- [ ] **Step 5: Commit**

```bash
git add src/engine/providers/nano.ts tests/nano.test.ts
git commit -m "feat: gemini nano provider with paragraph chunking and streaming"
```

---

### Task 3: BYOK providers (Anthropic + OpenAI-compatible)

**Files:**
- Create: `src/engine/providers/anthropic.ts`, `src/engine/providers/openai.ts`
- Test: `tests/byok.test.ts`

**Interfaces:**
- Consumes: `parseSSE`, types, `HumanizerError`.
- Produces: `class AnthropicProvider implements Provider` (`new AnthropicProvider(cfg: { apiKey: string; model: string }, fetchFn: typeof fetch = fetch)`, `info = { kind: 'byok', model: cfg.model }`); `class OpenAIProvider implements Provider` (`new OpenAIProvider(cfg: { baseUrl: string; apiKey: string; model: string }, fetchFn = fetch)`). Both: `available()` = key non-empty; streaming rewrite with onChunk cumulative text; error mapping 401/403 → `byok-auth`, 429 → `byok-rate-limit`, other non-OK/network → `network`, AbortError → `aborted`.

- [ ] **Step 1: Write the failing tests**

`tests/byok.test.ts`:

```ts
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
```

- [ ] **Step 2: Run, confirm failure**

Run: `npx vitest run tests/byok.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Create `src/engine/providers/anthropic.ts`**

```ts
import { parseSSE } from '../../shared/sse';
import type { EngineInfo, Provider, RewriteRequest } from '../../shared/types';
import { HumanizerError } from '../../shared/types';

export interface AnthropicConfig {
  apiKey: string;
  model: string;
}

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

export class AnthropicProvider implements Provider {
  readonly info: EngineInfo;

  constructor(
    private readonly cfg: AnthropicConfig,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    this.info = { kind: 'byok', model: cfg.model };
  }

  available(): Promise<boolean> {
    return Promise.resolve(this.cfg.apiKey.length > 0);
  }

  async rewrite(req: RewriteRequest): Promise<string> {
    let res: Response;
    try {
      res = await this.fetchFn(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.cfg.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: this.cfg.model,
          max_tokens: 8192,
          stream: true,
          system: req.systemPrompt,
          messages: [{ role: 'user', content: req.text }],
        }),
        signal: req.signal,
      });
    } catch (err) {
      throw mapFetchError(err, 'Could not reach the Anthropic API.');
    }
    throwForStatus(res, 'Anthropic');
    if (!res.body) throw new HumanizerError('network', 'Anthropic returned an empty stream.');
    let out = '';
    for await (const data of parseSSE(res.body)) {
      const evt = safeParse(data) as { type?: string; delta?: { type?: string; text?: string } } | null;
      if (evt?.type === 'content_block_delta' && evt.delta?.type === 'text_delta' && typeof evt.delta.text === 'string') {
        out += evt.delta.text;
        req.onChunk?.(out);
      }
    }
    return out;
  }
}

export function throwForStatus(res: Response, who: string): void {
  if (res.status === 401 || res.status === 403) {
    throw new HumanizerError('byok-auth', `API key rejected (${res.status}).`);
  }
  if (res.status === 429) throw new HumanizerError('byok-rate-limit', `Rate limited by ${who}.`);
  if (!res.ok) throw new HumanizerError('network', `${who} returned ${res.status}.`);
}

export function mapFetchError(err: unknown, message: string): HumanizerError {
  if (err instanceof DOMException && err.name === 'AbortError') return new HumanizerError('aborted');
  return new HumanizerError('network', message);
}

export function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Create `src/engine/providers/openai.ts`**

```ts
import { parseSSE } from '../../shared/sse';
import type { EngineInfo, Provider, RewriteRequest } from '../../shared/types';
import { HumanizerError } from '../../shared/types';
import { mapFetchError, safeParse, throwForStatus } from './anthropic';

export interface OpenAIConfig {
  /** e.g. https://api.openai.com/v1, https://openrouter.ai/api/v1, http://localhost:11434/v1 */
  baseUrl: string;
  apiKey: string;
  model: string;
}

export class OpenAIProvider implements Provider {
  readonly info: EngineInfo;

  constructor(
    private readonly cfg: OpenAIConfig,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    this.info = { kind: 'byok', model: cfg.model };
  }

  available(): Promise<boolean> {
    return Promise.resolve(this.cfg.apiKey.length > 0);
  }

  async rewrite(req: RewriteRequest): Promise<string> {
    const url = `${this.cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.cfg.apiKey}`,
        },
        body: JSON.stringify({
          model: this.cfg.model,
          stream: true,
          messages: [
            { role: 'system', content: req.systemPrompt },
            { role: 'user', content: req.text },
          ],
        }),
        signal: req.signal,
      });
    } catch (err) {
      throw mapFetchError(err, 'Could not reach the configured API endpoint.');
    }
    throwForStatus(res, 'The API endpoint');
    if (!res.body) throw new HumanizerError('network', 'The API endpoint returned an empty stream.');
    let out = '';
    for await (const data of parseSSE(res.body)) {
      if (data === '[DONE]') break;
      const evt = safeParse(data) as { choices?: Array<{ delta?: { content?: string } }> } | null;
      const delta = evt?.choices?.[0]?.delta?.content;
      if (typeof delta === 'string') {
        out += delta;
        req.onChunk?.(out);
      }
    }
    return out;
  }
}
```

- [ ] **Step 5: Verify**

Run: `npx vitest run tests/byok.test.ts` (7 pass), `npm run typecheck`, `npm test` (92 total) — all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/engine/providers/anthropic.ts src/engine/providers/openai.ts tests/byok.test.ts
git commit -m "feat: anthropic and openai-compatible byok providers with sse streaming"
```

---

### Task 4: Settings v3, provider selection, engine hardening, manifest

**Files:**
- Modify: `src/shared/storage.ts`, `src/entrypoints/background.ts`, `src/engine/index.ts`, `wxt.config.ts`
- Test: `tests/storage.test.ts` (extend), `tests/engine.test.ts` (extend)

**Interfaces:**
- Produces:
  - `interface ByokSettings { provider: 'none' | 'anthropic' | 'openai'; apiKey: string; model: string; baseUrl: string }`; `Settings` gains `voiceSample: string` (default `''`) and `byok: ByokSettings` (default `{ provider: 'none', apiKey: '', model: '', baseUrl: 'https://api.openai.com/v1' }`); `getSettings` deep-merges `byok`.
  - background: `buildProviders(settings): Provider[]` — fake flag wins (tests); else BYOK-if-configured then Nano; `runHumanize` passes `voiceSample` and redacts internal error text via `redactError`.
  - engine: `firstAvailable` treats a throwing `available()` as unavailable (spec error-table compliance).
  - manifest: `optional_host_permissions: ['https://*/*']`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/storage.test.ts`:

```ts
test('byok settings deep-merge over defaults', async () => {
  const { DEFAULT_SETTINGS, getSettings, updateSettings } = await import('../src/shared/storage');
  await updateSettings({ byok: { ...DEFAULT_SETTINGS.byok, provider: 'anthropic', apiKey: 'k1' } });
  const settings = await getSettings();
  expect(settings.byok.provider).toBe('anthropic');
  expect(settings.byok.baseUrl).toBe(DEFAULT_SETTINGS.byok.baseUrl);
});

test('legacy records without byok/voiceSample still merge cleanly', async () => {
  const { getSettings } = await import('../src/shared/storage');
  await chrome.storage.local.set({ settings: { defaultIntensity: 'light', useFakeProvider: false, disabledSites: [] } });
  const settings = await getSettings();
  expect(settings.byok.provider).toBe('none');
  expect(settings.voiceSample).toBe('');
});
```

Append to `tests/engine.test.ts`:

```ts
test('a provider whose available() throws is skipped, not fatal', async () => {
  const explosive = {
    info: { kind: 'nano' as const },
    available: async (): Promise<boolean> => {
      throw new Error('probe failed');
    },
    rewrite: async (): Promise<string> => 'never',
  };
  const res = await humanize('A—B here', { intensity: 'light' }, { providers: [explosive] });
  expect(res.engine.kind).toBe('rules');
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `npx vitest run tests/storage.test.ts tests/engine.test.ts`
Expected: FAIL (missing byok defaults; engine test throws instead of falling back).

- [ ] **Step 3: Extend `src/shared/storage.ts`**

Replace the `Settings`/`DEFAULT_SETTINGS`/`getSettings` block with:

```ts
export interface ByokSettings {
  provider: 'none' | 'anthropic' | 'openai';
  apiKey: string;
  model: string;
  /** OpenAI-compatible endpoints only (OpenAI, OpenRouter, Groq, local Ollama). */
  baseUrl: string;
}

export interface Settings {
  defaultIntensity: Intensity;
  /** Dev/e2e switch: route rewrites through FakeProvider. */
  useFakeProvider: boolean;
  /** Hosts where the selection chip must not appear (e.g. "mail.google.com"). */
  disabledSites: string[];
  /** Writing sample used for voice matching; empty means none. */
  voiceSample: string;
  byok: ByokSettings;
}

export const DEFAULT_SETTINGS: Settings = {
  defaultIntensity: 'full',
  useFakeProvider: false,
  disabledSites: [],
  voiceSample: '',
  byok: { provider: 'none', apiKey: '', model: '', baseUrl: 'https://api.openai.com/v1' },
};

const KEY = 'settings';

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(KEY);
  const partial = stored[KEY] as (Partial<Settings> & { byok?: Partial<ByokSettings> }) | undefined;
  return {
    ...DEFAULT_SETTINGS,
    ...partial,
    byok: { ...DEFAULT_SETTINGS.byok, ...partial?.byok },
  };
}
```

(`updateSettings` and the site helpers stay unchanged.)

- [ ] **Step 4: Harden `src/engine/index.ts` firstAvailable**

Replace the function with:

```ts
async function firstAvailable(providers: Provider[]): Promise<Provider | null> {
  for (const provider of providers) {
    try {
      if (await provider.available()) return provider;
    } catch {
      // A throwing probe means unavailable; fall through to the next provider.
    }
  }
  return null;
}
```

- [ ] **Step 5: Update `src/entrypoints/background.ts`**

Add imports: `NanoProvider` from `../engine/providers/nano`, `AnthropicProvider` from `../engine/providers/anthropic`, `OpenAIProvider` from `../engine/providers/openai`, `redactError` from `../shared/redact`, and type `Settings` from `../shared/storage`. Replace the provider construction inside `runHumanize` with a call to the new function, pass the voice sample, and redact:

```ts
async function runHumanize(
  text: string,
  intensity: Intensity,
  signal?: AbortSignal,
  onChunk?: (textSoFar: string) => void,
): Promise<HumanizeResponse> {
  try {
    const settings = await getSettings();
    const result = await humanize(
      text,
      { intensity, signal, onChunk, voiceSample: settings.voiceSample || undefined },
      { providers: buildProviders(settings) },
    );
    return { ok: true, result };
  } catch (err) {
    const e = err instanceof HumanizerError ? err : new HumanizerError('internal', redactError(String(err)));
    if (e.kind !== 'aborted') console.error('[humanizer]', e.kind, e.message);
    return { ok: false, kind: e.kind, message: redactError(e.message) };
  }
}

function buildProviders(settings: Settings): Provider[] {
  if (settings.useFakeProvider) return [new FakeProvider()];
  const providers: Provider[] = [];
  const { byok } = settings;
  if (byok.provider === 'anthropic' && byok.apiKey) {
    providers.push(new AnthropicProvider({ apiKey: byok.apiKey, model: byok.model || 'claude-sonnet-4-5' }));
  } else if (byok.provider === 'openai' && byok.apiKey) {
    providers.push(
      new OpenAIProvider({ baseUrl: byok.baseUrl, apiKey: byok.apiKey, model: byok.model || 'gpt-4o-mini' }),
    );
  }
  providers.push(new NanoProvider());
  return providers;
}
```

- [ ] **Step 6: Manifest**

In `wxt.config.ts`, add below `permissions`:

```ts
    optional_host_permissions: ['https://*/*'],
```

- [ ] **Step 7: Verify**

Run: `npx vitest run tests/storage.test.ts tests/engine.test.ts` (all pass; storage now 6+2, engine 7+1), `npm run typecheck`, `npm test` (95 total), `npm run build` (manifest contains `optional_host_permissions`) — all exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/shared/storage.ts src/engine/index.ts src/entrypoints/background.ts wxt.config.ts tests/storage.test.ts tests/engine.test.ts
git commit -m "feat: provider selection with byok config, voice sample, probe hardening, optional hosts"
```

---

### Task 5: Options page and popup engine status

**Files:**
- Create: `src/entrypoints/options/index.html`, `src/entrypoints/options/main.ts`, `src/entrypoints/options/style.css`
- Modify: `src/entrypoints/popup/main.ts`

**Interfaces:**
- Consumes: storage (settings v3), ambient `LanguageModel` (options/popup are extension pages), `chrome.permissions`.
- Produces: options UI (BYOK provider/key/model/baseUrl with permission request on save, voice sample, default intensity, disabled-sites list with remove, Nano status + download button, attribution). Popup gains an engine status method reflecting config, and the site toggle's write gains `.catch`.

- [ ] **Step 1: Create `src/entrypoints/options/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Humanizer settings</title>
    <link rel="stylesheet" href="./style.css" />
  </head>
  <body>
    <h1>Humanizer settings</h1>

    <section>
      <h2>On-device AI (Gemini Nano)</h2>
      <p id="nanoStatus" class="muted">Checking...</p>
      <button id="nanoDownload" hidden>Download model</button>
    </section>

    <section>
      <h2>Your API key (optional, higher quality)</h2>
      <label>Provider
        <select id="byokProvider">
          <option value="none">None (use on-device AI)</option>
          <option value="anthropic">Anthropic (Claude)</option>
          <option value="openai">OpenAI-compatible (OpenAI, OpenRouter, Groq, Ollama)</option>
        </select>
      </label>
      <label id="keyRow" hidden>API key
        <input id="byokKey" type="password" autocomplete="off" spellcheck="false" />
      </label>
      <label id="modelRow" hidden>Model
        <input id="byokModel" type="text" spellcheck="false" />
      </label>
      <label id="baseUrlRow" hidden>Base URL
        <input id="byokBaseUrl" type="text" spellcheck="false" />
      </label>
      <p class="muted">Your key stays in this browser's local extension storage and is only sent to the provider you configure.</p>
    </section>

    <section>
      <h2>Voice sample (optional)</h2>
      <p class="muted">Paste a sample of your own writing; rewrites will try to match its voice.</p>
      <textarea id="voiceSample" rows="6" maxlength="20000"></textarea>
    </section>

    <section>
      <h2>Defaults</h2>
      <label>Intensity
        <select id="defaultIntensity">
          <option value="light">Light touch</option>
          <option value="full">Full rewrite</option>
        </select>
      </label>
    </section>

    <section>
      <h2>Disabled sites</h2>
      <ul id="siteList"></ul>
      <p id="noSites" class="muted">No sites disabled.</p>
    </section>

    <div class="row">
      <button id="save">Save</button>
      <span id="saveStatus" class="muted"></span>
    </div>

    <footer class="muted">
      Rewrite patterns derive from the MIT-licensed humanizer skill (blader/humanizer), based on Wikipedia's "Signs of AI writing".
    </footer>

    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: Create `src/entrypoints/options/style.css`**

```css
body { max-width: 640px; margin: 0 auto; padding: 24px 16px; font: 14px/1.5 system-ui, sans-serif; color: #202124; }
h1 { font-size: 20px; }
h2 { font-size: 15px; margin: 24px 0 8px; }
section { margin-bottom: 8px; }
label { display: block; margin: 8px 0; }
input[type="text"], input[type="password"], select, textarea { width: 100%; box-sizing: border-box; font: inherit; padding: 6px 8px; margin-top: 4px; }
button { font: inherit; padding: 6px 16px; }
.row { display: flex; gap: 12px; align-items: center; margin-top: 16px; }
.muted { color: #5f6368; font-size: 12px; }
ul { padding-left: 20px; }
li button { font-size: 12px; padding: 2px 8px; margin-left: 8px; }
footer { margin-top: 32px; }
```

- [ ] **Step 3: Create `src/entrypoints/options/main.ts`**

```ts
import { DEFAULT_SETTINGS, getSettings, updateSettings } from '../../shared/storage';
import type { ByokSettings, Settings } from '../../shared/storage';
import type { Intensity } from '../../shared/types';

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const nanoStatus = byId<HTMLParagraphElement>('nanoStatus');
const nanoDownload = byId<HTMLButtonElement>('nanoDownload');
const byokProvider = byId<HTMLSelectElement>('byokProvider');
const keyRow = byId<HTMLLabelElement>('keyRow');
const modelRow = byId<HTMLLabelElement>('modelRow');
const baseUrlRow = byId<HTMLLabelElement>('baseUrlRow');
const byokKey = byId<HTMLInputElement>('byokKey');
const byokModel = byId<HTMLInputElement>('byokModel');
const byokBaseUrl = byId<HTMLInputElement>('byokBaseUrl');
const voiceSample = byId<HTMLTextAreaElement>('voiceSample');
const defaultIntensity = byId<HTMLSelectElement>('defaultIntensity');
const siteList = byId<HTMLUListElement>('siteList');
const noSites = byId<HTMLParagraphElement>('noSites');
const saveBtn = byId<HTMLButtonElement>('save');
const saveStatus = byId<HTMLSpanElement>('saveStatus');

const NANO_LABELS: Record<LanguageModelAvailability, string> = {
  available: 'Ready. Rewrites run on this device.',
  downloadable: 'Supported, but the model is not downloaded yet.',
  downloading: 'Downloading the model...',
  unavailable: 'Not supported on this device.',
};

const DEFAULT_MODELS = { anthropic: 'claude-sonnet-4-5', openai: 'gpt-4o-mini' } as const;

void init();

async function init(): Promise<void> {
  const settings = await getSettings();
  byokProvider.value = settings.byok.provider;
  byokKey.value = settings.byok.apiKey;
  byokModel.value = settings.byok.model;
  byokBaseUrl.value = settings.byok.baseUrl;
  voiceSample.value = settings.voiceSample;
  defaultIntensity.value = settings.defaultIntensity;
  renderSites(settings);
  syncByokRows();
  byokProvider.addEventListener('change', syncByokRows);
  saveBtn.addEventListener('click', () => {
    void save();
  });
  nanoDownload.addEventListener('click', () => {
    void downloadNano();
  });
  void refreshNano();
}

function syncByokRows(): void {
  const provider = byokProvider.value as ByokSettings['provider'];
  keyRow.hidden = provider === 'none';
  modelRow.hidden = provider === 'none';
  baseUrlRow.hidden = provider !== 'openai';
  if (provider !== 'none' && byokModel.value.trim() === '') {
    byokModel.placeholder = DEFAULT_MODELS[provider];
  }
}

async function save(): Promise<void> {
  saveBtn.disabled = true;
  saveStatus.textContent = 'Saving...';
  try {
    const provider = byokProvider.value as ByokSettings['provider'];
    const byok: ByokSettings = {
      provider,
      apiKey: byokKey.value.trim(),
      model: byokModel.value.trim(),
      baseUrl: byokBaseUrl.value.trim() || DEFAULT_SETTINGS.byok.baseUrl,
    };
    if (provider !== 'none' && byok.apiKey) {
      const granted = await requestByokPermission(byok);
      if (!granted) {
        saveStatus.textContent = 'Permission for the API domain was not granted; the key was saved but rewrites will fail until it is.';
      }
    }
    await updateSettings({
      byok,
      voiceSample: voiceSample.value,
      defaultIntensity: defaultIntensity.value as Intensity,
    });
    if (saveStatus.textContent === 'Saving...') saveStatus.textContent = 'Saved.';
  } catch {
    saveStatus.textContent = 'Save failed. Try again.';
  } finally {
    saveBtn.disabled = false;
  }
}

export function byokOrigin(byok: ByokSettings): string | null {
  try {
    const url = byok.provider === 'anthropic' ? 'https://api.anthropic.com' : byok.baseUrl;
    const origin = new URL(url).origin;
    return origin.startsWith('http') ? `${origin}/*` : null;
  } catch {
    return null;
  }
}

async function requestByokPermission(byok: ByokSettings): Promise<boolean> {
  const origin = byokOrigin(byok);
  if (!origin) return false;
  if (origin.startsWith('http://localhost') || origin.startsWith('http://127.')) return true;
  try {
    return await chrome.permissions.request({ origins: [origin] });
  } catch {
    return false;
  }
}

function renderSites(settings: Settings): void {
  siteList.textContent = '';
  noSites.hidden = settings.disabledSites.length > 0;
  for (const host of settings.disabledSites) {
    const li = document.createElement('li');
    li.textContent = host;
    const remove = document.createElement('button');
    remove.textContent = 'Enable';
    remove.addEventListener('click', () => {
      void updateSettings({ disabledSites: settings.disabledSites.filter(h => h !== host) }).then(next => {
        renderSites(next);
      });
    });
    li.append(remove);
    siteList.append(li);
  }
}

async function refreshNano(): Promise<void> {
  if (typeof LanguageModel === 'undefined' || !LanguageModel) {
    nanoStatus.textContent = 'Not supported by this browser (needs Chrome 138 or newer).';
    return;
  }
  try {
    const availability = await LanguageModel.availability();
    nanoStatus.textContent = NANO_LABELS[availability];
    nanoDownload.hidden = availability !== 'downloadable';
  } catch {
    nanoStatus.textContent = 'Could not query the on-device model.';
  }
}

async function downloadNano(): Promise<void> {
  if (typeof LanguageModel === 'undefined' || !LanguageModel) return;
  nanoDownload.disabled = true;
  try {
    const session = await LanguageModel.create({
      monitor(monitor) {
        monitor.addEventListener('downloadprogress', event => {
          const loaded = (event as ProgressEvent).loaded;
          nanoStatus.textContent = `Downloading: ${Math.round(loaded * 100)}%`;
        });
      },
    });
    session.destroy();
  } catch {
    nanoStatus.textContent = 'Download failed. Check your connection and disk space.';
  } finally {
    nanoDownload.disabled = false;
    void refreshNano();
  }
}
```

- [ ] **Step 4: Popup status line + toggle catch (`src/entrypoints/popup/main.ts`)**

Extend the storage import with `DEFAULT_SETTINGS` if not present, and append to the end of `init()`:

```ts
  if (settings.byok.provider !== 'none' && settings.byok.apiKey) {
    engineLabel.textContent = `Your API key (${settings.byok.model || 'default model'})`;
  } else if (typeof LanguageModel !== 'undefined' && LanguageModel) {
    const availability = await LanguageModel.availability().catch(() => 'unavailable' as const);
    engineLabel.textContent =
      availability === 'available'
        ? 'On-device AI ready'
        : 'On-device AI not ready. Open Settings.';
  } else {
    engineLabel.textContent = 'Quick clean only (no AI engine available)';
  }
```

And change the site-toggle listener body to catch failures:

```ts
      siteToggle.disabled = true;
      void toggleSiteDisabled(host)
        .catch(() => {
          siteToggle.checked = !siteToggle.checked;
        })
        .finally(() => {
          siteToggle.disabled = false;
        });
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck`, `npm test` (95, unchanged), `npm run build` — all exit 0; `.output/chrome-mv3` contains `options.html` and the manifest gains `options_ui` (WXT wires the options entrypoint automatically).

- [ ] **Step 6: Manual verification checklist (do what is possible without a key/model; report the rest as pending)**

1. Load the built extension; open the options page from `chrome://extensions` → Details → Extension options.
2. Nano section shows a status line appropriate to the machine.
3. Selecting Anthropic reveals key+model rows; selecting OpenAI-compatible also reveals base URL; Save with an empty key stores config without a permission prompt.
4. Popup engine line reflects the state.

- [ ] **Step 7: Commit**

```bash
git add src/entrypoints/options src/entrypoints/popup/main.ts
git commit -m "feat: options page with byok config, nano status, voice sample, site list"
```

---

### Task 6: Session timeout and live intensity

**Files:**
- Modify: `src/content/session.ts`
- Test: `tests/session.test.ts` (extend)

**Interfaces:**
- Produces: a 60s client-side request timeout (`REQUEST_TIMEOUT_MS = 60_000`) surfacing "No response from the engine. Try again." via `card.setError('internal', ...)`; live default-intensity refresh via `chrome.storage.onChanged` while a session is running (affects the NEXT request; an open card's own toggle still wins for that card).

- [ ] **Step 1: Write the failing tests**

The chrome mock in `tests/session.test.ts` needs `storage.onChanged`. In the mock, replace `onChanged: { addListener: (): void => undefined },` with a tracked version, adding at module scope `let storageListeners: Array<(changes: Record<string, { newValue?: unknown }>, area: string) => void> = [];`, resetting it in beforeEach (`storageListeners = [];`), and:

```ts
      onChanged: {
        addListener: (fn: (changes: Record<string, { newValue?: unknown }>, area: string) => void): void =>
          void storageListeners.push(fn),
        removeListener: (fn: (changes: Record<string, { newValue?: unknown }>, area: string) => void): void => {
          const i = storageListeners.indexOf(fn);
          if (i >= 0) storageListeners.splice(i, 1);
        },
      },
```

Append tests:

```ts
test('a request with no response times out with an error', () => {
  selectInTextarea();
  clickChip();
  vi.advanceTimersByTime(60_001);
  const shadow = document.getElementById('humanizer-card-host')!.shadowRoot!;
  expect(shadow.querySelector('.status')!.textContent).toContain('No response from the engine');
});

test('a done response cancels the timeout', () => {
  selectInTextarea();
  clickChip();
  const req = port.sent[0] as { id: string };
  port.emit({
    type: 'done',
    id: req.id,
    result: { rewritten: 'ok result here', changes: [], engine: { kind: 'fake' } },
  });
  vi.advanceTimersByTime(120_000);
  const shadow = document.getElementById('humanizer-card-host')!.shadowRoot!;
  expect(shadow.querySelector('.status')!.textContent).not.toContain('No response');
});

test('changing the stored default intensity applies to the next request', () => {
  selectInTextarea();
  clickChip();
  for (const fn of storageListeners) {
    fn({ settings: { newValue: { defaultIntensity: 'light' } } }, 'local');
  }
  const shadow = document.getElementById('humanizer-card-host')!.shadowRoot!;
  (shadow.querySelector('button.dismiss') as HTMLButtonElement).click();
  selectInTextarea();
  clickChip();
  const second = port.sent.filter(m => (m as { type: string }).type === 'humanize')[1] as { intensity: string };
  expect(second.intensity).toBe('light');
});

test('stop() removes the storage listener', () => {
  expect(storageListeners.length).toBeGreaterThan(0);
  session.stop();
  expect(storageListeners).toHaveLength(0);
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `npx vitest run tests/session.test.ts`
Expected: FAIL (timeout/status not implemented; listener not registered).

- [ ] **Step 3: Implement in `src/content/session.ts`**

Add constant near CHIP_DEBOUNCE_MS: `const REQUEST_TIMEOUT_MS = 60_000;`
Add fields: `private timeout: ReturnType<typeof setTimeout> | null = null;`
Add a stable handler field near the other handlers:

```ts
  private readonly onStorageChanged = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ): void => {
    if (area !== 'local' || !changes['settings']) return;
    const next = changes['settings'].newValue as { defaultIntensity?: Intensity } | undefined;
    if (next?.defaultIntensity === 'light' || next?.defaultIntensity === 'full') {
      this.intensity = next.defaultIntensity;
    }
  };
```

In `start()`, add: `chrome.storage.onChanged.addListener(this.onStorageChanged);`
In `stop()`, add (with the other removals): `chrome.storage.onChanged.removeListener(this.onStorageChanged);` and clear the timeout: `if (this.timeout) clearTimeout(this.timeout); this.timeout = null;`

In `request()`, after `this.requestId = id;` add:

```ts
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = setTimeout(() => {
      if (this.requestId === id && !this.result && !this.stopped) {
        this.card.setError('internal', 'No response from the engine. Try again.');
      }
    }, REQUEST_TIMEOUT_MS);
```

In `onPortMessage`, on `done` and `error` branches, clear the timeout (`if (this.timeout) clearTimeout(this.timeout); this.timeout = null;` — a tiny private `clearRequestTimeout()` helper is fine). In `cancelInFlight()`, also clear it.

Note: the card-level intensity toggle (`onIntensityChange`) still sets `this.intensity` directly, which now also becomes the default for subsequent requests in this tab until storage changes again; that matches the "card toggle wins for that card" contract.

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/session.test.ts` (11 pass), `npm run typecheck`, `npm test` (99 total), `npm run build` — all exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/content/session.ts tests/session.test.ts
git commit -m "feat: request timeout and live default-intensity refresh in the session"
```

---

### Task 7: Icons, privacy policy, store listing draft, manual matrix, v0.3.0

**Files:**
- Create: `scripts/make-icons.mjs`, `public/icons/{16,32,48,128}.png` (generated), `docs/privacy-policy.md`, `docs/store-listing.md`, `docs/manual-test-matrix.md`
- Modify: `wxt.config.ts` (icons), `package.json` (version 0.3.0, icons script), `README.md`

- [ ] **Step 1: Create `scripts/make-icons.mjs`**

```js
// Generates placeholder extension icons: white H on a blue rounded square.
// Zero dependencies; writes minimal RGBA PNGs by hand.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const BLUE = [26, 115, 232, 255];
const WHITE = [255, 255, 255, 255];
const CLEAR = [0, 0, 0, 0];

// 5x7 bitmap of "H"
const H = ['10001', '10001', '10001', '11111', '10001', '10001', '10001'];

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size) {
  const corner = Math.max(1, Math.round(size / 8));
  const cell = size / 8;
  const offX = Math.round((size - 5 * cell * 0.9) / 2);
  const offY = Math.round((size - 7 * cell * 0.9) / 2);
  const scale = cell * 0.9;
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = [0];
    for (let x = 0; x < size; x++) {
      const inCorner =
        (x < corner && y < corner && (corner - x) ** 2 + (corner - y) ** 2 > corner ** 2) ||
        (x >= size - corner && y < corner && (x - (size - corner - 1)) ** 2 + (corner - y) ** 2 > corner ** 2) ||
        (x < corner && y >= size - corner && (corner - x) ** 2 + (y - (size - corner - 1)) ** 2 > corner ** 2) ||
        (x >= size - corner && y >= size - corner && (x - (size - corner - 1)) ** 2 + (y - (size - corner - 1)) ** 2 > corner ** 2);
      let color = inCorner ? CLEAR : BLUE;
      const gx = Math.floor((x - offX) / scale);
      const gy = Math.floor((y - offY) / scale);
      if (!inCorner && gy >= 0 && gy < 7 && gx >= 0 && gx < 5 && H[gy][gx] === '1') color = WHITE;
      row.push(...color);
    }
    rows.push(Buffer.from(row));
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public/icons', { recursive: true });
for (const size of [16, 32, 48, 128]) {
  writeFileSync(`public/icons/${size}.png`, png(size));
  console.log(`wrote public/icons/${size}.png`);
}
```

Add to `package.json` scripts: `"icons": "node scripts/make-icons.mjs"`. Run `npm run icons` (4 files appear). Sanity: each PNG opens in an image viewer; if a PNG is invalid, report BLOCKED with the error rather than hand-editing bytes.

- [ ] **Step 2: Wire icons in `wxt.config.ts`**

Add to the `manifest` object:

```ts
    icons: {
      16: 'icons/16.png',
      32: 'icons/32.png',
      48: 'icons/48.png',
      128: 'icons/128.png',
    },
    action: {
      default_icon: {
        16: 'icons/16.png',
        32: 'icons/32.png',
      },
    },
```

(WXT keeps `default_popup` from the popup entrypoint and merges this in; verify in the built manifest.)

- [ ] **Step 3: Create `docs/privacy-policy.md`**

```markdown
# Humanizer privacy policy

Last updated: 2026-07-26

Humanizer rewrites text you select to remove signs of AI-generated writing.

## What we collect

Nothing. Humanizer has no servers, no analytics, no telemetry, and no accounts.
The developer never receives your text, your settings, or any usage data.

## Where your text goes

- By default, rewrites run entirely on your device (Chrome's built-in Gemini
  Nano model) or through built-in cleanup rules. Your text never leaves your
  machine.
- If you configure an API key in settings, the text you choose to humanize is
  sent directly from your browser to the provider you configured (for example
  Anthropic or an OpenAI-compatible endpoint), and to no one else. Their
  privacy terms apply to that request.

## What is stored

Settings (default intensity, disabled sites, your writing voice sample, and
your API key if you add one) are stored in Chrome's local extension storage on
your device. Nothing is synced or uploaded. Removing the extension deletes it.

## Permissions

- Access to pages you visit is used only to show the Humanize button near text
  you select and to replace that text when you click Apply.
- The optional API-domain permission is requested only when you add an API key,
  and only for the domain you configure.

## Contact

Open an issue on the project repository.
```

- [ ] **Step 4: Create `docs/store-listing.md`**

```markdown
# Chrome Web Store listing draft (owner approval required before submission)

## Name

Humanizer

## Short description (132 chars max)

Make AI drafts sound like you. Select text, click Humanize, review the changes, apply. Runs on your device by default.

## Description

Humanizer removes the telltale signs of AI-generated writing: em dashes, curly
quotes, "delve" and its friends, chatbot filler, rule-of-three cadence, and
promotional fluff.

Select text in almost any editable field, click the Humanize chip, and review
a before-and-after with every change explained. Apply replaces the text in
place. A popup paste box covers sites that block in-place editing.

Private by design: rewrites run on your device using Chrome's built-in AI. No
account, no servers, no tracking, unlimited use. Optionally add your own
Anthropic or OpenAI-compatible API key for higher quality rewrites; your key
stays in your browser.

Positioning note (per spec): this listing says "make AI drafts sound like you";
it does not promise to defeat AI detectors.

## Category

Productivity / Writing

## Permission justifications (for the review form)

- Content script on all sites: shows the Humanize button next to text the user
  selects and replaces it in place when they click Apply. Core functionality;
  a per-site disable toggle is built in.
- storage: user settings (intensity, disabled sites, voice sample, optional
  API key), stored locally.
- contextMenus: the right-click "Humanize selection" entry.
- activeTab: lets the popup show and toggle the current site's disable switch.
- Optional host permissions: requested only when the user configures their own
  API key, limited to the provider domain they enter.

## Assets still needed from the owner

- Screenshots (1280x800): chip on a selection, the result card, the options page.
- Final icon approval (current icon is a generated placeholder).
- Developer account ($5 one-time) and privacy-policy URL (GitHub Pages once the
  repo is pushed).
```

- [ ] **Step 5: Create `docs/manual-test-matrix.md`**

```markdown
# Manual test matrix (run before each release)

Build: `npm run build`, load `.output/chrome-mv3` unpacked. Reset state between
rows where noted (Clear extension storage via service-worker console).

| # | Scenario | Expected |
| - | -------- | -------- |
| 1 | Gmail compose: select a paragraph, chip, Apply | Text replaced in place; undo (Ctrl+Z) works |
| 2 | LinkedIn post editor: same | Same |
| 3 | X (Twitter) reply box: same | Same |
| 4 | Reddit new composer | Chip may not appear (shadow DOM, known); right-click Humanize works via Copy |
| 5 | Google Docs | Chip does not appear (canvas); popup paste box round-trip works |
| 6 | WordPress classic editor (iframe) | Chip does not appear (top-frame only, known); context menu on selection opens card with Copy |
| 7 | Plain http:// page with a textarea | Chip works; no crash (randomUUID fallback) |
| 8 | Reload the extension while a tab is open, then select + Humanize | Card shows "extension reloaded" error; after page reload everything works |
| 9 | Options: Nano status reflects machine; download flow when `downloadable` | Progress percel then Ready |
| 10 | No key + Nano ready: rewrite a selection | Engine label "On-device AI (Gemini Nano)"; no em dashes in output |
| 11 | No key + Nano unavailable | Quick clean result labeled as such |
| 12 | Anthropic key: save (permission prompt appears), rewrite | Engine label "Your API key (model)"; streaming visible on long text |
| 13 | OpenAI-compatible with local Ollama base URL | Works without a permission prompt (localhost) |
| 14 | Wrong API key | Card error "API key rejected (401)" |
| 15 | Per-site disable via popup, revisit site | No chip; context menu also inert on that site; re-enable restores |
| 16 | Voice sample set: rewrite | Output tone follows the sample (subjective check) |
| 17 | Password / email / card-number fields | No chip ever |
| 18 | Selection near the bottom of the window | Card stays fully on-screen |
```

- [ ] **Step 6: README + version**

In `package.json`: `"version": "0.3.0"`.
In `README.md`: replace the status line with `Status: feature complete pending store submission. Plan 3 (engines + ship) of 3.` and replace the sentence `Rewrites run on your device; real model engines (Gemini Nano, bring-your-own-key) arrive in Plan 3. Today's build uses the deterministic quick-clean rules.` with `Rewrites run on your device through Chrome's built-in Gemini Nano when available, with an optional bring-your-own-key upgrade (Anthropic or any OpenAI-compatible endpoint) configured in the options page.` Add to the Develop list: `- docs/manual-test-matrix.md is the pre-release checklist`.

- [ ] **Step 7: Verify**

Run: `npm run icons` (idempotent), `npm run typecheck`, `npm test` (99), `npm run build` — all exit 0; built manifest contains `icons` and `action.default_icon`; `.output/chrome-mv3/icons/128.png` exists.

- [ ] **Step 8: Commit**

```bash
git add scripts/make-icons.mjs public/icons docs/privacy-policy.md docs/store-listing.md docs/manual-test-matrix.md wxt.config.ts package.json package-lock.json README.md
git commit -m "feat: icons, privacy policy, store listing draft, manual matrix, v0.3.0"
```

---

## Spec coverage notes (self-review)

Covered: Nano provider (availability, download UI in options, chunking, streaming, abort), BYOK Anthropic + OpenAI-compatible (streaming, error table mapping, optional host permissions at save time, keys in local storage), options page (BYOK, voice sample, defaults, per-site list, nano status/download, attribution), voice sample wired through `HumanizeOptions`, popup engine status, `firstAvailable` probe hardening, error redaction, session request timeout, live intensity refresh, popup toggle catch, icons + manifest wiring, privacy policy, store listing draft with permission justifications, manual matrix incl. Plan-2 must-carry rows, v0.3.0.

Left for the owner (open items, not build work): real screenshots, final icon, store account + submission, GitHub push + Pages for the privacy-policy URL. Deferred with rationale in spec: `all_frames`, shadow-DOM selection, deep mode, hosted tier.

Known simplifications, intentional: Nano chunk seams may normalize blank-line runs between chunks (outputs joined with a standard paragraph break); BYOK `max_tokens` fixed at 8192 for Anthropic; the options page saves keys even when the permission grant is declined (rewrites then fail with a clear error; re-saving re-prompts); no e2e for real engines (manual matrix rows 9-14 cover them).
