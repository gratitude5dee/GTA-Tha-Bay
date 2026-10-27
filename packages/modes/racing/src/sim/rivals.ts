/**
 * The rivals of an event as the AI field takes them (M07a2): the event's `opponents` with their cars and the difficulty's move of
 * their skill (-0.15 easy, 0 normal, +0.10 hard; 06-racing-content.md C.6). Sim code under the C02 lint.
 */
import type { Difficulty } from '@dv/shared';
import { raceCar, LOANER_CAR, type RaceCar } from '../cars.ts';
import type { RivalSpec } from './ai-driver.ts';

const SKILL_ADJUST: Record<Difficulty, number> = { easy: -0.15, normal: 0, hard: 0.1 };

export function rivalSpecs(def: { opponents: { driverId: string; vehicleDef: string; skill: number }[] }, difficulty: Difficulty): RivalSpec[] {
  return def.opponents.map((o) => {
    const car: RaceCar = raceCar(o.vehicleDef) ?? (raceCar(LOANER_CAR) as RaceCar);
    const skill = Math.max(0, Math.min(1, o.skill + SKILL_ADJUST[difficulty]));
    return { driverId: o.driverId, vehicleDef: car.vehicleDef, skill, profile: car.profile };
  });
}
