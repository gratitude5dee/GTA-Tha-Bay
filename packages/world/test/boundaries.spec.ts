import { describe, expect, it } from 'vitest';
import { GROUPS, GROUP_BIT, RapierBackend } from '@dv/engine/sim';
import {
  COUNTY_FOG_MIN, PLAY_WALL_MARGIN_M, WATER_WALL_DEPTH_M, WATER_WALL_DRY, WATER_WALL_TICKS, clampToPlayWall, countyFogFactor, waterWall,
  type ChunkKey, type Portal, type ShoreNode, type WaterWallState,
} from '@dv/shared';
import { BoundaryRuntime, COUNTY_RESET_M, COUNTY_TRIGGER_M, barrierPrism, playWallPrisms, shoreRespawnPose, type WorldBoundaryEvent } from '../src/sim/api/boundaries.ts';
import { createWorldApi } from '../src/sim/api/world-api.ts';
import { chunkOf, roads, topologyOf } from './fixtures/roads.ts';
import { indexOf, loadAll, storeOf } from './fixtures/world.ts';

const K = '9/256/256' as ChunkKey;
const none = roads([], []);

const county = (id: string, x: number, z: number, yaw = 0): Portal => ({ id, x, y: 2, z, yaw, widthM: 12, kind: 'county-line', state: 'closed', toArea: null, edges: [] });

describe('waterWall', () => {
  /** Calls it once per tick at a constant depth and returns the tick of each verdict. */
  const trace = (depthM: number, ticks: number): { stallAt: number | null; respawnAt: number | null } => {
    let s: WaterWallState = WATER_WALL_DRY;
    let stallAt: number | null = null;
    let respawnAt: number | null = null;
    for (let t = 1; t <= ticks; t++) {
      const r = waterWall(s, depthM, 1);
      s = r.state;
      if (r.verdict === 'stall' && stallAt === null) stallAt = t;
      if (r.verdict === 'respawn' && respawnAt === null) respawnAt = t;
    }
    return { stallAt, respawnAt };
  };

  it('stalls at tick 90 (not 89) at 0.7 m and respawns on the next step', () => {
    expect(WATER_WALL_TICKS).toBe(90);
    expect(WATER_WALL_DEPTH_M).toBe(0.6);
    expect(trace(0.7, 89)).toEqual({ stallAt: null, respawnAt: null });
    expect(trace(0.7, 120)).toEqual({ stallAt: 90, respawnAt: 91 });
  });

  it('never stalls at 0.5 m or at exactly 0.6 m', () => {
    expect(trace(0.5, 10_000)).toEqual({ stallAt: null, respawnAt: null });
    expect(trace(WATER_WALL_DEPTH_M, 10_000)).toEqual({ stallAt: null, respawnAt: null });
  });

  it('forgets the wet time when the body leaves the water, and counts a longer step', () => {
    let s: WaterWallState = WATER_WALL_DRY;
    for (let t = 0; t < 80; t++) s = waterWall(s, 1, 1).state;
    expect(s.wetTicks).toBe(80);
    s = waterWall(s, 0.2, 1).state;
    expect(s).toEqual({ wetTicks: 0, stalled: false });
    expect(waterWall(s, 1, 90).verdict).toBe('stall');
    expect(waterWall(s, 1, 89).verdict).toBe('ok');
    // a stalled body respawns even if the depth has dropped
    const stalled = waterWall(WATER_WALL_DRY, 1, 90).state;
    expect(waterWall(stalled, 0, 1).verdict).toBe('respawn');
  });
});

describe('respawn at the nearest road-adjacent shore node', () => {
  it('skips a nearer shore node with no road beside it, and faces inland', async () => {
    const f = roads([[-100, 100], [100, 100]], [{ a: 0, b: 1 }]);
    const shore = (id: string, x: number, z: number, nx: number, nz: number): ShoreNode => ({ id, x, y: 1, z, nx, nz });
    const base = chunkOf(K, f, { heightM: 5 });
    // the sea lies north (nz = -1); node a is 20 m from the swimmer but 100 m from the road, node b is 90 m away beside the road
    const chunk = { ...base, tags: { ...base.tags, shoreNodes: [shore('sn.a', 0, -20, 0, -1), shore('sn.b', 40, 95, 0, -1)] } };
    const store = storeOf([chunk]);
    await loadAll(store, [K]);
    const w = createWorldApi(store, indexOf(), { tick: () => 0 }, { topology: topologyOf(f) });
    expect(w.bounds.nearestShore(0, -40, false)!.id).toBe('sn.a');
    expect(w.bounds.nearestShore(0, -40, true)!.id).toBe('sn.b');
    const pose = w.shoreRespawn(0, -40, true)!;
    expect(pose.x).toBeCloseTo(40, 5);
    expect(pose.z).toBeCloseTo(97, 5);   // 2 m inland (south) of the node
    expect(pose.yaw).toBeCloseTo(Math.PI, 3);   // facing south, away from the sea: yaw pi
    expect(shoreRespawnPose(shore('x', 0, 0, 1, 0)).yaw).toBeCloseTo(Math.PI / 2, 3);   // sea to the east: face west
    expect(w.bounds.nearestShore(100000, 0, false)).toBeNull();
  });

  it('reads the water depth for the swim and the wall from the terrain below sea level', async () => {
    const c = chunkOf(K, none, { heightAt: (x) => (x < 0 ? -2 : 3), ground: (i) => (i < 32 ? 10 : 3) });
    const store = storeOf([c]);
    await loadAll(store, [K]);
    const w = createWorldApi(store, indexOf(), { tick: () => 0 });
    expect(w.bounds.waterDepth(-40, 0)).toBeCloseTo(2, 5);
    expect(w.bounds.waterDepth(40, 0)).toBe(0);
  });
});

describe('play bounds wall', () => {
  const play = { minX: -9400, maxX: 6200, minZ: -6300, maxZ: 8900 };

  it('stops a ground body pushed 60 m past play at play plus 50 m', () => {
    const east = clampToPlayWall(play.maxX + 60, 0, play);
    expect(east).toEqual({ x: play.maxX + PLAY_WALL_MARGIN_M, z: 0, clamped: true });
    const corner = clampToPlayWall(play.minX - 60, play.maxZ + 60, play);
    expect([corner.x, corner.z]).toEqual([play.minX - 50, play.maxZ + 50]);
    expect(clampToPlayWall(100, 100, play)).toEqual({ x: 100, z: 100, clamped: false });
    expect(clampToPlayWall(play.maxX + 50, 0, play).clamped).toBe(false);
  });

  it('builds four boxes that begin exactly at play plus 50 m', () => {
    const p = playWallPrisms(play);
    expect(p.length).toBe(4 * (3 + 8));
    const boxes: { minX: number; maxX: number; minZ: number; maxZ: number }[] = [];
    for (let i = 0; i < p.length; i += 11) {
      expect(p[i]).toBe(4);
      const xs = [p[i + 3], p[i + 5], p[i + 7], p[i + 9]] as number[];
      const zs = [p[i + 4], p[i + 6], p[i + 8], p[i + 10]] as number[];
      boxes.push({ minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) });
    }
    const [west, east, north, south] = boxes as [typeof boxes[0], typeof boxes[0], typeof boxes[0], typeof boxes[0]];
    expect(west.maxX).toBe(play.minX - 50);
    expect(east.minX).toBe(play.maxX + 50);
    expect(north.maxZ).toBe(play.minZ - 50);
    expect(south.minZ).toBe(play.maxZ + 50);
    // nothing of a box lies inside the walkable area
    for (const b of boxes) {
      const inside = b.maxX > play.minX - 50 && b.minX < play.maxX + 50 && b.maxZ > play.minZ - 50 && b.minZ < play.maxZ + 50;
      expect(inside).toBe(false);
    }
  });
});

describe('play bounds wall in the physics world', () => {
  const play = { minX: -9400, maxX: 6200, minZ: -6300, maxZ: 8900 };
  const opts = { autostepM: 0.4, snapToGroundM: 0.5, maxSlopeDeg: 45, slide: true };

  /** A capsule pushed `dx, dz` from a start inside play, in one move and in 1 m steps; returns where it ends up. */
  async function push(from: [number, number], dx: number, dz: number, steps: number): Promise<[number, number]> {
    const backend = new RapierBackend('deterministic-compat');
    await backend.init();
    backend.addChunkStatics('world.bounds', { prisms: Float32Array.from(playWallPrisms(play)) });
    const body = backend.createBody({ kind: 'kinematic', shape: 'capsule', dims: [0.55, 0.35], at: [from[0], 0.91, from[1]], groups: GROUPS.character });
    backend.step(1 / 60, 1);
    let x = from[0], z = from[1];
    for (let i = 0; i < steps; i++) {
      const r = backend.character.move(body, [dx / steps, 0, dz / steps], opts);
      x += r.moved[0];
      z += r.moved[2];
      backend.setKinematicTarget(body, [x, 0.91, z], [0, 0, 0, 1]);
      backend.step(1 / 60, 1);
    }
    backend.dispose();
    return [x, z];
  }

  it('stops a ground body pushed 60 m past play at play plus 50 m, on every side', async () => {
    expect(GROUP_BIT.static).toBeGreaterThan(0);
    const margin = 50 - 0.35;   // the capsule's own radius sits inside the wall
    const [ex] = await push([play.maxX - 5, 0], 65, 0, 65);
    expect(ex).toBeGreaterThan(play.maxX + margin - 0.25);
    expect(ex).toBeLessThan(play.maxX + 50);
    const [wx] = await push([play.minX + 5, 0], -65, 0, 65);
    expect(wx).toBeLessThan(play.minX - margin + 0.25);
    expect(wx).toBeGreaterThan(play.minX - 50);
    const [, sz] = await push([0, play.maxZ - 5], 0, 65, 65);
    expect(sz).toBeGreaterThan(play.maxZ + margin - 0.25);
    expect(sz).toBeLessThan(play.maxZ + 50);
    const [, nz] = await push([0, play.minZ + 5], 0, -65, 65);
    expect(nz).toBeLessThan(play.minZ - margin + 0.25);
    expect(nz).toBeGreaterThan(play.minZ - 50);
    // one move of 65 m is stopped as well
    const [bx] = await push([play.maxX - 5, 0], 65, 0, 1);
    expect(bx).toBeLessThan(play.maxX + 50);
    // inside the play box nothing is in the way
    const [ix] = await push([0, 0], 40, 0, 40);
    expect(ix).toBeCloseTo(40, 3);
  }, 60_000);
});

describe('county line', () => {
  it('shrinks the fog far plane from 1 at 150 m to 0.4 at the line', () => {
    expect(countyFogFactor(150)).toBe(1);
    expect(countyFogFactor(400)).toBe(1);
    expect(countyFogFactor(0)).toBe(COUNTY_FOG_MIN);
    expect(countyFogFactor(0)).toBeCloseTo(0.4, 12);
    expect(countyFogFactor(75)).toBeCloseTo(0.7, 12);
    expect(countyFogFactor(-3)).toBe(COUNTY_FOG_MIN);
    const b = new BoundaryRuntime([county('portal.cl.1', 0, 0)]);
    b.step(1, { x: 0, z: 150 });
    expect(b.fog).toBe(1);
    b.step(2, { x: 0, z: 0 });
    expect(b.fog).toBeCloseTo(0.4, 12);
    b.step(3, { x: 0, z: 100 });
    expect(b.fog).toBeCloseTo(0.4 + 0.6 * (100 / 150), 12);
    b.step(4, null);
    expect(b.fog).toBe(1);
    expect(new BoundaryRuntime([]).distToCountyLine(0, 0)).toBe(Infinity);
  });

  it('pushes the world.boundary event once per approach and again after the player has gone away', () => {
    const events: WorldBoundaryEvent[] = [];
    const b = new BoundaryRuntime([county('portal.cl.1', 0, 0), county('portal.cl.2', 400, 0), { ...county('portal.ggb', 1000, 0), kind: 'bridge' }], (e) => events.push(e));
    // walk in from 100 m north to the line, hover about, walk back out to 120 m, then in again
    let tick = 0;
    for (let z = -100; z <= 0; z += 5) b.step(++tick, { x: 0, z });
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ tick: expect.any(Number), s: 'countyLine' });
    for (let i = 0; i < 100; i++) b.step(++tick, { x: 3, z: 2 });   // standing at the wall does not repeat it
    for (let z = 0; z >= -(COUNTY_TRIGGER_M + 5); z -= 5) b.step(++tick, { x: 0, z });
    expect(events).toHaveLength(1);   // still within the reset distance
    for (let z = -(COUNTY_TRIGGER_M + 5); z >= -(COUNTY_RESET_M + 10); z -= 5) b.step(++tick, { x: 0, z });
    for (let z = -(COUNTY_RESET_M + 10); z <= 0; z += 5) b.step(++tick, { x: 0, z });
    expect(events).toHaveLength(2);
    expect(b.lastEvent).toBe(events[1]);
    // the bridge portal is not the county line
    b.step(++tick, { x: 1000, z: 0 });
    expect(events).toHaveLength(2);
  });

  it('builds a barrier across the road at the portal, a metre or more thick, covering the road and a shoulder', () => {
    const p = barrierPrism({ x: 100, y: 3, z: 200, yaw: 0, widthM: 12 });
    expect(p[0]).toBe(4);
    expect(p[1]).toBe(2);
    expect(p[2]).toBe(4);
    const xs = [p[3], p[5], p[7], p[9]] as number[];
    const zs = [p[4], p[6], p[8], p[10]] as number[];
    // yaw 0 faces north (-z): the road runs along z, the barrier spans x
    expect(Math.min(...xs)).toBeCloseTo(100 - 7.5, 2);
    expect(Math.max(...xs)).toBeCloseTo(100 + 7.5, 2);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(0.8, 2);
    const east = barrierPrism({ x: 0, y: 0, z: 0, yaw: Math.PI * 1.5, widthM: 10 });
    const ez = [east[4], east[6], east[8], east[10]] as number[];
    expect(Math.max(...ez) - Math.min(...ez)).toBeCloseTo(13, 1);
  });

  it('puts the county barriers of a chunk into its statics', () => {
    const b = new BoundaryRuntime([county('portal.cl.1', 10, 10), county('portal.cl.2', 5000, 5000)]);
    const key = (x: number): ChunkKey => (x < 200 ? K : ('9/275/275' as ChunkKey));
    expect(b.barriersIn(K, key)).toHaveLength(11);
    expect(b.barriersIn('9/270/270' as ChunkKey, key)).toHaveLength(0);
  });
});
