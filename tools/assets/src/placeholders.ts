/**
 * The placeholder registry (M10d1, DL-390, DL-741): `config/art-placeholders.json` lists every gray-box stand-in of the look program
 * with the milestone that replaces it. This module loads and checks it and applies the `repoint` maps of the M10d1 rows to the prefab
 * files (`assets:vehicle -- --repoint`). Pure apart from the file reads; no `three`.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { finding, type GateFinding } from '../../../packages/shared/src/assets/gates/types.ts';

export const GATE = 'art-placeholders';
export const REGISTRY_FILE = 'config/art-placeholders.json';
export const SCHEMA_FILE = 'config/schemas/art-placeholders.schema.json';

export type PlaceholderOwner = 'M10d1' | 'M10d4' | 'M10d5' | 'M10d2' | 'M10d3';

export interface PlaceholderRow {
  id: string;
  what: string;
  owner: PlaceholderOwner;
  match: string;
  replacedBy: string[];
  repoint?: Record<string, string>;
}

export interface PlaceholderRegistry {
  schema: 'art-placeholders/1';
  note?: string;
  rows: PlaceholderRow[];
}

/** The twelve ids the seed holds, in order, with their owners (DL-390 plus the on-foot capsule of DL-741). */
export const SEED_ROWS: readonly (readonly [string, PlaceholderOwner])[] = [
  ['vehicles', 'M10d1'],
  ['props', 'M10d1'],
  ['traffic-box-cars', 'M10d1'],
  ['ped-mannequins', 'M10d4'],
  ['creator-parts', 'M10d4'],
  ['far-bay-cards', 'M10d2'],
  ['facade-atlas', 'M10d2'],
  ['desktop-ultra-sky', 'M10d2'],
  ['player-cars', 'M10d3'],
  ['stage-dioramas', 'M10d3'],
  ['fighter-capsules', 'M10d3'],
  ['capsule', 'M10d5'],
];

export function readRegistry(root: string): PlaceholderRegistry {
  return JSON.parse(readFileSync(path.join(root, REGISTRY_FILE), 'utf8')) as PlaceholderRegistry;
}

/** The AssetRef pattern of a row, or null for a `code:` row. */
export function matcherOf(row: PlaceholderRow): RegExp | null {
  return row.match.startsWith('code:') ? null : new RegExp(row.match);
}

/** The row whose `match` covers an AssetRef (the first one), or undefined. */
export function rowOf(reg: PlaceholderRegistry, ref: string): PlaceholderRow | undefined {
  return reg.rows.find((r) => matcherOf(r)?.test(ref) === true);
}

/** Every refs the M10d1 rows put in place of a placeholder (their `replacedBy`, unique, in order). */
export function m10d1Targets(reg: PlaceholderRegistry): string[] {
  const out: string[] = [];
  for (const r of reg.rows) {
    if (r.owner !== 'M10d1') continue;
    for (const t of r.replacedBy) if (!out.includes(t)) out.push(t);
  }
  return out;
}

/**
 * Findings for a registry. `catalog` is the set of AssetRefs that exist (the specs under assets/src); without it only the shape and
 * the M10d1 rows' own consistency are checked. A row owned by M10d1 needs a non-empty `replacedBy` and a `repoint` whose targets are
 * in `replacedBy` (and in `catalog`, when given); a `repoint` source must be matched by the row's own `match`.
 */
export function registryFindings(reg: PlaceholderRegistry, root: string, catalog?: ReadonlySet<string>): GateFinding[] {
  const out: GateFinding[] = [];
  const bad = (rule: string, detail: string): void => {
    out.push(finding(GATE, REGISTRY_FILE, rule, detail));
  };
  const schemaPath = path.join(root, SCHEMA_FILE);
  if (existsSync(schemaPath)) {
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(readFileSync(schemaPath, 'utf8')) as object);
    if (!validate(reg)) {
      for (const e of validate.errors ?? []) bad('schema', `${e.instancePath || '/'} ${e.message ?? 'invalid'}`);
      return out;
    }
  }
  const seen = new Set<string>();
  for (const row of reg.rows) {
    if (seen.has(row.id)) bad('duplicate-id', `${row.id}: listed twice`);
    seen.add(row.id);
    const m = matcherOf(row);
    if (!row.match.startsWith('code:')) {
      try {
        new RegExp(row.match);
      } catch (e) {
        bad('bad-match', `${row.id}: ${(e as Error).message}`);
      }
    }
    if (row.owner === 'M10d4') {
      // the ped and creator rows of M10d4: a non-empty replacedBy that resolves, and no Coast row (those are M10a2's, DL-741)
      if (row.replacedBy.length === 0) bad('replaced-by-empty', `${row.id}: replacedBy is empty`);
      for (const ref of row.replacedBy) {
        if (catalog && !catalog.has(ref)) bad('replaced-by-unresolved', `${row.id}: ${ref} is not in the catalog`);
        if (/-coast(\.|$)/.test(ref)) bad('replaced-by-coast', `${row.id}: ${ref} is a Coast row, which is M10a2's`);
      }
      if (row.repoint && Object.keys(row.repoint).length > 0) bad('repoint-owner', `${row.id}: only rows owned by M10d1 carry a repoint here`);
      continue;
    }
    if (row.owner !== 'M10d1') {
      if (row.repoint && Object.keys(row.repoint).length > 0) bad('repoint-owner', `${row.id}: only rows owned by M10d1 carry a repoint here`);
      continue;
    }
    if (row.replacedBy.length === 0) bad('replaced-by-empty', `${row.id}: replacedBy is empty`);
    for (const ref of row.replacedBy) {
      if (catalog && !catalog.has(ref)) bad('replaced-by-unresolved', `${row.id}: ${ref} is not in the catalog`);
    }
    for (const [from, to] of Object.entries(row.repoint ?? {})) {
      if (m && !m.test(from)) bad('repoint-source', `${row.id}: ${from} is not matched by the row`);
      if (!row.replacedBy.includes(to)) bad('repoint-target', `${row.id}: ${from} points at ${to}, which replacedBy does not list`);
      if (catalog && !catalog.has(to)) bad('repoint-unresolved', `${row.id}: ${from} points at ${to}, which is not in the catalog`);
    }
    if (m && !row.repoint) bad('repoint-missing', `${row.id}: an M10d1 row with a match needs a repoint`);
  }
  return out;
}

/** The seed's shape: twelve rows, the ids and owners of `SEED_ROWS`, in order. */
export function seedFindings(reg: PlaceholderRegistry): GateFinding[] {
  const out: GateFinding[] = [];
  if (reg.rows.length !== SEED_ROWS.length) out.push(finding(GATE, REGISTRY_FILE, 'seed-count', `${reg.rows.length} rows, ${SEED_ROWS.length} expected`));
  SEED_ROWS.forEach(([id, owner], i) => {
    const row = reg.rows[i];
    if (!row || row.id !== id) out.push(finding(GATE, REGISTRY_FILE, 'seed-order', `row ${i} is ${row?.id ?? 'missing'}, ${id} expected`));
    else if (row.owner !== owner) out.push(finding(GATE, REGISTRY_FILE, 'seed-owner', `${id}: owner ${row.owner}, ${owner} expected`));
  });
  return out;
}

/** The repoint maps of all M10d1 rows, merged. */
export function repointMap(reg: PlaceholderRegistry): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of reg.rows) if (r.owner === 'M10d1') for (const [k, v] of Object.entries(r.repoint ?? {})) out.set(k, v);
  return out;
}

export interface PrefabChange { file: string; from: string; to: string }

/** The `render.asset` rewrites `--repoint` would make under `assets/prefabs/` (sorted by file). */
export function prefabRepoints(root: string, reg: PlaceholderRegistry): PrefabChange[] {
  const map = repointMap(reg);
  const dir = path.join(root, 'assets/prefabs');
  const out: PrefabChange[] = [];
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    const j = JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as { render?: { asset?: string } };
    const from = j.render?.asset;
    const to = from === undefined ? undefined : map.get(from);
    if (from !== undefined && to !== undefined) out.push({ file: `assets/prefabs/${name}`, from, to });
  }
  return out;
}

/** Rewrites the prefab files in place with the same text layout (a replace of the quoted asset string only). */
export function applyRepoint(root: string, changes: readonly PrefabChange[]): void {
  for (const c of changes) {
    const abs = path.join(root, c.file);
    const text = readFileSync(abs, 'utf8');
    const needle = `"asset": "${c.from}"`;
    if (!text.includes(needle)) throw new Error(`${c.file}: ${needle} not found`);
    writeFileSync(abs, text.replace(needle, `"asset": "${c.to}"`));
  }
}

/** Prefabs whose `render.asset` is still a `<kind>/graybox.*` ref, with the row that owns it (undefined when no row does). */
export function remainingGrayboxPrefabs(root: string, reg: PlaceholderRegistry): { file: string; asset: string; row: PlaceholderRow | undefined }[] {
  const dir = path.join(root, 'assets/prefabs');
  const out: { file: string; asset: string; row: PlaceholderRow | undefined }[] = [];
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    const j = JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as { render?: { asset?: string } };
    const asset = j.render?.asset;
    if (asset !== undefined && /^[a-z_]+\/graybox\./.test(asset)) out.push({ file: `assets/prefabs/${name}`, asset, row: rowOf(reg, asset) });
  }
  return out;
}
