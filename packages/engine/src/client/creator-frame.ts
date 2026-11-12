/**
 * The creator preview's framing (10-ui-pages.md 2.8: the preview is on the left of the panel; BD-FIX-CREATOR-FRAME-01). Pure maths, no
 * three: the canvas size and the part of it the panel leaves free go in, the camera's view offset comes out.
 *
 * "The picture" is what the stage camera draws with no view offset: the turntable axis on the canvas's vertical centre line, the zoom
 * preset's look-at point at the canvas centre, the whole canvas height. The frame moves that picture, as a whole and never stretched,
 * so that its centre is the centre of the free area, and scales it down (never up) until its height fits the free area's height and
 * the figure's turntable cylinder fits the free area's width. A picture that would have to shrink below `FRAME_MIN_SCALE` has no usable
 * free area: the stage then keeps the centred picture.
 */
export interface FrameSize {
  width: number;
  height: number;
}

/** A rectangle in CSS pixels, origin at the canvas's top-left corner, y down. */
export interface FrameRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FrameBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The arguments of `PerspectiveCamera.setViewOffset`, in CSS pixels of the canvas. */
export interface FrameOffset {
  fullWidth: number;
  fullHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CreatorFrame {
  /** False for the centred picture (no free area, or one too small to use). */
  shifted: boolean;
  /** Size of the picture against the centred one, `FRAME_MIN_SCALE` .. 1. */
  scale: number;
  /** Where the turntable axis and the preset's look-at point are drawn. */
  centre: { x: number; y: number };
  /** The box the figure is drawn in: the cylinder its turntable sweeps, across the picture's height. */
  subject: FrameBox;
  /** The free area the frame was made for, cut to the canvas; null for the centred picture. */
  free: FrameRect | null;
  /** The view offset to set; null clears it (the centred picture). */
  offset: FrameOffset | null;
}

/** Below this the figure is too small to read; the stage keeps the centred picture instead. */
export const FRAME_MIN_SCALE = 0.35;

/**
 * Half the drawn width of a vertical cylinder of radius `radiusM` on the camera's axis, `distanceM` away, in half canvas heights of a
 * camera with the vertical field of view `fovDeg`. The silhouette of a cylinder is where the view rays touch it, a little wider than
 * its radius drawn at its centre's depth.
 */
export function cylinderHalfWidth(radiusM: number, distanceM: number, fovDeg: number): number {
  const r = Math.min(radiusM, distanceM * 0.95);
  return r / Math.sqrt(distanceM * distanceM - r * r) / Math.tan((fovDeg * Math.PI) / 360);
}

function centred(canvas: FrameSize, halfWidth: number): CreatorFrame {
  const cx = canvas.width / 2;
  const half = (halfWidth * canvas.height) / 2;
  return {
    shifted: false,
    scale: 1,
    centre: { x: cx, y: canvas.height / 2 },
    subject: { left: cx - half, top: 0, right: cx + half, bottom: canvas.height },
    free: null,
    offset: null,
  };
}

/**
 * The frame of the picture for a canvas of `canvas` CSS pixels whose free area is `free`. `halfWidth` is the figure's half width in the
 * centred picture, in half canvas heights (`cylinderHalfWidth`).
 */
export function creatorFrame(canvas: FrameSize, free: FrameRect | null, halfWidth: number): CreatorFrame {
  const W = canvas.width;
  const H = canvas.height;
  if (!free || !(W > 0) || !(H > 0)) return centred(canvas, halfWidth);
  const left = Math.max(0, free.x);
  const top = Math.max(0, free.y);
  const right = Math.min(W, free.x + free.width);
  const bottom = Math.min(H, free.y + free.height);
  const fw = right - left;
  const fh = bottom - top;
  if (!(fw > 0) || !(fh > 0)) return centred(canvas, halfWidth);
  const figureWidth = halfWidth * H;
  const scale = Math.min(1, fh / H, fw / figureWidth);
  if (!(scale >= FRAME_MIN_SCALE)) return centred(canvas, halfWidth);
  const cx = left + fw / 2;
  const cy = top + fh / 2;
  const fullWidth = W * scale;
  const fullHeight = H * scale;
  const half = (figureWidth * scale) / 2;
  return {
    shifted: true,
    scale,
    centre: { x: cx, y: cy },
    subject: { left: cx - half, top: cy - fullHeight / 2, right: cx + half, bottom: cy + fullHeight / 2 },
    free: { x: left, y: top, width: fw, height: fh },
    // The whole frustum is drawn on a `fullWidth` x `fullHeight` sheet; the canvas is the window of it that starts at (x, y).
    offset: { fullWidth, fullHeight, x: fullWidth / 2 - cx, y: fullHeight / 2 - cy, width: W, height: H },
  };
}
