/**
 * Race damage (06-racing.md 2.10; M07a1). One contact costs
 *
 *     d = k * max(0, vNormal - vThreshold)^2 * difficulty / durability       (k 0.0016, vThreshold 3 m/s)
 *
 * of the body. A hit on the front adds `engineShareFront * d` to the engine; a spike strip sets the crossed tyre to 0; a landing
 * counts above `landingVy` (6 m/s) vertical. At body 0 the car is totaled: engine cut, DNF in a race. The engine wrapper reads the
 * result through `powerScale` (engine health, never below 0.6) and `tireGripScale` (a flat tyre keeps 0.4). All numbers are
 * `config/racing.json`. Pure; C02 lint applies.
 */
import { powerScale, type DamageState, type Difficulty, type HandlingProfile, type Impact } from '@dv/shared';
import type { RacingConfig } from '../config.ts';

export type DamageConfig = RacingConfig['damage'];
export type DamageProfile = Pick<HandlingProfile, 'durability'>;

export interface DamageResult {
  state: DamageState;
  /** Body loss this contact, 0..1. */
  loss: number;
  /** True on the contact that took the body to 0. */
  totaled: boolean;
  /** `race.dnf` when the car was totaled by this contact. */
  events: { t: 'race.dnf'; reason: 'totaled' }[];
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Body loss of a contact with normal speed `v` (m/s). */
export function contactLoss(cfg: DamageConfig, p: DamageProfile, v: number, difficulty: Difficulty): number {
  const over = (v < 0 ? -v : v) - cfg.vThreshold;
  if (over <= 0) return 0;
  return (cfg.k * over * over * cfg.difficulty[difficulty]) / p.durability;
}

export function applyRaceImpact(cfg: DamageConfig, p: DamageProfile, d: DamageState, i: Impact, difficulty: Difficulty): DamageResult {
  const tires: [number, number, number, number] = [d.tires[0], d.tires[1], d.tires[2], d.tires[3]];
  let body = d.body;
  let engine = d.engine;
  let loss = 0;
  if (i.kind === 'spike') {
    const t = i.tire ?? 0;
    tires[t] = clamp01(tires[t] * (1 - cfg.spikePuncture));
  } else if (i.kind === 'landing') {
    if ((i.vNormal < 0 ? -i.vNormal : i.vNormal) > cfg.landingVy) {
      loss = contactLoss(cfg, p, i.vNormal, difficulty);
      body = clamp01(body - loss);
    }
  } else {
    loss = contactLoss(cfg, p, i.vNormal, difficulty);
    body = clamp01(body - loss);
    // The front of the car is z < 0 in the body frame (forward is -Z).
    if (loss > 0 && i.local[2] < -0.4) engine = clamp01(engine - cfg.engineShareFront * loss);
  }
  const totaled = d.body > 0 && body <= 0;
  const state: DamageState = { body, engine: totaled ? 0 : engine, tires };
  return { state, loss, totaled, events: totaled ? [{ t: 'race.dnf', reason: 'totaled' }] : [] };
}

/** Engine power multiplier for a damage state: 1 at full health, 0.6 at worst (`powerScale`). */
export function racePowerScale(d: DamageState): number {
  return powerScale(d);
}

/** A repair kit restores `repairKitPct` percent of the body once per event. */
export function applyRepairKit(cfg: DamageConfig, d: DamageState): DamageState {
  const add = cfg.repairKitPct / 100;
  return { body: clamp01(d.body + add), engine: clamp01(d.engine + add), tires: [1, 1, 1, 1] };
}
