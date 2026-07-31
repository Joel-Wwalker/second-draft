/**
 * The tell detector alone, bundled for node so an evaluation script can score
 * any batch with the current rules.
 *
 * Batch files store the tell count the engine computed at the time they ran, so
 * comparing that field across two runs measures the detector as much as the
 * rewrites: adding words to the list raises the stored count on the newer batch
 * without a single rewrite having got worse. Scoring both outputs here, with one
 * detector, is the only comparison that means anything.
 */
export { detect } from '../src/engine/rules';
