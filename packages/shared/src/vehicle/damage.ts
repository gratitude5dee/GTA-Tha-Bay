/**
 * Vehicle damage (06-racing-data.md 4.1). Pure; the sim keeps one `DamageState` per vehicle (component `VehicleDamage`).
 *
 * One number sets the scale: a 15 m/s head-on hit into a wall on `normal` costs a durability-1.0 car 0.23 of its body
 * (`WALL_HIT_BODY_LOSS`); damage grows with the square of the normal speed, so a 7.5 m/s hit costs a quarter of that.
 */
import type { Difficulty, HandlingProfile } from './handling.ts';

export interface DamageState { body: number; engine: number; tires: [number, number, number, number] }
export type ImpactKind = 'static' | 'vehicle' | 'prop' | 'ped' | 'spike' | 'landing';
export interface Impact {
  kind: ImpactKind;
  vNormal: number;
  vTangent: number;
  /** Contact point in the body frame (x right, y up, z back). */
  local: [number, number, number];
  otherMassKg: number;
  tire?: 0 | 1 | 2 | 3;
}

/** Body loss of a 15 m/s wall hit at durability 1.0 on `normal`. */
export const WALL_HIT_BODY_LOSS = 0.23;
export const WALL_HIT_SPEED = 15;
/** Impacts slower than this (m/s along the normal) cost nothing. */
export const IMPACT_FLOOR_MPS = 2.5;
const DIFFICULTY_SCALE: Readonly<Record<Difficulty, number>> = { easy: 0.6, normal: 1, hard: 1.4 };
/** How hard each kind of contact hits the body, relative to a wall. */
const KIND_SCALE: Readonly<Record<ImpactKind, number>> = { static: 1, vehicle: 0.9, prop: 0.35, ped: 0.08, spike: 0, landing: 0.5 };

export function newDamage(): DamageState {
  return { body: 1, engine: 1, tires: [1, 1, 1, 1] };
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

export function applyImpact(p: HandlingProfile, d: DamageState, i: Impact, difficulty: Difficulty): DamageState {
  const tires: [number, number, number, number] = [d.tires[0], d.tires[1], d.tires[2], d.tires[3]];
  let body = d.body;
  let engine = d.engine;
  if (i.kind === 'spike') {
    const t = i.tire ?? 0;
    tires[t] = clamp01((tires[t] as number) - 0.5);
    return { body, engine, tires };
  }
  const v = i.vNormal > 0 ? i.vNormal : -i.vNormal;
  if (v > IMPACT_FLOOR_MPS) {
    const ratio = v / WALL_HIT_SPEED;
    let loss = (WALL_HIT_BODY_LOSS * ratio * ratio * KIND_SCALE[i.kind] * DIFFICULTY_SCALE[difficulty]) / p.durability;
    // Hitting something heavier than the car hurts more; something lighter, less (clamped to 0.5 .. 1.5).
    if (i.kind === 'vehicle' && i.otherMassKg > 0) {
      const m = i.otherMassKg / p.massKg;
      loss *= m < 0.5 ? 0.5 : m > 1.5 ? 1.5 : m;
    }
    body = clamp01(body - loss);
    // The front of the car is 'z < 0' in the body frame (forward is -Z): it also hurts the engine.
    if (i.local[2] < -0.4) engine = clamp01(engine - loss * 0.6);
    if (i.kind === 'landing' && v > 6) {
      for (let k = 0; k < 4; k++) tires[k] = clamp01((tires[k] as number) - loss * 0.3);
    }
  }
  return { body, engine, tires };
}

/** 1 at full engine health, 0.6 at worst. */
export function powerScale(d: Pick<DamageState, 'engine'>): number {
  return 1 - 0.4 * (1 - d.engine);
}

/** 1 for a new tyre, 0.4 when it is gone. */
export function tireGripScale(d: Pick<DamageState, 'tires'>, wheel: 0 | 1 | 2 | 3): number {
  return 1 - 0.6 * (1 - (d.tires[wheel] as number));
}
