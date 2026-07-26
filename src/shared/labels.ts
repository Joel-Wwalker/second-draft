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
