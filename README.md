# Second Draft

[![CI](https://github.com/Joel-Wwalker/second-draft/actions/workflows/ci.yml/badge.svg)](https://github.com/Joel-Wwalker/second-draft/actions/workflows/ci.yml)
[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-216%20unit%20%2B%203%20e2e-brightgreen)](tests)
[![Runtime dependencies](https://img.shields.io/badge/runtime%20dependencies-0-brightgreen)](package.json)

**AI wrote your first draft. This makes it yours.**

A Chrome extension that strips the tells out of AI written text: em dashes,
"delve" and its friends, chatbot filler, and the flat even rhythm that gives a
generated paragraph away. Select text anywhere, review every edit with its
reason, apply it in place.

Rewrites run on your device by default, through Chrome's built-in Gemini Nano.
Nothing is sent anywhere unless you configure your own API key.

**[Demo page](https://joel-wwalker.github.io/second-draft/)** ·
**[Privacy policy](https://joel-wwalker.github.io/second-draft/privacy-policy)** ·
**[Changelog](CHANGELOG.md)**

Status: 1.2.0, pending Chrome Web Store submission.

## What it does

- **Select and rewrite.** A chip appears near your selection showing how many
  tells are in it. Click, review, apply in place.
- **Shows its work.** Every edit is listed as struck original to replacement,
  with the reason it changed. No black box score.
- **Counts the tells.** A ring fills as tells are cleared. It only reaches zero
  when the rewrite earned it, including in rules-only mode.
- **Offers alternatives.** Words like "delve" are tappable; pick a plain
  replacement and it goes in before you apply.
- **Undo and retry.** Ten seconds to take an apply back, and Try again for a
  different rewrite.
- **Learns your voice.** Paste or upload a sample (.txt, .md, .docx). It reads
  your sentence length and habits, and flags rewrites that drift from them.
- **Scans a page.** Count and underline tells across a whole article without
  changing a character of it.
- **Stays out of the way.** Per-site disable, a keyboard shortcut, a right click
  entry, and a paste box for sites that block in-place editing.

## Install

Not on the Chrome Web Store yet. To run it today:

```bash
git clone https://github.com/Joel-Wwalker/second-draft.git
cd second-draft
npm install
npm run build
```

Then open `chrome://extensions`, turn on Developer mode, choose **Load
unpacked**, and select the `.output/chrome-mv3` folder.

Requires Chrome 138 or newer. The on-device model downloads once from the
extension's options page; without it the extension falls back to deterministic
cleanup rules and says so rather than pretending.

## How it works

Three layers, in order of trust:

1. **Deterministic rules.** Twelve patterns drawn from Wikipedia's "Signs of AI
   writing" research. Some are fixable in code (em dashes, curly quotes, emoji,
   chatbot filler); the rest are detect-only and inform the prompt.
2. **A rewrite engine.** Chrome's on-device Gemini Nano, or your own Anthropic
   or OpenAI-compatible endpoint. Both stream.
3. **Enforcement.** The rules layer runs again on whatever the model returns.
   A prompt cannot guarantee "no em dashes"; code can. The model is asked, the
   rules layer guarantees.

The text-processing engine is a pure module with no DOM and no extension APIs,
which is why adding three engines needed no changes to the pipeline. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Development

```bash
npm run dev        # WXT with hot reload
npm test           # unit tests (vitest)
npm run typecheck  # tsc --noEmit
npm run build      # -> .output/chrome-mv3
npm run e2e        # Playwright against the built extension (build first)
npm run zip        # store upload artifact
npm run icons      # regenerate the placeholder icons
```

TypeScript strict with `noUncheckedIndexedAccess`, no `any`, and zero runtime
dependencies. The `.docx` reader is a hand-rolled ZIP parser over the platform's
`DecompressionStream` rather than a library.

## Testing

216 unit tests and 3 Playwright end-to-end tests that drive the real built
extension in a real browser, all running in CI on every push.

The bar is worth stating plainly: **a test that would still pass with its
feature deleted does not count as coverage.** Guards are mutation-proven (break
the guard, watch the named test fail, restore it), and fixtures assert
hand-counted values rather than whatever the implementation happened to emit.
Real defects were caught this way, including a regex that deleted trademark
symbols, a chunker that could overflow the model's context, and a `.docx`
upload that inflated 199 KB into 200 MB.

What automated tests cannot reach is written down rather than assumed.
[docs/manual-test-matrix.md](docs/manual-test-matrix.md) is the 46 row
pre-release checklist covering real sites, real models, and the browser APIs
that do not exist in a test environment.

## Project layout

```
src/
├── engine/        pure text processing: rules, prompts, providers, pipeline
├── shared/        types, diff, storage, profile, docx, sse, redaction
├── content/       selection, replacement, chip, card, page scan, session
├── entrypoints/   background service worker, popup, options
└── types/         ambient types for Chrome's Prompt API
docs/              privacy policy, store listing, test matrix, architecture
docs/superpowers/  the specs and implementation plans this was built from
```

`docs/superpowers/` is the written history: design specs and implementation
plans, each executed task by task with an independent review before merge. It is
unusual to publish, and it is the most honest record of how this was built.

## Contributing

Issues and pull requests are welcome. Please read
[CONTRIBUTING.md](CONTRIBUTING.md) first, especially the testing expectations.
Security reports go through [SECURITY.md](SECURITY.md), not public issues.

## License

Copyright (c) 2026 Joel Walker. Released under the GNU Affero General Public
License v3 or later (see [LICENSE](LICENSE) and [NOTICE](NOTICE)).

Commercial licensing without the AGPL's obligations is available from the
copyright holder: see [COMMERCIAL.md](COMMERCIAL.md).

## Attribution

Rewrite patterns derive from [blader/humanizer](https://github.com/blader/humanizer)
SKILL.md v2.8.2 (MIT, vendored at `docs/skill-source/` with its license intact),
which is based on Wikipedia's "Signs of AI writing" by WikiProject AI Cleanup.
