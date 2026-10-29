/**
 * The physically based day sky (M02e, `full` profile only): `SkyMesh` (`three/addons/objects/SkyMesh.js`, TSL, the Preetham model)
 * behind the M02b2 dome. It is driven by `uSunDir`, the preset's `turbidity` and `rayleigh` (look.json) and `cloudCover` from the sky
 * keys. The M02b2 dome keeps the stars, the moon and the night and is blended over it with `w = max(uNight, keyframeWeight[preset])`,
 * so fog, overcast, rain and smoke stay close to the authored keys and a clear day is the physical sky.
 *
 * Environment: a `PMREMGenerator` map of the sky, re-generated only under M02b2's probe rule (the sun moved more than 0.006 rad, the
 * darkness more than 0.04, at most every 200 ms). The re-bake is the one offscreen render allowed besides the one
 * `RenderPipeline.render()` per frame (11-platform.md 5.7, WebKit bug 303203), bounded by that cadence and never on WebKit: with
 * `browser === 'safari'` the `full` profile falls back to the hemisphere light (`envMap: false`).
 */
import { PMREMGenerator, Scene, type Mesh, type Texture, type WebGPURenderer } from 'three/webgpu';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { clamp, uniform as uniformNode } from 'three/tsl';
import { SkyProbe } from '../sky/probe.ts';
import type { SkyPresetId, SkyUniforms } from '../sky/types.ts';
import type { LookFile } from './config.ts';
import type { U } from '../sky/tsl.ts';

const uniform = <V>(v: V): U<V> => uniformNode(v as never) as unknown as U<V>;

/** Scale of the sky box: inside the backdrop camera's far plane, around the camera. */
const SKY_BOX_M = 90_000;
/** Strength of the sky's light as an environment map. */
const ENV_INTENSITY = 1.0;
/**
 * `SkyMesh` writes radiance for a display with exposure about 0.5 (its own `0.04` factor): up to 3 in the blue channel on a clear
 * day and 60,000 in the sun disc, which a half float target and a bloom threshold of 1 cannot take. The look scales it to the range of
 * the authored dome (a clear zenith about the dome's blue) and caps the disc.
 */
export const SKY_SCALE = 0.3;
export const SKY_MAX = 6;

export interface PhysicalSkyOptions {
  /** The backdrop scene the sky mesh joins (the world pass has no sky). */
  backdrop: Scene;
  renderer: WebGPURenderer;
  look: LookFile;
  /** False on WebKit (bug 303203): the hemisphere light stands in and no PMREM render ever runs. */
  envMap: boolean;
}

export interface PhysicalSkyReport {
  /** Whether an environment map is in use. */
  envMap: boolean;
  /** Environment bakes done. */
  bakes: number;
  /** Duration of the last bake, milliseconds (0 if none). */
  lastBakeMs: number;
}

/** The weight of the M02b2 dome over the physical sky for a preset pair. */
export function domeWeight(look: LookFile, night: number, weather: SkyPresetId, next: SkyPresetId, blend01: number): number {
  const a = Math.max(night, look.sky.keyframeWeight[weather]);
  const b = Math.max(night, look.sky.keyframeWeight[next]);
  return Math.min(1, a + (b - a) * blend01);
}

export class PhysicalSky {
  readonly mesh: SkyMesh;
  /** The weight of the dome (a uniform node the dome's opacity reads). */
  readonly domeBlend = uniform(1);
  envTexture: Texture | null = null;
  /** QA: forces the dome weight (1 = dome only, 0 = physical sky only); null follows the keys. */
  forceBlend: number | null = null;

  private readonly o: PhysicalSkyOptions;
  private readonly envScene: Scene | null;
  private readonly envSky: SkyMesh | null;
  private pmrem: PMREMGenerator | null = null;
  private readonly probe: SkyProbe;
  private bakes = 0;
  private lastBakeMs = 0;
  private lastU: SkyUniforms | null = null;
  private lastParams = { turbidity: 2, rayleigh: 1, cover: 0.3 };
  private frozen = false;

  constructor(o: PhysicalSkyOptions) {
    this.o = o;
    this.mesh = this.makeSky();
    o.backdrop.add(this.mesh as unknown as Mesh);
    this.probe = new SkyProbe(() => this.bake());
    if (o.envMap) {
      this.envScene = new Scene();
      this.envSky = this.makeSky();
      this.envSky.showSunDisc.value = 0;
      this.envScene.add(this.envSky as unknown as Mesh);
      this.pmrem = new PMREMGenerator(o.renderer);
    } else {
      this.envScene = null;
      this.envSky = null;
    }
  }

  private makeSky(): SkyMesh {
    const sky = new SkyMesh();
    sky.scale.setScalar(SKY_BOX_M);
    sky.frustumCulled = false;
    sky.renderOrder = -1100;
    sky.name = 'world.sky.physical';
    const mat = sky.material as unknown as { colorNode: unknown };
    mat.colorNode = clamp((mat.colorNode as { mul(s: number): unknown }).mul(SKY_SCALE) as never, 0, SKY_MAX);
    sky.mieCoefficient.value = 0.004;
    sky.mieDirectionalG.value = 0.82;
    return sky;
  }

  /**
   * How much of the environment map the light rig uses: the physical sky's share of the picture (1 on a clear day, 0 under the dome's
   * Karl fog or overcast, whose sky the physical model does not draw). Where the map is not used the hemisphere light carries the ambient.
   */
  get envShare(): number {
    return 1 - this.domeBlend.value;
  }

  get envMapInUse(): boolean {
    return this.o.envMap && this.envTexture !== null;
  }

  /** Stops the cloud drift (the look clock of `shot()`): clouds move from the TSL `time` node, so the speed goes to zero. */
  freeze(on: boolean): void {
    this.frozen = on;
    this.mesh.cloudSpeed.value = on ? 0 : 0.00002;
    if (this.envSky) this.envSky.cloudSpeed.value = on ? 0 : 0.00002;
  }

  /**
   * QA readback (`sampleLuma`): the clouds' offset is `time * cloudSpeed`, so a zero speed draws them at the clock's origin whatever
   * the page time. Returns the function that puts the speed back (BD-FIX-CI2-02).
   */
  pinClouds(): () => void {
    const prev = this.mesh.cloudSpeed.value;
    this.mesh.cloudSpeed.value = 0;
    return () => {
      this.mesh.cloudSpeed.value = prev;
    };
  }

  /** One frame: the preset's air, the sun, the clouds and the dome's weight. */
  update(u: Readonly<SkyUniforms>, weather: SkyPresetId, next: SkyPresetId, blend01: number, camPos: { x: number; y: number; z: number }, nowMs: number): void {
    const { look } = this.o;
    const mix = (a: number, b: number): number => a + (b - a) * blend01;
    const turbidity = mix(look.sky.turbidity[weather], look.sky.turbidity[next]);
    const rayleigh = mix(look.sky.rayleigh[weather], look.sky.rayleigh[next]);
    const cover = Math.max(0, Math.min(1, u.uCloud));
    for (const s of this.skies()) {
      s.turbidity.value = turbidity;
      s.rayleigh.value = rayleigh;
      s.sunPosition.value.set(u.uSunDir[0], u.uSunDir[1], u.uSunDir[2]);
      s.cloudCoverage.value = cover;
    }
    this.lastParams = { turbidity, rayleigh, cover };
    this.mesh.position.set(camPos.x, camPos.y, camPos.z);
    this.domeBlend.value = this.forceBlend ?? domeWeight(look, u.uNight, weather, next, blend01);
    this.lastU = u as SkyUniforms;
    if (this.o.envMap) {
      const pair = `${weather}>${next}`;
      if (pair !== this.lastPair) {
        this.lastPair = pair;
        this.probe.invalidate();
      }
      this.probe.update(u, nowMs);
    }
  }

  private lastPair = '';

  /**
   * QA shots (`WorldBridge.shot`): the next frame bakes the environment from the sky as it is then. The probe rule watches the sun and the
   * darkness; the cloud cover and the air go on easing after the sun has stopped, so a map baked in that stretch lights the ground differently
   * from one baked on the settled sky, and which one a golden got depended on the speed of the machine (BD-REPAIR-M02g2-02).
   */
  refreshEnvironment(): void {
    if (this.o.envMap) this.probe.invalidate();
  }

  private skies(): SkyMesh[] {
    return this.envSky ? [this.mesh, this.envSky] : [this.mesh];
  }

  /** Re-generates the environment from the sky as it is now. */
  private bake(): void {
    if (!this.pmrem || !this.envScene) return;
    const t0 = performance.now();
    try {
      const prev = this.envTexture;
      const rt = this.pmrem.fromScene(this.envScene, 0, 1, 200_000);
      this.envTexture = rt.texture;
      void prev;
      this.bakes++;
      this.lastBakeMs = performance.now() - t0;
    } catch (e) {
      // A failed bake leaves the last map (or none: the hemisphere light still lights the city).
      console.warn('sky environment bake failed', e);
    }
  }

  report(): PhysicalSkyReport {
    return { envMap: this.envMapInUse, bakes: this.bakes, lastBakeMs: this.lastBakeMs };
  }

  /** Environment intensity for `scene.environmentIntensity`. */
  get envIntensity(): number {
    return ENV_INTENSITY;
  }

  get params(): { turbidity: number; rayleigh: number; cover: number } {
    return this.lastParams;
  }

  get isFrozen(): boolean {
    return this.frozen;
  }

  get uniforms(): SkyUniforms | null {
    return this.lastU;
  }

  /** The renderer was replaced (device loss, XR swap): the generator and the map are made again from the next bake. */
  onRendererReplaced(next: WebGPURenderer): void {
    this.pmrem?.dispose();
    this.envTexture = null;
    if (this.o.envMap) this.pmrem = new PMREMGenerator(next);
    this.probe.invalidate();
  }

  dispose(): void {
    // The dome stays on after this (the legacy sky): its weight goes back to 1.
    this.domeBlend.value = 1;
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as { dispose(): void }).dispose();
    this.envSky?.geometry.dispose();
    (this.envSky?.material as { dispose(): void } | undefined)?.dispose();
    this.pmrem?.dispose();
    this.envTexture = null;
  }
}
