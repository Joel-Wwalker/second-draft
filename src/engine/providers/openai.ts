import { parseSSE } from '../../shared/sse';
import type { EngineInfo, Provider, RewriteRequest } from '../../shared/types';
import { HumanizerError } from '../../shared/types';
import { mapFetchError, safeParse, throwForStatus } from './anthropic';

export interface OpenAIConfig {
  /** e.g. https://api.openai.com/v1, https://openrouter.ai/api/v1, http://localhost:11434/v1 */
  baseUrl: string;
  apiKey: string;
  model: string;
}

export class OpenAIProvider implements Provider {
  readonly info: EngineInfo;

  constructor(
    private readonly cfg: OpenAIConfig,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    this.info = { kind: 'byok', model: cfg.model };
  }

  available(): Promise<boolean> {
    return Promise.resolve(this.cfg.apiKey.length > 0);
  }

  async rewrite(req: RewriteRequest): Promise<string> {
    const url = `${this.cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.cfg.apiKey}`,
        },
        body: JSON.stringify({
          model: this.cfg.model,
          stream: true,
          messages: [
            { role: 'system', content: req.systemPrompt },
            { role: 'user', content: req.text },
          ],
        }),
        signal: req.signal,
      });
    } catch (err) {
      throw mapFetchError(err, 'Could not reach the configured API endpoint.');
    }
    throwForStatus(res, 'the API endpoint');
    if (!res.body) throw new HumanizerError('network', 'The API endpoint returned an empty stream.');
    let out = '';
    try {
      for await (const data of parseSSE(res.body)) {
        if (data === '[DONE]') break;
        const evt = safeParse(data) as
          | { choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }> }
          | null;
        if (evt?.choices?.[0]?.finish_reason === 'length') {
          throw new HumanizerError('too-long', 'The rewrite hit the output limit. Split the selection.');
        }
        const delta = evt?.choices?.[0]?.delta?.content;
        if (typeof delta === 'string') {
          out += delta;
          req.onChunk?.(out);
        }
      }
    } catch (err) {
      if (err instanceof HumanizerError) throw err;
      throw mapFetchError(err, 'The connection to the API endpoint dropped mid-stream.');
    }
    return out;
  }
}
