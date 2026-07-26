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
  const { before, after } = result.tells;
  if (before === 0) return `${changes} · no AI tells detected`;
  return `${changes} · AI tells: ${before} → ${after}`;
}
