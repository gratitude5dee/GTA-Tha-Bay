/**
 * The bust rule (M03c): a player in a vehicle slower than `bust.speedMps` with at least `bust.units` police units within
 * `bust.radiusM`, held for `bust.sec`; on foot, grappled for `bust.onFootGrappleSec`. The fine is
 * `max(minCents, floor(cash * cashPct / 100) + heat * perHeatCents)`.
 *
 * Sim code under the C02 lint.
 */
import { dsqrt } from '@dv/shared';
import type { Fnv64, HeatLevel, PursuitConfig } from '@dv/shared';
import { TICKS_PER_SEC } from './heat.ts';
import type { PlayerView, UnitView } from './ports.ts';

export function fineCents(cfg: PursuitConfig, cash: number, level: HeatLevel): number {
  return Math.max(cfg.fines.minCents, Math.floor((cash * cfg.fines.cashPct) / 100) + level * cfg.fines.perHeatCents);
}

export class BustModel {
  /** Contiguous ticks the bust condition has held. */
  ticks = 0;

  constructor(public cfg: PursuitConfig) {}

  /** Units that count: ground or named units that exist, within the bust radius of the player. */
  unitsNear(player: PlayerView, units: readonly UnitView[]): number {
    let n = 0;
    const r = this.cfg.bust.radiusM;
    for (const u of units) {
      if (!u.ready || u.role === 'heli') continue;
      const dx = u.pos[0] - player.pos[0], dz = u.pos[2] - player.pos[2];
      if (dsqrt(dx * dx + dz * dz) <= r) n++;
    }
    return n;
  }

  /** Advances by `dt` ticks; true on the tick the bust completes. */
  step(dt: number, player: PlayerView, units: readonly UnitView[]): boolean {
    const b = this.cfg.bust;
    let holds: boolean;
    let needTicks: number;
    if (player.onFoot) {
      holds = player.grappled;
      needTicks = b.onFootGrappleSec * TICKS_PER_SEC;
    } else {
      holds = player.speed < b.speedMps && this.unitsNear(player, units) >= b.units;
      needTicks = b.sec * TICKS_PER_SEC;
    }
    this.ticks = holds ? this.ticks + dt : 0;
    return this.ticks >= needTicks;
  }

  reset(): void {
    this.ticks = 0;
  }

  hash(h: Fnv64): void {
    h.u32(this.ticks);
  }
}
