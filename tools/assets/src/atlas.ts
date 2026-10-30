/**
 * The procedural atlas pages of the people kit (M10d4): `texture/pc.skin`, `texture/pc.cloth`, `texture/pc.hair` for the creator preview
 * (one 4x4 page each) and `texture/ped.atlas` for the pedestrians (one 4x4 page: skin cells 0-3, cloth 4-11, hair 12-15). The pages
 * hold detail only (weave, pores, strands, an eye): the tint comes from the vertex colour at assembly, so one page serves every skin
 * tone, garment colour and hair colour. Integer hashes and linear maths only, so two runs on any host give the same bytes.
 * Each page exists at 1,024, 512 and 256 px (`desktop`, `mobile`, `mobile-low`).
 */
import { hash01, lerp } from './recipes/skin-mesh.ts';
import { encodePng, type Raster } from './image.ts';

export type AtlasId = 'pc.skin' | 'pc.cloth' | 'pc.hair' | 'ped.atlas';
export const ATLAS_IDS: readonly AtlasId[] = ['pc.skin', 'pc.cloth', 'pc.hair', 'ped.atlas'];
export const ATLAS_SIZES = { desktop: 1024, mobile: 512, 'mobile-low': 256 } as const;

/** Value noise on an integer lattice of period `p` pixels. */
function noise(x: number, y: number, p: number, seed: number): number {
  const gx = x / p, gy = y / p;
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  const fx = gx - x0, fy = gy - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash01(x0 + seed * 101, y0), b = hash01(x0 + 1 + seed * 101, y0);
  const c = hash01(x0 + seed * 101, y0 + 1), d = hash01(x0 + 1 + seed * 101, y0 + 1);
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
}

type Painter = (u: number, v: number, px: number, seed: number) => [number, number, number];

const clamp = (x: number): number => Math.max(0, Math.min(1, x));
const rgb = (l: number, r: number, g: number, b: number): [number, number, number] => [clamp(l * r), clamp(l * g), clamp(l * b)];

/** u and v are 0..1 inside the cell; px is the cell edge in pixels (so lattice periods scale with the page size). */
const SKIN: readonly Painter[] = [
  (u, v, px, s) => rgb(0.93 + (noise(u * px, v * px, px / 6, s) - 0.5) * 0.08 + (hash01((u * px) | 0, (v * px) | 0) - 0.5) * 0.03, 1, 0.97, 0.94),
  (u, v, px, s) => {
    const blush = Math.exp(-(((u - 0.5) ** 2 + (v - 0.55) ** 2) / 0.06));
    const l = 0.94 + (noise(u * px, v * px, px / 6, s) - 0.5) * 0.07 + (hash01((u * px) | 0, (v * px) | 0) - 0.5) * 0.03;
    return rgb(l, 1, 0.97 - blush * 0.06, 0.94 - blush * 0.07);
  },
  (u, v, px, s) => {
    const knuckle = Math.abs(Math.sin(v * 40)) < 0.06 ? 0.93 : 1;
    return rgb((0.9 + (noise(u * px, v * px, px / 5, s) - 0.5) * 0.08) * knuckle, 1, 0.96, 0.93);
  },
  (u, v) => {
    // the eye, seen from the front: sclera, limbus, iris, pupil, one highlight
    const x = u - 0.5, y = v - 0.5;
    const r = Math.hypot(x, y);
    const iris = 0.27, pupil = 0.115;
    if (Math.hypot(x + 0.09, y + 0.1) < 0.045) return [1, 1, 1];
    if (r < pupil) return [0.02, 0.02, 0.025];
    if (r < iris - 0.03) {
      const t = (r - pupil) / (iris - 0.03 - pupil);
      return [lerp(0.34, 0.19, t), lerp(0.2, 0.11, t), lerp(0.1, 0.06, t)];
    }
    if (r < iris) return [0.1, 0.06, 0.04];
    const lid = Math.max(0, (r - 0.38) / 0.1);
    return [0.9 - lid * 0.2, 0.88 - lid * 0.24, 0.84 - lid * 0.26];
  },
  (u, v, px, s) => rgb(0.9 + (noise(u * px, v * px, px / 8, s) - 0.5) * 0.1, 1, 0.74, 0.7),
];

const CLOTH: readonly Painter[] = [
  // 0 cotton: plain weave
  (u, v, px, s) => {
    const x = (u * px) | 0, y = (v * px) | 0;
    const period = Math.max(2, Math.round(px / 64));
    const w = ((x / period) | 0) % 2 === ((y / period) | 0) % 2 ? 0.04 : -0.04;
    const l = 0.93 + w + (noise(u * px, v * px, px / 5, s) - 0.5) * 0.05;
    return [l, l, l];
  },
  // 1 denim: diagonal twill with slubs
  (u, v, px, s) => {
    const x = u * px, y = v * px;
    const period = Math.max(3, px / 42);
    const tw = ((x + y) / period) % 2 < 1 ? 0.07 : -0.05;
    const l = 0.9 + tw + (noise(x, y, px / 4, s) - 0.5) * 0.1 + (hash01((x * 3) | 0, (y / 2) | 0) - 0.5) * 0.05;
    return [l, l, l];
  },
  // 2 knit: vertical rib
  (u, v, px, s) => {
    const x = u * px;
    const period = Math.max(3, px / 32);
    const rib = Math.abs(((x / period) % 1) - 0.5) * 2;
    const l = 0.84 + rib * 0.14 + (noise(x, v * px, px / 6, s) - 0.5) * 0.06;
    return [l, l, l];
  },
  // 3 nylon: smooth with a rip-stop grid
  (u, v, px, s) => {
    const x = u * px, y = v * px;
    const g = Math.max(8, px / 8);
    const line = x % g < 1.2 || y % g < 1.2 ? -0.06 : 0;
    const l = 0.95 + line + (noise(x, y, px / 3, s) - 0.5) * 0.04;
    return [l, l, l];
  },
  // 4 leather: pebbled
  (u, v, px, s) => {
    const l = 0.88 + (noise(u * px, v * px, px / 14, s) - 0.5) * 0.14 + (hash01((u * px) | 0, (v * px) | 0) - 0.5) * 0.04;
    return [l, l, l];
  },
  // 5 dark rubber and lenses (not tinted)
  (u, v, px, s) => {
    const l = 0.14 + (noise(u * px, v * px, px / 6, s) - 0.5) * 0.03;
    return [l, l, l * 1.04];
  },
  // 6 bright metal (not tinted)
  (u, v, px, s) => {
    const l = 0.78 + (noise(u * px, v * px, px / 3, s) - 0.5) * 0.08;
    return [l * 1.03, l * 0.97, l * 0.86];
  },
  // 7 canvas: twill with a faint check
  (u, v, px, s) => {
    const x = u * px, y = v * px;
    const period = Math.max(3, px / 48);
    const tw = ((x + y) / period) % 2 < 1 ? 0.03 : -0.03;
    const g = px / 2;
    const check = (x % g < px / 22 ? -0.07 : 0) + (y % g < px / 22 ? -0.07 : 0);
    const l = 0.92 + tw + check + (noise(x, y, px / 5, s) - 0.5) * 0.05;
    return [l, l, l];
  },
];

const HAIR: readonly Painter[] = [
  // 0 straight: strands along v
  (u, v, px, s) => {
    const l = 0.74 + noise(u * px, v * px * 0.08, px / 10, s) * 0.26;
    return [l, l, l];
  },
  // 1 curly: soft blobs
  (u, v, px, s) => {
    const l = 0.66 + noise(u * px, v * px, px / 9, s) * 0.34;
    return [l, l, l];
  },
  // 2 coil: tight bumps
  (u, v, px, s) => {
    const l = 0.62 + noise(u * px, v * px, px / 20, s) * 0.38;
    return [l, l, l];
  },
  // 3 short: fine grain
  (u, v, px, s) => {
    const l = 0.8 + (hash01((u * px) | 0, (v * px) | 0) - 0.5) * 0.18 + (noise(u * px, v * px, px / 4, s) - 0.5) * 0.06;
    return [l, l, l];
  },
];

const POOLS = { skin: SKIN, cloth: CLOTH, hair: HAIR } as const;

/** What a cell of a page holds: `[pool, index]` or null for an empty (mid-gray) cell. */
function slotOf(id: AtlasId, slot: number): [keyof typeof POOLS, number] | null {
  if (id === 'pc.skin') return slot < SKIN.length ? ['skin', slot] : null;
  if (id === 'pc.cloth') return slot < CLOTH.length ? ['cloth', slot] : null;
  if (id === 'pc.hair') return slot < HAIR.length ? ['hair', slot] : null;
  if (slot < 4) return ['skin', slot];
  if (slot < 12) return ['cloth', slot - 4];
  return ['hair', slot - 12];
}

/** One page at `size` px, RGBA, opaque. */
export function renderAtlas(id: AtlasId, size: number): Raster {
  const data = new Uint8Array(size * size * 4);
  const cellPx = size / 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const col = Math.min(3, Math.floor(x / cellPx));
      const row = Math.min(3, Math.floor(y / cellPx));
      const slot = row * 4 + col;
      const which = slotOf(id, slot);
      const u = (x - col * cellPx) / cellPx, v = (y - row * cellPx) / cellPx;
      const gray: [number, number, number] = [0.5, 0.5, 0.5];
      const c: [number, number, number] = which ? POOLS[which[0]][which[1]]?.(u, v, cellPx, slot + 1) ?? gray : gray;
      const k = (y * size + x) * 4;
      // the page holds sRGB bytes; the values above are sRGB-space already
      data[k] = Math.round(clamp(c[0]) * 255);
      data[k + 1] = Math.round(clamp(c[1]) * 255);
      data[k + 2] = Math.round(clamp(c[2]) * 255);
      data[k + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}

export const atlasPng = (id: AtlasId, size: number): Uint8Array => encodePng(renderAtlas(id, size));

/** GPU bytes of one page: RGBA8 with a third more for mips. */
export const atlasGpuBytes = (size: number): number => Math.ceil((size * size * 4 * 4) / 3);
