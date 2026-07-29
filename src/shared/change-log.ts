import type { HumanizeResult, Span } from './types';

export interface ChangeRow {
  reason: string;
  before: string;
  after: string;
}

const SNIPPET_MAX = 90;

/** Rows for the "What changed" log; pure, so the renderer stays dumb. */
export function formatChanges(result: HumanizeResult, original: string): ChangeRow[] {
  return result.changes.map(change => ({
    reason: change.reason,
    before:
      change.from && change.from.end > change.from.start ? snippet(original, change.from) : '(added)',
    after:
      change.range.end > change.range.start ? snippet(result.rewritten, change.range) : '(removed)',
  }));
}

function snippet(text: string, span: Span): string {
  const raw = text.slice(span.start, span.end).replace(/\s+/g, ' ').trim();
  return raw.length > SNIPPET_MAX ? `${raw.slice(0, SNIPPET_MAX - 3)}...` : raw;
}
