/**
 * AC-9: `racing.pursuit` on `sf.pursuit.bayview-escape`, seeds 1 to 3, against the engine's real `PursuitDirector` in the pursuit
 * rig (`qa/pursuit-rig.ts`: kinematic police, the route as the only road, fog sight). Each run ends in `evade` before `maxTicks`,
 * the heat never exceeds 3, no police unit goes faster than 1.06 times the player's top speed, and a bot that stands still at the
 * start is busted (`race.dnf {reason: 'busted'}`) with the 5 % repair fee.
 */
import { describe, expect, it } from 'vitest';
import { RACING_CONFIG } from '../src/config.ts';
import { raceCar } from '../src/cars.ts';
import { raceDef } from '../src/races.ts';
import { PURSUIT_RACE_REF, profileOf, racePursuitFile, racePursuitLoaders } from '../src/sim/pursuit-binder.ts';
import { runPursuitRig, standStillFrame } from '../src/qa/pursuit-rig.ts';
import { applyRun, defaultRacingSlice } from '../src/sim/slice.ts';

const def = raceDef('sf.pursuit.bayview-escape')!;
const CAR = 'vehicle.ondine-pico';
const MAX_TICKS = 60 * 60 * 5;

describe('racing.pursuit on the Bayview escape', () => {
  it('the event is a pursuit with police on, heat 2 to 3 and an evade ending, and a hiding spot on its route', () => {
    expect(def.kind).toBe('pursuit');
    expect(def.police).toEqual({ enabled: true, startHeat: 2, maxHeat: 3, success: 'evade' });
    expect(def.hidingSpots?.length).toBeGreaterThan(0);
    expect(profileOf(def)).toEqual({ kind: 'race', startHeat: 2, maxHeat: 3, success: { kind: 'evade' }, configRef: PURSUIT_RACE_REF });
  });

  for (const seed of [1, 2, 3]) {
    it(`seed ${seed}: ends in evade before maxTicks, heat at most 3, no unit above 1.06 x the top speed`, () => {
      const r = runPursuitRig({ def, vehicleDef: CAR, seed, maxTicks: MAX_TICKS, frame: (o, t, b) => b.frame(o as never, t) });
      expect(r.outcome).toBe('evade');
      expect(r.ticks).toBeLessThan(MAX_TICKS);
      expect(r.maxHeat).toBeGreaterThanOrEqual(2);
      expect(r.maxHeat).toBeLessThanOrEqual(3);
      expect(r.spawns).toBeGreaterThan(0);
      expect(r.maxUnitRatio).toBeLessThanOrEqual(1.06);
      expect(r.events.some((e) => e.t === 'race.dnf')).toBe(false);
      const a = r.attempt!;
      expect(a.outcome).toBe('finish');
      expect(a.pursuit?.outcome).toBe('evade');
      expect(a.pursuit?.heatMax).toBeLessThanOrEqual(3);
      expect(a.pursuit?.repairCents).toBe(0);
      expect(a.pursuit?.points).toBeGreaterThan(0);
      // the end telemetry names the highest heat, the ending and the length bucket
      const end = r.telemetry.find((t) => t.name === 'racing.pursuit_end')!;
      expect(end.props).toMatchObject({ heatMax: a.pursuit!.heatMax, outcome: 'evade' });
      expect(r.session.state().car).not.toBeNull();
    });
  }

  it('is repeatable: the same seed gives the same end hash and time; the three seeds can differ in how they get there', () => {
    const run = (seed: number) => runPursuitRig({ def, vehicleDef: CAR, seed, maxTicks: MAX_TICKS, frame: (o, t, b) => b.frame(o as never, t) });
    const a = run(2);
    const b = run(2);
    expect(b.hash).toBe(a.hash);
    expect(b.ms).toBe(a.ms);
    expect(b.ticks).toBe(a.ticks);
  });

  it('a bot that stands still at the start is busted: race.dnf busted, the 5 % repair fee of the car, no purse', () => {
    const r = runPursuitRig({ def, vehicleDef: CAR, seed: 1, maxTicks: 60 * 60 * 3, frame: (_o, t) => standStillFrame(t) });
    expect(r.outcome).toBe('bust');
    expect(r.events.filter((e) => e.t === 'race.dnf').map((e) => e.s)).toEqual(['busted']);
    const a = r.attempt!;
    expect(a.outcome).toBe('dnf');
    expect(a.reason).toBe('busted');
    const price = raceCar(CAR)!.priceCents;
    expect(price).toBe(900_000);
    expect(a.pursuit?.repairCents).toBe(Math.round((RACING_CONFIG.damage.bustRepairPct / 100) * price));
    expect(a.pursuit?.repairCents).toBe(45_000);
    expect(r.telemetry.find((t) => t.name === 'racing.pursuit_end')?.props).toMatchObject({ outcome: 'bust' });
    // folded into the slice: the repair comes out of the racing purse (never below zero), nothing is paid, the bust is counted
    const s = defaultRacingSlice();
    s.purseCents = 100_000;
    applyRun(s, {
      raceId: def.id, kind: 'pursuit', outcome: 'dnf', ms: a.ms, place: 1, medals: 0, rep: a.rewards.rep, cashCents: a.rewards.cashCents - a.pursuit!.repairCents, ghost: null,
      pursuit: { evaded: false, busted: true, bountyPoints: a.pursuit!.points, seconds: a.pursuit!.seconds, takedowns: 0 },
    }, 1);
    expect(s.pursuit.busted).toBe(1);
    expect(s.purseCents).toBeLessThanOrEqual(100_000 - 45_000 + a.rewards.cashCents);
  });

  it('a bust in a race event costs no fine and no strike: the story wallet is untouched', () => {
    let debits = 0;
    const r = runPursuitRig({
      def, vehicleDef: CAR, seed: 1, maxTicks: 60 * 60 * 3, frame: (_o, t) => standStillFrame(t),
      probe: ({ director }) => {
        const w = (director as unknown as { deps: { wallet: { cash(): number } } }).deps.wallet;
        debits = 1_000_000 - w.cash();
      },
    });
    expect(r.outcome).toBe('bust');
    expect(debits).toBe(0);
  });

  it('heat never goes above the profile\'s max of 3, however many infractions are reported', () => {
    let top = 0;
    runPursuitRig({
      def, vehicleDef: CAR, seed: 3, maxTicks: 60 * 60 * 2, frame: (o, t, b) => b.frame(o as never, t),
      probe: ({ tick, director, port }) => {
        if (tick > 600 && tick % 30 === 0) {
          const c = port.read();
          if (c) director.report('hitPoliceVehicle', c.pos, 'police', 3);
        }
        top = Math.max(top, director.state().level);
      },
    });
    expect(top).toBe(3);
  });

  it('config/pursuit.race.json extends config/pursuit.json and the director resolves it by its ref', () => {
    const f = racePursuitFile();
    expect(f.rules.unitSpeedOfPlayerTop).toEqual([0, 0.92, 0.97, 1.0, 1.03, 1.06]);
    expect(f.rules.evade.repairFeePct).toBe(RACING_CONFIG.damage.bustRepairPct);
    const l = racePursuitLoaders();
    expect(l.loadConfig(PURSUIT_RACE_REF)).toBe(f.cfg);
    expect(l.loadRace(PURSUIT_RACE_REF)).toBe(f.rules);
    expect(l.loadConfig('config/other.json')).toBeNull();
  });
});
