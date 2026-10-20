/**
 * LookView (M02e, DL-704): the page half of the look pass. It owns the post stack, the shadow rig, the physical sky and the light
 * rig of the look, and switches them with the materials as one: `setOn(false)` is the full rollback to the M02b1/M02b2 look (legacy
 * materials, no post stack, no shadow map, M01c tone mapping and exposure only), which is also what the XR tiers and the `world.look`
 * flag give. The sky's per-frame `after` hook lets it override the sun, the ambient light and the exposure that the sky wrote.
 */
import type { RendererHost } from '@dv/engine/platform/renderer-host';
import { PostStack, type PostLevel, type StackMode } from '@dv/engine/platform/post';
import type { PostNode, QualityTierId, RenderBackend, ShadowMode } from '@dv/shared';
import type { DirectionalLight, HemisphereLight, Light, PerspectiveCamera } from 'three/webgpu';
import type { BackdropLayer } from '../backdrop/backdrop-layer.ts';
import type { ChunkRenderer, LookRuntime } from '../chunks/chunk-renderer.ts';
import type { WorldMaterials } from '../chunks/materials.ts';
import type { SkyInput, SkyUniforms } from '../sky/types.ts';
import type { LookFile, LookProfile } from './config.ts';
import { PhysicalSky } from './sky-physical.ts';
import { ShadowRig } from './shadows.ts';
import { lookShot, shotQuaternion, type LookShot } from './shots.ts';
import { sunState, type SunState } from './sun.ts';

/** Hemisphere (ambient) intensity of the look pass; with an environment map the hemisphere only tints the ground bounce. */
export const HEMI_LOOK = 1.6;
const HEMI_WITH_ENV = 0.4;

/** Design values of the light rig, adjustable at runtime in QA builds (`__dvBridge.world.internals().look.tune`). */
export interface LookTune {
  /** Multiplies the hemisphere light. */
  hemi: number;
  /** Multiplies the environment map's intensity. */
  env: number;
  /** Multiplies the sun. */
  sun: number;
  /** 0..1: how far the ambient colour is pulled toward grey (the sky keys are very blue). */
  desat: number;
}
export const DEFAULT_TUNE: LookTune = { hemi: 1, env: 0.55, sun: 1, desat: 0.5 };

export interface LookReport {
  /** `legacy` while the look is off. */
  profile: LookProfile;
  on: boolean;
  postNodes: PostNode[];
  postMode: StackMode | 'none';
  postLevel: number;
  shadowMode: ShadowMode | 'none';
  shadowPath: string;
  shadowPasses: number;
  casters: number;
  casterKinds: string[];
  exposure: number;
  envMap: boolean;
  sky: 'physical' | 'dome';
  windowEmissive: number;
  backend: RenderBackend;
  tier: QualityTierId;
  /** Why a shadow or post fallback was taken, or null. */
  fallbacks: string[];
  envBakes: number;
  envBakeMs: number;
  /** The tier's pipeline (C13): `direct` on the XR tiers, which have no post stack. */
  pipeline: 'render-pipeline' | 'direct';
  /** The sun light: intensity and linear colour now (the moon at night). */
  sun: { intensity: number; color: [number, number, number]; moon: boolean } | null;
}

export interface LookViewOptions {
  host: RendererHost;
  tier: QualityTierId;
  look: LookFile;
  /** The profile the tier is configured for (`legacy` when the `world.look` flag is off or on an XR tier). */
  profile: LookProfile;
  materials: WorldMaterials;
  chunks: ChunkRenderer;
  lights: { hemi: HemisphereLight; sun: DirectionalLight };
  backdrop: BackdropLayer;
  browser: string;
  backend: RenderBackend;
  postLevel: PostLevel;
  /** The stream focus. */
  focus: () => { x: number; z: number };
  /** Holds or releases the sky's own clock (the painted clouds and the rain), for stills. */
  freezeSkyTime?: (on: boolean) => void;
}

/** A look shot being applied: the held camera and the wait for the frame. */
export interface ShotCamera {
  x: number;
  y: number;
  z: number;
  quat: [number, number, number, number];
  fovDeg: number;
}

export class LookView {
  readonly profile: LookProfile;
  on = false;
  stack: PostStack | null = null;
  shadows: ShadowRig | null = null;
  sky: PhysicalSky | null = null;
  /** The camera `shot()` holds, or null. */
  shotCamera: ShotCamera | null = null;
  /** QA: live adjustment of the light rig. */
  readonly tune: LookTune = { ...DEFAULT_TUNE };

  private readonly o: LookViewOptions;
  private state: SunState | null = null;
  private lookClock = 0;
  private clockFrozen = false;
  private lastWindow = 0;
  private lastLevel: PostLevel;
  private readonly fallbacks: string[] = [];
  private readonly runtime: LookRuntime;

  constructor(o: LookViewOptions) {
    this.o = o;
    this.profile = o.profile;
    this.lastLevel = o.postLevel;
    const receiving = (): boolean => this.on && (this.shadows?.receiving ?? false);
    this.runtime = {
      get receive(): boolean {
        return receiving();
      },
      get casting(): boolean {
        return receiving();
      },
      get casterRadiusM(): number {
        return o.look.casterRadiusM[o.tier] ?? 0;
      },
      focus: () => o.focus(),
    };
    o.chunks.look = this.runtime;
  }

  /** Whether the tier has a look at all (a `legacy` tier never does). */
  get available(): boolean {
    return this.profile !== 'legacy';
  }

  /** The weight of the dome over the physical sky (a node the dome's opacity reads); null where there is no physical sky. */
  get domeBlend(): PhysicalSky['domeBlend'] | null {
    return this.sky?.domeBlend ?? null;
  }

  /** Builds the parts and switches the materials on. */
  start(): void {
    if (!this.available) return;
    this.setOn(true);
  }

  /** The look on or off at runtime (QA `setLook`, the debug panel). Returns false when the tier has no look. */
  setOn(on: boolean): boolean {
    if (on === this.on) return true;
    if (on && !this.available) return false;
    const { materials, chunks } = this.o;
    if (on) {
      materials.setLook(true);
      this.build();
    } else {
      this.teardown();
      materials.setLook(false);
    }
    this.on = on;
    chunks.applyLook();
    return true;
  }

  private build(): void {
    const { host, look, tier, backend, browser } = this.o;
    const features = host.tier?.features;
    if (!features) return;
    // The shadow rig first: its `receiving` decides what the meshes get.
    this.shadows = new ShadowRig({
      scene: host.scene,
      light: this.o.lights.sun,
      shadows: features.shadows,
      tier,
      look,
      renderer: host.renderer,
      disabled: look.shadowsOff.includes(tier),
    });
    if (this.shadows.fallbackReason) this.fallbacks.push(this.shadows.fallbackReason);
    if (features.pipeline === 'render-pipeline') {
      this.stack = new PostStack({
        context: () => ({ renderer: host.renderer, scene: host.scene, camera: host.camera, backdrop: host.backdrop }),
        tier,
        features,
        backend,
        subs: { webgl2Unsupported: look.webgl2Unsupported, webgl2AaFallback: look.webgl2AaFallback },
        cap: look.postLevelCap,
        level: this.lastLevel,
        direct: host.renderDirect,
        onBuild: (_nodes, mode) => {
          // The pipeline composites the world pass over the backdrop by its alpha: the world pass clears to alpha 0.
          host.renderer.setClearColor(0x000000, mode === 'pipeline' ? 0 : 1);
        },
      });
      host.postStack = this.stack;
      this.stack.shadowPasses = this.shadows.passes;
      host.register(this.stack);
    }
    // The physical sky and its environment: the desktop tiers; WebKit never bakes (bug 303203).
    if (this.profile === 'full') {
      const envMap = browser !== 'safari';
      this.sky = new PhysicalSky({ backdrop: this.o.backdrop.scene, renderer: host.renderer, look, envMap });
    }
  }

  private teardown(): void {
    const { host } = this.o;
    if (this.stack) {
      host.postStack = null;
      this.stack.dispose();
      this.stack = null;
    }
    host.renderer.setClearColor(0x000000, 1);
    this.shadows?.dispose();
    this.shadows = null;
    if (this.sky) {
      this.sky.dispose();
      this.sky = null;
    }
    host.scene.environment = null;
    this.state = null;
  }

  /** The governor's `postLevel`: a change that leaves the effective node list as it was does not rebuild. */
  setPostLevel(level: PostLevel): void {
    this.lastLevel = level;
    this.stack?.setLevel(level);
  }

  /** The sky's per-frame hook: after the sky wrote its lights and exposure, the look overrides them. */
  after(u: Readonly<SkyUniforms>, input: Readonly<SkyInput>, nowMs: number): void {
    if (!this.on) return;
    const { host, look, tier, lights, backdrop } = this.o;
    const st = sunState(u, input.weather, tier, look, input.next, Math.max(0, Math.min(1, input.blend / 65535)));
    this.state = st;
    const sun = lights.sun;
    const dir: [number, number, number] = st.moon ? [-u.uSunDir[0], -u.uSunDir[1], -u.uSunDir[2]] : [u.uSunDir[0], u.uSunDir[1], u.uSunDir[2]];
    const tune = this.tune;
    const intensity = st.intensity * tune.sun;
    sun.color.setRGB(st.color[0], st.color[1], st.color[2]);
    sun.intensity = intensity;
    if (this.shadows) {
      this.shadows.light.color.setRGB(st.color[0], st.color[1], st.color[2]);
      this.shadows.light.intensity = intensity;
      this.shadows.place(dir, this.o.focus());
    } else {
      sun.position.set(dir[0] * 300, dir[1] * 300, dir[2] * 300);
    }
    backdrop.lights[1].color.copy(sun.color);
    backdrop.lights[1].intensity = intensity;
    backdrop.lights[1].position.set(dir[0] * 300, dir[1] * 300, dir[2] * 300);
    host.setExposure(st.exposure);

    // Ambient: the hemisphere light carries it, or only the ground bounce when the environment map does.
    const env = this.sky?.envTexture ?? null;
    host.scene.environment = env;
    // With the physical sky the map carries the ambient light (the hemisphere only tints the ground bounce); under the dome (Karl
    // fog, overcast, rain, smoke) and at night the hemisphere carries it, from the sky keys.
    const share = env ? (this.sky?.envShare ?? 0) * (1 - u.uNight) : 0;
    const hemiK = 1 - (1 - HEMI_WITH_ENV) * share;
    lights.hemi.intensity = HEMI_LOOK * hemiK * tune.hemi;
    // The keyed ambient is very blue (it stands for the whole sky): pulled toward its grey so shadows read as shade, not as blue paint.
    const amb = u.uAmbient;
    const lum = 0.2126 * amb[0] + 0.7152 * amb[1] + 0.0722 * amb[2];
    const grey = (c: number): number => c + (lum - c) * tune.desat;
    for (const h of [lights.hemi, backdrop.lights[0]]) {
      h.color.setRGB(grey(amb[0]) * 1.1, grey(amb[1]) * 1.1, grey(amb[2]) * 1.1);
      h.groundColor.setRGB(grey(amb[0]) * 0.45, grey(amb[1]) * 0.45, grey(amb[2]) * 0.42);
    }
    if (env) host.scene.environmentIntensity = (this.sky?.envIntensity ?? 1) * tune.env * share;
    this.o.materials.lookNodes.uEnv.value = env ? Math.min(1, tune.env * share * (this.sky?.envIntensity ?? 1)) : 0;

    if (this.sky) {
      const cam = host.camera;
      this.sky.update(u, input.weather, input.next, Math.max(0, Math.min(1, input.blend / 65535)), { x: cam.position.x, y: cam.position.y, z: cam.position.z }, nowMs);
    }
    // The façade glow: the same rule as the shader, for the report.
    const night = Math.max(0, Math.min(1, (u.uNight - 0.1) / 0.8));
    const smooth = night * night * (3 - 2 * night);
    this.lastWindow = Math.max(smooth, u.uWindowLit) * (1 - u.uBlackout * 0.85);
    this.o.materials.lookNodes.uWindowGlow.value = this.lastWindow;
  }

  /** Every frame, after the sky: the look clock, the shadow follow and the stack's shadow-pass count. */
  frame(dtSec: number, camera: PerspectiveCamera): void {
    if (!this.on) return;
    if (!this.clockFrozen) this.lookClock += dtSec;
    this.o.materials.setLookTime(this.lookClock);
    if (this.shadows) {
      this.shadows.update(camera, this.o.focus());
      if (this.stack) this.stack.shadowPasses = this.shadows.passes;
    }
  }

  /** Freezes the look clock (the waves and the physical sky's clouds): goldens need still pictures. */
  freezeClock(on: boolean): void {
    this.clockFrozen = on;
    this.sky?.freeze(on);
    this.o.freezeSkyTime?.(on);
  }

  /** The device was lost or the renderer swapped: the shadow object and the sky are made again. */
  onRendererReplaced(next: Parameters<ShadowRig['onRendererReplaced']>[0]): void {
    this.shadows?.onRendererReplaced(next);
    this.sky?.onRendererReplaced(next);
    if (this.stack && this.shadows) this.stack.shadowPasses = this.shadows.passes;
  }

  /** Holds a shot's camera. Until `groundY` is known the camera hangs `aglM` above sea level plus a safe height. */
  holdShot(id: string, groundY: number | null = null): LookShot {
    const s = lookShot(id);
    this.shotCamera = { x: s.x, y: (groundY ?? 40) + s.y, z: s.z, quat: shotQuaternion(s.yawDeg, s.pitchDeg), fovDeg: s.fovDeg };
    return s;
  }

  /** Moves the held camera to `groundY` plus the shot's height above ground. */
  placeShot(id: string, groundY: number): void {
    const s = lookShot(id);
    if (this.shotCamera) this.shotCamera.y = groundY + s.y;
  }

  releaseShot(): void {
    this.shotCamera = null;
  }

  report(): LookReport {
    const { host, tier, backend } = this.o;
    const on = this.on;
    const caster = on ? this.o.chunks.casterReport() : { count: 0, kinds: [] as string[] };
    return {
      profile: on ? this.profile : 'legacy',
      on,
      postNodes: on && this.stack ? [...this.stack.nodes] : [],
      postMode: on && this.stack ? this.stack.mode : 'none',
      postLevel: this.stack ? this.stack.effectiveLevel : 0,
      shadowMode: on && this.shadows ? this.shadows.mode : 'none',
      shadowPath: on && this.shadows ? this.shadows.path : 'off',
      shadowPasses: on && this.shadows ? this.shadows.passes : 0,
      casters: caster.count,
      casterKinds: caster.kinds,
      exposure: host.ready ? host.renderer.toneMappingExposure : 1,
      envMap: on && (this.sky?.envMapInUse ?? false),
      sky: on && this.sky ? 'physical' : 'dome',
      windowEmissive: on ? this.lastWindow : 0,
      backend,
      tier,
      fallbacks: [...this.fallbacks],
      pipeline: host.tier?.features.pipeline ?? 'render-pipeline',
      envBakes: this.sky?.report().bakes ?? 0,
      envBakeMs: this.sky?.report().lastBakeMs ?? 0,
      sun: on && this.state ? { intensity: this.state.intensity, color: this.state.color, moon: this.state.moon } : null,
    };
  }

  dispose(): void {
    this.teardown();
    this.o.chunks.look = null;
  }
}

export type { Light };
