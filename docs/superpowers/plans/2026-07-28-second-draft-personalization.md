# Second Draft Personalization and Control Implementation Plan (Plan 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the rewrite reversible, repeatable, personal, and discoverable: undo after apply, regenerate, a keyboard shortcut, custom tells, a voice sample you can upload a real document into, a writing profile computed from that sample, a page-wide scan mode, and a public demo page.

**Architecture:** Everything stays inside the existing boundaries. New pure modules go in `src/shared/` (profile analysis, docx text extraction) and `src/engine/` (custom rules merge). UI work is confined to the existing card, popup, options, and one new scan overlay in the content script. No production dependencies; `.docx` reading uses the platform `DecompressionStream`.

**Deliberate change from Plans 1-3:** those plans embedded complete code, and four times a defect in the plan became a defect in the product (emoji class, tidy, chunker, quotedRegions). This plan specifies **interfaces, behavior contracts, and test expectations**; implementers write the bodies and are expected to flag any contract that cannot be satisfied cleanly rather than transcribing something broken.

## Global Constraints

- All prior constraints hold: TS `strict` + `noUncheckedIndexedAccess`, no `any`; `src/engine/**` and `src/shared/*` (except `storage.ts`) never touch the DOM or `chrome.*`; no em/en dashes in user-visible strings; conventional commits; zero production dependencies.
- Load-bearing selectors must survive: `humanizer-chip-host`, `humanizer-card-host`, `.rewritten`, `.status`, `.engine`, `select.intensity`, `button.apply`, `button.copy`, `button.dismiss`, `.changes`, `.rows`, `.chg`, `.why`, `.b`, `.a`, `.headline .h`, `.ring .num`, `button.alt`, `button.alt-opt`.
- Indigo palette: accent `#4f46e5`, hover `#4338ca`, ink `#0f172a`, muted `#64748b`, line `#e2e8f0`. Alternatives use amber `#9a3412` on `#fff7ed`.
- Every task ends green on `npx vitest run`, `npm run typecheck`, `npm run build`, and (where the content script changed) `npx playwright test`.
- Baseline at plan start: 121 unit + 3 e2e, v1.0.0 shipped, branch `feature/personalization` off `main`.

---

### Task 1: Undo after apply

**Files:** `src/content/card.ts`, `src/content/session.ts`, `tests/chip-card.test.ts`, `tests/session.test.ts`

**Contract**
- `CardCallbacks` gains `onUndo(): void`.
- After a successful apply, the card does not close. It switches to a confirmation state: headline `Applied`, body replaced by the message `Replaced in place.`, and the bar shows a single `button.undo` labeled `Undo` next to Dismiss (Apply, Copy, and the intensity select hidden). Expose this as `card.showApplied(): void`.
- The card auto-dismisses 10 seconds after `showApplied` unless the user interacts; clicking Undo or Dismiss cancels the timer. Timer id cleared in `close()` and `open()`.
- Session: `onApply` calls `applyReplacement`; on success it records `{ target, appliedText, originalText }` and calls `card.showApplied()` instead of `card.close()`. `onUndo` writes the original text back through the same `applyReplacement` path (constructing a selection whose captured text is the applied text), then closes the card. If the undo write fails, show `card.setError('replace-failed', 'Could not undo. The text changed again.')`.

**Tests**
- Card: `showApplied` hides apply/copy/intensity, shows `button.undo`, sets the headline to `Applied`.
- Card: the auto-dismiss timer closes the card after 10s (fake timers) and is cancelled by `close()`.
- Session: apply then undo restores the original textarea value; `port.sent` gains no new humanize request.
- Session: undo when the field changed underneath surfaces the replace-failed error and leaves the field untouched.

---

### Task 2: Regenerate

**Files:** `src/content/card.ts`, `src/content/session.ts`, `tests/chip-card.test.ts`, `tests/session.test.ts`

**Contract**
- `CardCallbacks` gains `onRegenerate(): void`; the bar gains `button.regen` labeled `Try again`, placed left of Copy, hidden until a result arrives and hidden again while streaming.
- Session `onRegenerate`: cancels any in-flight request, clears `result`, resets the card to its streaming state, and issues a fresh request for the same captured text and intensity (same path as an intensity change, minus the intensity edit).
- Repeated regeneration must not accumulate ports, timers, or listeners.

**Tests**
- Card: `button.regen` is hidden on open, visible after `setResult`, hidden again after `setStreaming`.
- Session: clicking regen sends a second humanize request with a new id and the same text/intensity, and sends a cancel for the first if it was still running.
- Session: a stale `done` for the superseded id does not render (existing id-guard still holds).

---

### Task 3: Keyboard shortcut

**Files:** `wxt.config.ts`, `src/entrypoints/background.ts`, `src/content/session.ts`, `src/shared/messages.ts`, `tests/session.test.ts`, `docs/manual-test-matrix.md`

**Contract**
- Manifest gains a `commands` entry: `humanize-selection` with suggested key `Ctrl+Shift+H` (`MacCtrl+Shift+H` on mac), description `Humanize the selected text`.
- Background listens on `chrome.commands.onCommand`; on that command it sends `{ type: 'context-humanize', selectionText: '' }` to the active tab (reusing the existing content path, which reads the live selection itself). Guard for no active tab.
- The content path is unchanged, so the sensitive-field guard still applies. Confirm that in the review.
- Matrix gains a row: shortcut on a normal page with a selection; shortcut inside a password field (nothing happens).

**Tests**
- Session: the existing context-humanize tests already cover the receiving side; add one asserting an empty `selectionText` with a live editable selection still humanizes the selection (shortcut shape).

---

### Task 4: Custom tells

**Files:** `src/shared/storage.ts`, `src/engine/rules.ts`, `src/engine/index.ts` (wiring only), `src/entrypoints/options/{index.html,main.ts}`, `tests/rules.test.ts`, `tests/storage.test.ts`

**Contract**
- `Settings` gains `customTells: string[]` (default `[]`), each entry a plain phrase (not a regex).
- `rules.ts` exports `customRules(phrases: string[]): Rule[]` producing detect-only rules with id `custom`, reason `Your custom tell`, matching the phrase case-insensitively on word boundaries, with regex metacharacters escaped. Empty and whitespace-only phrases are ignored; phrases longer than 80 chars are ignored.
- `detect(text, extra: Rule[] = [])` accepts extra rules; `humanize` passes `customRules(settings.customTells)` through a new optional `HumanizeOptions.customTells: string[]`. Background supplies it from settings.
- Options page: a textarea (`#customTells`, one phrase per line) with helper copy `One phrase per line. These are flagged as tells and fed to the rewrite prompt.` Saved with the rest of the settings.
- The prompt's detected-tells summary includes custom hits (they flow through `detect`, so this should be automatic; verify).

**Tests**
- `customRules` escapes metacharacters (a phrase containing `.` or `(` matches literally, does not throw).
- `detect` with a custom phrase finds it, case-insensitively, on word boundaries only.
- Empty/whitespace/overlong phrases produce no rules.
- Storage: `customTells` defaults to `[]` and round-trips.

---

### Task 5: Voice sample file upload

**Files:** new `src/shared/docx.ts`, `src/entrypoints/options/{index.html,main.ts,style.css}`, `tests/docx.test.ts`

**Contract**
- `src/shared/docx.ts` exports `extractDocxText(bytes: ArrayBuffer): Promise<string>`: reads the ZIP central directory, finds `word/document.xml`, inflates it with `DecompressionStream('deflate-raw')` (stored entries pass through uncompressed), strips XML tags, converts `</w:p>` to newlines, decodes basic entities, and collapses whitespace runs. Throws `HumanizerError('internal', 'Could not read that .docx file.')` on a malformed archive or a missing document part.
- Options page: a file input (`#voiceFile`, `accept=".txt,.md,.docx"`) beside the voice-sample textarea, plus a status line (`#voiceFileStatus`). Choosing a file fills the textarea with its text (replacing existing content) and reports `Loaded 1,240 words from paper.docx`. `.pdf` is rejected with `PDF is not supported yet. Copy the text and paste it instead.`
- Files over 2 MB are rejected with a clear message before reading. Text longer than 20,000 characters is truncated to 20,000 with the status noting it.
- No production dependency may be added.

**Tests** (`tests/docx.test.ts`, node environment)
- **Deflate-compressed fixture is mandatory, not optional.** Real .docx files are deflated; a test that only covers stored entries would leave the common path unverified. Build the fixture with `CompressionStream('deflate-raw')` so the test exercises the same inflate path a real file takes, and assert the round trip.
- Also cover a stored (uncompressed) entry, since some writers emit them.
- Multiple paragraphs come back newline separated with no tags.
- A ZIP without `word/document.xml` throws the documented error.
- Non-zip bytes throw the documented error.
- Truncated/corrupt central directory throws rather than hanging or returning partial garbage.
- Entity decoding: `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;`.
- A file whose extracted text exceeds the cap is truncated at exactly the cap.

---

### Task 6: Writing profile

**Files:** new `src/shared/profile.ts`, `src/entrypoints/options/{index.html,main.ts,style.css}`, `src/content/card.ts`, `src/shared/labels.ts` (if a formatter helps), `tests/profile.test.ts`, `tests/chip-card.test.ts`

**Contract**
- `src/shared/profile.ts` exports `interface WritingProfile { words: number; avgSentenceWords: number; sentenceVariety: number; contractionRate: number; commasPerSentence: number; longWordRate: number }` and `analyzeWriting(text: string): WritingProfile | null` (null under 40 words). `sentenceVariety` is the standard deviation of sentence lengths in words, rounded to one decimal. `contractionRate` and `longWordRate` (words of 3+ syllables approximated by 8+ characters) are fractions rounded to two decimals.
- Also exports `compareToProfile(text: string, profile: WritingProfile): string | null` returning a single short human sentence when a rewrite drifts meaningfully from the profile (average sentence length differing by more than 4 words, or contraction rate differing by more than 0.15), else null. Wording examples: `Your writing averages 14 word sentences; this runs 21.` and `You use more contractions than this rewrite does.`
- Options page: after a voice sample is present (typed or uploaded), show a read-only profile panel (`#profilePanel`) listing words, average sentence length, variety, contractions, and comma rate, recomputed on input with a 400 ms debounce. Hidden when `analyzeWriting` returns null, with the copy `Add about 40 words to see your writing profile.`
- Card: when a voice sample profile exists and `compareToProfile` returns a note, show it in a `.profile-note` line under the status. The card receives the note as an optional argument on `setResult(result, original, note?)` so the module stays DOM-free; session fetches the profile from storage once per session and computes the note.

**Tests**
- `analyzeWriting` returns null under 40 words; computes plausible values on a fixture paragraph (assert exact numbers derived from a hand-counted fixture).
- `sentenceVariety` is 0 for equal-length sentences and larger for mixed.
- `compareToProfile` returns null when close, a sentence-length note when the rewrite is much longer, and a contraction note when contractions differ.
- Card renders `.profile-note` only when a note is passed.

---

### Task 7: Page scan mode

**Files:** `src/content/{scan.ts,session.ts}`, `src/entrypoints/popup/{index.html,main.ts}`, `src/shared/messages.ts`, `tests/scan.test.ts`, `docs/manual-test-matrix.md`

**Contract**
- New `src/content/scan.ts` exporting `class PageScan { constructor(doc: Document); run(): ScanSummary; clear(): void }` with `interface ScanSummary { tells: number; blocks: number }`.
- `run()` walks visible text nodes inside `p`, `li`, `h1`-`h4`, `blockquote`, and editable roots, skipping the extension's own hosts, `script`, `style`, inputs, and nodes under 40 characters. For each block it runs `detect` and wraps hits using CSS Custom Highlight API when available (`CSS.highlights`), else falls back to no visual marks but still counts. Visual style: amber underline, same family as the alternatives chip.
- `clear()` removes all highlights and is called on navigation away, on a second scan, and when the popup requests it.
- Popup gains a `Scan this page` button (`#scan`) that messages the active tab; the result renders as `14 tells across 9 paragraphs` (`#scanStatus`), plus a `Clear` control once a scan is showing.
- Message protocol gains `{ type: 'scan' }` and `{ type: 'scan-clear' }` (validated like the others) and a response `{ ok: true, summary }`.
- Scanning never modifies page text.

**Tests** (jsdom)
- `run()` counts tells across multiple blocks and reports block count; short blocks are skipped.
- The extension's own hosts are never scanned.
- `clear()` after `run()` leaves the DOM text identical to before the scan (assert `document.body.textContent` unchanged across run and clear).

---

### Task 8: Demo page, docs, and release

**Files:** `docs/index.html`, `docs/manual-test-matrix.md`, `README.md`, `CHANGELOG.md`, `package.json`, `docs/store-listing.md`

**Contract**
- `docs/index.html` is a self-contained GitHub Pages landing page (no external requests) with: the product name and one-line pitch, a static before/after example using real AI-sounding text, a short list of what it does (tells score, what changed, alternatives, on-device), install and source links, and a privacy line. Indigo palette, responsive, light and dark via `prefers-color-scheme`. It must not claim detector evasion.
- Matrix gains rows for every Plan 4 feature: undo, regenerate, shortcut, custom tells, docx upload, profile panel, page scan.
- README gains a features section and a link to the demo page. Store listing description gains one sentence covering alternatives and the writing profile.
- Version to 1.1.0 with a CHANGELOG entry; lockfile synced via `npm install`; verify `npm ci` exits 0.

**Tests:** none new; the release checks are the four commands plus a manual read of the rendered page.

---

## Testing discipline (binding on every task)

Each task's tests must cover the **real** path, not a convenient stand-in:

- **Assert values, not shapes.** Hand-count the expected numbers in fixtures (profile stats, tell counts, block counts) and assert those exact values. `toBeGreaterThan(0)` is not acceptance.
- **Exercise the path production uses.** If production inflates compressed bytes, the test compresses. If production walks real DOM structures, the fixture has nested elements, not one flat div.
- **Prove the guard, not just the happy path.** Every refusal in a contract (undo when the field drifted, oversized upload, overlong custom tell, short voice sample) gets a test that would fail if the guard were removed.
- **State what the tests do not cover.** Each task's report must name the parts that only manual testing can reach, and those go into the matrix as rows rather than being quietly assumed.

## Known verification limits (accept these, do not paper over them)

These cannot be honestly covered by automated tests in this project, so they are manual-matrix rows and must be labeled as such in reports:

- **Keyboard shortcut (Task 3).** `chrome.commands` fires from the browser chrome; neither vitest nor Playwright can trigger a real accelerator. Automated coverage stops at the receiving message handler.
- **Highlight rendering in page scan (Task 7).** The CSS Custom Highlight API does not exist in jsdom, so tests verify counting, block selection, skip rules, and that the DOM text is unmodified. Whether highlights are visible on a real page is a manual check. If `CSS.highlights` is unavailable at runtime the feature counts without marking, and the popup must say so rather than implying highlights appeared.
- **Real .docx files from Word or Google Docs (Task 5).** Tests use synthesized archives. Exercising a genuinely exported paper is a matrix row.
- **Rewrite quality against a writing profile (Task 6).** The profile math is testable; whether a rewrite actually sounds more like the author is a human judgment and stays a matrix row.
- **On-device model behavior.** Unchanged from Plan 3: mocked in tests, real behavior is manual.

If an implementer finds a contract in this plan that cannot be met without weakening one of these disciplines, the correct move is to report BLOCKED and say so, not to write a test that passes vacuously.

## Suggested execution order

1, 2, 3 (card and session, sequential because they share files), then 4, 5, 6 (settings and analysis), then 7 (scan), then 8 (release). Tasks 5 and 6 pair naturally: upload a paper, immediately see its profile.

Task 7 is the riskiest item in this plan: DOM walking on arbitrary pages plus an API tests cannot reach. If it turns out to be flaky or invasive in manual testing, cutting it costs nothing else in the plan and the remaining seven tasks still ship.

## Out of scope, on purpose

PDF parsing (needs a real parser and a production dependency), cloud sync of settings, multiple voice profiles, any AI-detector integration, and rewriting text anywhere outside an explicit user selection.
