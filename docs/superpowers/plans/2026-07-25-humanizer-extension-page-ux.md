# Humanizer Extension Page UX Implementation Plan (Plan 2 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The extension works like the spec's core promise on real pages: select text in any editable field, a Humanize chip appears, the result card streams in with explained highlights, Apply replaces the selection safely, with per-site disable, a context menu, a hardened message protocol, and Playwright e2e coverage. Engines remain rules-only/fake; Nano + BYOK + options are Plan 3.

**Architecture:** Content script split into pure-ish modules (`selection`, `replace`, `chip`, `card`, `session`) with a thin WXT entrypoint. Background gains a validated long-lived-port streaming path alongside the existing one-shot path. All new DOM modules are unit-tested under jsdom; the full in-page flow is covered by Playwright against the built extension with the fake provider.

**Tech Stack:** Existing (WXT, TS strict, Vitest) + dev-only additions: `jsdom` (unit env), `@playwright/test` (e2e). Zero production dependencies, unchanged.

## Global Constraints

- Everything from Plan 1 still binds: TS `strict` + `noUncheckedIndexedAccess`, no `any`; engine/`shared/{types,diff,messages,labels}.ts` never touch DOM or `chrome.*`; no network requests; no em/en dashes in user-visible strings; conventional commits.
- Dev dependencies may now also include exactly: `jsdom`, `@playwright/test`.
- Manifest permissions become exactly `['storage', 'contextMenus', 'activeTab']`; content script matches `['<all_urls>']`. Nothing else.
- Shadow-DOM UI: hosts have ids `humanizer-chip-host` and `humanizer-card-host`, `attachShadow({ mode: 'open' })` (open so Playwright and users can inspect; style isolation is unaffected).
- jsdom test files start with the pragma comment `// @vitest-environment jsdom` on line 1; node stays the default environment.
- All commands run from repo root `C:\Users\theag\OneDrive\Desktop\humanizer-extension`.
- Baseline at start: 39 tests green, `npm run build` green, branch for this plan: `feature/page-ux` off `main`.

## File map (added/changed by Plan 2)

```
src/
├── entrypoints/
│   ├── background.ts        # MODIFIED: validation, port streaming, cancel, context menu
│   ├── content.ts           # NEW: thin WXT entrypoint -> session
│   └── popup/
│       ├── index.html       # MODIFIED: per-site toggle row
│       └── main.ts          # MODIFIED: request id, shared labels, per-site toggle
├── content/
│   ├── selection.ts         # NEW: editable-selection capture
│   ├── replace.ts           # NEW: apply/relocate/never-clobber
│   ├── chip.ts              # NEW: floating Humanize chip
│   ├── card.ts              # NEW: result card (streaming, highlights, buttons)
│   └── session.ts           # NEW: orchestrator (chip<->card<->port<->replace)
└── shared/
    ├── messages.ts          # MODIFIED: v2 protocol + validators + port types
    ├── labels.ts            # NEW: ENGINE_LABELS + engineLabel()
    └── storage.ts           # MODIFIED: disabledSites + helpers
tests/                       # messages, labels+storage additions, selection, replace, chip-card, session
tests-e2e/
    fixtures.ts, serve.mjs, fixtures/page.html, textarea.spec.ts, contenteditable.spec.ts, disable.spec.ts
playwright.config.ts
.github/workflows/ci.yml     # MODIFIED: e2e job steps
```

Deferred to Plan 3 (per spec "Plan 2 must-carry list" where applicable): Nano provider + download UI + chunking, BYOK providers + optional host permissions, options page + voice sample UI, error-string redaction, `firstAvailable` try/catch (lands with first real provider), icons/privacy-policy/store packaging.

---

### Task 1: Protocol v2 (ids, cancel, validation) and streaming background

**Files:**
- Modify: `src/shared/messages.ts` (full replacement), `src/entrypoints/background.ts` (full replacement), `src/entrypoints/popup/main.ts` (one line: request gains `id`)
- Test: `tests/messages.test.ts` (new)

**Interfaces:**
- Consumes: `humanize`, `FakeProvider`, `getSettings`, `HumanizerError`, types (all existing).
- Produces (later tasks rely on): `HumanizeRequest { type:'humanize'; id: string; text: string; intensity: Intensity }`, `CancelRequest { type:'cancel'; id: string }`, `BackgroundRequest` union, `HumanizeResponse` (unchanged shape), `PortServerMessage = { type:'chunk'; id; textSoFar } | { type:'done'; id; result } | { type:'error'; id; kind; message }`, `HUMANIZE_PORT = 'humanize'`, `isHumanizeRequest(msg): msg is HumanizeRequest`, `isCancelRequest(msg): msg is CancelRequest`. Background: one-shot `onMessage` path (popup) + `onConnect` port path (content) sharing `runHumanize`; context-menu item `humanize-selection` that sends `{ type: 'context-humanize' }` to the tab.

- [ ] **Step 1: Write the failing test**

`tests/messages.test.ts`:

```ts
import { expect, test } from 'vitest';
import { isCancelRequest, isHumanizeRequest } from '../src/shared/messages';

test('isHumanizeRequest accepts a valid request', () => {
  expect(isHumanizeRequest({ type: 'humanize', id: 'a1', text: 'hello there', intensity: 'light' })).toBe(true);
});

test('isHumanizeRequest rejects malformed shapes', () => {
  expect(isHumanizeRequest(null)).toBe(false);
  expect(isHumanizeRequest('humanize')).toBe(false);
  expect(isHumanizeRequest({ type: 'humanize', id: 1, text: 't', intensity: 'light' })).toBe(false);
  expect(isHumanizeRequest({ type: 'humanize', id: 'a', text: 't', intensity: 'max' })).toBe(false);
  expect(isHumanizeRequest({ type: 'cancel', id: 'a' })).toBe(false);
});

test('isCancelRequest accepts cancel and rejects others', () => {
  expect(isCancelRequest({ type: 'cancel', id: 'a1' })).toBe(true);
  expect(isCancelRequest({ type: 'cancel' })).toBe(false);
  expect(isCancelRequest({ type: 'humanize', id: 'a1', text: 't', intensity: 'light' })).toBe(false);
});
```

- [ ] **Step 2: Run it, confirm failure**

Run: `npx vitest run tests/messages.test.ts`
Expected: FAIL (isHumanizeRequest/isCancelRequest not exported).

- [ ] **Step 3: Replace `src/shared/messages.ts` entirely**

```ts
import type { HumanizeResult, HumanizerErrorKind, Intensity } from './types';

export interface HumanizeRequest {
  type: 'humanize';
  /** Correlation id; responses and cancels reference it. */
  id: string;
  text: string;
  intensity: Intensity;
}

export interface CancelRequest {
  type: 'cancel';
  id: string;
}

export type BackgroundRequest = HumanizeRequest | CancelRequest;

export type HumanizeResponse =
  | { ok: true; result: HumanizeResult }
  | { ok: false; kind: HumanizerErrorKind; message: string };

/** Streamed over a long-lived port to the content-script card. */
export type PortServerMessage =
  | { type: 'chunk'; id: string; textSoFar: string }
  | { type: 'done'; id: string; result: HumanizeResult }
  | { type: 'error'; id: string; kind: HumanizerErrorKind; message: string };

export const HUMANIZE_PORT = 'humanize';

export function isHumanizeRequest(msg: unknown): msg is HumanizeRequest {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return (
    m['type'] === 'humanize' &&
    typeof m['id'] === 'string' &&
    typeof m['text'] === 'string' &&
    (m['intensity'] === 'light' || m['intensity'] === 'full')
  );
}

export function isCancelRequest(msg: unknown): msg is CancelRequest {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return m['type'] === 'cancel' && typeof m['id'] === 'string';
}
```

- [ ] **Step 4: Replace `src/entrypoints/background.ts` entirely**

```ts
import { humanize } from '../engine';
import { FakeProvider } from '../engine/providers/fake';
import { getSettings } from '../shared/storage';
import { HumanizerError } from '../shared/types';
import type { Intensity, Provider } from '../shared/types';
import { HUMANIZE_PORT, isCancelRequest, isHumanizeRequest } from '../shared/messages';
import type { HumanizeResponse, PortServerMessage } from '../shared/messages';

export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
      id: 'humanize-selection',
      title: 'Humanize selection',
      contexts: ['selection'],
    });
  });

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== 'humanize-selection' || tab?.id === undefined) return;
    void chrome.tabs.sendMessage(tab.id, { type: 'context-humanize' }).catch(() => {
      // No content script in this tab (chrome:// page etc.); nothing to do.
    });
  });

  // One-shot path (popup).
  chrome.runtime.onMessage.addListener(
    (msg: unknown, sender, sendResponse: (res: HumanizeResponse) => void) => {
      if (sender.id !== chrome.runtime.id) return;
      if (!isHumanizeRequest(msg)) return;
      void runHumanize(msg.text, msg.intensity).then(sendResponse).catch(() => {});
      return true; // async response
    },
  );

  // Streaming path (content-script card).
  chrome.runtime.onConnect.addListener(port => {
    if (port.sender?.id !== chrome.runtime.id || port.name !== HUMANIZE_PORT) return;
    const running = new Map<string, AbortController>();

    port.onMessage.addListener((msg: unknown) => {
      if (isCancelRequest(msg)) {
        running.get(msg.id)?.abort();
        running.delete(msg.id);
        return;
      }
      if (!isHumanizeRequest(msg)) return;
      const ctl = new AbortController();
      running.set(msg.id, ctl);
      void runHumanize(msg.text, msg.intensity, ctl.signal, textSoFar => {
        post(port, { type: 'chunk', id: msg.id, textSoFar });
      }).then(res => {
        if (!running.delete(msg.id)) return; // cancelled meanwhile; stay silent
        if (res.ok) post(port, { type: 'done', id: msg.id, result: res.result });
        else post(port, { type: 'error', id: msg.id, kind: res.kind, message: res.message });
      });
    });

    port.onDisconnect.addListener(() => {
      for (const ctl of running.values()) ctl.abort();
      running.clear();
    });
  });
});

function post(port: chrome.runtime.Port, msg: PortServerMessage): void {
  try {
    port.postMessage(msg);
  } catch {
    // Port closed mid-send; the disconnect handler aborts the work.
  }
}

async function runHumanize(
  text: string,
  intensity: Intensity,
  signal?: AbortSignal,
  onChunk?: (textSoFar: string) => void,
): Promise<HumanizeResponse> {
  try {
    const settings = await getSettings();
    // Real providers (nano, byok) land in Plan 3; empty means rules-only.
    const providers: Provider[] = settings.useFakeProvider ? [new FakeProvider()] : [];
    const result = await humanize(text, { intensity, signal, onChunk }, { providers });
    return { ok: true, result };
  } catch (err) {
    const e = err instanceof HumanizerError ? err : new HumanizerError('internal', String(err));
    if (e.kind !== 'aborted') console.error('[humanizer]', e.kind, e.message);
    return { ok: false, kind: e.kind, message: e.message };
  }
}
```

- [ ] **Step 5: Give the popup request an id**

In `src/entrypoints/popup/main.ts`, change the request line inside `run()`:

```ts
    const req: BackgroundRequest = { type: 'humanize', id: crypto.randomUUID(), text, intensity: intensity.value as Intensity };
```

- [ ] **Step 6: Verify**

Run: `npx vitest run tests/messages.test.ts` (3 pass), then `npm run typecheck`, `npm test` (42 total), `npm run build` — all exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/shared/messages.ts src/entrypoints/background.ts src/entrypoints/popup/main.ts tests/messages.test.ts
git commit -m "feat: validated v2 message protocol with ids, cancel, and port streaming"
```

---

### Task 2: Per-site disable storage and shared engine labels

**Files:**
- Modify: `src/shared/storage.ts`, `src/entrypoints/popup/main.ts` (labels import)
- Create: `src/shared/labels.ts`
- Test: `tests/storage.test.ts` (append), `tests/labels.test.ts` (new)

**Interfaces:**
- Produces: `Settings` gains `disabledSites: string[]` (default `[]`); `isSiteDisabled(host: string): Promise<boolean>`; `toggleSiteDisabled(host: string): Promise<Settings>`; `ENGINE_LABELS: Record<string, string>`; `engineLabel(engine: EngineInfo): string`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/storage.test.ts` (inside the existing file, after the current tests; the chrome mock at the top already covers these):

```ts
test('toggleSiteDisabled adds then removes a host', async () => {
  const { isSiteDisabled, toggleSiteDisabled } = await import('../src/shared/storage');
  await toggleSiteDisabled('example.com');
  expect(await isSiteDisabled('example.com')).toBe(true);
  await toggleSiteDisabled('example.com');
  expect(await isSiteDisabled('example.com')).toBe(false);
});

test('settings stored before disabledSites existed still merge cleanly', async () => {
  const { DEFAULT_SETTINGS, getSettings } = await import('../src/shared/storage');
  await chrome.storage.local.set({ settings: { defaultIntensity: 'light', useFakeProvider: true } });
  const settings = await getSettings();
  expect(settings.disabledSites).toEqual(DEFAULT_SETTINGS.disabledSites);
  expect(settings.defaultIntensity).toBe('light');
  expect(settings.useFakeProvider).toBe(true);
});
```

`tests/labels.test.ts`:

```ts
import { expect, test } from 'vitest';
import { engineLabel } from '../src/shared/labels';

test('labels known kinds and appends the model when present', () => {
  expect(engineLabel({ kind: 'rules' })).toBe('Quick clean (no AI engine available)');
  expect(engineLabel({ kind: 'fake', model: 'fake-echo' })).toBe('Test engine (fake-echo)');
});

test('falls back to the raw kind for unknown values', () => {
  expect(engineLabel({ kind: 'mystery' as never })).toBe('mystery');
  expect(engineLabel({ kind: 'byok' })).toBe('Your API key');
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `npx vitest run tests/storage.test.ts tests/labels.test.ts`
Expected: FAIL (missing exports / missing module).

- [ ] **Step 3: Implement**

`src/shared/labels.ts`:

```ts
import type { EngineInfo } from './types';

export const ENGINE_LABELS: Record<string, string> = {
  rules: 'Quick clean (no AI engine available)',
  nano: 'On-device AI (Gemini Nano)',
  byok: 'Your API key',
  fake: 'Test engine',
};

export function engineLabel(engine: EngineInfo): string {
  const base = ENGINE_LABELS[engine.kind] ?? engine.kind;
  return engine.model ? `${base} (${engine.model})` : base;
}
```

In `src/shared/storage.ts`: extend `Settings` and defaults, add helpers:

```ts
export interface Settings {
  defaultIntensity: Intensity;
  /** Dev/e2e switch: route rewrites through FakeProvider. */
  useFakeProvider: boolean;
  /** Hosts where the selection chip must not appear (e.g. "mail.google.com"). */
  disabledSites: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  defaultIntensity: 'full',
  useFakeProvider: false,
  disabledSites: [],
};
```

Append at the end of the file:

```ts
export async function isSiteDisabled(host: string): Promise<boolean> {
  return (await getSettings()).disabledSites.includes(host);
}

export async function toggleSiteDisabled(host: string): Promise<Settings> {
  const settings = await getSettings();
  const disabledSites = settings.disabledSites.includes(host)
    ? settings.disabledSites.filter(h => h !== host)
    : [...settings.disabledSites, host];
  return updateSettings({ disabledSites });
}
```

In `src/entrypoints/popup/main.ts`: delete the local `ENGINE_LABELS` constant, add `import { engineLabel } from '../../shared/labels';`, and replace the two label lines in `run()` with:

```ts
      engineLabel.textContent = '';
```
stays as is for the reset; the success branch becomes:

```ts
      const label = engineLabelFor(res.result.engine);
```

Wait, the DOM element is already named `engineLabel`. To avoid the name collision, import as:

```ts
import { engineLabel as engineLabelFor } from '../../shared/labels';
```

and in the success branch replace the two lines that referenced `ENGINE_LABELS` with:

```ts
      engineLabel.textContent = engineLabelFor(res.result.engine);
```

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/storage.test.ts tests/labels.test.ts` (6 pass), `npm run typecheck`, `npm test` (46 total), all exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/shared/storage.ts src/shared/labels.ts src/entrypoints/popup/main.ts tests/storage.test.ts tests/labels.test.ts
git commit -m "feat: per-site disable storage helpers and shared engine labels"
```

---

### Task 3: Selection capture module (jsdom)

**Files:**
- Create: `src/content/selection.ts`
- Test: `tests/selection.test.ts`
- Modify: `package.json` dev deps (jsdom)

**Interfaces:**
- Produces: `MIN_SELECTION_CHARS = 10`; `EditableSelection = { kind:'field'; el: HTMLTextAreaElement | HTMLInputElement; start: number; end: number; text: string } | { kind:'editable'; root: HTMLElement; range: Range; text: string }`; `getEditableSelection(doc: Document): EditableSelection | null`; `getPlainSelection(doc: Document): string`.

- [ ] **Step 1: Install jsdom**

Run: `npm i -D jsdom`
Expected: exit 0; `jsdom` in devDependencies.

- [ ] **Step 2: Write the failing tests**

`tests/selection.test.ts`:

```ts
// @vitest-environment jsdom
import { beforeEach, expect, test } from 'vitest';
import { getEditableSelection, getPlainSelection } from '../src/content/selection';

beforeEach(() => {
  document.body.innerHTML = '';
});

test('extracts a textarea selection of 10+ chars', () => {
  document.body.innerHTML = '<textarea>hello wonderful world</textarea>';
  const ta = document.querySelector('textarea')!;
  ta.focus();
  ta.setSelectionRange(0, 15);
  const sel = getEditableSelection(document);
  expect(sel).toMatchObject({ kind: 'field', start: 0, end: 15, text: 'hello wonderful' });
});

test('returns null under the minimum length', () => {
  document.body.innerHTML = '<textarea>hello wonderful world</textarea>';
  const ta = document.querySelector('textarea')!;
  ta.focus();
  ta.setSelectionRange(0, 5);
  expect(getEditableSelection(document)).toBeNull();
});

test('rejects input types without a readable selection', () => {
  document.body.innerHTML = '<input type="number" value="123456789012">';
  document.querySelector('input')!.focus();
  expect(getEditableSelection(document)).toBeNull();

  document.body.innerHTML = '<input type="email" value="someone@example.com">';
  document.querySelector('input')!.focus();
  expect(getEditableSelection(document)).toBeNull();
});

test('never captures password fields', () => {
  document.body.innerHTML = '<input type="password" value="hunter2hunter2">';
  document.querySelector('input')!.focus();
  expect(getEditableSelection(document)).toBeNull();
});

test('extracts a contenteditable selection', () => {
  document.body.innerHTML = '<div contenteditable="true">some editable content here</div>';
  const div = document.querySelector('div')!;
  const range = document.createRange();
  range.selectNodeContents(div);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  const result = getEditableSelection(document);
  expect(result).toMatchObject({ kind: 'editable', text: 'some editable content here' });
});

test('ignores selections outside editable areas', () => {
  document.body.innerHTML = '<div>plain page text that is long enough</div>';
  const div = document.querySelector('div')!;
  const range = document.createRange();
  range.selectNodeContents(div);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  expect(getEditableSelection(document)).toBeNull();
  expect(getPlainSelection(document)).toBe('plain page text that is long enough');
});
```

- [ ] **Step 3: Run, confirm failure**

Run: `npx vitest run tests/selection.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Create `src/content/selection.ts`**

```ts
export const MIN_SELECTION_CHARS = 10;

export type EditableSelection =
  | { kind: 'field'; el: HTMLTextAreaElement | HTMLInputElement; start: number; end: number; text: string }
  | { kind: 'editable'; root: HTMLElement; range: Range; text: string };

// Input types whose selection API is readable in Chromium. email/number/date
// types throw on selectionStart reads; password is deliberately excluded so
// password text never reaches the engine.
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'tel']);

export function getEditableSelection(doc: Document): EditableSelection | null {
  const active = doc.activeElement;
  if (
    active instanceof HTMLTextAreaElement ||
    (active instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(active.type))
  ) {
    const start = active.selectionStart ?? 0;
    const end = active.selectionEnd ?? 0;
    if (end - start < MIN_SELECTION_CHARS) return null;
    return { kind: 'field', el: active, start, end, text: active.value.slice(start, end) };
  }

  const sel = doc.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  const root = editableRoot(range.commonAncestorContainer);
  if (!root) return null;
  const text = sel.toString();
  if (text.length < MIN_SELECTION_CHARS) return null;
  return { kind: 'editable', root, range: range.cloneRange(), text };
}

/** Selected text anywhere on the page (context-menu path; may be non-editable). */
export function getPlainSelection(doc: Document): string {
  return doc.getSelection()?.toString() ?? '';
}

const EDITABLE_SELECTOR = '[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]';

/** Outermost contenteditable ancestor, attribute-based so it works in jsdom too. */
function editableRoot(node: Node | null): HTMLElement | null {
  const el = node instanceof HTMLElement ? node : (node?.parentElement ?? null);
  let cur = el?.closest<HTMLElement>(EDITABLE_SELECTOR) ?? null;
  while (cur) {
    const above = cur.parentElement?.closest<HTMLElement>(EDITABLE_SELECTOR) ?? null;
    if (!above) return cur;
    cur = above;
  }
  return null;
}
```

- [ ] **Step 5: Verify**

Run: `npx vitest run tests/selection.test.ts` (5 pass), `npm run typecheck`, `npm test` (51 total) — all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/content/selection.ts tests/selection.test.ts package.json package-lock.json
git commit -m "feat: editable-selection capture module with jsdom tests"
```

---

### Task 4: Replacement module with never-clobber

**Files:**
- Create: `src/content/replace.ts`
- Test: `tests/replace.test.ts`

**Interfaces:**
- Consumes: `EditableSelection` from `./selection`.
- Produces: `applyReplacement(target: EditableSelection, rewritten: string, doc: Document): boolean` (false = refused, caller flips to Copy) and `locate(haystack: string, needle: string): number | null` (unique-occurrence index).

- [ ] **Step 1: Write the failing tests**

`tests/replace.test.ts`:

```ts
// @vitest-environment jsdom
import { beforeEach, expect, test } from 'vitest';
import { applyReplacement, locate } from '../src/content/replace';
import type { EditableSelection } from '../src/content/selection';

beforeEach(() => {
  document.body.innerHTML = '';
});

test('locate finds a unique occurrence and rejects ambiguity', () => {
  expect(locate('a delve b', 'delve')).toBe(2);
  expect(locate('delve delve', 'delve')).toBeNull();
  expect(locate('nothing here', 'delve')).toBeNull();
});

test('replaces a field selection and fires an input event', () => {
  document.body.innerHTML = '<textarea>We delve into the plan.</textarea>';
  const el = document.querySelector('textarea')!;
  let fired = false;
  el.addEventListener('input', () => {
    fired = true;
  });
  const target: EditableSelection = { kind: 'field', el, start: 3, end: 8, text: 'delve' };
  expect(applyReplacement(target, 'dig', document)).toBe(true);
  expect(el.value).toBe('We dig into the plan.');
  expect(fired).toBe(true);
});

test('relocates drifted text when it is unique', () => {
  document.body.innerHTML = '<textarea>PREFIX We delve into the plan.</textarea>';
  const el = document.querySelector('textarea')!;
  // Captured before "PREFIX " was typed, so offsets are stale:
  const target: EditableSelection = { kind: 'field', el, start: 3, end: 8, text: 'delve' };
  expect(applyReplacement(target, 'dig', document)).toBe(true);
  expect(el.value).toBe('PREFIX We dig into the plan.');
});

test('refuses ambiguous relocation and leaves the field untouched', () => {
  document.body.innerHTML = '<textarea>delve or delve</textarea>';
  const el = document.querySelector('textarea')!;
  const target: EditableSelection = { kind: 'field', el, start: 0, end: 5, text: 'delve' };
  // Both stale-offset text ("delve" at 0..5 matches!) -- craft real drift:
  el.value = 'now delve or delve';
  expect(applyReplacement(target, 'dig', document)).toBe(false);
  expect(el.value).toBe('now delve or delve');
});

test('replaces inside contenteditable and refuses when the range drifted', () => {
  document.body.innerHTML = '<div contenteditable="true">We delve into the plan today.</div>';
  const root = document.querySelector('div')!;
  const textNode = root.firstChild!;
  const range = document.createRange();
  range.setStart(textNode, 3);
  range.setEnd(textNode, 8);
  const good: EditableSelection = { kind: 'editable', root, range: range.cloneRange(), text: 'delve' };
  expect(applyReplacement(good, 'dig', document)).toBe(true);
  expect(root.textContent).toBe('We dig into the plan today.');

  const stale: EditableSelection = { kind: 'editable', root, range: range.cloneRange(), text: 'delve' };
  // Range text no longer matches the captured text after the first replacement:
  expect(applyReplacement(stale, 'dig', document)).toBe(false);
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `npx vitest run tests/replace.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Create `src/content/replace.ts`**

```ts
import type { EditableSelection } from './selection';

/**
 * Write the rewritten text back into the captured selection.
 * Never clobbers: if the target cannot be verifiably relocated, returns false
 * and the caller falls back to Copy.
 */
export function applyReplacement(target: EditableSelection, rewritten: string, doc: Document): boolean {
  if (target.kind === 'field') return replaceInField(target, rewritten);
  return replaceInEditable(target, rewritten, doc);
}

/** Index of the unique occurrence of needle in haystack, else null. */
export function locate(haystack: string, needle: string): number | null {
  if (!needle) return null;
  const first = haystack.indexOf(needle);
  if (first === -1) return null;
  if (haystack.indexOf(needle, first + 1) !== -1) return null;
  return first;
}

function replaceInField(
  target: Extract<EditableSelection, { kind: 'field' }>,
  rewritten: string,
): boolean {
  const { el } = target;
  if (!el.isConnected) return false;
  let { start, end } = target;
  if (el.value.slice(start, end) !== target.text) {
    const found = locate(el.value, target.text);
    if (found === null) return false;
    start = found;
    end = found + target.text.length;
  }
  el.focus();
  if (typeof el.setRangeText === 'function') {
    el.setSelectionRange(start, end);
    el.setRangeText(rewritten, start, end, 'end');
  } else {
    // Very old engines: manual splice.
    el.value = el.value.slice(0, start) + rewritten + el.value.slice(end);
    el.setSelectionRange(start + rewritten.length, start + rewritten.length);
  }
  el.dispatchEvent(
    new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: rewritten }),
  );
  return true;
}

function replaceInEditable(
  target: Extract<EditableSelection, { kind: 'editable' }>,
  rewritten: string,
  doc: Document,
): boolean {
  const { root, range } = target;
  if (!root.isConnected) return false;
  if (range.toString() !== target.text) return false;
  const sel = doc.getSelection();
  if (!sel) return false;
  sel.removeAllRanges();
  sel.addRange(range);
  // execCommand keeps the site's undo stack alive where supported.
  if (typeof doc.execCommand === 'function' && doc.execCommand('insertText', false, rewritten)) {
    return true;
  }
  // Fallback (jsdom, engines without execCommand): direct range surgery.
  range.deleteContents();
  range.insertNode(doc.createTextNode(rewritten));
  sel.removeAllRanges();
  return true;
}
```

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/replace.test.ts` (5 pass), `npm run typecheck`, `npm test` (56 total) — all exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/content/replace.ts tests/replace.test.ts
git commit -m "feat: never-clobber replacement module for fields and contenteditable"
```

---

### Task 5: Chip and card components (shadow DOM)

**Files:**
- Create: `src/content/chip.ts`, `src/content/card.ts`
- Test: `tests/chip-card.test.ts`

**Interfaces:**
- Consumes: `engineLabel` from `../shared/labels`; types `HumanizeResult`, `HumanizerErrorKind`, `Intensity`.
- Produces:
  - `class Chip { constructor(doc: Document, onClick: () => void); showAt(x: number, y: number): void; hide(): void; contains(target: EventTarget | null): boolean }` — host id `humanizer-chip-host`, open shadow root, button labeled `Humanize`, fires on `mousedown` (so field focus/selection is not lost).
  - `class Card { constructor(doc: Document, cb: CardCallbacks); open(rect: { left: number; bottom: number }, opts: { canApply: boolean; intensity: Intensity }): void; setStreaming(textSoFar: string): void; setResult(result: HumanizeResult): void; setError(kind: HumanizerErrorKind, message: string): void; showApplyFailed(): void; close(): void; readonly isOpen: boolean; contains(target: EventTarget | null): boolean }` with `CardCallbacks { onApply(): void; onCopy(): void; onDismiss(): void; onIntensityChange(intensity: Intensity): void }` — host id `humanizer-card-host`, open shadow root; content classes `.rewritten`, `.status`, `.engine`, `select.intensity`, `button.apply`, `button.copy`, `button.dismiss`; Esc while open calls `onDismiss`.

- [ ] **Step 1: Write the failing tests**

`tests/chip-card.test.ts`:

```ts
// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest';
import { Chip } from '../src/content/chip';
import { Card } from '../src/content/card';
import type { HumanizeResult } from '../src/shared/types';

beforeEach(() => {
  document.body.innerHTML = '';
});

const noop = { onApply: () => {}, onCopy: () => {}, onDismiss: () => {}, onIntensityChange: () => {} };

test('chip mounts on show, fires on mousedown, unmounts on hide', () => {
  const onClick = vi.fn();
  const chip = new Chip(document, onClick);
  chip.showAt(10, 20);
  const host = document.getElementById('humanizer-chip-host')!;
  const btn = host.shadowRoot!.querySelector('button')!;
  expect(btn.textContent).toBe('Humanize');
  btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  expect(onClick).toHaveBeenCalledOnce();
  expect(chip.contains(btn)).toBe(true);
  expect(chip.contains(document.body)).toBe(false);
  chip.hide();
  expect(document.getElementById('humanizer-chip-host')).toBeNull();
});

test('card renders a result with highlight marks and engine label', () => {
  const card = new Card(document, noop);
  card.open({ left: 0, bottom: 0 }, { canApply: true, intensity: 'full' });
  const result: HumanizeResult = {
    rewritten: 'We dig in.',
    changes: [{ range: { start: 3, end: 6 }, ruleId: 'ai-vocab', reason: 'AI-associated vocabulary' }],
    engine: { kind: 'fake', model: 'fake-echo' },
  };
  card.setResult(result);
  const shadow = document.getElementById('humanizer-card-host')!.shadowRoot!;
  const mark = shadow.querySelector('.rewritten mark')!;
  expect(mark.textContent).toBe('dig');
  expect(mark.getAttribute('title')).toBe('AI-associated vocabulary');
  expect(shadow.querySelector('.engine')!.textContent).toContain('Test engine (fake-echo)');
  expect((shadow.querySelector('button.apply') as HTMLButtonElement).hidden).toBe(false);
  expect(card.contains(shadow.querySelector('button.apply'))).toBe(true);
  expect(card.contains(document.body)).toBe(false);
});

test('card hides Apply when canApply is false', () => {
  const card = new Card(document, noop);
  card.open({ left: 0, bottom: 0 }, { canApply: false, intensity: 'light' });
  const shadow = document.getElementById('humanizer-card-host')!.shadowRoot!;
  expect((shadow.querySelector('button.apply') as HTMLButtonElement).hidden).toBe(true);
});

test('Escape while open triggers onDismiss', () => {
  const onDismiss = vi.fn();
  const card = new Card(document, { ...noop, onDismiss });
  card.open({ left: 0, bottom: 0 }, { canApply: true, intensity: 'full' });
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(onDismiss).toHaveBeenCalledOnce();
});

test('error state shows the message', () => {
  const card = new Card(document, noop);
  card.open({ left: 0, bottom: 0 }, { canApply: true, intensity: 'full' });
  card.setError('too-long', 'Input is too large.');
  const shadow = document.getElementById('humanizer-card-host')!.shadowRoot!;
  expect(shadow.querySelector('.status')!.textContent).toContain('Input is too large.');
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `npx vitest run tests/chip-card.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Create `src/content/chip.ts`**

```ts
/** Floating "Humanize" chip shown near an eligible selection. */
export class Chip {
  private readonly host: HTMLElement;
  private readonly btn: HTMLButtonElement;

  constructor(doc: Document, onClick: () => void) {
    this.host = doc.createElement('div');
    this.host.id = 'humanizer-chip-host';
    this.host.style.cssText = 'position:absolute;top:0;left:0;z-index:2147483647;';
    const shadow = this.host.attachShadow({ mode: 'open' });
    this.btn = doc.createElement('button');
    this.btn.textContent = 'Humanize';
    this.btn.style.cssText =
      'all:initial;cursor:pointer;font:600 12px system-ui,sans-serif;color:#fff;' +
      'background:#1a73e8;padding:5px 12px;border-radius:14px;box-shadow:0 1px 4px rgba(0,0,0,.35);';
    this.btn.addEventListener('mousedown', e => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    shadow.append(this.btn);
    this.doc = doc;
  }

  private readonly doc: Document;

  showAt(x: number, y: number): void {
    this.host.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    if (!this.host.isConnected) this.doc.body.append(this.host);
  }

  hide(): void {
    this.host.remove();
  }

  contains(target: EventTarget | null): boolean {
    return (
      target instanceof Node &&
      (this.host === target || (this.host.shadowRoot?.contains(target) ?? false))
    );
  }
}
```

- [ ] **Step 4: Create `src/content/card.ts`**

```ts
import { engineLabel } from '../shared/labels';
import type { HumanizeResult, HumanizerErrorKind, Intensity } from '../shared/types';

export interface CardCallbacks {
  onApply(): void;
  onCopy(): void;
  onDismiss(): void;
  onIntensityChange(intensity: Intensity): void;
}

const CARD_CSS = `
  :host { all: initial; }
  .card { position: fixed; z-index: 2147483647; width: 360px; max-width: 92vw;
    background: #fff; color: #202124; font: 13px/1.45 system-ui, sans-serif;
    border: 1px solid #dadce0; border-radius: 10px; box-shadow: 0 4px 16px rgba(0,0,0,.25); }
  .body { max-height: 260px; overflow: auto; padding: 10px 12px; white-space: pre-wrap; }
  .rewritten mark { background: #e8f0fe; color: inherit; border-radius: 3px; }
  .bar { display: flex; gap: 8px; align-items: center; padding: 8px 12px;
    border-top: 1px solid #eee; }
  .status { padding: 0 12px 6px; color: #5f6368; min-height: 16px; }
  .engine { color: #5f6368; margin-right: auto; }
  button { font: inherit; padding: 4px 12px; border: 1px solid #dadce0; border-radius: 6px;
    background: #fff; cursor: pointer; }
  button.apply { background: #1a73e8; border-color: #1a73e8; color: #fff; }
  button[hidden] { display: none; }
  select { font: inherit; }
`;

export class Card {
  private readonly doc: Document;
  private readonly cb: CardCallbacks;
  private readonly host: HTMLElement;
  private readonly cardEl: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly engineEl: HTMLElement;
  private readonly applyBtn: HTMLButtonElement;
  private readonly copyBtn: HTMLButtonElement;
  private readonly dismissBtn: HTMLButtonElement;
  private readonly intensitySel: HTMLSelectElement;
  private readonly onKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this.cb.onDismiss();
  };
  private open_ = false;

  constructor(doc: Document, cb: CardCallbacks) {
    this.doc = doc;
    this.cb = cb;
    this.host = doc.createElement('div');
    this.host.id = 'humanizer-card-host';
    const shadow = this.host.attachShadow({ mode: 'open' });
    const style = doc.createElement('style');
    style.textContent = CARD_CSS;

    this.cardEl = doc.createElement('div');
    this.cardEl.className = 'card';
    this.bodyEl = doc.createElement('div');
    this.bodyEl.className = 'body rewritten';
    this.statusEl = doc.createElement('div');
    this.statusEl.className = 'status';

    const bar = doc.createElement('div');
    bar.className = 'bar';
    this.engineEl = doc.createElement('span');
    this.engineEl.className = 'engine';
    this.intensitySel = doc.createElement('select');
    this.intensitySel.className = 'intensity';
    for (const [value, label] of [
      ['light', 'Light touch'],
      ['full', 'Full rewrite'],
    ] as const) {
      const opt = doc.createElement('option');
      opt.value = value;
      opt.textContent = label;
      this.intensitySel.append(opt);
    }
    this.intensitySel.addEventListener('change', () => {
      this.cb.onIntensityChange(this.intensitySel.value as Intensity);
    });
    this.applyBtn = doc.createElement('button');
    this.applyBtn.className = 'apply';
    this.applyBtn.textContent = 'Apply';
    this.applyBtn.addEventListener('click', () => this.cb.onApply());
    this.copyBtn = doc.createElement('button');
    this.copyBtn.className = 'copy';
    this.copyBtn.textContent = 'Copy';
    this.copyBtn.addEventListener('click', () => this.cb.onCopy());
    this.dismissBtn = doc.createElement('button');
    this.dismissBtn.className = 'dismiss';
    this.dismissBtn.textContent = 'Dismiss';
    this.dismissBtn.addEventListener('click', () => this.cb.onDismiss());

    bar.append(this.engineEl, this.intensitySel, this.applyBtn, this.copyBtn, this.dismissBtn);
    this.cardEl.append(this.bodyEl, this.statusEl, bar);
    shadow.append(style, this.cardEl);
  }

  get isOpen(): boolean {
    return this.open_;
  }

  open(rect: { left: number; bottom: number }, opts: { canApply: boolean; intensity: Intensity }): void {
    this.applyBtn.hidden = !opts.canApply;
    this.intensitySel.value = opts.intensity;
    this.bodyEl.textContent = '';
    this.engineEl.textContent = '';
    this.statusEl.textContent = 'Rewriting...';
    const left = Math.max(8, Math.min(rect.left, (this.doc.defaultView?.innerWidth ?? 800) - 376));
    this.cardEl.style.left = `${Math.round(left)}px`;
    this.cardEl.style.top = `${Math.round(rect.bottom + 6)}px`;
    if (!this.host.isConnected) this.doc.body.append(this.host);
    this.doc.addEventListener('keydown', this.onKeydown, true);
    this.open_ = true;
  }

  setStreaming(textSoFar: string): void {
    this.bodyEl.textContent = textSoFar;
    this.statusEl.textContent = 'Rewriting...';
  }

  setResult(result: HumanizeResult): void {
    renderHighlights(this.doc, this.bodyEl, result);
    this.engineEl.textContent = engineLabel(result.engine);
    const n = result.changes.length;
    this.statusEl.textContent = `${n} change${n === 1 ? '' : 's'}`;
  }

  setError(kind: HumanizerErrorKind, message: string): void {
    this.statusEl.textContent = `Error: ${message}`;
    this.engineEl.textContent = kind;
  }

  /** Never-clobber refusal: flip to copy-primary. */
  showApplyFailed(): void {
    this.applyBtn.hidden = true;
    this.statusEl.textContent = 'The text changed since you selected it. Use Copy instead.';
  }

  close(): void {
    this.doc.removeEventListener('keydown', this.onKeydown, true);
    this.host.remove();
    this.open_ = false;
  }

  contains(target: EventTarget | null): boolean {
    return (
      target instanceof Node &&
      (this.host === target || (this.host.shadowRoot?.contains(target) ?? false))
    );
  }
}

function renderHighlights(doc: Document, container: HTMLElement, result: HumanizeResult): void {
  container.textContent = '';
  const { rewritten } = result;
  const changes = [...result.changes].sort((a, b) => a.range.start - b.range.start);
  let pos = 0;
  for (const change of changes) {
    if (change.range.start < pos || change.range.end <= change.range.start) continue;
    if (change.range.start > pos) container.append(rewritten.slice(pos, change.range.start));
    const mark = doc.createElement('mark');
    mark.textContent = rewritten.slice(change.range.start, change.range.end);
    mark.title = change.reason;
    container.append(mark);
    pos = change.range.end;
  }
  if (pos < rewritten.length) container.append(rewritten.slice(pos));
}
```

- [ ] **Step 5: Verify**

Run: `npx vitest run tests/chip-card.test.ts` (5 pass), `npm run typecheck`, `npm test` (61 total) — all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/content/chip.ts src/content/card.ts tests/chip-card.test.ts
git commit -m "feat: shadow-DOM chip and result card with streaming, highlights, and states"
```

---

### Task 6: Session orchestrator, content entrypoint, context menu wiring, manifest permissions

**Files:**
- Create: `src/content/session.ts`, `src/entrypoints/content.ts`
- Modify: `wxt.config.ts` (permissions)
- Test: `tests/session.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-5.
- Produces: `class HumanizeSession { constructor(doc: Document); start(): void; stop(): void }` — wires selectionchange (debounced 150ms) → chip; chip mousedown → card + port request; port `chunk/done/error` → card states; Apply → `applyReplacement` (failure → `showApplyFailed`); Copy → clipboard; Dismiss/Esc/outside-click → cancel + close; intensity change → cancel + re-request; `{ type: 'context-humanize' }` runtime message → card for the current selection (Copy-primary if not editable); live enable/disable via `chrome.storage.onChanged` on `disabledSites`. `src/entrypoints/content.ts` is a thin `defineContentScript` wrapper (matches `['<all_urls>']`).

- [ ] **Step 1: Write the failing tests**

`tests/session.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { PortServerMessage } from '../src/shared/messages';

class FakePort {
  name = 'humanize';
  sent: unknown[] = [];
  private listeners: Array<(msg: unknown) => void> = [];
  onMessage = { addListener: (fn: (msg: unknown) => void): void => void this.listeners.push(fn) };
  onDisconnect = { addListener: (_fn: () => void): void => undefined };
  postMessage(msg: unknown): void {
    this.sent.push(msg);
  }
  emit(msg: PortServerMessage): void {
    for (const fn of this.listeners) fn(msg);
  }
  disconnect(): void {}
}

let port: FakePort;
let runtimeListeners: Array<(msg: unknown) => void> = [];
let session: import('../src/content/session').HumanizeSession;

beforeEach(async () => {
  vi.useFakeTimers();
  port = new FakePort();
  const store: Record<string, unknown> = {
    settings: { defaultIntensity: 'full', useFakeProvider: true, disabledSites: [] },
  };
  runtimeListeners = [];
  (globalThis as Record<string, unknown>)['chrome'] = {
    runtime: {
      id: 'test',
      connect: () => port,
      onMessage: {
        addListener: (fn: (msg: unknown) => void): void => void runtimeListeners.push(fn),
        removeListener: (fn: (msg: unknown) => void): void => {
          const i = runtimeListeners.indexOf(fn);
          if (i >= 0) runtimeListeners.splice(i, 1);
        },
      },
    },
    storage: {
      local: {
        get: async (key: string) => ({ [key]: store[key] }),
        set: async (items: Record<string, unknown>) => void Object.assign(store, items),
      },
      onChanged: { addListener: (): void => undefined },
    },
  } as unknown as typeof chrome;
  document.body.innerHTML = '<textarea>We delve into the plan boldly.</textarea>';
  const { HumanizeSession } = await import('../src/content/session');
  session = new HumanizeSession(document);
  session.start();
});

afterEach(() => {
  session.stop();
  vi.useRealTimers();
});

function selectInTextarea(): void {
  const ta = document.querySelector('textarea')!;
  ta.focus();
  ta.setSelectionRange(0, 30);
  document.dispatchEvent(new Event('selectionchange'));
  vi.advanceTimersByTime(200);
}

function clickChip(): void {
  const btn = document.getElementById('humanizer-chip-host')!.shadowRoot!.querySelector('button')!;
  btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
}

test('selection shows the chip; chip click opens the card and sends a request', () => {
  selectInTextarea();
  expect(document.getElementById('humanizer-chip-host')).not.toBeNull();
  clickChip();
  expect(document.getElementById('humanizer-card-host')).not.toBeNull();
  expect(port.sent).toHaveLength(1);
  expect(port.sent[0]).toMatchObject({ type: 'humanize', intensity: 'full', text: 'We delve into the plan boldly.' });
});

test('done result renders and Apply replaces the field text', () => {
  selectInTextarea();
  clickChip();
  const req = port.sent[0] as { id: string };
  port.emit({
    type: 'done',
    id: req.id,
    result: {
      rewritten: 'We dig into the plan boldly.',
      changes: [],
      engine: { kind: 'fake', model: 'fake-echo' },
    },
  });
  const shadow = document.getElementById('humanizer-card-host')!.shadowRoot!;
  expect(shadow.querySelector('.rewritten')!.textContent).toBe('We dig into the plan boldly.');
  (shadow.querySelector('button.apply') as HTMLButtonElement).click();
  expect(document.querySelector('textarea')!.value).toBe('We dig into the plan boldly.');
  expect(document.getElementById('humanizer-card-host')).toBeNull();
});

test('dismiss sends a cancel for the in-flight request', () => {
  selectInTextarea();
  clickChip();
  const req = port.sent[0] as { id: string };
  const shadow = document.getElementById('humanizer-card-host')!.shadowRoot!;
  (shadow.querySelector('button.dismiss') as HTMLButtonElement).click();
  expect(port.sent).toContainEqual({ type: 'cancel', id: req.id });
  expect(document.getElementById('humanizer-card-host')).toBeNull();
});

test('stale responses for superseded ids are ignored', () => {
  selectInTextarea();
  clickChip();
  const first = port.sent[0] as { id: string };
  const shadow = document.getElementById('humanizer-card-host')!.shadowRoot!;
  (shadow.querySelector('select.intensity') as HTMLSelectElement).value = 'light';
  shadow.querySelector('select.intensity')!.dispatchEvent(new Event('change'));
  port.emit({
    type: 'done',
    id: first.id,
    result: { rewritten: 'STALE', changes: [], engine: { kind: 'fake' } },
  });
  expect(shadow.querySelector('.rewritten')!.textContent).not.toBe('STALE');
});

test('stop() removes the runtime listener and ignores late messages', () => {
  expect(runtimeListeners).toHaveLength(1);
  session.stop();
  expect(runtimeListeners).toHaveLength(0);
  expect(document.getElementById('humanizer-card-host')).toBeNull();
});

test('a debounce pending at stop() cannot resurrect the chip', () => {
  const ta = document.querySelector('textarea')!;
  ta.focus();
  ta.setSelectionRange(0, 30);
  document.dispatchEvent(new Event('selectionchange'));
  session.stop();
  vi.advanceTimersByTime(300);
  expect(document.getElementById('humanizer-chip-host')).toBeNull();
});

test('selection changes after stop() never show the chip', () => {
  session.stop();
  selectInTextarea();
  expect(document.getElementById('humanizer-chip-host')).toBeNull();
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `npx vitest run tests/session.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Create `src/content/session.ts`**

```ts
import { getEditableSelection, getPlainSelection } from './selection';
import type { EditableSelection } from './selection';
import { applyReplacement } from './replace';
import { Chip } from './chip';
import { Card } from './card';
import { getSettings, isSiteDisabled } from '../shared/storage';
import { HUMANIZE_PORT } from '../shared/messages';
import type { HumanizeRequest, PortServerMessage } from '../shared/messages';
import type { HumanizeResult, Intensity } from '../shared/types';

const CHIP_DEBOUNCE_MS = 150;

export class HumanizeSession {
  private readonly doc: Document;
  private readonly chip: Chip;
  private readonly card: Card;
  private port: chrome.runtime.Port | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private selection: EditableSelection | null = null;
  private captured: EditableSelection | null = null;
  private capturedText = '';
  private canApply = false;
  private intensity: Intensity = 'full';
  private requestId: string | null = null;
  private result: HumanizeResult | null = null;
  private stopped = false;

  constructor(doc: Document) {
    this.doc = doc;
    this.chip = new Chip(doc, () => this.onChipClick());
    this.card = new Card(doc, {
      onApply: () => this.onApply(),
      onCopy: () => this.onCopy(),
      onDismiss: () => this.dismissCard(),
      onIntensityChange: intensity => this.onIntensityChange(intensity),
    });
  }

  start(): void {
    this.doc.addEventListener('selectionchange', this.onSelectionChange);
    this.doc.addEventListener('mousedown', this.onMouseDown, true);
    chrome.runtime.onMessage.addListener(this.onRuntimeMessage);
    void getSettings().then(s => {
      this.intensity = s.defaultIntensity;
    });
  }

  stop(): void {
    this.stopped = true;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = null;
    this.doc.removeEventListener('selectionchange', this.onSelectionChange);
    this.doc.removeEventListener('mousedown', this.onMouseDown, true);
    chrome.runtime.onMessage.removeListener(this.onRuntimeMessage);
    this.chip.hide();
    this.dismissCard();
    this.port?.disconnect();
    this.port = null;
  }

  private readonly onSelectionChange = (): void => {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.updateChip(), CHIP_DEBOUNCE_MS);
  };

  private readonly onMouseDown = (e: MouseEvent): void => {
    if (this.chip.contains(e.target) || this.card.contains(e.target)) return;
    this.chip.hide();
    if (this.card.isOpen) this.dismissCard();
  };

  private readonly onRuntimeMessage = (msg: unknown): void => {
    if (this.stopped) return;
    if (typeof msg !== 'object' || msg === null) return;
    if ((msg as Record<string, unknown>)['type'] !== 'context-humanize') return;
    const editable = getEditableSelection(this.doc);
    if (editable) {
      this.captured = editable;
      this.capturedText = editable.text;
      this.canApply = true;
    } else {
      const text = getPlainSelection(this.doc);
      if (!text) return;
      this.captured = null;
      this.capturedText = text;
      this.canApply = false;
    }
    this.chip.hide();
    this.openCardAtSelection();
    this.request();
  };

  private updateChip(): void {
    if (this.stopped) return;
    if (this.card.isOpen) return;
    this.selection = getEditableSelection(this.doc);
    if (!this.selection) {
      this.chip.hide();
      return;
    }
    const rect = selectionRect(this.doc, this.selection);
    const win = this.doc.defaultView;
    this.chip.showAt(rect.right + (win?.scrollX ?? 0) - 40, rect.bottom + (win?.scrollY ?? 0) + 6);
  }

  private onChipClick(): void {
    if (!this.selection) return;
    this.captured = this.selection;
    this.capturedText = this.selection.text;
    this.canApply = true;
    this.chip.hide();
    this.openCardAtSelection();
    this.request();
  }

  private openCardAtSelection(): void {
    const rect = this.captured
      ? selectionRect(this.doc, this.captured)
      : { left: 40, bottom: 40, right: 40 };
    this.card.open({ left: rect.left, bottom: rect.bottom }, { canApply: this.canApply, intensity: this.intensity });
  }

  private ensurePort(): chrome.runtime.Port {
    if (!this.port) {
      this.port = chrome.runtime.connect({ name: HUMANIZE_PORT });
      this.port.onMessage.addListener(msg => this.onPortMessage(msg as PortServerMessage));
      this.port.onDisconnect.addListener(() => {
        this.port = null;
      });
    }
    return this.port;
  }

  private request(): void {
    this.result = null;
    const id = crypto.randomUUID();
    this.requestId = id;
    const req: HumanizeRequest = { type: 'humanize', id, text: this.capturedText, intensity: this.intensity };
    this.ensurePort().postMessage(req);
  }

  private cancelInFlight(): void {
    if (this.requestId && !this.result && this.port) {
      this.port.postMessage({ type: 'cancel', id: this.requestId });
    }
    this.requestId = null;
  }

  private onPortMessage(msg: PortServerMessage): void {
    if (msg.id !== this.requestId || this.stopped) return;
    if (msg.type === 'chunk') this.card.setStreaming(msg.textSoFar);
    else if (msg.type === 'done') {
      this.result = msg.result;
      this.card.setResult(msg.result);
    } else this.card.setError(msg.kind, msg.message);
  }

  private onApply(): void {
    if (!this.result || !this.captured) return;
    const ok = applyReplacement(this.captured, this.result.rewritten, this.doc);
    if (!ok) {
      this.card.showApplyFailed();
      return;
    }
    this.card.close();
  }

  private onCopy(): void {
    if (!this.result) return;
    const nav = this.doc.defaultView?.navigator;
    void nav?.clipboard?.writeText(this.result.rewritten).catch(() => {});
  }

  private onIntensityChange(intensity: Intensity): void {
    this.intensity = intensity;
    this.cancelInFlight();
    this.card.setStreaming('');
    this.request();
  }

  private dismissCard(): void {
    this.cancelInFlight();
    if (this.card.isOpen) this.card.close();
  }
}

function selectionRect(
  doc: Document,
  sel: EditableSelection,
): { left: number; right: number; bottom: number } {
  if (sel.kind === 'editable') {
    const r = sel.range.getBoundingClientRect();
    if (r.width > 0 || r.height > 0) return { left: r.left, right: r.right, bottom: r.bottom };
  }
  const el = sel.kind === 'field' ? sel.el : sel.root;
  const r = el.getBoundingClientRect();
  return { left: r.left, right: r.right, bottom: r.bottom };
}
```

- [ ] **Step 4: Create `src/entrypoints/content.ts`**

```ts
import { HumanizeSession } from '../content/session';
import { isSiteDisabled } from '../shared/storage';

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    void boot();
  },
});

async function boot(): Promise<void> {
  let session: HumanizeSession | null = null;
  let pending: Promise<void> = Promise.resolve();
  const host = location.host;

  const sync = (): Promise<void> => {
    pending = pending.then(async () => {
      const disabled = await isSiteDisabled(host);
      if (disabled && session) {
        session.stop();
        session = null;
      } else if (!disabled && !session) {
        session = new HumanizeSession(document);
        session.start();
      }
    });
    return pending;
  };

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes['settings']) void sync();
  });
  await sync();
}
```

- [ ] **Step 5: Update `wxt.config.ts` permissions**

```ts
    permissions: ['storage', 'contextMenus', 'activeTab'],
```

- [ ] **Step 6: Verify**

Run: `npx vitest run tests/session.test.ts` (4 pass), `npm run typecheck`, `npm test` (65 total), `npm run build` (content script present in `.output/chrome-mv3/manifest.json` under `content_scripts` with `<all_urls>`; permissions exactly storage, contextMenus, activeTab) — all exit 0.
Note: `session.ts` imports `isSiteDisabled` only via `content.ts`; if the linter flags the unused import in `session.ts`, remove it there (the import list above includes `getSettings, isSiteDisabled` — keep only what is used; `isSiteDisabled` belongs to `content.ts`).

- [ ] **Step 7: Commit**

```bash
git add src/content/session.ts src/entrypoints/content.ts wxt.config.ts tests/session.test.ts
git commit -m "feat: content-script session orchestrator, context menu path, manifest permissions"
```

---

### Task 7: Popup per-site toggle

**Files:**
- Modify: `src/entrypoints/popup/index.html`, `src/entrypoints/popup/main.ts`

**Interfaces:**
- Consumes: `isSiteDisabled`, `toggleSiteDisabled` (Task 2); `activeTab` permission (Task 6).
- Produces: a popup row showing the current site's host with a disable checkbox; hidden for non-http(s) tabs.

- [ ] **Step 1: Add the row to `src/entrypoints/popup/index.html`**

Insert directly after the `<div class="row">` that holds the engine span and copy button:

```html
    <div class="row" id="siteRow" hidden>
      <label class="muted"><input type="checkbox" id="siteToggle" /> Disable on <span id="siteHost"></span></label>
    </div>
```

- [ ] **Step 2: Wire it in `src/entrypoints/popup/main.ts`**

Add imports: `import { getSettings, updateSettings, isSiteDisabled, toggleSiteDisabled } from '../../shared/storage';` (extend the existing import). Add element handles after the existing ones:

```ts
const siteRow = byId<HTMLDivElement>('siteRow');
const siteToggle = byId<HTMLInputElement>('siteToggle');
const siteHost = byId<HTMLSpanElement>('siteHost');
```

Append to the end of `init()`:

```ts
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url;
  if (url && /^https?:/i.test(url)) {
    const host = new URL(url).host;
    siteHost.textContent = host;
    siteToggle.checked = await isSiteDisabled(host);
    siteRow.hidden = false;
    siteToggle.addEventListener('change', () => {
      void toggleSiteDisabled(host);
    });
  }
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck`, `npm test` (65, unchanged), `npm run build` — all exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/entrypoints/popup/index.html src/entrypoints/popup/main.ts
git commit -m "feat: per-site disable toggle in the popup"
```

---

### Task 8: Playwright e2e against the built extension

**Files:**
- Create: `playwright.config.ts`, `tests-e2e/fixtures.ts`, `tests-e2e/serve.mjs`, `tests-e2e/fixtures/page.html`, `tests-e2e/textarea.spec.ts`, `tests-e2e/contenteditable.spec.ts`, `tests-e2e/disable.spec.ts`
- Modify: `package.json` (devDep + script), `.github/workflows/ci.yml`, `tsconfig.json` include (exclude e2e from vitest; include for typecheck)

**Interfaces:**
- Produces: `npm run e2e` runs 3 specs against `.output/chrome-mv3` with the fake provider; CI runs them under xvfb.

- [ ] **Step 1: Install and scaffold**

Run: `npm i -D @playwright/test` then `npx playwright install chromium`
Expected: exit 0.

Add script to `package.json`: `"e2e": "playwright test"`.

- [ ] **Step 2: Create `tests-e2e/serve.mjs`**

```js
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, normalize } from 'node:path';

const root = fileURLToPath(new URL('./fixtures/', import.meta.url));
const server = createServer(async (req, res) => {
  try {
    const path = normalize(join(root, req.url === '/' ? 'page.html' : (req.url ?? '')));
    if (!path.startsWith(root)) throw new Error('forbidden');
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
server.listen(8787, () => console.log('fixture server on :8787'));
```

- [ ] **Step 3: Create `tests-e2e/fixtures/page.html`**

```html
<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Humanizer fixture</title></head>
  <body>
    <textarea id="ta" rows="4" cols="60">We delve into the vibrant tapestry of plans—boldly and often.</textarea>
    <div id="ce" contenteditable="true">We delve into the plan—boldly, and with great enthusiasm today.</div>
    <input id="inp" value="We delve into the plan—boldly and often, every single day." size="70" />
  </body>
</html>
```

- [ ] **Step 4: Create `tests-e2e/fixtures.ts`**

```ts
import { test as base, chromium, type BrowserContext } from '@playwright/test';
import path from 'node:path';

export const test = base.extend<{ context: BrowserContext }>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const dist = path.resolve('.output/chrome-mv3');
    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
    });
    await use(context);
    await context.close();
  },
});

export const expect = test.expect;

export async function setExtensionSettings(
  context: BrowserContext,
  settings: { defaultIntensity: 'light' | 'full'; useFakeProvider: boolean; disabledSites: string[] },
): Promise<void> {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  await sw.evaluate(s => chrome.storage.local.set({ settings: s }), settings);
}
```

- [ ] **Step 5: Create `playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests-e2e',
  timeout: 30_000,
  retries: process.env['CI'] ? 1 : 0,
  webServer: {
    command: 'node tests-e2e/serve.mjs',
    port: 8787,
    reuseExistingServer: !process.env['CI'],
  },
});
```

- [ ] **Step 6: Create the three specs**

`tests-e2e/textarea.spec.ts`:

```ts
import { expect, setExtensionSettings, test } from './fixtures';

test('chip appears on textarea selection and Apply replaces the text', async ({ context }) => {
  await setExtensionSettings(context, { defaultIntensity: 'full', useFakeProvider: true, disabledSites: [] });
  const page = await context.newPage();
  await page.goto('http://localhost:8787/page.html');
  await page.locator('#ta').evaluate(el => {
    const ta = el as HTMLTextAreaElement;
    ta.focus();
    ta.setSelectionRange(0, ta.value.length);
  });
  const chip = page.locator('#humanizer-chip-host button');
  await expect(chip).toBeVisible();
  await chip.dispatchEvent('mousedown');
  const card = page.locator('#humanizer-card-host');
  await expect(card.locator('.rewritten')).toContainText('dig into');
  await card.locator('button.apply').click();
  await expect(page.locator('#ta')).toHaveValue(/dig into/);
  await expect(page.locator('#ta')).not.toHaveValue(/\u2014/);
});
```

`tests-e2e/contenteditable.spec.ts`:

```ts
import { expect, setExtensionSettings, test } from './fixtures';

test('contenteditable selection humanizes and applies in place', async ({ context }) => {
  await setExtensionSettings(context, { defaultIntensity: 'full', useFakeProvider: true, disabledSites: [] });
  const page = await context.newPage();
  await page.goto('http://localhost:8787/page.html');
  await page.locator('#ce').evaluate(el => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  });
  const chip = page.locator('#humanizer-chip-host button');
  await expect(chip).toBeVisible();
  await chip.dispatchEvent('mousedown');
  const card = page.locator('#humanizer-card-host');
  await expect(card.locator('.rewritten')).toContainText('dig into');
  await card.locator('button.apply').click();
  await expect(page.locator('#ce')).toContainText('dig into');
  await expect(page.locator('#ce')).not.toContainText('\u2014');
});
```

`tests-e2e/disable.spec.ts`:

```ts
import { expect, setExtensionSettings, test } from './fixtures';

test('disabled site never shows the chip', async ({ context }) => {
  await setExtensionSettings(context, {
    defaultIntensity: 'full',
    useFakeProvider: true,
    disabledSites: ['localhost:8787'],
  });
  const page = await context.newPage();
  await page.goto('http://localhost:8787/page.html');
  await page.locator('#ta').evaluate(el => {
    const ta = el as HTMLTextAreaElement;
    ta.focus();
    ta.setSelectionRange(0, ta.value.length);
  });
  await page.waitForTimeout(600);
  await expect(page.locator('#humanizer-chip-host')).toHaveCount(0);
});
```

- [ ] **Step 7: Keep vitest and playwright apart**

In `vitest.config.ts`, the include already limits to `tests/**`, so no change. In `tsconfig.json`, extend `include` with `"tests-e2e/**/*", "playwright.config.ts"`.

- [ ] **Step 8: Run locally**

Run: `npm run build` then `npx playwright test`
Expected: 3 passed (a Chromium window flashes; headed mode is deliberate — extension loading is only guaranteed headed). If a spec times out on the chip, debug with `npx playwright test --headed --debug` rather than loosening assertions.

- [ ] **Step 9: CI**

Append these steps to `.github/workflows/ci.yml` after the `npm run zip` step, before the artifact upload:

```yaml
      - run: npx playwright install --with-deps chromium
      - run: npm run build
      - run: xvfb-run -a npx playwright test
```

- [ ] **Step 10: Verify full local gate**

Run: `npm run typecheck && npm test && npm run build && npx playwright test`
Expected: all green (65 unit + 3 e2e).

- [ ] **Step 11: Commit**

```bash
git add playwright.config.ts tests-e2e package.json package-lock.json tsconfig.json .github/workflows/ci.yml
git commit -m "test: playwright e2e for chip, apply, contenteditable, and per-site disable"
```

---

### Task 9: Docs and version sync

**Files:**
- Modify: `package.json` (version 0.2.0), `README.md`

- [ ] **Step 1: Bump version**

In `package.json`: `"version": "0.2.0"` (wxt propagates it to the manifest).

- [ ] **Step 2: Update README**

Replace the paragraph under the title (`Make AI drafts sound like you...` through `...Plan 1 (engine + popup paste box) of 2.`) with:

```markdown
Make AI drafts sound like you. Select text in any editable field, click the
Humanize chip, review the before/after with explained highlights, and Apply
replaces it in place. A popup paste box covers sites that block replacement.
Rewrites run on your device; real model engines (Gemini Nano, bring-your-own-key)
arrive in Plan 3 — today's build uses the deterministic quick-clean rules.

Status: in development. Plan 2 (page UX) of 3.
```

Add under the Develop section's command list:

```markdown
- `npm run e2e` runs Playwright against the built extension (run `npm run build` first)
```

- [ ] **Step 3: Verify and commit**

Run: `npm run build` (manifest version 0.2.0), `npm test` — green.

```bash
git add package.json package-lock.json README.md
git commit -m "docs: plan 2 usage and version 0.2.0"
```

---

## Spec coverage notes (self-review)

Covered: selection chip (10+ chars, editable-only), context menu incl. non-editable Copy-primary path, streaming card with highlight reasons + intensity re-run + engine label + Esc/outside dismiss, Apply with relocate-or-refuse, per-site disable (live via storage.onChanged + popup toggle), protocol hardening (ids, cancel, runtime validation, sender checks) per the spec's must-carry list, Playwright e2e with fake provider, permissions grown only by `contextMenus` + `activeTab`.

Deferred to Plan 3 (unchanged from spec must-carry): Nano/BYOK providers, options page, voice sample UI, error redaction, `firstAvailable` guard, icons, privacy policy, store packaging.

Known simplifications, intentional: chip position anchors to the field corner for inputs/textareas (no per-caret geometry); clipboard failures are silent in the card (status text only on Apply failure); `context-humanize` reuses the current selection at click time (Chrome guarantees the selection survives the context-menu click); non-http(s) pages hide the popup's per-site row.
