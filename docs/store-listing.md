# Chrome Web Store submission notes

The values to paste live in [store-submission.txt](store-submission.txt), as plain
text with no formatting to strip. This file is the reasoning around them: what to
upload, what the form blocks on, and what to say if it comes back.

## What to upload

- Package: `.output/second-draft-1.3.0-chrome.zip`, written by `npm run zip`.
  Check the filename. Old builds pile up in `.output/`, and one of them was a
  0.1.0 with no content script in it.
- Icon: `public/icons/128.png`, drawn by `npm run icons`. A 512 sits at
  `docs/screenshots/icon-512.png` if the dashboard asks for a larger one.
- Screenshot: `docs/screenshots/store-screenshot.png`. Exactly 1280x800 and a
  24-bit PNG with no alpha channel, which is what the form requires.

`Desktop\second-draft-upload` holds copies of all three, numbered in upload order.

## Screenshots worth knowing about

Do not upload `hero.png`. It is the same image rendered at 2x for the README and
the landing page, so it is 2560x1600 and the form rejects it on size.

Do not upload `hero-changes.png` or `options.png` either. Those are rendered by
the deterministic test engine, so the engine caption in them reads "Test engine
(fake-echo)" rather than "On-device AI (Gemini Nano)". Playwright ships its own
Chromium with an empty profile, which has no on-device model, so the script cannot
produce a real caption by itself.

To replace them: capture the popup in a browser that does have the model, save it
over `docs/screenshots/popup-real.png`, and run `npm run screenshots`. It frames
your capture instead of its own render.

## Every field the form blocks on

The form lists them all at once, which reads like something is broken when in fact
nothing has been filled in yet.

**Settings page.** Publisher contact email, then the verification mail. This is
account level and blocks publishing on its own, whatever state the listing is in.

**Store listing tab.** Language, category, detailed description, icon, screenshot.

**Privacy practices tab.** Single purpose, one justification each for activeTab,
contextMenus, storage, and host permissions, the remote code answer, and the data
usage disclosure with its three certifications.

## Order of operations

1. Register at the developer dashboard and pay the one-time 5 USD fee. Expect a
   prompt to turn on 2-step verification as well as to verify the contact email.
2. `npm run zip`, then upload the package.
3. Fill the three tabs from `store-submission.txt`, set visibility to Public and
   distribution to all regions, and submit.

Review usually takes a few days.

## On the data usage disclosure

Check Website content even though the default path transmits nothing, because the
optional API-key path does. Under-disclosing there is what gets extensions removed
months later; over-disclosing costs nothing now.

## If the listing is rejected

The two likely reasons, and the answers:

- **Broad host access.** The content script matches all URLs because the user
  chooses where to rewrite text, so the site cannot be known in advance. It reads
  only the current selection, only on request, and never password, payment, or
  one-time-code fields. Point at `src/content/session.ts` and
  `src/content/selection.ts`.
- **Single purpose.** Everything in the popup exists to show or adjust one
  rewrite. Nothing collects, syncs, or reports.

## Positioning

The listing says the extension makes AI drafts sound like a person wrote them. It
does not claim to defeat AI detectors, and it should not start claiming that.

## Known limitation to disclose if asked

The content script runs in the top frame only, so a selection inside a
cross-origin iframe is read through Chrome's own copy of the selected text, and
the credential-field check cannot reach a field in that frame. Documented in
SECURITY.md.
