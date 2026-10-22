/**
 * Content loader and validator (pure; the caller reads the JSON). `contentVersion` and `balanceVersion` are the first 12 hex
 * characters of the SHA-256 of the canonical JSON of the content files and of the balance file (08-tycoon.md section 4.7).
 */
import { canonicalize } from '../json.ts';
import { sha256Hex } from '../hash.ts';
import { loadCatalog } from './events/catalog.ts';
import type { ArchetypeDefs, Balance, SectorDef, ThesisDef, TycoonContent } from './types.ts';

export interface RawTycoonContent {
  sectors: unknown;
  theses: unknown;
  archetypes: unknown;
  balance: unknown;
  /** The event files (`{schema, events: EventDef[]}` each), any order. */
  events: unknown;
  /** When given, the event catalog is checked against it (every LocKey must exist). The runtime build passes none. */
  locale?: Record<string, string>;
}

export class ContentError extends Error {
  constructor(message: string) {
    super(`tycoon content: ${message}`);
    this.name = 'ContentError';
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const fail = (msg: string): never => {
  throw new ContentError(msg);
};
function num(o: Record<string, unknown>, k: string, where: string, min = -Infinity): number {
  const v = o[k];
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min) fail(`${where}.${k} must be a number >= ${min}`);
  return v as number;
}
function str(o: Record<string, unknown>, k: string, where: string): string {
  const v = o[k];
  if (typeof v !== 'string' || v === '') fail(`${where}.${k} must be a non-empty string`);
  return v as string;
}

export const hashVersion = (v: unknown): string => sha256Hex(canonicalize(v)).slice(0, 12);

function validateSector(s: unknown, i: number): SectorDef {
  const where = `sectors[${i}]`;
  if (!isObj(s)) return fail(`${where} must be an object`);
  for (const k of ['tam', 'cac0Cents', 'arpuMonthCents', 'infraPerUserWeekCents', 'mvpPoints', 'featureHalf', 'multiple']) num(s, k, where, 1);
  for (const k of ['payRate', 'churn0', 'k', 'hypeSensitivity']) num(s, k, where, 0);
  str(s, 'id', where);
  str(s, 'nameKey', where);
  if (!Array.isArray(s['tags'])) fail(`${where}.tags must be an array`);
  return s as unknown as SectorDef;
}

function validateTheses(t: unknown): ThesisDef[] {
  if (!isObj(t) || !Array.isArray(t['theses'])) return fail('theses.json needs a "theses" array');
  return (t['theses'] as unknown[]).map((x, i) => {
    if (!isObj(x)) return fail(`theses[${i}] must be an object`);
    str(x, 'id', `theses[${i}]`);
    if (!isObj(x['mods'])) fail(`theses[${i}].mods must be an object`);
    return x as unknown as ThesisDef;
  });
}

function validateArchetypes(a: unknown): ArchetypeDefs {
  if (!isObj(a)) return fail('archetypes.json must be an object');
  for (const f of ['engineer', 'designer', 'hustler']) {
    const row = (a['founders'] as Record<string, unknown> | undefined)?.[f];
    if (!isObj(row)) fail(`archetypes.founders.${f} missing`);
    else for (const k of ['devPower', 'hustle', 'qualityBonus', 'cacMul', 'fundraisingMood']) num(row, k, `founders.${f}`);
  }
  if (!isObj(a['roleBaseYrCents'])) fail('archetypes.roleBaseYrCents missing');
  if (!Array.isArray(a['vcs']) || (a['vcs'] as unknown[]).length === 0) fail('archetypes.vcs must be a non-empty array');
  for (const [i, v] of (a['vcs'] as unknown[]).entries()) {
    if (!isObj(v)) return fail(`vcs[${i}] must be an object`);
    str(v, 'id', `vcs[${i}]`);
    num(v, 'checkMin', `vcs[${i}]`, 0);
    num(v, 'checkMax', `vcs[${i}]`, 0);
    if (!Array.isArray(v['stages'])) fail(`vcs[${i}].stages must be an array`);
  }
  return a as unknown as ArchetypeDefs;
}

function validateBalance(b: unknown): Balance {
  if (!isObj(b) || b['schema'] !== 'tycoon.balance.v1') return fail('balance.schema must be tycoon.balance.v1');
  for (const k of ['sim', 'setup', 'company', 'valuation', 'hiring', 'founder', 'board', 'end', 'raise', 'finance', 'hardcore']) if (!isObj(b[k])) fail(`balance.${k} missing`);
  return b as unknown as Balance;
}

/** Validates the raw files and computes both version strings. Throws `ContentError` with the path of the first problem. */
export function buildContent(raw: RawTycoonContent): TycoonContent {
  if (!isObj(raw.sectors) || !Array.isArray(raw.sectors['sectors'])) return fail('sectors.json needs a "sectors" array');
  const sectors: Record<string, SectorDef> = {};
  for (const [i, s] of (raw.sectors['sectors'] as unknown[]).entries()) {
    const d = validateSector(s, i);
    sectors[d.id] = d;
  }
  if (!sectors['b2b-saas']) fail('sector b2b-saas is required');
  const theses = validateTheses(raw.theses);
  if (theses.length === 0) fail('at least one thesis is required');
  const archetypes = validateArchetypes(raw.archetypes);
  const balance = validateBalance(raw.balance);
  const events = loadCatalog(raw.events, raw.locale);
  return {
    sectors,
    theses,
    events,
    archetypes,
    balance,
    contentVersion: hashVersion({ sectors: raw.sectors, theses: raw.theses, archetypes: raw.archetypes, events }),
    balanceVersion: hashVersion(raw.balance),
  };
}
