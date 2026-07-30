# Changelog

## 1.3.0 (2026-07-29)

The popup is now the whole interface.

- Right click a selection (or press Ctrl+Shift+H) and the popup opens with the
  text already in it and the rewrite already running
- Apply to page writes the rewrite back where the text came from, with Undo
- A rewrite that drops a number, name, date, or quotation is retried once,
  quietly, and told what it lost. Anything still missing is named on screen
- Removed the floating button that appeared over a selection
- Removed page scanning and its underlines
- Rewrites stream into the popup, closing it cancels the work, and a request
  that goes quiet for a minute gives up instead of spinning
- A right click on a password, payment, or one-time-code field now says so
  instead of appearing to do nothing
- Quotation marks the model invents are removed. On-device Gemini Nano likes to
  wrap a sentence in quotes, which turns a plain statement into something that
  reads as a quotation of someone. Marks the original had are left alone

Security, all in the new right-click path:

- On a site you had turned the extension off for, a right click could still read
  the selection through Chrome's own copy of it, because that copy was used
  whenever the page did not answer. The per-site switch and the credential guard
  both live in the page script, so a page that does not answer now means nothing
  is read at all.
- Same hole, same cause, for credential fields on such a site.
- Selected text handed to the popup was left in local storage with no expiry, so
  a selection the popup never read could turn up and rewrite itself in a popup
  opened later for something else. It now expires after 60 seconds, is deleted
  the moment it is read, and is dropped when its tab closes or Chrome restarts.
- A rewrite that lost content and then hit an error on its second pass reported
  the error instead of the usable first result.

## 1.2.0 (2026-07-28)

- Relicensed from MIT to the GNU Affero General Public License v3 or later.
  Copies obtained under MIT keep those terms. Commercial licensing without the
  AGPL's obligations is available; see COMMERCIAL.md. The vendored humanizer
  skill stays MIT with its notice intact.

## 1.1.0 (2026-07-28)

Personalization and control.

- Undo for ten seconds after applying a rewrite, and Try again for a fresh one
- Ctrl+Shift+H humanizes the selection without reaching for the mouse
- Custom tells: add your own phrases in settings and they are flagged and fed to the prompt
- Voice sample can be uploaded as .txt, .md, or .docx instead of pasted
- Writing profile read from that sample, with a note on the card when a rewrite drifts from it
- Scan a whole page for AI tells without changing any of its text
- Word alternatives you can tap to swap before applying

## 1.0.0 (2026-07-26)

First public release, as Second Draft.

- Select text on any page, click Humanize, review the rewrite, apply in place
- What-changed log: every edit listed as before and after with its reason
- AI-tells score: how many tells were found and how many remain
- Engines: on-device Gemini Nano by default; bring your own key for Anthropic or any OpenAI-compatible endpoint; deterministic quick-clean rules as the floor
- Options page: engine setup, writing voice sample, default intensity, per-site disable
- Right-click Humanize selection anywhere; popup paste box for sites that block editing
- Private by design: no servers, no telemetry; text leaves the device only for a provider you configure
