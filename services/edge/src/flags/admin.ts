import type { FeatureFlag } from '@dv/shared';
import type { Env } from '../env.ts';
import { apiError } from '../errors.ts';
import type { Ctx } from '../router.ts';

/**
 * Staff access for the admin routes before staff JWTs exist (M12a1): a bearer `OPS_TOKEN`. Absent or wrong: 401. M12a1 replaces this
 * with the `scp` claim checked against `staff_roles` on every call; nothing else in the routes changes.
 */
async function sameSecret(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [da, db] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const x = new Uint8Array(da);
  const y = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

/** Returns the 401 response, or null when the request carries the ops token. */
export async function requireOps(ctx: Ctx): Promise<Response | null> {
  const h = ctx.request.headers.get('Authorization');
  const token = h !== null && h.startsWith('Bearer ') ? h.slice('Bearer '.length) : null;
  if (!ctx.env.OPS_TOKEN || token === null || !(await sameSecret(token, ctx.env.OPS_TOKEN))) {
    return apiError('unauthorized', 'A staff token is required.', ctx.requestId);
  }
  return null;
}

/** The audit actor of an ops-token call: a fixed label, never the token. */
export const OPS_ACTOR = { actor: 'ops-token', role: 'ops' } as const;

// ---- flag names of 09-backend-db.md section 5 ----

const KS_STATIC = new Set(['genai:all', 'anthropic', 'anthropic:sonnet', 'fal', 'cutscene_gen', 'npc_builder', 'tts:elevenlabs', 'tts:all', 'telemetry:verbose', 'rooms:new']);
const KS_FAL_ENDPOINT = /^fal:[a-z0-9][a-z0-9/._@-]{1,95}$/;
const KS_LIKENESS = /^likeness:[a-z][a-z0-9_-]{2,47}$/;

export const FEATURE_FLAGS: readonly FeatureFlag[] = [
  'mp.enabled', 'npc.dialogue', 'npc.voice', 'npc.builder', 'cutscene.generated', 'forum.enabled', 'ugc.publish', 'auth.openaiWeb', 'auth.thirdweb',
  'telemetry.verbose', 'mods.enabled', 'mods.script', 'mods.ui', 'auth.password',
];

export type ParsedFlag = { kind: 'ks'; key: string } | { kind: 'feature'; flag: FeatureFlag };

/** `ks:<name>` for a kill switch, `feature:<flag>` for an entry of `flags:features`; null for anything else. */
export function parseFlagName(name: string): ParsedFlag | null {
  if (name.startsWith('ks:')) {
    const n = name.slice(3);
    return KS_STATIC.has(n) || KS_FAL_ENDPOINT.test(n) || KS_LIKENESS.test(n) ? { kind: 'ks', key: name } : null;
  }
  if (name.startsWith('feature:')) {
    const f = name.slice('feature:'.length) as FeatureFlag;
    return FEATURE_FLAGS.includes(f) ? { kind: 'feature', flag: f } : null;
  }
  return null;
}

export interface KsRecord {
  on: boolean;
  reason: string;
  by: string;
  ts: number;
  expiresAt: number | null;
}

export async function readFeatures(env: Pick<Env, 'FLAGS'>): Promise<Partial<Record<FeatureFlag, boolean>>> {
  const raw = await env.FLAGS.get('flags:features', { type: 'json' });
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Partial<Record<FeatureFlag, boolean>>) : {};
}
