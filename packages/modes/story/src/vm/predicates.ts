/**
 * Predicates (C09 section C3 `Pred`): pure reads of the world and the mission through `PredEnv`. A predicate node costs 1 op;
 * `and` and `or` stop at the first deciding child, so the cost is that of the nodes actually evaluated. Sim code under the C02 lint.
 */
import type { MissionId, Pred, UnlockEventId, WeatherPreset } from '@dv/shared';

export interface PredEnv {
  inZone(who: string, zone: string): boolean;
  inVehicle(who: string, vehicle?: string): boolean;
  distance(a: string, b: string): number;
  /** Health as a fraction 0..1, null when the entity has none or is gone. */
  health(who: string): number | null;
  ko(who: string): boolean;
  destroyed(cast: string): boolean;
  busted(): boolean;
  heat(): { level: number; phase: 'clear' | 'pursuit' | 'search' | 'cooldown' | 'busted' };
  speed(who: string): number;
  hour(): number;
  weather(): WeatherPreset;
  flag(key: string): boolean | number | string | undefined;
  trust(npc: string): number;
  itemCount(id: string): number;
  cashCents(): number;
  objective(id: string): 'pending' | 'active' | 'done' | 'failed';
  stageSeconds(): number;
  eventSeen(name: string, since: 'stage' | 'mission'): boolean;
  modeResult(hook: string): string | undefined;
  passed(mission: MissionId): boolean;
  act(): number;
  unlocked(id: UnlockEventId): boolean;
}

export interface Cost {
  n: number;
}

/** Hours wrap: `from` 22 `to` 5 is the night. */
export const hourIn = (h: number, from: number, to: number): boolean => (from <= to ? h >= from && h < to : h >= from || h < to);

export function evalPred(p: Pred, e: PredEnv, cost: Cost): boolean {
  cost.n++;
  switch (p.p) {
    case 'true':
      return true;
    case 'and':
      for (const c of p.of) if (!evalPred(c, e, cost)) return false;
      return true;
    case 'or':
      for (const c of p.of) if (evalPred(c, e, cost)) return true;
      return false;
    case 'not':
      return !evalPred(p.of, e, cost);
    case 'inZone':
      return e.inZone(p.who, p.zone);
    case 'inVehicle':
      return e.inVehicle(p.who, p.vehicle);
    case 'near':
      return e.distance(p.a, p.b) <= p.maxM;
    case 'far':
      return e.distance(p.a, p.b) >= p.minM;
    case 'health': {
      const f = e.health(p.who);
      return f !== null && f < p.below;
    }
    case 'ko':
      return e.ko(p.who);
    case 'destroyed':
      return e.destroyed(p.cast);
    case 'busted':
      return e.busted();
    case 'heat': {
      const h = e.heat();
      if (p.min !== undefined && h.level < p.min) return false;
      if (p.max !== undefined && h.level > p.max) return false;
      return p.phase === undefined || h.phase === p.phase;
    }
    case 'speed': {
      const v = e.speed(p.who);
      return (p.minMps === undefined || v >= p.minMps) && (p.maxMps === undefined || v <= p.maxMps);
    }
    case 'hour':
      return hourIn(e.hour(), p.from, p.to);
    case 'weather':
      return p.is.includes(e.weather());
    case 'flag': {
      const v = e.flag(p.key);
      if (p.eq !== undefined) return v === p.eq;
      if (p.gte !== undefined) return typeof v === 'number' && v >= p.gte;
      return v !== undefined && v !== false && v !== 0 && v !== '';
    }
    case 'trust': {
      const t = e.trust(p.npc);
      return (p.gte === undefined || t >= p.gte) && (p.lte === undefined || t <= p.lte);
    }
    case 'item':
      return e.itemCount(p.id) >= p.gte;
    case 'cash':
      return e.cashCents() >= p.gteCents;
    case 'objective':
      return e.objective(p.id) === p.state;
    case 'stageTime': {
      const s = e.stageSeconds();
      return (p.gteSec === undefined || s >= p.gteSec) && (p.lteSec === undefined || s <= p.lteSec);
    }
    case 'event':
      return e.eventSeen(p.name, p.since);
    case 'modeResult': {
      const r = e.modeResult(p.hook);
      return r !== undefined && p.outcome.includes(r);
    }
    case 'passed':
      return e.passed(p.mission);
    case 'act':
      return e.act() >= p.gte;
    case 'unlocked':
      return e.unlocked(p.id);
  }
}
