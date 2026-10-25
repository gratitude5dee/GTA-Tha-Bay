/**
 * `NpcLodSystem` (04-npc-builder.md section C8; M06c): LOD A within 60 m of the player (full brain, every 3rd AI tick, 10 Hz), B within
 * 250 m (schedule movement only, every 15th AI tick, 2 Hz), C beyond (not simulated). The tier caps how many NPCs may be at A at once;
 * the nearest keep it and the rest run at B. A radius is widened by `hysteresisM` for an NPC that is already inside, so one that stands on
 * the boundary does not change tier every pass. Sim code; C02 lint applies.
 */
import { dsqrt } from '@dv/shared';
import { LOD, type LodTier, type NpcAgent } from './agent.ts';
import type { BrainConfig } from './config.ts';

export interface LodCounts {
  a: number;
  b: number;
  c: number;
}

const byDistance = (x: { d: number; slot: number }, y: { d: number; slot: number }): number => x.d - y.d || x.slot - y.slot;

/**
 * Assigns a tier to every agent from its position and returns the counts. With no player nothing is simulated (all C). `cap` is the tier's
 * LOD-A limit. `dist` receives each agent's distance (for the debug overlay).
 */
export function assignLod(
  agents: readonly NpcAgent[],
  player: { x: number; z: number } | null,
  cap: number,
  cfg: BrainConfig,
  scratch: { d: number; slot: number }[] = [],
): LodCounts {
  const out: LodCounts = { a: 0, b: 0, c: 0 };
  scratch.length = 0;
  const { aRadiusM, bRadiusM, hysteresisM } = cfg.lod;
  for (const a of agents) {
    if (!a.enabled || !player) {
      a.lod = LOD.C;
      continue;
    }
    // a conversation keeps its NPC at A whatever the cap says
    if (a.talking) {
      a.lod = LOD.A;
      continue;
    }
    const dx = a.x - player.x;
    const dz = a.z - player.z;
    const d = dsqrt(dx * dx + dz * dz);
    const wasA = a.lod === LOD.A;
    const wasAB = a.lod !== LOD.C;
    let tier: LodTier;
    if (d <= aRadiusM + (wasA ? hysteresisM : 0)) tier = LOD.A;
    else if (d <= bRadiusM + (wasAB ? hysteresisM : 0)) tier = LOD.B;
    else tier = LOD.C;
    if (tier === LOD.A) scratch.push({ d, slot: a.slot });
    a.lod = tier;
  }
  if (scratch.length > cap) {
    scratch.sort(byDistance);
    for (let i = cap; i < scratch.length; i++) {
      const s = scratch[i] as { slot: number };
      const a = agents[s.slot];
      if (a) a.lod = LOD.B;
    }
  }
  for (const a of agents) {
    if (!a.enabled) continue;
    if (a.lod === LOD.A) out.a++;
    else if (a.lod === LOD.B) out.b++;
    else out.c++;
  }
  return out;
}
