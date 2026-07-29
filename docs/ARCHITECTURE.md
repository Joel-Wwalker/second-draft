# Architecture

A short tour of how the pieces fit and, more usefully, which boundaries are
load-bearing.

## The shape

```
 selection ──▶ content script ──port──▶ background ──▶ engine ──▶ provider
                    │                                     │
                    ◀──────── streamed chunks ────────────┘
                    ▼
              card (shadow DOM) ──▶ replacement (never clobber)
```

- **`src/engine/`** is pure text processing. No DOM, no `chrome.*`. It takes a
  string and options, and returns a rewritten string with a change list.
- **`src/shared/`** holds types and pure helpers (diff, profile, docx, sse,
  redaction, labels). `storage.ts` is the deliberate exception that touches
  `chrome.storage`.
- **`src/content/`** owns everything that touches a web page: capturing a
  selection, drawing the chip and card in shadow DOM, writing text back, and
  scanning a page.
- **`src/entrypoints/`** is the extension surface: background service worker,
  popup, options page.

## Why the engine is pure

`humanize(text, opts, { providers })` knows nothing about browsers. That is what
made adding three rewrite engines (a fake for tests, on-device Gemini Nano, and
two network providers) a matter of writing new `Provider` implementations
without touching the pipeline:

```ts
interface Provider {
  readonly info: EngineInfo;
  available(): Promise<boolean>;
  rewrite(req: RewriteRequest): Promise<string>;
}
```

Providers are tried in order and the first available one wins. A provider whose
`available()` throws is treated as unavailable rather than taking the request
down with it. If none are available, the deterministic rules still run, and the
result is labeled `rules` so the UI never implies an AI engine ran.

## The pipeline

1. **Detect.** Scan the input for tells. This both seeds the prompt ("this text
   contains em dashes, `delve`, a negative parallelism") and supplies the reasons
   shown in the change log.
2. **Rewrite.** Hand the text and a system prompt to the provider, streaming
   chunks back to the card as they arrive.
3. **Enforce.** Run the fixable rules again over the model's output.
4. **Diff.** Word-level diff between input and final output, with each change
   attributed to the tell it resolved.

Step 3 is the important one. The product promises no em dashes; a prompt cannot
guarantee that, so the guarantee lives in code. The model is asked, the rules
layer enforces.

## Invariants worth preserving

**Never clobber.** Before writing a rewrite into a field, the captured text is
re-validated. If the field changed underneath, it relocates by unique match; if
it cannot, it refuses and offers Copy instead. Writing to the wrong place is
worse than not writing.

**Never modify a scanned page.** Page scan uses the CSS Custom Highlight API and
`Range` objects, which register with the browser rather than touching the DOM.
The only write is a stylesheet appended to `<head>`, removed on clear. Tests
assert `document.body.textContent` is identical before the scan, after it, and
after clearing.

**Never capture credentials.** Password, card number, and one-time-code fields
are excluded at the selection layer, and every entry point (chip, context menu,
keyboard shortcut) routes through that same guard rather than reimplementing it.

**Never silently downgrade.** The card always names the engine that produced a
result. A rules-only pass says so.

## Messaging

The popup uses one-shot `chrome.runtime.sendMessage`. The content script uses a
long-lived port, because rewrites stream:

- every request carries a correlation `id`, so a superseded response cannot
  render over a newer one
- `{ type: 'cancel', id }` maps to an `AbortSignal` that reaches `fetch` and the
  Prompt API session
- the background aborts everything in flight when a port disconnects
- the content script also runs a client-side idle timeout, because "the service
  worker never answered" is a real state in MV3
- every message is validated by a type guard, and the sender id is checked

## Storage

One key in `chrome.storage.local`, never synced. Reads merge over defaults so an
older install that predates a field still works. API keys live here and nowhere
else, and error strings are redacted before they can reach a log or the UI.

## Where the tests live

- `tests/` unit tests, node by default, jsdom where DOM is needed
- `tests-e2e/` Playwright driving the real built extension in Chromium
- `docs/manual-test-matrix.md` the things neither can reach: real sites, real
  models, real documents, and browser APIs that do not exist in a test runner
