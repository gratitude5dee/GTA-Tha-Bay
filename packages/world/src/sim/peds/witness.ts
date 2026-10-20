/**
 * Pedestrian witnesses (living part 4.2; M03b2). A pedestrian within 25 m of an unreported collision or assault stands and watches
 * (`Witness`); after a seeded 3 to 6 s it reports it to the `WitnessBoard` of M03b1, which emits exactly one `world.witness` event
 * per infraction (a robotaxi that reported first, or an earlier pedestrian, silences the later ones). Pedestrians cast no
 * line-of-sight rays (BD-M03b2-02): the rays are the robotaxis' budget, so the range is shorter than the 40 m of a robotaxi.
 * The PursuitDirector subscribes to the board in M03c. Pure; C02 lint applies.
 */
import type { Ped } from './agent.ts';
import { PedState, WITNESS_MAX_TICKS, WITNESS_MIN_TICKS } from './components.ts';
import type { InfractionKind, WitnessBoard } from '../traffic/witness.ts';
import { INFRACTION_CODE, kindOfCode } from '../traffic/witness.ts';

/** A pedestrian sees an infraction within this distance, metres. */
export const PED_WITNESS_RANGE_M = 25;

/** The infractions a pedestrian notices. */
const NOTICED: ReadonlySet<InfractionKind> = new Set<InfractionKind>(['hitCivilianVehicle', 'hitPoliceVehicle', 'propertyDamage', 'assault']);

export const pedNotices = (k: InfractionKind): boolean => NOTICED.has(k);

/** Whether a stable key names a pedestrian slot (256 to 511) rather than a robotaxi (a traffic slot). */
export function isPedKey(key: string): boolean {
  const i = key.lastIndexOf(':');
  const slot = Number(key.slice(i + 1));
  return key.startsWith('amb:') && slot >= 256 && slot <= 511;
}

/**
 * Lets `p` pick up the nearest pending infraction in range if it holds none: it stands as a `Witness` and its report time is drawn
 * from its own stream (the stream advances only when it picks one up).
 */
export function noticeInfraction(p: Ped, board: WitnessBoard, tick: number): boolean {
  if (p.witnessInfraction !== 0) return false;
  let best = 0;
  let bd = PED_WITNESS_RANGE_M * PED_WITNESS_RANGE_M;
  let bk: InfractionKind | null = null;
  for (const i of board.pending()) {
    if (i.reported || !NOTICED.has(i.kind)) continue;
    const d = (i.x - p.x) * (i.x - p.x) + (i.z - p.z) * (i.z - p.z);
    if (d < bd) {
      bd = d;
      best = i.id;
      bk = i.kind;
    }
  }
  if (best === 0 || bk === null) return false;
  p.witnessInfraction = best;
  p.witnessKind = INFRACTION_CODE[bk];
  p.reportAt = tick + WITNESS_MIN_TICKS + Math.floor(p.rng.nextFloat() * (WITNESS_MAX_TICKS - WITNESS_MIN_TICKS + 1));
  if (p.state === PedState.Walk || p.state === PedState.Wait || p.state === PedState.Idle) {
    p.state = PedState.Witness;
    p.timer = p.reportAt - tick;
  }
  return true;
}

/** Sends the report when it is due. Returns true when the ped reported (the board may still have dropped it as a duplicate). */
export function reportIfDue(p: Ped, board: WitnessBoard, tick: number): boolean {
  if (p.witnessInfraction === 0 || tick < p.reportAt) return false;
  board.report(p.witnessInfraction, p.key, p.reportAt);
  p.witnessInfraction = 0;
  p.witnessKind = 0;
  if (p.state === PedState.Witness) {
    p.state = PedState.Walk;
    p.timer = 0;
  }
  return true;
}

export { kindOfCode };
