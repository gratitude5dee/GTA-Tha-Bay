/**
 * The facade atlas on the desktop tiers (M10d2; 02-world-bake.md section 6 desktop row): `texture/facade-atlas` (KTX2, a 4 x 4 grid of
 * wall materials authored by `tools/assets/src/recipes/facade-atlas.ts`) over the wall albedo of M02e's façade node.
 *
 *  - Loading: after the reveal, like M10d0's surface sets (`world.texture` through the pack store, transcoded by the page's KTX2 loader),
 *    on `desktop-ultra` and `desktop` only. The `mobile` variant waits for M02h7's `albedo` seam (DL-740); `mobile-low` and XR never
 *    request it. The loaded texture fills M02e's `FacadeAtlasHook` (`look/facade.ts`), which M02h7's seam reads.
 *  - Shading (`full` profile only): each building picks one of its class's tiles by its seed (`config/world/facade-atlas.json`
 *    `classes`); the tile repeats every `tileM` metres along the wall (`fac.u`, `fac.v`), sampled at an explicit mip level from the
 *    pixel footprint so the atlas cells never bleed and tile seams never pick a coarse mip. The sample is grey detail around the
 *    config's `mean`: the class palette colour (the per-building tint) is multiplied by `sample / mean`, so the walls keep the
 *    brightness the look tuned; glass is left as it is and the detail fades out beyond `fade`. Until the file is in (and with the atlas
 *    off) the weight is 0 and the graph draws what M02e drew.
 *  - QA: `?textures=0` or `?art=0` leaves it off (the baselines of the earlier look rows).
 */
import { texture as tslTexture, uniform } from 'three/tsl';
import { ClampToEdgeWrapping, DataTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat, UnsignedByteType, type Texture, type WebGPURenderer } from 'three/webgpu';
import type { QualityTierId } from '@dv/shared';
import atlasJson from '../../../../../config/world/facade-atlas.json';
import { createFacadeAtlasHook, type FacadeAtlasHook, type WallOut } from '../look/facade.ts';
import { hash11, pixelFootprint } from '../look/noise.ts';
import { cameraPosition, float, fract, log2, mix, positionWorld, select, smoothstep, vec2, type L } from '../sky/tsl.ts';
import { Ktx2Decoder, formatName, textureBytes } from '../textures/ktx2.ts';
import type { TextureJobResult } from '../textures/texture-job.ts';

export interface FacadeAtlasConfig {
  schema: 'facade-atlas/1';
  asset: string;
  grid: number;
  sizePx: { desktop: number; mobile: number };
  mean: number;
  strength: number;
  fade: { startM: number; endM: number };
  tiles: { name: string; tileM: number }[];
  classes: number[][];
}
export const FACADE_ATLAS: FacadeAtlasConfig = atlasJson as unknown as FacadeAtlasConfig;

/** The tiers that draw the atlas in this row (the `mobile` variant comes with M02h7's seam). */
export const ATLAS_TIERS: readonly QualityTierId[] = ['desktop-ultra', 'desktop'];
export const atlasTier = (tier: QualityTierId): boolean => ATLAS_TIERS.includes(tier);

/** The deepest mip the shader reads: a tile is still 8 px there, so a cell never mixes with its neighbours. */
export const MAX_LOD = 5;

export interface FacadeAtlasInfo {
  /** Whether this tier draws the atlas at all. */
  on: boolean;
  asset: string;
  /** The variant the tier requests (`desktop`), or null when the tier requests none. */
  variant: 'desktop' | null;
  requested: boolean;
  loaded: boolean;
  failed: string | null;
  format: string | null;
  gpuBytes: number;
}

export interface AtlasAssets {
  job(name: string, args: unknown): Promise<unknown>;
}

/** The tile and its metres for each (class, pick) pair, in `classes` order: index `class * 4 + pick`. */
export function tilePairs(cfg: FacadeAtlasConfig = FACADE_ATLAS): { tile: number; tileM: number }[] {
  const out: { tile: number; tileM: number }[] = [];
  for (const picks of cfg.classes) {
    for (let p = 0; p < 4; p++) {
      const tile = picks[p % picks.length] as number;
      out.push({ tile, tileM: (cfg.tiles[tile] as { tileM: number }).tileM });
    }
  }
  return out;
}

/** The atlas UV of a wall point: the tile's cell, inset half a desktop texel, wall up = image up (KTX2 is not flipped). */
export function atlasUv(tile: number, u: number, v: number, cfg: FacadeAtlasConfig = FACADE_ATLAS): [number, number] {
  const g = cfg.grid;
  const inset = 0.5 / (cfg.sizePx.desktop / g);
  const fu = u - Math.floor(u), fv = v - Math.floor(v);
  const tx = tile % g, ty = Math.floor(tile / g);
  return [(tx + inset + fu * (1 - 2 * inset)) / g, (ty + inset + (1 - fv) * (1 - 2 * inset)) / g];
}

export class FacadeAtlas {
  readonly hook: FacadeAtlasHook = createFacadeAtlasHook();
  private readonly placeholder: DataTexture;
  readonly node: ReturnType<typeof tslTexture>;
  /** 0 until the file is in, then 1. */
  readonly weight = uniform(0) as unknown as { value: number };
  private tex: Texture | null = null;
  private requested = false;
  private failed: string | null = null;
  private format: string | null = null;
  private disposed = false;

  constructor(readonly tier: QualityTierId, readonly enabled: boolean, readonly cfg: FacadeAtlasConfig = FACADE_ATLAS) {
    // Mid grey at the config's mean: the placeholder multiplies the wall by about 1 if a frame samples it.
    const g = Math.round(255 * (cfg.mean <= 0.0031308 ? 12.92 * cfg.mean : 1.055 * cfg.mean ** (1 / 2.4) - 0.055));
    this.placeholder = new DataTexture(new Uint8Array([g, g, g, 255]), 1, 1, RGBAFormat, UnsignedByteType);
    this.placeholder.minFilter = LinearFilter;
    this.placeholder.magFilter = LinearFilter;
    this.placeholder.needsUpdate = true;
    this.node = tslTexture(this.placeholder);
  }

  /** Whether the tier draws the atlas (desktop tiers with the atlas enabled). */
  get active(): boolean {
    return this.enabled && atlasTier(this.tier);
  }

  /** Reads and transcodes the tier's variant; a failure leaves the walls as M02e drew them. */
  async load(assets: AtlasAssets, renderer: () => WebGPURenderer | null): Promise<void> {
    if (!this.active || this.requested || this.disposed) return;
    this.requested = true;
    let decoder: Ktx2Decoder | null = null;
    try {
      const res = (await assets.job('world.texture', { ref: this.cfg.asset, tier: this.tier })) as TextureJobResult;
      if ('missing' in res) throw new Error('not in the catalog');
      const r = renderer();
      if (!r) throw new Error('no renderer');
      decoder = new Ktx2Decoder();
      decoder.bind(r);
      const tex = await decoder.decode(res.bytes);
      if (this.disposed) {
        tex.dispose();
        return;
      }
      tex.wrapS = ClampToEdgeWrapping;
      tex.wrapT = ClampToEdgeWrapping;
      tex.minFilter = LinearMipmapLinearFilter;
      tex.anisotropy = 4;
      tex.needsUpdate = true;
      this.tex = tex;
      this.format = formatName(tex.format as number);
      (this.node as unknown as { value: Texture }).value = tex;
      this.hook.set(tex);
      this.weight.value = 1;
    } catch (e) {
      this.failed = e instanceof Error ? e.message : String(e);
    } finally {
      decoder?.dispose();
    }
  }

  /**
   * The wall output with the atlas over its albedo (`full` profile; any other profile and an inactive atlas return `wall` itself, so
   * no texture node is created). `kind`, `seed`, `u` and `v` are the façade node's inputs.
   */
  shade(wall: WallOut, i: { kind: L; seed: L; u: L; v: L }): WallOut {
    const cfg = this.cfg;
    const pairs = tilePairs(cfg);
    const seedI = i.seed.mul(32767).round();
    const pick = hash11(seedI.mul(2.131)).mul(4).floor().clamp(0, 3);
    const idx = i.kind.round().clamp(0, cfg.classes.length - 1).mul(4).add(pick);
    let tile: L = float(pairs[pairs.length - 1]?.tile ?? 0);
    let tileM: L = float(pairs[pairs.length - 1]?.tileM ?? 4);
    for (let k = pairs.length - 2; k >= 0; k--) {
      const p = pairs[k] as { tile: number; tileM: number };
      tile = select(idx.lessThan(k + 0.5), float(p.tile), tile);
      tileM = select(idx.lessThan(k + 0.5), float(p.tileM), tileM);
    }
    const g = cfg.grid;
    const tilePx = cfg.sizePx.desktop / g;
    const inset = 0.5 / tilePx;
    const cell = vec2(fract(i.u.div(tileM)), float(1).sub(fract(i.v.div(tileM))));
    const tx = tile.sub(tile.div(g).floor().mul(g));
    const ty = tile.div(g).floor();
    const uv = vec2(tx, ty).add(inset).add(cell.mul(1 - 2 * inset)).div(g);
    // The explicit mip level from the pixel footprint (read in uniform flow, before any branch), capped so a cell never mixes.
    const lod = log2(pixelFootprint(positionWorld).mul(float(tilePx).div(tileM)).max(1)).clamp(0, MAX_LOD).toVar();
    const sample = (this.node as unknown as { sample(uv: L): { level(l: L): L } }).sample(uv).level(lod) as L;
    const factor = sample.x.div(cfg.mean).clamp(0.3, 1.8);
    const near = float(1).sub(smoothstep(cfg.fade.startM, cfg.fade.endM, positionWorld.sub(cameraPosition).length()));
    const w = (this.weight as unknown as L).mul(cfg.strength).mul(near);
    const detailed = wall.color.mul(mix(float(1), factor, w));
    return { ...wall, color: mix(detailed, wall.color, wall.glass) };
  }

  info(): FacadeAtlasInfo {
    return {
      on: this.active,
      asset: this.cfg.asset,
      variant: this.active ? 'desktop' : null,
      requested: this.requested,
      loaded: this.tex !== null,
      failed: this.failed,
      format: this.format,
      gpuBytes: this.tex ? textureBytes(this.tex) : 0,
    };
  }

  dispose(): void {
    this.disposed = true;
    this.weight.value = 0;
    (this.node as unknown as { value: Texture }).value = this.placeholder;
    this.hook.set(null);
    this.tex?.dispose();
    this.tex = null;
    this.placeholder.dispose();
  }
}

let installed: FacadeAtlas | null = null;

/** The atlas `withFacadeAtlas` reads (set by the world view before it builds the look materials); null clears it. */
export function installFacadeAtlas(a: FacadeAtlas | null): void {
  installed = a;
}

export function installedFacadeAtlas(): FacadeAtlas | null {
  return installed;
}

/** The wall nodes with the atlas over their albedo on `full`, or `wall` itself (no texture node) on other profiles or with none. */
export function withFacadeAtlas(profile: 'full' | 'lite' | 'min', wall: WallOut, i: { kind: L; seed: L; u: L; v: L }): WallOut {
  const a = installed;
  if (!a || !a.active || profile !== 'full') return wall;
  return a.shade(wall, i);
}
