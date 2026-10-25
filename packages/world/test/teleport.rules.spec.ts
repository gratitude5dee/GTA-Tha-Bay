import { describe, expect, it } from 'vitest';
import { GroundClass, type ChunkKey, type TeleportKind, type TeleportResult, type TeleportTarget, type TransitNode } from '@dv/shared';
import { FADE_TICKS, PRESTREAM_TICKS, SANDBOX_POLICY, type TeleportPolicy } from '../src/sim/api/teleport.ts';
import { createWorldApi, type WorldServices } from '../src/sim/api/world-api.ts';
import { chunkOf, roads } from './fixtures/roads.ts';
import { FakeHost, indexOf, landmarkAt, loadAll, storeOf } from './fixtures/world.ts';

const K = '9/256/256' as ChunkKey;
const E = '9/257/256' as ChunkKey;
const none = roads([], []);

interface Rig {
  w: WorldServices;
  host: FakeHost;
  /** The sim tick the rig is at. */
  tick: number;
  policy: { allowed: boolean; heat: number };
  /** Runs ticks until the request settles (or `max` ticks pass) and returns its result and how many ticks it took. */
  run(p: Promise<TeleportResult>, max?: number): Promise<{ r: TeleportResult | null; ticks: number }>;
}

async function rig(o: {
  chunks?: Parameters<typeof storeOf>[0];
  deliver?: (k: ChunkKey) => boolean;
  known?: readonly ChunkKey[];
  start?: [number, number, number] | null;
  transit?: TransitNode[];
  landmarks?: ReturnType<typeof landmarkAt>[];
  resident?: readonly ChunkKey[];
}): Promise<Rig> {
  const chunks = o.chunks ?? [chunkOf(K, none, { heightM: 5 }), chunkOf(E, none, { heightM: 5 })];
  const store = storeOf(chunks, { ...(o.deliver ? { deliver: o.deliver } : {}), ...(o.known ? { known: o.known } : {}) });
  await loadAll(store, o.resident ?? chunks.map((c) => c.key));
  const host = new FakeHost(o.start === undefined ? [0, 5, 0] : o.start);
  const state = { allowed: true, heat: 0 };
  const policy: TeleportPolicy = { allowed: () => state.allowed, heat: () => state.heat };
  const t = { tick: 0 };
  const w = createWorldApi(store, indexOf({ transit: o.transit ?? [], landmarks: o.landmarks ?? [] }), { tick: () => t.tick }, { host, policy });
  const r: Rig = {
    w, host, policy: state,
    get tick() { return t.tick; },
    set tick(v: number) { t.tick = v; },
    async run(p, max = 2000) {
      let result: TeleportResult | null = null;
      void p.then((x) => { result = x; });
      const start = t.tick;
      for (let i = 0; i < max && result === null; i++) {
        t.tick++;
        await Promise.resolve();
        await Promise.resolve();
        host.tick();
        w.teleport.step(t.tick);
        await Promise.resolve();
      }
      return { r: result, ticks: t.tick - start };
    },
  };
  return r;
}

const go = (rg: Rig, kind: TeleportKind, to: TeleportTarget) => rg.run(rg.w.teleport.request(kind, to));

describe('TeleportApi pre-stream', () => {
  it('answers not-loaded after 8 s when the destination tile never arrives, with the player unmoved', async () => {
    const rg = await rig({ chunks: [chunkOf(K, none, { heightM: 5 }), chunkOf(E, none, { heightM: 5 })], deliver: () => false, resident: [] });
    const p = rg.w.teleport.request('sandbox', { x: 200, z: 0 });
    let r: TeleportResult | null = null;
    void p.then((x) => { r = x; });
    for (let i = 0; i < PRESTREAM_TICKS - 1; i++) {
      rg.tick++;
      await Promise.resolve();
      rg.w.teleport.step(rg.tick);
    }
    await Promise.resolve();
    expect(r).toBeNull();
    rg.tick++;
    rg.w.teleport.step(rg.tick);
    await Promise.resolve();
    expect(r).toEqual({ ok: false, reason: 'not-loaded', messageKey: 'world.teleport.notLoaded' });
    expect(rg.host.pos).toEqual([0, 5, 0]);
    expect(rg.host.begun).toEqual([]);
    expect(rg.host.fades).toEqual([]);
    expect(rg.w.teleport.busy).toBe(false);
  });

  it('requests the destination chunk and the ring around it as needNow and releases the pins afterwards', async () => {
    const asked: ChunkKey[] = [];
    const chunks = [chunkOf(K, none, { heightM: 5 }), chunkOf(E, none, { heightM: 5 })];
    const rg = await rig({ chunks, deliver: (k) => { asked.push(k); return true; }, resident: [], known: [K, E, '9/258/256' as ChunkKey, '9/257/255' as ChunkKey] });
    const { r } = await go(rg, 'sandbox', { x: 200, z: 0 });
    expect(r?.ok).toBe(true);
    // chunk 9/257/256 and its existing neighbours: 9/256/256, 9/258/256, 9/257/255
    expect(new Set(asked)).toEqual(new Set([E, K, '9/258/256', '9/257/255']));
  });
});

describe('WorldServices.prestream (DL-736: the pre-stream of step 2 alone, for a checkpoint resume)', () => {
  it('asks for the chunk under the point and its ring as needNow, is ready only once all of them are resident, and unpins on release', async () => {
    const asked: ChunkKey[] = [];
    const N = '9/257/255' as ChunkKey;
    const chunks = [chunkOf(K, none, { heightM: 5 }), chunkOf(E, none, { heightM: 5 }), chunkOf(N, none, { heightM: 5 })];
    const store = storeOf(chunks, { deliver: (k) => { asked.push(k); return false; }, known: [K, E, N] });
    const w = createWorldApi(store, indexOf(), { tick: () => 0 }, {});
    const t = w.prestream(200, 0);
    // chunk 9/257/256 and its neighbours the bake has: 9/256/256, 9/257/255; nothing resident yet
    expect(new Set(asked)).toEqual(new Set([E, K, N]));
    expect(t.ready()).toBe(false);
    store.settle('p0', E, { ok: true, payload: chunks[1]! });
    expect(t.ready()).toBe(false);
    store.settle('p0', K, { ok: true, payload: chunks[0]! });
    expect(t.ready()).toBe(false);
    store.settle('p0', N, { ok: true, payload: chunks[2]! });
    expect(t.ready()).toBe(true);
    // pinned until released: the units are kept whatever the focus; after release the ticket answers false
    const pins = (store as unknown as { pinned: Set<string> }).pinned;
    expect(pins.size).toBe(3);
    // the streaming module feeds the colliders around the held point (as for a teleport's destination) until it is released
    expect(w.teleport.prestreamFocus()).toEqual({ x: 200, z: 0 });
    t.release();
    expect(w.teleport.prestreamFocus()).toBeNull();
    t.release();
    expect(pins.size).toBe(0);
    expect(t.ready()).toBe(false);
    // it validates, places, fades and moves nothing: the teleport stays idle
    expect(w.teleport.busy).toBe(false);
  });

  it('a point whose chunk the bake does not have is never ready', async () => {
    const store = storeOf([chunkOf(K, none, { heightM: 5 })]);
    await loadAll(store, [K]);
    const w = createWorldApi(store, indexOf(), { tick: () => 0 }, {});
    const t = w.prestream(5000, 5000);
    expect(t.ready()).toBe(false);
    t.release();
  });
});

describe('TeleportApi placement', () => {
  it('lands on the target when it is clear, fades out and in, and reports where the player stands', async () => {
    const rg = await rig({});
    const { r, ticks } = await go(rg, 'sandbox', { x: 60, z: -40, yaw: 1 });
    expect(r).toMatchObject({ ok: true, x: 60, z: -40, yaw: 1 });
    expect((r as { y: number }).y).toBeCloseTo(5, 5);
    expect(rg.host.fades).toEqual(['out', 'in']);
    expect(rg.host.begun).toHaveLength(1);
    expect(ticks).toBeGreaterThanOrEqual(FADE_TICKS + rg.host.moveTicks);
    expect(rg.host.pos).toEqual([60, 5, -40]);
  });

  it('moves a target in water to the nearest valid point within 40 m, or says water', async () => {
    // the west half (x < 0) is water
    const c = chunkOf(K, none, { heightAt: (x) => (x < 0 ? -3 : 5), ground: (i) => (i < 32 ? GroundClass.Water : GroundClass.Paved) });
    const rg = await rig({ chunks: [c], resident: [K] });
    const near = await go(rg, 'sandbox', { x: -12, z: 0 });
    expect(near.r?.ok).toBe(true);
    const ok = near.r as Extract<TeleportResult, { ok: true }>;
    expect(ok.x).toBeGreaterThanOrEqual(0);
    expect(Math.hypot(ok.x + 12, ok.z)).toBeLessThanOrEqual(40);
    expect(Math.hypot(ok.x + 12, ok.z)).toBeLessThanOrEqual(14);   // the nearest lattice point, not just any
    // 60 m into the water: nothing within 40 m
    const far = await go(rg, 'sandbox', { x: -60, z: 0 });
    expect(far.r).toEqual({ ok: false, reason: 'water', messageKey: 'world.teleport.water' });
    expect(rg.host.pos).toEqual([ok.x, 5, ok.z]);
  });

  it('keeps clear of building footprints, and is blocked when a block of buildings fills the radius', async () => {
    const wall = [4, 0, 20, -60, -60, 60, -60, 60, 60, -60, 60];   // one huge building
    const c = chunkOf(K, none, { heightM: 5, prisms: wall });
    const rg = await rig({ chunks: [c], resident: [K] });
    // inside the building: the nearest clear point is outside its wall (60.6 m or more from the centre on one axis)
    const edge = await go(rg, 'sandbox', { x: 50, z: 0 });
    expect(edge.r?.ok).toBe(true);
    const at = edge.r as Extract<TeleportResult, { ok: true }>;
    expect(Math.max(Math.abs(at.x), Math.abs(at.z))).toBeGreaterThanOrEqual(60.6);
    // deep inside, more than 40 m from any clear point: blocked
    const deep = await go(rg, 'sandbox', { x: 0, z: 0 });
    expect(deep.r).toEqual({ ok: false, reason: 'blocked', messageKey: 'world.teleport.blocked' });
  });

  it('stands on a bridge deck when that is the highest ground', async () => {
    const deck = [4, 18, 1, -20, -20, 20, -20, 20, 20, -20, 20];
    const c = chunkOf(K, none, { heightM: 10, slabs: deck });
    const rg = await rig({ chunks: [c], resident: [K] });
    const { r } = await go(rg, 'sandbox', { x: 0, z: 0 });
    expect((r as { y: number }).y).toBeCloseTo(19, 5);
  });

  it('answers not-loaded when the move ends without the player arriving, and blocked when the engine is busy', async () => {
    const rg = await rig({});
    rg.host.stuck = true;
    const lost = await go(rg, 'sandbox', { x: 30, z: 30 });
    expect(lost.r).toEqual({ ok: false, reason: 'not-loaded', messageKey: 'world.teleport.notLoaded' });
    expect(rg.host.fades).toEqual(['out', 'in']);
    rg.host.stuck = false;
    rg.host.refuse = 'busy';
    const busy = await go(rg, 'sandbox', { x: 30, z: 30 });
    expect(busy.r).toEqual({ ok: false, reason: 'blocked', messageKey: 'world.teleport.busy' });
  });

  it('fades back in when the engine refuses the move after the fade-out, so a retrying caller never leaves the screen dark (BD-FIX-SPAWN-07)', async () => {
    const rg = await rig({});
    rg.host.refuse = 'busy';
    for (let n = 1; n <= 3; n++) {
      const { r } = await go(rg, 'respawn', { x: 30, z: 30 });
      expect(r).toEqual({ ok: false, reason: 'blocked', messageKey: 'world.teleport.busy' });
      expect(rg.host.fades).toHaveLength(2 * n);
      expect(rg.host.fades.slice(-2)).toEqual(['out', 'in']);
      expect(rg.w.teleport.busy).toBe(false);
    }
    expect(rg.host.begun).toEqual([]);
    expect(rg.host.pos).toEqual([0, 5, 0]);
  });

  it('a respawn is not heat-gated: the below-the-world net recovers a player in a pursuit (BD-FIX-SPAWN-07)', async () => {
    const rg = await rig({});
    rg.policy.heat = 3;
    const sandbox = await go(rg, 'sandbox', { x: 30, z: 30 });
    expect(sandbox.r).toEqual({ ok: false, reason: 'heat', messageKey: 'world.teleport.heat' });
    const { r } = await go(rg, 'respawn', { x: 30, z: 30 });
    expect(r).toMatchObject({ ok: true, x: 30, z: 30 });
    expect(rg.host.fades).toEqual(['out', 'in']);
  });

  it('takes one request at a time', async () => {
    const rg = await rig({});
    const first = rg.w.teleport.request('sandbox', { x: 10, z: 10 });
    const second = await rg.w.teleport.request('sandbox', { x: 20, z: 20 });
    expect(second).toEqual({ ok: false, reason: 'blocked', messageKey: 'world.teleport.busy' });
    expect((await rg.run(first)).r?.ok).toBe(true);
  });
});

describe('TeleportApi validation', () => {
  it('rejects a target outside play, in order: mode rules, heat, bounds', async () => {
    const rg = await rig({});
    expect((await go(rg, 'sandbox', { x: 20000, z: 0 })).r).toEqual({ ok: false, reason: 'out-of-bounds', messageKey: 'world.teleport.outOfBounds' });
    expect((await go(rg, 'sandbox', { x: 0, z: -7000 })).r).toMatchObject({ reason: 'out-of-bounds' });
    expect((await go(rg, 'sandbox', { x: Number.NaN, z: 0 })).r).toMatchObject({ reason: 'blocked' });
    rg.policy.heat = 2;
    expect((await go(rg, 'sandbox', { x: 20000, z: 0 })).r).toMatchObject({ reason: 'heat' });
    expect((await go(rg, 'fast-travel', { x: 10, z: 10 })).r).toMatchObject({ reason: 'heat' });
    expect((await go(rg, 'respawn', { x: 10, z: 10 })).r?.ok).toBe(true);
    rg.policy.allowed = false;
    expect((await go(rg, 'sandbox', { x: 20000, z: 0 })).r).toMatchObject({ reason: 'forbidden-in-mode', messageKey: 'world.teleport.forbidden' });
    expect(SANDBOX_POLICY.allowed('sandbox')).toBe(true);
    expect(SANDBOX_POLICY.heat()).toBe(0);
  });

  it('asks the optional policy.deny once the target is resolved and refuses with its key (M05c2)', async () => {
    const rg = await rig({});
    const seen: { kind: string; x: number; z: number }[] = [];
    (rg.w.teleport.policy as TeleportPolicy).deny = (kind, t) => {
      seen.push({ kind, x: t.x, z: t.z });
      return t.x > 100 ? 'story.fastTravel.locked' : null;
    };
    expect((await go(rg, 'fast-travel', { x: 200, z: 0 })).r).toEqual({ ok: false, reason: 'forbidden-in-mode', messageKey: 'story.fastTravel.locked' });
    expect((await go(rg, 'sandbox', { x: 60, z: 0 })).r?.ok).toBe(true);
    expect(seen).toEqual([{ kind: 'fast-travel', x: 200, z: 0 }, { kind: 'sandbox', x: 60, z: 0 }]);
  });

  it('allows a second fast travel only after 30 s, and records the fares', async () => {
    const transit: TransitNode[] = [
      { id: 'rail.a', kind: 'bay-rail', x: 100, z: 0, nameKey: 'transit.a', fastTravel: true },
      { id: 'rail.b', kind: 'bay-rail', x: -100, z: 0, nameKey: 'transit.b', fastTravel: true },
      { id: 'cable.c', kind: 'cable-car', x: 0, z: 100, nameKey: 'transit.c', fastTravel: true },
    ];
    const rg = await rig({ transit });
    const first = await go(rg, 'fast-travel', { node: 'rail.a' });
    expect(first.r?.ok).toBe(true);
    const done = rg.tick;
    const again = await go(rg, 'fast-travel', { node: 'rail.b' });
    expect(again.r).toEqual({ ok: false, reason: 'cooldown', messageKey: 'world.teleport.cooldown' });
    expect(again.ticks).toBeLessThanOrEqual(1);
    // other kinds are not held by the fast-travel cooldown
    expect((await go(rg, 'sandbox', { x: 5, z: 5 })).r?.ok).toBe(true);
    rg.tick = done + 30 * 60;
    expect((await go(rg, 'fast-travel', { node: 'cable.c' })).r?.ok).toBe(true);
    expect(rg.w.teleport.fares.map((f) => [f.to, f.kind, f.cents])).toEqual([['rail.a', 'bay-rail', 250], ['cable.c', 'cable-car', 100]]);
    expect((await go(rg, 'fast-travel', { node: 'rail.zzz' })).r).toMatchObject({ reason: 'blocked', messageKey: 'world.teleport.unknownTarget' });
  });

  it('uses the arrival pose of a landmark and lists the candidates of each kind', async () => {
    const lm = landmarkAt('lm.test-hall', 40, 20, K, { arrival: { x: 44, z: 22, yaw: 2 } });
    const rg = await rig({ landmarks: [lm], transit: [{ id: 'rail.a', kind: 'bay-rail', x: 100, z: 0, nameKey: 'transit.a', fastTravel: true }, { id: 'rail.x', kind: 'rail-terminus', x: 5, z: 5, nameKey: 'transit.x', fastTravel: false }] });
    const { r } = await go(rg, 'sandbox', { landmark: 'lm.test-hall' });
    expect(r).toMatchObject({ ok: true, x: 44, z: 22, yaw: 2 });
    expect((await go(rg, 'sandbox', { landmark: 'lm.nope' })).r).toMatchObject({ reason: 'blocked', messageKey: 'world.teleport.unknownTarget' });
    expect(rg.w.teleport.candidates('sandbox')).toEqual([{ id: 'lm.test-hall', nameKey: 'place.test-hall', x: 44, z: 22 }]);
    expect(rg.w.teleport.candidates('fast-travel').map((c) => c.id)).toEqual(['rail.a']);
    expect(rg.w.teleport.candidates('respawn')).toEqual([]);
  });

  it('snaps an XR comfort arc to a teleport node within 3 m', async () => {
    const base = chunkOf(K, none, { heightM: 5 });
    const c = { ...base, tags: { ...base.tags, teleportNodes: [{ id: 'xr.stairs', x: 30, y: 5, z: 30, yaw: 0, kind: 'xr' as const }] } };
    const rg = await rig({ chunks: [c], resident: [K] });
    expect((await go(rg, 'xr-comfort', { x: 31.5, z: 29 })).r).toMatchObject({ ok: true, x: 30, z: 30 });
    expect((await go(rg, 'xr-comfort', { x: 35, z: 30 })).r).toMatchObject({ ok: true, x: 35, z: 30 });
  });
});
