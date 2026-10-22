/**
 * Nitro (06-racing.md 2.10; M07a1). Pure bookkeeping of the tank: how it fills, when it fires, how it drains. The push itself is
 * `stepHandling` (it adds `boostKw` at the wheels while `HandlingState.nitroOn` is set, fading out at the 110 % ceiling), so
 * the engine wrapper only mirrors `on` into the handling state each tick.
 *
 * Sources: drift 6/s, near miss +6, draft 8/s, airtime 10/s, perfect start +10, and a regenerating EV's braking 4/s above
 * 60 km/h. Capacity 100 (the profile's `nitro.capacity`, times the upgrade multiplier up to 1.45). It fires above `minToFire`
 * (15), drains 25/s (4 s from full) and stops at empty. Sim code under the C02 lint.
 */
import { SIM_DT, type HandlingProfile } from '@dv/shared';

export interface NitroState {
  charge: number;
  on: boolean;
  /** Ticks left before the tank may fire again (reserved for a stall; 0 in M07a1). */
  lockTicks: number;
}

export function newNitro(charge = 0): NitroState {
  return { charge, on: false, lockTicks: 0 };
}

/** Where the tank gets its fill this tick. */
export interface NitroSources {
  drifting: boolean;
  drafting: boolean;
  airborne: boolean;
  /** A near miss happened this tick (+`nearMiss` once). */
  nearMiss: boolean;
  /** The EV's braking regeneration is active (brake held above its minimum speed). */
  regen: boolean;
}
export const NO_SOURCES: NitroSources = { drifting: false, drafting: false, airborne: false, nearMiss: false, regen: false };

export type NitroProfile = Pick<HandlingProfile, 'nitro' | 'quirks'>;

/** Tank size: the profile's capacity times the upgrade multiplier (1 to 1.45). */
export function capacityOf(p: NitroProfile, upgrade = 1): number {
  return p.nitro.capacity * upgrade;
}

function regenRate(p: NitroProfile): number {
  for (const q of p.quirks ?? []) if (q.k === 'regenBraking') return q.nitroPerSec;
  return 0;
}

/**
 * One tick. `want` is the nitro button; `speedMps` is only used by the caller's ceiling (stepHandling), not here.
 * Returns the events of the tick: `fire` when the tank opens and `empty` when it runs dry.
 */
export function stepNitro(p: NitroProfile, st: NitroState, want: boolean, src: NitroSources, upgrade = 1): ('fire' | 'empty')[] {
  const out: ('fire' | 'empty')[] = [];
  const cap = capacityOf(p, upgrade);
  if (cap <= 0) {
    st.charge = 0;
    st.on = false;
    return out;
  }
  if (st.lockTicks > 0) st.lockTicks--;
  if (st.on) {
    if (!want) {
      st.on = false;
    } else {
      st.charge -= p.nitro.drainPerSec * SIM_DT;
      if (st.charge <= 0) {
        st.charge = 0;
        st.on = false;
        out.push('empty');
      }
    }
  } else if (want && st.lockTicks === 0 && st.charge >= p.nitro.minToFire) {
    st.on = true;
    out.push('fire');
  }
  // Filling stops while the tank is open.
  if (!st.on) {
    let gain = 0;
    if (src.drifting) gain += p.nitro.refill.driftPerSec * SIM_DT;
    if (src.drafting) gain += p.nitro.refill.draftPerSec * SIM_DT;
    if (src.airborne) gain += p.nitro.refill.airPerSec * SIM_DT;
    if (src.regen) gain += regenRate(p) * SIM_DT;
    if (src.nearMiss) gain += p.nitro.refill.nearMiss;
    addCharge(p, st, gain, upgrade);
  }
  return out;
}

/** Adds `amount` to the tank, never beyond its capacity. */
export function addCharge(p: NitroProfile, st: NitroState, amount: number, upgrade = 1): void {
  const cap = capacityOf(p, upgrade);
  st.charge = st.charge + amount > cap ? cap : st.charge + amount;
}

/** Perfect start: a throttle press within the window of GO adds `pct` percent of the tank. */
export function perfectStartBonus(p: NitroProfile, pct: number, upgrade = 1): number {
  return (capacityOf(p, upgrade) * pct) / 100;
}

/** The 0..1 tank level for the HUD. */
export function nitro01(p: NitroProfile, st: NitroState, upgrade = 1): number {
  const cap = capacityOf(p, upgrade);
  return cap > 0 ? st.charge / cap : 0;
}
