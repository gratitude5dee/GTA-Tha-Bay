/**
 * M03b2 AC-1: the crossing rule of ambient pedestrians. A pedestrian steps onto a signalled crosswalk only while the parallel vehicle
 * movement is green with more than 5 s of the green left, waits at the kerb otherwise and crosses on the next green. A hand-built
 * crossing shows the rule at one junction; on the `civic-excerpt` bake (the real junctions around City Hall) 80 pedestrians walk 600 s
 * in `canonical` and every step onto a crosswalk is judged against the same gate.
 */
import { describe, expect, it } from 'vitest';
import { PedEdgeKind, signalAspect, type ChunkKey, type SimChunk } from '@dv/shared';
import { crossingGate, CROSS_MARGIN_TICKS, trafficOnCrosswalk } from '../src/sim/peds/crossing.ts';
import { PedState } from '../src/sim/peds/components.ts';
import { loadBake } from './fixtures/bake.ts';
import { makePedRig, pedCrossing, vehicleAt, type PedRig } from './fixtures/peds.ts';

interface Entry {
  tick: number;
  junction: number;
  movement: number;
}

/** Watches every pedestrian; records each step onto a crosswalk (the edge changed to a crosswalk, or it left s = 0 on one). */
function watch(rig: PedRig): { entries: Entry[]; waits: number; bad: string[]; check(tick: number): void } {
  const last = new Map<string, string>();
  const waited = new Set<string>();
  const out = { entries: [] as Entry[], waits: 0, bad: [] as string[], check(tick: number): void {
    if (tick % 2 !== 0) return;
    for (const p of rig.sim.peds.list()) {
      const id = `${p.from}>${p.to}`;
      const onCross = p.kind === PedEdgeKind.Crosswalk && p.junction >= 0 && p.s > 0;
      const was = last.get(p.key);
      if (p.state === PedState.Wait && !waited.has(p.key + id)) {
        waited.add(p.key + id);
        out.waits++;
      }
      if (onCross && was !== id) {
        out.entries.push({ tick, junction: p.junction, movement: p.movement });
        const j = rig.services.network.junction(p.junction);
        const g = crossingGate(j, p.movement, tick, false);
        if (g.mode === 'signal' && !g.go) out.bad.push(`${p.key} stepped onto ${id} at tick ${tick}: ${j?.program ? signalAspect(j.program, tick, p.movement, false) : '?'}, ${g.left} ticks left`);
      }
      last.set(p.key, onCross ? id : '');
    }
  } };
  return out;
}

describe('a signalised crosswalk (hand-built)', () => {
  it('a pedestrian reaching the kerb on red waits, and steps out only when the parallel movement is green with more than 5 s left', async () => {
    const f = pedCrossing();
    const rig = await makePedRig({ chunks: [f.chunk], focus: { x: -25, z: 0, vx: 0, vz: 0 }, initialFill: false });
    // the north-south phase is green 0 to 1200, then amber and clear to 1440; the east-west phase follows (the movement waits for the EW phase)
    const p = rig.sim.place({ key: 'amb:9/256/256:300', cell: '9/256/256' as ChunkKey, slot: 300, a: 0, b: 1, s: 5, pace: 1.4, lane: 0 });
    expect(p).not.toBeNull();
    if (!p) return;
    const w = watch(rig);
    rig.run(7200, (t) => w.check(t));
    expect(w.entries.length).toBeGreaterThanOrEqual(2);
    expect(w.bad).toEqual([]);
    // it did wait at least once: the walk is 30 m (21 s) and the first green's last 5 s are closed
    expect(w.waits).toBeGreaterThanOrEqual(1);
  });

  it('the margin is exactly the last 5 s of the green', () => {
    const f = pedCrossing();
    const j = f.cross.junctions[0];
    expect(j?.program).toBeTruthy();
    const green = j?.program?.phases[0]?.greenTicks ?? 0;
    // movement of the north-south phase
    expect(crossingGate(j, f.movement, 0, false)).toEqual({ mode: 'signal', go: true, left: green });
    expect(crossingGate(j, f.movement, green - CROSS_MARGIN_TICKS - 1, false)).toMatchObject({ mode: 'signal', go: true });
    expect(crossingGate(j, f.movement, green - CROSS_MARGIN_TICKS, false)).toMatchObject({ mode: 'signal', go: false });
    expect(crossingGate(j, f.movement, green, false)).toMatchObject({ mode: 'signal', go: false });
    // the other phase is red now
    expect(crossingGate(j, f.movementEw, 10, false)).toMatchObject({ mode: 'signal', go: false });
    // a blackout turns the signal dark: the pedestrian yields to traffic instead
    expect(crossingGate(j, f.movement, 10, true)).toEqual({ mode: 'yield' });
    // and a mid-block crossing has no junction at all
    expect(crossingGate(undefined, -1, 10, false)).toEqual({ mode: 'yield' });
  });

  it('at a crossing without a signal a pedestrian yields to a moving vehicle and goes when the road is clear', async () => {
    const f = pedCrossing();
    // remove the signal: the pedestrian reads the crosswalk as mid-block
    const chunk = { ...f.chunk, pedEdges: f.chunk.pedEdges.map((e) => (e.kind === PedEdgeKind.Crosswalk ? { ...e, junction: -1, movement: -1 } : e)) };
    const rig = await makePedRig({ chunks: [chunk], focus: { x: -25, z: 0, vx: 0, vz: 0 }, initialFill: false });
    const p = rig.sim.place({ key: 'amb:9/256/256:301', cell: '9/256/256' as ChunkKey, slot: 301, a: 0, b: 1, s: 25, pace: 1.4, lane: 0 });
    if (!p) throw new Error('not placed');
    rig.vehicles = [vehicleAt(-10, 12, 0, -1, 9)];
    rig.run(300);
    expect(p.state).toBe(PedState.Wait);
    expect(p.s).toBe(0);
    expect(trafficOnCrosswalk(p.fx, p.fz, p.tx, p.tz, rig.vehicles)).toBe(true);
    rig.vehicles = [];
    rig.run(60);
    expect(p.state).toBe(PedState.Walk);
    expect(p.s).toBeGreaterThan(0);
  });
});

describe('AC-1: 600 s on the civic-excerpt bake', () => {
  it('no pedestrian steps onto a crosswalk while its parallel aspect is red or in the last 5 s of the green, and waiting pedestrians cross on a green', async () => {
    const bake = loadBake('civic-excerpt', 'ped.crossing civic-excerpt');
    if (!bake) return;
    const chunks = bake.chunks();
    // the centre of the excerpt: the middle of the chunk with the most pedestrian edges
    let best: SimChunk | undefined;
    for (const c of chunks) if (!best || c.pedEdges.length > best.pedEdges.length) best = c;
    expect(best).toBeTruthy();
    if (!best) return;
    const b = best.height;
    const focus = { x: b.originX + 128, z: b.originZ + 128, vx: 0, vz: 0 };
    const rig = await makePedRig({ chunks, topology: bake.topology, index: bake.index, focus });
    const w = watch(rig);
    rig.run(36_000, (t) => w.check(t));
    expect(rig.sim.peds.size).toBeGreaterThan(20);
    expect(w.entries.length).toBeGreaterThan(10);
    expect(w.bad).toEqual([]);
    expect(w.waits).toBeGreaterThan(0);
    // waiting pedestrians do cross: some entry follows a wait on a signal (the entries are all judged green above)
    const signalled = w.entries.filter((e) => e.junction >= 0 && rig.services.network.junction(e.junction)?.program);
    expect(signalled.length).toBeGreaterThan(0);
  }, 240_000);
});
