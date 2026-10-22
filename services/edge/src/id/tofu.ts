import type { PlayTokenClaims } from '@dv/shared';
import { apiError } from '../errors.ts';
import type { Ctx } from '../router.ts';
import { bindDeviceKey } from './bind.ts';
import { verify } from './playtoken.ts';

/**
 * P0 authentication for the routes that take `Authorization: PlayToken <tok>` (M06a1; routes 14, 31, 32, ...). The token is verified with
 * `PLAY_TOKEN_HMAC` and, inside the rotation window, `PLAY_TOKEN_HMAC_PREV` (id/playtoken.ts); the device key is bound on first use (id/bind.ts).
 * A token without the `18p` attestation never verifies, so nothing is stored for an under-18 player (D-30). With no database configured
 * (local runs, Previews) the token alone authenticates and nothing is stored.
 */
export interface PlayerAuth {
  profileId: string;
  /** RFC 7638 thumbprint of the device key, from the token. */
  dkt: string;
  claims: PlayTokenClaims;
}

export async function authenticatePlayer(ctx: Ctx): Promise<PlayerAuth | Response> {
  const h = ctx.request.headers.get('Authorization');
  if (h === null || !h.startsWith('PlayToken ')) return apiError('unauthorized', 'A play token is required.', ctx.requestId);
  const claims = await verify(ctx.env, h.slice('PlayToken '.length).trim(), ctx.deps.now());
  if (claims === null) return apiError('unauthorized', 'The play token is invalid or expired.', ctx.requestId);
  const bind = await bindDeviceKey(ctx, claims.pid, claims.dkt);
  if (bind !== null) return bind;
  return { profileId: claims.pid, dkt: claims.dkt, claims };
}
