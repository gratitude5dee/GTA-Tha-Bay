/**
 * The district palette of the landmark recipes (M02d1): named sRGB colours and three material classes. Recipe outputs carry no
 * textures: colour is a vertex attribute (`COLOR_0`, linear), and the class sets the PBR factors of the glTF material. At runtime
 * the world material draws the vertex colour; the factors are for the Blender art pass that replaces a recipe at the same AssetId
 * (M10d2).
 */

export type MatClass = 'matte' | 'metal' | 'glass';
export const MAT_CLASSES: readonly MatClass[] = ['matte', 'metal', 'glass'];

export interface MaterialDef { name: string; roughness: number; metallic: number }
export const MATERIALS: Readonly<Record<MatClass, MaterialDef>> = {
  matte: { name: 'matte', roughness: 0.9, metallic: 0 },
  metal: { name: 'metal', roughness: 0.45, metallic: 0.8 },
  glass: { name: 'glass', roughness: 0.15, metallic: 0.1 },
};

/** sRGB hex per colour name. */
export const COLORS = {
  // stone and plaster
  granite: '#b9b5a9',
  limestone: '#d8d0bb',
  sandstone: '#c9b48f',
  plaster: '#e6dcc4',
  cream: '#efe6cf',
  concrete: '#bdbdb6',
  whiteConcrete: '#e7e5df',
  // roofs and domes
  copperGreen: '#6f9a8a',
  slate: '#5d6670',
  terracotta: '#b45f43',
  roofGrey: '#7b7f84',
  gold: '#c8a64a',
  // metals
  bridgeRed: '#b3321f',
  steelGrey: '#8c939a',
  darkSteel: '#4a5058',
  white: '#f1f1ee',
  // glass
  glassBlue: '#6b8fa8',
  glassTeal: '#5f8a8c',
  glassDark: '#34454f',
  // ground and landscape
  grass: '#6c8f4e',
  hillGreen: '#7a9657',
  dryGrass: '#a89d62',
  rock: '#8d8576',
  sand: '#d3c49a',
  asphalt: '#4a4d52',
  brick: '#a8503a',
  water: '#4f7f95',
  hedge: '#456b3a',
  flower: '#c75a7a',
  timber: '#8a6a4a',
  lamp: '#e8d9a0',
  // painted wood, courts, fields (M02d2)
  paintBlue: '#6f93b8',
  paintCream: '#e9dcae',
  paintSage: '#8fa987',
  paintRose: '#c98f8f',
  paintYellow: '#dcc070',
  paintTeal: '#5f9a98',
  paintLilac: '#9c8fb5',
  trimWhite: '#f3efe6',
  lawn: '#78a05a',
  field: '#5c8a47',
  dirt: '#b08a60',
  seatBlue: '#3f5e86',
  seatGreen: '#4d6d57',
  woodDark: '#6a4f38',
  redLacquer: '#a63a2c',
  tileGreen: '#4f8a6a',
  glassLight: '#a9c4d4',
  blossom: '#e3a9bd',
  tyre: '#2c2d30',
} as const;
export type ColorName = keyof typeof COLORS;

export type Rgb = readonly [number, number, number];

const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** `#rrggbb` to linear floats (glTF `COLOR_0` is linear). */
export function hexToLinear(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [srgbToLinear(((n >> 16) & 255) / 255), srgbToLinear(((n >> 8) & 255) / 255), srgbToLinear((n & 255) / 255)];
}

export const linearOf = (name: ColorName): Rgb => hexToLinear(COLORS[name]);

export function scaleRgb(c: Rgb, k: number): Rgb {
  return [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)];
}

export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** A colour given as a palette name or an explicit linear triple. */
export type ColorRef = ColorName | Rgb;
export const resolveColor = (c: ColorRef): Rgb => (typeof c === 'string' ? linearOf(c) : c);
