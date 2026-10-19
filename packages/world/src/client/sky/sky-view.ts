/**
 * SkyView: the page half of the day, the night and the weather (M02b2). It mounts on the world path only (a Preview build is
 * world-less and never creates one) and each frame
 *
 *  1. reads the sim's `EnvState` and the blackout flag from the engine's world frame;
 *  2. evaluates the keyframed sky (`evaluateSky`), which is pure, and writes the shared uniform nodes;
 *  3. moves the dome with the camera, drives the world and backdrop lights, the fog, the exposure, the rain and the wet look;
 *  4. re-bakes the sky probe when the sun or the darkness moved enough (probe-grid tiers) and refreshes the street lamps.
 *
 * Everything is TSL and works on both backends. The feature matrix of the tier is data (tiers.ts); the governor's
 * `atmosphereLevel` is honoured through `setAtmosphereLevel`.
 */
import {
  Color, PerspectiveCamera, RenderTarget, UnsignedByteType, type DirectionalLight, type HemisphereLight, type Mesh, type Scene,
} from 'three/webgpu';
import type { WorldFrame } from '@dv/engine/client/boot/world-layer';
import type { RendererHost } from '@dv/engine/platform/renderer-host';
import type { QualityTierId } from '@dv/shared';
import { createAtmosphereAdapter } from './atmosphere.ts';
import { centreDome, createDome } from './dome.ts';
import { createBackdropFog, createWorldFog } from './fog.ts';
import { NightLights, BLACKOUT_WINDOW_FACTOR, headlightsOn } from './night.ts';
import { writeSkyNodes, type SkyNodes } from './nodes.ts';
import { SkyProbe } from './probe.ts';
import { createRainOverlay, createRainStreaks, type RainOverlay, type RainStreaks } from './rain.ts';
import { SKY_KEYS, evaluateSky, sunDirection } from './sky-keys.ts';
import { skyConfigFor, type SkyConfig } from './tiers.ts';
import type { L } from './tsl.ts';
import type { AtmosphereAdapter, SkyInput, SkyPresetId, SkyUniforms } from './types.ts';

/** The day the sky shows before the first snapshot carries an `EnvState`. */
const DEFAULT_INPUT: SkyInput = { hour: 9, night: 0, dark: 0, weather: 'clear', next: 'clear', blend: 0, fogBankM: 0, rain: 0, wet: 0, blackout: false };

/** The light of the world pass when the sky is off or has not started (the M02b1 look). */
const STATIC_SUN = { color: 0xfff1d6, intensity: 2.8, x: 120, y: 220, z: 80 };

/** Intensity of the sun light at full strength, and of the hemisphere light per unit of ambient. */
export const SUN_INTENSITY = 2.8;
export const HEMI_INTENSITY = 3.4;
export const MOON_INTENSITY = 0.55;
/** Wetness rises over about six seconds of rain and dries over about ninety. */
const WET_RISE_S = 6;
const WET_DRY_S = 90;
/** The lamp set is refreshed this often, milliseconds. */
const LAMP_REFRESH_MS = 500;

export interface SkyViewOptions {
  host: RendererHost;
  nodes: SkyNodes;
  tier: QualityTierId;
  /** The governor's `atmosphereLevel`; defaults to the tier's ceiling. */
  atmosphereLevel?: number;
  /** The world-pass lights the sky drives. */
  lights: { hemi: HemisphereLight; sun: DirectionalLight };
  /** The backdrop pass: its scene and camera, and its lights. */
  backdrop: { scene: Scene; camera: PerspectiveCamera; hemi: HemisphereLight; sun: DirectionalLight };
  /** `config/platform-flags.json`: `world.rain` (default true) and `world.atmosphere` (default false). */
  flags: { rain: boolean; atmosphere: boolean };
  /** Lamp positions (world x, y, z triples) of the resident L0 chunks, asked at most every half second. */
  lamps: () => Float32Array;
  /** Starts with the sky off (the `?sky=0` cost comparison of QA builds). */
  disabled?: boolean;
  now?: () => number;
  /**
   * M02e: the look pass. `domeBlend` is the weight of the dome over the physical sky (absent: the dome alone, as in M02b2); `after`
   * runs once a frame after the sky wrote its lights and exposure, and may override them.
   */
  look?: { domeBlend: unknown; after(u: Readonly<SkyUniforms>, input: Readonly<SkyInput>, nowMs: number): void };
}

export interface SkyInfo {
  enabled: boolean;
  tier: QualityTierId;
  level: number;
  config: SkyConfig;
  uniforms: SkyUniforms;
  /** `1 - uBlackout * (1 - 0.15)`: the share of the window glow left. */
  windowFactor: number;
  headlights: boolean;
  hour: number;
  weather: SkyPresetId;
  next: SkyPresetId;
  wet: number;
  rainOverride: number | null;
  probeBakes: number;
  lamps: number;
  decals: number;
  streaksDrawn: number;
  overlay: boolean;
  /** Render objects the sky adds to a frame: dome, rain, overlay, lamps, halos, decals as mounted. */
  objects: number;
}

export interface LumaSample {
  mean: number;
  variance: number;
  width: number;
  height: number;
  /** RGBA bytes of the target (QA inspection), only when asked for. */
  pixels?: number[];
}

export interface LumaOptions {
  /** `sky`: the backdrop pass only (the dome, the far ring); `all` (default): the backdrop and the world pass. */
  passes?: 'sky' | 'all';
  /** Return the pixels too. */
  pixels?: boolean;
  /** Lift the camera this many metres above the player's camera (a city overview for the fog gate). */
  heightM?: number;
}

export class SkyView {
  config: SkyConfig;
  readonly nodes: SkyNodes;

  private readonly o: SkyViewOptions;
  private readonly dome: Mesh;
  private streaks: RainStreaks | null = null;
  private overlay: RainOverlay | null = null;
  private readonly night: NightLights;
  private readonly probe: SkyProbe;
  private adapter: AtmosphereAdapter | null = null;
  private enabled: boolean;
  private uniforms: SkyUniforms;
  private input: SkyInput = DEFAULT_INPUT;
  private wet = 0;
  private rainOverride: number | null = null;
  private lastNow = -1;
  private lastLampMs = Number.NEGATIVE_INFINITY;
  private lastPair = '';
  private readonly color = new Color();
  private probeRig: { rt: RenderTarget; cam: PerspectiveCamera; bcam: PerspectiveCamera } | null = null;

  constructor(o: SkyViewOptions) {
    this.o = o;
    this.nodes = o.nodes;
    this.config = skyConfigFor(o.tier, o.atmosphereLevel);
    this.enabled = !o.disabled;
    this.uniforms = evaluateSky(SKY_KEYS, DEFAULT_INPUT);

    this.dome = createDome(o.nodes, this.config.clouds, (o.look?.domeBlend ?? undefined) as L | undefined);
    o.backdrop.scene.add(this.dome);
    o.backdrop.scene.background = null;

    this.night = new NightLights({
      nodes: o.nodes,
      parent: o.host.scene,
      decalCap: this.config.decalCap,
      maxLamps: this.config.tier === 'desktop' || this.config.tier === 'desktop-ultra' ? 1400 : this.config.tier === 'mobile' || this.config.tier === 'xr-visionpro' ? 700 : 350,
      radiusM: this.config.tier === 'desktop' || this.config.tier === 'desktop-ultra' ? 700 : 380,
    });
    this.mountRain();

    this.probe = new SkyProbe((u) => this.bakeAmbient(u));
    this.adapter = createAtmosphereAdapter({ enabled: o.flags.atmosphere, level: this.config.level });
    void this.adapter?.init(o.host.renderer);
    this.applyEnabled();
  }

  private mountRain(): void {
    const c = this.config;
    this.streaks?.mesh.removeFromParent();
    this.overlay?.mesh.removeFromParent();
    this.streaks?.dispose();
    this.overlay?.dispose();
    this.streaks = null;
    this.overlay = null;
    if (!this.o.flags.rain) return;
    if (c.rain.style !== 'none' && c.rain.streaks > 0) {
      this.streaks = createRainStreaks(this.nodes, c.rain.streaks, c.rain.style);
      this.o.host.scene.add(this.streaks.mesh);
    }
    if (c.rain.overlay) {
      this.overlay = createRainOverlay(this.nodes);
      this.o.host.scene.add(this.overlay.mesh);
    }
  }

  /** The governor moved `atmosphereLevel`: rebuild what depends on it (clouds, streak counts, decals). */
  setAtmosphereLevel(level: number): void {
    const next = skyConfigFor(this.o.tier, level);
    if (next.level === this.config.level) return;
    this.config = next;
    this.mountRain();
    this.night.setDecalCap(next.decalCap);
  }

  /** Forces the rain intensity (0..255) whatever the weather says; null returns to the preset (QA debug panel). */
  setRainOverride(rain: number | null): void {
    this.rainOverride = rain === null ? null : Math.max(0, Math.min(255, rain));
  }

  getRainOverride(): number | null {
    return this.rainOverride;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.applyEnabled();
  }

  private applyEnabled(): void {
    const { scene, host } = { scene: this.o.backdrop.scene, host: this.o.host };
    this.dome.visible = this.enabled;
    this.night.setVisible(this.enabled);
    if (this.streaks) this.streaks.mesh.visible = this.enabled && this.streaks.mesh.visible;
    if (this.overlay) this.overlay.mesh.visible = this.enabled && this.overlay.mesh.visible;
    (scene as unknown as { fogNode: unknown }).fogNode = this.enabled ? createBackdropFog(this.nodes) : null;
    (host.scene as unknown as { fogNode: unknown }).fogNode = this.enabled ? createWorldFog(this.nodes, this.config.fog) : null;
    if (!this.enabled) this.restoreStaticLights();
  }

  private restoreStaticLights(): void {
    const { hemi, sun } = this.o.lights;
    hemi.color.set(0xdbe9ff);
    hemi.groundColor.set(0x6a6f64);
    hemi.intensity = 3.4;
    sun.color.set(STATIC_SUN.color);
    sun.intensity = STATIC_SUN.intensity;
    sun.position.set(STATIC_SUN.x, STATIC_SUN.y, STATIC_SUN.z);
    const b = this.o.backdrop;
    b.sun.position.set(STATIC_SUN.x, STATIC_SUN.y, STATIC_SUN.z);
    b.sun.color.set(STATIC_SUN.color);
    b.hemi.color.set(0xdbe9ff);
    b.hemi.intensity = 3.4;
    this.o.host.renderer.toneMappingExposure = 1;
  }

  /** One frame. Call after the backdrop camera has been synced to the world camera. */
  update(f: WorldFrame): void {
    if (!this.enabled) return;
    const nowMs = (this.o.now ?? (() => performance.now()))();
    const dt = this.lastNow < 0 ? 0 : Math.min(1, (nowMs - this.lastNow) / 1000);
    this.lastNow = nowMs;

    const env = f.env;
    const rainRaw = Math.max(env?.rain ?? 0, this.rainOverride ?? 0);
    const target = rainRaw / 255;
    const k = dt <= 0 ? 0 : target > this.wet ? Math.min(1, dt / WET_RISE_S) : Math.min(1, dt / WET_DRY_S);
    this.wet += (target - this.wet) * k;

    this.input = env
      ? {
          hour: env.hour, night: env.night, dark: env.dark, weather: env.weather, next: env.next, blend: env.blend, fogBankM: env.fogBankM,
          rain: rainRaw, wet: this.wet, blackout: f.blackout,
        }
      : { ...DEFAULT_INPUT, rain: rainRaw, wet: this.wet, blackout: f.blackout };
    const u = evaluateSky(SKY_KEYS, this.input);
    this.uniforms = u;

    const c = this.config;
    writeSkyNodes(this.nodes, u, { wetScale: c.wetness === 'none' ? 0 : 1, wetRough: c.wetRoughness, bankTopM: this.input.fogBankM });
    this.nodes.uTime.value = f.nowMs / 1000;
    const cam = this.o.host.camera as PerspectiveCamera;
    this.nodes.uCamPos.value.set(cam.position.x, cam.position.y, cam.position.z);

    // The dome follows the backdrop camera; the fog colour and the exposure follow the keys.
    centreDome(this.dome, this.o.backdrop.camera.position);
    this.o.host.renderer.toneMappingExposure = u.uExposure;
    this.driveLights(u);

    // The probe tiers re-bake the ambient light rarely; the desktop tiers follow every frame.
    const pair = `${this.input.weather}>${this.input.next}`;
    if (pair !== this.lastPair) {
      this.lastPair = pair;
      this.probe.invalidate();
    }
    if (c.lighting === 'probe-grid') this.probe.update(u, nowMs);
    else this.bakeAmbient(u);
    this.adapter?.update(u);
    this.o.look?.after(u, this.input, nowMs);

    // Rain: streak count scales with the intensity, the overlay with the tier.
    const rainK = u.uRain;
    this.streaks?.setAmount(rainK);
    if (this.overlay) {
      this.overlay.mesh.visible = rainK > 0.003;
      if (this.overlay.mesh.visible) this.overlay.follow(cam);
    }

    if (nowMs - this.lastLampMs >= LAMP_REFRESH_MS) {
      this.lastLampMs = nowMs;
      this.night.setLamps(this.o.lamps(), cam.position);
    }
  }

  /** The sun, or the moon at night, as the one directional light. */
  private driveLights(u: SkyUniforms): void {
    const { sun } = this.o.lights;
    const bsun = this.o.backdrop.sun;
    const sd = u.uSunDir;
    const sunUp = smooth(-0.02, 0.12, sd[1]);
    const moonUp = smooth(-0.02, 0.12, -sd[1]) * u.uNight;
    const useSun = sunUp > 0.001 || moonUp <= 0.001;
    const dir: [number, number, number] = useSun ? sd : [-sd[0], -sd[1], -sd[2]];
    sun.position.set(dir[0] * 300, dir[1] * 300, dir[2] * 300);
    bsun.position.set(dir[0] * 300, dir[1] * 300, dir[2] * 300);
    if (useSun) {
      this.color.setRGB(u.uSunColor[0], u.uSunColor[1], u.uSunColor[2]);
      sun.color.copy(this.color);
      sun.intensity = SUN_INTENSITY * sunUp;
    } else {
      sun.color.setRGB(0.55, 0.65, 1.0);
      sun.intensity = MOON_INTENSITY * moonUp;
    }
    bsun.color.copy(sun.color);
    bsun.intensity = sun.intensity;
  }

  /** Writes the sky-derived ambient into the hemisphere lights (the "probe" of the probe-grid tiers). */
  private bakeAmbient(u: Readonly<SkyUniforms>): void {
    for (const h of [this.o.lights.hemi, this.o.backdrop.hemi]) {
      h.color.setRGB(u.uAmbient[0] * 1.1, u.uAmbient[1] * 1.1, u.uAmbient[2] * 1.1);
      h.groundColor.setRGB(u.uAmbient[0] * 0.45, u.uAmbient[1] * 0.45, u.uAmbient[2] * 0.42);
      h.intensity = HEMI_INTENSITY;
    }
  }

  // ---- QA --------------------------------------------------------------------------------------------------------------------

  info(): SkyInfo {
    const u = this.uniforms;
    return {
      enabled: this.enabled,
      tier: this.o.tier,
      level: this.config.level,
      config: this.config,
      uniforms: u,
      windowFactor: 1 - u.uBlackout * (1 - BLACKOUT_WINDOW_FACTOR),
      headlights: headlightsOn(u.uDark),
      hour: this.input.hour,
      weather: this.input.weather,
      next: this.input.next,
      wet: this.wet,
      rainOverride: this.rainOverride,
      probeBakes: this.probe.bakes,
      lamps: this.night.poleCount,
      decals: this.night.decalCount,
      streaksDrawn: this.streaks ? Math.floor(this.streaks.capacity * u.uRain) : 0,
      overlay: this.overlay?.mesh.visible ?? false,
      objects: this.mountedObjects(),
    };
  }

  private mountedObjects(): number {
    if (!this.enabled) return 0;
    return 1 + this.night.objects + (this.streaks?.mesh.visible ? 1 : 0) + (this.overlay?.mesh.visible ? 1 : 0);
  }

  /** The evaluated uniforms of the last frame. */
  current(): SkyUniforms {
    return this.uniforms;
  }

  /** The hour the sky would show for the sim's clock; useful where only the pure result is needed. */
  sunDirection(hour = this.input.hour): [number, number, number] {
    return sunDirection(hour);
  }

  /**
   * Renders the backdrop and world passes into a 128 x 72 target from the player's camera position, looking `pitchDeg` up (negative
   * down) along `yawDeg`, and reads it back: the mean and the variance of the linear luminance (the target is not tone mapped, so the
   * values are the scene's linear light). The readback gates of the `@world-sky` e2e use it; call it between frames.
   */
  async sampleLuma(pitchDeg: number, yawDeg = 0, opts: LumaOptions = {}, size: { w: number; h: number } = { w: 128, h: 72 }): Promise<LumaSample> {
    const { host, backdrop } = this.o;
    const r = host.renderer;
    const main = host.camera as PerspectiveCamera;
    // The target and the two cameras are kept between calls: a fresh target would compile its pipelines again every time.
    const probe = (this.probeRig ??= { rt: new RenderTarget(size.w, size.h, { type: UnsignedByteType, depthBuffer: true }), cam: new PerspectiveCamera(60, size.w / size.h, main.near, main.far), bcam: backdrop.camera.clone() });
    const { rt, cam, bcam } = probe;
    cam.near = main.near;
    cam.far = main.far;
    cam.position.copy(main.position);
    cam.position.y += opts.heightM ?? 0;
    const yaw = (yawDeg * Math.PI) / 180, pitch = (pitchDeg * Math.PI) / 180;
    cam.lookAt(cam.position.x - Math.sin(yaw) * Math.cos(pitch), cam.position.y + Math.sin(pitch), cam.position.z - Math.cos(yaw) * Math.cos(pitch));
    cam.updateMatrixWorld();
    bcam.near = backdrop.camera.near;
    bcam.far = backdrop.camera.far;
    bcam.position.copy(cam.position);
    bcam.quaternion.copy(cam.quaternion);
    bcam.aspect = cam.aspect;
    bcam.fov = cam.fov;
    bcam.updateProjectionMatrix();
    bcam.updateMatrixWorld();
    const prevAuto = r.autoClearColor;
    try {
      r.setRenderTarget(rt);
      r.render(backdrop.scene, bcam);
      if (opts.passes !== 'sky') {
        r.autoClearColor = false;
        r.render(host.scene, cam);
      }
      r.autoClearColor = prevAuto;
      r.setRenderTarget(null);
      const data = (await r.readRenderTargetPixelsAsync(rt, 0, 0, size.w, size.h)) as Uint8Array;
      let sum = 0, sum2 = 0;
      const n = size.w * size.h;
      for (let i = 0; i < n; i++) {
        const l = (0.2126 * (data[i * 4] as number) + 0.7152 * (data[i * 4 + 1] as number) + 0.0722 * (data[i * 4 + 2] as number)) / 255;
        sum += l;
        sum2 += l * l;
      }
      const mean = sum / n;
      return { mean, variance: Math.max(0, sum2 / n - mean * mean), width: size.w, height: size.h, ...(opts.pixels ? { pixels: Array.from(data) } : {}) };
    } finally {
      r.autoClearColor = prevAuto;
      r.setRenderTarget(null);
    }
  }

  dispose(): void {
    this.adapter?.dispose();
    this.dome.removeFromParent();
    this.dome.geometry.dispose();
    (this.dome.material as { dispose(): void }).dispose();
    this.streaks?.mesh.removeFromParent();
    this.streaks?.dispose();
    this.overlay?.mesh.removeFromParent();
    this.overlay?.dispose();
    this.night.dispose();
    this.probeRig?.rt.dispose();
    (this.o.backdrop.scene as unknown as { fogNode: unknown }).fogNode = null;
    (this.o.host.scene as unknown as { fogNode: unknown }).fogNode = null;
  }
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

