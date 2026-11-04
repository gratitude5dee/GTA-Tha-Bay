/**
 * The `desktop-ultra` atmosphere adapter (02-world-living.md section 6; M10d2): takram's precomputed atmospheric scattering in place of
 * M02e's `SkyMesh` physical sky, behind `AtmosphereAdapter`, the platform flag `world.atmosphere` (default off) and the governor's
 * `atmosphereLevel` 2. The M02b2 dome still blends over it. Removable: delete this file and `createAtmosphereAdapter` returns null.
 *
 * Fallback, never an error: on WebGL2 (`?gl=1` or the automatic fallback), when the library is not there, or when anything in `init`
 * rejects, the adapter disposes what it built, leaves the physical sky visible and reports `fallback` with the reason; no error
 * escapes and nothing is logged above `console.info`.
 *
 * The library: `@takram/three-atmosphere` (`/webgpu` entry: `AtmosphereContext`, `skyBackground`), MIT. Its r186 support is
 * UNVERIFIED (U-PLT-8) and is recorded by the M10d2 desktop review, never asserted. The package is not a dependency of this build
 * (BD-M10d2-05: its peer dependencies would install React and React Three Fiber into the workspace), so the default loader imports
 * it by a runtime specifier that resolves only where an operator build adds it, and every other build falls back. The one-layer
 * volumetric clouds of the section 6 matrix need takram's cloud package on the same terms and are not part of this adapter
 * (the painted and `SkyMesh` clouds stay).
 */
import { BackSide, Mesh, MeshBasicNodeMaterial, SphereGeometry, type Object3D, type Scene } from 'three/webgpu';
import type { QualityTierId, RenderBackend } from '@dv/shared';
import type { AtmosphereAdapter, SkyUniforms } from './types.ts';

/** What the adapter uses of the library's `/webgpu` entry (read in its 0.19.1 type declarations, U-PLT-8). */
export interface TakramModule {
  AtmosphereContext: new () => { sunDirectionECEF: { value: { set(x: number, y: number, z: number): unknown } }; dispose(): void };
  skyBackground: () => unknown;
}

/** The library's specifier; a build that installs it can resolve it, the others fall back. */
export const TAKRAM_SPECIFIER = '@takram/three-atmosphere/webgpu';

/** Imports the library at runtime without letting the bundler resolve it. */
export const defaultTakramLoader = (): Promise<TakramModule> => {
  const spec = TAKRAM_SPECIFIER;
  return import(/* @vite-ignore */ spec) as Promise<TakramModule>;
};

export type AtmosphereState = 'idle' | 'init' | 'on' | 'fallback' | 'disposed';

export interface AtmosphereStatus {
  state: AtmosphereState;
  /** Why the adapter fell back (`webgl2`, `library unavailable: …`, `init: …`), else null. */
  reason: string | null;
}

export interface TakramOptions {
  tier: QualityTierId;
  /** The backdrop scene that holds M02e's physical sky (`world.sky.physical`) and where the atmosphere sky goes. */
  scene: Scene;
  /** The renderer's backend once it is ready (`RendererHost.backend`). */
  backend: () => RenderBackend | null;
  /** Loads the library (tests pass a mock). */
  load?: () => Promise<TakramModule>;
  /** The radius of the sky sphere (the physical sky's box size). */
  radiusM?: number;
}

export const PHYSICAL_SKY_NAME = 'world.sky.physical';
export const ATMOSPHERE_SKY_NAME = 'world.sky.atmosphere';

export class TakramAtmosphere implements AtmosphereAdapter {
  private st: AtmosphereStatus = { state: 'idle', reason: null };
  private ctx: InstanceType<TakramModule['AtmosphereContext']> | null = null;
  private mesh: Mesh | null = null;
  private hidden: Object3D | null = null;

  constructor(private readonly o: TakramOptions) {
    if (o.tier !== 'desktop-ultra') throw new Error(`the atmosphere adapter is desktop-ultra only, not ${o.tier}`);
  }

  status(): AtmosphereStatus {
    return { ...this.st };
  }

  async init(renderer: unknown): Promise<void> {
    if (this.st.state !== 'idle') return;
    this.st = { state: 'init', reason: null };
    try {
      const backend = this.o.backend();
      if (backend !== 'webgpu') {
        this.fallback(backend === 'webgl2' ? 'webgl2' : 'no renderer');
        return;
      }
      let mod: TakramModule;
      try {
        mod = await (this.o.load ?? defaultTakramLoader)();
      } catch (e) {
        this.fallback(`library unavailable: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      if (this.st.state !== 'init') return; // disposed meanwhile
      if (typeof mod.AtmosphereContext !== 'function' || typeof mod.skyBackground !== 'function') throw new Error('the library has no AtmosphereContext or skyBackground');
      const ctx = new mod.AtmosphereContext();
      this.ctx = ctx;
      // The library's nodes find their context through the renderer's node context (`getAtmosphere`).
      const r = renderer as { contextNode?: unknown };
      const tsl = (await import('three/tsl')) as unknown as { context?: (v: unknown) => unknown };
      if (typeof tsl.context !== 'function' || !r || typeof r !== 'object') throw new Error('the renderer has no node context');
      r.contextNode = tsl.context({ getAtmosphere: () => ctx });
      const mat = new MeshBasicNodeMaterial({ side: BackSide, depthWrite: false });
      (mat as unknown as { colorNode: unknown }).colorNode = mod.skyBackground();
      const mesh = new Mesh(new SphereGeometry(this.o.radiusM ?? 100_000, 32, 16), mat);
      mesh.name = ATMOSPHERE_SKY_NAME;
      mesh.frustumCulled = false;
      mesh.renderOrder = -1100;
      this.mesh = mesh;
      this.o.scene.add(mesh);
      const physical = this.o.scene.getObjectByName(PHYSICAL_SKY_NAME) ?? null;
      if (physical) {
        physical.visible = false;
        this.hidden = physical;
      }
      this.st = { state: 'on', reason: null };
    } catch (e) {
      this.fallback(`init: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  update(env: Readonly<SkyUniforms>): void {
    if (this.st.state !== 'on' || !this.ctx) return;
    // ENU (x east, y up, z south) to the library's ECEF frame at the origin is the world matrix's job; the sun direction is passed in
    // world space and the context's default matrices (identity) keep it there.
    const d = env.uSunDir;
    this.ctx.sunDirectionECEF.value.set(d[0], d[1], d[2]);
  }

  /** Back to M02e's sky: everything built is disposed and the physical sky is shown again. */
  private fallback(reason: string): void {
    this.teardown();
    this.st = { state: 'fallback', reason };
    console.info(`world.atmosphere: falling back to the physical sky (${reason})`);
  }

  private teardown(): void {
    if (this.mesh) {
      this.mesh.removeFromParent();
      this.mesh.geometry.dispose();
      (this.mesh.material as { dispose(): void }).dispose();
      this.mesh = null;
    }
    if (this.hidden) {
      this.hidden.visible = true;
      this.hidden = null;
    }
    try {
      this.ctx?.dispose();
    } catch {
      // a half-built context may fail to dispose; nothing else holds it
    }
    this.ctx = null;
  }

  dispose(): void {
    this.teardown();
    this.st = { state: 'disposed', reason: this.st.reason };
  }
}
