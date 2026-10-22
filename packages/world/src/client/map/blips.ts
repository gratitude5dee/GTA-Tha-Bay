/**
 * Blip glyphs and the GPS route line (M02c2; 02-world-maps.md sections 3.2 and 3.3). Every kind has its own shape as well as its colour,
 * and every colour is a palette token, so each colour-blind palette works (the table below is the one of the spec). The functions draw
 * onto a Canvas 2D context at screen positions the views compute; they hold no state.
 */
import type { BlipKind, MapBlip } from '@dv/shared';
import type { MapPalette, PaletteToken } from './views.ts';

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export type Glyph = 'diamond' | 'pin' | 'chevrons' | 'search-ring' | 'hex' | 'house' | 'bag' | 'square' | 'star' | 'ring-dot' | 'arrow' | 'triangle';

export interface BlipStyle { glyph: Glyph; token: PaletteToken }

/** 02-world-maps.md section 3.2: shape and token per kind. The player is the neutral (white) arrow. */
export const BLIP_STYLE: Readonly<Record<BlipKind, BlipStyle>> = {
  mission: { glyph: 'diamond', token: 'objective' },
  waypoint: { glyph: 'pin', token: 'objective' },
  route: { glyph: 'chevrons', token: 'objective' },
  police: { glyph: 'search-ring', token: 'danger' },
  experience: { glyph: 'hex', token: 'friendly' },
  property: { glyph: 'house', token: 'neutral' },
  shop: { glyph: 'bag', token: 'neutral' },
  transit: { glyph: 'square', token: 'neutral' },
  landmark: { glyph: 'star', token: 'neutral' },
  fasttravel: { glyph: 'ring-dot', token: 'friendly' },
  player: { glyph: 'arrow', token: 'neutral' },
  friend: { glyph: 'triangle', token: 'friendly' },
};
export const BLIP_KINDS = Object.keys(BLIP_STYLE) as BlipKind[];

export function styleOf(kind: BlipKind): BlipStyle {
  return BLIP_STYLE[kind] ?? BLIP_STYLE.landmark;
}

const TAU = Math.PI * 2;

/** The outline of a polygon with `n` corners and circumradius `r`, first corner up. */
function poly(ctx: Ctx2D, n: number, r: number, rot = 0): void {
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * TAU - Math.PI / 2;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/**
 * Draws one blip glyph centred at the origin of the current transform, `s` pixels across. `edge` is the casing colour (a palette
 * token, drawn under the glyph so it reads on every ground). `radiusPx` sizes the search ring of a police blip.
 */
export function drawGlyph(ctx: Ctx2D, glyph: Glyph, s: number, fill: string, edge: string, radiusPx = 0): void {
  const r = s / 2;
  ctx.lineWidth = Math.max(1, s / 7);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.fillStyle = fill;
  ctx.strokeStyle = edge;
  switch (glyph) {
    case 'diamond':
      poly(ctx, 4, r * 1.2);
      break;
    case 'pin':
      ctx.beginPath();
      ctx.arc(0, -r * 0.35, r * 0.75, Math.PI * 0.85, Math.PI * 2.15);
      ctx.lineTo(0, r * 1.05);
      ctx.closePath();
      break;
    case 'chevrons':
      ctx.beginPath();
      ctx.moveTo(-r, -r * 0.2);
      ctx.lineTo(0, -r * 0.9);
      ctx.lineTo(r, -r * 0.2);
      ctx.moveTo(-r, r * 0.5);
      ctx.lineTo(0, -r * 0.2);
      ctx.lineTo(r, r * 0.5);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-r, -r * 0.2);
      ctx.lineTo(0, -r * 0.9);
      ctx.lineTo(r, -r * 0.2);
      ctx.moveTo(-r, r * 0.5);
      ctx.lineTo(0, -r * 0.2);
      ctx.lineTo(r, r * 0.5);
      ctx.strokeStyle = fill;
      ctx.stroke();
      return;
    case 'search-ring': {
      const rr = Math.max(r, radiusPx);
      ctx.beginPath();
      ctx.arc(0, 0, rr, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = fill;
      ctx.lineWidth = Math.max(1, s / 10);
      ctx.beginPath();
      ctx.arc(0, 0, rr, 0, TAU);
      ctx.stroke();
      return;
    }
    case 'hex':
      poly(ctx, 6, r * 1.05);
      break;
    case 'house':
      ctx.beginPath();
      ctx.moveTo(-r * 0.8, r * 0.8);
      ctx.lineTo(-r * 0.8, -r * 0.1);
      ctx.lineTo(0, -r * 0.95);
      ctx.lineTo(r * 0.8, -r * 0.1);
      ctx.lineTo(r * 0.8, r * 0.8);
      ctx.closePath();
      break;
    case 'bag':
      ctx.beginPath();
      ctx.rect(-r * 0.75, -r * 0.35, r * 1.5, r * 1.2);
      ctx.moveTo(-r * 0.35, -r * 0.35);
      ctx.arc(0, -r * 0.35, r * 0.35, Math.PI, TAU);
      break;
    case 'square':
      ctx.beginPath();
      ctx.rect(-r * 0.8, -r * 0.8, r * 1.6, r * 1.6);
      break;
    case 'star': {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU - Math.PI / 2;
        const rr = i % 2 === 0 ? r * 1.15 : r * 0.5;
        const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      break;
    }
    case 'ring-dot':
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.95, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = fill;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.95, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.35, 0, TAU);
      ctx.fill();
      return;
    case 'arrow':
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.15);
      ctx.lineTo(r * 0.85, r * 0.85);
      ctx.lineTo(0, r * 0.4);
      ctx.lineTo(-r * 0.85, r * 0.85);
      ctx.closePath();
      break;
    case 'triangle':
      poly(ctx, 3, r * 1.1);
      break;
  }
  ctx.stroke();
  ctx.fill();
}

export interface BlipDrawOptions {
  /** Glyph size in pixels (default 12). */
  sizePx?: number;
  /** The blip lies outside the view and is clamped to the rim: a small outward chevron is drawn behind the glyph. */
  rimAngle?: number | null;
  /** Radius of a police search ring in pixels. */
  radiusPx?: number;
  /** Rotation of the glyph (the player arrow and the friend triangle point along their heading). */
  rotateRad?: number;
}

/** Draws a blip at screen position (px, py). The colour is `palette[token of the kind]`, the casing `palette.land`. */
export function drawBlip(ctx: Ctx2D, b: Pick<MapBlip, 'kind'>, px: number, py: number, palette: MapPalette, o: BlipDrawOptions = {}): void {
  const st = styleOf(b.kind);
  const s = o.sizePx ?? 12;
  ctx.save();
  ctx.translate(px, py);
  if (o.rimAngle !== undefined && o.rimAngle !== null) {
    // the same glyph, smaller, with an outward pointing chevron
    ctx.save();
    ctx.rotate(o.rimAngle + Math.PI / 2);
    ctx.fillStyle = palette[st.token];
    ctx.strokeStyle = palette.land;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.95);
    ctx.lineTo(s * 0.45, -s * 0.5);
    ctx.lineTo(-s * 0.45, -s * 0.5);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    ctx.restore();
  }
  if (o.rotateRad) ctx.rotate(o.rotateRad);
  drawGlyph(ctx, st.glyph, o.rimAngle !== undefined && o.rimAngle !== null ? s * 0.8 : s, palette[st.token], palette.land, o.radiusPx ?? 0);
  ctx.restore();
}

/**
 * Draws the GPS route (x, z pairs in screen pixels after `project`): a casing, the line in the objective colour, and chevrons every
 * `chevronEveryPx` along it. `points` is the `Float32Array` of the view model (at most 400 points).
 */
export function drawRoute(
  ctx: Ctx2D,
  points: Float32Array | null,
  project: (x: number, z: number, out: [number, number]) => void,
  palette: MapPalette,
  widthPx = 4,
  chevronEveryPx = 56,
): number {
  if (!points || points.length < 4) return 0;
  const n = points.length >> 1;
  const xy: number[] = [];
  const tmp: [number, number] = [0, 0];
  for (let i = 0; i < n; i++) {
    project(points[i * 2] as number, points[i * 2 + 1] as number, tmp);
    xy.push(tmp[0], tmp[1]);
  }
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const path = (): void => {
    ctx.beginPath();
    ctx.moveTo(xy[0] as number, xy[1] as number);
    for (let i = 1; i < n; i++) ctx.lineTo(xy[i * 2] as number, xy[i * 2 + 1] as number);
  };
  ctx.strokeStyle = palette.land;
  ctx.lineWidth = widthPx + 2;
  path();
  ctx.stroke();
  ctx.strokeStyle = palette.objective;
  ctx.lineWidth = widthPx;
  path();
  ctx.stroke();
  // chevrons along the line
  let carried = chevronEveryPx / 2;
  ctx.fillStyle = palette.land;
  for (let i = 1; i < n; i++) {
    const x0 = xy[(i - 1) * 2] as number, y0 = xy[(i - 1) * 2 + 1] as number, x1 = xy[i * 2] as number, y1 = xy[i * 2 + 1] as number;
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 1e-3) continue;
    const ang = Math.atan2(y1 - y0, x1 - x0);
    let d = chevronEveryPx - carried;
    while (d <= len) {
      const cx = x0 + ((x1 - x0) * d) / len, cy = y0 + ((y1 - y0) * d) / len;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(widthPx * 0.6, 0);
      ctx.lineTo(-widthPx * 0.3, -widthPx * 0.5);
      ctx.lineTo(-widthPx * 0.3, widthPx * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      d += chevronEveryPx;
    }
    carried = (carried + len) % chevronEveryPx;
  }
  ctx.restore();
  return n;
}

/** Clamps a point at (dx, dy) pixels from the centre to the circle of `rimPx`; returns its angle or null when it is inside. */
export function clampToRim(dx: number, dy: number, rimPx: number, out: [number, number]): number | null {
  const d = Math.hypot(dx, dy);
  if (d <= rimPx) {
    out[0] = dx;
    out[1] = dy;
    return null;
  }
  const k = rimPx / d;
  out[0] = dx * k;
  out[1] = dy * k;
  return Math.atan2(dy, dx);
}
