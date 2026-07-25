import type { EngineInfo, Provider, RewriteRequest } from '../../shared/types';
import { HumanizerError } from '../../shared/types';

/** Deterministic stand-in for a model. Used by tests and the dev/e2e builds. */
export class FakeProvider implements Provider {
  readonly info: EngineInfo = { kind: 'fake', model: 'fake-echo' };

  constructor(
    private readonly transform: (text: string) => string = defaultTransform,
    private readonly isAvailable = true,
  ) {}

  available(): Promise<boolean> {
    return Promise.resolve(this.isAvailable);
  }

  rewrite(req: RewriteRequest): Promise<string> {
    if (req.signal?.aborted) throw new HumanizerError('aborted');
    const out = this.transform(req.text);
    req.onChunk?.(out);
    return Promise.resolve(out);
  }
}

export function defaultTransform(text: string): string {
  return text.replace(/\bdelve into\b/gi, 'dig into').replace(/\bdelve\b/gi, 'dig');
}
