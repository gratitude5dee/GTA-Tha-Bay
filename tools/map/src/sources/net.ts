/** Small fetch wrapper for the bake: host denylist (DL-676), retries with backoff, optional headers. */
import { assertAllowedHost } from '../config.ts';

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class HttpError extends Error {
  constructor(readonly status: number, readonly url: string) {
    super(`HTTP ${status} for ${url}`);
    this.name = 'HttpError';
  }
}

export async function fetchBuffer(url: string, opts: { headers?: Record<string, string>; retries?: number } = {}): Promise<Buffer> {
  assertAllowedHost(url);
  const retries = opts.retries ?? 4;
  let last: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'tha-bay-map-bake/0.2 (open-data bake; contact: repo owner)', ...opts.headers } });
      if (res.status === 404 || res.status === 403) throw new HttpError(res.status, url);
      if (!res.ok) throw new HttpError(res.status, url);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      last = e;
      if (e instanceof HttpError && (e.status === 404 || e.status === 403)) throw e;
      if (attempt < retries) await sleep(500 * 2 ** attempt);
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}
