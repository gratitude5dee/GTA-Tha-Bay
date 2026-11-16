/**
 * M02h6 AC-4: the parked dressing on the `synth` bake at each flat tier, run 600 ticks beside the traffic sim (which parks its own cars):
 * no drawn slot is one the sim filled or could fill (its index is past `densityCap(capacity, tierFactors.parked[tier])`); every dressed
 * pose, archetype and colour equals the sim's rules (`parkedPose`, `slotUnit` with `pickArchetype` and the palette); no drawn car is inside
 * `ghostM` of the player or the camera, or by a live car (`nearLive`: within 0.6 car lengths of its body along the curb, inside its parking
 * lane; BD-M02h6-03) and no drawn body overlaps a live car's; the counts stay within the caps; the legacy look draws none.
 */
import { Group } from 'three/webgpu';
import { ambientKey, densityCap, worldSeedOf, type ChunkKey, type ParkedSlot, type QualityTierId, type SimChunk } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { FURNITURE, PARKED_STRIDE, meshChunk, parkedDressingRecords } from '../src/client/chunks/mesher.ts';
import { lookProfileFor } from '../src/client/look/config.ts';
import { createSkyNodes } from '../src/client/sky/nodes.ts';
import { ParkedDressing, dressFade, footprintsOverlap, nearLive, parkedLook, type DressingProfile } from '../src/client/traffic/parked-dressing.ts';
import { PALETTE, pickArchetype } from '../src/sim/traffic/components.ts';
import { DENSITY, profileName } from '../src/sim/traffic/density.ts';
import { parkedPose, slotUnit } from '../src/sim/traffic/spawn.ts';
import { bakeTiles } from './curbs.support.ts';
import { makeRig } from './fixtures/traffic.ts';

const TILES = bakeTiles('synth', 'parked-dressing', 1);
const TIERS: QualityTierId[] = ['desktop', 'mobile', 'mobile-low'];

describe('parked dressing on synth (AC-4)', () => {
  it('the legacy look (XR tiers, world.look off) has no dressing slots', () => {
    if (TILES.length === 0) return;
    for (const sim of (TILES[0] as (typeof TILES)[number]).sims) {
      expect(parkedDressingRecords(sim, 'xr-quest', 'legacy').length).toBe(0);
      expect(meshChunk(sim, null, { tier: 'xr-quest', distM: 0 }).parked?.length ?? 0).toBe(0);
    }
  });

  it.each(TIERS)('%s: 600 ticks beside the traffic sim', async (tier) => {
    if (TILES.length === 0) return;
    const t = TILES[0] as (typeof TILES)[number];
    const profile = lookProfileFor(tier) as DressingProfile;
    const bakeId = t.sims[0]?.bakeId as string;
    const seed = worldSeedOf(bakeId);
    // the busiest parked chunk of the tile is the focus
    const busy = [...t.sims].sort((a, b) => b.spawn.parked.length - a.spawn.parked.length)[0] as SimChunk;
    const slot0 = busy.spawn.parked[0] as ParkedSlot;
    const p0 = new Float64Array(6);
    parkedPose(busy, slot0, p0);
    const focus = { x: p0[0] as number, z: p0[2] as number, vx: 0, vz: 0 };
    const rig = await makeRig({ chunks: t.sims, tier, seed, focus, parked: true });
    const dressing = new ParkedDressing({ parent: new Group(), sky: createSkyNodes(), profile, bakeId });
    const byKey = new Map<string, { sim: SimChunk; index: number; slot: ParkedSlot }>();
    for (const sim of t.sims) {
      const m = meshChunk(sim, t.renders.find((r) => r.key === sim.key) ?? null, { tier, distM: 0, tile: t.sims });
      dressing.addUnit(`l0:${sim.key}`, m);
      sim.spawn.parked.forEach((slot, index) => byKey.set(`${sim.key}:${slot.slot}`, { sim, index, slot }));
      const recs = m.parked ?? new Float32Array(0);
      const cap = densityCap(sim.spawn.parked.length, DENSITY.tierFactors.parked[tier]);
      const pose = new Float64Array(6);
      for (let i = 0; i < recs.length; i += PARKED_STRIDE) {
        const s = recs[i + 4] as number;
        const at = byKey.get(`${sim.key}:${s}`);
        expect(at, `${sim.key}:${s} is a baked slot`).toBeDefined();
        if (!at) continue;
        // past the sim's prefix on this tier: the sim never fills it
        expect(at.index, `${sim.key}:${s} index against the prefix ${cap}`).toBeGreaterThanOrEqual(cap);
        // the sim's pose rule
        expect(parkedPose(sim, at.slot, pose)).toBe(true);
        expect(Math.abs(m.originX + (recs[i] as number) - (pose[0] as number))).toBeLessThan(1e-3);
        expect(Math.abs(m.originZ + (recs[i + 2] as number) - (pose[2] as number))).toBeLessThan(1e-3);
        expect(Math.abs((recs[i + 1] as number) - (pose[1] as number))).toBeLessThan(1e-3);
        // the sim's archetype and colour draws
        let arch = pickArchetype(slotUnit(seed, sim.key as ChunkKey, s, 1, 3), profileName(sim.spawn.densityProfile));
        if (arch === 3 || arch === 7) arch = 1;
        const color = Math.floor(slotUnit(seed, sim.key as ChunkKey, s, 1, 4) * PALETTE.length) % PALETTE.length;
        expect(parkedLook(seed, sim.key as ChunkKey, s, sim.spawn.densityProfile)).toEqual({ arch, color });
      }
    }
    const cfg = FURNITURE.parked;
    const ghost = cfg.ghostM[profile];
    let maxDrawn = 0, frames = 0;
    rig.run(600, (tick) => {
      if (tick % 6 !== 0) return;
      // the sim's live cars as the snapshot would carry them (ambient, flag 2, the sim's yaw quaternion), and the player at the focus
      const agents = rig.sim.agents.list();
      const poses = agents.map((a) => ({ px: a.x, pz: a.z, qx: 0, qy: Math.sin(a.yaw / 2), qz: 0, qw: Math.cos(a.yaw / 2), flags: 2 }));
      const filled = new Set(agents.map((a) => a.key));
      dressing.update({ camera: { pos: [focus.x, 8, focus.z + 6], dir: [0, 0, -1] }, player: { pos: [focus.x, 0, focus.z] } as never, poses: poses as never, poseCount: poses.length });
      const r = dressing.report(true);
      frames++;
      maxDrawn = Math.max(maxDrawn, r.instances);
      expect(r.instances).toBeLessThanOrEqual(cfg.caps[profile]);
      for (const d of r.drawn ?? []) {
        const [cell, slot] = [d.key.slice(0, d.key.lastIndexOf(':')), Number(d.key.slice(d.key.lastIndexOf(':') + 1))];
        expect(filled.has(ambientKey(cell as ChunkKey, slot)), `${d.key} is a live sim car`).toBe(false);
        expect(Math.hypot(d.x - focus.x, d.z - focus.z), `${d.key} inside ghostM of the player`).toBeGreaterThan(ghost);
        expect(Math.hypot(d.x - focus.x, d.z - (focus.z + 6)), `${d.key} inside ghostM of the camera`).toBeGreaterThan(ghost);
        const yaw = d.yaw;
        // (plain checks first: an expect per car pair costs minutes at desktop's cap)
        const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
        const bad: string[] = [];
        for (const a of agents) {
          if (nearLive({ x: d.x, z: d.z, yaw }, a.x, a.z, cfg, a.yaw)) bad.push(`${d.key} by live car ${a.key}`);
          // no overlap of the two bodies (a car of 4.6 by 1.9 m each way, in the slot's frame)
          const dx = a.x - d.x, dz = a.z - d.z;
          if (Math.abs(dx * fx + dz * fz) < cfg.carLengthM && Math.abs(dx * fz - dz * fx) < 1.9) bad.push(`${d.key} overlaps live car ${a.key}`);
          // nor with the live body turned by its own yaw (a car on a corner slot of the cross street; BD-M02h6-15)
          if (footprintsOverlap(dx, dz, yaw, a.yaw, cfg.carLengthM / 2, 0.95)) bad.push(`${d.key} overlaps turned live car ${a.key}`);
        }
        expect(bad).toEqual([]);
        expect(d.fade).toBeGreaterThan(0);
      }
    });
    expect(frames).toBe(100);
    expect(maxDrawn, `${tier}: dressing drawn`).toBeGreaterThan(0);
    expect(dressing.report().families.length).toBe(cfg.families[profile].length);
    dressing.dispose();
  });

  it('a live car on the cross street\'s corner slot hides the dressed slot it overlaps (BD-M02h6-15)', () => {
    const cfg = FURNITURE.parked;
    // the synth case: a dressed slot facing north at (1504.15, 6222), a sim-parked car facing east at (1506, 6220.15)
    const slot = { x: 1504.15, z: 6222, yaw: 6.2731852531433105 };
    expect(nearLive(slot, 1506, 6220.15, cfg, 4.75238898038469)).toBe(true);
    // the same car turned along the slot, 2.6 m across (the next lane): no overlap, the slot stays
    expect(nearLive(slot, slot.x + 2.6, slot.z, cfg, slot.yaw)).toBe(false);
    // a car crossing 5.5 m ahead of the slot's centre (turned 90 degrees, past the along-the-curb band): no overlap
    expect(nearLive(slot, slot.x, slot.z - 5.5, cfg, slot.yaw + Math.PI / 2)).toBe(false);
    // and inside the slot's footprint at any yaw: hidden
    for (const y of [0, 0.7, 1.6, 3.1]) expect(nearLive(slot, slot.x + 0.5, slot.z + 1.5, cfg, y)).toBe(true);
    expect(footprintsOverlap(0, 4.5, 0, 0, 2.3, 0.95)).toBe(true);
    expect(footprintsOverlap(0, 4.7, 0, 0, 2.3, 0.95)).toBe(false);
    expect(footprintsOverlap(3.2, 0, 0, Math.PI / 2, 2.3, 0.95)).toBe(true);
    expect(footprintsOverlap(3.3, 0, 0, Math.PI / 2, 2.3, 0.95)).toBe(false);
  });

  it('fades over fadeM past ghostM and before dressFarM', () => {
    expect(dressFade(20, 20, 25, 140, 8)).toBe(0);
    expect(dressFade(29, 29, 25, 140, 8)).toBeCloseTo(0.5);
    expect(dressFade(60, 60, 25, 140, 8)).toBe(1);
    expect(dressFade(60, 136, 25, 140, 8)).toBeCloseTo(0.5);
    expect(dressFade(200, 141, 25, 140, 8)).toBe(0);
  });
});
