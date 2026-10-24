/**
 * M03b2 AC-6: Bay Rail fast travel and the robotaxi ride go through `TeleportApi.request('fast-travel', ...)` and charge the
 * `FareSink` once with one idempotency key `fare:<kind>:<tick>:<from>:<to>`; at heat 1 the request is refused with the precondition
 * key and nothing moves. The fares are 200 cents + 50 cents per stop (Bay Rail) and 300 cents + 120 cents per km (robotaxi).
 */
import { describe, expect, it } from 'vitest';
import type { ChunkKey, TeleportResult, TransitNode } from '@dv/shared';
import { SANDBOX_POLICY, TELEPORT_MSG, type TeleportPolicy } from '../src/sim/api/teleport.ts';
import { createWorldApi } from '../src/sim/api/world-api.ts';
import { RecordingFareSink, bayRailFare, fareKey, robotaxiFare, stopsBetween } from '../src/sim/transit/fares.ts';
import { bayRailStations, nextStation, stationNear } from '../src/sim/transit/rail.ts';
import { ROBOTAXI_CUT_TICKS, ROBOTAXI_SPAWN_MIN_M, RideService, type RideResult, type RobotaxiPhase } from '../src/sim/transit/ride.ts';
import { TRANSIT_CONFIG } from '../src/sim/transit/components.ts';
import { chunkOf, roads } from './fixtures/roads.ts';
import { FakeHost, indexOf, loadAll, storeOf } from './fixtures/world.ts';

const K = '9/256/256' as ChunkKey;
const none = roads([], []);
const ORDER = TRANSIT_CONFIG.bayRailOrder;

const nodes: TransitNode[] = ORDER.map((id, i) => ({ id, kind: 'bay-rail', x: 10 + 25 * i, z: 30, nameKey: `transit.bay-rail.${id.slice(5)}`, fastTravel: true }));

async function rig(start: [number, number, number] = [10, 5, 30]) {
  const chunks = [chunkOf(K, none, { heightM: 5 })];
  const store = storeOf(chunks);
  await loadAll(store, [K]);
  const host = new FakeHost(start);
  const heat = { v: 0 };
  const policy: TeleportPolicy = { allowed: SANDBOX_POLICY.allowed, heat: () => heat.v };
  const t = { tick: 0 };
  const w = createWorldApi(store, indexOf({ transit: nodes }), { tick: () => t.tick }, { host, policy });
  const sink = new RecordingFareSink();
  const phases: RobotaxiPhase[] = [];
  const ride = new RideService({
    teleport: w.teleport,
    stations: bayRailStations(nodes),
    sink,
    now: () => t.tick,
    playerPos: () => host.pos,
    heat: () => heat.v,
    resolve: (to) => ('x' in to ? { x: to.x, z: to.z } : 'node' in to ? (() => { const n = nodes.find((q) => q.id === to.node); return n ? { x: n.x, z: n.z } : null; })() : null),
    onPhase: (p) => phases.push(p),
  });
  /** Runs sim ticks until the promise settles. */
  const run = async <T,>(p: Promise<T>, max = 4000): Promise<T | null> => {
    let out: T | null = null;
    let done = false;
    void p.then((x) => { out = x; done = true; });
    for (let i = 0; i < max && !done; i++) {
      t.tick++;
      await Promise.resolve();
      host.tick();
      w.teleport.step(t.tick);
      ride.step(t.tick);
      await Promise.resolve();
      await Promise.resolve();
    }
    return out;
  };
  return { w, host, heat, ride, sink, run, phases, t };
}

describe('the fare formulas', () => {
  it('Bay Rail is 200 + 50 per stop of the line order, and 0 stops cost nothing', () => {
    expect(ORDER).toHaveLength(8);
    expect(stopsBetween('rail.embarcadero', 'rail.civic-center')).toBe(3);
    expect(stopsBetween('rail.civic-center', 'rail.embarcadero')).toBe(3);
    expect(bayRailFare('rail.embarcadero', 'rail.civic-center')).toBe(350);
    expect(bayRailFare('rail.embarcadero', 'rail.montgomery')).toBe(250);
    expect(bayRailFare('rail.embarcadero', 'rail.balboa-park')).toBe(200 + 50 * 7);
    expect(bayRailFare('rail.powell', 'rail.powell')).toBe(0);
    expect(bayRailFare('rail.powell', 'rail.nowhere')).toBe(0);
  });

  it('the robotaxi is 300 + 120 per km', () => {
    expect(robotaxiFare(0)).toBe(300);
    expect(robotaxiFare(1000)).toBe(420);
    expect(robotaxiFare(2500)).toBe(600);
    expect(robotaxiFare(1234)).toBe(300 + Math.round(1.234 * 120));
  });

  it('the idempotency key is fare:<kind>:<tick>:<from>:<to>', () => {
    expect(fareKey('bay-rail', 77, 'rail.powell', 'rail.civic-center')).toBe('fare:bay-rail:77:rail.powell:rail.civic-center');
  });

  it('the sink charges a key once', () => {
    const s = new RecordingFareSink();
    s.charge(350, 'bay-rail', 'k');
    s.charge(350, 'bay-rail', 'k');
    s.charge(250, 'bay-rail', 'k2');
    expect(s.calls.map((c) => c.cents)).toEqual([350, 250]);
  });

  it('the stations come out in line order and the next one wraps', () => {
    const st = bayRailStations(nodes.slice().reverse());
    expect(st.map((s) => s.id)).toEqual([...ORDER]);
    expect(nextStation(st, 'rail.balboa-park')?.id).toBe('rail.embarcadero');
    expect(nextStation(st, 'rail.powell')?.id).toBe('rail.civic-center');
    expect(stationNear(st, 12, 31, 3)?.id).toBe('rail.embarcadero');
    expect(stationNear(st, 500, 31, 3)).toBeNull();
  });
});

describe('AC-6: Bay Rail fast travel', () => {
  it('three stops land at the target station and charge 350 cents once with one idempotency key', async () => {
    const r = await rig();
    const res = (await r.run(r.ride.fastTravel('rail.embarcadero', 'rail.civic-center'))) as RideResult;
    expect(res).toMatchObject({ ok: true, kind: 'bay-rail', cents: 350, stops: 3, to: 'rail.civic-center' });
    const target = nodes.find((n) => n.id === 'rail.civic-center') as TransitNode;
    expect(r.host.pos?.[0]).toBeCloseTo(target.x, 0);
    expect(r.host.pos?.[2]).toBeCloseTo(target.z, 0);
    expect(r.sink.calls).toHaveLength(1);
    const call = r.sink.calls[0];
    expect(call).toMatchObject({ cents: 350, kind: 'bay-rail' });
    expect(call?.idemKey).toMatch(/^fare:bay-rail:\d+:rail\.embarcadero:rail\.civic-center$/);
    // the teleport service records the same trip
    expect(r.w.teleport.fares.map((f) => f.to)).toEqual(['rail.civic-center']);
  });

  it('at heat 1 the request is refused with the precondition key and nothing moves or is charged', async () => {
    const r = await rig();
    r.heat.v = 1;
    const before = [...(r.host.pos ?? [])];
    const res = (await r.run(r.ride.fastTravel('rail.embarcadero', 'rail.civic-center'))) as RideResult;
    expect(res).toEqual({ ok: false, reason: 'heat', messageKey: TELEPORT_MSG.heat });
    expect(r.host.pos).toEqual(before);
    expect(r.host.begun).toHaveLength(0);
    expect(r.sink.calls).toHaveLength(0);
  });

  it('a station that is not on the line, or the same station, is refused', async () => {
    const r = await rig();
    expect(await r.ride.fastTravel('rail.embarcadero', 'rail.nowhere')).toMatchObject({ ok: false });
    expect(await r.ride.fastTravel('rail.powell', 'rail.powell')).toMatchObject({ ok: false });
    expect(r.sink.calls).toHaveLength(0);
  });
});

describe('the robotaxi ride', () => {
  it('a car arrives within 90 s from 120 m or more, a short cut follows, then the teleport; 300 + 120 per km', async () => {
    const r = await rig();
    const spawns: number[] = [];
    const p = r.ride.callRobotaxi({ x: 100, z: 30 }, 'point');
    expect(r.ride.robotaxiPhase).toBe('arriving');
    const res = (await r.run(p)) as RideResult;
    expect(res).toMatchObject({ ok: true, kind: 'robotaxi' });
    void spawns;
    // 90 m from (10, 30) to (100, 30): 300 + 120 x 0.09 = 311 cents (rounded)
    expect(res.ok && res.cents).toBe(300 + Math.round((120 * 90) / 1000));
    expect(r.phases).toEqual(['arriving', 'cut', 'travelling', 'idle']);
    expect(r.sink.calls).toHaveLength(1);
    expect(r.sink.calls[0]?.kind).toBe('robotaxi');
    expect(r.sink.calls[0]?.idemKey).toMatch(/^fare:robotaxi:\d+:p10_30:point$/);
    expect(r.host.pos?.[0]).toBeCloseTo(100, 0);
    // arrival well inside 90 s: a spawn between 120 and 180 m is 10 to 15 s away
    expect(r.t.tick).toBeLessThan(90 * 60 + ROBOTAXI_CUT_TICKS + 2000);
    expect(ROBOTAXI_SPAWN_MIN_M).toBe(120);
  });

  it('is refused at heat 1 at once, and a second call while one runs is refused as busy', async () => {
    const r = await rig();
    r.heat.v = 1;
    expect(await r.ride.callRobotaxi({ x: 100, z: 30 })).toEqual({ ok: false, reason: 'heat', messageKey: TELEPORT_MSG.heat });
    r.heat.v = 0;
    const first = r.ride.callRobotaxi({ x: 100, z: 30 });
    expect(await r.ride.callRobotaxi({ x: 120, z: 30 })).toMatchObject({ ok: false, reason: 'blocked' });
    expect(((await r.run(first)) as TeleportResult | null)).toBeTruthy();
  });
});
