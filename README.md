# Humanizer (Chrome extension)

Make AI drafts sound like you. Select text on any page, click Humanize, review
the before/after, apply. Rewrites run on your device by default (Chrome's
built-in Gemini Nano); optionally bring your own API key for higher quality.

Status: in development. Plan 1 (engine + popup paste box) of 2.

## Develop

- `npm install`
- `npm run dev` starts WXT with hot reload
- `npm test` runs unit tests, `npm run typecheck` checks types
- `npm run build` outputs `.output/chrome-mv3` (load unpacked from there)
- `npm run zip` builds the store upload

Design spec: `docs/superpowers/specs/2026-07-25-humanizer-chrome-extension-design.md`

## Attribution

Rewrite patterns derive from [blader/humanizer](https://github.com/blader/humanizer)
SKILL.md v2.8.2 (MIT, vendored at `docs/skill-source/`), based on Wikipedia's
"Signs of AI writing" by WikiProject AI Cleanup.
