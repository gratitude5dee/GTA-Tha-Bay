import { apiError } from '../errors.ts';
import { readRoster } from '../flags/roster.ts';
import type { Ctx } from '../router.ts';

/** True when an If-None-Match header names the entity tag (strong or weak form, a list, or `*`). */
export function matchesEtag(header: string | null, etag: string): boolean {
  if (header === null) return false;
  const quoted = `"${etag}"`;
  return header.split(',').some((part) => {
    const p = part.trim();
    return p === '*' || p === quoted || p === `W/${quoted}`;
  });
}

/**
 * Route 30, `GET /api/v1/roster` -> `RosterFlags` (R-NPC-04). ETag and 304; `Cache-Control: no-cache` so every poll revalidates.
 * Source: Postgres through a 10 s isolate cache, KV only when that read fails (flags/roster.ts). Clients poll every 30 s while visible.
 */
export async function handleRoster(ctx: Ctx): Promise<Response> {
  let read;
  try {
    read = await readRoster(ctx.env, ctx.deps);
  } catch {
    // A configured database failed and KV holds no copy: an empty list would un-kill every NPC, so the answer is an error.
    return apiError('upstream_unavailable', 'The roster is temporarily unavailable.', ctx.requestId, { retryAfterMs: 5000 });
  }
  const headers: Record<string, string> = { ETag: `"${read.flags.etag}"`, 'Cache-Control': 'no-cache', 'X-DV-Roster-Source': read.source };
  if (matchesEtag(ctx.request.headers.get('If-None-Match'), read.flags.etag)) return new Response(null, { status: 304, headers });
  if (ctx.request.method === 'HEAD') return new Response(null, { status: 200, headers });
  return new Response(JSON.stringify(read.flags), { status: 200, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' } });
}
