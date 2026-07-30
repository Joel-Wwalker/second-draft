# Humanizer Extension Core Implementation Plan (Plan 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A loadable Chrome extension whose popup paste box humanizes text through a fully tested engine pipeline (detect → provider → enforce → diff), using the deterministic rules layer plus a fake provider; real providers and in-page UX come in Plan 2.

**Architecture:** WXT + TypeScript MV3 extension. A pure, DOM-free engine module (`src/engine/`) does all text work and is unit-tested with Vitest. The background service worker hosts the engine behind a typed message protocol; the popup is plain DOM. Spec: `docs/design/specs/2026-07-25-humanizer-chrome-extension-design.md`.

**Tech Stack:** WXT, TypeScript (strict), Vitest, @types/chrome, GitHub Actions. Zero production dependencies.

## Global Constraints

- TypeScript `strict: true` and `noUncheckedIndexedAccess: true`; no `any`.
- Zero production dependencies. Dev dependencies only: `wxt`, `typescript`, `vitest`, `@types/chrome`.
- `src/engine/**` and `src/shared/diff.ts` / `types.ts` / `messages.ts` never touch the DOM or `chrome.*`. Only `src/shared/storage.ts` and `src/entrypoints/**` may use `chrome.*`.
- No network requests anywhere in Plan 1 code.
- No em dashes or en dashes in user-visible strings (product copy follows the humanizer skill). Prompt constants and regexes may name/contain the characters; that is their job.
- Manifest: name `Humanizer`, `minimum_chrome_version: '138'`, permissions exactly `['storage']`.
- All commands run from repo root `C:\Users\theag\OneDrive\Desktop\humanizer-extension`. They work in both PowerShell and bash.
- Commit style: conventional commits (`feat:`, `test:`, `chore:`, `ci:`, `docs:`).

## File map (end state of Plan 1)

```
package.json, package-lock.json, tsconfig.json, wxt.config.ts, vitest.config.ts, .gitignore
src/
├── entrypoints/
│   ├── background.ts            # message router hosting the engine
│   └── popup/
│       ├── index.html
│       ├── main.ts
│       └── style.css
├── engine/
│   ├── index.ts                 # humanize() pipeline + stripWrapping()
│   ├── rules.ts                 # RULES, detect(), applyFixes(), tidy(), quotedRegions()
│   ├── prompts.ts               # buildSystemPrompt()
│   └── providers/
│       └── fake.ts              # FakeProvider (test/dev engine)
└── shared/
    ├── types.ts                 # all shared types + HumanizerError
    ├── diff.ts                  # tokenize(), diffChanges()
    ├── messages.ts              # popup <-> background protocol
    └── storage.ts               # typed settings wrapper
tests/
    rules.test.ts, detect-only.test.ts, diff.test.ts, prompts.test.ts, engine.test.ts, storage.test.ts
docs/skill-source/SKILL.md       # vendored humanizer skill + its LICENSE
.github/workflows/ci.yml
README.md, LICENSE
```

Spec items deliberately deferred to Plan 2: content script (chip, card, replacement, per-site disable), context menu, Nano/Anthropic/OpenAI providers, options page, voice sample UI (the engine supports `voiceSample` now), streaming UI, Playwright, store packaging.

---

### Task 1: Scaffold a loadable WXT extension

**Files:**
- Create: `package.json` (via commands), `tsconfig.json`, `wxt.config.ts`, `vitest.config.ts`, `.gitignore`, `src/entrypoints/popup/index.html`, `src/entrypoints/popup/main.ts`, `src/entrypoints/popup/style.css`

**Interfaces:**
- Consumes: nothing.
- Produces: a repo where `npm run build`, `npm run typecheck`, and `npm test` all succeed; popup entrypoint exists for Task 7 to fill in.

Config task: verification is the build output, not a unit test.

- [ ] **Step 1: Create `.gitignore`**

```gitignore
node_modules/
.output/
.wxt/
*.log
.env*
```

- [ ] **Step 2: Init npm and install dev dependencies**

Run: `npm init -y`
Then: `npm i -D wxt typescript vitest @types/chrome`
Expected: `package.json` and `package-lock.json` exist; install exits 0. (`wxt prepare` may run and create `.wxt/`; if not, the postinstall script added next will.)

- [ ] **Step 3: Set package.json fields and scripts**

Edit `package.json` so these fields are exactly (keep the generated `devDependencies` block):

```json
{
  "name": "humanizer-extension",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wxt",
    "build": "wxt build",
    "zip": "wxt zip",
    "postinstall": "wxt prepare",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  }
}
```

- [ ] **Step 4: Create `wxt.config.ts`**

```ts
import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'Humanizer',
    description: 'Make AI drafts sound like you. Rewrites run on your device.',
    minimum_chrome_version: '138',
    permissions: ['storage'],
  },
});
```

- [ ] **Step 5: Create `tsconfig.json` and `vitest.config.ts`**

`tsconfig.json`:

```json
{
  "extends": "./.wxt/tsconfig.json",
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "types": ["chrome"]
  },
  "include": [".wxt/wxt.d.ts", "src/**/*", "tests/**/*", "wxt.config.ts", "vitest.config.ts"]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/**/*.test.ts'] },
});
```

Run: `npx wxt prepare`
Expected: `.wxt/tsconfig.json` exists (the extends target).

- [ ] **Step 6: Create the popup shell**

`src/entrypoints/popup/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Humanizer</title>
    <link rel="stylesheet" href="./style.css" />
  </head>
  <body>
    <h1>Humanizer</h1>
    <p id="status" class="muted">Popup shell. Engine arrives in Task 7.</p>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

`src/entrypoints/popup/main.ts`:

```ts
console.log('[humanizer] popup loaded');
```

`src/entrypoints/popup/style.css`:

```css
body { width: 420px; margin: 0; padding: 12px; font: 14px/1.4 system-ui, sans-serif; }
h1 { font-size: 16px; margin: 0 0 8px; }
textarea { width: 100%; box-sizing: border-box; resize: vertical; font: inherit; }
button { font: inherit; padding: 4px 12px; }
.row { display: flex; gap: 8px; align-items: center; justify-content: space-between; margin: 8px 0; }
.muted { color: #666; font-size: 12px; }
```

- [ ] **Step 7: Verify build, typecheck, and empty test run**

Run: `npm run build`
Expected: exits 0; `.output/chrome-mv3/manifest.json` exists and contains `"name": "Humanizer"` and `"minimum_chrome_version": "138"`.

Run: `npm run typecheck`
Expected: exits 0, no output.

Run: `npm test`
Expected: exits 0 with "no test files found" (passWithNoTests is not set; if vitest exits 1 for zero files, add `passWithNoTests: true` inside the `test` block of `vitest.config.ts` and keep it there).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold WXT + TypeScript strict + Vitest with loadable popup shell"
```

---

### Task 2: Shared types and the fixable rules layer

**Files:**
- Create: `src/shared/types.ts`, `src/engine/rules.ts`
- Test: `tests/rules.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (used by every later task):
  - `types.ts`: `Intensity = 'light' | 'full'`; `Span { start: number; end: number }`; `DetectedTell { ruleId: string; span: Span; excerpt: string; reason: string }`; `Change { range: Span; ruleId?: string; reason: string }`; `EngineKind = 'nano' | 'byok' | 'rules' | 'fake'`; `EngineInfo { kind: EngineKind; model?: string }`; `HumanizeOptions { intensity: Intensity; voiceSample?: string; signal?: AbortSignal; onChunk?: (textSoFar: string) => void }`; `HumanizeResult { rewritten: string; changes: Change[]; engine: EngineInfo }`; `RewriteRequest { text: string; systemPrompt: string; signal?: AbortSignal; onChunk?: (textSoFar: string) => void }`; `Provider { info: EngineInfo; available(): Promise<boolean>; rewrite(req: RewriteRequest): Promise<string> }`; `HumanizerErrorKind = 'nano-unavailable' | 'nano-downloading' | 'byok-auth' | 'byok-rate-limit' | 'network' | 'too-long' | 'aborted' | 'replace-failed' | 'internal'`; `class HumanizerError extends Error { kind: HumanizerErrorKind }`.
  - `rules.ts`: `interface Rule`, `const RULES: Rule[]`, `detect(text: string): DetectedTell[]`, `applyFixes(text: string): string`, `tidy(text: string): string`, `quotedRegions(text: string): Span[]`.

- [ ] **Step 1: Write the failing tests**

`tests/rules.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { applyFixes, detect } from '../src/engine/rules';

describe('applyFixes', () => {
  test('replaces em dashes with commas', () => {
    expect(applyFixes('The plan—announced late—failed.')).toBe('The plan, announced late, failed.');
  });

  test('writes out numeric en dash ranges', () => {
    expect(applyFixes('It ran 1990–1995.')).toBe('It ran 1990 to 1995.');
  });

  test('straightens curly quotes and apostrophes', () => {
    expect(applyFixes('He said “fine” and left.')).toBe('He said "fine" and left.');
    expect(applyFixes('don’t')).toBe("don't");
  });

  test('replaces spaced double hyphens', () => {
    expect(applyFixes('The changes -- long overdue -- landed.')).toBe('The changes, long overdue, landed.');
  });

  test('strips emoji', () => {
    expect(applyFixes('Launch 🚀 ready ✅ now')).toBe('Launch ready now');
  });

  test('removes chatbot sign-offs', () => {
    expect(applyFixes('Here is the summary. I hope this helps! Let me know if you need more.'))
      .toBe('Here is the summary.');
  });

  test('leaves em dashes inside quotes alone', () => {
    expect(applyFixes('He wrote "wait — really?" and left.')).toBe('He wrote "wait — really?" and left.');
  });
});

describe('detect', () => {
  test('reports em dashes with rule id and span', () => {
    const tells = detect('A—B');
    expect(tells).toHaveLength(1);
    expect(tells[0]).toMatchObject({ ruleId: 'em-dash', span: { start: 1, end: 2 } });
  });

  test('skips quoted regions for skipQuoted rules', () => {
    const tells = detect('say "A—B" now');
    expect(tells.filter(t => t.ruleId === 'em-dash')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/rules.test.ts`
Expected: FAIL, cannot resolve `../src/engine/rules`.

- [ ] **Step 3: Create `src/shared/types.ts`**

```ts
export type Intensity = 'light' | 'full';

export interface Span {
  start: number;
  end: number;
}

export interface DetectedTell {
  ruleId: string;
  span: Span;
  excerpt: string;
  reason: string;
}

export interface Change {
  /** Indexes into the rewritten text. */
  range: Span;
  ruleId?: string;
  reason: string;
}

export type EngineKind = 'nano' | 'byok' | 'rules' | 'fake';

export interface EngineInfo {
  kind: EngineKind;
  /** e.g. "claude-sonnet-5"; lets the UI name the model. */
  model?: string;
}

export interface HumanizeOptions {
  intensity: Intensity;
  voiceSample?: string;
  signal?: AbortSignal;
  /** Called with the full text so far as the provider streams. Provisional display only. */
  onChunk?: (textSoFar: string) => void;
}

export interface HumanizeResult {
  rewritten: string;
  changes: Change[];
  engine: EngineInfo;
}

export interface RewriteRequest {
  text: string;
  systemPrompt: string;
  signal?: AbortSignal;
  onChunk?: (textSoFar: string) => void;
}

export interface Provider {
  readonly info: EngineInfo;
  available(): Promise<boolean>;
  rewrite(req: RewriteRequest): Promise<string>;
}

export type HumanizerErrorKind =
  | 'nano-unavailable'
  | 'nano-downloading'
  | 'byok-auth'
  | 'byok-rate-limit'
  | 'network'
  | 'too-long'
  | 'aborted'
  | 'replace-failed'
  | 'internal';

export class HumanizerError extends Error {
  constructor(readonly kind: HumanizerErrorKind, message?: string) {
    super(message ?? kind);
    this.name = 'HumanizerError';
  }
}
```

- [ ] **Step 4: Create `src/engine/rules.ts`**

The fixable rules run in array order inside `applyFixes` (order matters: en dash ranges before the generic dash rule). Detect-only rules are added in Task 3; the array keeps one shape for both.

```ts
import type { DetectedTell, Span } from '../shared/types';

export interface Rule {
  id: string;
  reason: string;
  /** Must have the g flag (and u where needed). */
  pattern: RegExp;
  fixable: boolean;
  /** Leave matches inside "..." or “...” untouched. */
  skipQuoted?: boolean;
  /** Heuristics only get mentioned to the model when repeated this often. */
  minCountForPrompt?: number;
  replacement?: (match: string) => string;
}

export const RULES: Rule[] = [
  {
    id: 'curly-quote-double',
    reason: 'Curly quotes replaced with straight quotes',
    pattern: /[“”]/g,
    fixable: true,
    replacement: () => '"',
  },
  {
    id: 'curly-quote-single',
    reason: 'Curly apostrophe replaced',
    pattern: /[‘’]/g,
    fixable: true,
    replacement: () => "'",
  },
  {
    id: 'en-dash-range',
    reason: 'En dash range written out',
    pattern: /(\d) ?– ?(?=\d)/g,
    fixable: true,
    skipQuoted: true,
    replacement: match => match.replace(/ ?– ?/, ' to '),
  },
  {
    id: 'em-dash',
    reason: 'Em dash removed (AI tell)',
    pattern: /[ \t]*[—–][ \t]*/g,
    fixable: true,
    skipQuoted: true,
    replacement: () => ', ',
  },
  {
    id: 'double-hyphen',
    reason: 'Double hyphen removed',
    pattern: /[ \t]+--[ \t]+/g,
    fixable: true,
    skipQuoted: true,
    replacement: () => ', ',
  },
  {
    id: 'emoji',
    reason: 'Emoji removed',
    pattern: /[ \t]?\p{Extended_Pictographic}(?:[\p{Extended_Pictographic}\u{FE0F}\u{200D}])*[ \t]?/gu,
    fixable: true,
    replacement: () => ' ',
  },
  {
    id: 'chatbot-signoff',
    reason: 'Chatbot filler removed',
    pattern: /\b(?:I hope this helps|Let me know if [^.!?\n]*|Would you like me to [^.!?\n]*)[.!?]?[ \t]*/gi,
    fixable: true,
    replacement: () => '',
  },
];

export function quotedRegions(text: string): Span[] {
  const spans: Span[] = [];
  const re = /"[^"\n]{1,300}"|“[^”\n]{1,300}”/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    spans.push({ start: m.index, end: m.index + m[0].length });
  }
  return spans;
}

function intersects(a: Span, b: Span): boolean {
  return a.start < b.end && b.start < a.end;
}

export function detect(text: string): DetectedTell[] {
  const quoted = quotedRegions(text);
  const tells: DetectedTell[] = [];
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    for (let m = rule.pattern.exec(text); m; m = rule.pattern.exec(text)) {
      const span: Span = { start: m.index, end: m.index + m[0].length };
      if (m[0].length === 0) {
        rule.pattern.lastIndex++;
        continue;
      }
      if (rule.skipQuoted && quoted.some(q => intersects(span, q))) continue;
      tells.push({ ruleId: rule.id, span, excerpt: m[0].trim(), reason: rule.reason });
    }
  }
  return tells.sort((a, b) => a.span.start - b.span.start);
}

export function applyFixes(text: string): string {
  let out = text;
  for (const rule of RULES) {
    if (!rule.fixable || !rule.replacement) continue;
    const quoted = rule.skipQuoted ? quotedRegions(out) : [];
    rule.pattern.lastIndex = 0;
    out = out.replace(rule.pattern, (match, ...rest) => {
      const offset = rest[rest.length - 2] as number;
      const span: Span = { start: offset, end: offset + match.length };
      if (quoted.some(q => intersects(span, q))) return match;
      return rule.replacement!(match);
    });
  }
  return tidy(out);
}

/** Cleanup after mechanical replacements. */
export function tidy(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ ([,.;:!?])/g, '$1')
    .replace(/, *,/g, ',')
    .replace(/^[ \t]+|[ \t]+$/gm, '');
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/rules.test.ts`
Expected: PASS (9 tests). Also run `npm run typecheck`, expected exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/engine/rules.ts tests/rules.test.ts
git commit -m "feat: shared types and fixable rules layer (dashes, quotes, emoji, chatbot filler)"
```

---

### Task 3: Detect-only rules

**Files:**
- Modify: `src/engine/rules.ts` (append to `RULES`)
- Test: `tests/detect-only.test.ts`

**Interfaces:**
- Consumes: `RULES`, `detect` from Task 2.
- Produces: detect-only rule ids `'ai-vocab' | 'negative-parallelism' | 'rule-of-three' | 'title-case-heading' | 'bold-header-list'` (Task 5's prompt builder and Task 4's attribution rely on these ids existing in `RULES`).

- [ ] **Step 1: Write the failing tests**

`tests/detect-only.test.ts`:

```ts
import { expect, test } from 'vitest';
import { detect } from '../src/engine/rules';

test('flags AI vocabulary', () => {
  const tells = detect('We delve into the intricate interplay.');
  expect(tells.filter(t => t.ruleId === 'ai-vocab')).toHaveLength(3);
});

test('flags negative parallelism', () => {
  const tells = detect('It is not just fast but also cheap.');
  expect(tells.some(t => t.ruleId === 'negative-parallelism')).toBe(true);
});

test('flags rule-of-three lists', () => {
  const tells = detect('We ship talks, panels, and demos. We value speed, quality, and trust.');
  expect(tells.filter(t => t.ruleId === 'rule-of-three')).toHaveLength(2);
});

test('flags title-case markdown headings', () => {
  const tells = detect('## Strategic Negotiations And Global Partnerships\nBody text.');
  expect(tells.some(t => t.ruleId === 'title-case-heading')).toBe(true);
});

test('flags bolded inline-header list items', () => {
  const tells = detect('- **Performance:** faster now');
  expect(tells.some(t => t.ruleId === 'bold-header-list')).toBe(true);
});

test('does not flag plain prose', () => {
  expect(detect('The report is ready and the team approved it.')).toHaveLength(0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/detect-only.test.ts`
Expected: FAIL (0 tells found for the new rule ids).

- [ ] **Step 3: Append detect-only rules to `RULES` in `src/engine/rules.ts`**

Add these entries to the end of the `RULES` array:

```ts
  {
    id: 'ai-vocab',
    reason: 'AI-associated vocabulary',
    pattern:
      /\b(?:delve(?:s|d)?|tapestry|testament to|underscor(?:es?|ing)|showcas(?:es?|ing)|pivotal|crucial|vibrant|foster(?:s|ing)?|garner(?:s|ed)?|interplay|intricate|intricacies|enduring|moreover|furthermore|additionally|aligns? with|(?:key|vital) (?:role|moment|factor|aspect))\b/gi,
    fixable: false,
  },
  {
    id: 'negative-parallelism',
    reason: 'Negative parallelism (not just X, but Y)',
    pattern: /\bnot (?:just|only|merely)\b[^.!?\n]{0,80}\bbut\b/gi,
    fixable: false,
  },
  {
    id: 'rule-of-three',
    reason: 'Possible rule-of-three cadence',
    pattern: /\b[\w'’-]+, [\w'’-]+, and [\w'’-]+\b/g,
    fixable: false,
    minCountForPrompt: 2,
  },
  {
    id: 'title-case-heading',
    reason: 'Title-case heading',
    pattern: /^#{1,6} (?:[A-Z][\w'’-]* ){2,}[A-Z][\w'’-]*[ \t]*$/gm,
    fixable: false,
  },
  {
    id: 'bold-header-list',
    reason: 'Bolded inline-header list item',
    pattern: /^[ \t]*[-*•] \*\*[^*\n]+:?\*\*/gm,
    fixable: false,
  },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/detect-only.test.ts tests/rules.test.ts`
Expected: PASS (all 15). The Task 2 suite must still pass (detect-only rules have no `replacement`, so `applyFixes` output is unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/engine/rules.ts tests/detect-only.test.ts
git commit -m "feat: detect-only rules (AI vocab, parallelism, rule of three, headings, bold lists)"
```

---

### Task 4: Word-level diff with tell attribution

**Files:**
- Create: `src/shared/diff.ts`
- Test: `tests/diff.test.ts`

**Interfaces:**
- Consumes: `Change`, `DetectedTell`, `Span` from `src/shared/types.ts`; `detect` (tests only).
- Produces: `tokenize(text: string): Token[]` where `Token { text: string; start: number; end: number }`, and `diffChanges(before: string, after: string, tells: DetectedTell[]): Change[]` (Task 6's pipeline calls this; `Change.range` indexes `after`).

- [ ] **Step 1: Write the failing tests**

`tests/diff.test.ts`:

```ts
import { expect, test } from 'vitest';
import { diffChanges, tokenize } from '../src/shared/diff';
import { detect } from '../src/engine/rules';

test('tokenize records char offsets', () => {
  expect(tokenize('ab  cd')[1]).toMatchObject({ text: 'cd', start: 4, end: 6 });
});

test('identical texts produce no changes', () => {
  expect(diffChanges('same text', 'same text', [])).toEqual([]);
});

test('single word replacement yields one Reworded change over the new word', () => {
  const after = 'a X c d';
  const changes = diffChanges('a b c d', after, []);
  expect(changes).toHaveLength(1);
  expect(changes[0]).toMatchObject({ reason: 'Reworded' });
  expect(after.slice(changes[0]!.range.start, changes[0]!.range.end)).toBe('X');
});

test('changes overlapping a detected tell inherit its rule id and reason', () => {
  const before = 'We delve into the plan.';
  const changes = diffChanges(before, 'We dig into the plan.', detect(before));
  expect(changes).toHaveLength(1);
  expect(changes[0]).toMatchObject({ ruleId: 'ai-vocab', reason: 'AI-associated vocabulary' });
});

test('pure deletion yields a zero-width change', () => {
  const changes = diffChanges('keep this extra part', 'keep this', []);
  expect(changes).toHaveLength(1);
  expect(changes[0]!.range.start).toBe(changes[0]!.range.end);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/diff.test.ts`
Expected: FAIL, cannot resolve `../src/shared/diff`.

- [ ] **Step 3: Create `src/shared/diff.ts`**

LCS on word tokens with common prefix/suffix trimming. If the trimmed middle would exceed the cell cap, degrade to one whole-region "Rewritten" change instead of burning memory.

```ts
import type { Change, DetectedTell, Span } from './types';

export interface Token {
  text: string;
  start: number;
  end: number;
}

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const re = /\S+/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    tokens.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return tokens;
}

const MAX_CELLS = 4_000_000;

export function diffChanges(before: string, after: string, tells: DetectedTell[]): Change[] {
  if (before === after) return [];
  const a = tokenize(before);
  const b = tokenize(after);

  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix]!.text === b[prefix]!.text) prefix++;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix]!.text === b[b.length - 1 - suffix]!.text
  ) {
    suffix++;
  }

  const aMid = a.slice(prefix, a.length - suffix);
  const bMid = b.slice(prefix, b.length - suffix);
  if (aMid.length === 0 && bMid.length === 0) return [];

  // Anchor for zero-width ranges when one side of a region is empty.
  const anchorB = (index: number): number => {
    const token = bMid[index];
    if (token) return token.start;
    const prev = bMid[bMid.length - 1] ?? b[prefix - 1];
    return prev ? prev.end : 0;
  };
  const anchorA = (index: number): number => {
    const token = aMid[index];
    if (token) return token.start;
    const prev = aMid[aMid.length - 1] ?? a[prefix - 1];
    return prev ? prev.end : 0;
  };

  if (aMid.length * bMid.length > MAX_CELLS) {
    const range: Span =
      bMid.length > 0
        ? { start: bMid[0]!.start, end: bMid[bMid.length - 1]!.end }
        : { start: anchorB(0), end: anchorB(0) };
    return [{ range, reason: 'Rewritten' }];
  }

  const regions = groupRegions(lcsOps(aMid, bMid));
  return regions.map(r => {
    const bSpan: Span =
      r.bStart < r.bEnd
        ? { start: bMid[r.bStart]!.start, end: bMid[r.bEnd - 1]!.end }
        : { start: anchorB(r.bStart), end: anchorB(r.bStart) };
    const aSpan: Span =
      r.aStart < r.aEnd
        ? { start: aMid[r.aStart]!.start, end: aMid[r.aEnd - 1]!.end }
        : { start: anchorA(r.aStart), end: anchorA(r.aStart) };
    const tell = tells.find(t => t.span.start < aSpan.end && aSpan.start < t.span.end);
    return tell
      ? { range: bSpan, ruleId: tell.ruleId, reason: tell.reason }
      : { range: bSpan, reason: 'Reworded' };
  });
}

type OpType = 'equal' | 'delete' | 'insert';

function lcsOps(a: Token[], b: Token[]): OpType[] {
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const len = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      len[i * width + j] =
        a[i]!.text === b[j]!.text
          ? len[(i + 1) * width + j + 1]! + 1
          : Math.max(len[(i + 1) * width + j]!, len[i * width + j + 1]!);
    }
  }
  const ops: OpType[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i]!.text === b[j]!.text) {
      ops.push('equal');
      i++;
      j++;
    } else if (len[(i + 1) * width + j]! >= len[i * width + j + 1]!) {
      ops.push('delete');
      i++;
    } else {
      ops.push('insert');
      j++;
    }
  }
  while (i < n) {
    ops.push('delete');
    i++;
  }
  while (j < m) {
    ops.push('insert');
    j++;
  }
  return ops;
}

interface Region {
  aStart: number;
  aEnd: number;
  bStart: number;
  bEnd: number;
}

function groupRegions(ops: OpType[]): Region[] {
  const regions: Region[] = [];
  let i = 0;
  let j = 0;
  let current: Region | null = null;
  for (const op of ops) {
    if (op === 'equal') {
      current = null;
      i++;
      j++;
      continue;
    }
    if (!current) {
      current = { aStart: i, aEnd: i, bStart: j, bEnd: j };
      regions.push(current);
    }
    if (op === 'delete') current.aEnd = ++i;
    else current.bEnd = ++j;
  }
  return regions;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/diff.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/diff.ts tests/diff.test.ts
git commit -m "feat: word-level diff with detected-tell attribution"
```

---

### Task 5: Prompt builder

**Files:**
- Create: `src/engine/prompts.ts`
- Test: `tests/prompts.test.ts`

**Interfaces:**
- Consumes: `DetectedTell`, `Intensity` from types; `RULES` from rules (for `minCountForPrompt`).
- Produces: `buildSystemPrompt(opts: { intensity: Intensity; tells: DetectedTell[]; voiceSample?: string; target: 'nano' | 'byok' }): string` (Task 6 calls this).

- [ ] **Step 1: Write the failing tests**

`tests/prompts.test.ts`:

```ts
import { expect, test } from 'vitest';
import { buildSystemPrompt } from '../src/engine/prompts';
import { detect } from '../src/engine/rules';

const tells = detect('We delve—deeply.');

test('light prompt lists detected tells and the output contract', () => {
  const p = buildSystemPrompt({ intensity: 'light', tells, target: 'nano' });
  expect(p).toContain('Output only the rewritten text');
  expect(p).toContain('em dash');
  expect(p).toContain('Change as little as possible');
});

test('full prompt includes pattern guidance that light omits', () => {
  const light = buildSystemPrompt({ intensity: 'light', tells, target: 'nano' });
  const full = buildSystemPrompt({ intensity: 'full', tells, target: 'nano' });
  expect(full).toContain('rule of three');
  expect(light).not.toContain('rule of three');
});

test('nano prompts stay under the size budget even with a huge voice sample', () => {
  const p = buildSystemPrompt({
    intensity: 'full',
    tells,
    voiceSample: 'word '.repeat(2000),
    target: 'nano',
  });
  expect(p.length).toBeLessThan(6000);
});

test('voice sample is included when provided', () => {
  const p = buildSystemPrompt({ intensity: 'full', tells, voiceSample: 'My own words here.', target: 'byok' });
  expect(p).toContain('My own words here.');
});

test('heuristic tells respect minCountForPrompt', () => {
  const one = detect('We value speed, quality, and trust.');
  const p = buildSystemPrompt({ intensity: 'full', tells: one, target: 'byok' });
  expect(p).not.toContain('Detected in this text');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/prompts.test.ts`
Expected: FAIL, cannot resolve `../src/engine/prompts`.

- [ ] **Step 3: Create `src/engine/prompts.ts`**

```ts
import type { DetectedTell, Intensity } from '../shared/types';
import { RULES } from './rules';

const TELL_NAMES: Record<string, string> = {
  'em-dash': 'em dash',
  'en-dash-range': 'en dash range',
  'double-hyphen': 'double hyphen',
  'curly-quote-double': 'curly quotes',
  'curly-quote-single': 'curly apostrophe',
  emoji: 'emoji',
  'chatbot-signoff': 'chatbot filler phrase',
  'ai-vocab': 'AI-associated word',
  'negative-parallelism': 'negative parallelism',
  'rule-of-three': 'rule of three list',
  'title-case-heading': 'title-case heading',
  'bold-header-list': 'bolded list header',
};

const CONTRACT =
  'Rewrite the text the user sends. Output only the rewritten text: no preamble, no explanation, ' +
  'no quotes around it, no code fences. Preserve the meaning, approximate length, paragraph breaks, ' +
  'and all facts. Never use em dashes or en dashes anywhere in the output.';

const LIGHT_CORE = `${CONTRACT}
Change as little as possible. Only fix these AI tells where they appear:
- Replace every em dash and en dash with a comma, period, or colon.
- Replace AI-flavored words (delve, tapestry, testament, underscore, showcase, pivotal, crucial, vibrant, foster, garner, interplay, intricate, enduring, moreover, furthermore, additionally) with plain everyday words.
- Remove chatbot filler such as "I hope this helps" or "Would you like me to".
- Straighten curly quotes and remove emoji.
Keep everything else exactly as written.`;

const FULL_CORE = `${CONTRACT}
Rewrite so the text reads like a person wrote it, keeping the meaning and register:
- Cut significance inflation (stands as, testament to, pivotal moment, underscores).
- Cut promotional tone (vibrant, breathtaking, nestled, renowned, must-visit).
- Drop tacked-on "-ing" analysis clauses (highlighting, showcasing, reflecting).
- Replace vague attributions (experts argue, observers note) with direct statements.
- Prefer plain is/are/has over serves as, boasts, features.
- Unwind negative parallelisms (not just X but Y) into direct claims.
- Break up forced rule of three lists; two items or four are fine.
- Do not cycle synonyms; repeating the natural word is fine.
- Remove false ranges (from X to Y) that are not real scales.
- No runs of short dramatic fragments; vary sentence length naturally.
- No aphorism formulas (X is the Y of Z).
- No signposting (let's dive in, here's what you need to know).
- No fake-candid openers (Honestly? Look. Here's the thing.).
- Trim hedging and filler (in order to, it is important to note that).
- End without a generic upbeat conclusion.
- Replace AI-flavored words (delve, tapestry, testament, pivotal, crucial, vibrant, interplay, intricate) with plain ones.
- Replace every em dash and en dash. Straighten curly quotes. No emoji.`;

const VOICE_WORD_LIMIT = { nano: 350, byok: 2000 } as const;

export interface PromptOptions {
  intensity: Intensity;
  tells: DetectedTell[];
  voiceSample?: string;
  target: 'nano' | 'byok';
}

export function buildSystemPrompt(opts: PromptOptions): string {
  const parts = [opts.intensity === 'light' ? LIGHT_CORE : FULL_CORE];
  const summary = tellSummary(opts.tells);
  if (summary) {
    parts.push(`Detected in this text: ${summary}. Fix these along with anything else you find.`);
  }
  const sample = opts.voiceSample?.trim();
  if (sample) {
    const words = sample.split(/\s+/).slice(0, VOICE_WORD_LIMIT[opts.target]);
    parts.push(`Match the voice of this writing sample from the author:\n${words.join(' ')}`);
  }
  return parts.join('\n\n');
}

function tellSummary(tells: DetectedTell[]): string {
  const counts = new Map<string, number>();
  for (const tell of tells) counts.set(tell.ruleId, (counts.get(tell.ruleId) ?? 0) + 1);
  const items: string[] = [];
  for (const [id, count] of counts) {
    const rule = RULES.find(r => r.id === id);
    if (count < (rule?.minCountForPrompt ?? 1)) continue;
    const name = TELL_NAMES[id] ?? id;
    items.push(count > 1 ? `${name} (${count}x)` : name);
  }
  return items.slice(0, 10).join(', ');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/prompts.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/prompts.ts tests/prompts.test.ts
git commit -m "feat: prompt builder with intensity variants, tell summary, voice sample"
```

---

### Task 6: Engine pipeline and fake provider

**Files:**
- Create: `src/engine/providers/fake.ts`, `src/engine/index.ts`
- Test: `tests/engine.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2 to 5 (`detect`, `applyFixes`, `diffChanges`, `buildSystemPrompt`, types).
- Produces:
  - `FakeProvider` class: `new FakeProvider(transform?: (text: string) => string, available = true)`; `info` is `{ kind: 'fake', model: 'fake-echo' }`.
  - `humanize(text: string, opts: HumanizeOptions, deps: { providers: Provider[] }): Promise<HumanizeResult>` and `stripWrapping(raw: string, original: string): string` from `src/engine/index.ts` (Task 7's background imports `humanize`).

- [ ] **Step 1: Write the failing tests**

`tests/engine.test.ts`:

```ts
import { expect, test } from 'vitest';
import { humanize, stripWrapping } from '../src/engine';
import { FakeProvider } from '../src/engine/providers/fake';

test('falls back to rules-only when no provider is available', async () => {
  const res = await humanize('The plan—bold.', { intensity: 'light' }, { providers: [] });
  expect(res.engine.kind).toBe('rules');
  expect(res.rewritten).toBe('The plan, bold.');
  expect(res.changes[0]).toMatchObject({ ruleId: 'em-dash' });
});

test('uses the provider and enforces surviving em dashes', async () => {
  const fake = new FakeProvider(t => t.replace(/\bdelve\b/g, 'dig') + ' — done');
  const res = await humanize('We delve here', { intensity: 'full' }, { providers: [fake] });
  expect(res.engine).toMatchObject({ kind: 'fake', model: 'fake-echo' });
  expect(res.rewritten).toBe('We dig here, done');
});

test('skips unavailable providers and falls back to rules', async () => {
  const down = new FakeProvider(t => t, false);
  const res = await humanize('A—B', { intensity: 'light' }, { providers: [down] });
  expect(res.engine.kind).toBe('rules');
});

test('throws too-long for oversized input', async () => {
  await expect(
    humanize('x'.repeat(50_001), { intensity: 'light' }, { providers: [] }),
  ).rejects.toMatchObject({ kind: 'too-long' });
});

test('throws aborted when the signal is already aborted', async () => {
  const ctl = new AbortController();
  ctl.abort();
  await expect(
    humanize('hi there', { intensity: 'light', signal: ctl.signal }, { providers: [] }),
  ).rejects.toMatchObject({ kind: 'aborted' });
});

test('stripWrapping removes preambles, fences, and wrapper quotes', () => {
  expect(stripWrapping('Here is the rewritten text:\nClean.', 'orig')).toBe('Clean.');
  expect(stripWrapping('```\nClean.\n```', 'orig')).toBe('Clean.');
  expect(stripWrapping('"Clean."', 'orig')).toBe('Clean.');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/engine.test.ts`
Expected: FAIL, cannot resolve `../src/engine` and `../src/engine/providers/fake`.

- [ ] **Step 3: Create `src/engine/providers/fake.ts`**

```ts
import type { EngineInfo, Provider, RewriteRequest } from '../../shared/types';
import { HumanizerError } from '../../shared/types';

/** Deterministic stand-in for a model. Used by tests and the dev/e2e builds. */
export class FakeProvider implements Provider {
  readonly info: EngineInfo = { kind: 'fake', model: 'fake-echo' };

  constructor(
    private readonly transform: (text: string) => string = defaultTransform,
    private readonly isAvailable = true,
  ) {}

  available(): Promise<boolean> {
    return Promise.resolve(this.isAvailable);
  }

  rewrite(req: RewriteRequest): Promise<string> {
    if (req.signal?.aborted) throw new HumanizerError('aborted');
    const out = this.transform(req.text);
    req.onChunk?.(out);
    return Promise.resolve(out);
  }
}

export function defaultTransform(text: string): string {
  return text.replace(/\bdelve into\b/gi, 'dig into').replace(/\bdelve\b/gi, 'dig');
}
```

- [ ] **Step 4: Create `src/engine/index.ts`**

```ts
import type { HumanizeOptions, HumanizeResult, Provider } from '../shared/types';
import { HumanizerError } from '../shared/types';
import { diffChanges } from '../shared/diff';
import { applyFixes, detect } from './rules';
import { buildSystemPrompt } from './prompts';

const MAX_INPUT_CHARS = 50_000;

export interface EngineDeps {
  /** Ordered by preference; first available provider wins. */
  providers: Provider[];
}

export async function humanize(
  text: string,
  opts: HumanizeOptions,
  deps: EngineDeps,
): Promise<HumanizeResult> {
  throwIfAborted(opts.signal);
  if (text.length > MAX_INPUT_CHARS) {
    throw new HumanizerError('too-long', `Input is ${text.length} chars; max is ${MAX_INPUT_CHARS}.`);
  }

  const tells = detect(text);
  const provider = await firstAvailable(deps.providers);

  if (!provider) {
    const rewritten = applyFixes(text);
    return { rewritten, changes: diffChanges(text, rewritten, tells), engine: { kind: 'rules' } };
  }

  const systemPrompt = buildSystemPrompt({
    intensity: opts.intensity,
    tells,
    voiceSample: opts.voiceSample,
    target: provider.info.kind === 'nano' ? 'nano' : 'byok',
  });

  let raw: string;
  try {
    raw = await provider.rewrite({
      text,
      systemPrompt,
      signal: opts.signal,
      onChunk: opts.onChunk,
    });
  } catch (err) {
    throw err instanceof HumanizerError ? err : new HumanizerError('internal', String(err));
  }

  throwIfAborted(opts.signal);
  const rewritten = applyFixes(stripWrapping(raw, text));
  return { rewritten, changes: diffChanges(text, rewritten, tells), engine: provider.info };
}

/** Models wrap output despite instructions; peel fences, preambles, and quotes. */
export function stripWrapping(raw: string, original: string): string {
  let out = raw.trim();
  const fence = out.match(/^```[a-z]*\n([\s\S]*?)\n?```$/i);
  if (fence) out = fence[1]!.trim();
  out = out.replace(/^here(?:'s| is)[^\n:]{0,60}:\s*/i, '');
  const wrapped = /^"[\s\S]*"$/.test(out) && !/^"[\s\S]*"$/.test(original.trim());
  if (wrapped) out = out.slice(1, -1).trim();
  return out;
}

async function firstAvailable(providers: Provider[]): Promise<Provider | null> {
  for (const provider of providers) {
    if (await provider.available()) return provider;
  }
  return null;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new HumanizerError('aborted');
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run`
Expected: PASS, all suites (rules, detect-only, diff, prompts, engine). Also `npm run typecheck` exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/engine/index.ts src/engine/providers/fake.ts tests/engine.test.ts
git commit -m "feat: engine pipeline (detect, provider, enforce, diff) with fake provider"
```

---

### Task 7: Storage, messaging, background, and the popup paste box

**Files:**
- Create: `src/shared/storage.ts`, `src/shared/messages.ts`, `src/entrypoints/background.ts`
- Modify: `src/entrypoints/popup/index.html`, `src/entrypoints/popup/main.ts`
- Test: `tests/storage.test.ts`

**Interfaces:**
- Consumes: `humanize`, `FakeProvider`, types, from earlier tasks.
- Produces:
  - `storage.ts`: `interface Settings { defaultIntensity: Intensity; useFakeProvider: boolean }`, `DEFAULT_SETTINGS: Settings` (`{ defaultIntensity: 'full', useFakeProvider: false }`), `getSettings(): Promise<Settings>`, `updateSettings(patch: Partial<Settings>): Promise<Settings>`. Stored under the single key `settings` in `chrome.storage.local`.
  - `messages.ts`: `interface HumanizeRequest { type: 'humanize'; text: string; intensity: Intensity }`, `type BackgroundRequest = HumanizeRequest`, `type HumanizeResponse = { ok: true; result: HumanizeResult } | { ok: false; kind: HumanizerErrorKind; message: string }`. Plan 2 extends `BackgroundRequest` with content-script message types.

- [ ] **Step 1: Write the failing storage test**

`tests/storage.test.ts`:

```ts
import { beforeEach, expect, test } from 'vitest';

const store: Record<string, unknown> = {};
(globalThis as Record<string, unknown>)['chrome'] = {
  storage: {
    local: {
      get: async (key: string) => ({ [key]: store[key] }),
      set: async (items: Record<string, unknown>) => {
        Object.assign(store, items);
      },
    },
  },
} as unknown as typeof chrome;

import { DEFAULT_SETTINGS, getSettings, updateSettings } from '../src/shared/storage';

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
});

test('returns defaults when storage is empty', async () => {
  expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
});

test('updateSettings merges a patch and persists it', async () => {
  await updateSettings({ useFakeProvider: true });
  const settings = await getSettings();
  expect(settings.useFakeProvider).toBe(true);
  expect(settings.defaultIntensity).toBe(DEFAULT_SETTINGS.defaultIntensity);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/storage.test.ts`
Expected: FAIL, cannot resolve `../src/shared/storage`.

- [ ] **Step 3: Create `src/shared/storage.ts` and `src/shared/messages.ts`**

`src/shared/storage.ts`:

```ts
import type { Intensity } from './types';

export interface Settings {
  defaultIntensity: Intensity;
  /** Dev/e2e switch: route rewrites through FakeProvider. */
  useFakeProvider: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  defaultIntensity: 'full',
  useFakeProvider: false,
};

const KEY = 'settings';

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(KEY);
  return { ...DEFAULT_SETTINGS, ...(stored[KEY] as Partial<Settings> | undefined) };
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}
```

`src/shared/messages.ts`:

```ts
import type { HumanizeResult, HumanizerErrorKind, Intensity } from './types';

export interface HumanizeRequest {
  type: 'humanize';
  text: string;
  intensity: Intensity;
}

export type BackgroundRequest = HumanizeRequest;

export type HumanizeResponse =
  | { ok: true; result: HumanizeResult }
  | { ok: false; kind: HumanizerErrorKind; message: string };
```

- [ ] **Step 4: Run storage test to verify it passes**

Run: `npx vitest run tests/storage.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Create `src/entrypoints/background.ts`**

`defineBackground` is a WXT auto-import (typed via `.wxt/wxt.d.ts`); do not import it.

```ts
import { humanize } from '../engine';
import { FakeProvider } from '../engine/providers/fake';
import { getSettings } from '../shared/storage';
import { HumanizerError } from '../shared/types';
import type { Provider } from '../shared/types';
import type { BackgroundRequest, HumanizeRequest, HumanizeResponse } from '../shared/messages';

export default defineBackground(() => {
  chrome.runtime.onMessage.addListener(
    (msg: BackgroundRequest, _sender, sendResponse: (res: HumanizeResponse) => void) => {
      if (msg.type !== 'humanize') return;
      void handleHumanize(msg).then(sendResponse);
      return true; // keep the channel open for the async response
    },
  );
});

async function handleHumanize(msg: HumanizeRequest): Promise<HumanizeResponse> {
  try {
    const settings = await getSettings();
    // Real providers (nano, byok) are added in Plan 2; empty means rules-only.
    const providers: Provider[] = settings.useFakeProvider ? [new FakeProvider()] : [];
    const result = await humanize(msg.text, { intensity: msg.intensity }, { providers });
    return { ok: true, result };
  } catch (err) {
    const e = err instanceof HumanizerError ? err : new HumanizerError('internal', String(err));
    console.error('[humanizer]', e.kind, e.message);
    return { ok: false, kind: e.kind, message: e.message };
  }
}
```

- [ ] **Step 6: Replace the popup shell with the paste box UI**

`src/entrypoints/popup/index.html` (full replacement):

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Humanizer</title>
    <link rel="stylesheet" href="./style.css" />
  </head>
  <body>
    <h1>Humanizer</h1>
    <textarea id="input" rows="8" placeholder="Paste text to humanize"></textarea>
    <div class="row">
      <select id="intensity" title="How much to change">
        <option value="light">Light touch</option>
        <option value="full">Full rewrite</option>
      </select>
      <button id="go">Humanize</button>
    </div>
    <p id="status" class="muted"></p>
    <textarea id="output" rows="8" readonly></textarea>
    <div class="row">
      <span id="engine" class="muted"></span>
      <button id="copy" disabled>Copy</button>
    </div>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

`src/entrypoints/popup/main.ts` (full replacement):

```ts
import type { BackgroundRequest, HumanizeResponse } from '../../shared/messages';
import type { Intensity } from '../../shared/types';
import { getSettings, updateSettings } from '../../shared/storage';

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const input = byId<HTMLTextAreaElement>('input');
const output = byId<HTMLTextAreaElement>('output');
const intensity = byId<HTMLSelectElement>('intensity');
const go = byId<HTMLButtonElement>('go');
const copy = byId<HTMLButtonElement>('copy');
const status = byId<HTMLParagraphElement>('status');
const engineLabel = byId<HTMLSpanElement>('engine');

const ENGINE_LABELS: Record<string, string> = {
  rules: 'Quick clean (no AI engine available)',
  nano: 'On-device AI (Gemini Nano)',
  byok: 'Your API key',
  fake: 'Test engine',
};

void init();

async function init(): Promise<void> {
  const settings = await getSettings();
  intensity.value = settings.defaultIntensity;
  intensity.addEventListener('change', () => {
    void updateSettings({ defaultIntensity: intensity.value as Intensity });
  });
  go.addEventListener('click', () => {
    void run();
  });
  copy.addEventListener('click', () => {
    void navigator.clipboard.writeText(output.value);
  });
}

async function run(): Promise<void> {
  const text = input.value.trim();
  if (!text) return;
  go.disabled = true;
  copy.disabled = true;
  status.textContent = 'Rewriting...';
  engineLabel.textContent = '';
  try {
    const req: BackgroundRequest = { type: 'humanize', text, intensity: intensity.value as Intensity };
    const res = (await chrome.runtime.sendMessage(req)) as HumanizeResponse;
    if (res.ok) {
      output.value = res.result.rewritten;
      const label = ENGINE_LABELS[res.result.engine.kind] ?? res.result.engine.kind;
      engineLabel.textContent = res.result.engine.model ? `${label} (${res.result.engine.model})` : label;
      const n = res.result.changes.length;
      status.textContent = `${n} change${n === 1 ? '' : 's'}`;
      copy.disabled = false;
    } else {
      status.textContent = `Error: ${res.message}`;
    }
  } catch (err) {
    status.textContent = `Error: ${String(err)}`;
  } finally {
    go.disabled = false;
  }
}
```

- [ ] **Step 7: Typecheck, test, build**

Run: `npm run typecheck` then `npm test` then `npm run build`
Expected: all exit 0.

- [ ] **Step 8: Manual verification in Chrome**

1. Open `chrome://extensions`, enable Developer mode, "Load unpacked", select `.output/chrome-mv3`.
2. Open the Humanizer popup. Paste: `We delve into the plan—boldly. 🚀 I hope this helps!`
3. Click Humanize. Expected: output has no em dash, no emoji, no "I hope this helps"; engine line reads `Quick clean (no AI engine available)`; status shows a nonzero change count.
4. On the extension's card in `chrome://extensions`, click "service worker" to open its console. Run:
   `chrome.storage.local.set({ settings: { defaultIntensity: 'full', useFakeProvider: true } })`
5. Reopen the popup, paste the same text, click Humanize. Expected: engine line reads `Test engine (fake-echo)` and "delve into" became "dig into".

- [ ] **Step 9: Commit**

```bash
git add src/shared/storage.ts src/shared/messages.ts src/entrypoints/background.ts src/entrypoints/popup tests/storage.test.ts
git commit -m "feat: popup paste box wired to engine via typed background messaging"
```

---

### Task 8: Repo hygiene, attribution, and CI

**Files:**
- Create: `README.md`, `LICENSE`, `docs/skill-source/SKILL.md`, `docs/skill-source/LICENSE`, `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: the sibling clone at `../humanizer` (blader/humanizer) for vendoring.
- Produces: green CI on push; attribution obligations satisfied.

- [ ] **Step 1: Vendor the skill and its license**

Run from repo root:

```bash
mkdir -p docs/skill-source
cp ../humanizer/SKILL.md docs/skill-source/SKILL.md
cp ../humanizer/LICENSE docs/skill-source/LICENSE
```

Expected: both files exist; `docs/skill-source/SKILL.md` starts with `---` frontmatter naming `humanizer` version 2.8.2.

- [ ] **Step 2: Create `LICENSE` (MIT, this repo)**

```text
MIT License

Copyright (c) 2026 Joel Walker

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 3: Create `README.md`**

```markdown
# Humanizer (Chrome extension)

Make AI drafts sound like you. Select text on any page, click Humanize, review
the before/after, apply. Rewrites run on your device by default (Chrome's
built-in Gemini Nano); optionally bring your own API key for higher quality.

Status: in development. Plan 1 (engine + popup paste box) of 2.

## Develop

- `npm install`
- `npm run dev` starts WXT with hot reload
- `npm test` runs unit tests, `npm run typecheck` checks types
- `npm run build` outputs `.output/chrome-mv3` (load unpacked from there)
- `npm run zip` builds the store upload

Design spec: `docs/design/specs/2026-07-25-humanizer-chrome-extension-design.md`

## Attribution

Rewrite patterns derive from [blader/humanizer](https://github.com/blader/humanizer)
SKILL.md v2.8.2 (MIT, vendored at `docs/skill-source/`), based on Wikipedia's
"Signs of AI writing" by WikiProject AI Cleanup.
```

- [ ] **Step 4: Create `.github/workflows/ci.yml`**

```yaml
name: ci
on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run zip
      - uses: actions/upload-artifact@v4
        with:
          name: extension-zip
          path: .output/*.zip
```

- [ ] **Step 5: Verify everything a CI run would do, locally**

Run: `npm ci` (proves package-lock is coherent; reinstalls) then `npm run typecheck && npm test && npm run zip`
Expected: all exit 0; a `.zip` appears under `.output/`.

- [ ] **Step 6: Commit**

```bash
git add README.md LICENSE docs/skill-source .github
git commit -m "docs: README, MIT license, vendored skill attribution; ci: typecheck, test, zip"
```

---

## Spec coverage notes (self-review)

Covered by this plan: repo scaffold and tooling; engine API, pipeline order, provider interface and fallback; fixable + detect-only rules with quoted-text guard; enforce-on-output guarantee; word-diff with reasons; intensity prompt variants; voice sample support in the engine; typed storage; popup paste box with intensity default, engine label, copy; error union with `internal` added to the spec's list (spec's UI table is Plan 2); attribution; CI.

Deferred to Plan 2 (listed in File map above): everything page-facing, real providers, options page, streaming UI, Playwright, packaging. `HumanizeOptions.onChunk` and `RewriteRequest.onChunk` exist now so Plan 2 does not have to change engine signatures.

Known simplifications, intentional: enforce replaces leftover dashes with `', '` uniformly (the model handles nuanced punctuation first); `quotedRegions` only pairs same-line double quotes; the rule-of-three heuristic is detect-only and prompt-gated at 2+ hits.

---

## Post-review amendments (execution record)

The branch's final whole-branch review corrected four defects in code blocks this plan specified verbatim; the shipped code supersedes the blocks above where they differ. See commits `582301f` (strict half-open overlap in diffChanges), `63cf8a9` (tsconfig `types: ["chrome"]`), and `b923dc3` (emoji class narrowed to emoji-presentation, `tidy` preserves indentation and double spaces, `quotedRegions` word-boundary pairing, `stripWrapping` original-had-it guards, CONTRACT leave-quotes clause, popup output clear). The spec's Goal 4 was amended to document the quoted-text exception to the no-dash guarantee.
