import { HumanizeSession } from './session';

/** Marker left on the injected script's own global scope, not the page's. */
export const ATTACHED = '__secondDraftAttached';

/**
 * Start one session per document, however many times the script is injected.
 *
 * executeScript runs the file again every time the user invokes a rewrite on the
 * same page. Without this, the second run would add a second listener, and every
 * message would then be answered twice: two captures, or worse, two applies for
 * one click.
 *
 * The scope is passed in rather than reached for so this can be tested. In the
 * injected script it is `globalThis`, which persists across injections into the
 * same document.
 */
export function attachOnce(doc: Document, scope: Record<string, unknown>): HumanizeSession | null {
  if (scope[ATTACHED]) return null;
  scope[ATTACHED] = true;
  const session = new HumanizeSession(doc);
  session.start();
  return session;
}
