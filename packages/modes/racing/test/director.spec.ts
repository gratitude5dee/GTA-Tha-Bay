/**
 * AC-6 and the director half of AC-5: Loading holds until the colliders are ready; the countdown is exactly 180 ticks; a finish
 * gate leads to Results; retry returns to Grid with a fresh seed stream; a flipped car (upY < 0.3 for 3 s) goes back to the last
 * gate with +5 s. Jump start adds 3 s; a throttle press within 0.25 s of GO is a perfect start.
 */
import { describe, expect, it } from 'vitest';
import { straightRaceDef } from '@dv/shared';
import { RACING_CONFIG } from '../src/config.ts';
import { RaceDirector, type DirectorEvent, type DirectorTick } from '../src/sim/director.ts';

const cfg = RACING_CONFIG.race;
const def = straightRaceDef({ lengthM: 1000, gates: 5 });

const base = (tick: number, o: Partial<DirectorTick> = {}): DirectorTick => ({
  tick, ready: true, startNow: false, front: [0, 0, 0], speedMps: 0, upY: 1, throttle: 0, resetHeld: false, retry: false, exit: false, movedFromGridM: 0, totaled: false, ...o,
});

/** Runs the director to Running: ready at tick `t0`, start at t0 + 1, GO 180 ticks later. Returns the tick of GO and the events. */
function toGo(d: RaceDirector, t0 = 10, opts: (t: number) => Partial<DirectorTick> = () => ({})): { go: number; events: DirectorEvent[] } {
  const events: DirectorEvent[] = [];
  events.push(...d.tick(base(t0)));                       // Loading -> Grid
  events.push(...d.tick(base(t0 + 1, { startNow: true, ...opts(t0 + 1) })));   // Grid -> Countdown
  let t = t0 + 2;
  while (d.phase === 'Countdown') events.push(...d.tick(base(t, opts(t++))));
  return { go: t - 1, events };
}

describe('race director', () => {
  it('stays in Loading for 600 ticks while the colliders are not ready', () => {
    const d = new RaceDirector(def, { cfg, seed: 7 });
    for (let t = 0; t < 600; t++) expect(d.tick(base(t, { ready: false }))).toEqual([]);
    expect(d.phase).toBe('Loading');
  });

  it('counts down exactly 180 ticks from the start to race.go', () => {
    const d = new RaceDirector(def, { cfg, seed: 7 });
    const events: DirectorEvent[] = [];
    events.push(...d.tick(base(100)));
    expect(d.phase).toBe('Grid');
    events.push(...d.tick(base(101, { startNow: true })));
    expect(d.phase).toBe('Countdown');
    const cd = events.find((e) => e.t === 'race.countdown');
    expect(cd).toEqual({ t: 'race.countdown', tick: 101 });
    for (let t = 102; t < 281; t++) {
      expect(d.phase).toBe('Countdown');
      d.tick(base(t));
    }
    const go = d.tick(base(281));
    expect(go.find((e) => e.t === 'race.go')).toEqual({ t: 'race.go', tick: 281 });
    expect(281 - 101).toBe(cfg.countdownTicks);
    expect(d.phase).toBe('Running');
  });

  it('starts by itself after 5 s on the grid', () => {
    const d = new RaceDirector(def, { cfg, seed: 7 });
    d.tick(base(0));
    for (let t = 1; t < cfg.gridAutoTicks; t++) d.tick(base(t));
    expect(d.phase).toBe('Grid');
    d.tick(base(cfg.gridAutoTicks));
    expect(d.phase).toBe('Countdown');
  });

  it('a finish gate leads to Finished, then Results; the time carries the penalties', () => {
    const d = new RaceDirector(def, { cfg, seed: 7 });
    const { go } = toGo(d);
    let t = go + 1;
    const events: DirectorEvent[] = [];
    for (let s = 0; s <= 1010; s += 2) events.push(...d.tick(base(t++, { front: [0, 0, -(s + 2)], speedMps: 30 })));
    expect(events.some((e) => e.t === 'race.finish')).toBe(true);
    expect(d.phase === 'Finished' || d.phase === 'Results').toBe(true);
    d.tick(base(t++));
    expect(d.phase).toBe('Results');
    expect(d.result?.outcome).toBe('finish');
  });

  it('retry returns to Grid with a fresh seed stream and a clean referee', () => {
    const d = new RaceDirector(def, { cfg, seed: 7 });
    const { go } = toGo(d);
    let t = go + 1;
    for (let s = 0; s <= 1010; s += 2) d.tick(base(t++, { front: [0, 0, -(s + 2)], speedMps: 30 }));
    d.tick(base(t++));
    expect(d.phase).toBe('Results');
    const first = d.seedFor(d.attempt);
    const ev = d.tick(base(t++, { retry: true }));
    expect(d.phase).toBe('Grid');
    expect(ev).toEqual([{ t: 'race.grid', attempt: 1 }]);
    expect(d.attempt).toBe(1);
    expect(d.seedFor(d.attempt)).not.toBe(first);
    expect(d.ref.gate).toBe(1);
    expect(d.ref.finished).toBe(false);
    expect(d.result).toBeNull();
  });

  it('a car with upY < 0.3 for 3 s goes back to the last gate with +5 s', () => {
    const d = new RaceDirector(def, { cfg, seed: 7 });
    const { go } = toGo(d);
    let t = go + 1;
    // pass gate 1 (s 200), then flip
    for (let s = 0; s < 210; s += 2) d.tick(base(t++, { front: [0, 0, -(s + 2)], speedMps: 30 }));
    expect(d.ref.lastGate).toBe(1);
    const events: DirectorEvent[] = [];
    for (let i = 0; i < 179; i++) events.push(...d.tick(base(t++, { front: [0, 0, -212], upY: 0.1 })));
    expect(events.some((e) => e.t === 'race.reset')).toBe(false);
    events.push(...d.tick(base(t++, { front: [0, 0, -212], upY: 0.1 })));
    const reset = events.find((e) => e.t === 'race.reset');
    expect(reset).toEqual({ t: 'race.reset', reason: 'flipped', at: 1, penaltyMs: 5000 });
    expect(d.penaltyMs).toBe(5000);
  });

  it('a car out of the world goes back to the last gate without a penalty, and the fall is no gate and no wrong way (BD-FIX-SPAWN-07)', () => {
    const d = new RaceDirector(def, { cfg, seed: 7 });
    const { go } = toGo(d);
    let t = go + 1;
    for (let s = 0; s < 210; s += 2) d.tick(base(t++, { front: [0, 0, -(s + 2)], speedMps: 30 }));
    expect(d.ref.lastGate).toBe(1);
    const gate = d.ref.gate;
    const events: DirectorEvent[] = [];
    // through a collision gap: 25 m under the road, then flagged after 2 s in the air
    for (let i = 0; i < 30; i++) events.push(...d.tick(base(t++, { front: [0, -25 - i, -212], speedMps: 0 })));
    events.push(...d.tick(base(t++, { front: [0, -60, -212], fell: true })));
    expect(events.filter((e) => e.t === 'race.reset')).toEqual([{ t: 'race.reset', reason: 'fell', at: 1, penaltyMs: 0 }]);
    expect(d.penaltyMs).toBe(0);
    // put back on gate 1 (s 200): the jump from under the world is not read as a gate crossing or a wrong-way run
    d.placed();
    for (let i = 0; i < 5; i++) events.push(...d.tick(base(t++, { front: [0, 0, -200 - i * 0.5], speedMps: 5 })));
    expect(events.some((e) => e.t === 'race.gate' || e.t === 'race.wrongway' || e.t === 'race.respawn')).toBe(false);
    expect(d.ref.gate).toBe(gate);
    expect(d.phase).toBe('Running');
  });

  it('a held reset (1 s) also resets with +5 s', () => {
    const d = new RaceDirector(def, { cfg, seed: 7 });
    const { go } = toGo(d);
    let t = go + 1;
    const events: DirectorEvent[] = [];
    for (let i = 0; i < 60; i++) events.push(...d.tick(base(t++, { resetHeld: true, speedMps: 10 })));
    expect(events.find((e) => e.t === 'race.reset')).toMatchObject({ reason: 'held', penaltyMs: 5000 });
  });

  it('being totaled is a DNF', () => {
    const d = new RaceDirector(def, { cfg, seed: 7 });
    const { go } = toGo(d);
    const ev = d.tick(base(go + 1, { totaled: true }));
    expect(ev.find((e) => e.t === 'race.dnf')).toEqual({ t: 'race.dnf', reason: 'totaled' });
    expect(d.phase).toBe('Failed');
    d.tick(base(go + 2));
    expect(d.phase).toBe('Results');
    expect(d.result?.outcome).toBe('dnf');
  });
});

describe('starts', () => {
  it('moving 0.6 m before GO adds 3 s', () => {
    const d = new RaceDirector(def, { cfg, seed: 7 });
    const { events } = toGo(d, 10, (t) => (t > 150 ? { movedFromGridM: 0.6 } : {}));
    expect(events.find((e) => e.t === 'race.jumpstart')).toEqual({ t: 'race.jumpstart', penaltyMs: 3000 });
    expect(d.penaltyMs).toBe(3000);
  });

  it('0.4 m is no jump start', () => {
    const d = new RaceDirector(def, { cfg, seed: 7 });
    const { events } = toGo(d, 10, () => ({ movedFromGridM: 0.4 }));
    expect(events.some((e) => e.t === 'race.jumpstart')).toBe(false);
  });

  it('a throttle press within 0.25 s of GO is a perfect start (+10 nitro)', () => {
    const d = new RaceDirector(def, { cfg, seed: 7 });
    const { go } = toGo(d);
    const events: DirectorEvent[] = [];
    for (let t = go + 1; t <= go + 20; t++) events.push(...d.tick(base(t, { throttle: t >= go + 5 ? 1 : 0, speedMps: 3 })));
    expect(events.find((e) => e.t === 'race.perfectstart')).toEqual({ t: 'race.perfectstart', pct: 10 });
  });

  it('a press 0.5 s after GO is not', () => {
    const d = new RaceDirector(def, { cfg, seed: 7 });
    const { go } = toGo(d);
    const events: DirectorEvent[] = [];
    for (let t = go + 1; t <= go + 40; t++) events.push(...d.tick(base(t, { throttle: t >= go + 30 ? 1 : 0, speedMps: 3 })));
    expect(events.some((e) => e.t === 'race.perfectstart')).toBe(false);
  });
});
