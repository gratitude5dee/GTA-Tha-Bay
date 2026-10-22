/**
 * Colour-vision-deficiency separation check for the HUD palettes (10-ui-hud-xr.md 2.13 rule 4, M04b2; algorithm in BD-M04b2-01).
 *
 * Simulation: Machado, Oliveira and Fernandes (2009), "A Physiologically-based Model for Simulation of Color Vision Deficiency", IEEE TVCG
 * 15(6), matrices for severity 1.0, applied to linear sRGB. Separation: CIE76 colour difference (Euclidean distance in CIELAB, D65) between
 * the simulated colours of every pair of semantic tokens. A palette passes when its smallest pair distance under its own deficiency
 * (the `default` palette: under normal vision) is at least `MIN_DELTA_E`. The threshold is fixed here and is not lowered to pass.
 */
export type Deficiency = 'normal' | 'protan' | 'deutan' | 'tritan';
export type Rgb = readonly [number, number, number];

/** Smallest allowed pair distance (CIE76). Twenty is a clearly visible difference for adjacent large UI shapes. */
export const MIN_DELTA_E = 20;

const MATRICES: Record<Exclude<Deficiency, 'normal'>, readonly (readonly [number, number, number])[]> = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

export function parseHex(hex: string): Rgb {
  const h = hex.replace('#', '');
  return [Number.parseInt(h.slice(0, 2), 16), Number.parseInt(h.slice(2, 4), 16), Number.parseInt(h.slice(4, 6), 16)];
}

const toLinear = (c: number): number => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

export function simulate(rgb: Rgb, kind: Deficiency): [number, number, number] {
  const lin: [number, number, number] = [toLinear(rgb[0]), toLinear(rgb[1]), toLinear(rgb[2])];
  if (kind === 'normal') return lin;
  const m = MATRICES[kind];
  return [0, 1, 2].map((r) => clamp01((m[r] as readonly number[])[0]! * lin[0] + (m[r] as readonly number[])[1]! * lin[1] + (m[r] as readonly number[])[2]! * lin[2])) as [number, number, number];
}

/** Linear sRGB to CIELAB (D65). */
export function toLab(lin: readonly [number, number, number]): [number, number, number] {
  const [r, g, b] = lin;
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function deltaE(a: Rgb, b: Rgb, kind: Deficiency): number {
  const la = toLab(simulate(a, kind));
  const lb = toLab(simulate(b, kind));
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
}

export const SEMANTIC_TOKENS = ['friendly', 'danger', 'warning', 'objective', 'neutral'] as const;
export type SemanticToken = (typeof SEMANTIC_TOKENS)[number];
export type PaletteId = 'default' | 'deutan' | 'protan' | 'tritan';
export type Palette = Record<SemanticToken, string>;

/** The deficiency a palette is built for. */
export const PALETTE_FOR: Record<PaletteId, Deficiency> = { default: 'normal', deutan: 'deutan', protan: 'protan', tritan: 'tritan' };

export interface PairSeparation { a: SemanticToken; b: SemanticToken; deltaE: number }

/** Every pair of semantic tokens with its separation under `kind`. */
export function separations(p: Palette, kind: Deficiency): PairSeparation[] {
  const out: PairSeparation[] = [];
  for (let i = 0; i < SEMANTIC_TOKENS.length; i++) {
    for (let j = i + 1; j < SEMANTIC_TOKENS.length; j++) {
      const a = SEMANTIC_TOKENS[i] as SemanticToken;
      const b = SEMANTIC_TOKENS[j] as SemanticToken;
      out.push({ a, b, deltaE: deltaE(parseHex(p[a]), parseHex(p[b]), kind) });
    }
  }
  return out;
}

export function minSeparation(p: Palette, kind: Deficiency): number {
  return Math.min(...separations(p, kind).map((s) => s.deltaE));
}

/** Relative luminance (WCAG) of a hex colour, for the contrast checks. */
export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
