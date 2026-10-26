/**
 * The cache key of an intent request (04-npc-builder.md section C8; M06c): the server answers an identical situation from its 10-minute
 * cache. The hash leaves out `clockT` (the same moment of a different minute is the same situation) and buckets every distance to 10 m
 * (an NPC two metres closer is not a new situation). The trigger is not part of the situation, so a `player_near` and a `mission_state`
 * request for the same scene share an answer. Pure.
 */
import { canonicalize } from '../json.ts';
import { sha256Hex } from '../hash.ts';
import type { NPCIntentRequest } from '../contracts/c10-npc.ts';

export const DISTANCE_BUCKET_M = 10;

export const bucketDistance = (d: number): number => (Number.isFinite(d) && d > 0 ? Math.round(d / DISTANCE_BUCKET_M) * DISTANCE_BUCKET_M : 0);

/** The canonical, hash-ready view of a situation: no `clockT`, distances bucketed, `nearby` and `events` in a fixed order. */
export function normalizeSituation(s: NPCIntentRequest['situation']): Record<string, unknown> {
  const nearby = s.nearby
    .map((n) => ({ key: n.key, kind: n.kind, distM: bucketDistance(n.distM) }))
    .sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : a.distM - b.distM));
  return {
    chunkKey: s.chunkKey,
    poiId: s.poiId,
    activeBlock: s.activeBlock,
    nearby,
    events: [...s.events].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    relation: { trust: s.relation.trust, met: s.relation.met },
  };
}

/** Lowercase SHA-256 hex of the normalized situation. */
export const situationHash = (s: NPCIntentRequest['situation']): string => sha256Hex(canonicalize(normalizeSituation(s)));

/** The server cache key: `(npcId, soulVersion, sha256(situation))`. */
export const intentCacheKey = (r: Pick<NPCIntentRequest, 'npcId' | 'soulVersion' | 'situation'>): string =>
  `${r.npcId}:${r.soulVersion}:${situationHash(r.situation)}`;
