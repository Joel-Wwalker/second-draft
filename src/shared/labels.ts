import type { EngineInfo, HumanizeResult } from './types';

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

/** One-line result summary: change count plus the before/after tell score. */
export function resultStatus(result: HumanizeResult): string {
  const n = result.changes.length;
  const changes = `${n} change${n === 1 ? '' : 's'}`;
  // The rules engine only scans for mechanical tells: dashes, curly quotes, a
  // word list. "No AI tells detected" from it would claim a judgment it never
  // made, so say what actually ran instead.
  if (result.engine.kind === 'rules') return `${changes} · mechanical fixes only, no AI engine ran`;
  const { before, after } = result.tells;
  if (before === 0) return `${changes} · no AI tells detected`;
  return `${changes} · AI tells: ${before} → ${after}`;
}

/**
 * The big line above the output.
 *
 * Five paragraphs of GPT output once came back byte-identical under this
 * headline reading "Looks human already", because the on-device model was
 * unavailable and the rules fallback had quietly run instead. Whatever went
 * wrong, a state where the AI never looked at the text must never share a
 * headline with a state where it looked and approved.
 */
export function headline(result: HumanizeResult): string {
  if (result.engine.kind === 'rules') return 'AI engine unavailable';
  // An echo must never wear a score. Eight identical bug reports came from a
  // model returning the text as it arrived under "2 tells left".
  if (result.unchanged) return 'Came back unchanged';
  if (result.tells.before === 0) return 'Looks human already';
  if (result.tells.after === 0) return 'All clear';
  return `${result.tells.after} tell${result.tells.after === 1 ? '' : 's'} left`;
}
