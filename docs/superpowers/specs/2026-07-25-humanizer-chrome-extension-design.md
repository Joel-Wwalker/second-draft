# Humanizer Chrome extension — design

- **Date:** 2026-07-25
- **Status:** approved in brainstorming; awaiting spec review
- **Owner:** Joel (Joel-Wwalker)

## Summary

A Chrome extension that removes signs of AI-generated writing from text, the way Grammarly fixes grammar. The user selects text in any editable field, clicks a "Humanize" chip, reviews a before/after card with explained changes, and applies the rewrite in place. Rewrites run on-device by default through Chrome's built-in Gemini Nano (Prompt API, stable for extensions since Chrome 138), with an optional bring-your-own-key (BYOK) upgrade for frontier-model quality. The rewrite rules come from the humanizer skill (blader/humanizer, SKILL.md v2.8.2, MIT), distilled into prompts plus a deterministic rule layer.

Ships to the Chrome Web Store. Positioning: "make AI drafts sound like you," not "bypass AI detectors."

## Decisions made during brainstorming

| Question | Decision |
| --- | --- |
| Audience | Public Chrome Web Store product |
| Interaction | Selection-based (chip + context menu), not Grammarly-style inline underlines |
| Engine | On-device Gemini Nano default; optional BYOK (Anthropic or OpenAI-compatible); rules-only fallback |
| v1 extras | Diff highlights with reasons, Light/Full intensity, voice sample, popup paste-box fallback |
| Pipeline | Hybrid: deterministic detect → single model pass → deterministic enforce → diff |
| Tooling | WXT + TypeScript (`strict: true`), no UI framework, shadow-DOM UI |
| Repo | This repo (`humanizer-extension`), fresh history, user's own GitHub account |

## Goals

1. Select → humanize → apply works reliably on mainstream sites (Gmail, LinkedIn, X, Reddit).
2. Default path is free, unlimited, and fully local; the extension makes zero network requests unless the user configures BYOK.
3. Every changed span in the result can explain itself ("em dash → comma", "'delve' is AI vocabulary").
4. The skill's hard constraint holds mechanically outside quotations: no em or en dash survives in output, enforced by code, not by prompt obedience. Deliberate exception: text inside quotation marks is reproduced verbatim (rewriting what someone said would falsify the quote), so a dash inside a quote survives by design and the UI should say so rather than hide it.
5. Store-review-friendly: minimal permissions, no remote code, honest privacy claims.

## Non-goals (v1)

- Grammarly-style always-on inline underlines while typing.
- Hosted backend, accounts, billing, or any paid tier (the provider interface leaves the door open; nothing is built).
- Multi-pass draft → audit → final "deep mode" (future BYOK-only option).
- Firefox/Safari ports (WXT keeps this possible later).
- Telemetry or analytics of any kind.

## Architecture

```
humanizer-extension/
├── wxt.config.ts
├── src/
│   ├── entrypoints/
│   │   ├── background.ts        # service worker: context menu, message routing, engine host
│   │   ├── content.ts           # selection chip, result card (shadow DOM), replacement
│   │   ├── popup/               # paste box, intensity default, engine status, per-site toggle
│   │   └── options/             # BYOK config, voice sample, defaults, per-site disable list
│   ├── engine/
│   │   ├── index.ts             # humanize(text, opts) — sole entry point
│   │   ├── rules.ts             # deterministic tells: detect + fix + reason
│   │   ├── prompts.ts           # distilled skill prompts as code constants
│   │   └── providers/
│   │       ├── nano.ts          # Chrome Prompt API (Gemini Nano)
│   │       ├── anthropic.ts     # BYOK Claude (direct browser CORS calls)
│   │       └── openai.ts        # BYOK OpenAI-compatible (base URL + key + model)
│   └── shared/                  # types, typed storage helpers, word-level diff
├── docs/
│   ├── skill-source/SKILL.md    # vendored humanizer skill v2.8.2 (MIT, attributed)
│   └── privacy-policy.md        # published via GitHub Pages
└── tests/                       # vitest unit + playwright e2e + manual matrix checklist
```

**Data flow:** content script captures selection → background → `engine.humanize()` → detect → provider pass (streaming) → enforce → diff → content script renders card → Apply writes back into the field.

**Boundary rule:** the engine knows nothing about the DOM; the content script knows nothing about models. The engine is pure text-in/text-out, unit-testable, and a hosted provider can slot in later without touching UI code.

All providers run from the background service worker (the Prompt API lives there; BYOK is plain `fetch`), behind one async interface.

## In-page UX

**Chip.** Appears near the selection endpoint when the user finishes selecting 10+ characters in an editable area (input, textarea, contenteditable), offset so it never covers text. Right-click → "Humanize selection" also works, including on non-editable text. Per-site disable (popup toggle) suppresses the chip entirely on listed sites.

**Card** (shadow DOM so host CSS can't touch it):
- Streams the rewrite as it generates; typical Nano latency for a paragraph is a few seconds.
- Changed spans are subtly highlighted; hover shows a one-line reason from the rules layer.
- Light/Full intensity toggle on the card; changing it re-runs the rewrite.
- Buttons: **Apply**, **Copy**, **Dismiss** (Esc also dismisses). For non-editable sources, Apply is hidden and Copy is primary.
- Always names the engine that produced the result (Nano / BYOK model / rules-only).

**Replacement strategy**, in fallback order:
1. `<textarea>` / `<input>`: `setRangeText()` + synthetic `input` event so React/Vue-controlled fields update their state.
2. contenteditable: restore the saved Range, then `document.execCommand('insertText')` (deprecated but universal; preserves the site's undo stack).
3. If both fail (e.g. Google Docs' canvas editor), the card says so, flips to Copy-primary, and points at the popup paste box.

**Never-clobber rule:** the selection Range is captured at chip-click time and revalidated before Apply. If the field changed since, diff-match relocates the original text; if relocation fails, refuse to replace and offer Copy. Accepted tradeoff: relocation keys on the captured text being unique in the field, so after heavy drift an identical duplicate elsewhere can become the relocation target; it receives the same rewritten text, which we judge less harmful than refusing the common prepend and cut-paste cases.

## Engine

### API

```ts
engine.humanize(text, {
  intensity: 'light' | 'full',
  voiceSample?: string,
  signal?: AbortSignal,
}) // streams chunks; resolves to:
// { rewritten: string, changes: Change[], engine: Engine, tells: { before, after } }
// Engine = { kind: 'nano' | 'byok' | 'rules', model?: string }  // model, e.g. "claude-sonnet-5", lets the card name it
// Change = { range, ruleId?, reason }  // range indexes the rewritten text
```

Streamed chunks are provisional display only; when the pipeline completes, the card swaps in the enforced + diffed final text. Enforce and diff always run on the full output.

### Pipeline: detect → model → enforce → diff

1. **Detect** (`rules.ts` on input). Inventory the tells present. Conditions the prompt ("this text contains em dashes, 'delve', a negative parallelism; fix these among other things") and seeds diff explanations. Does not modify text.
2. **Model pass.** Provider order: BYOK if configured, else Nano, else rules-only. Prompt variants: *Light* = hard tells + AI vocabulary, "change as little as possible"; *Full* = distilled 33 patterns + rhythm/voice guidance. Voice sample appended when set (trimmed to ~500 words for Nano). Output contract is rewritten text only; markdown fences and "Here is..." preambles are stripped defensively.
3. **Enforce** (`rules.ts` on output). Mechanically fix any surviving em/en dash, curly quote, ` -- `, or emoji. The model is asked; the rules layer guarantees, except inside quotation marks, which are left verbatim (see Goal 4).
4. **Diff.** Word-level diff (small Myers implementation in `shared/`). Changes overlapping a detected tell inherit its reason; the rest read "reworded".

### Rules catalog

Each rule: `{ id, detect(text): Span[], fix?(text): string, reason }`. Two explicit classes:

- **Fixable** (deterministic replacement is safe): em dash, en dash (number ranges become " to "), curly quotes → straight, ` -- `, emoji, chatbot artifacts ("I hope this helps", "Would you like...").
- **Detect-only** (needs model judgment to rewrite well): AI vocabulary list (§7 of the skill), negative parallelisms, title-case headings, bold-header lists, rule-of-three heuristic. These feed the prompt and the highlights.

False-positive guards follow the skill's "what NOT to flag" list: quoted/secondhand text is left alone by the dash fixes (v1 does not yet extend this guard to detect-only rules; the model prompt carries a leave-quotes-verbatim clause instead). Cluster gating beyond the rule-of-three minimum count is deferred to Plan 2.

**Rules-only mode** applies only the fixable set and the card labels it "quick clean, AI unavailable" — it never masquerades as the full product.

### Nano specifics

- Availability states `available` / `downloadable` / `unavailable` surface in popup and options; first use triggers the model download with progress UI.
- One session created with the system prompt, cloned per request so context never accumulates.
- Inputs over ~6k chars are chunked by paragraph groups and processed sequentially with progress. BYOK takes long inputs natively.

### BYOK specifics

- `anthropic.ts`: direct browser calls (Anthropic's CORS-enabled API).
- `openai.ts`: base URL + key + model fields; one form covers OpenAI, OpenRouter, Groq, local Ollama.
- Keys in `chrome.storage.local` only (never `sync`), with a plain statement that the key stays on this machine.
- Host permissions for API domains are **optional permissions**, requested only when the user enables BYOK.

### Prompts

Vendored `SKILL.md` v2.8.2 is the source of truth; `prompts.ts` holds hand-distilled variants as code constants (~1k tokens for Nano; fuller for BYOK). Nothing is fetched remotely. MIT attribution to blader/humanizer in the repo and options page.

## Popup and options

**Popup:** paste-box textarea + Humanize + result with Copy (the works-anywhere fallback, e.g. Google Docs); default intensity selector; engine status line (Nano state / BYOK model configured); per-site disable toggle for the current site.

**Options:** BYOK provider config; voice sample textarea (used per the skill's Voice Calibration section); default intensity; per-site disable list management; attribution and privacy links.

## Error handling

Typed union of failure kinds, each with a card state and a next step:

| Kind | UI behavior |
| --- | --- |
| `nano-downloading` | progress bar, retry when done |
| `nano-unavailable` | fall to rules-only, labeled |
| `byok-auth` | "key rejected — check options" link |
| `byok-rate-limit` | retry with countdown |
| `network` | retry button |
| `too-long` | "split the selection or add an API key" |
| `aborted` | silent (user dismissed) |
| `replace-failed` | never clobber; flip to Copy |

Hard rules: **no silent downgrades** (card always names the engine) and **never clobber** (refuse to replace text that can't be verifiably relocated). `AbortSignal` is wired end to end so Dismiss cancels inference and frees Nano sessions. Console logging under `[humanizer]`; no telemetry.

## Privacy and permissions

- Default path: text never leaves the machine. This is the headline store claim, so the code keeps it true: zero external requests except user-configured BYOK endpoints.
- Voice sample, settings, keys: `chrome.storage.local`; nothing synced.
- Permissions: `storage`, `contextMenus`, content script on `<all_urls>` (the chip must exist before any click; justified in review notes; per-site disable is the user-facing mitigation), optional host permissions for BYOK domains.
- Privacy policy hosted from this repo via GitHub Pages.

## Testing

- **Unit (Vitest):** every rule gets detect + fix + false-positive cases (em dashes inside quotes stay verbatim; en dash ranges like "1990–1995" are rewritten to "1990 to 1995" per the skill's hard ban; trademark/copyright symbols are never stripped by the emoji rule; markdown indentation survives cleanup). Diff util, prompt builders, and the full pipeline against a **fake provider** with canned outputs, including one that returns planted em dashes to prove the enforce pass catches them.
- **E2E (Playwright, loaded extension):** fixture pages with a textarea, a React-controlled input, and a contenteditable div. Assert: chip appears, card streams, Apply replaces, site undo still works. A storage flag forces the fake provider so CI needs no model and stays deterministic.
- **Manual matrix** before each release: Gmail, LinkedIn, X, Reddit, Google Docs (expected: copy fallback).
- **CI (GitHub Actions):** typecheck, Vitest, Playwright, `wxt zip` artifact.

## Store packaging

- `wxt zip` produces the upload artifact.
- Listing positioned as "make AI drafts sound like you"; description, screenshots, and 128px icon prepared at ship time.
- Requires: product name decision, $5 one-time Chrome dev registration, listing approval by the owner.
- Semver + CHANGELOG from v0.1.0. First review may be slow because of `<all_urls>`.

## Future (explicitly out of scope now)

- Hosted paid tier (frontier rewrites without a key, deep mode, multiple voice profiles) behind the same provider interface; payment via ExtensionPay or Stripe.
- Multi-pass deep mode for BYOK.
- Inline underline mode.
- Other browsers via WXT's multi-target build.

## Plan 2 must-carry list (from Plan 1's final review)

- `docs/privacy-policy.md` + GitHub Pages hosting (spec requires it; Plan 1 deferred it implicitly).
- Message protocol: add a correlation `id` to `HumanizeRequest` and a `{ type: 'cancel', id }` variant before the content script lands, so Dismiss-cancels-inference is buildable.
- Wrap `provider.available()` in try/catch inside `firstAvailable` when the first real provider lands (a throwing probe must fall through to rules-only, per the error table).
- Validate messages at the background boundary (runtime shape check + sender check) in the same commit as `content.ts`.
- Redact provider error strings before surfacing (`String(err)` may carry URLs/keys once BYOK exists).
- Consider `skipQuoted` on detect-only rules; UI surfacing of dashes that survive inside quotations.

## Plan 3 must-carry list (from Plan 2's final review)

- Sensitive-field capture guard is a hard gate on the first network provider: never send text from fields whose type, autocomplete, or name indicate passwords, card numbers, or one-time codes (a guard shipped in Plan 2; re-verify before BYOK/Nano).
- Decide `all_frames: true` for iframe-hosted editors (TinyMCE, CKEditor, WordPress classic) with the performance and store-review tradeoffs written down; until then the context menu with its selectionText fallback is the escape hatch.
- Shadow-DOM selection support (Reddit composer class of editors).
- Client-side request timeout in the session as defense in depth against a background that never answers.
- Live intensity refresh for open sessions and a .catch on the popup toggle write.
- Manual matrix additions: iframe editor page, Reddit composer, plain-http page, extension-reload-with-tab-open.

## Suggested build order (input to the implementation plan)

1. Scaffold (WXT + TS strict + Vitest + CI skeleton).
2. `rules.ts` + diff + tests (pure, no browser).
3. Engine pipeline with fake provider + tests.
4. Popup paste box wired to the engine (first usable build).
5. Content script: chip + card + replacement on fixture pages + Playwright.
6. Nano provider (availability, download UI, chunking).
7. BYOK providers + options page + optional permissions.
8. Voice sample + intensity variants + diff-highlight polish.
9. Icons, listing, privacy policy, manual matrix, store submission.

## Open items (owner decisions before ship, none block the build)

- Final product name (working title: Humanizer).
- Icon design.
- Store listing copy approval.

## Attribution

Rewrite patterns derive from [blader/humanizer](https://github.com/blader/humanizer) SKILL.md v2.8.2 (MIT), itself based on Wikipedia's "Signs of AI writing" (WikiProject AI Cleanup).
