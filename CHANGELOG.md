# Changelog

## 1.3.0 (2026-07-30)

The popup is now the whole interface, and the extension no longer asks for access
to every page you visit.

- No host permissions. The page script is injected into one tab at the moment you
  ask for a rewrite, which is what activeTab grants, so the extension has no
  standing access to anything. A site you turned it off for is now checked before
  anything is injected, rather than after the script had already loaded

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
- Clean input is left exactly as it arrived. With no tell to remove, the engine
  used to rewrite anyway and fall back on its default moves, which manufactured
  new tells; that was two of three cases where the score got worse
- Dashes are replaced, never deleted. Grammar was being broken by a dash
  vanishing with nothing in its place, and by the no-dashes rule spreading to
  hyphens and semicolons, so cost-effective became cost effective and required
  semicolons disappeared
- Pacing is asked for in both directions. The only structural move was splitting,
  which destroyed variance good input already had and gamed the spread number by
  fragmenting a paragraph into thirteen clipped sentences
- The writer's own voice is protected. First-person reviews were being sanded
  into neutral reports, and one rewrite turned a reviewer's own opinion into
  "according to some", inventing a vague attribution out of human writing
- The full rewrite teaches voice with worked examples. Tested against a public
  AI detector in one sitting: our output scored 76 percent machine-written with
  neutral tone and generic language given as the reasons, a human-written
  Wikipedia paragraph scored zero, and a rewrite of the same content using these
  moves, stock frames swapped for concrete wording, doing-verbs, contractions,
  one short judgment sentence, no This/However/While openers, scored zero with
  no fact changed and no grammar damaged
- Word churn is treated as the failure it is. The prompt used to demand a
  rewrite that reads noticeably different, and the model met that the cheapest
  way there is, swapping built for constructed while leaving the actual tells
  untouched. Difference is now defined as structural, a rewrite that raises the
  vocabulary above its own input is retried for it by name, and a rewrite that
  fixes none of the detected tells spends the retry on them, told which ones
  survived in their own words
- Vocabulary weight is measured. The share of words running to eight letters or
  more has a human median of 0.19 and a machine median of 0.34 across the same
  corpora; above 0.30 the prompt names the heavy words and asks for plain ones,
  and names, places, and technical terms are excluded from the examples
- Headings no longer count into the sentence after them when rhythm is measured
- Sentence shape is measured too. Fixing length alone produced varied lengths
  where every sentence still opened with its subject, seven in a row, because a
  model gives you exactly what you measure. The engine now counts how many
  sentences put a clause or phrase before the subject, and asks for a minimum
- npm run compare prints these numbers for any text, so a change can be checked
  rather than guessed at, and a rival's output can be put next to ours
- Sentence rhythm is measured instead of asked for. Prose where every sentence
  runs the same length reads like a machine wrote it whatever the vocabulary, and
  the prompt had been asking for variety in three separate places while the
  on-device model returned five sentences of 23, 24, 18, 16 and 15 words. The
  engine now sends the measured lengths, counts flat pacing against the score, and
  redoes a rewrite that comes back evenly paced
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
