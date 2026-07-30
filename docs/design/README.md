# Design documents

The specification and implementation plans this extension was built from, in the
order they were written.

These are kept for reference. They record what was intended and why, which is
often more useful than the diff. They are **not** maintained: where a plan and
the code disagree, the code is right, and
[ARCHITECTURE.md](../ARCHITECTURE.md) is the current description of how things
fit together.

## Specification

- [Humanizer Chrome extension design](specs/2026-07-25-humanizer-chrome-extension-design.md)

## Plans

1. [Core engine](plans/2026-07-25-humanizer-extension-core.md), the pipeline and
   the rules layer
2. [Page interaction](plans/2026-07-25-humanizer-extension-page-ux.md), selection
   capture and in-place replacement
3. [Engines](plans/2026-07-26-humanizer-extension-engines.md), on-device Gemini
   Nano and bring-your-own-key providers
4. [Personalization](plans/2026-07-28-second-draft-personalization.md), writing
   samples, custom tells, and content-loss checks
