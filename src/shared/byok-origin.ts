import type { ByokSettings } from './storage';

/**
 * Chrome match pattern for the provider origin, or null when none applies.
 * Match patterns must not contain a port; a hostname pattern covers all ports.
 */
export function byokOrigin(byok: ByokSettings): string | null {
  try {
    const url = new URL(byok.provider === 'anthropic' ? 'https://api.anthropic.com' : byok.baseUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return `${url.protocol}//${url.hostname}/*`;
  } catch {
    return null;
  }
}
