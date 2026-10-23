import {
  HalfFloatType,
  NeutralToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  REVISION,
  Scene,
  UnsignedByteType,
  WebGPURenderer,
  type Camera,
  type Object3D,
} from 'three/webgpu';
import type { QualityTier, RenderBackend } from '@dv/shared';
import type { QaFlags } from './qa-flags.ts';
import type { PostStack } from './post/stack.ts';
import { PLATFORM_FLAGS } from './tier-config.ts';
import { GpuPacer, type FenceGl } from './gpu-pacer.ts';

/** `RendererHost.warm`: four turns of 90 degrees, each collected with a vertical field of view of 110 degrees. */
const WARM_TURNS = 4;
const WARM_FOV_DEG = 110;

/**
 * Renderer host (C13, 11-platform.md sections 5.1 and 5.8 plus the 1.1 menu-scene members).
 *
 * One `WebGPURenderer`; the WebGL2 fallback is automatic inside three, and `forceWebGL` selects it explicitly (policy,
 * `?gl=1`, or `webgpu.mobile === false` on the mobile tiers). The renderer comes from an injected factory so unit tests can
 * fake it. A failed WebGPU init is retried once with `forceWebGL` and reported as `err.gpu{kind:'init'}`; if WebGL2 fails as
 * well the host calls `events.unsupported` (the M00 Unsupported page). A device loss is recovered once; a second loss shows
 * the reload prompt.
 *
 * Active backend in three@0.186.1: after `init()` the renderer replaces `renderer.backend` with the fallback when WebGPU is
 * unavailable; `backend.isWebGPUBackend === true` marks the WebGPU backend and `backend.isWebGLBackend === true` the WebGL2
 * one (renderers/webgpu/WebGPUBackend.js, webgl-fallback/WebGLBackend.js).
 */

export const THREE_REVISION: string = REVISION;

/** C13 5.8: a GPU-resource owner re-creates its device objects when the renderer is replaced (recovery, XR swap). */
export interface GpuResourceOwner {
  onRendererReplaced(next: WebGPURenderer, prev: WebGPURenderer | null): Promise<void>;
}

export class NotImplementedError extends Error {
  constructor(readonly milestone: string) {
    super(`not implemented before ${milestone}`);
    this.name = 'NotImplementedError';
  }
}

export interface RendererFactoryOptions {
  canvas: HTMLCanvasElement;
  forceWebGL: boolean;
  /** Set `renderer.xr.enabled` before `init()` (required for XR). */
  xr: boolean;
  multiview: boolean;
  /** HalfFloat output buffer when true, UnsignedByte otherwise (TierFeatures.hdrOutput). */
  hdr: boolean;
  trackTimestamp: boolean;
  /** Adapter limits to request (`?limits=`); undefined requests none, so fallback adapters pass. */
  requiredLimits: Record<string, number> | undefined;
}
export type CreateRenderer = (o: RendererFactoryOptions) => WebGPURenderer;

/** Default factory: the real `WebGPURenderer` (11-platform.md section 5.1 step 4). */
export const createWebGpuRenderer: CreateRenderer = (o) =>
  new WebGPURenderer({
    canvas: o.canvas,
    antialias: false,
    forceWebGL: o.forceWebGL,
    powerPreference: 'high-performance',
    // Reversed depth on every tier (answers C04 rule 3). The WebGL backend honours it only with EXT_clip_control.
    reversedDepthBuffer: true,
    outputBufferType: o.hdr ? HalfFloatType : UnsignedByteType,
    multiview: o.multiview,
    trackTimestamp: o.trackTimestamp,
    ...(o.requiredLimits ? { requiredLimits: o.requiredLimits } : {}),
  });

export interface HostEvents {
  /** `err.gpu` source: init failure, device loss, uncaptured error. */
  gpuError?(kind: 'init' | 'lost' | 'uncaptured', message: string): void;
  /** WebGL2 init failed as well: show the Unsupported page. */
  unsupported?(error: Error): void;
  /** A second device loss: ask the player to reload. */
  reloadPrompt?(): void;
}

export interface RendererHostOptions {
  canvas: HTMLCanvasElement;
  createRenderer?: CreateRenderer;
  qa?: Pick<QaFlags, 'gl' | 'gpu' | 'limits'>;
  /** config/platform-flags.json `webgpu.mobile`. */
  webgpuMobile?: boolean;
  /** Settings "Compatibility mode": force WebGL2 on any tier. */
  compatibilityMode?: boolean;
  trackTimestamp?: boolean;
  events?: HostEvents;
  /** Replaces a canvas whose context was lost (a lost WebGL context cannot be re-acquired on the same element). */
  cloneCanvas?: (old: HTMLCanvasElement) => HTMLCanvasElement;
  /** Pace flat WebGL2 frames on GPU fences (`gpu-pacer.ts`; `createPlatform` sets it in QA builds on a fallback adapter, BD-FIX-CI7-F03). */
  paceGpu?: boolean;
}

export interface FrameListener {
  /** Start of a frame, before the engine hand-off and the render call. `time` is the rAF (or XR) timestamp in ms. */
  before?(time: number): void;
  /** After the engine hand-off (`frameHook`) and before the render call: the last word on camera and scene (the world scenario driver, M02b1). */
  late?(time: number): void;
  /** After `renderer.render()`; `renderer.info` still holds this frame's counts. */
  after?(time: number): void;
}

interface BackendFlags {
  isWebGPUBackend?: boolean;
  isWebGLBackend?: boolean;
  device?: { features?: Iterable<string> };
}

const MP = 1_000_000;

/** CSS-pixel size to device-pixel ratio under a tier's resolution caps (`dprCap`, `maxPixelsMP`) and the dynamic render scale. */
export function pixelRatioFor(tier: QualityTier, cssWidth: number, cssHeight: number, devicePixelRatio: number, renderScale = 1): number {
  const r = tier.budget.render;
  let ratio = r.dprCap === null ? devicePixelRatio : Math.min(devicePixelRatio, r.dprCap);
  if (r.maxPixelsMP !== null) {
    const area = Math.max(1, cssWidth * cssHeight);
    ratio = Math.min(ratio, Math.sqrt((r.maxPixelsMP * MP) / area));
  }
  return Math.max(0.25, ratio * renderScale);
}

function errorMessage(e: unknown): string {
  return (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 128);
}

function backendOf(renderer: WebGPURenderer): RenderBackend {
  const flags = renderer.backend as unknown as BackendFlags;
  if (flags.isWebGPUBackend === true) return 'webgpu';
  if (flags.isWebGLBackend === true) return 'webgl2';
  throw new Error('renderer-host: unknown backend after init()');
}

function cloneCanvasElement(old: HTMLCanvasElement): HTMLCanvasElement {
  if (typeof document === 'undefined') return old;
  const next = document.createElement('canvas');
  for (const attr of Array.from(old.attributes)) next.setAttribute(attr.name, attr.value);
  next.width = old.width;
  next.height = old.height;
  old.replaceWith(next);
  return next;
}

export class RendererHost {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(60, 1, 0.1, 100);
  /** Frames rendered by the animation loop (flat or XR). */
  frames = 0;
  /** Frames rendered while an XR session was presenting. */
  xrFrames = 0;
  /** Flat frames held back by the GPU pacer (QA builds on WebGL2; 0 otherwise). */
  get pacedFrames(): number {
    return this.pacer?.held ?? 0;
  }
  /** Runs at the start of every frame, before the render call (M01a2: the engine hand-off and the snapshot view). */
  frameHook: ((timeMs: number) => void) | null = null;
  /** The tier whose resolution caps `resize` applies. QualityService keeps it current. */
  tier: QualityTier | null = null;
  /**
   * A far-field pass drawn before the world, with its own camera planes (M02b1: the backdrop ring, massing and skyline cards, out
   * to 80 km). A near plane of 0.1 m and a far plane of 80 km do not fit one standard depth buffer, so the backdrop gets its own
   * pass and the world pass clears only the depth. The scene background of the backdrop pass is the sky. Not drawn in XR (M11b1).
   */
  backdrop: { scene: Object3D; camera: Camera } | null = null;
  /**
   * M02e: the post stack of the look pass. When set, the flat world draws through it (its `direct` callback is `renderDirect`, the
   * legacy path below); XR, the menu scene and a null stack keep the M01c/M02b1 path.
   */
  postStack: PostStack | null = null;
  /** Renderer recoveries performed this session (0 or 1; a second loss shows the reload prompt). */
  recoveries = 0;
  deviceLosses = 0;

  private _renderer: WebGPURenderer | null = null;
  private pacer: GpuPacer | null = null;
  private _backend: RenderBackend | null = null;
  private _depthPolicy: 'reversed' | 'standard' = 'standard';
  private _features: readonly string[] = [];
  private canvas: HTMLCanvasElement;
  private readonly owners = new Set<GpuResourceOwner>();
  private readonly listeners = new Set<FrameListener>();
  private menu: { scene: Object3D; camera: Camera } | null = null;
  private looping = false;
  private recovering: Promise<void> | null = null;
  private lastCss = { w: 0, h: 0 };
  private lastRenderScale = 1;
  private initTier: QualityTier | null = null;
  private readonly opts: RendererHostOptions;

  constructor(opts: RendererHostOptions) {
    this.opts = opts;
    this.canvas = opts.canvas;
  }

  get renderer(): WebGPURenderer {
    if (!this._renderer) throw new Error('renderer-host: init() has not completed');
    return this._renderer;
  }

  get backend(): RenderBackend {
    if (!this._backend) throw new Error('renderer-host: init() has not completed');
    return this._backend;
  }

  get ready(): boolean {
    return this._renderer !== null;
  }

  get depthPolicy(): 'reversed' | 'standard' {
    return this._depthPolicy;
  }

  get currentCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  get isPresenting(): boolean {
    return this._renderer?.xr.isPresenting ?? false;
  }

  /** Whether the first attempt for this tier should force the WebGL2 backend. */
  forceWebGlFor(tier: QualityTier): boolean {
    const qa = this.opts.qa;
    if (qa?.gl) return true;
    if (this.opts.compatibilityMode) return true;
    if (qa?.gpu) return tier.backend.forceWebGl;
    if (tier.backend.forceWebGl) return true;
    const mobileGate = tier.backend.gate === 'device-spike-gated' && tier.family === 'mobile';
    return mobileGate && !(this.opts.webgpuMobile ?? PLATFORM_FLAGS['webgpu.mobile']);
  }

  /**
   * Builds and initialises the renderer for `tier` (the XR tier's policy on XR-capable profiles). Resolves with the backend
   * that actually initialised.
   */
  async init(tier: QualityTier): Promise<{ backend: RenderBackend; features: readonly string[] }> {
    this.initTier = tier;
    if (!this.tier) this.tier = tier;
    const firstForce = this.forceWebGlFor(tier);
    try {
      await this.build(tier, firstForce);
    } catch (first) {
      if (firstForce) {
        this.fail(first);
      }
      this.opts.events?.gpuError?.('init', errorMessage(first));
      try {
        await this.build(tier, true);
      } catch (second) {
        this.fail(second);
      }
    }
    return { backend: this.backend, features: this._features };
  }

  private fail(error: unknown): never {
    const e = error instanceof Error ? error : new Error(String(error));
    this.opts.events?.unsupported?.(e);
    throw e;
  }

  private async build(tier: QualityTier, forceWebGL: boolean): Promise<void> {
    const create = this.opts.createRenderer ?? createWebGpuRenderer;
    const limits = this.opts.qa?.limits;
    const renderer = create({
      canvas: this.canvas,
      forceWebGL,
      xr: tier.xr !== null,
      multiview: tier.xr?.multiview ?? false,
      hdr: tier.features.hdrOutput,
      trackTimestamp: this.opts.trackTimestamp ?? false,
      requiredLimits: limits && Object.keys(limits).length > 0 ? { ...limits } : undefined,
    });
    // XR must be enabled before init() so the right context and binding are created.
    if (tier.xr !== null) renderer.xr.enabled = true;
    try {
      await renderer.init();
      const backend = backendOf(renderer);
      renderer.shadowMap.type = PCFShadowMap;
      renderer.toneMapping = NeutralToneMapping;
      renderer.info.autoReset = false;
      renderer.onDeviceLost = (info: { reason?: string | null; message?: string }) => this.onDeviceLost(info);
      // @types/three@0.186 declares onError as (message: string); the r186 backends call it with { api, type, message }.
      renderer.onError = ((info: { message?: string }) =>
        this.opts.events?.gpuError?.('uncaptured', (info.message ?? 'uncaptured').slice(0, 128))) as unknown as (errorMessage: string) => void;
      this._renderer = renderer;
      this._backend = backend;
      this.pacer?.dispose();
      const gl = backend === 'webgl2' && this.opts.paceGpu === true ? (renderer.backend as unknown as { gl?: FenceGl | null }).gl : null;
      this.pacer = gl ? new GpuPacer(gl) : null;
      this._depthPolicy = (renderer as unknown as { reversedDepthBuffer?: boolean }).reversedDepthBuffer === true ? 'reversed' : 'standard';
      const dev = (renderer.backend as unknown as BackendFlags).device;
      this._features = dev?.features ? [...dev.features].sort() : [];
    } catch (e) {
      try {
        renderer.dispose();
      } catch {
        // The renderer never finished init(); nothing to release.
      }
      throw e;
    }
  }

  register(owner: GpuResourceOwner): () => void {
    this.owners.add(owner);
    return () => {
      this.owners.delete(owner);
    };
  }

  addFrameListener(l: FrameListener): () => void {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }

  /** Shadow passes the active shadow object reports this frame (the post stack carries it; 0 without a look). Fed to `RenderBudgetMeter.measure`. */
  get shadowPasses(): number {
    return this.postStack?.shadowPasses ?? 0;
  }

  /** The exposure of the tone mapping (M02e: the sun state sets it; the sky keys alone drove it before). */
  setExposure(exposure: number): void {
    if (this._renderer) this._renderer.toneMappingExposure = exposure;
  }

  /** Sizes the drawing buffer under the current tier caps; the aspect ratio of both cameras follows. */
  resize(cssWidth: number, cssHeight: number, renderScale = this.lastRenderScale): void {
    this.lastCss = { w: cssWidth, h: cssHeight };
    this.lastRenderScale = renderScale;
    const r = this.renderer;
    const tier = this.tier ?? this.initTier;
    const dpr = (globalThis as { devicePixelRatio?: number }).devicePixelRatio ?? 1;
    r.setPixelRatio(tier ? pixelRatioFor(tier, cssWidth, cssHeight, dpr, renderScale) : Math.min(dpr, 2));
    r.setSize(Math.max(1, cssWidth), Math.max(1, cssHeight), false);
    const aspect = Math.max(1, cssWidth) / Math.max(1, cssHeight);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    const mc = this.menu?.camera;
    if (mc && (mc as PerspectiveCamera).isPerspectiveCamera) {
      (mc as PerspectiveCamera).aspect = aspect;
      (mc as PerspectiveCamera).updateProjectionMatrix();
    }
  }

  /** Rendered on the shared canvas only while ModeHost is Idle (C13 1.1). One canvas, never a second WebGL context on iPhone. */
  setMenuScene(scene: Object3D, camera: Camera): void {
    this.menu = { scene, camera };
  }

  clearMenuScene(): void {
    this.menu = null;
  }

  get menuActive(): boolean {
    return this.menu !== null;
  }

  /** The scene and camera the loop draws this frame: the menu scene while one is set, the world scene otherwise. */
  get active(): { scene: Object3D; camera: Camera } {
    return this.menu ?? { scene: this.scene, camera: this.camera };
  }

  /** Part B (M11b1): swap to a WebGL2-backend renderer at XR entry. */
  installXrFallback(): void {
    throw new NotImplementedError('M11b1');
  }

  private onDeviceLost(info: { reason?: string | null; message?: string }): void {
    // The WebGPU backend skips reason 'destroyed' itself; ignore it here as well (dispose during recovery).
    if (info.reason === 'destroyed') return;
    this.deviceLosses += 1;
    this.opts.events?.gpuError?.('lost', (info.message ?? 'device lost').slice(0, 128));
    if (this.deviceLosses === 1) {
      void this.recover().catch((e: unknown) => {
        this.opts.events?.gpuError?.('init', errorMessage(e));
        this.opts.events?.reloadPrompt?.();
      });
    } else {
      this.opts.events?.reloadPrompt?.();
    }
  }

  /**
   * Disposes the lost renderer, re-creates one with the same tier, and calls every registered owner's
   * `onRendererReplaced`. Performed once per session; a second loss shows the reload prompt instead.
   */
  recover(): Promise<void> {
    this.recovering ??= this.doRecover();
    return this.recovering;
  }

  private async doRecover(): Promise<void> {
    const tier = this.initTier;
    const prev = this._renderer;
    if (!tier || !prev) throw new Error('renderer-host: recover() before init()');
    const wasLooping = this.looping;
    this.stopLoop();
    this.recoveries += 1;
    const force = this._backend === 'webgl2' || this.forceWebGlFor(tier);
    // A lost context cannot be re-acquired on the same element.
    this.canvas = (this.opts.cloneCanvas ?? cloneCanvasElement)(this.canvas);
    this._renderer = null;
    try {
      prev.dispose();
    } catch {
      // The lost renderer may already be unusable.
    }
    await this.build(tier, force);
    const next = this.renderer;
    if (this.lastCss.w > 0) this.resize(this.lastCss.w, this.lastCss.h);
    for (const owner of [...this.owners]) await owner.onRendererReplaced(next, prev);
    if (wasLooping) this.startLoop();
  }

  startLoop(): void {
    this.looping = true;
    this.renderer.setAnimationLoop(this.tick);
  }

  stopLoop(): void {
    this.looping = false;
    this._renderer?.setAnimationLoop(null);
  }

  private readonly tick = (time: number | undefined): void => {
    const r = this._renderer;
    if (!r) return;
    // three's `Animation.start()` calls the loop once, synchronously, with no timestamp; the requestAnimationFrame it has already made
    // follows. Our loop meets that call when an XR session ends and three hands the loop back to the window. It is not a display frame,
    // and three's own XR loop skips it the same way. Passed on, its NaN time gave the engine a NaN dt that made the camera rig NaN for
    // good, and every later frame drew from a NaN camera (BD-FIX-CI6-A01).
    if (time === undefined || !Number.isFinite(time)) return;
    // With `paceGpu` on WebGL2: no frame starts while the GPU still has GPU_PACE_DEPTH earlier frames to draw (BD-FIX-CI7-F03). XR frames are
    // paced by the headset's compositor (or, emulated, by `installIwer`), so the pacer stays out of them.
    const paced = this.pacer !== null && !r.xr.isPresenting;
    if (paced && !(this.pacer as GpuPacer).ready()) return;
    // info.autoReset is off, so the host resets once per frame and the counts below are this frame's.
    r.info.reset();
    for (const l of this.listeners) l.before?.(time);
    this.frameHook?.(time);
    for (const l of this.listeners) l.late?.(time);
    this.frames += 1;
    if (r.xr.isPresenting) this.xrFrames += 1;
    if (this.menu) r.render(this.menu.scene as Scene, this.menu.camera);
    else if (this.postStack && !r.xr.isPresenting) this.postStack.render();
    else this.renderDirect();
    if (paced) this.pacer?.submitted();
    for (const l of this.listeners) l.after?.(time);
  };

  /**
   * Compiles the render programs of what the world and backdrop passes hold, in every horizontal direction from the camera, without
   * drawing (DL-715). A program that is first linked inside a frame stalls that frame: a mission beat that cuts to a new shot (M05b2
   * AC-8) brings objects into view the player camera never looked at (the skyline cards behind it, the cast). `compileAsync` is three
   * r186's `Renderer.compileAsync(scene, camera)`: it collects the objects inside the camera frustum synchronously, then builds their
   * pipelines and links the programs, without blocking where the backend allows it (WebGL2: KHR_parallel_shader_compile). The camera
   * is turned in four 90-degree steps with a wider field of view for the collection only, and restored before any frame draws.
   */
  async warm(): Promise<void> {
    const r = this._renderer;
    if (!r || r.xr.isPresenting) return;
    const passes: { scene: Object3D; camera: Camera }[] = [{ scene: this.scene, camera: this.camera }];
    if (this.backdrop) passes.unshift(this.backdrop);
    for (const pass of passes) {
      for (let k = 0; k < WARM_TURNS; k++) {
        const cam = pass.camera;
        const persp = (cam as PerspectiveCamera).isPerspectiveCamera === true ? (cam as PerspectiveCamera) : null;
        const q = cam.quaternion.clone();
        const fov = persp?.fov ?? 0;
        let done: Promise<void>;
        try {
          cam.rotateY((k * Math.PI * 2) / WARM_TURNS);
          if (persp) {
            persp.fov = Math.max(fov, WARM_FOV_DEG);
            persp.updateProjectionMatrix();
          }
          cam.updateMatrixWorld(true);
          done = r.compileAsync(pass.scene, cam);
        } finally {
          cam.quaternion.copy(q);
          if (persp) {
            persp.fov = fov;
            persp.updateProjectionMatrix();
          }
          cam.updateMatrixWorld(true);
        }
        await done.catch(() => undefined);
      }
    }
  }

  /** The M01c/M02b1 render: the backdrop pass, then the world pass over it (depth cleared only), tone mapping in the renderer. */
  readonly renderDirect = (): void => {
    const r = this.renderer;
    if (this.backdrop && !r.xr.isPresenting) {
      r.render(this.backdrop.scene as Scene, this.backdrop.camera);
      // The world pass keeps the colour of the backdrop pass and clears the depth only.
      r.autoClearColor = false;
      try {
        r.render(this.scene, this.camera);
      } finally {
        r.autoClearColor = true;
      }
    } else r.render(this.scene, this.camera);
  };

  dispose(): void {
    this.stopLoop();
    this.pacer?.dispose();
    this.pacer = null;
    this.postStack?.dispose();
    this.postStack = null;
    this.owners.clear();
    this.listeners.clear();
    try {
      this._renderer?.dispose();
    } catch {
      // Already released.
    }
    this._renderer = null;
  }
}
