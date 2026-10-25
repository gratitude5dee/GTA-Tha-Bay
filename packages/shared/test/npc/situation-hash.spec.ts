import { describe, expect, it } from 'vitest';
import type { StableKey } from '../../src/contracts/c01-ecs.ts';
import type { NPCIntentRequest } from '../../src/contracts/c10-npc.ts';
import { bucketDistance, intentCacheKey, normalizeSituation, situationHash } from '../../src/npc/situation-hash.ts';

const base: NPCIntentRequest['situation'] = {
  clockT: 1000, chunkKey: '9/84/197', poiId: 'poi.mission.shop-batista', activeBlock: 1,
  nearby: [{ key: 'player:0', kind: 'player', distM: 22 }, { key: 'npc:canary-mc', kind: 'npc', distM: 41 }],
  events: ['car_crash', 'rain_started'], relation: { trust: 55, met: true },
};

describe('situationHash', () => {
  it('ignores clockT', () => {
    expect(situationHash({ ...base, clockT: 99999 })).toBe(situationHash(base));
  });

  it('buckets distances to 10 m', () => {
    const near = { ...base, nearby: [{ key: 'player:0' as StableKey, kind: 'player' as const, distM: 24.9 }, { key: 'npc:canary-mc' as StableKey, kind: 'npc' as const, distM: 38 }] };
    expect(situationHash(near)).toBe(situationHash(base));
    const far = { ...base, nearby: [{ key: 'player:0' as StableKey, kind: 'player' as const, distM: 31 }, { key: 'npc:canary-mc' as StableKey, kind: 'npc' as const, distM: 41 }] };
    expect(situationHash(far)).not.toBe(situationHash(base));
    expect(bucketDistance(4.9)).toBe(0);
    expect(bucketDistance(5)).toBe(10);
    expect(bucketDistance(-3)).toBe(0);
    expect(bucketDistance(Number.NaN)).toBe(0);
  });

  it('does not depend on the order of nearby entries or events', () => {
    const shuffled = { ...base, nearby: [...base.nearby].reverse(), events: [...base.events].reverse() };
    expect(situationHash(shuffled)).toBe(situationHash(base));
  });

  it('changes with the scene', () => {
    expect(situationHash({ ...base, activeBlock: 2 })).not.toBe(situationHash(base));
    expect(situationHash({ ...base, events: [] })).not.toBe(situationHash(base));
    expect(situationHash({ ...base, relation: { trust: 56, met: true } })).not.toBe(situationHash(base));
    expect(situationHash({ ...base, poiId: null })).not.toBe(situationHash(base));
  });

  it('is lowercase sha-256 hex and the cache key names the NPC and soul version', () => {
    expect(situationHash(base)).toMatch(/^[0-9a-f]{64}$/);
    expect(intentCacheKey({ npcId: 'ro-batista', soulVersion: 2, situation: base })).toBe(`ro-batista:2:${situationHash(base)}`);
    expect(normalizeSituation(base)).not.toHaveProperty('clockT');
  });
});
