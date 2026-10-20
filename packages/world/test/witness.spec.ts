/**
 * M03b1 AC-7: robotaxi witnesses. An infraction within 40 m and in line of sight of a robotaxi is reported once, 2 s later, as one
 * `world.witness` event; the robotaxis share at most 4 line-of-sight rays per tick; a car that is not a robotaxi never witnesses.
 */
import { describe, expect, it } from 'vitest';
import type { ChunkKey } from '@dv/shared';
import { ARCH } from '../src/sim/traffic/components.ts';
import { INFRACTION_CODE, REPORT_DELAY_TICKS, WITNESS_RANGE_M, kindOfCode, type WitnessEvent } from '../src/sim/traffic/witness.ts';
import { crossRoads } from './fixtures/roads.ts';
import { makeRig, type Rig } from './fixtures/traffic.ts';

const CELL = '9/256/256' as ChunkKey;

interface Scene {
  rig: Rig;
  events: WitnessEvent[];
  rays: number[];
  robotaxis: string[];
}

async function scene(o: { robotaxis: number; sedans?: number; los?: (ax: number, az: number, bx: number, bz: number) => boolean; at?: number }): Promise<Scene> {
  const cross = crossRoads();
  const rays: number[] = [];
  let thisStep = 0;
  let stepTick = -1;
  let rigRef: Rig | null = null;
  const rig = await makeRig({
    chunks: [cross.chunk], parked: false, initialFill: false,
    hooks: {
      los: (ax, _ay, az, bx, _by, bz) => {
        const t = rigRef?.tick ?? 0;
        if (t !== stepTick) {
          if (stepTick >= 0) rays.push(thisStep);
          stepTick = t;
          thisStep = 0;
        }
        thisStep++;
        return o.los ? o.los(ax, az, bx, bz) : true;
      },
    },
  });
  rigRef = rig;
  const events: WitnessEvent[] = [];
  rig.board.onWitness((e) => events.push(e));
  const robotaxis: string[] = [];
  // robotaxis parked up at a stop line on the east arm (stopped by a red phase), sedans on the west arm
  for (let i = 0; i < o.robotaxis; i++) {
    const slot = 500 + i;
    const a = rig.sim.place({ key: `amb:9/256/256:${slot}`, cell: CELL, slot, epoch: 1, arch: ARCH.robotaxi, edge: cross.inEdge[1] as number, s: 20 + i * 6, lane: 0, speed: 0 });
    if (!a) throw new Error('not placed');
    robotaxis.push(a.key);
  }
  for (let i = 0; i < (o.sedans ?? 0); i++) {
    const slot = 600 + i;
    if (!rig.sim.place({ key: `amb:9/256/256:${slot}`, cell: CELL, slot, epoch: 1, arch: ARCH.sedan, edge: cross.inEdge[3] as number, s: 20 + i * 6, lane: 0, speed: 0 })) throw new Error('not placed');
  }
  return { rig, events, rays, robotaxis };
}

describe('AC-7: witnesses', () => {
  it('an infraction within 40 m in line of sight fires exactly one world.witness event after 2 s', async () => {
    const s = await scene({ robotaxis: 1 });
    s.rig.run(10);
    const a = s.rig.sim.agents.get(s.robotaxis[0] as string);
    if (!a) throw new Error('missing');
    const t0 = s.rig.tick;
    s.rig.board.post('redLightSeen', { x: a.x + 20, y: 0, z: a.z }, 'veh:player', t0);
    s.rig.run(REPORT_DELAY_TICKS - 6);
    expect(s.events).toHaveLength(0);
    expect(a.witnessId).not.toBe(0);
    s.rig.run(12);
    expect(s.events).toHaveLength(1);
    const e = s.events[0] as WitnessEvent;
    expect(e.kind).toBe('redLightSeen');
    expect(e.witness).toBe(s.robotaxis[0]);
    expect(e.reportAtTick - t0).toBeGreaterThanOrEqual(REPORT_DELAY_TICKS);
    expect(e.reportAtTick - t0).toBeLessThanOrEqual(REPORT_DELAY_TICKS + 3);
    expect(a.witnessId).toBe(0);
    s.rig.run(600);
    expect(s.events).toHaveLength(1);
    expect(s.rig.board.emitted).toBe(1);
  });

  it('several robotaxis that see the same infraction report it once', async () => {
    const s = await scene({ robotaxis: 5 });
    s.rig.run(6);
    const a = s.rig.sim.agents.get(s.robotaxis[0] as string);
    if (!a) throw new Error('missing');
    s.rig.board.post('hitCivilianVehicle', { x: a.x, y: 0, z: a.z }, 'veh:player', s.rig.tick);
    s.rig.run(REPORT_DELAY_TICKS + 40);
    expect(s.events).toHaveLength(1);
    expect(s.events[0]?.kind).toBe('hitCivilianVehicle');
  });

  it('beyond 40 m, behind a wall, or seen by a car that is not a robotaxi: no report', async () => {
    const far = await scene({ robotaxis: 1 });
    far.rig.run(6);
    const a = far.rig.sim.agents.get(far.robotaxis[0] as string);
    if (!a) throw new Error('missing');
    far.rig.board.post('assault', { x: a.x - WITNESS_RANGE_M - 5, y: 0, z: a.z }, '', far.rig.tick);
    far.rig.run(REPORT_DELAY_TICKS + 60);
    expect(far.events).toHaveLength(0);

    const walled = await scene({ robotaxis: 1, los: () => false });
    walled.rig.run(6);
    const w = walled.rig.sim.agents.get(walled.robotaxis[0] as string);
    if (!w) throw new Error('missing');
    walled.rig.board.post('assault', { x: w.x + 10, y: 0, z: w.z }, '', walled.rig.tick);
    walled.rig.run(REPORT_DELAY_TICKS + 60);
    expect(walled.events).toHaveLength(0);

    const plain = await scene({ robotaxis: 0, sedans: 4 });
    plain.rig.run(6);
    plain.rig.board.post('assault', { x: -60, y: 0, z: 0 }, '', plain.rig.tick);
    plain.rig.run(REPORT_DELAY_TICKS + 60);
    expect(plain.events).toHaveLength(0);
  });

  it('the robotaxis cast at most 4 line-of-sight rays per tick, however many see the infraction', async () => {
    const s = await scene({ robotaxis: 12 });
    s.rig.run(6);
    const a = s.rig.sim.agents.get(s.robotaxis[0] as string);
    if (!a) throw new Error('missing');
    s.rig.board.post('speedingSeen', { x: a.x, y: 0, z: a.z }, 'veh:player', s.rig.tick);
    s.rig.run(REPORT_DELAY_TICKS + 60);
    expect(s.rig.sim.stats.raysMax).toBeLessThanOrEqual(4);
    expect(s.rig.sim.stats.raysMax).toBeGreaterThan(0);
    expect(s.rig.sim.stats.rays).toBeGreaterThanOrEqual(1);
    expect(s.events).toHaveLength(1);
    // twelve robotaxis, at most four rays a tick: every one of them was asked within three ticks of the infraction
    expect(Math.max(0, ...s.rays)).toBeLessThanOrEqual(4);
  });

  it('infraction kinds map to the byte of component 263 and back', () => {
    for (const [k, code] of Object.entries(INFRACTION_CODE)) expect(kindOfCode(code)).toBe(k);
    expect(kindOfCode(0)).toBeUndefined();
  });
});
