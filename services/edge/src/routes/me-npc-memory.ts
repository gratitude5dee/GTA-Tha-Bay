import { apiError } from '../errors.ts';
import { authenticatePlayer } from '../id/tofu.ts';
import type { Ctx } from '../router.ts';

const NPC_ID = /^[a-z][a-z0-9_-]{2,47}$/;

/**
 * `DELETE /api/v1/me/npc-memory?npcId=` (route 52, M06a4; P0 play token). Deletes the memory and relationship rows the NPC holds about the
 * calling player: `npcId` names one NPC; without it every NPC's rows go. The profile comes from the token, never from the query. The answer
 * is 204 with no body whether or not anything was stored. Transcripts are not touched (they expire after 30 days; `DELETE /me` removes them).
 * With no database configured nothing is stored, so the answer is 204 as well.
 */
export async function handleForgetNpcMemory(ctx: Ctx): Promise<Response> {
  const auth = await authenticatePlayer(ctx);
  if (auth instanceof Response) return auth;
  const raw = ctx.url.searchParams.get('npcId');
  if (raw !== null && !NPC_ID.test(raw)) return apiError('bad_request', 'The npcId is not valid.', ctx.requestId);
  const port = ctx.deps.data(ctx.env);
  if (port === null) return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  try {
    const gone = await port.maintenance.forgetNpcMemory(auth.profileId, raw);
    ctx.deps.log(JSON.stringify({ event: 'npc.memory.forget', scope: raw === null ? 'all' : 'one', memories: gone.memories, relationships: gone.relationships }));
  } catch {
    return apiError('upstream_unavailable', 'The memory store is temporarily unavailable.', ctx.requestId, { retryAfterMs: 5000 });
  }
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}
