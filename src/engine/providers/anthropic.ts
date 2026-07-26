import { parseSSE } from '../../shared/sse';
import type { EngineInfo, Provider, RewriteRequest } from '../../shared/types';
import { HumanizerError } from '../../shared/types';

export interface AnthropicConfig {
  apiKey: string;
  model: string;
}

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

export class AnthropicProvider implements Provider {
  readonly info: EngineInfo;

  constructor(
    private readonly cfg: AnthropicConfig,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    this.info = { kind: 'byok', model: cfg.model };
  }

  available(): Promise<boolean> {
    return Promise.resolve(this.cfg.apiKey.length > 0);
  }

  async rewrite(req: RewriteRequest): Promise<string> {
    let res: Response;
    try {
      res = await this.fetchFn(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.cfg.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: this.cfg.model,
          max_tokens: 8192,
          stream: true,
          system: req.systemPrompt,
          messages: [{ role: 'user', content: req.text }],
        }),
        signal: req.signal,
      });
    } catch (err) {
      throw mapFetchError(err, 'Could not reach the Anthropic API.');
    }
    throwForStatus(res, 'Anthropic');
    if (!res.body) throw new HumanizerError('network', 'Anthropic returned an empty stream.');
    let out = '';
    for await (const data of parseSSE(res.body)) {
      const evt = safeParse(data) as { type?: string; delta?: { type?: string; text?: string } } | null;
      if (evt?.type === 'content_block_delta' && evt.delta?.type === 'text_delta' && typeof evt.delta.text === 'string') {
        out += evt.delta.text;
        req.onChunk?.(out);
      }
    }
    return out;
  }
}

export function throwForStatus(res: Response, who: string): void {
  if (res.status === 401 || res.status === 403) {
    throw new HumanizerError('byok-auth', `API key rejected (${res.status}).`);
  }
  if (res.status === 429) throw new HumanizerError('byok-rate-limit', `Rate limited by ${who}.`);
  if (!res.ok) throw new HumanizerError('network', `${who} returned ${res.status}.`);
}

export function mapFetchError(err: unknown, message: string): HumanizerError {
  if (err instanceof DOMException && err.name === 'AbortError') return new HumanizerError('aborted');
  return new HumanizerError('network', message);
}

export function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}
