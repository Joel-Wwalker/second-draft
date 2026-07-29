# Chrome Web Store listing draft (owner approval required before submission)

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

Productivity / Writing

## Permission justifications (for the review form)

- Content script on all sites: reads the text the user selects when they
  choose Humanize from the right-click menu or the Ctrl+Shift+H shortcut, and
  writes the rewrite back in place when they click Apply to page in the
  popup. Also answers Undo, which restores the original text. Core
  functionality; a per-site disable toggle is built in, and password,
  card-number, and one-time-code fields are never read.
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

## Assets still needed from the owner

- Screenshots (1280x800): the popup mid-rewrite with the score ring and
  highlighted changes, the popup's What-changed log expanded, and the options
  page.
- Final icon approval (current icon is a generated placeholder).
- Developer account ($5 one-time).
- Privacy policy URL (live): https://joel-wwalker.github.io/second-draft/privacy-policy
