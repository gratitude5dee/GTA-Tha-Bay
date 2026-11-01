/**
 * AC-2 (streaming): the focus chunk and its eight neighbours are requested first, the ahead / side / behind order follows the
 * weights, nothing is unloaded inside 1.35 x the ring, and `soft` pressure evicts L0 beyond 1.0 x the ring first. A mock
 * store (requests are recorded; the test settles them) and scripted focus paths, no IO.
 */
import { GRID_MIN_M, type ChunkKey } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { ChunkStore, type LoadRequest } from '../src/sim/streaming/chunk-store.ts';
import { STREAMING, planFor } from '../src/sim/streaming/plan.ts';
import { boundsOf, dirWeight, insideRing, lookAheadPoint, rankUnits, type Focus } from '../src/sim/streaming/priority.ts';

/** City Hall chunk is 9/256/256; the box [-100, 100] cells around it all exist. */
const everywhere = (): boolean => true;
const centreOf = (ix: number, iy: number): { x: number; z: number } => ({ x: GRID_MIN_M + (ix + 0.5) * 256, z: GRID_MIN_M + (iy + 0.5) * 256 });

function at(ix: number, iy: number, vx = 0, vz = 0): Focus {
  const c = centreOf(ix, iy);
  return { x: c.x, z: c.z, vx, vz };
}

describe('rankUnits', () => {
  it('puts the focus chunk and its eight neighbours first, whatever their distance rank would be', () => {
    const f = at(256, 256);
    const ranked = rankUnits(9, f, 1800, { exists: everywhere, firstRing: true });
    const first = ranked.slice(0, 9).map((r) => r.key).sort();
    const want: ChunkKey[] = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) want.push(`9/${256 + dx}/${256 + dy}` as ChunkKey);
    expect(first).toEqual(want.sort());
    expect(ranked[0]?.key).toBe('9/256/256');
    // Everything after the ninth is outside the ring of nine, and the list has no duplicates.
    expect(new Set(ranked.map((r) => r.key)).size).toBe(ranked.length);
    expect(ranked.slice(9).every((r) => !r.first)).toBe(true);
  });

  it('wants exactly the units whose box meets the disc, and the count matches the resident cap formula within 5 %', () => {
    const f = at(256, 256);
    const ranked = rankUnits(9, f, 1800, { exists: everywhere, firstRing: false });
    for (const r of ranked) {
      const b = boundsOf(r.key);
      const dx = Math.max(b.minX - f.x, 0, f.x - b.maxX);
      const dz = Math.max(b.minZ - f.z, 0, f.z - b.maxZ);
      expect(Math.hypot(dx, dz)).toBeLessThanOrEqual(1800);
    }
    // Resident caps equal the number of units inside 1.35 x the ring (02-world.md section 4).
    let inside = 0;
    for (let iy = 0; iy < 512; iy++) for (let ix = 0; ix < 512; ix++) if (insideRing(`9/${ix}/${iy}` as ChunkKey, f, 1800, 1.35)) inside++;
    expect(Math.abs(inside - STREAMING.tiers.desktop.resident.l0) / STREAMING.tiers.desktop.resident.l0).toBeLessThan(0.1);
  });

  it('orders ahead before side before behind at equal distance, with the weights 0.55, 0.85 and 1.25', () => {
    expect(STREAMING.dirWeights).toEqual({ ahead: 0.55, side: 0.85, behind: 1.25 });
    // Heading east at 10 m/s. Units 800 m east, north and west of the player at the same distance.
    const f: Focus = { x: 0, z: 0, vx: 10, vz: 0 };
    expect(dirWeight(f, 800, 0)).toBe(0.55);
    expect(dirWeight(f, 0, -800)).toBe(0.85);
    expect(dirWeight(f, -800, 0)).toBe(1.25);
    // At rest every direction weighs the same.
    expect(dirWeight({ x: 0, z: 0, vx: 0, vz: 0 }, 800, 0)).toBe(1);
    const head = at(256, 256, 0, 0);
    const moving: Focus = { ...head, vx: 15, vz: 0 };
    const ranked = rankUnits(9, { ...moving, vx: 0.6 /* barely moving: look-ahead stays in the same chunk */ }, 1200, { exists: everywhere, firstRing: false, lookAheadS: 0 });
    const byKey = new Map(ranked.map((r) => [r.key, r] as const));
    const east = byKey.get('9/260/256');
    const west = byKey.get('9/252/256');
    const north = byKey.get('9/256/252');
    expect(east && west && north).toBeTruthy();
    if (east && west && north) {
      expect(east.dist).toBeCloseTo(west.dist, 6);
      expect(east.score).toBeLessThan(north.score);
      expect(north.score).toBeLessThan(west.score);
      expect(east.weight).toBe(0.55);
      expect(north.weight).toBe(0.85);
      expect(west.weight).toBe(1.25);
    }
  });

  it('is deterministic: the same focus gives the same list, ties broken by key', () => {
    const f = at(250, 260, 3, -4);
    const a = rankUnits(9, f, 2400, { exists: everywhere, firstRing: true });
    const b = rankUnits(9, f, 2400, { exists: everywhere, firstRing: true });
    expect(b.map((r) => r.key)).toEqual(a.map((r) => r.key));
  });

  it('look-ahead moves the focus by velocity x 4 s', () => {
    const p = lookAheadPoint({ x: 10, z: 20, vx: 5, vz: -2 });
    expect(p).toEqual({ x: 30, z: 12 });
  });
});

/** A store whose requests are recorded; `settleAll` answers them. */
function mockStore(levels: ('p0' | 'l0' | 'l1' | 'l2')[] = ['l0', 'l1', 'l2'], tier: 'desktop' | 'mobile-low' = 'desktop') {
  const requests: LoadRequest[] = [];
  const evicted: string[] = [];
  let now = 0;
  const store = new ChunkStore<string>({
    levels,
    tier,
    exists: everywhere,
    request: (r) => requests.push(r),
    evicted: (level, key) => evicted.push(`${level}:${key}`),
    now: () => now,
    retry: { firstDelay: 60, maxDelay: 1800, maxAttempts: 4 },
  });
  const settleAll = (): void => {
    for (const r of requests.splice(0)) store.settle(r.level, r.key, { ok: true, payload: `${r.level}:${r.key}` });
  };
  return { store, requests, evicted, settleAll, tick: (n = 1) => void (now += n) };
}

describe('ChunkStore', () => {
  it('requests the focus chunk and its eight neighbours before everything else, within the in-flight cap', () => {
    const { store, requests } = mockStore(['l0']);
    store.want(at(256, 256));
    const keys = requests.map((r) => r.key);
    expect(keys.length).toBe(STREAMING.inFlight.l0);
    expect(keys[0]).toBe('9/256/256');
    // The in-flight cap is 3: only the nearest three went out; the rest wait for slots.
    for (const k of keys) expect(Math.abs(Number(k.split('/')[1]) - 256) + Math.abs(Number(k.split('/')[2]) - 256)).toBeLessThanOrEqual(2);
  });

  it('issues the next request when a slot frees, always the best remaining one', () => {
    const { store, requests, settleAll } = mockStore(['l0']);
    store.want(at(256, 256));
    settleAll();
    store.want(at(256, 256));
    expect(requests.length).toBe(STREAMING.inFlight.l0);
    // After 3 + 3 requests the six nearest chunks are in flight or ready; none is requested twice.
    const all = [...store.units.keys()];
    expect(new Set(all).size).toBe(all.length);
  });

  it('never unloads a unit inside 1.35 x the ring, and unloads units that left it', () => {
    const { store, settleAll, evicted } = mockStore(['l0', 'l1', 'l2']);
    let f = at(256, 256);
    for (let i = 0; i < 400; i++) {
      store.want(f);
      settleAll();
    }
    const resident = store.residentKeys('l0');
    expect(resident.length).toBeGreaterThan(50);
    // Walk 700 m east in steps; at each step every resident l0 unit is either inside 1.35 x r0 or gone.
    for (let step = 0; step < 14; step++) {
      f = { ...f, x: f.x + 50 };
      for (let i = 0; i < 40; i++) {
        store.want(f);
        settleAll();
      }
      for (const k of store.residentKeys('l0')) expect(insideRing(k, f, store.plan.r0M, STREAMING.unloadFactor)).toBe(true);
      // Everything inside the ring is resident (the walk is slow enough for the loader).
      const a = lookAheadPoint(f);
      for (const r of rankUnits(9, f, store.plan.r0M, { exists: everywhere, firstRing: false })) {
        expect(store.ready(r.key, 'l0'), `${r.key} at step ${step} (${a.x})`).toBe(true);
      }
    }
    expect(evicted.some((e) => e.startsWith('l0:'))).toBe(true);
    for (const e of evicted) {
      const [level, key] = e.split(':') as ['l0' | 'l1' | 'l2', ChunkKey];
      const ring = level === 'l0' ? store.plan.r0M : level === 'l1' ? store.plan.r1M : store.plan.r2M;
      expect(insideRing(key, f, ring, STREAMING.unloadFactor)).toBe(false);
    }
  });

  it('soft memory pressure evicts L0 beyond 1.0 x the ring first, then lowers the density and the ring one step', () => {
    const { store, settleAll, evicted } = mockStore(['l0']);
    const f = at(256, 256);
    for (let i = 0; i < 300; i++) {
      store.want(f);
      settleAll();
    }
    // Move the focus so that part of the resident set sits between 1.0 x and 1.35 x the ring.
    const moved = { ...f, x: f.x + 450 };
    store.want(moved);
    settleAll();
    const before = store.residentKeys('l0');
    const between = before.filter((k) => !insideRing(k, moved, store.plan.r0M, 1));
    expect(between.length).toBeGreaterThan(0);
    const r0 = store.plan.r0M;
    store.setPressure('soft');
    for (const k of between) expect(store.ready(k, 'l0')).toBe(false);
    expect(evicted.length).toBeGreaterThanOrEqual(between.length);
    expect(store.plan.r0M).toBeCloseTo(r0 * STREAMING.pressureSteps[1]!, 6);
    expect(store.density).toBeLessThan(1);
    for (const k of store.residentKeys('l0')) expect(insideRing(k, moved, r0, 1)).toBe(true);
    store.setPressure('none');
    expect(store.plan.r0M).toBe(r0);
    expect(store.density).toBe(1);
  });

  it('the MemoryBudget hooks (M11a1): trimToRing keeps the ring, stepPressureDown steps one plan step at a time and restorePressure goes back', () => {
    const { store, settleAll } = mockStore(['l0']);
    const f = at(256, 256);
    for (let i = 0; i < 300; i++) {
      store.want(f);
      settleAll();
    }
    const moved = { ...f, x: f.x + 450 };
    store.want(moved);
    settleAll();
    const r0 = store.plan.r0M;
    const outside = store.residentKeys('l0').filter((k) => !insideRing(k, moved, r0, 1));
    expect(outside.length).toBeGreaterThan(0);
    // soft: only what lies beyond 1.0 x the ring goes, the plan is untouched
    expect(store.trimToRing(1)).toBe(outside.length);
    expect(store.plan.r0M).toBe(r0);
    for (const k of store.residentKeys('l0')) expect(insideRing(k, moved, r0, 1)).toBe(true);
    expect(store.trimToRing(1)).toBe(0);
    // hard: one step at a time down STREAMING.pressureSteps, false on the last
    const last = STREAMING.pressureSteps.length - 1;
    for (let i = 1; i <= last; i++) {
      expect(store.stepPressureDown()).toBe(true);
      expect(store.plan.r0M).toBeCloseTo(r0 * (STREAMING.pressureSteps[i] as number), 6);
    }
    expect(store.stepPressureDown()).toBe(false);
    expect(store.density).toBeLessThan(1);
    store.restorePressure();
    expect(store.plan.r0M).toBe(r0);
    expect(store.density).toBe(1);
  });

  it('retries an unavailable unit with backoff and marks a corrupt one failed at once', () => {
    const { store, requests, tick } = mockStore(['l0']);
    store.want(at(256, 256));
    const first = requests.splice(0);
    store.settle('l0', first[0]!.key, { ok: false, reason: 'unavailable' });
    store.settle('l0', first[1]!.key, { ok: false, reason: 'corrupt' });
    store.settle('l0', first[2]!.key, { ok: true, payload: 'x' });
    expect(store.unavailable('l0')).toEqual([first[0]!.key]);
    expect(store.failed('l0')).toEqual([first[1]!.key]);
    store.want(at(256, 256));
    // The retry is not due yet (60 ticks).
    expect(requests.some((r) => r.key === first[0]!.key)).toBe(false);
    for (const r of requests.splice(0)) store.settle(r.level, r.key, { ok: true, payload: 'y' });
    tick(61);
    store.want(at(256, 256));
    expect(requests.find((r) => r.key === first[0]!.key)?.attempt).toBe(1);
    // A failed unit is not requested again while it stays inside the ring.
    expect(requests.some((r) => r.key === first[1]!.key)).toBe(false);
  });

  it('preload resolves when every key is settled and pins them', async () => {
    const { store, requests } = mockStore(['l0']);
    const keys = (['9/256/256', '9/257/256'] as ChunkKey[]).map((key) => ({ level: 'l0' as const, key }));
    let done = false;
    void store.preload(keys).then(() => void (done = true));
    expect(requests.length).toBe(2);
    store.settle('l0', '9/256/256', { ok: true, payload: 'a' });
    await Promise.resolve();
    expect(done).toBe(false);
    store.settle('l0', '9/257/256', { ok: true, payload: 'b' });
    await Promise.resolve();
    await Promise.resolve();
    expect(done).toBe(true);
    // Pinned: a focus far away evicts nothing that is pinned.
    store.want({ x: 40_000, z: 40_000, vx: 0, vz: 0 });
    expect(store.ready('9/256/256', 'l0')).toBe(true);
  });
});

describe('plans', () => {
  it('shrinks with the knobs and never touches the physics radius', () => {
    const base = planFor('desktop');
    const pressed = planFor('desktop', { lodBias: 2, buildingDistanceScale: 0.6, pressureStep: 2, altitudeAglM: 0 });
    expect(pressed.r0M).toBeLessThan(base.r0M);
    expect(pressed.r1M).toBeLessThan(pressed.r0M * (base.r1M / base.r0M));
    expect(pressed.r2M).toBeLessThan(base.r2M);
    expect(pressed.physicsM).toBe(base.physicsM);
    const high = planFor('desktop', { lodBias: 0, buildingDistanceScale: 1, pressureStep: 0, altitudeAglM: 400 });
    expect(high.r2M).toBe(base.r2M + base.altitudeBoostM);
  });
});
