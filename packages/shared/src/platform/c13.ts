/**
 * C13 platform contract, version 1.1.0. Sections 4.1 and 4.2 of spec/domains/11-platform.md are copied
 * without changes. The 4.6 types that QualityService refers to (DeviceSignals, DeviceProfile, TierDecision,
 * PlatformSettings) follow so the file compiles. M01c completes section 4.6 (the 1.1 `dev?` member of PlatformSettings);
 * classifyDevice lives in classify.ts, PerfScenario and PerfReport in perf.ts. Owner: S11. Change only through the Architect.
 */

// packages/shared/src/platform/c13.ts
export const C13_VERSION = '1.1.0' as const;            // semver; 1.1 additions: 11-platform-pwa.md §11

export type QualityTierId =
  | 'desktop-ultra' | 'desktop' | 'mobile' | 'mobile-low' | 'xr-quest' | 'xr-visionpro';
export type TierFamily = 'desktop' | 'mobile' | 'xr';
export type RenderBackend = 'webgpu' | 'webgl2';
export type DeviceClass = 'desktop' | 'iphone' | 'ipad' | 'android' | 'quest' | 'avp' | 'unknown'; // = C16 envelope
export type DisplayMode = 'tab' | 'standalone' | 'xr';

/** Flat step-down ladder, best first. XR tiers are never on it. */
export const FLAT_LADDER = ['desktop-ultra', 'desktop', 'mobile', 'mobile-low'] as const;

/** C07 variant resolution: first id present in AssetManifest.variants wins. check:assets fails
 *  if any chain resolves to nothing for any of the six tiers. */
export const VARIANT_FALLBACK: Readonly<Record<QualityTierId, readonly QualityTierId[]>> = {
  'desktop-ultra': ['desktop-ultra', 'desktop', 'mobile', 'mobile-low'],
  'desktop':       ['desktop', 'mobile', 'mobile-low'],
  'mobile':        ['mobile', 'mobile-low'],
  'mobile-low':    ['mobile-low'],
  'xr-quest':      ['xr-quest', 'mobile', 'mobile-low'],
  'xr-visionpro':  ['xr-visionpro', 'desktop', 'mobile', 'mobile-low'],
};
/** Tier used outside an XR session on an XR-capable device (menus, lobby). */
export const FLAT_TIER_OF: Readonly<Partial<Record<QualityTierId, QualityTierId>>> =
  { 'xr-quest': 'mobile-low', 'xr-visionpro': 'mobile' };

export interface FrameTargets {
  targetFps: number;            // sustained goal; frameBudgetMs = 1000 / targetFps
  maxFps: number;               // pacer cap
  minFps: number;               // governor floor before tier step-down
  frameBudgetMs: number;
  promoteWhenP90MsBelow?: number; // XR: raise refresh/targetFps when p90 under this
}
export interface RenderLimits {  // per view-pass; XR totals = value x viewPasses
  maxRenderObjects: number;     // visible render items incl. shadow-casting passes (RenderBudgetMeter)
  maxGpuDrawCmds: number;       // renderer.info.render.drawCalls
  maxTriangles: number;         // renderer.info.render.triangles
  maxPixelsMP: number | null;   // internal resolution cap, flat tiers
  dprCap: number | null;
  viewPasses: 1 | 2;            // 2 = XR without multiview (Vision Pro)
}
export interface MemoryLimits {   // accounted bytes (MemoryBudget), not process RSS
  maxTextureMB: number;
  maxGpuResourceMB: number;       // renderer.info.memory.total
  maxAccountedHeapMB: number;     // typed arrays + wasm memories + caches
  maxWebContentMB: number | null; // iOS: ceiling we stay under; kill observed at 2,048
  maxMediaMB: number;
  softPct: 85; hardPct: 95;
}
export type FarFieldMode =
  | { kind: 'impostor-ring'; km: 80 }
  | { kind: 'skyline-cards'; km: 10 | 20 };
export interface WorldLimits {
  streamingRadiusM: number;
  alwaysVisibleRadiusM: number | null;
  buildingDrawDistanceM: number;
  altitudeBoostM: number;
  farField: FarFieldMode;
  maxChunkUploadsPerFrame: 1;
  maxChunkUploadBytes: number | null;     // per frame
  maxRenderObjectsPerChunk: 6;
}
export interface CrowdLimits { maxTrafficInstances: number; maxPedInstances: number }
export interface SimLimits { simHz: 60; aiHz: 30 /* fixed on every tier by C02 AI_DIVISOR (cross-tier ambient determinism) */; physicsRadiusM: number; distantAnimHz: 30 | 60 }
export interface BootLimits { warmBootToPlayableS: number; coldBootDownloadMB: number }
export interface TierBudget {
  frame: FrameTargets; render: RenderLimits; memory: MemoryLimits;
  world: WorldLimits; crowd: CrowdLimits; sim: SimLimits; boot: BootLimits;
}

export type ShadowMode = 'csm3' | 'csm1' | 'blob';
export type PostNode = 'gtao-half' | 'bloom' | 'smaa' | 'traa' | 'fxaa' | 'fsr1' | 'tonemap';
export interface TierFeatures {
  shadows: { mode: ShadowMode; mapSize: 0 | 1024 | 2048 | 4096; distanceM: number };
  post: readonly PostNode[];             // always on at the tier
  optionalPost: readonly PostNode[];     // governor may enable when headroom exists
  pipeline: 'render-pipeline' | 'direct';// 'direct' = DirectRenderPipeline (XR)
  lighting: 'clustered' | 'probe-grid';  // probe-grid + emissive lamps, no per-lamp lights
  sky: 'timecyc-dome' | 'timecyc-dome+atmosphere';
  hdrOutput: boolean;                    // HalfFloat vs UnsignedByte outputBufferType
  msaaSamples: 0 | 4;
}

export interface BackendPolicy {
  preferred: RenderBackend;
  forceWebGl: boolean;                   // WebGPURenderer({ forceWebGL: true })
  requireRealAdapter: boolean;           // reject adapter.info.isFallbackAdapter
  gate: 'stable' | 'device-spike-gated'; // gated: config/platform-flags.json decides
}

export interface DynamicQuality {        // governor state; every field has a floor and a ceiling
  renderScale: number;                   // 0.5..1.0 of the tier pixel budget
  shadowDistanceScale: number;
  buildingDistanceScale: number;
  lodBias: number;                       // 0 = nominal, + = coarser
  crowdDensity: number;                  // 0..1 of CrowdLimits
  postLevel: 0 | 1 | 2 | 3;              // 3 = all of features.post + optionalPost
  atmosphereLevel: 0 | 1 | 2;
  textureMipBias: number;                // 0..2
  foveation: number | null;              // XR only, 0..1
  targetFps: number;
}
export interface DynamicRange { floor: DynamicQuality; ceil: DynamicQuality }

export interface XrTierConfig {          // Part B §4
  headset: 'quest' | 'visionpro';
  sessionMode: 'immersive-vr';
  optionalFeatures: readonly ('local-floor' | 'bounded-floor' | 'layers' | 'hand-tracking' | 'webgpu')[];
  nativeWebGpuXr: 'never' | 'preferred';
  multiview: boolean;
  framebufferScale: number;              // fixed per session
  framebufferScaleNextEntryFloor: number;
  foveationDefault: number;
  refresh: { minHz: number; maxHz: number | null; cutsceneHz: number | null; controllable: boolean };
  mediaLayer: boolean;                   // XRMediaBinding path
  renderedLayers: boolean;               // quad/cylinder layers for UI
}

export interface QualityTier {
  id: QualityTierId; family: TierFamily;
  budget: TierBudget; features: TierFeatures; backend: BackendPolicy;
  dynamic: DynamicRange; xr: XrTierConfig | null;
}

export interface QualityService {
  readonly tier: QualityTier;
  readonly dynamic: Readonly<DynamicQuality>;
  readonly backend: RenderBackend;               // what actually initialised
  readonly profile: DeviceProfile;
  budgetOf(id?: QualityTierId): TierBudget;
  assetVariant(available: readonly QualityTierId[]): QualityTierId; // VARIANT_FALLBACK
  /** Only honoured at a safe point (loading boundary, menu, XR veil). Returns when applied. */
  setTier(id: QualityTierId, reason: TierDecisionSource): Promise<void>;
  onTierChange(fn: (next: QualityTier, prev: QualityTier) => void): () => void;
  onDynamicChange(fn: (q: Readonly<DynamicQuality>) => void): () => void;
  onMemoryPressure(fn: (level: 'soft' | 'hard') => void): () => void;
}

// ---- 11-platform.md 4.6 (types only) ----
export interface DeviceSignals {            // raw, serialisable; unit-test fixtures captured on devices (M01c)
  userAgent: string; platform: string; uaData?: { brands: string[]; mobile: boolean; platform: string };
  maxTouchPoints: number; hardwareConcurrency: number; deviceMemoryGB: number | null;
  screen: { w: number; h: number; dpr: number };
  displayModeStandalone: boolean; crossOriginIsolated: boolean;
  hasNavigatorGpu: boolean; hasNavigatorXr: boolean; hasXrGpuBinding: boolean;
  immersiveVrSupported: boolean | null;     // null = not yet asked
  adapter: AdapterSummary | null;           // after requestAdapter
  gpuFeatures: readonly string[];           // after init
  opfs: boolean; storageQuotaMB: number | null; storageUsageMB: number | null;
}
export interface AdapterSummary {
  vendor: string; architecture: string; device: string; description: string;
  isFallbackAdapter: boolean; maxTextureDimension2D: number; maxBufferSize: number;
}
export interface DeviceProfile {
  class: DeviceClass; browser: 'chrome' | 'safari' | 'quest-browser' | 'firefox' | 'other';
  displayMode: DisplayMode; touch: boolean; lowMemoryHint: boolean;
  xrCapable: boolean; xrHeadset: 'quest' | 'visionpro' | null;
  textureFamily: 'astc' | 'bc' | 'etc2' | 'none';
  uaHash: string; adapterHash: string; signals: DeviceSignals;
}

export type TierDecisionSource =
  | 'auto-provisional' | 'auto-benchmark' | 'user-override' | 'url-override'
  | 'abnormal-exit-demotion' | 'governor-demotion' | 'xr-session' | 'memory-pressure';
export interface BenchmarkResult {
  scene: 'synthetic' | 'boot-chunk'; settingsTier: QualityTierId;
  frames: number; durationMs: number; medianMs: number; p90Ms: number; passed: boolean;
}
export interface TierDecision {
  v: 1; tier: QualityTierId; source: TierDecisionSource; decidedAt: number; // epoch ms (06 §4.3)
  build: string; uaHash: string; adapterHash: string; c13: typeof C13_VERSION;
  benchmark?: BenchmarkResult;
}
export type ClassifyDevice = (s: DeviceSignals) => DeviceProfile; // pure; no globals; implemented in classify.ts (M01c)

export interface PlatformSettings {
  v: 1;
  tierOverride: QualityTierId | 'auto';
  compatibilityMode: boolean;                 // force WebGL2
  fpsCap: 'auto' | 30 | 60;
  renderScale: 'auto' | 0.5 | 0.65 | 0.8 | 1.0;
  foveation: 'auto' | 0 | 0.25 | 0.5 | 0.75 | 1;
  dataSaver: boolean;                         // video rendition, prefetch limits
  telemetryConsent: { diagnostics: boolean; analytics: boolean }; // C16 consent; read at boot, before any save profile loads
  /** C13 1.1 (11-platform-pwa.md section 11): developer loop for mods, never a URL flag. */
  dev?: { mod: { enabled: boolean; port: number } };
}
// XR comfort is a player preference and lives in C05: ProfileSettings.xr = XrComfortSettings & { heightCalibM } (Part B §4.2).
