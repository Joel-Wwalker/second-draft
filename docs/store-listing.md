# Chrome Web Store listing draft (owner approval required before submission)

## Name

Second Draft: Humanize AI Text
Short name: Second Draft.

## Short description (132 chars max)

Make AI drafts sound like you. Select text, click Humanize, review the changes, apply. Runs on your device by default.

## Description

AI wrote your first draft. Second Draft makes it yours: it removes the
telltale signs of AI-generated writing, including em dashes, curly quotes,
"delve" and its friends, chatbot filler, rule-of-three cadence, and
promotional fluff.

Select text in almost any editable field, click the Humanize chip, and review
a before-and-after with every change explained: a What-changed log lists each
edit with its reason, and an AI-tells score shows how many tells were found
and how many remain. Apply replaces the text in place. A popup paste box
covers sites that block in-place editing.

AI flavored words are tappable, so you can swap in a plain alternative before you
apply, and if you give it a sample of your own writing it will tell you when a
rewrite drifts away from your usual sentence length and rhythm.

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

- Content script on all sites: shows the Humanize button next to text the user
  selects and replaces it in place when they click Apply. Core functionality;
  a per-site disable toggle is built in.
- storage: user settings (intensity, disabled sites, voice sample, optional
  API key), stored locally.
- contextMenus: the right-click "Humanize selection" entry.
- activeTab: lets the popup show and toggle the current site's disable switch.
- Optional host permissions: requested only when the user configures their own
  API key, limited to the provider domain they enter.
- Optional host permissions are declared broadly (https, plus http localhost
  and 127.0.0.1 for local models) because users may configure any
  OpenAI-compatible endpoint; a specific origin is requested only when the
  user saves a key, never at install.

## Assets still needed from the owner

- Screenshots (1280x800): chip on a selection, the result card, the options page.
- Final icon approval (current icon is a generated placeholder).
- Developer account ($5 one-time).
- Privacy policy URL (live): https://joel-wwalker.github.io/second-draft/privacy-policy
