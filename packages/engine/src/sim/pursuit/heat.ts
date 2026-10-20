/**
 * Heat points, levels and witness delays (M03c rules 4 to 6, `01-engine-save-modes.md` "PursuitDirector core").
 *
 *  - `HeatModel`: the points of the player, the level they give (0 to 5; 6 only when scripted), the level cap, the scripted flag.
 *    A level never falls by itself: only a completed cooldown, a bust or an explicit `clear` returns it to 0 (points below the first
 *    level threshold decay, `SUB_LEVEL_DECAY_PER_SEC`, a Builder choice: BD-M03c-02).
 *  - `ReportQueue`: infractions waiting for their witness delay. A police unit or the helicopter reports at once, a robotaxi after
 *    `witness.robotaxiDelaySec`, a pedestrian after a delay drawn from `witness.pedDelaySec` on stream `pursuit` (and only when
 *    `witness.pedReports`).
 *
 * Time is in sim ticks (60 Hz); the director steps at 30 Hz, so a step may span two ticks. Sim code under the C02 lint.
 */
import type { HeatLevel, InfractionKind, PursuitConfig } from '@dv/shared';
import type { Fnv64 } from '@dv/shared';
import type { Rng } from '@dv/shared';
import type { Vec3 } from './ports.ts';

export const TICKS_PER_SEC = 60;
/** Points below the first level threshold fall by this much per second (stays inside the "no level yet" band). */
export const SUB_LEVEL_DECAY_PER_SEC = 2;

export class HeatModel {
  level: HeatLevel = 0;
  points = 0;
  cap: HeatLevel = 5;
  scripted = false;

  constructor(public cfg: PursuitConfig) {}

  /** The level `points` give, without the cap and never 6 (6 is set, not earned). */
  levelForPoints(points: number): HeatLevel {
    let l = 0;
    for (let i = 1; i <= 5; i++) {
      if (points >= (this.cfg.levels[i] as { points: number }).points) l = i;
    }
    return l as HeatLevel;
  }

  /** Adds points; returns the new level when it rose, else null. */
  add(n: number): HeatLevel | null {
    if (n <= 0) return null;
    this.points += n;
    const earned = this.levelForPoints(this.points);
    const max = this.level === 6 ? 6 : Math.min(earned, this.cap) as HeatLevel;
    if (max > this.level) {
      this.level = max;
      return max;
    }
    return null;
  }

  /** Sets the level and the points that go with it. `6` is allowed only while scripted; returns false when refused. */
  set(l: HeatLevel): boolean {
    if (l === 6 && !this.scripted) return false;
    const lv = (l > this.cap && l !== 6 ? this.cap : l) as HeatLevel;
    this.level = lv;
    this.points = this.cfg.levels[lv].points;
    return true;
  }

  /** Lowers the ceiling; a level above it drops to it. */
  setCap(l: HeatLevel): void {
    this.cap = l;
    if (this.level > l && this.level !== 6) {
      this.level = l;
      this.points = Math.min(this.points, this.cfg.levels[l].points);
    }
  }

  clear(): void {
    this.level = 0;
    this.points = 0;
  }

  /** Points below the first threshold decay; at level 1 or more nothing decays. */
  decay(dtTicks: number): void {
    if (this.level > 0 || this.points <= 0) return;
    this.points = Math.max(0, this.points - (SUB_LEVEL_DECAY_PER_SEC * dtTicks) / TICKS_PER_SEC);
  }

  hash(h: Fnv64): void {
    h.u8(this.level).f64(this.points).u8(this.cap).u8(this.scripted ? 1 : 0);
  }
}

export type ReportWitness = 'police' | 'robotaxi' | 'ped' | 'heli';

export interface PendingReport {
  /** Sim tick the report lands. */
  due: number;
  seq: number;
  kind: InfractionKind;
  pos: Vec3;
  count: number;
  witness: ReportWitness;
}

export class ReportQueue {
  readonly items: PendingReport[] = [];
  private seq = 0;

  /** The delay in ticks a witness adds to a report; consumes one draw of stream `pursuit` for a pedestrian. */
  delayTicks(cfg: PursuitConfig, w: ReportWitness, rng: Rng): number {
    if (w === 'robotaxi') return Math.round(cfg.witness.robotaxiDelaySec * TICKS_PER_SEC);
    if (w === 'ped') {
      const [a, b] = cfg.witness.pedDelaySec;
      return Math.round(rng.range(a, b) * TICKS_PER_SEC);
    }
    return 0;
  }

  /** Queues a report that lands at `due`. */
  push(due: number, kind: InfractionKind, pos: Vec3, count: number, witness: ReportWitness): void {
    this.items.push({ due, seq: this.seq++, kind, pos: [pos[0], pos[1], pos[2]], count, witness });
    this.items.sort((a, b) => a.due - b.due || a.seq - b.seq);
  }

  /** Removes and returns the reports due at or before `tick`, in order. */
  take(tick: number): PendingReport[] {
    let n = 0;
    while (n < this.items.length && (this.items[n] as PendingReport).due <= tick) n++;
    return n === 0 ? [] : this.items.splice(0, n);
  }

  clear(): void {
    this.items.length = 0;
  }

  hash(h: Fnv64): void {
    h.u32(this.items.length);
    for (const r of this.items) h.u32(r.due).u32(r.seq).str(r.kind).u8(r.witness === 'police' ? 0 : r.witness === 'robotaxi' ? 1 : r.witness === 'ped' ? 2 : 3).f64(r.count).f64(r.pos[0]).f64(r.pos[1]).f64(r.pos[2]);
  }
}
