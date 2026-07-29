# Architecture

A short tour of how the pieces fit and, more usefully, which boundaries are
load-bearing.

## The shape

```
 right click ──▶ background ──capture──▶ content script (reads selection)
                     │
                     ├── parks the text, opens the popup
                     ▼
                   popup ──▶ background ──▶ engine ──▶ provider
                     │
                     └──apply──▶ content script ──▶ replacement (never clobber)
```

- **`src/engine/`** is pure text processing. No DOM, no `chrome.*`. It takes a
  string and options, and returns a rewritten string with a change list.
- **`src/shared/`** holds types and pure helpers (diff, profile, docx, sse,
  redaction, labels). `storage.ts` is the deliberate exception that touches
  `chrome.storage`.
- **`src/content/`** owns everything that touches a web page, and draws nothing:
  it hands over the selected text, writes a rewrite back where it came from, and
  can undo that write.
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
2. **Rewrite.** Hand the text and a system prompt to the provider. Providers
   stream, and the engine can run a second pass when the first loses content.
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

**Never capture credentials.** Password, card number, and one-time-code fields
are excluded at the selection layer, and both entry points (right click and the
keyboard shortcut) route through that same guard rather than reimplementing it.

**Never lose content.** Every rewrite is compared against the original for
dropped numbers, names, dates, quotations, paragraphs, and a large drop in
length. A lossy rewrite is retried once with the losses named in the prompt;
whatever still goes missing is reported on screen rather than hidden.

**Never silently downgrade.** The popup always names the engine that produced a
result. A rules-only pass says so.

## Messaging

Two directions, both validated by type guards with the sender id checked:

- **Popup to background**, over a long-lived port, because rewrites stream.
  Every request carries a correlation `id` so a superseded answer cannot render
  over a newer one, `{ type: 'cancel', id }` maps to an `AbortSignal` that
  reaches `fetch` and the Prompt API session, and closing the popup disconnects
  the port, which is what cancels work in flight. The popup also runs its own
  idle timeout, because "the service worker never answered" is a real state in
  MV3. A one-shot `sendMessage` handler exists alongside it for callers that do
  not need streaming.
- **Popup and background to the content script**, `chrome.tabs.sendMessage`:
  `capture` hands over the selected text, `apply` writes a rewrite back into it,
  `undo` restores the original. The content script answers and nothing else.

Right click opens the popup first and parks the selected text second, because
`chrome.action.openPopup()` needs the click's user gesture and every `await`
spends it. The popup opens empty and waits briefly for the text to land.
`openPopup()` is also missing from some builds, so a failure is not fatal: the
text stays parked and a badge on the toolbar icon tells the user to click it.

The parked text is deliberately short-lived. It expires after 60 seconds, is
deleted the moment the popup reads it, and is dropped when its tab closes or
Chrome restarts. Text nobody read must not turn up in a popup opened later for
something else.

A round trip to the page that throws is not the same as a page that answered
"nothing here". The per-site switch and the credential guard both live in the
content script, so if that script does not answer, the background reads nothing
at all. Chrome hands the context menu its own copy of the selected text, and that
copy is used only after the script has answered.

## Storage

Two keys in `chrome.storage.local`, never synced: the settings object, and the
short-lived selection a right click hands to the popup. Settings reads merge over
defaults so an older install that predates a field still works. API keys live here and nowhere
else, and error strings are redacted before they can reach a log or the UI.

## Where the tests live

- `tests/` unit tests, node by default, jsdom where DOM is needed
- `tests-e2e/` Playwright driving the real built extension in Chromium
- `docs/manual-test-matrix.md` the things neither can reach: real sites, real
  models, real documents, and browser APIs that do not exist in a test runner
