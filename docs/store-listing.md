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

Second Draft rewrites AI-sounding text so it reads like a person wrote it.

It removes em dashes, curly quotes, stock AI vocabulary such as "delve",
"tapestry", and "leverage", chatbot filler such as "it's important to note
that", three-item lists used for rhythm, and promotional padding. The patterns
come from Wikipedia's "Signs of AI writing" documentation.

To use it, select text on a page, right click, and choose Humanize, or press
Ctrl+Shift+H. The popup opens with your text already in it and starts rewriting.
There is also a box in the popup you can paste into.

You get a count of AI patterns found and how many are left, the rewrite with
every change highlighted, and a list of each edit as old text to new text with
the reason for it. AI-flavored words are clickable if you want to pick a plainer
replacement before you apply anything.

Apply to page writes the rewrite back into the field the text came from, and Undo
puts the original back. On pages that cannot be edited, such as a published
article or a Google Docs canvas, you get Copy instead.

After every rewrite, Second Draft checks that no numbers, names, dates,
quotations, or paragraphs went missing. If something did, it rewrites once more
and says what was lost. Anything still missing is shown on screen rather than
left for you to find.

You can upload or paste a sample of your own writing, and Second Draft will tell
you when a rewrite drifts from your usual sentence length or punctuation habits.

Rewrites run on your device using Chrome's built-in AI. There is no account, no
sign-in, no server, no tracking, and no limit on how much you rewrite. You can
add your own Anthropic or OpenAI-compatible API key if you want a stronger model;
the key stays in your browser, and text goes only to the provider you chose.

You can turn Second Draft off for any site. Password, payment, and one-time-code
fields are never read.

Requires Chrome 138 or later. The on-device model downloads from the extension's
settings page. Without it, Second Draft still applies its fixed cleanup rules and
tells you that is what it did.

Source code: https://github.com/Joel-Wwalker/second-draft

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

  Upload **`docs/screenshots/store-screenshot.png`**. It is exactly 1280x800 and a
  24-bit PNG with no alpha channel, which is what the form requires, and it is
  framed from a real capture, so its engine caption reads "On-device AI (Gemini
  Nano)" and the rewrite in it is one the shipped model actually produced.

  Do not upload `hero.png`. That one is the same image at 2x for the README and the
  landing page, so it is 2560x1600 and the form rejects it on size. Do not upload
  `hero-changes.png` or `options.png` either: those are still rendered by the
  deterministic test engine, whose caption reads "Test engine (fake-echo)", because
  Playwright's bundled Chromium has no on-device model. To replace them, capture
  the popup again in a browser that does, overwrite
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
3. Fill the listing from the sections above, attach
   `docs/screenshots/store-screenshot.png` and `public/icons/128.png`, set
   visibility to Public and distribution to all regions, and submit.

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
