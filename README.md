# Second Draft (Chrome extension)

Make AI drafts sound like you. Select text in any editable field, click the
Humanize chip, review the before/after with explained highlights, and Apply
replaces it in place. A popup paste box covers sites that block replacement.
Rewrites run on your device through Chrome's built-in Gemini Nano when available,
with an optional bring-your-own-key upgrade (Anthropic or any OpenAI-compatible
endpoint) configured in the options page.

Status: 1.0.0, pending store submission.

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
