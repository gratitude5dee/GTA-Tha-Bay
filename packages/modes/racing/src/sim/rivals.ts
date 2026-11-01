/**
 * The rivals of an event as the AI field takes them (M07a2): the event's `opponents` with their cars and the difficulty's move of
 * their skill (-0.15 easy, 0 normal, +0.10 hard; 06-racing-content.md C.6). Sim code under the C02 lint.
 */
import type { Difficulty } from '@dv/shared';
import { raceCar, LOANER_CAR, RACE_CARS, type RaceCar } from '../cars.ts';
import type { RivalSpec } from './ai-driver.ts';

const SKILL_ADJUST: Record<Difficulty, number> = { easy: -0.15, normal: 0, hard: 0.1 };

export function rivalSpecs(def: { opponents: { driverId: string; vehicleDef: string; skill: number }[] }, difficulty: Difficulty): RivalSpec[] {
  return def.opponents.map((o) => {
    const car: RaceCar = raceCar(o.vehicleDef) ?? (raceCar(LOANER_CAR) as RaceCar);
    const skill = Math.max(0, Math.min(1, o.skill + SKILL_ADJUST[difficulty]));
    return { driverId: o.driverId, vehicleDef: car.vehicleDef, skill, profile: car.profile };
  });
}

/** Most rivals a field can have (the largest `tierCaps.rivals` of `config/racing.json`). */
export const MAX_RIVALS = 7;

/**
 * A field of `count` rivals (0 to `MAX_RIVALS`) cycling through the six race cars, skills 0.40 to 0.70 by seat. `racing.start` takes it as
 * `params.rivals` (M11a1): the perf scenarios `race-sprint` start a field as large as the tier allows, `tierCaps.rivals` of `config/racing.json`
 * (7 desktop, 5 mobile, 3 mobile-low), on a race whose own `opponents` list is shorter.
 */
export function rivalField(count: number, difficulty: Difficulty): RivalSpec[] {
  const n = Math.max(0, Math.min(MAX_RIVALS, Math.floor(count)));
  const out: RivalSpec[] = [];
  for (let i = 0; i < n; i++) {
    const car: RaceCar = RACE_CARS[i % RACE_CARS.length] ?? (raceCar(LOANER_CAR) as RaceCar);
    const skill = Math.max(0, Math.min(1, 0.4 + 0.05 * i + SKILL_ADJUST[difficulty]));
    out.push({ driverId: `rival.field-${i + 1}`, vehicleDef: car.vehicleDef, skill, profile: car.profile });
  }
  return out;
}
