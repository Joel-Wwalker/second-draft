# Manual test matrix (run before each release)

Build: `npm run build`, load `.output/chrome-mv3` unpacked. Reset state between
rows where noted (Clear extension storage via service-worker console).

| # | Scenario | Expected |
| - | -------- | -------- |
| 1 | Gmail compose: select a paragraph, right-click Humanize, Apply | Text replaced in place; undo (Ctrl+Z) works |
| 2 | LinkedIn post editor: same | Same |
| 3 | X (Twitter) reply box: same | Same |
| 4 | Reddit new composer (shadow DOM editor) | Right-click Humanize captures the text into the popup; if the editor's shadow root keeps the extension from writing back, Apply to page is unavailable and Copy is the fallback |
| 5 | Google Docs | Right click Humanize gets the selected text into the popup, but Apply to page is unavailable (canvas editor). Copy the rewrite back manually |
| 6 | WordPress classic editor (iframe) | Right-click Humanize still works (top-frame only, known): it captures the text into the popup using Chrome's own selection, but Apply to page is unavailable inside the iframe, Copy only. The keyboard shortcut cannot reach a selection inside the iframe at all |
| 7 | Plain http:// page with a textarea | Right-click Humanize works the same as on https; no crash |
| 8 | Reload the extension while a tab is open, then select text and right-click Humanize | The popup opens with the headline "Not running on that page" (the old content script in that tab can no longer be reached); after reloading the page, everything works again |
| 9 | Options: Nano status reflects machine; download flow when `downloadable` | Progress percentage, then Ready |
| 10 | No key + Nano ready: rewrite a selection | Engine label "On-device AI (Gemini Nano)"; no em dashes in output |
| 11 | No key + Nano unavailable | Quick clean result labeled as such |
| 12 | Anthropic key: save (permission prompt appears), rewrite | Engine label "Your API key (model)"; streaming visible in the popup on long text |
| 13 | OpenAI-compatible with local Ollama base URL | Works without a permission prompt (localhost) |
| 14 | Wrong API key | Popup shows "API key rejected (401)" |
| 15 | Disable the current site with the popup's toggle, then right-click a selection and choose Humanize | Nothing is captured: the popup opens with the headline "Not running on that page" and the text box stays empty. Re-enable the toggle and right-click again: the selection is captured and the rewrite runs normally |
| 16 | With a site disabled, select real text there, right-click Humanize, and check the service worker's network activity | No text is captured and no fetch request to any provider fires. This is the path a recent bug was found on, so confirm it with the network tab, not just by the popup looking empty |
| 17 | Voice sample set: rewrite | Output tone follows the sample (subjective check) |
| 18 | Rewrite a selection long enough that the result and the "What changed" log both run long | Both scroll inside their own box in the popup instead of growing the window off-screen |
| 19 | Nano: a selection over 4,000 characters across 3+ paragraphs | Later chunks stay rewrites (no commentary or repetition of earlier chunks) |
| 20 | BYOK: a rewrite that streams for longer than 60 seconds without a gap | No false timeout in the popup while chunks keep arriving, since each chunk resets the idle timer; only genuine 60 seconds of silence ends it with "Nothing came back for a minute. Try again, or try a shorter piece of text." Closing the popup mid-rewrite instead cancels it outright. A lossy rewrite's second pass must not trip the timer either, even though that pass is not shown as it arrives |
| 21 | BYOK: a selection over 50,000 characters | Clear too-long error, never a silently truncated result |
| 22 | Right-click Humanize inside a password, card-number, or one-time-code field | The popup opens with the headline "Nothing captured", explaining that Second Draft does not read password, payment, or one-time-code fields. The field's contents are never read, checked before any text is pulled, regardless of whether anything was selected |
| 23 | Focus a real credit-card number field, select the digits, right-click Humanize, and check the service worker's network activity | No text is captured and no fetch request to any provider ever fires. Same guard as the disabled-site case, confirmed with the network tab rather than just the popup's appearance |
| 24 | Nano downloadable, no API key | Quick clean result; options page offers the model download |
| 25 | Non-Ollama local OpenAI-compatible server (LM Studio, llama.cpp) | Works after permission grant, or a clear endpoint error, never a hang |
| 26 | Select text on a normal page, press Ctrl+Shift+H (MacCtrl+Shift+H on mac) | Same as right-click Humanize: the popup opens with the text already in the box and the rewrite already running. The shortcut itself is manual-only: neither vitest nor Playwright can trigger a real `chrome.commands` shortcut, so this row is the only coverage past the receiving message handler |
| 27 | Focus a password field, press Ctrl+Shift+H (MacCtrl+Shift+H on mac) | Nothing is captured: the popup opens with the same "Nothing captured" headline as the right-click path, and the toolbar icon shows no badge (a refusal is never badged). Focus alone blocks capture, regardless of any text selected elsewhere on the page |
| 28 | Apply a rewrite, then click Undo | Original text returns exactly on the page. Undo has no time limit; closing the popup and reopening it starts fresh instead of still showing Undo for a previous rewrite |
| 29 | Apply a rewrite, edit the field so the applied text no longer matches, then click Undo | Refuses with a clear message rather than writing over the edit |
| 30 | Click "Try again" on a result | A fresh rewrite streams into the popup for the same selection and intensity; the old result is cleared first, not appended to |
| 31 | Settings: add a custom tell (try one with punctuation, such as "e.g.") and rewrite text containing it | The phrase is flagged and fed to the prompt; a phrase inside a longer word is not matched |
| 32 | Settings: upload a real .docx exported from Word or Google Docs, then a .txt, then try a .pdf | Word count reported for the first two, PDF politely refused. This is the row automated tests cannot reach: the docx fixtures in the suite are hand-built archives, not real documents with their tables, tracked changes, and split runs |
| 33 | Settings: paste or upload at least forty words, read the profile panel, then rewrite something long | Panel shows words, average sentence, variety, contractions, and commas per sentence. When a rewrite drifts far from those numbers the popup shows a note under the status. Whether the rewrite actually sounds more like you is a judgment call, not a measurement |
| 34 | Rewrite something and read the popup's header | A ring fills as tells are cleared, the number in the middle is the tells remaining, and the headline reads All clear at zero, N tells left when some survive, or Looks human already when there were none to fix |
| 35 | Expand "What changed" on a result | Every edit is listed as struck original to replacement with a reason label. Counts match the status line. Pure insertions read as (added) and deletions as (removed) |
| 36 | Click a highlighted word in the result, pick an alternative, then Apply | The swapped word appears in the popup immediately and is what lands in the field. Then click Undo and confirm the pristine original returns, not the swapped text |
| 37 | Open the popup and the options page in OS light mode, then dark mode | Both follow the system theme. Text stays legible in both, indigo accent intact |
| 38 | Click Settings in the popup | Options page opens. Confirm this is reachable without going through chrome://extensions |
| 39 | Rewrite something long enough to take a few seconds | While waiting: the score ring spins, the status animates as Rewriting with cycling dots, and the popup button reads Working. All of it stops the moment a result or an error lands. With the OS set to reduce motion, nothing animates and the status simply reads Rewriting... |
| 40 | Rewrite a paragraph containing numbers, a name, and a quotation, on each engine | If anything is still missing after the engine's own silent retry, an amber panel names it, but Apply to page still takes one click either way. There is no second confirm click any more: that was removed when the retry became automatic |
| 41 | Select text on a page, right click, choose Humanize | The popup opens with the text already in the box and the rewrite already running, no extra clicks |
| 42 | Same, then click Apply to page | The page text is replaced in place. Undo appears and puts the original back |
| 43 | Right click Humanize where the popup cannot open itself (some Chrome builds block it) | A badge appears on the toolbar icon; clicking the icon opens the popup with the text waiting and running |
| 44 | Rewrite text containing numbers and a name on the on-device model, several times | If a pass drops a fact the engine silently retries once and usually recovers it. If both passes lose something, the amber panel names what is missing |
