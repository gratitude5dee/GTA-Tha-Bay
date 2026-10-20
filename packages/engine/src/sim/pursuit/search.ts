/**
 * Search circle and cooldown (M03c). The spec is silent on the exact rule, so this is a Builder decision (BD-M03c-01):
 *
 *  - While any unit or witness sees the player (`seen`), `lastKnown` follows the player, the phase is `pursuit`, the circle is closed
 *    and the cooldown is 0.
 *  - When the player has been unseen for `search.losLostSec`, a circle opens at `lastKnown` (phase `search`). Its radius is
 *    `growMps` times the seconds since it opened, up to the level's `searchRadiusM`.
 *  - The cooldown fills only while the player is outside the circle and unseen (phase `cooldown`), over the level's `cooldownSec`,
 *    `search.hidingMultiplier` times as fast inside a hiding spot. Inside the circle the cooldown holds.
 *  - A full cooldown ends the pursuit: `step` answers `escaped`.
 *
 * Time is in ticks (60 Hz). Sim code under the C02 lint.
 */
import { dsqrt } from '@dv/shared';
import type { Fnv64, HeatLevel, PursuitConfig } from '@dv/shared';
import { TICKS_PER_SEC } from './heat.ts';
import type { Vec3 } from './ports.ts';

export type SearchPhase = 'clear' | 'pursuit' | 'search' | 'cooldown';

export interface SearchStepInput {
  dt: number;
  tick: number;
  level: HeatLevel;
  /** The player is in the sight of a unit, the helicopter or a witness. */
  seen: boolean;
  pos: Vec3;
  /** The player stands inside a hiding spot. */
  hiding: boolean;
}

export class SearchModel {
  phase: SearchPhase = 'clear';
  lastKnown: { pos: Vec3; tick: number } | null = null;
  /** Ticks unseen. */
  lostTicks = 0;
  /** Ticks since the circle opened. */
  openTicks = 0;
  radius = 0;
  /** 0..1 */
  cooldown = 0;

  constructor(public cfg: PursuitConfig) {}

  /** Starts a pursuit with the player last seen at `pos`. */
  start(pos: Vec3, tick: number): void {
    this.phase = 'pursuit';
    this.lastKnown = { pos: [pos[0], pos[1], pos[2]], tick };
    this.lostTicks = 0;
    this.openTicks = 0;
    this.radius = 0;
    this.cooldown = 0;
  }

  reset(): void {
    this.phase = 'clear';
    this.lastKnown = null;
    this.lostTicks = 0;
    this.openTicks = 0;
    this.radius = 0;
    this.cooldown = 0;
  }

  /** True when `pos` is inside the open circle. */
  inside(pos: Vec3): boolean {
    const k = this.lastKnown;
    if (!k || (this.phase !== 'search' && this.phase !== 'cooldown')) return false;
    const dx = pos[0] - k.pos[0], dz = pos[2] - k.pos[2];
    return dsqrt(dx * dx + dz * dz) <= this.radius;
  }

  /** Advances by `dt` ticks; returns `escaped` when the cooldown completes. */
  step(i: SearchStepInput): 'escaped' | null {
    if (this.phase === 'clear') return null;
    const lv = this.cfg.levels[i.level];
    if (i.seen) {
      this.phase = 'pursuit';
      this.lastKnown = { pos: [i.pos[0], i.pos[1], i.pos[2]], tick: i.tick };
      this.lostTicks = 0;
      this.openTicks = 0;
      this.radius = 0;
      this.cooldown = 0;
      return null;
    }
    this.lostTicks += i.dt;
    if (this.phase === 'pursuit') {
      if (this.lostTicks < this.cfg.search.losLostSec * TICKS_PER_SEC) return null;
      this.phase = 'search';
      this.openTicks = this.lostTicks - this.cfg.search.losLostSec * TICKS_PER_SEC;
    } else {
      this.openTicks += i.dt;
    }
    this.radius = Math.min(lv.searchRadiusM, (this.cfg.search.growMps * this.openTicks) / TICKS_PER_SEC);
    if (this.inside(i.pos)) {
      this.phase = 'search';
      return null;
    }
    this.phase = 'cooldown';
    const total = lv.cooldownSec * TICKS_PER_SEC;
    this.cooldown = total <= 0 ? 1 : Math.min(1, this.cooldown + (i.dt * (i.hiding ? this.cfg.search.hidingMultiplier : 1)) / total);
    return this.cooldown >= 1 ? 'escaped' : null;
  }

  hash(h: Fnv64): void {
    h.u8(this.phase === 'clear' ? 0 : this.phase === 'pursuit' ? 1 : this.phase === 'search' ? 2 : 3);
    h.u32(this.lostTicks).u32(this.openTicks).f64(this.radius).f64(this.cooldown);
    if (this.lastKnown) h.u8(1).f64(this.lastKnown.pos[0]).f64(this.lastKnown.pos[1]).f64(this.lastKnown.pos[2]).u32(this.lastKnown.tick);
    else h.u8(0);
  }
}
