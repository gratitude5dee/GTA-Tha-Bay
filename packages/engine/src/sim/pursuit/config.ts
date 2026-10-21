/**
 * The pursuit config (M03c): `config/pursuit.json` as a typed object, and a validator that names the JSON path of every defect.
 * The JSON Schema `packages/shared/schemas/pursuit.schema.json` is the build-time check; this validator is the runtime one (the
 * sim bundle carries no schema library) and says the same things. Racing's `config/pursuit.race.json` passes through the same
 * validator (`PursuitProfile.configRef`).
 *
 * Sim code under the C02 lint.
 */
import type { HeatLevel, InfractionKind, PursuitConfig, PursuitLevelDef, Tactic } from '@dv/shared';
import pursuitJson from '../../../../../config/pursuit.json';

export const INFRACTION_KINDS: readonly InfractionKind[] = [
  'speedingSeen', 'redLightSeen', 'hitCivilianVehicle', 'hitPoliceVehicle', 'propertyDamage', 'assault', 'zoneViolation', 'evasion',
];
export const TACTICS: readonly Tactic[] = [
  'follow', 'siren', 'loudspeaker', 'pit', 'boxIn', 'rollingBlock', 'roadblock2', 'roadblockHeavy', 'spikes', 'heliSpotlight', 'suvRam', 'portalSeal',
];

export interface ConfigIssue {
  /** JSON path such as `levels[3].searchRadiusM`. */
  path: string;
  message: string;
}

export type ConfigResult = { ok: true; config: PursuitConfig } | { ok: false; issues: ConfigIssue[] };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Validates a parsed config; every defect carries its path. Extra keys other than `$comment` are defects. */
export function validatePursuitConfig(json: unknown): ConfigResult {
  const issues: ConfigIssue[] = [];
  const bad = (path: string, message: string): void => void issues.push({ path, message });
  const num = (o: Record<string, unknown>, k: string, path: string, opts: { int?: boolean; min?: number; positive?: boolean; max?: number } = {}): void => {
    const v = o[k];
    const p = path === '' ? k : `${path}.${k}`;
    if (typeof v !== 'number' || !Number.isFinite(v)) return bad(p, 'must be a number');
    if (v < 0) return bad(p, 'must not be negative');
    if (opts.positive && v <= 0) return bad(p, 'must be greater than 0');
    if (opts.min !== undefined && v < opts.min) return bad(p, `must be at least ${opts.min}`);
    if (opts.max !== undefined && v > opts.max) return bad(p, `must be at most ${opts.max}`);
    if (opts.int && !Number.isInteger(v)) bad(p, 'must be an integer');
  };
  const keys = (o: Record<string, unknown>, allowed: readonly string[], path: string): void => {
    for (const k of Object.keys(o)) if (k !== '$comment' && !allowed.includes(k)) bad(path === '' ? k : `${path}.${k}`, 'is not a known key');
  };

  if (!isObj(json)) return { ok: false, issues: [{ path: '', message: 'must be an object' }] };
  keys(json, ['schema', 'levels', 'infractionPoints', 'witness', 'search', 'bust', 'fines', 'impoundStrikes'], '');
  if (json['schema'] !== 1) bad('schema', 'must be 1');

  const levels = json['levels'];
  if (!Array.isArray(levels)) bad('levels', 'must be an array of 7 levels');
  else {
    if (levels.length !== 7) bad('levels', `must hold levels 0 to 6, found ${levels.length}`);
    for (let i = 0; i < 7; i++) {
      const lv = levels[i];
      const p = `levels[${i}]`;
      if (!isObj(lv)) {
        bad(p, 'is missing');
        continue;
      }
      keys(lv, ['points', 'maxUnits', 'suv', 'heli', 'tactics', 'searchRadiusM', 'cooldownSec'], p);
      num(lv, 'points', p);
      num(lv, 'maxUnits', p, { int: true, max: 32 });
      num(lv, 'suv', p, { int: true, max: 32 });
      num(lv, 'searchRadiusM', p);
      num(lv, 'cooldownSec', p);
      if (typeof lv['heli'] !== 'boolean') bad(`${p}.heli`, 'must be a boolean');
      const t = lv['tactics'];
      if (!Array.isArray(t)) bad(`${p}.tactics`, 'must be an array');
      else {
        t.forEach((x, j) => {
          if (typeof x !== 'string' || !TACTICS.includes(x as Tactic)) bad(`${p}.tactics[${j}]`, `is not a tactic: ${String(x)}`);
        });
        if (new Set(t).size !== t.length) bad(`${p}.tactics`, 'holds a tactic twice');
      }
      if (typeof lv['maxUnits'] === 'number' && typeof lv['suv'] === 'number' && lv['suv'] > lv['maxUnits']) bad(`${p}.suv`, 'exceeds maxUnits');
      if (i > 0 && typeof lv['points'] === 'number') {
        const prev = levels[i - 1];
        if (isObj(prev) && typeof prev['points'] === 'number' && lv['points'] <= prev['points']) bad(`${p}.points`, 'must exceed the level below');
      }
    }
  }

  const ip = json['infractionPoints'];
  if (!isObj(ip)) bad('infractionPoints', 'must be an object');
  else {
    keys(ip, INFRACTION_KINDS, 'infractionPoints');
    for (const k of INFRACTION_KINDS) num(ip, k, 'infractionPoints');
  }

  const w = json['witness'];
  if (!isObj(w)) bad('witness', 'must be an object');
  else {
    keys(w, ['robotaxiDelaySec', 'pedDelaySec', 'pedReports'], 'witness');
    num(w, 'robotaxiDelaySec', 'witness');
    const pd = w['pedDelaySec'];
    if (!Array.isArray(pd) || pd.length !== 2 || pd.some((x) => typeof x !== 'number' || !Number.isFinite(x) || x < 0)) bad('witness.pedDelaySec', 'must be two non-negative numbers');
    else if ((pd[0] as number) > (pd[1] as number)) bad('witness.pedDelaySec', 'must be ascending');
    if (typeof w['pedReports'] !== 'boolean') bad('witness.pedReports', 'must be a boolean');
  }

  const s = json['search'];
  if (!isObj(s)) bad('search', 'must be an object');
  else {
    keys(s, ['losLostSec', 'growMps', 'hidingMultiplier', 'losChecksPerTick'], 'search');
    num(s, 'losLostSec', 'search');
    num(s, 'growMps', 'search');
    num(s, 'hidingMultiplier', 'search', { min: 1 });
    num(s, 'losChecksPerTick', 'search', { int: true, min: 1, max: 256 });
  }

  const b = json['bust'];
  if (!isObj(b)) bad('bust', 'must be an object');
  else {
    keys(b, ['speedMps', 'units', 'radiusM', 'sec', 'onFootGrappleSec'], 'bust');
    num(b, 'speedMps', 'bust');
    num(b, 'units', 'bust', { int: true, min: 1, max: 16 });
    num(b, 'radiusM', 'bust', { positive: true });
    num(b, 'sec', 'bust', { positive: true });
    num(b, 'onFootGrappleSec', 'bust', { positive: true });
  }

  const f = json['fines'];
  if (!isObj(f)) bad('fines', 'must be an object');
  else {
    keys(f, ['minCents', 'cashPct', 'perHeatCents'], 'fines');
    num(f, 'minCents', 'fines', { int: true });
    num(f, 'cashPct', 'fines', { max: 100 });
    num(f, 'perHeatCents', 'fines', { int: true });
  }
  num(json, 'impoundStrikes', '', { int: true, min: 1, max: 10 });

  return issues.length === 0 ? { ok: true, config: json as unknown as PursuitConfig } : { ok: false, issues };
}

/** Throws with every path when the config is not valid; returns it typed otherwise. */
export function parsePursuitConfig(json: unknown): PursuitConfig {
  const r = validatePursuitConfig(json);
  if (!r.ok) throw new Error(`pursuit config: ${r.issues.map((i) => `${i.path || '(root)'} ${i.message}`).join('; ')}`);
  return r.config;
}

/** The default values, `config/pursuit.json`. */
export const DEFAULT_PURSUIT_CONFIG: PursuitConfig = parsePursuitConfig(pursuitJson);

export const levelDef = (c: PursuitConfig, l: HeatLevel): PursuitLevelDef => c.levels[l];
export const hasTactic = (c: PursuitConfig, l: HeatLevel, t: Tactic): boolean => c.levels[l].tactics.includes(t);
