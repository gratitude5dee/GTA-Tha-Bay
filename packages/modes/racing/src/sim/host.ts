/**
 * The handle the racing mode finds its world through (M07a1). The racing sim module (`module.ts`) installs one when the sim
 * worker boots with racing enabled; `mode.ts` reads it in `enter`. One per sim worker: modules are per-realm singletons, and the
 * mode runs in that realm.
 */
import type { RaceSession } from './session.ts';
import type { RaceWorldPort } from './port.ts';

export interface RacingHost {
  /** The player's car in the physics world. */
  port: RaceWorldPort;
  /** Makes `session` the one the sim state hash covers (resource `racing.session`, registered on first use). */
  attach(session: RaceSession | null): void;
  /** The sim profile the session runs under (`canonical` or `local`). */
  profile: 'local' | 'canonical';
  seed: number;
  /** Build id for replay headers (`VITE_DV_BUILD`); 'dev' when the host has none. */
  buildId: string;
  /** Wall clock in epoch ms for ghost and record times; the sim has none of its own, the worker injects it. */
  wallMs?: () => number;
}

let current: RacingHost | null = null;

export function setRacingHost(h: RacingHost | null): void {
  current = h;
}

export function getRacingHost(): RacingHost | null {
  return current;
}
