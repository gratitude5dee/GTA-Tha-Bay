/**
 * The facade atlas (M10d2): `texture/facade-atlas`, a 4 x 4 grid of wall materials for the desktop building shader, authored here as
 * code (02-world-bake.md section 6; `05-assets-pipeline.md` section 7 "Facade, ground, PBR sets": verified CC0 sets or authored).
 * Every tile repeats seamlessly (periodic noise, patterns whose period divides the tile), is grey, and has the linear mean of
 * `config/world/facade-atlas.json` `mean`, so the shader multiplies the class palette colour by `sample / mean` and the walls keep the
 * brightness the look tuned. No text, signs, logos, murals or photographs: patterns of courses, joints and grain only.
 *
 *   tsx tools/assets/src/recipes/facade-atlas.ts --write   writes the two KTX2 variants, the asset spec and the provenance records
 *   tsx tools/assets/src/recipes/facade-atlas.ts --check   fails when a committed variant differs from a fresh build
 *
 * Deterministic: seeded streams, integer pixel loops, and the Basis encoder of M10d0 (BD-M10d0-01).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalize } from '../../../../packages/shared/src/json.ts';
import { fnv32 } from '../../../../packages/shared/src/index.ts';
import type { ProvenanceRecord } from '../../../../packages/shared/src/assets/provenance.ts';
import { isMain, toolsRoot } from '../../../ci/lib/common.ts';
import { args } from '../../../ci/run.ts';
import { basisEncoder, gpuBytesOf, halve, readKtx2, type Raster } from '../import/texture-set.ts';

export const FACADE_ATLAS_CONFIG = 'config/world/facade-atlas.json';
export const FACADE_ATLAS_DIR = 'assets/src/texture/facade-atlas';
export const FACADE_ATLAS_TOOL = 'tools/assets facade-atlas';
export const FACADE_ATLAS_VERSION = '1.0.0';
export const FACADE_ATLAS_CREATED_AT = '2026-11-03T00:00:00Z';

export interface FacadeAtlasConfig {
  schema: 'facade-atlas/1';
  asset: string;
  grid: number;
  sizePx: { desktop: number; mobile: number };
  mean: number;
  strength: number;
  fade: { startM: number; endM: number };
  tiles: { name: string; tileM: number }[];
  classes: number[][];
}

export function readAtlasConfig(root: string = toolsRoot): FacadeAtlasConfig {
  return JSON.parse(readFileSync(path.join(root, FACADE_ATLAS_CONFIG), 'utf8')) as FacadeAtlasConfig;
}

// ---- periodic noise ---------------------------------------------------------------------------------------------------------

const hash = (seed: number, i: number, j: number): number => (fnv32(`${seed}:${i}:${j}`) % 65521) / 65520;

/** Value noise in [0, 1] over the unit tile, periodic with `period` lattice cells per tile side. */
function pnoise(seed: number, u: number, v: number, period: number): number {
  const x = u * period, y = v * period;
  const i = Math.floor(x), j = Math.floor(y);
  const fx = x - i, fy = y - j;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const w = (a: number): number => ((a % period) + period) % period;
  const a = hash(seed, w(i), w(j)), b = hash(seed, w(i + 1), w(j)), c = hash(seed, w(i), w(j + 1)), d = hash(seed, w(i + 1), w(j + 1));
  return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
}

/** Three octaves of periodic noise around 0.5. */
function fbm(seed: number, u: number, v: number, base: number): number {
  return 0.5 * pnoise(seed, u, v, base) + 0.3 * pnoise(seed + 1, u, v, base * 2) + 0.2 * pnoise(seed + 2, u, v, base * 4);
}

/** A per-cell tone in [0, 1] from a cell index (wrapped so the tile repeats). */
const cellTone = (seed: number, i: number, j: number, ni: number, nj: number): number => hash(seed, ((i % ni) + ni) % ni, ((j % nj) + nj) % nj);

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** A course pattern: units of `uw` x `uh` (fractions of the tile) with joints `j`, every other row shifted by `shift`. */
function courses(u: number, v: number, nu: number, nv: number, joint: number, shift: number, seed: number): { tone: number; joint: number } {
  const row = Math.floor(v * nv);
  const uu = u * nu + (row % 2 === 1 ? shift : 0);
  const col = Math.floor(uu);
  const fu = uu - col, fv = v * nv - row;
  const ju = joint * nu, jv = joint * nv;
  const inJoint = Math.max(1 - smooth(0, ju, Math.min(fu, 1 - fu)), 1 - smooth(0, jv, Math.min(fv, 1 - fv)));
  return { tone: cellTone(seed, col, row, nu, nv), joint: inJoint };
}

/** The brightness (linear, before normalisation) of tile `t` at (u, v) in [0, 1). `m` is the tile's metres. */
export function tileValue(t: number, u: number, v: number, m: number): number {
  const s = 101 + t * 17;
  switch (t) {
    case 0: { // lap siding: 0.2 m boards, light at the top edge, a shadow line under the lap
      const n = Math.round(m / 0.2), fv = (v * n) % 1;
      return 0.55 + 0.25 * fv - 0.35 * (1 - smooth(0, 0.08, fv)) + 0.08 * (fbm(s, u, v, 8) - 0.5) + 0.06 * (cellTone(s, 0, Math.floor(v * n), 1, n) - 0.5);
    }
    case 1: { // shingle: staggered rows of 0.18 m, shingles of varying width
      const c = courses(u, v, Math.round(m / 0.22), Math.round(m / 0.18), 0.004, 0.5, s);
      return 0.5 + 0.25 * (c.tone - 0.5) - 0.35 * c.joint + 0.1 * (fbm(s, u, v, 16) - 0.5);
    }
    case 2: // smooth stucco
      return 0.5 + 0.12 * (fbm(s, u, v, 4) - 0.5) + 0.06 * (pnoise(s + 9, u, v, 64) - 0.5);
    case 3: // rough stucco
      return 0.5 + 0.18 * (fbm(s, u, v, 6) - 0.5) + 0.2 * (pnoise(s + 9, u, v, 96) - 0.5);
    case 4: { // brick, running bond, 0.2 x 0.065 m with 10 mm mortar
      const c = courses(u, v, Math.round(m / 0.21), Math.round(m / 0.075), 0.01 / m, 0.5, s);
      return (0.42 + 0.3 * c.tone) * (1 - c.joint) + 0.85 * c.joint + 0.06 * (pnoise(s + 3, u, v, 48) - 0.5);
    }
    case 5: { // brick, Flemish bond: header and stretcher alternating along the course
      const nv = Math.round(m / 0.075), row = Math.floor(v * nv), fv = v * nv - row;
      const unit = 0.315 / m, uu = u / unit + (row % 2 === 1 ? 0.25 : 0), k = Math.floor(uu), fu = uu - k;
      const split = fu < 0.66 ? fu / 0.66 : (fu - 0.66) / 0.34;
      const jv = 0.01 / 0.075, ju = 0.03;
      const joint = Math.max(1 - smooth(0, jv, Math.min(fv, 1 - fv)), 1 - smooth(0, ju, Math.min(split, 1 - split)));
      const tone = cellTone(s, k * 2 + (fu < 0.66 ? 0 : 1), row, Math.round(1 / unit) * 2, nv);
      return (0.38 + 0.34 * tone) * (1 - joint) + 0.82 * joint;
    }
    case 6: { // stone ashlar, 0.6 x 0.3 m blocks
      const c = courses(u, v, Math.round(m / 0.6), Math.round(m / 0.3), 0.012 / m, 0.5, s);
      return (0.5 + 0.16 * (c.tone - 0.5) + 0.12 * (fbm(s, u, v, 12) - 0.5)) * (1 - 0.55 * c.joint);
    }
    case 7: { // rusticated stone, 0.8 x 0.4 m blocks with wide chamfered joints
      const c = courses(u, v, Math.round(m / 0.8), Math.round(m / 0.4), 0.045 / m, 0.5, s);
      return (0.55 + 0.14 * (c.tone - 0.5) + 0.1 * (fbm(s, u, v, 10) - 0.5)) * (1 - 0.6 * c.joint);
    }
    case 8: { // board-formed concrete panels, 1.5 m, with joints and tie holes
      const n = Math.round(m / 1.5), fu = (u * n) % 1, fv = (v * n) % 1;
      const joint = Math.max(1 - smooth(0, 0.012, Math.min(fu, 1 - fu)), 1 - smooth(0, 0.012, Math.min(fv, 1 - fv)));
      const tie = Math.min(...[0.25, 0.75].flatMap((a) => [0.25, 0.75].map((b) => Math.hypot(fu - a, fv - b)))) < 0.018 ? 1 : 0;
      return (0.52 + 0.14 * (fbm(s, u, v, 6) - 0.5) + 0.05 * (cellTone(s, Math.floor(u * n), Math.floor(v * n), n, n) - 0.5)) * (1 - 0.5 * joint) * (1 - 0.4 * tie);
    }
    case 9: { // metal panels 1.0 x 1.33 m with seams and a slight sheen per panel
      const nu = Math.round(m / 1.0), nv = Math.round(m / 1.33), fu = (u * nu) % 1, fv = (v * nv) % 1;
      const seam = Math.max(1 - smooth(0, 0.01, Math.min(fu, 1 - fu)), 1 - smooth(0, 0.01, Math.min(fv, 1 - fv)));
      return (0.48 + 0.1 * (cellTone(s, Math.floor(u * nu), Math.floor(v * nv), nu, nv) - 0.5) + 0.08 * (1 - fv)) * (1 - 0.6 * seam);
    }
    case 10: { // corrugated metal: ribs every 76 mm
      const n = Math.round(m / 0.076);
      return 0.5 + 0.28 * Math.cos(2 * Math.PI * u * n) + 0.08 * (fbm(s, u, v, 6) - 0.5);
    }
    case 11: { // concrete block, 0.4 x 0.2 m running bond
      const c = courses(u, v, Math.round(m / 0.4), Math.round(m / 0.2), 0.01 / m, 0.5, s);
      return (0.5 + 0.1 * (c.tone - 0.5) + 0.1 * (pnoise(s + 5, u, v, 80) - 0.5)) * (1 - 0.45 * c.joint);
    }
    case 12: { // vertical boards 0.15 m with battens
      const n = Math.round(m / 0.15), fu = (u * n) % 1;
      const batten = 1 - smooth(0.0, 0.12, Math.min(fu, 1 - fu));
      return 0.5 + 0.18 * batten - 0.25 * (1 - smooth(0, 0.03, Math.min(fu, 1 - fu))) + 0.1 * (pnoise(s, u * 0.5, v, 32) - 0.5);
    }
    case 13: { // glazed terracotta panels 0.6 x 0.3 m
      const c = courses(u, v, Math.round(m / 0.6), Math.round(m / 0.3), 0.006 / m, 0, s);
      return (0.5 + 0.2 * (c.tone - 0.5)) * (1 - 0.5 * c.joint) + 0.04 * (pnoise(s + 7, u, v, 24) - 0.5);
    }
    case 14: { // precast with vertical fins every 1.5 m
      const n = Math.round(m / 1.5), fu = (u * n) % 1;
      const fin = smooth(0.0, 0.05, fu) * (1 - smooth(0.16, 0.22, fu));
      const shadow = smooth(0.22, 0.26, fu) * (1 - smooth(0.26, 0.4, fu));
      return 0.5 + 0.2 * fin - 0.18 * shadow + 0.08 * (fbm(s, u, v, 8) - 0.5);
    }
    default: { // plaster with rustication grooves every 0.4 m
      const n = Math.round(m / 0.4), fv = (v * n) % 1;
      const groove = 1 - smooth(0, 0.04, Math.min(fv, 1 - fv));
      return (0.52 + 0.12 * (fbm(s, u, v, 6) - 0.5)) * (1 - 0.45 * groove);
    }
  }
}

const toSrgb8 = (lin: number): number => {
  const c = Math.min(1, Math.max(0, lin));
  return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
};

/** The atlas at `size` px: each tile's values normalised to the config's linear mean. */
export function atlasRaster(cfg: FacadeAtlasConfig, size: number): Raster {
  const tilePx = size / cfg.grid;
  const data = new Uint8Array(size * size * 4);
  cfg.tiles.forEach((tile, t) => {
    const vals = new Float64Array(tilePx * tilePx);
    let sum = 0;
    for (let y = 0; y < tilePx; y++) {
      for (let x = 0; x < tilePx; x++) {
        const val = Math.max(0.02, tileValue(t, (x + 0.5) / tilePx, (y + 0.5) / tilePx, tile.tileM));
        vals[y * tilePx + x] = val;
        sum += val;
      }
    }
    const k = cfg.mean / (sum / vals.length);
    const ox = (t % cfg.grid) * tilePx, oy = Math.floor(t / cfg.grid) * tilePx;
    for (let y = 0; y < tilePx; y++) {
      for (let x = 0; x < tilePx; x++) {
        const g = toSrgb8((vals[y * tilePx + x] as number) * k);
        const o = ((oy + y) * size + ox + x) * 4;
        data[o] = g; data[o + 1] = g; data[o + 2] = g; data[o + 3] = 255;
      }
    }
  });
  return { width: size, height: size, data };
}

export interface AtlasFiles { desktop: Uint8Array; mobile: Uint8Array }

/** Both KTX2 variants: the desktop raster and its box-filtered half (Basis ETC1S, sRGB, mips). */
export async function buildAtlas(cfg: FacadeAtlasConfig): Promise<AtlasFiles> {
  const enc = await basisEncoder();
  const desk = atlasRaster(cfg, cfg.sizePx.desktop);
  let mob: Raster = desk;
  while (mob.width > cfg.sizePx.mobile) mob = halve(mob, false);
  return { desktop: await enc.encode(desk, 'albedo'), mobile: await enc.encode(mob, 'albedo') };
}

const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');

function record(file: string, sha: string, argsSha: string): ProvenanceRecord {
  return {
    schema: 'provenance/1.0',
    sha256: sha,
    paths: [file],
    kind: 'texture',
    origin: 'authored',
    license: 'LicenseRef-DeeVerse-Owned',
    authors: ['studio:dee-verse'],
    derived_from: [],
    tool: { name: FACADE_ATLAS_TOOL, version: FACADE_ATLAS_VERSION, args_sha256: argsSha },
    review: [],
    ip_checks: { signatures: 'pass', strings: 'n/a', similarity: 'n/a' },
    ai_generated: false,
    status: 'active',
    created_at: FACADE_ATLAS_CREATED_AT,
  } as ProvenanceRecord;
}

/** Writes the variants, the asset spec and one provenance record per variant; returns the files written. */
export function writeAtlas(root: string, files: AtlasFiles, cfg: FacadeAtlasConfig): string[] {
  const argsSha = sha256(canonicalize({ tool: FACADE_ATLAS_TOOL, version: FACADE_ATLAS_VERSION, config: cfg }));
  const dir = path.join(root, FACADE_ATLAS_DIR);
  mkdirSync(dir, { recursive: true });
  const out: string[] = [];
  const variants: Record<string, string> = {};
  const stats: Record<string, { texMaxPx: number; texGpuBytes: number }> = {};
  for (const v of ['desktop', 'mobile'] as const) {
    const rel = `${FACADE_ATLAS_DIR}/${v}.ktx2`;
    writeFileSync(path.join(root, rel), files[v]);
    variants[v] = rel;
    const info = readKtx2(files[v]);
    if (!info) throw new Error(`${rel}: not a KTX2`);
    stats[v] = { texMaxPx: Math.max(info.width, info.height), texGpuBytes: gpuBytesOf(info.width, info.height, info.levels) };
    const sha = sha256(files[v]);
    const recRel = `assets/provenance/${sha.slice(0, 2)}/${sha}.json`;
    mkdirSync(path.dirname(path.join(root, recRel)), { recursive: true });
    writeFileSync(path.join(root, recRel), `${JSON.stringify(record(rel, sha, argsSha), null, 2)}\n`);
    out.push(rel, recRel);
  }
  const spec = {
    kind: 'texture', id: 'facade-atlas', variants, deps: [], tags: ['art:m10d2'],
    codec: { tex: 'ktx2-etc1s' }, stats, status: 'active', visibility: 'public',
  };
  writeFileSync(path.join(dir, 'asset.json'), `${JSON.stringify(spec, null, 2)}\n`);
  out.push(`${FACADE_ATLAS_DIR}/asset.json`);
  return out;
}

async function main(): Promise<number> {
  const argv = args();
  const cfg = readAtlasConfig();
  const files = await buildAtlas(cfg);
  if (argv.includes('--check')) {
    let ok = true;
    for (const v of ['desktop', 'mobile'] as const) {
      const p = path.join(toolsRoot, FACADE_ATLAS_DIR, `${v}.ktx2`);
      const same = existsSync(p) && sha256(readFileSync(p)) === sha256(files[v]);
      console.log(`${same ? 'ok  ' : 'DIFF'} ${FACADE_ATLAS_DIR}/${v}.ktx2`);
      ok &&= same;
    }
    return ok ? 0 : 1;
  }
  if (!argv.includes('--write')) {
    console.log('usage: facade-atlas.ts --write | --check');
    return 2;
  }
  for (const f of writeAtlas(toolsRoot, files, cfg)) console.log(`wrote ${f}`);
  return 0;
}

if (isMain(import.meta.url)) process.exit(await main());
