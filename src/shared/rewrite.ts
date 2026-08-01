import { humanize } from '../engine';
import { FakeProvider } from '../engine/providers/fake';
import { NanoProvider } from '../engine/providers/nano';
import { AnthropicProvider } from '../engine/providers/anthropic';
import { OpenAIProvider } from '../engine/providers/openai';
import { getSettings } from './storage';
import type { Settings } from './storage';
import { redactError } from './redact';
import { HumanizerError } from './types';
import type { HumanizeResult, Intensity, Provider } from './types';

/** What a rewrite resolves to. Errors are values, so no caller can forget them. */
export type RewriteOutcome =
  | { ok: true; result: HumanizeResult }
  | { ok: false; kind: HumanizerError['kind']; message: string };

/**
 * The whole rewrite path, callable from any extension context that can reach
 * storage.
 *
 * It lived in the background service worker, behind a streaming port. It moved
 * to the popup because of where the Prompt API actually works: on a machine
 * where page contexts ran eight hundred batch rewrites in a day and the options
 * page could download the model, the worker still answered five requests with
 * the rules fallback, and no amount of status reporting changes what the worker
 * can see. Rewrites now run in the popup document, the same class of context as
 * everywhere the model demonstrably works. Closing the popup tears down the
 * context and the inference inside it, which is exactly what the port's
 * disconnect handler used to arrange by hand.
 */
export async function runRewrite(
  text: string,
  intensity: Intensity,
  signal?: AbortSignal,
  onChunk?: (textSoFar: string) => void,
): Promise<RewriteOutcome> {
  try {
    const settings = await getSettings();
    const result = await humanize(
      text,
      {
        intensity,
        signal,
        onChunk,
        voiceSample: settings.voiceSample || undefined,
        customTells: settings.customTells,
      },
      { providers: buildProviders(settings) },
    );
    return { ok: true, result };
  } catch (err) {
    const e = err instanceof HumanizerError ? err : new HumanizerError('internal', redactError(String(err)));
    if (e.kind !== 'aborted') console.error('[second-draft]', e.kind, redactError(e.message));
    return { ok: false, kind: e.kind, message: redactError(e.message) };
  }
}

/** Ordered by preference: a configured key first, then the on-device model. */
export function buildProviders(settings: Settings): Provider[] {
  if (settings.useFakeProvider) return [new FakeProvider()];
  const providers: Provider[] = [];
  const { byok } = settings;
  if (byok.provider === 'anthropic' && byok.apiKey) {
    providers.push(new AnthropicProvider({ apiKey: byok.apiKey, model: byok.model || 'claude-sonnet-4-5' }));
  } else if (byok.provider === 'openai' && byok.apiKey) {
    providers.push(
      new OpenAIProvider({ baseUrl: byok.baseUrl, apiKey: byok.apiKey, model: byok.model || 'gpt-4o-mini' }),
    );
  }
  providers.push(new NanoProvider());
  return providers;
}
