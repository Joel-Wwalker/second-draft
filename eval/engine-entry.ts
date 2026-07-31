/**
 * The shipped engine, bundled for a plain page so evaluation batches run the
 * real pipeline: prompt building, style notes, enforcement, fidelity, and the
 * retry, not a hand-rolled approximation of them. Built by esbuild into
 * tests-e2e/fixtures/engine.js; see scripts/make-review-topics.mjs for use.
 */
export { humanize } from '../src/engine';
export { NanoProvider } from '../src/engine/providers/nano';
