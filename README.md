# Humanizer (Chrome extension)

Make AI drafts sound like you. Select text in any editable field, click the
Humanize chip, review the before/after with explained highlights, and Apply
replaces it in place. A popup paste box covers sites that block replacement.
Rewrites run on your device; real model engines (Gemini Nano, bring-your-own-key)
arrive in Plan 3 — today's build uses the deterministic quick-clean rules.

Status: in development. Plan 2 (page UX) of 3.

## Develop

- `npm install`
- `npm run dev` starts WXT with hot reload
- `npm test` runs unit tests, `npm run typecheck` checks types
- `npm run build` outputs `.output/chrome-mv3` (load unpacked from there)
- `npm run zip` builds the store upload
- `npm run e2e` runs Playwright against the built extension (run `npm run build` first)

Design spec: `docs/superpowers/specs/2026-07-25-humanizer-chrome-extension-design.md`

## Attribution

Rewrite patterns derive from [blader/humanizer](https://github.com/blader/humanizer)
SKILL.md v2.8.2 (MIT, vendored at `docs/skill-source/`), based on Wikipedia's
"Signs of AI writing" by WikiProject AI Cleanup.
