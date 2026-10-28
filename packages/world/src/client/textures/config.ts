/**
 * Surface textures, configuration (M10d0, DL-OWN-07): `config/world/surface-textures.json` as typed data, and the rules the schema
 * cannot say. Pure data and functions; no `three` import, so the unit tests and the asset worker can read it.
 *
 * A *set* (`asphalt`, `concrete`, `pavers`, `grass-dirt`, `brick`, `stucco`) is three KTX2 assets `texture/pbr.<set>.<map>` with the maps
 * `albedo`, `normal` and `orm`. `bindings` says which surface names (the `SURFACE_NAMES` of look/surfaces.ts) show which set; every other
 * surface name is listed in `procedural[]`, so a surface that a later row adds cannot be left out by accident.
 */
import type { QualityTierId } from '@dv/shared';
import flagsJson from '../../../../../config/platform-flags.json';
import surfaceTexturesJson from '../../../../../config/world/surface-textures.json';
import { SURFACE_NAMES } from '../look/surfaces.ts';
import type { LookProfile } from '../look/config.ts';

export const MAP_NAMES = ['albedo', 'normal', 'orm'] as const;
export type MapName = (typeof MAP_NAMES)[number];

/** What the `look().textures.mode` reports: hex-tiled `stochastic`, the 2-tap `single`, the 1-tap `albedo` only, or `off`. */
export type TextureMode = 'stochastic' | 'single' | 'albedo' | 'off';

export interface SetConfig {
  /** Metres per tile along u and v. */
  tileM: number;
  /** Mean linear albedo of the set. */
  mean: readonly [number, number, number];
  /** 0..1: how much of the set's own brightness is kept; 0 keeps the brightness of the surface the look already draws. */
  keep: number;
  /** True when the set is also projected on slopes (triplanar). */
  slopeFull: boolean;
}

export interface TierBudget {
  downloadMB: number;
  gpuMB: number;
}

export interface SurfaceTexturesFile {
  schema: 'world-surface-textures/1';
  sets: Record<string, SetConfig>;
  bindings: Record<string, string>;
  procedural: readonly string[];
  modes: Record<LookProfile | 'xr', TextureMode>;
  budgets: Record<QualityTierId, TierBudget>;
  fade: { startM: number; endM: number };
  slopeDeg: number;
  /** Render backends where KTX2 does not work (`webgpu`, `webgl2`, or a browser and backend pair); each has a `spec/03` section 7 row. */
  unsupported: readonly string[];
}

export const SURFACE_TEXTURES: SurfaceTexturesFile = surfaceTexturesJson as unknown as SurfaceTexturesFile;

/** `config/platform-flags.json` `world.textures` (default true): false draws the procedural ground on every tier. */
export const TEXTURES_FLAG: boolean = (flagsJson as Record<string, unknown>)['world.textures'] !== false;

const XR_TIERS: readonly QualityTierId[] = ['xr-quest', 'xr-visionpro'];
export const isXrTier = (tier: QualityTierId): boolean => XR_TIERS.includes(tier);

/** Variant (and so size) of the set files per tier; `desktop-ultra` falls back to `desktop`, the XR tiers load nothing. */
export const TIER_VARIANT: Record<QualityTierId, 'desktop' | 'mobile' | 'mobile-low'> = {
  'desktop-ultra': 'desktop',
  desktop: 'desktop',
  mobile: 'mobile',
  'mobile-low': 'mobile-low',
  'xr-quest': 'mobile-low',
  'xr-visionpro': 'mobile-low',
};

/** The mode of a tier: the XR tiers read `modes.xr`, the others the mode of their look profile. */
export function textureModeFor(tier: QualityTierId, profile: LookProfile, enabled: boolean, cfg: SurfaceTexturesFile = SURFACE_TEXTURES): TextureMode {
  if (!enabled) return 'off';
  return isXrTier(tier) ? cfg.modes.xr : cfg.modes[profile];
}

/** The maps a mode reads: albedo alone on `albedo`, all three otherwise, none when off. */
export function mapsOf(mode: TextureMode): readonly MapName[] {
  return mode === 'off' ? [] : mode === 'albedo' ? ['albedo'] : MAP_NAMES;
}

/** The asset ref of one map of a set. */
export const refOf = (set: string, map: MapName): string => `texture/pbr.${set}.${map}`;

/** The sets some surface is bound to, in the order of `sets`. */
export function boundSets(cfg: SurfaceTexturesFile = SURFACE_TEXTURES): string[] {
  const used = new Set(Object.values(cfg.bindings));
  return Object.keys(cfg.sets).filter((s) => used.has(s));
}

/** The surface ids bound to `set`. A name that is not a surface name is ignored here (`textureConfigErrors` reports it). */
export function idsOfSet(set: string, cfg: SurfaceTexturesFile = SURFACE_TEXTURES, names: readonly string[] = SURFACE_NAMES): number[] {
  const out: number[] = [];
  for (const [name, s] of Object.entries(cfg.bindings)) {
    const id = names.indexOf(name);
    if (s === set && id >= 0) out.push(id);
  }
  return out.sort((a, b) => a - b);
}

/** The refs a tier requests: the bound sets' maps of its mode, minus sets that a backend lists in `unsupported`. */
export function refsFor(mode: TextureMode, cfg: SurfaceTexturesFile = SURFACE_TEXTURES): string[] {
  const out: string[] = [];
  for (const set of boundSets(cfg)) for (const m of mapsOf(mode)) out.push(refOf(set, m));
  return out;
}

/** Whether a backend (`webgpu` or `webgl2`) or a `<browser>-<backend>` pair is in `unsupported`. */
export function backendUnsupported(backend: string, browser: string, cfg: SurfaceTexturesFile = SURFACE_TEXTURES): boolean {
  return cfg.unsupported.includes(backend) || cfg.unsupported.includes(`${browser}-${backend}`);
}

/**
 * The rules the schema cannot say: every binding key is a surface name and every bound set exists; every surface name is in
 * `bindings` or `procedural[]` (the coverage rule: a Track A row that adds a surface binds or lists it) and in no more than one
 * of them; a budget is at most 5 % of the tier's `maxTextureMB`.
 */
export function textureConfigErrors(
  cfg: SurfaceTexturesFile,
  surfaceNames: readonly string[],
  maxTextureMB: Partial<Record<QualityTierId, number>>,
): string[] {
  const errors: string[] = [];
  if (cfg.schema !== 'world-surface-textures/1') errors.push(`schema must be world-surface-textures/1, got ${String(cfg.schema)}`);
  const known = new Set(surfaceNames);
  for (const [name, set] of Object.entries(cfg.bindings)) {
    if (!known.has(name)) errors.push(`bindings: ${name} is not a surface name`);
    if (!(set in cfg.sets)) errors.push(`bindings: ${name} names the unknown set ${set}`);
  }
  for (const name of cfg.procedural) if (!known.has(name)) errors.push(`procedural: ${name} is not a surface name`);
  for (const name of surfaceNames) {
    const bound = name in cfg.bindings;
    const listed = cfg.procedural.includes(name);
    if (!bound && !listed) errors.push(`surface ${name} is in neither bindings nor procedural`);
    if (bound && listed) errors.push(`surface ${name} is both bound and listed as procedural`);
  }
  if (cfg.fade.endM <= cfg.fade.startM) errors.push('fade.endM must exceed fade.startM');
  for (const [tier, b] of Object.entries(cfg.budgets) as [QualityTierId, TierBudget][]) {
    const max = maxTextureMB[tier];
    if (max === undefined) errors.push(`budgets names unknown tier ${tier}`);
    else if (b.gpuMB > 0.05 * max + 1e-9) errors.push(`budgets.${tier}.gpuMB ${b.gpuMB} exceeds 5 % of maxTextureMB ${max}`);
  }
  for (const tier of XR_TIERS) {
    const b = cfg.budgets[tier];
    if (b.downloadMB !== 0 || b.gpuMB !== 0) errors.push(`budgets.${tier} must be 0: the XR tiers load no textures`);
  }
  return errors;
}
