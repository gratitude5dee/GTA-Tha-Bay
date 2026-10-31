/**
 * Look configuration (M02e, DL-704): `config/world/look.json` as typed data. S02 domain types, not a numbered contract. No `three`
 * import: the mesher (asset.worker) reads the profile and the facade classes from here.
 */
import type { PostNode, QualityTierId, ShadowMode, WeatherPreset } from '@dv/shared';
import lookJson from '../../../../../config/world/look.json';
import flagsJson from '../../../../../config/platform-flags.json';
import type { LayoutConfig } from './road-layout.ts';

/** `legacy` is the M02b1/M02b2 material set, unchanged. */
export type LookProfile = 'full' | 'lite' | 'min' | 'legacy';

export const FACADE_KEYS = ['ResLow', 'ResMid', 'Commercial', 'Tower', 'Industrial', 'Civic'] as const;
export type FacadeKey = (typeof FACADE_KEYS)[number];

export interface FacadeClass {
  floorM: number;
  groundFloorM: number;
  bayM: number;
  winW: number;
  winH: number;
  sillM: number;
  glassRatio: number;
  wallRoughness: number;
  /** sRGB hex. */
  palette: readonly string[];
}

export interface RoofClass {
  albedo: string;
  roughness: number;
  pattern: 'membrane' | 'shingle';
}

export interface GroundLook {
  albedo: string;
  roughness: number;
  noise: number;
}

/** The colour grade of one weather preset (see `look/grade.ts`): display-referred, identity at lift 0, gamma 1, gain 1, warm 1, cool 1, saturation 1. */
export interface GradePreset {
  lift: readonly [number, number, number];
  gamma: number;
  gain: readonly [number, number, number];
  saturation: number;
  /** Multiplies the lit end of the picture (the warm sun). */
  warm: readonly [number, number, number];
  /** Multiplies the shade (the cool sky light). */
  cool: readonly [number, number, number];
}

/** Aerial perspective of one weather preset (see `sky/fog.ts`). */
export interface HazePreset {
  /** In-scatter towards the sun, 0..1. */
  sun: number;
  /** Rayleigh tint of distant geometry, 0..1. */
  blue: number;
  /** Extinction per kilometre on top of the keyed fog, 0..1. */
  ext: number;
}

/** The street markings (M02h1): which road class paints what, and the design values of the paint. See `look/road-layout.ts`. */
export interface MarkingsFile extends LayoutConfig {
  /** sRGB hex. */
  paint: { white: string; yellow: string; bus: string };
  /** How much of the outer lane the bus tint covers, 0..1. */
  busTint: number;
  /** The `worn` mode (`full`, `lite`): the share of the paint the wear noise takes away, and the roughness of the paint. */
  worn: { wear: number; roughness: number };
  /** Crosswalk and stop-bar quads lie this far (metres) over the highest ribbon under them, and fade to the road beyond `decalFarM`. */
  decalLiftM: number;
  decalFarM: number;
  /**
   * A crosswalk or stop-bar quad has a hard geometry edge, and a quad a fraction of a pixel wide that moves by a pixel between frames is
   * sparkle: its paint fades out as the ground footprint of a pixel (metres) goes from `fromM` to `toM` (a stop bar is 0.4 m deep).
   */
  decalFootprintM: { fromM: number; toM: number };
  /**
   * The distance fade of the paint (QA: `markings.aa` turns it off). Every line is filtered over the pixel footprint of its own coordinate;
   * once the footprint passes `fromM` (metres) the window grows, to `1 + widen` times the footprint at `toM`, so a line that is a fraction of a
   * pixel wide spreads its paint over more pixels and moves less between two frames. The mean coverage stays: far paint is a soft tint, never gone.
   */
  fade: { fromM: number; toM: number; widen: number };
  /** Ribbons end at the largest incident half-width plus this at a junction of three or more roads. */
  junctionExtraM: number;
  stopBar: { depthM: number; behindCrosswalkM: number };
  crosswalk: { barM: number; rungM: number; rungPeriodM: number };
}

/**
 * The layers of the M02g1 look-tune (and `markings`, M02h1; `curbs`, `bump`, `macro` and `lots`, M02h2); each is gated per look profile by
 * `LookFile.layers`.
 */
export const LOOK_LAYERS = ['grade', 'haze', 'blob', 'casters', 'skyReflect', 'windows', 'markings', 'curbs', 'bump', 'macro', 'lots'] as const;
export type LookLayer = (typeof LOOK_LAYERS)[number];

export interface LookFile {
  schema: 'world-look/1';
  tierProfile: Record<QualityTierId, LookProfile>;
  /** 2 until the M11a1 governor raises it (DL-704). */
  postLevelCap: 0 | 1 | 2 | 3;
  /** Multiplies `SkyUniforms.uExposure`. */
  exposureBias: Record<QualityTierId, number>;
  /** At most `TierFeatures.shadows.distanceM`; the casters are the L0 `buildings` objects only. */
  casterRadiusM: Partial<Record<QualityTierId, number>>;
  /** Fallback switch, empty by default. */
  shadowsOff: readonly QualityTierId[];
  facade: Record<FacadeKey, FacadeClass>;
  roof: Record<'flat' | 'gable' | 'hip', RoofClass>;
  /** Keyed by `GroundClass` name and road class name. */
  ground: Record<string, GroundLook>;
  water: { deep: string; shallow: string; waves: readonly (readonly [dirDeg: number, lengthM: number, amp: number, speed: number])[] };
  sky: { turbidity: Record<WeatherPreset, number>; rayleigh: Record<WeatherPreset, number>; keyframeWeight: Record<WeatherPreset, number> };
  /** The bloom node's tuning (it was `POST_TUNING.bloom`): the threshold is high so only lit windows, the sun glint and the sun itself bloom. */
  bloom: { strength: number; radius: number; threshold: number };
  /** The colour grade per weather preset (M02g1). */
  grade: Record<WeatherPreset, GradePreset>;
  /** The aerial perspective per weather preset (M02g1). */
  haze: Record<WeatherPreset, HazePreset>;
  /** `litFrac`: rows of `[hour, min, max]`, the share of a lit building's windows that are lit, cyclic over 24 h (M02g1). */
  windows: { litFrac: readonly (readonly [hour: number, min: number, max: number])[] };
  /** The layer ids each look profile enables; `legacy` only `markings` (the XR tiers draw the flat paint, M02h1) and nothing else (M02g1). */
  layers: Record<LookProfile, readonly LookLayer[]>;
  /** M02h2: the strength of the ground bump (`groundNodes().height` through `look-materials.ts`) per look profile; 0 on `min` and `legacy`. */
  bump: Record<LookProfile, number>;
  /** The street markings (M02h1). */
  markings: MarkingsFile;
  /** Trees and traffic within this many metres of the focus cast shadows on the `casters` layer (M02g1). */
  dynamicCasterRadiusM: number;
  /** `gtao-half`, `bloom` or `fsr1` when they fail on the WebGL2 backend (each with a spec/03 section 7 row). Never `tonemap` or an AA node. */
  webgl2Unsupported: readonly PostNode[];
  /** AA substitution on the WebGL2 backend when the node fails there (`traa` to `smaa` or `fxaa`; `smaa` to `fxaa`). */
  webgl2AaFallback: Partial<Record<'traa' | 'smaa', 'smaa' | 'fxaa'>>;
}

export const LOOK: LookFile = lookJson as unknown as LookFile;

/** `config/platform-flags.json` `world.look` (default true): false is the full rollback to the M02b1/M02b2 look. */
export const LOOK_FLAG: boolean = (flagsJson as Record<string, unknown>)['world.look'] !== false;

export const TIER_IDS: readonly QualityTierId[] = ['desktop-ultra', 'desktop', 'mobile', 'mobile-low', 'xr-quest', 'xr-visionpro'];

/** The look profile of a tier; every tier is `legacy` when the `world.look` flag is off. */
export function lookProfileFor(tier: QualityTierId, enabled: boolean = LOOK_FLAG, look: LookFile = LOOK): LookProfile {
  return enabled ? look.tierProfile[tier] : 'legacy';
}

/** The layers a profile enables (empty for `legacy`). */
export function layersOf(profile: LookProfile, look: LookFile = LOOK): readonly LookLayer[] {
  return look.layers[profile] ?? [];
}

/** The facade class of a `BuildingKind` code (0 ResLow .. 5 Civic). */
export function facadeKeyOf(kind: number): FacadeKey {
  return FACADE_KEYS[kind] ?? 'ResLow';
}

export function facadeClassOf(kind: number, look: LookFile = LOOK): FacadeClass {
  return look.facade[facadeKeyOf(kind)];
}

/** `#rrggbb` (sRGB) to linear floats. */
export function srgbHexToLinear(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return [f(((n >> 16) & 255) / 255), f(((n >> 8) & 255) / 255), f((n & 255) / 255)];
}

const POST_NODES: readonly PostNode[] = ['gtao-half', 'bloom', 'smaa', 'traa', 'fxaa', 'fsr1', 'tonemap'];

/** The structural rules of `markings` the schema cannot say: every class maps to a rule, class 0 paints nothing, the paint is not wider than the lane. */
export function markingsErrors(m: MarkingsFile): string[] {
  const errors: string[] = [];
  if (m.classes[0] !== 'none') errors.push('markings.classes[0] must be "none": class 0 paints nothing');
  for (const [cls, rule] of Object.entries(m.byClass)) {
    if (!m.classes.includes(rule)) errors.push(`markings.byClass.${cls} names ${rule}, which is not in markings.classes`);
  }
  for (const name of m.classes) if (m.rules[name] === undefined) errors.push(`markings.rules has no entry for the class ${name}`);
  for (const name of Object.keys(m.rules)) if (!m.classes.includes(name)) errors.push(`markings.rules.${name} is not in markings.classes`);
  const none = m.rules['none'];
  if (none && (none.edges || none.dashes || none.ts || none.centre !== 'never')) errors.push('markings.rules.none must paint nothing');
  if (m.doubleGapM + 2 * m.lineM > 0.5) errors.push('markings: the double yellow line is wider than 0.5 m');
  if (m.tStemM >= m.parkingM) errors.push(`markings.tStemM ${m.tStemM} must stay under parkingM ${m.parkingM}`);
  return errors;
}

/**
 * The structural rules the schema cannot say: every `casterRadiusM` within the tier's shadow distance, the XR tiers `legacy`,
 * `webgl2Unsupported` never holds `tonemap` or an AA node, and the AA substitutions only go to a node that exists.
 */
export function lookErrors(look: LookFile, shadowDistanceM: Partial<Record<QualityTierId, number>>): string[] {
  const errors: string[] = [];
  if (look.schema !== 'world-look/1') errors.push(`schema must be world-look/1, got ${String(look.schema)}`);
  for (const [tier, r] of Object.entries(look.casterRadiusM) as [QualityTierId, number][]) {
    const max = shadowDistanceM[tier];
    if (max === undefined) errors.push(`casterRadiusM names unknown tier ${tier}`);
    else if (r > max) errors.push(`casterRadiusM.${tier} ${r} exceeds the tier's shadow distance ${max}`);
  }
  for (const n of look.webgl2Unsupported) {
    if (n === 'tonemap' || n === 'fxaa' || n === 'smaa' || n === 'traa') errors.push(`webgl2Unsupported must not hold ${n}`);
    if (!POST_NODES.includes(n)) errors.push(`webgl2Unsupported names unknown node ${String(n)}`);
  }
  if (look.webgl2AaFallback.smaa !== undefined && look.webgl2AaFallback.smaa !== 'fxaa') errors.push('webgl2AaFallback.smaa can only be fxaa');
  if (look.layers.legacy.some((id) => id !== 'markings')) errors.push('layers.legacy may hold only markings: the legacy look adds nothing else');
  errors.push(...markingsErrors(look.markings));
  for (const [profile, ids] of Object.entries(look.layers) as [LookProfile, readonly string[]][]) {
    for (const id of ids) if (!(LOOK_LAYERS as readonly string[]).includes(id)) errors.push(`layers.${profile} names unknown layer ${id}`);
  }
  if (look.layers.lite.includes('casters') || look.layers.min.includes('casters')) errors.push('the casters layer is desktop only (profile full)');
  for (const [i, row] of look.windows.litFrac.entries()) {
    if (row[1] > row[2]) errors.push(`windows.litFrac[${i}]: min ${row[1]} exceeds max ${row[2]}`);
    const prev = look.windows.litFrac[i - 1];
    if (prev && row[0] <= prev[0]) errors.push(`windows.litFrac[${i}]: hours must increase`);
  }
  for (const k of FACADE_KEYS) {
    const c = look.facade[k];
    if (c.winW >= c.bayM) errors.push(`facade.${k}: winW ${c.winW} must be less than bayM ${c.bayM}`);
    if (c.winH + c.sillM >= c.floorM + 1e-6) errors.push(`facade.${k}: sill plus window height exceeds the floor`);
  }
  return errors;
}

/** `ShadowMode` re-exported so look modules need not reach into the contract file. */
export type { ShadowMode };
