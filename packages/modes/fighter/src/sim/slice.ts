/**
 * `FighterSlice` (C05 slot `mode:fighter`, schema 1; FC2 "Fighter slice"). The slice holds unlocked fighters, cosmetic XP, the Arcade
 * record, the player's settings and the last loadout. Pose calibration is NOT here (FP4: device-local store). Everything read from
 * a saved slice is validated and clamped: a corrupt field falls back to its default and the mode stays playable. Sim code under the C02 lint.
 */
import type { JsonObject, JsonValue } from '@dv/shared';
import unlocksJson from '../../../../../config/unlocks.json';

export type FighterId = string;
export type Difficulty = 0 | 1 | 2 | 3;

export interface FighterSlice {
  schema: 1;
  unlockedFighters: FighterId[];
  fighterXp: Record<FighterId, number>;
  cosmetics: string[];
  arcade: Record<FighterId, { cleared: boolean; bestTimeSec?: number; bestDifficulty?: Difficulty }>;
  settings: {
    scheme: 'classic' | 'simple'; inputDisplay: boolean; difficulty: Difficulty; cinematics: 'off' | 'first' | 'always';
    seenReveal: Record<FighterId, boolean>; hybridPose: boolean;
  };
  lastLoadout: { slot: string; costume: number } | null;
}

export const SLICE_SCHEMA = 1 as const;
/** The fighters selectable before any unlock row says otherwise (FX8.2: PLAYER_FIGHTER and the bout.a5 opponent come with `unlock.fighter`). */
export const STARTER_FIGHTERS: readonly FighterId[] = ['player'];
export const MAX_XP = 1_000_000;

export function defaultSlice(): FighterSlice {
  return {
    schema: 1,
    unlockedFighters: [...STARTER_FIGHTERS],
    fighterXp: {},
    cosmetics: [],
    arcade: {},
    settings: { scheme: 'simple', inputDisplay: false, difficulty: 1, cinematics: 'first', seenReveal: {}, hybridPose: false },
    lastLoadout: null,
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const ID_RE = /^[a-z0-9][a-z0-9_.-]{0,63}$/;
const sortedUnique = (a: string[]): string[] => [...new Set(a)].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
const diff = (v: unknown, d: Difficulty): Difficulty => (v === 0 || v === 1 || v === 2 || v === 3 ? v : d);

/** Reads a saved slice; null or a broken object gives the defaults, a broken field its default. */
export function sliceFromJson(raw: JsonObject | null): FighterSlice {
  const out = defaultSlice();
  if (!isObj(raw)) return out;
  const r = raw as Record<string, unknown>;
  if (Array.isArray(r['unlockedFighters'])) {
    out.unlockedFighters = sortedUnique([...STARTER_FIGHTERS, ...(r['unlockedFighters'] as unknown[]).filter((x): x is string => typeof x === 'string' && ID_RE.test(x))]);
  }
  if (isObj(r['fighterXp'])) {
    for (const k of Object.keys(r['fighterXp']).sort()) {
      const v = (r['fighterXp'] as Record<string, unknown>)[k];
      if (ID_RE.test(k) && typeof v === 'number' && Number.isFinite(v)) out.fighterXp[k] = Math.max(0, Math.min(MAX_XP, Math.trunc(v)));
    }
  }
  if (Array.isArray(r['cosmetics'])) out.cosmetics = sortedUnique((r['cosmetics'] as unknown[]).filter((x): x is string => typeof x === 'string' && ID_RE.test(x)));
  if (isObj(r['arcade'])) {
    for (const k of Object.keys(r['arcade']).sort()) {
      const a = (r['arcade'] as Record<string, unknown>)[k];
      if (!ID_RE.test(k) || !isObj(a) || typeof a['cleared'] !== 'boolean') continue;
      const row: FighterSlice['arcade'][string] = { cleared: a['cleared'] };
      if (typeof a['bestTimeSec'] === 'number' && Number.isFinite(a['bestTimeSec']) && a['bestTimeSec'] >= 0) row.bestTimeSec = Math.trunc(a['bestTimeSec']);
      if (a['bestDifficulty'] === 0 || a['bestDifficulty'] === 1 || a['bestDifficulty'] === 2 || a['bestDifficulty'] === 3) row.bestDifficulty = a['bestDifficulty'];
      out.arcade[k] = row;
    }
  }
  if (isObj(r['settings'])) {
    const s = r['settings'];
    if (s['scheme'] === 'classic' || s['scheme'] === 'simple') out.settings.scheme = s['scheme'];
    if (typeof s['inputDisplay'] === 'boolean') out.settings.inputDisplay = s['inputDisplay'];
    out.settings.difficulty = diff(s['difficulty'], out.settings.difficulty);
    if (s['cinematics'] === 'off' || s['cinematics'] === 'first' || s['cinematics'] === 'always') out.settings.cinematics = s['cinematics'];
    if (typeof s['hybridPose'] === 'boolean') out.settings.hybridPose = s['hybridPose'];
    if (isObj(s['seenReveal'])) {
      for (const k of Object.keys(s['seenReveal']).sort()) if (ID_RE.test(k) && typeof (s['seenReveal'] as Record<string, unknown>)[k] === 'boolean') out.settings.seenReveal[k] = (s['seenReveal'] as Record<string, boolean>)[k] as boolean;
    }
  }
  const ll = r['lastLoadout'];
  if (isObj(ll) && typeof ll['slot'] === 'string' && typeof ll['costume'] === 'number' && Number.isInteger(ll['costume']) && ll['costume'] >= 0 && ll['costume'] < 16) {
    out.lastLoadout = { slot: ll['slot'], costume: ll['costume'] };
  }
  return out;
}

/** The slice as the JSON the save service stores (keys in a fixed order; arrays sorted). */
export function sliceToJson(s: FighterSlice): JsonObject {
  const arcade: Record<string, JsonValue> = {};
  for (const k of Object.keys(s.arcade).sort()) {
    const a = s.arcade[k] as FighterSlice['arcade'][string];
    arcade[k] = { cleared: a.cleared, ...(a.bestTimeSec !== undefined ? { bestTimeSec: a.bestTimeSec } : {}), ...(a.bestDifficulty !== undefined ? { bestDifficulty: a.bestDifficulty } : {}) };
  }
  const xp: Record<string, number> = {};
  for (const k of Object.keys(s.fighterXp).sort()) xp[k] = s.fighterXp[k] as number;
  const seen: Record<string, boolean> = {};
  for (const k of Object.keys(s.settings.seenReveal).sort()) seen[k] = s.settings.seenReveal[k] as boolean;
  return {
    schema: 1,
    unlockedFighters: sortedUnique(s.unlockedFighters),
    fighterXp: xp,
    cosmetics: sortedUnique(s.cosmetics),
    arcade,
    settings: {
      scheme: s.settings.scheme, inputDisplay: s.settings.inputDisplay, difficulty: s.settings.difficulty, cinematics: s.settings.cinematics,
      seenReveal: seen, hybridPose: s.settings.hybridPose,
    },
    lastLoadout: s.lastLoadout ? { slot: s.lastLoadout.slot, costume: s.lastLoadout.costume } : null,
  };
}

/** C06 `migrateSlice`: schema 1 is the first; anything else is read as far as it fits. */
export function migrateSlice(old: JsonObject, _from: number): JsonObject {
  return sliceToJson(sliceFromJson(old));
}

interface UnlockRow { id: string; grants: { fighters?: string[] } }

/** The fighters the unlock ids grant, through the rows of `config/unlocks.json` (`UnlockDef.grants.fighters`). */
export function fightersFromUnlocks(unlockIds: readonly string[]): FighterId[] {
  const rows = (unlocksJson as { unlocks: UnlockRow[] }).unlocks;
  const out: string[] = [...STARTER_FIGHTERS];
  for (const id of unlockIds) {
    const row = rows.find((r) => r.id === id);
    if (row?.grants.fighters) out.push(...row.grants.fighters);
  }
  return sortedUnique(out);
}

/** The slice with the grants of `unlockIds` merged in (the slice mirrors `UnlockDef.grants.fighters`, FX8.2). */
export function withUnlocks(s: FighterSlice, unlockIds: readonly string[]): FighterSlice {
  return { ...s, unlockedFighters: sortedUnique([...s.unlockedFighters, ...fightersFromUnlocks(unlockIds)]) };
}

/** Cosmetic XP per won bout (never changes a stat; FX8.2). */
export function addXp(s: FighterSlice, fighter: FighterId, xp: number): void {
  s.fighterXp[fighter] = Math.min(MAX_XP, (s.fighterXp[fighter] ?? 0) + Math.max(0, Math.trunc(xp)));
}
