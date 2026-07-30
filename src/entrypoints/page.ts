import { attachOnce } from '../content/attach';

/**
 * The page side of the extension, injected on demand rather than declared for
 * every site.
 *
 * Nothing here needs to run at page load. It answers three messages, capture,
 * apply, and undo, and every one follows an explicit user gesture: the
 * right-click entry, the keyboard shortcut, or Apply in the popup. Injecting on
 * that gesture is what lets the manifest ask for activeTab instead of access to
 * every page anyone visits.
 *
 * An unlisted script rather than a content script on purpose. A content script
 * registered at runtime would make WXT add host_permissions for <all_urls>, which
 * is the very thing being avoided, and it would be granted at install rather than
 * on a gesture.
 *
 * The per-site switch is checked by the background before it injects, so a site
 * the user turned off never runs this at all.
 */
export default defineUnlistedScript(() => {
  attachOnce(document, globalThis as unknown as Record<string, unknown>);
});
