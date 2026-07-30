# Contributing

Thanks for taking an interest. This is a small project with a deliberately high
bar on tests; everything else is negotiable.

## Getting set up

```bash
npm install
npm run build          # -> .output/chrome-mv3
```

Load `.output/chrome-mv3` as an unpacked extension from `chrome://extensions`
with Developer mode on. `npm run dev` gives you hot reload while you work.

## Before you open a pull request

```bash
npm run typecheck   # must be clean
npm test            # must be green
npm run build       # must succeed
npm run e2e         # after a build; drives a real browser
```

CI runs all four on every push.

## The testing bar

This is the part that matters, and it is stricter than most projects:

**A test that would still pass with its feature deleted does not count as
coverage.** If you add a guard, prove the test bites: break the guard, watch
your named test fail, restore it, watch it pass. Say so in the pull request.
Several real bugs in this repo were found exactly that way, and several
convincing-looking tests turned out to prove nothing.

Alongside that:

- **Assert values, not shapes.** Hand-count what a fixture should produce and
  assert that number. `toBeGreaterThan(0)` is not acceptance.
- **Exercise the real path.** If production inflates compressed bytes, the test
  compresses. If production walks nested DOM, the fixture is nested.
- **Say what you did not cover.** Anything only a human can check belongs in
  `docs/manual-test-matrix.md` as a row, not in a comment as an assumption.

## Code conventions

- TypeScript strict with `noUncheckedIndexedAccess`. No `any`.
- **Zero runtime dependencies.** Dev dependencies are fine; anything shipped to
  users is written here or comes from the platform.
- `src/engine/**` and most of `src/shared/**` must not touch the DOM or
  `chrome.*`. That boundary is why three rewrite engines could be added without
  changing the pipeline. `src/shared/storage.ts` is the deliberate exception.
- No em dashes or en dashes in user-visible strings. The product removes them;
  shipping them would be embarrassing. Regexes and prompt constants that name
  the characters are fine, that is their job.
- Conventional commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`).

## Architecture

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) covers the module boundaries, the
provider interface, the message protocol, and the invariants worth preserving
(never clobber user text, never capture a credential field, never lose content,
enforce in code rather than trusting a prompt).

## Reporting bugs

Use the issue templates. For anything security related, follow
[SECURITY.md](SECURITY.md) instead of opening a public issue.

## Licensing of contributions

By contributing you agree your work is licensed under the AGPL v3 or later, and
that the copyright holder may also offer it under separate commercial terms (see
[COMMERCIAL.md](COMMERCIAL.md)). If that does not work for you, say so in the
pull request and we will figure it out before merging.
