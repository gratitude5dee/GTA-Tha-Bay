/**
 * Sun shadows (M02e) from `TierFeatures.shadows`:
 *
 *  - `csm3` (desktop tiers): `CSMShadowNode` (`three/addons/csm/CSMShadowNode.js`, three cascades, `maxFar` = `distanceM`) on the one
 *    `DirectionalLight` the sky drives, with the tier's map size per cascade;
 *  - `csm1` (mobile): one `DirectionalLight` shadow of `mapSize` fitted to `distanceM` around the player;
 *  - `blob` (mobile-low): no shadow map (no dynamic actor needs a blob yet), and `shadowsOff` tiers the same.
 *
 * Casters are the L0 `buildings` objects of the chunks within `casterRadiusM` (the chunk renderer flags them); terrain, roads and
 * vegetation only receive. `passes` is the cascade count the active shadow object reports: 3 with `CSMShadowNode`, 2 on the
 * `SunLight` fallback, 1 for the fitted cascade (`csm1` or the second fallback), 0 for `blob`, `shadowsOff` and `legacy`; the perf
 * meter counts it per caster.
 *
 * Fallbacks when `CSMShadowNode` is unusable, in order: `SunLight` (two fixed cascades in one 2 x 1 atlas, registered with
 * `renderer.library.addLight(SunLightNode, SunLight)` and registered again on renderer replacement), then one fitted
 * `DirectionalLight` cascade (reports 1). `onRendererReplaced` sets the shadow object up again, or device-loss recovery loses the
 * sun shadows.
 */
import type { DirectionalLight, Camera, Light, Scene, WebGPURenderer } from 'three/webgpu';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
import { SunLight } from 'three/addons/lights/SunLight.js';
import { SunLightNode } from 'three/addons/lights/SunLightNode.js';
import type { QualityTierId, ShadowMode, TierFeatures } from '@dv/shared';
import type { LookFile } from './config.ts';

export type ShadowPath = 'csm' | 'sunlight' | 'fitted' | 'blob' | 'off';

export interface ShadowRigOptions {
  scene: Scene;
  /** The sun the sky drives (a `DirectionalLight`; the `SunLight` fallback replaces it). */
  light: DirectionalLight;
  shadows: TierFeatures['shadows'];
  tier: QualityTierId;
  look: LookFile;
  renderer: WebGPURenderer;
  /** The order to try the cascaded paths in; the default is the spec's (CSMShadowNode, SunLight, a fitted cascade). */
  order?: readonly ShadowPath[];
  /** `look.json` `shadowsOff` and the QA switch. */
  disabled?: boolean;
}

/** Cascade count each path reports. */
export const PASSES: Readonly<Record<ShadowPath, number>> = { csm: 3, sunlight: 2, fitted: 1, blob: 0, off: 0 };

const CASCADES = 3;
/** The light margin of the cascades: casters this far toward the sun of the view still shadow it (towers on a low sun). */
const LIGHT_MARGIN_M = 320;
/** How far the sun sits from its target for the fitted cascade. */
const SUN_DISTANCE_M = 400;

export class ShadowRig {
  /** The mode the tier asks for. */
  readonly mode: ShadowMode | 'none';
  path: ShadowPath;
  /** Why a fallback was taken, or null. */
  fallbackReason: string | null = null;
  /** The sun light now in the scene (the `DirectionalLight`, or the `SunLight` fallback). */
  light: Light;

  private readonly o: ShadowRigOptions;
  private csm: CSMShadowNode | null = null;
  private readonly dirLight: DirectionalLight;
  private sunLight: SunLight | null = null;
  private lastCam = { near: 0, far: 0, aspect: 0, fov: 0 };
  private dir: [number, number, number] = [0.3, 0.8, 0.5];
  private disposed = false;

  constructor(o: ShadowRigOptions) {
    this.o = o;
    this.dirLight = o.light;
    this.light = o.light;
    const asked = o.disabled ? 'none' : o.shadows.mode;
    this.mode = asked;
    this.path = asked === 'none' ? 'off' : asked === 'blob' ? 'blob' : 'off';
    if (asked === 'csm3' || asked === 'csm1') this.setup(o.renderer);
    else o.renderer.shadowMap.enabled = false;
  }

  get passes(): number {
    return PASSES[this.path];
  }

  /** Whether meshes should receive shadows (a shadow map is in use). */
  get receiving(): boolean {
    return this.path === 'csm' || this.path === 'sunlight' || this.path === 'fitted';
  }

  /** Builds the shadow object for the current renderer: the cascaded paths in order, ending on the fitted cascade. */
  private setup(renderer: WebGPURenderer): void {
    const order: readonly ShadowPath[] = this.mode === 'csm1' ? ['fitted'] : (this.o.order ?? ['csm', 'sunlight', 'fitted']);
    renderer.shadowMap.enabled = true;
    let last: unknown = null;
    for (const p of order) {
      try {
        this.build(p, renderer);
        this.path = p;
        if (p !== order[0] && this.mode === 'csm3') this.fallbackReason = `fell back to ${p}: ${String((last as Error | null)?.message ?? last)}`;
        return;
      } catch (e) {
        last = e;
        this.teardown();
      }
    }
    this.path = 'off';
    this.fallbackReason = `no shadow path could be built: ${String((last as Error | null)?.message ?? last)}`;
    renderer.shadowMap.enabled = false;
  }

  private build(path: ShadowPath, renderer: WebGPURenderer): void {
    const { scene, shadows } = this.o;
    const size = shadows.mapSize || 1024;
    if (path === 'sunlight') {
      (renderer as unknown as { library: { addLight(node: unknown, light: unknown): void } }).library.addLight(SunLightNode, SunLight);
      const sun = new SunLight(this.dirLight.color, this.dirLight.intensity);
      sun.castShadow = true;
      // Two cascades share one atlas two cascades wide: the per-cascade size is the tier's map size.
      sun.shadow.mapSize.set(size * 2, size);
      this.sunLight = sun;
      scene.remove(this.dirLight);
      scene.add(sun);
      this.light = sun;
      this.place(this.dir);
      return;
    }
    const light = this.dirLight;
    light.castShadow = true;
    light.shadow.mapSize.set(size, size);
    light.shadow.bias = -0.0004;
    light.shadow.normalBias = 0.05;
    if (path === 'csm') {
      const csm = new CSMShadowNode(light, { cascades: CASCADES, maxFar: shadows.distanceM, mode: 'practical', lightMargin: LIGHT_MARGIN_M });
      light.shadow.shadowNode = csm as never;
      this.csm = csm;
    } else {
      // One fitted cascade: the box follows the focus (`update`).
      const half = Math.max(40, shadows.distanceM * 0.6);
      const cam = light.shadow.camera;
      cam.left = -half;
      cam.right = half;
      cam.top = half;
      cam.bottom = -half;
      cam.near = 1;
      cam.far = SUN_DISTANCE_M * 2.2;
      cam.updateProjectionMatrix();
      if (!light.target.parent) scene.add(light.target);
    }
    this.light = light;
  }

  private teardown(): void {
    const { scene } = this.o;
    if (this.csm) {
      (this.dirLight.shadow as unknown as { shadowNode: unknown }).shadowNode = null;
      this.csm.dispose();
      this.csm = null;
    }
    if (this.sunLight) {
      scene.remove(this.sunLight);
      this.sunLight.dispose();
      this.sunLight = null;
      if (!this.dirLight.parent) scene.add(this.dirLight);
    }
    this.dirLight.castShadow = false;
    this.light = this.dirLight;
  }

  /** Places the sun along `dir` (a unit vector toward the sun). The fitted cascade follows the focus; the others sit at the origin. */
  place(dir: readonly [number, number, number], focus?: { x: number; z: number }): void {
    this.dir = [dir[0], dir[1], dir[2]];
    const fx = this.path === 'fitted' && focus ? focus.x : 0;
    const fz = this.path === 'fitted' && focus ? focus.z : 0;
    const d = this.path === 'fitted' ? SUN_DISTANCE_M : 300;
    this.light.position.set(fx + dir[0] * d, dir[1] * d, fz + dir[2] * d);
    if (this.path === 'fitted') {
      this.dirLight.target.position.set(fx, 0, fz);
      this.dirLight.target.updateMatrixWorld();
    }
  }

  /** Once a frame: the cascades follow a changed camera lens, the fitted box follows the focus (snapped to the shadow texel). */
  update(camera: Camera, focus: { x: number; z: number }): void {
    if (this.disposed) return;
    const cam = camera as unknown as { near: number; far: number; aspect: number; fov: number };
    if (this.csm && (cam.near !== this.lastCam.near || cam.far !== this.lastCam.far || cam.aspect !== this.lastCam.aspect || cam.fov !== this.lastCam.fov)) {
      this.lastCam = { near: cam.near, far: cam.far, aspect: cam.aspect, fov: cam.fov };
      if (this.csm.camera) this.csm.updateFrustums();
    }
    if (this.path === 'fitted') {
      const half = (this.dirLight.shadow.camera.right - this.dirLight.shadow.camera.left) / 2;
      const texel = (half * 2) / this.dirLight.shadow.mapSize.width;
      const sx = Math.round(focus.x / texel) * texel, sz = Math.round(focus.z / texel) * texel;
      this.place(this.dir, { x: sx, z: sz });
    }
  }

  /** Device loss or an XR swap: the shadow object and the `SunLight` registration are made again on the new renderer. */
  onRendererReplaced(next: WebGPURenderer): void {
    this.teardown();
    this.csm = null;
    if (this.mode === 'csm3' || this.mode === 'csm1') {
      this.lastCam = { near: 0, far: 0, aspect: 0, fov: 0 };
      this.setup(next);
    }
  }

  setEnabled(on: boolean): void {
    if (on === (this.path !== 'off' && this.path !== 'blob')) return;
    this.teardown();
    if (on && (this.mode === 'csm3' || this.mode === 'csm1')) this.setup(this.o.renderer);
    else {
      this.path = this.mode === 'blob' ? 'blob' : 'off';
      this.o.renderer.shadowMap.enabled = false;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.teardown();
    this.o.renderer.shadowMap.enabled = false;
    this.path = 'off';
  }
}
