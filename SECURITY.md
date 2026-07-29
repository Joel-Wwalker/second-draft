# Security policy

## Reporting a vulnerability

Please do not open a public issue for security problems.

Use GitHub's private reporting: **Security → Report a vulnerability** on
[this repository](https://github.com/Joel-Wwalker/second-draft/security/advisories/new).
That reaches the maintainer privately and gives us a place to coordinate a fix.

Expect a first response within a week. If a fix is warranted it ships in the
next release, and you get credit in the changelog unless you would rather not.

## What is in scope

This extension handles text people paste, select, or upload, and optionally an
API key. The things most worth reporting:

- **Text reaching a network** on the default path. The extension is supposed to
  run entirely on device unless the user configures their own API key. Any path
  that sends text somewhere else is a serious bug.
- **The sensitive-field guard being bypassed.** Password, card number, and
  one-time-code fields must never be captured, through any entry point (chip,
  right click, or keyboard shortcut).
- **API key exposure.** Keys live in `chrome.storage.local`, are never synced,
  and must never appear in a log, an error message, or a request to anywhere
  other than the endpoint the user configured.
- **Page text being modified without consent.** Scanning must never change a
  character of a page, and Apply must never write over text it cannot verify.
- **Malicious file handling.** The `.docx` reader parses untrusted archives by
  hand. Crashes, hangs, or resource exhaustion from a crafted file are in scope.

## What is not in scope

- The quality of a rewrite, or whether some AI detector flags the output. This
  extension does not claim to defeat detectors.
- Behavior of a third-party API endpoint a user configures themselves.
- Sites where the extension cannot work by design (canvas editors such as Google
  Docs, cross-origin iframes, shadow DOM editors). These are documented
  limitations, not vulnerabilities.

## Supported versions

The latest release on `main` is supported. This is a young project; older
versions are not patched.
