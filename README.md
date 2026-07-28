# Second Draft (Chrome extension)

Make AI drafts sound like you. Select text in any editable field, click the
Humanize chip, review the before/after with explained highlights, and Apply
replaces it in place. A popup paste box covers sites that block replacement.
Rewrites run on your device through Chrome's built-in Gemini Nano when available,
with an optional bring-your-own-key upgrade (Anthropic or any OpenAI-compatible
endpoint) configured in the options page.

Status: 1.1.0, pending store submission.
Demo page: https://joel-wwalker.github.io/second-draft/

## Features

- Select text, click the chip (it shows how many tells are in your selection), review, apply in place
- A score ring and a tell count that only reaches zero when the rewrite earned it
- What-changed log: every edit as old to new, with the reason
- Tappable alternatives for AI flavored words, applied before you commit
- Undo for ten seconds after applying, and Try again for a different rewrite
- Ctrl+Shift+H to humanize the selection, or right click anywhere
- Engines: Chrome's on-device Gemini Nano by default, your own Anthropic or
  OpenAI-compatible key optionally, deterministic cleanup rules as the floor
- Your own custom tells, plus a writing profile read from a sample you paste or
  upload as .txt, .md, or .docx
- Scan a whole page for tells without changing a character of it
- Per-site disable, and a popup paste box for sites that block in-place editing

Privacy policy: https://joel-wwalker.github.io/second-draft/privacy-policy (no
servers, no telemetry; text leaves your device only for a provider you configure).

## Develop

- `npm install`
- `npm run dev` starts WXT with hot reload
- `npm test` runs unit tests, `npm run typecheck` checks types
- `npm run build` outputs `.output/chrome-mv3` (load unpacked from there)
- `npm run zip` builds the store upload
- `npm run e2e` runs Playwright against the built extension (run `npm run build` first)
- docs/manual-test-matrix.md is the pre-release checklist

Design spec: `docs/superpowers/specs/2026-07-25-humanizer-chrome-extension-design.md`

## Attribution

Rewrite patterns derive from [blader/humanizer](https://github.com/blader/humanizer)
SKILL.md v2.8.2 (MIT, vendored at `docs/skill-source/`), based on Wikipedia's
"Signs of AI writing" by WikiProject AI Cleanup.
