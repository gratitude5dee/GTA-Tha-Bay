import { apiError } from '../errors.ts';
import { talk } from '../npc/dialogue.ts';
import { handleIntent } from './npc-intent.ts';
import type { Ctx } from '../router.ts';

const PREFIX = '/api/v1/npc/';

/**
 * `POST /api/v1/npc/:npcId/talk` (route 31, M06a3). The route table registers the prefix `/api/v1/npc`; later NPC routes add their own suffix here (32, the intent route, is `routes/npc-intent.ts`, M06c). Unknown suffixes answer 404 like any other unknown path.
 */
export function handleNpc(ctx: Ctx): Response | Promise<Response> {
  const rest = ctx.url.pathname.startsWith(PREFIX) ? ctx.url.pathname.slice(PREFIX.length).split('/') : [];
  if (rest.length === 2 && rest[1] === 'talk' && rest[0] !== undefined && rest[0] !== '') {
    if (ctx.request.method !== 'POST') return apiError('bad_request', 'Method not allowed.', ctx.requestId, { status: 405, headers: { Allow: 'POST' } });
    return talk(ctx, decodeURIComponent(rest[0]));
  }
  // M06c: route 32, POST /api/v1/npc/:npcId/intent (JSON).
  if (rest.length === 2 && rest[1] === 'intent' && rest[0] !== undefined && rest[0] !== '') return handleIntent(ctx, decodeURIComponent(rest[0]));
  return apiError('not_found', 'No such route.', ctx.requestId);
}
