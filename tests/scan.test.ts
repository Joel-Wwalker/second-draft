// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { PageScan } from '../src/content/scan';

// Fixture sentences below are hand-verified against src/engine/rules.ts's ai-vocab regex (the
// only rule any of them trigger -- confirmed by running the exact regex against every string
// used here before writing these assertions, per the plan's "assert values, not shapes"
// discipline). Word counts in parentheses are the verified ai-vocab hits.
const P1 = 'The committee decided to delve into the crucial evidence before reaching a final decision.'; // delve, crucial (2)
const P2 =
  'Furthermore, the report examined several key findings from the field study conducted last spring.'; // Furthermore (1)
const LI = 'This vibrant new proposal changes how the team approaches quarterly planning entirely.'; // vibrant (1)
const H1 = 'Moreover, the enduring value of the framework outweighs its early complexity for most teams.'; // Moreover, enduring (2)
const H4 = 'This intricate design showcases a garnered level of craftsmanship rarely seen elsewhere.'; // intricate, showcases, garnered (3)
const BLOCKQUOTE_STANDALONE =
  'Reviewers were unanimous that the pilot program fosters real improvement across every team.'; // fosters (1)
const SHORT_P = 'We delve.'; // delve (1), but only 9 chars: must be excluded by the length gate
const EXT_HOST_P =
  'This delve pivotal crucial text lives inside an extension host and must never be scanned by the page scan feature.'; // delve, pivotal, crucial (3)
const BQ_FRAMING = 'Long before the quotation below appears in this section, here is some framing text.'; // 0 hits
const BQ_NESTED_P = 'She said the results were pivotal to the crucial launch date announcement made today.'; // pivotal, crucial (2)
const LI_WITH_SCRIPT_REAL_TEXT =
  'This list item has plenty of real prose to pass the length gate on its own merits certainly.'; // 0 hits
const P_WITH_TEXTAREA_REAL_TEXT =
  'Here is a paragraph with enough real content to count as a block on its own for this particular check.'; // 0 hits
const CE_DIRECT =
  'Typed directly into this editable region is a pivotal update about the crucial timeline change.'; // pivotal, crucial (2)
const HIDDEN_P = 'This hidden paragraph contains a delve reference that must never be counted by the scanner.'; // delve (1)

describe('PageScan.run() counting', () => {
  test('counts tells across multiple block types and excludes short blocks', () => {
    document.body.innerHTML = `
      <p>${P1}</p>
      <p>${P2}</p>
      <ul><li>${LI}</li></ul>
      <h1>${H1}</h1>
      <h4>${H4}</h4>
      <blockquote>${BLOCKQUOTE_STANDALONE}</blockquote>
      <p>${SHORT_P}</p>
    `;
    const scan = new PageScan(document);
    const summary = scan.run();
    // 2 + 1 + 1 + 2 + 3 + 1 = 10 tells across 6 blocks; SHORT_P (9 chars) contributes nothing
    // even though "delve" alone would be a hit if it were wrongly counted.
    expect(summary).toEqual({ tells: 10, blocks: 6, highlightsSupported: false });
  });

  test('the 40-character block-length gate is exact: 39 chars excluded, 40 chars included', () => {
    document.body.innerHTML = `
      <p>${'x'.repeat(39)}</p>
      <p>${'y'.repeat(40)}</p>
    `;
    const scan = new PageScan(document);
    expect(scan.run()).toEqual({ tells: 0, blocks: 1, highlightsSupported: false });
  });

  test('a block nested inside another block-level element is scanned once, not double counted', () => {
    // Testing discipline: the fixture has real nesting (blockquote > p), not a flat div. A naive
    // implementation that reads each candidate's own .textContent independently would count the
    // nested <p>'s text twice: once for the <p> itself and once as part of the <blockquote>'s
    // own total.
    document.body.innerHTML = `<blockquote>${BQ_FRAMING}<p>${BQ_NESTED_P}</p></blockquote>`;
    const scan = new PageScan(document);
    // blockquote's own block text is BQ_FRAMING only (0 hits); the nested <p> is its own
    // second block (2 hits). Total: 2 tells across 2 blocks, not 2 tells across 1, and not
    // 2 tells double-counted into 4.
    expect(scan.run()).toEqual({ tells: 2, blocks: 2, highlightsSupported: false });
  });

  test('a contenteditable root with no nested block elements is scanned as its own block', () => {
    document.body.innerHTML = `<div contenteditable="true">${CE_DIRECT}</div>`;
    const scan = new PageScan(document);
    expect(scan.run()).toEqual({ tells: 2, blocks: 1, highlightsSupported: false });
  });

  test("script and textarea content nested inside a block is excluded from that block's scanned text", () => {
    document.body.innerHTML = `
      <ul><li>${LI_WITH_SCRIPT_REAL_TEXT}<script>const s = "delve pivotal crucial";</script></li></ul>
      <p>${P_WITH_TEXTAREA_REAL_TEXT}<textarea>delve delve delve</textarea></p>
    `;
    const scan = new PageScan(document);
    // If script/textarea text leaked into block collection, this would be 6 tells (3 + 3), not 0.
    expect(scan.run()).toEqual({ tells: 0, blocks: 2, highlightsSupported: false });
  });

  test('a block hidden via inline display:none is excluded', () => {
    document.body.innerHTML = `
      <p style="display:none">${HIDDEN_P}</p>
      <p>${P1}</p>
    `;
    const scan = new PageScan(document);
    expect(scan.run()).toEqual({ tells: 2, blocks: 1, highlightsSupported: false });
  });

  test('run() reflects DOM changes made between scans (no stale candidate cache)', () => {
    document.body.innerHTML = `<p>${P1}</p>`;
    const scan = new PageScan(document);
    expect(scan.run()).toEqual({ tells: 2, blocks: 1, highlightsSupported: false });

    document.body.insertAdjacentHTML('beforeend', `<p>${P2}</p>`);
    expect(scan.run()).toEqual({ tells: 3, blocks: 2, highlightsSupported: false });
  });
});

describe('PageScan skip rules', () => {
  test("the extension's own hosts are never scanned, even when they contain block-like content", () => {
    document.body.innerHTML = `
      <p>${P1}</p>
      <div id="humanizer-chip-host"><p>${EXT_HOST_P}</p></div>
      <div id="humanizer-card-host"><p>${EXT_HOST_P}</p></div>
    `;
    const scan = new PageScan(document);
    // Each host paragraph is independently >= 40 chars and has 3 hits; if either host were
    // scanned this would be > 2 tells and/or > 1 block.
    expect(scan.run()).toEqual({ tells: 2, blocks: 1, highlightsSupported: false });
  });
});

describe('PageScan and the CSS Custom Highlight API (known jsdom limit)', () => {
  test('highlightsSupported is false in jsdom: counting still works when marking cannot happen', () => {
    // jsdom does not implement the CSS Custom Highlight API (no global CSS.highlights /
    // Highlight constructor). This is a documented, accepted limit (see plan's "Known
    // verification limits" and the manual-test matrix), not something these tests paper over:
    // this assertion grounds the claim in the actual test runtime rather than a comment.
    expect(typeof (globalThis as { Highlight?: unknown }).Highlight).toBe('undefined');
    document.body.innerHTML = `<p>${P1}</p>`;
    const scan = new PageScan(document);
    const summary = scan.run();
    expect(summary.tells).toBe(2);
    expect(summary.highlightsSupported).toBe(false);
  });

  test('clear() before any run(), and clear() called twice in a row, are both safe no-ops', () => {
    document.body.innerHTML = '<p>Hello world, this paragraph is here only to give the page a body.</p>';
    const scan = new PageScan(document);
    expect(() => scan.clear()).not.toThrow();
    expect(() => scan.clear()).not.toThrow();
  });
});

describe('PageScan non-mutation invariant', () => {
  const FIXTURE = `
    <p>${P1}</p>
    <ul><li>${LI}</li></ul>
    <div contenteditable="true">${CE_DIRECT}</div>
    <blockquote>${BLOCKQUOTE_STANDALONE}</blockquote>
  `;
  // Hand-verified total for FIXTURE: 2 + 1 + 2 + 1 = 6 tells across 4 blocks.

  test('document.body.textContent is identical before run(), after run(), and after clear()', () => {
    document.body.innerHTML = FIXTURE;
    const before = document.body.textContent;
    const scan = new PageScan(document);

    const summary = scan.run();
    expect(summary).toEqual({ tells: 6, blocks: 4, highlightsSupported: false });
    expect(document.body.textContent).toBe(before);

    scan.clear();
    expect(document.body.textContent).toBe(before);
  });

  test('a second run() (re-scan) still does not mutate text and reports the same summary', () => {
    document.body.innerHTML = FIXTURE;
    const before = document.body.textContent;
    const scan = new PageScan(document);

    const first = scan.run();
    const second = scan.run();
    expect(second).toEqual(first);
    expect(document.body.textContent).toBe(before);

    scan.clear();
    expect(document.body.textContent).toBe(before);
  });
});
