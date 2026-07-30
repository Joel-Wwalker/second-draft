# Chrome Web Store submission worksheet

Everything the store form asks for, ready to paste. Free listing, public.

Upload `.output/second-draft-1.3.0-chrome.zip`, which `npm run zip` writes.
Check the filename: old builds accumulate in `.output/` and uploading the wrong
one is easy.

## Name

Second Draft: Humanize AI Text
Short name: Second Draft.

## Short description (132 chars max)

Select text, right click, choose Humanize, and the popup rewrites it, keeping your facts. Runs on your device by default.

## Description

AI wrote your first draft. Second Draft makes it yours: it removes the
telltale signs of AI-generated writing, including em dashes, curly quotes,
"delve" and its friends, chatbot filler, rule-of-three cadence, and
promotional fluff.

Select text on almost any page, right click, and choose Humanize, or press
Ctrl+Shift+H. A popup opens and starts rewriting right away: no extra clicks.
It shows a score for the AI tells found and cleared, the rewrite with each
change marked, and a What-changed log that lists every edit with its reason.
Apply to page puts the rewrite back where the text came from, and Undo
restores the original. On pages that will not take text back, such as an
article or a Google Docs canvas, Copy is available instead.

If a rewrite drops a number, a name, a date, or a quotation, Second Draft
quietly tries again on its own, using what went missing to guide the second
attempt. Anything still missing after that is called out on screen instead of
hidden.

AI-flavored words in the rewrite are clickable, so you can swap in a plain
alternative before you apply. Give it a sample of your own writing, and it
will note when a rewrite drifts from your usual sentence length or rhythm.

Private by design: rewrites run on your device using Chrome's built-in AI. No
account, no servers, no tracking, unlimited use. Optionally add your own
Anthropic or OpenAI-compatible API key for higher quality rewrites; your key
stays in your browser.

## Positioning note

This listing says "make AI drafts sound like you"; it does not promise to
defeat AI detectors.

## Category

Writing tools, under whichever top-level category the dashboard offers for it.
Google reorganized the categories, so pick from the live list rather than trusting
a name here.

## Single purpose

The form asks for one purpose and rejects listings whose features wander from it.

> Second Draft rewrites text the user selects so it reads less like AI-generated
> writing. Every feature serves that one purpose: the right-click entry and the
> keyboard shortcut capture the selection, the popup shows the rewrite along with
> what changed and why, and Apply writes the result back into the field the text
> came from.

## Remote code

**No.** The extension executes no remotely hosted code. Everything runs from the
package. When the user configures their own API key, the extension sends text to
that endpoint and receives text back; that is data, not code.

## Data usage

Check **Website content**, and nothing else. The selected text is website content,
and on the optional API-key path it does leave the device.

Leave unchecked: personally identifiable information, health, financial and
payment information, authentication information, personal communications,
location, web history, and user activity. The API key is authentication
information but never leaves local storage except as a header to the endpoint the
user typed in, so it is not collected.

Justification to paste:

> Rewrites run on the user's device by default, using Chrome's built-in model, and
> nothing is transmitted. If the user chooses to add their own API key, the text
> they asked to rewrite is sent from their browser directly to the provider they
> configured, and to nobody else. The developer operates no servers and receives
> no data of any kind. There is no analytics, telemetry, or account system.

Then certify all three statements: no selling or transferring data to third
parties beyond approved use cases, no use unrelated to the single purpose, and no
use for creditworthiness or lending.

Under-disclosing here is what gets extensions removed later. Over-disclosing
costs nothing.

## Permission justifications (for the review form)

- Content script on all sites: reads the text the user selects when they
  choose Humanize from the right-click menu or the Ctrl+Shift+H shortcut, and
  writes the rewrite back in place when they click Apply to page in the
  popup. Also answers Undo, which restores the original text. Core
  functionality; a per-site disable toggle is built in, and password,
  card-number, and one-time-code fields are never read. The script runs in the
  top frame only, so a selection inside a cross-origin iframe is read through
  Chrome's own copy of the selected text and the field check cannot reach it.
  This is documented as a known limitation in SECURITY.md.
- storage: user settings (intensity, disabled sites, voice sample, custom
  tells, optional API key), stored locally. Also holds the text a right-click
  or keyboard-shortcut selection hands to the popup, kept for at most 60
  seconds or until the popup reads it, whichever comes first.
- contextMenus: the right-click "Humanize selection" entry.
- activeTab: lets the popup read the current tab's address to show and toggle
  its per-site disable switch.
- Optional host permissions: requested only when the user configures their own
  API key, limited to the provider domain they enter.
- Optional host permissions are declared broadly (https, plus http localhost
  and 127.0.0.1 for local models) because users may configure any
  OpenAI-compatible endpoint; a specific origin is requested only when the
  user saves a key, never at install.

## Graphic assets

- **Store icon**, 128x128: `public/icons/128.png`. A 512 is at
  `docs/screenshots/icon-512.png` if the dashboard asks for a larger one.
- **Screenshots**, 1280x800, at least one and up to five.

  Upload **`docs/screenshots/hero.png`**. It is 1280x800 and framed from a real
  capture, so its engine caption reads "On-device AI (Gemini Nano)" and the rewrite
  in it is one the shipped model actually produced.

  Do not upload `hero-changes.png` or `options.png`. Those are still rendered by
  the deterministic test engine, whose caption reads "Test engine (fake-echo)",
  because Playwright's bundled Chromium has no on-device model. To replace them,
  capture the popup again in a browser that does, overwrite
  `docs/screenshots/popup-real.png`, and run `npm run screenshots`.
- Promo tiles are optional. Skip them.

## Privacy policy URL

https://joel-wwalker.github.io/second-draft/privacy-policy

Live and rendering as HTML.

## Order of operations

1. Register at the developer dashboard and pay the one-time 5 USD fee. Expect a
   prompt to turn on 2-step verification and to verify a contact email; the
   account cannot publish without both.
2. `npm run zip`, then upload `.output/second-draft-1.3.0-chrome.zip`.
3. Fill the listing from the sections above, attach `docs/screenshots/hero.png`
   and `public/icons/128.png`, set visibility to Public and distribution to all
   regions, and submit.

Review usually takes a few days. A content script matching `<all_urls>` draws more
scrutiny than a narrow one, so expect the permission justification above to be
read closely.

## If the listing is rejected

The two likely reasons, and the answers:

- **Broad host access.** The content script needs `<all_urls>` because the user
  chooses where to rewrite text; the extension cannot know the site in advance. It
  reads only the current selection, only when asked, and never password, payment,
  or one-time-code fields. Point at `src/content/session.ts` and
  `src/content/selection.ts`.
- **Single purpose.** Everything in the popup exists to show or adjust one
  rewrite. Nothing collects, syncs, or reports.
