/**
 * Surface textures (M10d0, DL-OWN-07): tiled PBR sets on the ground and road surfaces of the look.
 *
 * `SurfaceTextures` owns one `texture(...)` node per set and map (a 1 x 1 stand-in until the KTX2 file is in), one `ready` uniform per set
 * and the loading: after the first playable it asks asset.worker for the tier's variants (`world.texture`), transcodes them (`ktx2.ts`),
 * keeps the transcoded bytes under the tier's budget (dropping the top mip, never raising the budget) and swaps each texture into its
 * node. The materials are built once, before any of that: a surface whose set is not ready draws what the procedural look draws.
 *
 * `withSurfaceTextures(surface, nodes)` is the one function the look materials call (the fenced art hook of look-materials.ts). It
 * returns `nodes` unchanged when textures are off or no surface is bound. Otherwise each map is read in a branch on the surface id, so a
 * fragment samples only its own set (three taps per map on `full`, two on `lite`, albedo alone on `min`), always at an explicit mip level
 * so the branch needs no derivatives, and the texture fades into the procedural colour with distance.
 */
import { Fn, cameraViewMatrix, texture as tslTexture, uniform } from 'three/tsl';
import { DataTexture, LinearFilter, RGBAFormat, UnsignedByteType, type Texture, type WebGPURenderer } from 'three/webgpu';
import type { QualityTierId, RenderBackend } from '@dv/shared';
import { cameraPosition, float, If, log2, mix, normalize, positionWorld, smoothstep, step, vec2, vec3, vec4, type L } from '../sky/tsl.ts';
import type { LookProfile } from '../look/config.ts';
import { luma, pixelFootprint } from '../look/noise.ts';
import { SURFACE_NAMES } from '../look/surfaces.ts';
import { tapsOf, tiledSample, type TileSampler } from '../look/tiling.ts';
import {
  SURFACE_TEXTURES, TIER_VARIANT, backendUnsupported, boundSets, idsOfSet, mapsOf, refOf, refsFor, textureModeFor,
  type MapName, type SurfaceTexturesFile, type TextureMode,
} from './config.ts';
import { Ktx2Decoder, dropTopMip, formatName, textureBytes } from './ktx2.ts';
import type { TextureJobResult } from './texture-job.ts';

const MIB = 1024 * 1024;
const SIZE_OF_VARIANT = { desktop: 1024, mobile: 512, 'mobile-low': 256 } as const;

// ---------------------------------------------------------------------------------------------
// the byte budget: drop the top mip of the largest map, never raise the budget

export interface MipEntry {
  key: string;
  /** Bytes of each mip level, largest first. */
  mipBytes: readonly number[];
}

/** The mip levels to drop per key so that the sum of what remains is within `budgetBytes`; levels beyond the last are never dropped. */
export function planMipDrops(entries: readonly MipEntry[], budgetBytes: number): { drops: Record<string, number>; bytes: number; fits: boolean } {
  const drops: Record<string, number> = {};
  const sizeOf = (e: MipEntry): number => e.mipBytes.slice(drops[e.key] ?? 0).reduce((a, b) => a + b, 0);
  for (const e of entries) drops[e.key] = 0;
  let total = entries.reduce((a, e) => a + sizeOf(e), 0);
  while (total > budgetBytes) {
    let pick: MipEntry | null = null;
    for (const e of entries) {
      if ((drops[e.key] ?? 0) >= e.mipBytes.length - 1) continue;
      if (pick === null || sizeOf(e) > sizeOf(pick)) pick = e;
    }
    if (pick === null) return { drops, bytes: total, fits: false };
    drops[pick.key] = (drops[pick.key] ?? 0) + 1;
    total = entries.reduce((a, e) => a + sizeOf(e), 0);
  }
  return { drops, bytes: total, fits: true };
}

// ---------------------------------------------------------------------------------------------
// the instance

export interface TexturesReport {
  /** What the surfaces draw now: the configured mode, or `off` when textures are off, toggled off or the backend is unsupported. */
  mode: TextureMode;
  configured: TextureMode;
  on: boolean;
  /** Sets that are bound and whose maps for the mode have all arrived. */
  sets: string[];
  /** The `texture/...` assets the tier asks for (empty when off). */
  refs: string[];
  /** Refs that failed to load or did not fit; their sets stay procedural. */
  failed: string[];
  /** The GPU format the maps were transcoded to (`BC7`, `ASTC4x4`, `ETC2`, `RGBA8`), empty before the first one. */
  format: string;
  gpuBytes: number;
  downloadBytes: number;
  /** Top mip levels dropped to stay inside the byte budget. */
  mipDrop: number;
  /** True when the backend is in `unsupported` of the config. */
  unsupported: boolean;
  /** True once every requested ref has arrived or failed. */
  settled: boolean;
}

export interface SurfaceTexturesOptions {
  tier: QualityTierId;
  profile: LookProfile;
  /** `world.textures` and the QA `?textures=0` switch. */
  enabled: boolean;
  backend: RenderBackend;
  browser: string;
  config?: SurfaceTexturesFile;
  surfaceNames?: readonly string[];
}

export interface TextureAssets {
  job(name: string, args: unknown): Promise<unknown>;
}

interface Slot {
  node: ReturnType<typeof tslTexture>;
  tex: Texture | null;
}

interface SetState {
  name: string;
  ids: number[];
  ready: { value: number };
  slots: Partial<Record<MapName, Slot>>;
  loaded: Set<MapName>;
}

export class SurfaceTextures {
  readonly configured: TextureMode;
  readonly unsupported: boolean;
  readonly refs: string[];
  private readonly cfg: SurfaceTexturesFile;
  private readonly tier: QualityTierId;
  private readonly sets: SetState[] = [];
  private readonly placeholder: DataTexture;
  private on = true;
  private decoder: Ktx2Decoder | null = null;
  private started = false;
  private disposed = false;
  private formatSeen = '';
  private gpu = 0;
  private download = 0;
  private drops = 0;
  private readonly failed = new Set<string>();
  private pending = 0;
  private done = false;
  private generation = 0;

  constructor(o: SurfaceTexturesOptions) {
    this.cfg = o.config ?? SURFACE_TEXTURES;
    this.tier = o.tier;
    const names = o.surfaceNames ?? SURFACE_NAMES;
    this.unsupported = backendUnsupported(o.backend, o.browser, this.cfg);
    const mode = textureModeFor(o.tier, o.profile, o.enabled, this.cfg);
    this.configured = this.unsupported ? 'off' : mode;
    this.refs = refsFor(this.configured, this.cfg);
    this.placeholder = new DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1, RGBAFormat, UnsignedByteType);
    this.placeholder.minFilter = LinearFilter;
    this.placeholder.magFilter = LinearFilter;
    this.placeholder.needsUpdate = true;
    if (this.configured === 'off') return;
    for (const name of boundSets(this.cfg)) {
      const slots: Partial<Record<MapName, Slot>> = {};
      for (const m of mapsOf(this.configured)) slots[m] = { node: tslTexture(this.placeholder), tex: null };
      this.sets.push({ name, ids: idsOfSet(name, this.cfg, names), ready: uniform(0) as unknown as { value: number }, slots, loaded: new Set() });
    }
  }

  /** What the surfaces draw: the configured mode while on, `off` otherwise. */
  get mode(): TextureMode {
    return this.on ? this.configured : 'off';
  }

  /** True when a surface id has a set and the instance draws one. */
  get active(): boolean {
    return this.configured !== 'off' && this.sets.length > 0;
  }

  /** The QA switch (`setLookLayer('textures', on)`): off reads the procedural look at once, on restores the sets that are ready. False when the tier has no textures. */
  setOn(on: boolean): boolean {
    if (this.configured === 'off') return false;
    this.on = on;
    for (const s of this.sets) s.ready.value = on && this.isReady(s) ? 1 : 0;
    return true;
  }

  private isReady(s: SetState): boolean {
    return mapsOf(this.configured).every((m) => s.loaded.has(m));
  }

  report(): TexturesReport {
    return {
      mode: this.mode,
      configured: this.configured,
      on: this.on,
      sets: this.sets.filter((s) => this.isReady(s)).map((s) => s.name),
      refs: [...this.refs],
      failed: [...this.failed].sort(),
      format: this.formatSeen,
      gpuBytes: this.gpu,
      downloadBytes: this.download,
      mipDrop: this.drops,
      unsupported: this.unsupported,
      settled: this.configured === 'off' || this.done,
    };
  }

  // ---- loading ---------------------------------------------------------------------------------------------------------

  /**
   * Starts loading once the world is up. `renderer` is read when the loader is built and again after a renderer swap. Safe to call once;
   * a view that is off or unsupported does nothing and makes no request.
   */
  start(assets: TextureAssets, renderer: () => WebGPURenderer | null): void {
    if (this.started || this.disposed || !this.active) return;
    this.started = true;
    void this.load(assets, renderer);
  }

  /** The device was replaced (recovery, XR swap): the transcoded textures belong to the old one. Loads again for the new renderer. */
  onRendererReplaced(assets: TextureAssets, renderer: () => WebGPURenderer | null): void {
    if (!this.started || this.disposed) return;
    this.generation++;
    this.releaseTextures();
    this.done = false;
    this.failed.clear();
    void this.load(assets, renderer);
  }

  private releaseTextures(): void {
    for (const s of this.sets) {
      s.ready.value = 0;
      s.loaded.clear();
      for (const slot of Object.values(s.slots)) {
        if (slot?.tex) {
          slot.tex.dispose();
          slot.tex = null;
        }
        if (slot) slot.node.value = this.placeholder;
      }
    }
    this.gpu = 0;
    this.download = 0;
    this.drops = 0;
    this.formatSeen = '';
    this.decoder?.dispose();
    this.decoder = null;
  }

  private async load(assets: TextureAssets, renderer: () => WebGPURenderer | null): Promise<void> {
    const gen = this.generation;
    const live = (): boolean => !this.disposed && gen === this.generation;
    const budget = this.cfg.budgets[this.tier];
    const gpuLimit = budget.gpuMB * MIB;
    const downloadLimit = budget.downloadMB * MIB;
    this.pending = this.refs.length;
    try {
      const r = renderer();
      if (!r) throw new Error('no renderer');
      const decoder = new Ktx2Decoder();
      decoder.bind(r);
      this.decoder = decoder;
      for (const set of this.sets) {
        for (const map of mapsOf(this.configured)) {
          if (!live()) return;
          const ref = refOf(set.name, map);
          try {
            if (this.download >= downloadLimit) throw new Error('download budget reached');
            const res = (await assets.job('world.texture', { ref, tier: this.tier })) as TextureJobResult;
            if (!live()) return;
            if ('missing' in res) throw new Error('not in the catalog');
            this.download += res.bytes.byteLength;
            const tex = await decoder.decode(res.bytes);
            if (!live()) {
              tex.dispose();
              return;
            }
            while (this.gpu + textureBytes(tex) > gpuLimit && dropTopMip(tex)) this.drops++;
            if (this.gpu + textureBytes(tex) > gpuLimit) {
              tex.dispose();
              throw new Error('over the GPU budget');
            }
            this.gpu += textureBytes(tex);
            if (this.formatSeen === '') this.formatSeen = formatName(tex.format);
            const slot = set.slots[map] as Slot;
            slot.tex = tex;
            slot.node.value = tex;
            set.loaded.add(map);
          } catch (e) {
            this.failed.add(ref);
            // eslint-disable-next-line no-console
            console.warn(`surface textures: ${ref}: ${e instanceof Error ? e.message : String(e)}`);
          } finally {
            this.pending--;
          }
        }
        if (this.isReady(set)) set.ready.value = this.on ? 1 : 0;
      }
    } catch (e) {
      for (const ref of this.refs) this.failed.add(ref);
      // eslint-disable-next-line no-console
      console.warn(`surface textures: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (live()) this.done = true;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.releaseTextures();
    this.placeholder.dispose();
  }

  // ---- shading -----------------------------------------------------------------------------------------------------------

  /** The three shading results for a surface id: colour, roughness and the world-space normal offset. See `withSurfaceTextures`. */
  shade(surface: SurfaceInput, base: ShadeInput): ShadeOutput {
    const mode = this.configured as Exclude<TextureMode, 'off'>;
    const variant = TIER_VARIANT[this.tier];
    const size = SIZE_OF_VARIANT[variant];
    const levels = Math.floor(Math.log2(size));
    const fade = this.cfg.fade;
    const maps = mapsOf(mode);
    const slopeCos = Math.cos((this.cfg.slopeDeg * Math.PI) / 180);

    const nearOf = (): L => float(1).sub(smoothstep(fade.startM, fade.endM, positionWorld.sub(cameraPosition).length()));
    const inSet = (s: SetState): L => {
      let m: L = float(0);
      for (const id of s.ids) m = m.max(step(surface.id.sub(id).abs(), 0.5));
      return m;
    };
    // The explicit mip level: the derivative is read here, in uniform flow, and held in a variable before any branch uses it.
    const lodOf = (tileM: number): L => log2(pixelFootprint(positionWorld).mul(size / tileM).max(1)).clamp(0, levels).toVar();
    const flatOf = (): L => smoothstep(slopeCos - 0.06, slopeCos + 0.06, surface.normal.y);
    const condOf = (s: SetState, near: L): L => inSet(s).greaterThan(0.5).and((s.ready as unknown as L).greaterThan(0.5)).and(near.greaterThan(0.001));

    const sampler = (s: SetState, map: MapName, lod: L): TileSampler => {
      const node = (s.slots[map] as Slot).node as unknown as { sample(uv: L): { level(l: L): L } };
      return (uv, shift) => node.sample(uv).level(lod.add(shift));
    };
    const uvOf = (tileM: number): L => vec2(positionWorld.x, positionWorld.z).div(tileM);

    // Albedo: the set's colour at the brightness the look already draws (`keep` of the set's own brightness is let in).
    const colorFn = Fn(() => {
      const out = vec3(base.color).toVar();
      const near = nearOf().toVar();
      for (const s of this.sets) {
        const cfg = this.cfg.sets[s.name] as SurfaceTexturesFile['sets'][string];
        const lod = lodOf(cfg.tileM);
        const uvWorld = uvOf(cfg.tileM).toVar();
        const flat = flatOf().toVar();
        If(condOf(s, near), () => {
          const albedo = sampler(s, 'albedo', lod);
          let tex: L = tiledSample((uv, sh) => albedo(uv, sh).rgb, uvWorld, mode).rgb;
          if (cfg.slopeFull && mode === 'stochastic') {
            // Steeper than the slope limit the top projection stretches: two side projections, weighted by the normal, take over.
            const wx = surface.normal.x.abs();
            const wz = surface.normal.z.abs();
            const zy = albedo(vec2(positionWorld.z, positionWorld.y).div(cfg.tileM), 0).rgb.mul(wx);
            const xy = albedo(vec2(positionWorld.x, positionWorld.y).div(cfg.tileM), 0).rgb.mul(wz);
            tex = mix(zy.add(xy).div(wx.add(wz).max(1e-4)), tex, flat);
          }
          const meanLuma = cfg.mean[0] * 0.2126 + cfg.mean[1] * 0.7152 + cfg.mean[2] * 0.0722;
          const tone = luma(base.color).div(Math.max(1e-4, meanLuma)).max(0.05).pow(cfg.keep);
          out.assign(mix(base.color, tex.mul(tone), near));
        });
      }
      return out;
    });

    const ormFn = maps.includes('orm')
      ? Fn(() => {
          // x: ambient occlusion, y: roughness.
          const out = vec3(1, base.roughness, 0).toVar();
          const near = nearOf().toVar();
          for (const s of this.sets) {
            const cfg = this.cfg.sets[s.name] as SurfaceTexturesFile['sets'][string];
            const lod = lodOf(cfg.tileM);
            const uvWorld = uvOf(cfg.tileM).toVar();
            If(condOf(s, near), () => {
              const orm = sampler(s, 'orm', lod);
              const t = tiledSample((uv, sh) => orm(uv, sh).rgb, uvWorld, mode).rgb;
              // Wet pavement keeps the glossy roughness the procedural look gave it.
              const rough = mix(base.roughness, t.y.min(base.roughness.add(0.12)), near);
              out.assign(vec3(mix(float(1), t.x, near), rough, 0));
            });
          }
          return out;
        })
      : null;

    const normalFn = maps.includes('normal')
      ? Fn(() => {
          // The offset of the surface normal in world space: a planar projection along +y (tangent +x, bitangent -z).
          const out = vec3(0, 0, 0).toVar();
          const near = nearOf().toVar();
          for (const s of this.sets) {
            const cfg = this.cfg.sets[s.name] as SurfaceTexturesFile['sets'][string];
            const lod = lodOf(cfg.tileM);
            const uvWorld = uvOf(cfg.tileM).toVar();
            const flat = flatOf().toVar();
            If(condOf(s, near), () => {
              const nrm = sampler(s, 'normal', lod);
              const t = tiledSample((uv, sh) => nrm(uv, sh).rgb, uvWorld, mode).rgb.mul(2).sub(1);
              out.assign(vec3(t.x, 0, t.y.negate()).mul(near).mul(flat));
            });
          }
          return out;
        })
      : null;

    const color = (colorFn as unknown as () => L)();
    const orm = ormFn ? (ormFn as unknown as () => L)() : null;
    const offset = normalFn ? (normalFn as unknown as () => L)() : null;
    const ao = orm ? mix(float(1), orm.x, 0.6) : float(1);
    let normal: L | null = base.normal;
    if (offset && base.normal) {
      const view = (cameraViewMatrix as unknown as L).mul(vec4(offset, 0)).xyz;
      normal = normalize(base.normal.add(view));
    }
    return { color: color.mul(ao), roughness: orm ? orm.y : base.roughness, normal };
  }
}

// ---------------------------------------------------------------------------------------------
// the hook the look materials call

export interface SurfaceInput {
  /** The surface id of the fragment (flat across a triangle). */
  id: L;
  /** The world normal. */
  normal: L;
}

export interface ShadeInput {
  color: L;
  roughness: L;
  /** The view-space normal the material uses, or null when it has none (`min`). */
  normal: L | null;
}

export interface ShadeOutput {
  color: L;
  roughness: L;
  normal: L | null;
}

let installed: SurfaceTextures | null = null;

/** The instance `withSurfaceTextures` reads (set by the world view before it builds the look materials); null clears it. */
export function installSurfaceTextures(t: SurfaceTextures | null): void {
  installed = t;
}

export function installedSurfaceTextures(): SurfaceTextures | null {
  return installed;
}

/** The look's ground nodes with the bound surface textures applied, or `nodes` itself when textures are off or nothing is bound. */
export function withSurfaceTextures(surface: SurfaceInput, nodes: ShadeInput): ShadeOutput {
  const t = installed;
  if (!t || !t.active) return nodes;
  return t.shade(surface, nodes);
}

/** Taps per sample of a mode (3, 2, 1, 0): the number of texture reads one map costs in a fragment of a bound surface. */
export const tapsOfMode = (mode: TextureMode): number => tapsOf(mode);
