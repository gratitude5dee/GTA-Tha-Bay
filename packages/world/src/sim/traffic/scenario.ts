/**
 * The `traffic-synth` determinism scenario (M03b1, AC-8 and AC-9; DL-678): 10,000 `canonical` ticks, seed 0xC0FFEE, on the `synth` bake,
 * with the player standing at the City Hall arrival pose and a hash at every 600th tick. The Node runner (`packages/world/test`) and
 * the QA page (`apps/web/qa/world-hash.html`) share these definitions.
 *
 * Residency rule (DL-678), part of the definition and shared by every world scenario (`traffic-peds-synth`, `pursuit-escape`): before
 * tick 0 the runner requests, receives and pins every `p0` tile within the canonical `R_amb` plus one ring of chunks around the fixed
 * start; while the run goes it does not advance a tick while a requested `p0` is pending (it stalls, it never skips), and the sim
 * applies packs only at tick boundaries in request order, so the arrival time of a pack never enters the hash.
 *
 * Pure; C02 lint applies.
 */
import { chunkKeyAt, type ChunkKey, type WorldIndex } from '@dv/shared';
import { STREAMING } from '../streaming/plan.ts';
import { AMBIENT_RADIUS_M } from './density.ts';

export const TRAFFIC_SYNTH = {
  id: 'traffic-synth',
  seed: 0xc0ffee,
  ticks: 10_000,
  every: 600,
  profile: 'canonical',
  tier: 'mobile-low',
  /** Height above the ground the page places the player at (`SPAWN_LIFT_M` of the world boot). */
  spawnLiftM: 1.5,
} as const;

/**
 * The `p0` chunk keys of the residency set of a start point: every chunk within the canonical ambient radius plus the physics ring
 * plus one chunk, and one more ring (a chunk is 256 m). Only chunks whose tile exists in the bake are listed. Ascending order.
 */
export function preloadKeys(index: Pick<WorldIndex, 'tiles'>, x: number, z: number): ChunkKey[] {
  const tier = TRAFFIC_SYNTH.tier;
  const reach = Math.max(AMBIENT_RADIUS_M[tier], STREAMING.tiers[tier].physicsM) + 512;
  const have = new Set(index.tiles.p0);
  const [, cx, cy] = chunkKeyAt(9, x, z).split('/').map(Number) as [number, number, number];
  const n = Math.ceil(reach / 256);
  const out: ChunkKey[] = [];
  for (let j = -n; j <= n; j++) {
    for (let i = -n; i <= n; i++) {
      const kx = cx + i, ky = cy + j;
      if (kx < 0 || ky < 0) continue;
      if (!have.has(`${Math.floor(kx / 4)}-${Math.floor(ky / 4)}`)) continue;
      out.push(`9/${kx}/${ky}` as ChunkKey);
    }
  }
  return out;
}
