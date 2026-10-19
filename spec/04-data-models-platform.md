# 04 — Data models, part 8: C13 QualityTier, budgets and platform services

> Wave 5 integration (Architect), 2026-10-18. Part of `spec/04-data-models.md`. Text at 06 v1.1, copied verbatim from `spec/domains/11-platform.md` §3, §4, §5.8, `11-platform-xr.md` §3–§4, `11-platform-pwa.md` §4, §5, §9, §11 and `11-platform-perf.md` §4 (S11). The owner specs stay normative; the per-tier budget numbers (`11-platform.md` §4.5 table, mirrored by `config/tier-budgets.json`) are cited, not copied.

## C13 — `QualityTier` + budgets + platform services

| Field | Value |
|---|---|
| Owner · version | S11 · `C13_VERSION = '1.1.0'` |
| Source paths | pure types and constants: `packages/shared/src/platform/c13.ts`, `platform/xr-comfort.ts`, `config/tier-budgets.json`; runtime services (DOM, `three` and WebXR types, so outside `@dv/shared`): `packages/engine/src/platform/**`, `packages/engine/src/assets/store/`, `apps/web/` (PWA) |
| Defined in | `11-platform.md` §4 (+ §3 facade, §5.8 device loss); `11-platform-xr.md` §3–§4; `11-platform-pwa.md` §4, §5, §9, §11 (1.1); `11-platform-perf.md` §4 |
| Created in | M00 (`c13.ts`, `config/tier-budgets.json`); M01c (renderer host, tier selection, perf harness); M01e (`WorldPackStore`) |
| Consumers | S01, S02, S03, S05, S06, S07, S08, S09, S10, S12; milestones M00, M01a1 (`SimConfig.tier`), M01c, M01d (`VARIANT_FALLBACK`), M01e, M02b1, M04b1 (settings), M04c, M11a family, M11b1, M11b3, M13a1 (`AssetSource`) |

Platform facade handed to S01 at boot:

```ts
export interface Platform {
  quality: QualityService;
  host: RendererHost;
  governor: QualityGovernor;
  memory: MemoryBudget;
  perf: PerfProbe;
  xr: XrSessionController;
  lifecycle: LifecycleController;
  unlock: FirstGestureUnlock;
  telemetry: Telemetry;
  packs: WorldPackStore;
}
export function createPlatform(opts: { canvas: HTMLCanvasElement; qa: QaFlags }): Promise<Platform>;
```

Identifiers, ladders, variant resolution:

```ts
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
```

Budgets, features, dynamic range, tier:

```ts
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
  sky: 'keyframe-dome' | 'keyframe-dome+atmosphere';
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
```

Consumer-facing service:

```ts
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
```

Device profile, tier decision, settings:

```ts
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
export function classifyDevice(s: DeviceSignals): DeviceProfile;       // pure; no globals

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
```

**Runtime JSON Schema — tier decision** (read from IndexedDB `dv-platform/tier-decision`; a mismatch means ignore and re-run the benchmark):

```json
{ "$id": "tier-decision.v1", "type": "object",
  "required": ["v","tier","source","decidedAt","build","uaHash","adapterHash","c13"],
  "properties": { "v": {"const": 1},
    "tier": {"enum": ["desktop-ultra","desktop","mobile","mobile-low","xr-quest","xr-visionpro"]},
    "decidedAt": {"type":"integer","minimum":0}, "c13": {"type":"string","pattern":"^1\\."} } }
```

`PlatformSettings` (device-scoped, IndexedDB `dv-platform/settings`, never in C05):

```ts
export interface PlatformSettings {
  v: 1;
  tierOverride: QualityTierId | 'auto';
  compatibilityMode: boolean;                 // force WebGL2
  fpsCap: 'auto' | 30 | 60;
  renderScale: 'auto' | 0.5 | 0.65 | 0.8 | 1.0;
  foveation: 'auto' | 0 | 0.25 | 0.5 | 0.75 | 1;
  dataSaver: boolean;                         // video rendition, prefetch limits
  telemetryConsent: { diagnostics: boolean; analytics: boolean }; // C16 consent; read at boot, before any save profile loads
}
// XR comfort is a player preference and lives in C05: ProfileSettings.xr = XrComfortSettings & { heightCalibM } (Part B §4.2).
```

Renderer host and device loss (§5.8):

```ts
export interface GpuResourceOwner { onRendererReplaced(next: THREE.WebGPURenderer, prev: THREE.WebGPURenderer | null): Promise<void> }
export interface RendererHost {
  readonly renderer: THREE.WebGPURenderer; readonly backend: RenderBackend;
  init(tier: QualityTier): Promise<{ backend: RenderBackend; features: readonly string[] }>;
  register(owner: GpuResourceOwner): () => void;   // re-created on swap or recovery
  recover(): Promise<void>;
  readonly depthPolicy: 'reversed' | 'standard';
  installXrFallback(): void;     // Part B: swap to a WebGL2-backend renderer at XR entry
}
```

XR session controller (`11-platform-xr.md` §3):

```ts
export type XrState = 'unsupported' | 'available' | 'requesting' | 'swapping' | 'warming'
                    | 'presenting' | 'interrupted' | 'ending';
export interface XrSessionController {
  readonly state: XrState;
  readonly headset: 'quest' | 'visionpro' | null;
  /** MUST be called synchronously from a user-activation event handler. Rejects with
   *  XrGestureRequired (without touching navigator.xr) when called outside activation. */
  enter(): Promise<void>;
  exit(): Promise<void>;
  setRefreshHz(hz: number): Promise<boolean>;           // Quest only
  onState(fn: (s: XrState, prev: XrState) => void): () => void;
  readonly session: XRSession | null;
}
```

XR comfort settings (`packages/shared/src/platform/xr-comfort.ts`; persisted in C05 `ProfileSettings.xr`, persistence owner S01):

```ts
export interface XrComfortSettings {
  v: 1;
  locomotion: 'teleport' | 'smooth';          // default 'teleport'
  turn: 'snap' | 'smooth';                    // default 'snap'
  snapAngleDeg: 30 | 45;                      // default 30 (matches C04 XRRigParams)
  smoothSpeedMps: number;                     // 1..6, default 4
  quantizeVelocity: boolean;                  // stop / walk / run steps, default true
  vignette: 'off' | 'low' | 'medium' | 'high';// default 'medium'; applies only while moving
  comfortAssist: number;                      // 0..1, default 0.5 (scales vignette and acceleration)
  seated: boolean;                            // eye-height offset, default false
  dominantHand: 'left' | 'right';             // default 'right'
  cockpitHorizonLock: boolean;                // default true
  chaseView: 'cockpit' | 'diorama';           // pursuits, default 'cockpit'
  arenaScale: 'tabletop' | 'life-size';       // fighter, default 'tabletop'
  handsEnabled: boolean;                      // request hand-tracking, default true
  uiDistanceM: number;                        // 0.8..2.0, default 1.2
  reduceMotion: boolean;                      // from global reduced-motion; vignette >= low, no head bob
}
```

`XrPoseBlock`: one `SharedArrayBuffer` (`Int32Array` header with a seqlock counter, then `Float32Array` head pose, four source slots of 27 floats and two hands of 201 floats; about 520 floats); without isolation the same struct goes by `postMessage` once per frame (`11-platform-xr.md` §4.3).

XR input and panel interfaces:

```ts
export type XrSourceKind = 'controller' | 'hand' | 'transient-pointer';
export interface XrSourceState {
  readonly source: XRInputSource;             // map key; never an array index
  kind: XrSourceKind; handedness: 'left' | 'right' | 'none';
  lifetimeId: number; profiles: readonly string[];
}
export interface XrInputRouter {
  attach(session: XRSession, space: XRReferenceSpace): void;
  detach(): void;
  /** Once per XR frame, inside the frame callback, before the main-thread input phase.
   *  S01's three XR Binders read this per-frame cache in poll(). */
  sample(frame: XRFrame, out: XrPoseBlock): void;
  sources(): ReadonlyMap<XRInputSource, XrSourceState>;
}
export interface XrPanel {
  id: string; sizeM: { w: number; h: number }; pixels: { w: number; h: number };
  anchor: 'world' | 'wrist' | 'lazy-follow';          // head-locked is forbidden
  draw(ctx: CanvasRenderingContext2D, tSec: number): void;
  onRay(hit: { u: number; v: number } | null, pressed: boolean, hand: 'left' | 'right'): void;
}
export interface XrMediaHost {
  readonly kind: 'xr-media-layer' | 'xr-texture' | 'webcodecs-texture';
  prepare(clip: PreparedClip): Promise<void>;
  start(): Promise<void>; stop(): void;
  setSubtitle(text: string | null): void;
}
```

PWA update controller (`11-platform-pwa.md` §4):

```ts
export interface PwaUpdateController {
  readonly updateAvailable: boolean;
  markSafePoint(kind: 'menu' | 'mission-end' | 'safehouse' | 'loading'): void; // S01/S10 call
  markUnsafe(): void;
  applyNow(opts?: { force?: boolean }): Promise<void>;  // refuses while unsafe unless forced
  onChange(fn: (available: boolean) => void): () => void;
}
```

World-pack store (`11-platform-pwa.md` §5; OPFS `dv/packs/<sha256>.bin`, IndexedDB `dv-packs/packs` row written after `flush()` is the commit):

```ts
export interface PackRef { url: string /* BootConfig.hosts.media + C07 AssetVariant.key */; sha256: string /* C07 AssetVariant.sha256 */; bytes: number; kind: 'chunk' | 'tex' | 'mesh' | 'audio' | 'data'; tags?: string[] /* C07 tags, e.g. char:<npcId> */ }
export type PackFailure = 'offline' | 'http' | 'hash-mismatch' | 'quota' | 'aborted';
export class PackUnavailable extends Error { constructor(readonly reason: PackFailure, readonly ref: PackRef) { super(reason) } }
export interface StorageUsage { usageMB: number; quotaMB: number; persisted: boolean | null; packsMB: number; packs: number; cutscenesMB: number }
export interface WorldPackStore {
  open(): Promise<'opfs' | 'memory-fallback'>;
  has(hash: string): Promise<boolean>;
  get(ref: PackRef, o?: { priority?: 'now' | 'soon' | 'idle'; signal?: AbortSignal }): Promise<ArrayBuffer>;
  prefetch(refs: readonly PackRef[], priority: 'soon' | 'idle'): void;
  pin(hashes: readonly string[]): void;                    // boot set of the current manifest
  gc(current: ReadonlySet<string>): Promise<{ removed: number; freedMB: number }>;
  usage(): Promise<StorageUsage>;
  downloadAll(refs: readonly PackRef[], onProgress: (done: number, total: number) => void): Promise<void>;
  evictByTag(tag: string): Promise<{ removed: number }>;   // kill-switch path (S05 §5.5): drop every pack tagged char:<npcId>
  clear(): Promise<void>;
}
```

Telemetry client and heartbeat (client half of C16; `localStorage['dv.hb']`):

```ts
export interface HeartbeatRecord {
  v: 1; sid: string; t: number; state: 'running' | 'hidden' | 'closed';
  scene: string; mode: string; chunkKey: string | null; tier: QualityTierId; backend: RenderBackend;
  memEstMB: number; gpuEstMB: number; build: string; ring: string[]; // ≤ 20 events, record ≤ 4 KB
}
export interface Telemetry {
  emit(name: TelemetryName, props?: Record<string, string | number | boolean>): void;
  heartbeat(patch: Partial<HeartbeatRecord>): void;
  setConsent(c: { diagnostics: boolean; analytics: boolean }): void;   // events dropped client-side when off
  flush(reason: 'hidden' | 'pagehide' | 'interval'): void;
}
```

Perf scenarios and reports (`11-platform-perf.md` §4; `PerfReport` is validated by `tools/ci/schemas/perf-report.v1.json`: every top-level key required, `v` const 1, numbers non-negative):

```ts
export interface PerfScenario {
  id: string;                         // 'graybox-walk' (S01 engine graybox, pre-world, DL-065) | 'walk-civic-center' | 'route-ferry-ocean-beach' | 'downtown-rush' | 'fight-stage' | 'xr-walk'
  pathRef: string;                    // camera path file owned by the scenario's milestone (S02, S06, S07)
  durationS: number; warmupS: number; seed: number;
  density: 'off' | 'nominal';         // traffic and peds at the tier budget
}
export interface PerfReport {
  v: 1; build: string; c13: string; createdAt: number /* epoch ms */;
  device: { class: DeviceClass; browser: string; model?: string; uaHash: string;
            adapter: AdapterSummary | null; displayMode: DisplayMode; refreshHz: number | null };
  tier: QualityTierId; backend: RenderBackend; governor: 'on' | 'off'; scenario: PerfScenario;
  frames: { count: number; medianMs: number; p95Ms: number; p99Ms: number; maxMs: number;
            over50ms: number; over2xBudget: number };
  counts: { renderObjectsMax: number; renderObjectsP95: number; gpuDrawCmdsMax: number | null;
            trianglesMax: number; texturesMB: number; gpuResourcesMB: number };   // per view-pass
  memory: { accountedHeapMBMax: number; mediaMBMax: number; webContentEstMB: number | null };
  dynamic: { minRenderScale: number; downgrades: number; upgrades: number; tierChanges: number };
  boot: { warmBootToPlayableS: number | null; coldDownloadMB: number | null };
  errors: { gpuLost: number; uncaptured: number; js: number };
}
export interface Expectation { metric: string; op: '<=' | '>=' | '==' ; value: number | string | boolean }
export interface DeviceChecklist {
  id: string; milestone: string; device: string; urlTemplate: string;   // e.g. https://<preview>/?perf=1&tier=mobile-low
  steps: { id: string; instruction: string; expect?: Expectation[] }[];
  upload: ('perf.json' | 'notes.json')[];
}
```

**C13 1.1 delta** (DL-093, DL-102; `11-platform-pwa.md` §11):

```ts
// RendererHost (11-platform.md §5.8) gains (S10 previews; one canvas, never a second WebGL context on iPhone):
setMenuScene(scene: THREE.Group, camera: THREE.PerspectiveCamera): void;   // rendered on the shared canvas only while ModeHost is Idle
clearMenuScene(): void;
// XrPanels (11-platform-xr.md §3) registration surface used by S10 UiSurface (DN-S11-03):
export interface XrPanels {
  add(panel: XrPanel, placement: { anchor: XrPanel['anchor']; distanceM?: number; yawDeg?: number; heightM?: number }): void;
  remove(id: string): void; setVisible(id: string, on: boolean): void;
}
// FirstGestureUnlock (§7) exposes its pool of three unlocked <video> elements (S03 CutscenePlayer):
acquireVideo(): HTMLVideoElement | null; releaseVideo(v: HTMLVideoElement): void;
// PostNode adds desktop-only nodes (S06 photo mode and desktop-ultra look); allowed only in optionalPost of 'desktop-ultra' and 'desktop':
export type PostNode = 'gtao-half' | 'bloom' | 'smaa' | 'traa' | 'fxaa' | 'fsr1' | 'tonemap' | 'motionblur' | 'ssr' | 'dof' | 'lut';
// PlatformSettings (v stays 1; optional section, S12): developer loop for mods, never a URL flag
dev?: { mod: { enabled: boolean; port: number } };
// asset.worker AssetSource hook (S12): resolves '<kind>/mod.<sha256[0:12]>' refs from OPFS dv/mods/blobs/<sha256>; catalog refs are unchanged
export interface AssetSource { matches(ref: AssetRef): boolean; open(ref: AssetRef): Promise<{ bytes: ArrayBuffer; sha256: string; contentType: string } | null> }
```

1.1 notes from the owner section: `PerfScenario.id` adds `race-sprint`, `race-pursuit-heat4`, `fight-stage-pose`, `story-chase`, `npc-mission-crowd`, `mod-hostile`, `mod-scene-budget`; `QaFlags` also carries `?hour=`, `?weather=`, `?hooks=stub|bot`, `?talk=scripted`, `?beats=video|fallback|instant|plate` (QA builds only); app documents send `Permissions-Policy: camera=(self)`, CSP `connect-src` lists `'self'` plus the `BootConfig.hosts` origins; IndexedDB `dv-platform` gains store `pose-calibration` keyed `[saveProfileId, cameraKey]`, device-scoped and never synced. Costs of `ssr` and `motionblur` on r186 are UNVERIFIED (U-RAC-6, calibrated in M11a).
