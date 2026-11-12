/**
 * Surface textures, configuration (M10d0, DL-OWN-07): `config/world/surface-textures.json` as typed data, and the rules the schema
 * cannot say. Pure data and functions; no `three` import, so the unit tests and the asset worker can read it.
 *
 * A *set* (`asphalt`, `concrete`, `pavers`, `grass-dirt`, `brick`, `stucco`) is three KTX2 assets `texture/pbr.<set>.<map>` with the maps
 * `albedo`, `normal` and `orm`. `bindings` says which surface names (the `SURFACE_NAMES` of look/surfaces.ts) show which set; every other
 * surface name is listed in `procedural[]`, so a surface that a later row adds cannot be left out by accident.
 */
import type { QualityTierId, ShadowMode } from '@dv/shared';
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

/**
 * M02h7: the wall sets: sets every binding of which names a wall surface (`wall.*`). The walls read only their albedo, through the façade's
 * `albedo` seam in the building material (`withWallTextures`), never in the ground material, so they take no slot of the ground's plan.
 */
export function wallSets(cfg: SurfaceTexturesFile = SURFACE_TEXTURES): string[] {
  const names = new Map<string, string[]>();
  for (const [name, set] of Object.entries(cfg.bindings)) names.set(set, [...(names.get(set) ?? []), name]);
  return Object.keys(cfg.sets).filter((s) => (names.get(s) ?? []).length > 0 && (names.get(s) ?? []).every((n) => n.startsWith('wall.')));
}

/** The ground sets: those some surface other than a wall is bound to, in the order of `sets` (the wall sets are `wallSets`). */
export function boundSets(cfg: SurfaceTexturesFile = SURFACE_TEXTURES): string[] {
  const used = new Set(Object.values(cfg.bindings));
  const walls = new Set(wallSets(cfg));
  return Object.keys(cfg.sets).filter((s) => used.has(s) && !walls.has(s));
}

/** M02h7: the wall sets' albedo refs a mode requests: on `stochastic` and `single` (the `full` and `lite` looks), none on `albedo` (`min`) or off. */
export function wallRefsFor(mode: TextureMode, cfg: SurfaceTexturesFile = SURFACE_TEXTURES): string[] {
  return mode === 'stochastic' || mode === 'single' ? wallSets(cfg).map((s) => refOf(s, 'albedo')) : [];
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

/** Whether the look's physical sky bakes an environment map: the `full` profile, never on WebKit (bug 303203). Read by look-view.ts. */
export const bakesEnvMap = (profile: LookProfile, browser: string): boolean => profile === 'full' && browser !== 'safari';

/**
 * Sampled textures a look ground material binds in one fragment besides the surface sets (three r186; BD-FIX-WEBGPU-TREES-01): the DFG
 * lookup table of the physical lighting model, the environment map where the physical sky bakes one (`bakesEnvMap`), and one depth
 * texture per shadow cascade (`csm3` three, `csm1` one, `blob` and no shadows none).
 */
export function groundReservedTextures(o: { envMap: boolean; shadows: ShadowMode | 'none' }): number {
  return 1 + (o.envMap ? 1 : 0) + (o.shadows === 'csm3' ? 3 : o.shadows === 'csm1' ? 1 : 0);
}

export interface MapPlan {
  /** The maps each bound set reads, in the order of `MAP_NAMES`; a set with none is left to the procedural look. */
  maps: Record<string, MapName[]>;
  /** The refs requested: the kept maps, set by set in the order of `sets` (equal to `refsFor(mode)` when nothing is capped). */
  refs: string[];
  /** The refs left out because a fragment cannot bind them all, sorted. */
  capped: string[];
}

/**
 * The maps of `mode` that fit in `slots` sampled textures per fragment (BD-FIX-WEBGPU-TREES-01): every bound set's albedo first, then
 * the normal maps, then the orm maps, each in the order of `sets`; what does not fit is left out, and its set draws that term of the
 * procedural look (a set without its albedo draws none of its maps). `slots` at or above the full count keeps every map.
 */
export function mapsWithin(mode: TextureMode, slots: number, cfg: SurfaceTexturesFile = SURFACE_TEXTURES): MapPlan {
  const sets = boundSets(cfg);
  const wanted = mapsOf(mode);
  const keep = new Set<string>();
  let left = Math.max(0, Math.floor(slots));
  for (const m of MAP_NAMES) {
    if (!wanted.includes(m)) continue;
    for (const s of sets) {
      if (left === 0) break;
      if (m !== 'albedo' && !keep.has(refOf(s, 'albedo'))) continue;
      keep.add(refOf(s, m));
      left--;
    }
  }
  const maps: Record<string, MapName[]> = {};
  const refs: string[] = [];
  const capped: string[] = [];
  for (const s of sets) {
    maps[s] = [];
    for (const m of wanted) {
      const ref = refOf(s, m);
      if (keep.has(ref)) {
        (maps[s] as MapName[]).push(m);
        refs.push(ref);
      } else capped.push(ref);
    }
  }
  return { maps, refs, capped: capped.sort() };
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
