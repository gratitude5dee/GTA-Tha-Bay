import { apiError } from '../errors.ts';
import { intent } from '../npc/intent.ts';
import type { Ctx } from '../router.ts';

/**
 * `POST /api/v1/npc/:npcId/intent` (route 32, M06c): a hero's light agency. Registered under the same `/api/v1/npc` prefix as the talk route
 * (`routes/npc-talk.ts` hands the `intent` suffix here). JSON in, JSON out; see `npc/intent.ts`.
 */
export function handleIntent(ctx: Ctx, npcId: string): Response | Promise<Response> {
  if (ctx.request.method !== 'POST') return apiError('bad_request', 'Method not allowed.', ctx.requestId, { status: 405, headers: { Allow: 'POST' } });
  return intent(ctx, npcId);
}
