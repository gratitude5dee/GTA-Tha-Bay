/**
 * M07a2: the race rules of the pursuit (`config/pursuit.race.json`). The file parses over its base and every defect names its path;
 * under a `{kind: 'race'}` profile the dispatcher keeps every unit at its heat's share of the player's top speed (never above 1.06),
 * a unit far behind and out of view may close at the catch-up boost within that ceiling, a story profile has no cap, and a bust in a
 * race event costs no fine and no strike.
 */
import { describe, expect, it } from 'vitest';
import type { PursuitConfig } from '@dv/shared';
import { DEFAULT_PURSUIT_CONFIG } from '../../src/sim/pursuit/config.ts';
import { parseRacePursuit, UNIT_SPEED_CEILING, unitSpeedLimit, validateRaceRules, type RacePursuitRules } from '../../src/sim/pursuit/race-rules.ts';
import raceJson from '../../../../config/pursuit.race.json';
import { makeRig, type Rig } from './fakes.ts';

const RULES = validateRaceRules((raceJson as { race: unknown }).race);

describe('pursuit race rules', () => {
  it('config/pursuit.race.json parses over config/pursuit.json', () => {
    expect(RULES.ok).toBe(true);
    const r = parseRacePursuit(raceJson, DEFAULT_PURSUIT_CONFIG as PursuitConfig);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rules.unitSpeedOfPlayerTop).toEqual([0, 0.92, 0.97, 1.0, 1.03, 1.06]);
      expect(r.cfg.levels[3].maxUnits).toBe(DEFAULT_PURSUIT_CONFIG.levels[3].maxUnits);
    }
  });

  it('a defect is named by its path: a share over 1.06, a falling table, a missing block, an unknown key', () => {
    const base = (raceJson as { race: RacePursuitRules }).race;
    const bad = (o: Record<string, unknown>): string[] => {
      const r = validateRaceRules({ ...base, ...o });
      return r.ok ? [] : r.issues.map((i) => `${i.path} ${i.message}`);
    };
    expect(bad({ unitSpeedOfPlayerTop: [0, 0.92, 0.97, 1.0, 1.03, 1.2] }).join()).toContain('race.unitSpeedOfPlayerTop[5]');
    expect(bad({ unitSpeedOfPlayerTop: [0, 0.97, 0.92, 1, 1, 1] }).join()).toContain('race.unitSpeedOfPlayerTop[2]');
    expect(bad({ unitSpeedOfPlayerTop: [0, 1] }).join()).toContain('race.unitSpeedOfPlayerTop');
    expect(bad({ bounty: undefined }).join()).toContain('race.bounty');
    expect(bad({ catchUp: { ...base.catchUp, boost: 3 } }).join()).toContain('race.catchUp.boost');
    expect(bad({ extra: 1 }).join()).toContain('race.extra');
    const wrongBase = parseRacePursuit({ ...(raceJson as object), extends: 'config/other.json' }, DEFAULT_PURSUIT_CONFIG as PursuitConfig);
    expect(wrongBase.ok).toBe(false);
    // the roadblock and spikes blocks of M07b1 are accepted and ignored
    expect(validateRaceRules({ ...base, roadblock: { predictGates: 3 }, spikes: { lengthM: 9 } }).ok).toBe(true);
  });

  it('the speed limit is the share of the player\'s top speed; the catch-up lifts it but never above 1.06', () => {
    if (!RULES.ok) throw new Error('rules');
    const r = RULES.rules;
    expect(unitSpeedLimit(r, 2, 50, false)).toBeCloseTo(48.5, 9);
    expect(unitSpeedLimit(r, 0, 50, false)).toBe(0);
    expect(unitSpeedLimit(r, 2, 50, true)).toBeCloseTo(Math.min(UNIT_SPEED_CEILING, 0.97 * 1.15) * 50, 9);
    expect(unitSpeedLimit(r, 5, 50, true)).toBeCloseTo(UNIT_SPEED_CEILING * 50, 9);
    expect(unitSpeedLimit(r, 3, undefined, false)).toBeNull();
    expect(unitSpeedLimit(r, 3, 0, false)).toBeNull();
  });
});

/** Units that move: a bicycle model on the rig's host, driven by the director's own input. */
function drive(rig: Rig, seconds: number, onTick?: () => void): { maxSpeed: number; maxNear: number } {
  let maxSpeed = 0;
  let maxNear = 0;
  const dt = 1 / 60;
  for (let t = 0; t < seconds * 60; t++) {
    for (const u of rig.host.units.values()) {
      const i = u.input;
      u.speed = Math.max(0, u.speed + (i.throttle * 9 - i.brake * 12 - 0.0008 * u.speed * u.speed) * dt);
      u.yaw -= (i.steer * Math.min(u.speed, 20) / 2.9) * 0.55 * dt;
      u.pos = [u.pos[0] + -Math.sin(u.yaw) * u.speed * dt, 0, u.pos[2] + -Math.cos(u.yaw) * u.speed * dt];
      u.vel = [-Math.sin(u.yaw) * u.speed, 0, -Math.cos(u.yaw) * u.speed];
      maxSpeed = Math.max(maxSpeed, u.speed);
      // within the catch-up distance (200 m) a unit is bound by its heat's share, not the boost
      if (Math.hypot(u.pos[0] - rig.host.p.pos[0], u.pos[2] - rig.host.p.pos[2]) < 190) maxNear = Math.max(maxNear, u.speed);
    }
    // a unit that has fallen back past 150 m is put 100 m behind the player again (so the chase stays in range for the speed check)
    if (t % 120 === 0) {
      for (const u of rig.host.units.values()) {
        if (Math.hypot(u.pos[0] - rig.host.p.pos[0], u.pos[2] - rig.host.p.pos[2]) > 150) {
          u.pos = [rig.host.p.pos[0] + 4, 0, rig.host.p.pos[2] + 100];
          u.yaw = 0;
        }
      }
    }
    // the player runs straight north at 40 m/s
    rig.host.p.pos = [rig.host.p.pos[0], 0, rig.host.p.pos[2] - 40 * dt];
    rig.host.p.vel = [0, 0, -40];
    rig.host.p.speed = 40;
    rig.host.p.yaw = 0;
    if (t % 2 === 0) {
      rig.tick += 2;
      rig.director.step(rig.tick);
    }
    onTick?.();
  }
  return { maxSpeed, maxNear };
}

describe('the cap in the dispatcher', () => {
  const run = (race: boolean, top: number): { maxSpeed: number; maxNear: number } => {
    const rig = makeRig();
    rig.host.p.topMps = top;
    rig.host.p.pos = [0, 0, 0];
    if (race) {
      rig.director.setProfile({ kind: 'race', startHeat: 2, maxHeat: 3, success: { kind: 'evade' }, configRef: 'config/pursuit.race.json' });
      rig.director.raceRules = RULES.ok ? RULES.rules : null;
      rig.director.dispatch.raceRules = rig.director.raceRules;
    } else rig.director.forceHeat(2);
    // sight along the whole way: the units close on the player and chase at their cruise speed
    rig.host.sight = () => true;
    return drive(rig, 90);
  };

  it('under a race profile no unit goes above its share of the top speed; without the profile the same chase goes faster', () => {
    const free = run(false, 30);
    const capped = run(true, 30);
    expect(free.maxNear).toBeGreaterThan(0.97 * 30 + 3);
    expect(capped.maxNear).toBeLessThanOrEqual(0.97 * 30 * 1.02);
    // far behind and out of view a unit may close faster, never above 1.06 times the top speed
    expect(capped.maxSpeed).toBeLessThanOrEqual(UNIT_SPEED_CEILING * 30 * 1.02);
  });

  it('a faster car lifts the cap with it: the limit is a share of the car\'s own top speed', () => {
    const slow = run(true, 30);
    const fast = run(true, 60);
    expect(fast.maxNear).toBeGreaterThan(slow.maxNear + 3);
    expect(fast.maxSpeed).toBeLessThanOrEqual(UNIT_SPEED_CEILING * 60 * 1.02);
  });

  it('a story profile has no cap, and the race cap is gone again when the profile goes back', () => {
    const rig = makeRig();
    rig.director.setProfile({ kind: 'race', startHeat: 0, maxHeat: 3, configRef: 'config/pursuit.race.json' });
    expect(rig.director.raceRules).toBeNull();
    rig.director.raceRules = RULES.ok ? RULES.rules : null;
    rig.director.dispatch.raceRules = rig.director.raceRules;
    rig.director.setProfile({ kind: 'story', startHeat: 0, maxHeat: 5 });
    expect(rig.director.raceRules).toBeNull();
    expect(rig.director.dispatch.raceRules).toBeNull();
  });

  it('a bust in a race event costs no fine and no strike; in the story it costs a fine and a strike', () => {
    for (const race of [true, false]) {
      const rig = makeRig();
      if (race) rig.director.setProfile({ kind: 'race', startHeat: 3, maxHeat: 3, success: { kind: 'evade' } });
      else rig.director.forceHeat(3);
      rig.host.p.pos = [0, 0, 0];
      rig.host.p.speed = 0;
      rig.host.p.vel = [0, 0, 0];
      rig.host.sight = () => true;
      rig.run(300);
      const ground = [...rig.host.units.values()].filter((u) => u.role !== 'heli').slice(0, 2);
      ground[0]!.pos = [3, 0, 0];
      ground[1]!.pos = [-4, 0, 2];
      const before = rig.wallet.balance;
      rig.run(190);
      expect(rig.director.bustCount, race ? 'race' : 'story').toBe(1);
      if (race) {
        expect(rig.wallet.balance).toBe(before);
        expect(rig.wallet.log).toHaveLength(0);
        expect(rig.director.lastFine).toBe(0);
        expect(rig.director.lastStrikes).toBe(0);
        expect(rig.host.named('pursuit.busted')[0]?.n).toBe(0);
      } else {
        expect(rig.wallet.balance).toBeLessThan(before);
        expect(rig.director.lastFine).toBeGreaterThan(0);
      }
    }
  });
});
