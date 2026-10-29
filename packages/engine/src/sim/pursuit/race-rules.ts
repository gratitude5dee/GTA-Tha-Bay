/**
 * The racing differences of the pursuit (M07a2; 06-racing.md 2.6, 06-racing-content.md C.11): `config/pursuit.race.json` extends
 * `config/pursuit.json` with a `race` block. The director loads it when the profile is `{kind: 'race', configRef}`.
 *
 *  - `unitSpeedOfPlayerTop[heat]`: a police unit never goes faster than this share of the player's top speed (`PlayerView.topMps`,
 *    the top speed of the car the player drives), so an evasion is skill and not speed. The dispatcher lifts the throttle of a
 *    unit at its limit.
 *  - `catchUp`: a unit more than `farM` behind and out of the player's view may go `boost` times faster, never beyond the 1.06 cap.
 *  - `bounty`: points per second at the current heat, per wrecked unit, and the cents one point pays.
 *  - `evade`: the lowest heat at which a bust costs the repair fee, and the fee in percent of the car's base price.
 *
 * The `roadblock` and `spikes` blocks of the spec arrive with M07b1; a file that has them is accepted and they are ignored.
 * Sim code under the C02 lint.
 */
import type { PursuitConfig } from '@dv/shared';
import { validatePursuitConfig, type ConfigIssue } from './config.ts';

export interface RacePursuitRules {
  /** Heat 0 to 5. */
  unitSpeedOfPlayerTop: number[];
  catchUp: { farM: number; boost: number; spawnBehindM: number; outOfViewOnly: boolean };
  bounty: { perSecAtHeat: number; perTakedown: number; centsPerPoint: number };
  evade: { bustMinHeat: number; repairFeePct: number };
}

/** The hard ceiling of every unit: 1.06 times the player's top speed (06-racing.md 2.6). */
export const UNIT_SPEED_CEILING = 1.06;

export type RulesResult = { ok: true; rules: RacePursuitRules } | { ok: false; issues: ConfigIssue[] };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function validateRaceRules(json: unknown): RulesResult {
  const issues: ConfigIssue[] = [];
  const bad = (path: string, message: string): void => void issues.push({ path, message });
  if (!isObj(json)) return { ok: false, issues: [{ path: 'race', message: 'must be an object' }] };
  const keys = (o: Record<string, unknown>, allowed: readonly string[], path: string): void => {
    for (const k of Object.keys(o)) if (k !== '$comment' && !allowed.includes(k)) bad(`${path}.${k}`, 'is not a known key');
  };
  const num = (o: Record<string, unknown>, k: string, path: string, min: number, max: number, int = false): number => {
    const v = o[k];
    const p = `${path}.${k}`;
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      bad(p, 'must be a number');
      return min;
    }
    if (v < min || v > max) bad(p, `must be between ${min} and ${max}`);
    if (int && !Number.isInteger(v)) bad(p, 'must be an integer');
    return v;
  };
  keys(json, ['unitSpeedOfPlayerTop', 'catchUp', 'bounty', 'evade', 'roadblock', 'spikes'], 'race');

  const u = json['unitSpeedOfPlayerTop'];
  const speeds: number[] = [];
  if (!Array.isArray(u) || u.length !== 6) bad('race.unitSpeedOfPlayerTop', 'must hold 6 numbers, heat 0 to 5');
  else {
    u.forEach((x, i) => {
      if (typeof x !== 'number' || !(x >= 0) || x > UNIT_SPEED_CEILING) bad(`race.unitSpeedOfPlayerTop[${i}]`, `must be between 0 and ${UNIT_SPEED_CEILING}`);
      else {
        if (i > 1 && x < (speeds[i - 1] as number)) bad(`race.unitSpeedOfPlayerTop[${i}]`, 'must not fall below the heat below');
        speeds.push(x);
      }
    });
  }
  const cu = isObj(json['catchUp']) ? json['catchUp'] : (bad('race.catchUp', 'must be an object'), {});
  keys(cu, ['farM', 'boost', 'spawnBehindM', 'outOfViewOnly'], 'race.catchUp');
  const farM = num(cu, 'farM', 'race.catchUp', 1, 5000);
  const boost = num(cu, 'boost', 'race.catchUp', 1, 2);
  const spawnBehindM = num(cu, 'spawnBehindM', 'race.catchUp', 0, 5000);
  if (typeof cu['outOfViewOnly'] !== 'boolean') bad('race.catchUp.outOfViewOnly', 'must be a boolean');
  const bo = isObj(json['bounty']) ? json['bounty'] : (bad('race.bounty', 'must be an object'), {});
  keys(bo, ['perSecAtHeat', 'perTakedown', 'centsPerPoint'], 'race.bounty');
  const perSecAtHeat = num(bo, 'perSecAtHeat', 'race.bounty', 0, 1000);
  const perTakedown = num(bo, 'perTakedown', 'race.bounty', 0, 100000);
  const centsPerPoint = num(bo, 'centsPerPoint', 'race.bounty', 0, 10000, true);
  const ev = isObj(json['evade']) ? json['evade'] : (bad('race.evade', 'must be an object'), {});
  keys(ev, ['bustMinHeat', 'repairFeePct'], 'race.evade');
  const bustMinHeat = num(ev, 'bustMinHeat', 'race.evade', 0, 6, true);
  const repairFeePct = num(ev, 'repairFeePct', 'race.evade', 0, 100);
  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    rules: {
      unitSpeedOfPlayerTop: speeds,
      catchUp: { farM, boost, spawnBehindM, outOfViewOnly: cu['outOfViewOnly'] === true },
      bounty: { perSecAtHeat, perTakedown, centsPerPoint },
      evade: { bustMinHeat, repairFeePct },
    },
  };
}

export type RaceFileResult = { ok: true; cfg: PursuitConfig; rules: RacePursuitRules } | { ok: false; issues: ConfigIssue[] };

/** Parses `config/pursuit.race.json` over its base (`extends`); `base` is the parsed `config/pursuit.json`. */
export function parseRacePursuit(json: unknown, base: PursuitConfig): RaceFileResult {
  if (!isObj(json)) return { ok: false, issues: [{ path: '', message: 'must be an object' }] };
  const issues: ConfigIssue[] = [];
  for (const k of Object.keys(json)) if (!['$comment', 'schema', 'extends', 'race'].includes(k)) issues.push({ path: k, message: 'is not a known key' });
  if (json['schema'] !== 1) issues.push({ path: 'schema', message: 'must be 1' });
  if (json['extends'] !== 'config/pursuit.json') issues.push({ path: 'extends', message: 'must be "config/pursuit.json"' });
  const r = validateRaceRules(json['race']);
  if (!r.ok) issues.push(...r.issues);
  const b = validatePursuitConfig(base);
  if (!b.ok) issues.push(...b.issues.map((i) => ({ path: `extends.${i.path}`, message: i.message })));
  if (issues.length > 0 || !r.ok || !b.ok) return { ok: false, issues };
  return { ok: true, cfg: b.config, rules: r.rules };
}

/** The speed limit of a unit in m/s at heat `level`, or null when the player's top speed is unknown. */
export function unitSpeedLimit(rules: RacePursuitRules, level: number, playerTopMps: number | undefined, farAndUnseen: boolean): number | null {
  if (playerTopMps === undefined || !(playerTopMps > 0)) return null;
  const l = level < 0 ? 0 : level > 5 ? 5 : level;
  let f = rules.unitSpeedOfPlayerTop[l] as number;
  if (farAndUnseen) f = Math.min(UNIT_SPEED_CEILING, f * rules.catchUp.boost);
  return f * playerTopMps;
}
