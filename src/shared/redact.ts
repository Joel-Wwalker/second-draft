const MAX_ERROR_CHARS = 200;

/** Strip secrets and URLs from error text before it reaches any UI or log. */
export function redactError(message: string): string {
  const redacted = message
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, 'sk-***')
    .replace(/https?:\/\/([^\s/?#]+)[^\s]*/g, '[$1]');
  return redacted.length > MAX_ERROR_CHARS ? `${redacted.slice(0, MAX_ERROR_CHARS)}...` : redacted;
}
