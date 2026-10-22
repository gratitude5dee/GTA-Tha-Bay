/**
 * AC-3: gates count only in order, a skipped gate is not counted, a wrong way of 35 m fires `race.wrongway` and a respawn at the
 * last gate follows after 6 s, a crossing 7 m above the gate is rejected, and `placeOrder` sorts by (lap, gate, -distance, tick).
 */
import { describe, expect, it } from 'vitest';
import {
  crossedGate, newRefereeState, placeOrder, projectToRoute, refereeStep, routePoint, straightRaceDef, type RaceEvent, type RefereeState,
} from '@dv/shared';

const def = straightRaceDef({ lengthM: 1000, gates: 5 });
// gates: start s 10, then numbered 1..5 at s 200, 400, 600, 800, 1000 (north is -z)
const at = (s: number, y = 0, x = 0): [number, number, number] => [x, y, -s];

/** Drives the car along z in `stepM` steps from s0 to s1; returns every event with its tick. */
function drive(st: RefereeState, from: number, to: number, tick0: number, stepM = 2): { events: { e: RaceEvent; tick: number }[]; tick: number } {
  const events: { e: RaceEvent; tick: number }[] = [];
  let tick = tick0;
  const dir = to >= from ? 1 : -1;
  let s = from;
  while ((dir > 0 && s < to) || (dir < 0 && s > to)) {
    const n = dir > 0 ? Math.min(to, s + stepM) : Math.max(to, s - stepM);
    for (const e of refereeStep(def, st, at(s), at(n), 20, tick)) events.push({ e, tick });
    s = n;
    tick++;
  }
  return { events, tick };
}

describe('crossedGate', () => {
  const g = def.gates[1]!;
  it('counts a forward crossing inside the width', () => {
    expect(crossedGate(g, at(190), at(210))).toBe(true);
  });
  it('rejects a wrong-way pass', () => {
    expect(crossedGate(g, at(210), at(190))).toBe(false);
  });
  it('rejects a pass outside the width (7 m off the centre of a 14 m gate edge is in; 8 m is out)', () => {
    expect(crossedGate(g, at(190, 0, 6.5), at(210, 0, 6.5))).toBe(true);
    expect(crossedGate(g, at(190, 0, 8), at(210, 0, 8))).toBe(false);
  });
  it('rejects a crossing 7 m above the gate and accepts 5.9 m', () => {
    expect(crossedGate(g, at(190, 7), at(210, 7))).toBe(false);
    expect(crossedGate(g, at(190, 5.9), at(210, 5.9))).toBe(true);
  });
});

describe('refereeStep: order, skips, wrong way', () => {
  it('counts the gates in order and finishes at the last', () => {
    const st = newRefereeState(def, 0);
    const r = drive(st, 0, 1010, 1);
    const gates = r.events.filter((x) => x.e.t === 'race.gate').map((x) => (x.e as { i: number }).i);
    expect(gates).toEqual([1, 2, 3, 4, 5]);
    expect(r.events.some((x) => x.e.t === 'race.finish')).toBe(true);
    expect(st.finished).toBe(true);
  });

  it('does not count a skipped gate 3 and the later gates do not count either', () => {
    const st = newRefereeState(def, 0);
    // gates 1 and 2 (s 200 and 400), then the car goes round gate 3 (s 600) 20 m to the side, then past gates 4 and 5
    const a = drive(st, 0, 560, 1);
    let tick = a.tick;
    const events = [...a.events];
    for (let s = 560; s < 1010; s += 2) {
      const x = s > 570 && s < 640 ? 20 : 0;
      const x0 = s - 2 > 570 && s - 2 < 640 ? 20 : 0;
      for (const e of refereeStep(def, st, at(s - 2, 0, x0), at(s, 0, x), 20, tick)) events.push({ e, tick });
      tick++;
    }
    const gates = events.filter((x) => x.e.t === 'race.gate').map((x) => (x.e as { i: number }).i);
    expect(gates).toEqual([1, 2]);
    expect(st.gate).toBe(3);
    expect(st.finished).toBe(false);
  });

  it('fires race.wrongway once after 35 m backwards and respawns at the last gate after 6 s', () => {
    const st = newRefereeState(def, 0);
    const a = drive(st, 0, 450, 1);                    // gates 1 and 2 passed
    expect(st.lastGate).toBe(2);
    const b = drive(st, 450, 415, a.tick);             // 35 m back
    const wrong = b.events.filter((x) => x.e.t === 'race.wrongway');
    expect(wrong).toHaveLength(1);
    // stay put (small jitter) for 6 s = 360 ticks from the first wrong-way tick
    const firstWrong = wrong[0]!.tick;
    let tick = b.tick;
    const later: { e: RaceEvent; tick: number }[] = [];
    for (let i = 0; i < 400; i++) {
      for (const e of refereeStep(def, st, at(415), at(415), 1, tick)) later.push({ e, tick });
      tick++;
    }
    const resp = later.find((x) => x.e.t === 'race.respawn');
    expect(resp).toBeDefined();
    expect((resp!.e as { at: number }).at).toBe(2);
    expect(resp!.tick - firstWrong).toBe(359);
  });

  it('adds the time bonus of a checkpoint gate to the clock', () => {
    const d2 = straightRaceDef({ gates: 5, kind: 'checkpoint', timeBonusSec: 10 });
    const st = newRefereeState(d2, 0, 30_000);
    let tick = 1;
    for (let s = 0; s < 210; s += 2) for (const _e of refereeStep(d2, st, at(s), at(s + 2), 20, tick++)) void _e;
    // 210 m at 2 m per tick = 105 ticks = 1750 ms gone, +10 s for gate 1
    expect(st.timeLeftMs).toBeCloseTo(30_000 - 105 * (1000 / 60) + 10_000, 0);
  });

  it('ends a timed event with race.dnf time when the clock reaches zero', () => {
    const st = newRefereeState(def, 0, 500);
    const evs: RaceEvent[] = [];
    for (let t = 1; t < 60; t++) evs.push(...refereeStep(def, st, at(0), at(0), 0, t));
    expect(evs.filter((e) => e.t === 'race.dnf')).toEqual([{ t: 'race.dnf', reason: 'time' }]);
    expect(st.dnf).toBe(true);
  });

  it('sums the integer kph of speed-camera gates', () => {
    const d2 = straightRaceDef({ gates: 5 });
    (d2.gates[1] as { kind: string }).kind = 'speedCam';
    const st = newRefereeState(d2, 0);
    let tick = 1;
    for (let s = 0; s < 210; s += 2) refereeStep(d2, st, at(s), at(s + 2), 25, tick++);
    expect(st.speedSum).toBe(90);
  });
});

describe('projectToRoute and routePoint', () => {
  it('projects within the window and reports the side', () => {
    const p = projectToRoute(def, [3, 0, -420], 400);
    expect(p.s).toBeCloseTo(420, 0);
    expect(Math.abs(p.lateralM)).toBeCloseTo(3, 1);
    // facing north, east is the right-hand side: positive
    expect(p.lateralM).toBeGreaterThan(0);
  });
  it('stays inside its window: a point 300 m ahead of the window is not found there', () => {
    const p = projectToRoute(def, [0, 0, -700], 300);
    expect(p.s).toBeLessThanOrEqual(425 + 1e-6);
  });
  it('routePoint gives the centreline and the travel direction', () => {
    const r = routePoint(def, 250);
    expect(r.z).toBeCloseTo(-250, 3);
    expect(r.tz).toBeCloseTo(-1, 6);
  });
});

describe('placeOrder', () => {
  const mk = (id: number, lap: number, gate: number, distToNext: number, tickLastGate: number) => ({ id, st: { ...newRefereeState(def, 0), lap, gate }, tickLastGate, distToNext });
  it('sorts by lap, gate, then the shorter distance to the next gate, then the earlier tick', () => {
    const order = placeOrder([mk(1, 1, 3, 50, 900), mk(2, 2, 1, 10, 100), mk(3, 1, 3, 20, 950), mk(4, 1, 4, 90, 800), mk(5, 1, 3, 20, 940)]);
    expect(order).toEqual([2, 4, 5, 3, 1]);
  });
});
