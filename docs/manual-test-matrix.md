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
| 9 | Options: Nano status reflects machine; download flow when `downloadable` | Progress percentage, then Ready |
| 10 | No key + Nano ready: rewrite a selection | Engine label "On-device AI (Gemini Nano)"; no em dashes in output |
| 11 | No key + Nano unavailable | Quick clean result labeled as such |
| 12 | Anthropic key: save (permission prompt appears), rewrite | Engine label "Your API key (model)"; streaming visible on long text |
| 13 | OpenAI-compatible with local Ollama base URL | Works without a permission prompt (localhost) |
| 14 | Wrong API key | Card error "API key rejected (401)" |
| 15 | Per-site disable via popup, revisit site | No chip; context menu also inert on that site; re-enable restores |
| 16 | Voice sample set: rewrite | Output tone follows the sample (subjective check) |
| 17 | Password / email / card-number fields | No chip ever |
| 18 | Selection near the bottom of the window | Card stays fully on-screen |
| 19 | Nano: selection over 8000 chars across 3+ paragraphs | Later chunks stay rewrites (no commentary or repetition of earlier chunks) |
| 20 | BYOK: selection that streams for longer than 60 seconds | No false timeout while chunks keep arriving |
| 21 | BYOK: selection over 30k chars | Clear too-long error, never a silently truncated result |
| 22 | Right-click Humanize inside a card-number or OTP field | Nothing happens |
| 23 | Nano downloadable, no API key | Quick clean result; options page offers the model download |
| 24 | Non-Ollama local OpenAI-compatible server (LM Studio, llama.cpp) | Works after permission grant, or a clear endpoint error, never a hang |
| 25 | Select text on a normal page, press Ctrl+Shift+H (MacCtrl+Shift+H on mac) | Same as right-click Humanize: chip hides, card opens over the selection, rewrite streams in. The accelerator itself is manual-only: neither vitest nor Playwright can trigger a real `chrome.commands` shortcut, so this row is the only coverage past the receiving message handler |
| 26 | Focus a password field, press Ctrl+Shift+H (MacCtrl+Shift+H on mac) | Nothing happens: no chip, no card. Same sensitive-field guard as the context-menu path |
