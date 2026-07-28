# Second Draft privacy policy

Last updated: 2026-07-28

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

## What is stored

Settings (default intensity, disabled sites, your writing voice sample, any
custom tells you add, and your API key if you add one) are stored in Chrome's
local extension storage on your device. Nothing is synced or uploaded. Removing the extension deletes it.

## Permissions

- Access to pages you visit is used to show the Humanize button near text you
  select, to replace that text when you click Apply, and, when you click Scan
  this page, to read the page's visible text on your device so the extension can
  count AI tells and underline them. Scanning sends nothing anywhere and never
  changes the page's text.
- The optional API-domain permission is requested only when you add an API key,
  and only for the domain you configure.

## Contact

Open an issue on the project repository.
