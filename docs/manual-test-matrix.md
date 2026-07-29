# Manual test matrix (run before each release)

Build: `npm run build`, load `.output/chrome-mv3` unpacked. Reset state between
rows where noted (Clear extension storage via service-worker console).

| # | Scenario | Expected |
| - | -------- | -------- |
| 1 | Gmail compose: select a paragraph, chip, Apply | Text replaced in place; undo (Ctrl+Z) works |
| 2 | LinkedIn post editor: same | Same |
| 3 | X (Twitter) reply box: same | Same |
| 4 | Reddit new composer | Chip may not appear (shadow DOM, known); right-click Humanize works via Copy |
| 5 | Google Docs | Right click Humanize gets the selected text into the popup, but Apply to page is unavailable (canvas editor). Copy the rewrite back manually |
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
| 27 | Apply a rewrite, then click Undo within ten seconds | Original text returns exactly; the card closes. Wait past ten seconds instead and the card dismisses itself |
| 28 | Apply a rewrite, edit the field so the applied text no longer matches, then click Undo | Refuses with a clear message rather than writing over the edit |
| 29 | Click "Try again" on a result | A fresh rewrite streams in for the same selection and intensity; the old result is replaced, not appended |
| 30 | Settings: add a custom tell (try one with punctuation, such as "e.g.") and rewrite text containing it | The phrase is flagged and fed to the prompt; a phrase inside a longer word is not matched |
| 31 | Settings: upload a real .docx exported from Word or Google Docs, then a .txt, then try a .pdf | Word count reported for the first two, PDF politely refused. This is the row automated tests cannot reach: the docx fixtures in the suite are hand-built archives, not real documents with their tables, tracked changes, and split runs |
| 32 | Settings: paste or upload at least forty words, read the profile panel, then rewrite something long | Panel shows words, average sentence, variety, contractions, and commas per sentence. When a rewrite drifts far from those numbers the card shows a note under the status. Whether the rewrite actually sounds more like you is a judgment call, not a measurement |
| 33 | Select a paragraph and read the chip before clicking | The chip shows a count badge of tells in that selection. Add a custom tell in settings, reselect, and confirm the badge and the card's own "AI tells: N to M" agree on the same text |
| 34 | Rewrite something and read the card header | A ring fills as tells are cleared, the number in the middle is the tells remaining, and the headline reads All clear at zero, N tells left when some survive, or Looks human already when there were none to fix |
| 35 | Expand "What changed" on a result | Every edit is listed as struck original to replacement with a reason label. Counts match the status line. Pure insertions read as (added) and deletions as (removed) |
| 36 | Click a highlighted word in the result, pick an alternative, then Apply | The swapped word appears in the card immediately and is what lands in the field. Then click Undo and confirm the pristine original returns, not the swapped text |
| 37 | Open the popup and the options page in OS light mode, then dark mode | Both follow the system theme. The in-page card stays light on any site by design. Text stays legible in both, indigo accent intact |
| 38 | Click Settings in the popup | Options page opens. Confirm this is reachable without going through chrome://extensions |
| 39 | Rewrite something long enough to take a few seconds, on the card and in the popup | While waiting: the score ring spins, the status animates as Rewriting with cycling dots, and once text starts arriving a caret blinks at its end. The popup button reads Working. All of it stops the moment a result or an error lands. With the OS set to reduce motion, nothing animates and the status simply reads Rewriting... |
| 40 | Rewrite a paragraph containing numbers, a name, and a quotation, on each engine | If any of them are missing from the rewrite, an amber panel names them and Apply requires a second click reading Apply anyway. A faithful rewrite shows no panel and applies on one click |
| 41 | Select text on a page, right click, choose Humanize | The popup opens with the text already in the box and the rewrite already running, no extra clicks |
| 42 | Same, then click Apply to page | The page text is replaced in place. Undo appears and puts the original back |
| 43 | Right click Humanize where the popup cannot open itself (some Chrome builds block it) | A badge appears on the toolbar icon; clicking the icon opens the popup with the text waiting and running |
| 44 | Rewrite text containing numbers and a name on the on-device model, several times | If a pass drops a fact the engine silently retries once and usually recovers it. If both passes lose something, the amber panel names what is missing |
