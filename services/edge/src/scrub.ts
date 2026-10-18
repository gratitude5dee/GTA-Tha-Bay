const MAX_SCRUBBED_CHARS = 512;

/**
 * C16 privacy scrub: strips bearer tokens, emails, query strings, and hex or base64 runs of 24 or more
 * characters, then truncates to 512 characters. Order matters: tokens first so their pieces are not split.
 */
export function scrub(input: string): string {
  return input
    .replace(/\bBearer\s+\S+/gi, '[redacted]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[redacted]')
    .replace(/\?[^\s#"']*/g, '')
    .replace(/\b[0-9a-fA-F]{24,}\b/g, '[redacted]')
    .replace(/[A-Za-z0-9+/]{24,}={0,2}/g, '[redacted]')
    .slice(0, MAX_SCRUBBED_CHARS);
}
