import {
  C13_VERSION,
  FLAT_LADDER,
  type DynamicQuality,
  type DynamicRange,
  type QualityTier,
  type QualityTierId,
  type TierBudget,
  type TierDecision,
  type TierDecisionSource,
  type TierFamily,
  type TierFeatures,
  type BackendPolicy,
  type XrTierConfig,
} from './c13.ts';

/**
 * Builds full `QualityTier`s from the parsed `config/tier-budgets.json` (11-platform.md sections 4.2 to 4.5).
 * Pure: the engine imports the JSON, tools read it with fs, and both call these functions.
 */
export const TIER_IDS: readonly QualityTierId[] = [
  'desktop-ultra', 'desktop', 'mobile', 'mobile-low', 'xr-quest', 'xr-visionpro',
];

/** One tier as stored in config/tier-budgets.json: the budget plus family, features, backend and xr. */
export interface TierConfigEntry extends TierBudget {
  family: TierFamily;
  features: TierFeatures;
  backend: BackendPolicy;
  xr: XrTierConfig | null;
}
export interface TierConfigFile {
  c13: string;
  tiers: Record<QualityTierId, TierConfigEntry>;
}

/**
 * Dynamic range (QualityTier.dynamic). Spec fixes the floors renderScale 0.5, postLevel 0 and targetFps = minFps, and
 * the ceilings equal the tier values. The other floors are Builder decision BD-M01c-03 (calibrated in M11a):
 * shadowDistanceScale 0.5, buildingDistanceScale 0.6, lodBias +2, crowdDensity 0.4, atmosphereLevel 0, textureMipBias 2,
 * foveation 1 (XR only; the ceiling is the tier's default).
 */
export function deriveDynamic(entry: TierConfigEntry): DynamicRange {
  const xr = entry.xr;
  const ceil: DynamicQuality = {
    renderScale: 1,
    shadowDistanceScale: 1,
    buildingDistanceScale: 1,
    lodBias: 0,
    crowdDensity: 1,
    postLevel: 3,
    atmosphereLevel: entry.features.sky === 'timecyc-dome+atmosphere' ? 2 : 1,
    textureMipBias: 0,
    foveation: xr ? xr.foveationDefault : null,
    targetFps: entry.frame.targetFps,
  };
  const floor: DynamicQuality = {
    renderScale: 0.5,
    shadowDistanceScale: 0.5,
    buildingDistanceScale: 0.6,
    lodBias: 2,
    crowdDensity: 0.4,
    postLevel: 0,
    atmosphereLevel: 0,
    textureMipBias: 2,
    foveation: xr ? 1 : null,
    targetFps: entry.frame.minFps,
  };
  return { floor, ceil };
}

export function buildQualityTier(id: QualityTierId, entry: TierConfigEntry): QualityTier {
  const { family, features, backend, xr, ...budget } = entry;
  return { id, family, budget, features, backend, dynamic: deriveDynamic(entry), xr };
}

export function buildQualityTiers(file: TierConfigFile): Record<QualityTierId, QualityTier> {
  const out = {} as Record<QualityTierId, QualityTier>;
  for (const id of TIER_IDS) out[id] = buildQualityTier(id, file.tiers[id]);
  return out;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v);

/** Structural check of config/tier-budgets.json. Returns one message per problem; empty means valid. */
export function validateTierConfig(raw: unknown): string[] {
  const errors: string[] = [];
  if (!isObj(raw)) return ['tier config is not an object'];
  if (raw['c13'] !== C13_VERSION) errors.push(`c13 is ${String(raw['c13'])}, expected ${C13_VERSION}`);
  const tiers = raw['tiers'];
  if (!isObj(tiers)) return [...errors, 'tiers is missing'];
  for (const k of Object.keys(tiers)) if (!TIER_IDS.includes(k as QualityTierId)) errors.push(`unknown tier ${k}`);
  for (const id of TIER_IDS) {
    const t = tiers[id];
    if (!isObj(t)) {
      errors.push(`${id}: missing`);
      continue;
    }
    const need = (path: string, v: unknown, ok: (x: unknown) => boolean): void => {
      if (!ok(v)) errors.push(`${id}.${path}: invalid`);
    };
    const sec = (name: string): Record<string, unknown> => {
      const s = t[name];
      if (!isObj(s)) {
        errors.push(`${id}.${name}: missing`);
        return {};
      }
      return s;
    };
    need('family', t['family'], (x) => x === 'desktop' || x === 'mobile' || x === 'xr');
    const frame = sec('frame');
    for (const k of ['targetFps', 'maxFps', 'minFps', 'frameBudgetMs']) need(`frame.${k}`, frame[k], num);
    const render = sec('render');
    for (const k of ['maxRenderObjects', 'maxGpuDrawCmds', 'maxTriangles']) need(`render.${k}`, render[k], num);
    need('render.viewPasses', render['viewPasses'], (x) => x === 1 || x === 2);
    const memory = sec('memory');
    for (const k of ['maxTextureMB', 'maxGpuResourceMB', 'maxAccountedHeapMB', 'maxMediaMB']) need(`memory.${k}`, memory[k], num);
    sec('world');
    sec('crowd');
    sec('sim');
    sec('boot');
    const f = sec('features');
    need('features.shadows', f['shadows'], isObj);
    need('features.post', f['post'], Array.isArray);
    need('features.optionalPost', f['optionalPost'], Array.isArray);
    need('features.pipeline', f['pipeline'], (x) => x === 'render-pipeline' || x === 'direct');
    const b = sec('backend');
    need('backend.preferred', b['preferred'], (x) => x === 'webgpu' || x === 'webgl2');
    need('backend.gate', b['gate'], (x) => x === 'stable' || x === 'device-spike-gated');
    const family = t['family'];
    if (family === 'xr') need('xr', t['xr'], isObj);
    else need('xr', t['xr'], (x) => x === null);
  }
  return errors;
}

/** Next rung down the flat ladder, or null at the bottom or for an XR tier. */
export function stepDownTier(id: QualityTierId): QualityTierId | null {
  const i = (FLAT_LADDER as readonly string[]).indexOf(id);
  if (i < 0) return null;
  return FLAT_LADDER[i + 1] ?? null;
}

const SOURCES: readonly TierDecisionSource[] = [
  'auto-provisional', 'auto-benchmark', 'user-override', 'url-override',
  'abnormal-exit-demotion', 'governor-demotion', 'xr-session', 'memory-pressure',
];

/**
 * Runtime validation of a stored `TierDecision` (schema `tier-decision.v1`, packages/shared/schemas/tier-decision.v1.json).
 * Returns the decision, or null for a mismatch: the caller ignores the record and re-runs the benchmark.
 */
export function parseTierDecision(raw: unknown): TierDecision | null {
  if (!isObj(raw)) return null;
  if (raw['v'] !== 1) return null;
  const tier = raw['tier'];
  if (typeof tier !== 'string' || !TIER_IDS.includes(tier as QualityTierId)) return null;
  const source = raw['source'];
  if (typeof source !== 'string' || !SOURCES.includes(source as TierDecisionSource)) return null;
  const decidedAt = raw['decidedAt'];
  if (typeof decidedAt !== 'number' || !Number.isInteger(decidedAt) || decidedAt < 0) return null;
  if (typeof raw['build'] !== 'string' || typeof raw['uaHash'] !== 'string' || typeof raw['adapterHash'] !== 'string') return null;
  const c13 = raw['c13'];
  if (typeof c13 !== 'string' || !/^1\./.test(c13)) return null;
  return raw as unknown as TierDecision;
}
