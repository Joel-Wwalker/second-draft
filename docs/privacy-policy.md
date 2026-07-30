# Second Draft privacy policy

Last updated: 2026-07-30

Second Draft rewrites text you select to remove signs of AI-generated writing.

## What we collect

Nothing. Second Draft has no servers, no analytics, no telemetry, and no accounts.
The developer never receives your text, your settings, or any usage data.

## Where your text goes

- By default, rewrites run entirely on your device (Chrome's built-in Gemini
  Nano model) or through built-in cleanup rules. Your text never leaves your
  machine.
- If you configure an API key in settings, the text you choose to humanize is
  sent directly from your browser to the provider you configured (for example
  Anthropic or an OpenAI-compatible endpoint), and to no one else, along with
  your writing voice sample if you have set one. Their privacy terms apply to
  that request.
- If a rewrite drops a number, name, date, or quotation, Second Draft asks for
  one more rewrite so it can put them back. On the API-key path that means your
  text is sent to your provider twice for that one request, which also means it
  costs twice as much.

## What is stored

Settings (default intensity, disabled sites, your writing voice sample, any
custom tells you add, and your API key if you add one) are stored in Chrome's
local extension storage on your device.

When you pick Humanize from the right-click menu, the selected text is written to
that same local storage for a moment so the popup can pick it up. The popup
deletes it as soon as it reads it. If the popup never opens, it expires after 60
seconds and is deleted when the tab closes or Chrome restarts, whichever comes
first. Nothing else about your text is kept: the rewrite itself lives only in the
popup window and is gone when you close it.

Nothing is synced or uploaded. Removing the extension deletes all of it.

## Permissions

- The extension has no standing access to the pages you visit. When you choose
  Humanize from the right-click menu or press the shortcut, it injects its page
  script into that one tab, reads the text you selected, and writes the rewrite
  back if you click Apply. It reads nothing else on the page, and nothing at all
  on a site you have turned it off for.
- The optional API-domain permission is requested only when you add an API key,
  and only for the domain you configure.

## Contact

Open an issue on the project repository.
