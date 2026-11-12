/**
 * The creator preview's framing maths (BD-FIX-CREATOR-FRAME-01): canvas size and free area in, view offset out. Each frame is also set
 * on a real `PerspectiveCamera`, so the numbers are the ones the stage draws with: the turntable axis lands on the centre of the free
 * area, the figure's cylinder stays inside it, and a metre is as many pixels wide as it is high.
 */
import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three/webgpu';
import { FRAME_MIN_SCALE, creatorFrame, cylinderHalfWidth, type CreatorFrame, type FrameRect, type FrameSize } from '../src/client/creator-frame.ts';

const FOV = 32;
/** The stage's two presets: camera, look-at point and the figure's cylinder radius. */
const FULL = { eye: [0, 1.05, -3.9], at: [0, 0.92, 0], radius: 0.4 } as const;
const HEAD = { eye: [0, 1.6, -1.15], at: [0, 1.58, 0], radius: 0.32 } as const;
type Preset = typeof FULL | typeof HEAD;
const half = (p: Preset): number => cylinderHalfWidth(p.radius, -p.eye[2], FOV);

/** The stage camera of a preset with a frame applied; returns a projector to canvas CSS pixels. */
function camera(canvas: FrameSize, p: Preset, f: CreatorFrame): (x: number, y: number, z: number) => { x: number; y: number } {
  const cam = new PerspectiveCamera(FOV, canvas.width / canvas.height, 0.1, 40);
  cam.position.set(p.eye[0], p.eye[1], p.eye[2]);
  cam.lookAt(p.at[0], p.at[1], p.at[2]);
  if (f.offset) cam.setViewOffset(f.offset.fullWidth, f.offset.fullHeight, f.offset.x, f.offset.y, f.offset.width, f.offset.height);
  cam.updateMatrixWorld(true);
  const v = new Vector3();
  return (x, y, z) => {
    v.set(x, y, z).project(cam);
    return { x: ((v.x + 1) / 2) * canvas.width, y: ((1 - v.y) / 2) * canvas.height };
  };
}

/** The widest the turning figure is drawn at height `y`: the points of its cylinder the view rays touch. */
function silhouette(project: ReturnType<typeof camera>, p: Preset, y: number): { left: number; right: number } {
  let left = Infinity;
  let right = -Infinity;
  for (let i = 0; i < 360; i++) {
    const a = (i * Math.PI) / 180;
    const at = project(p.radius * Math.cos(a), y, p.radius * Math.sin(a));
    left = Math.min(left, at.x);
    right = Math.max(right, at.x);
  }
  return { left, right };
}

/** Every number of `got` within a millionth of a pixel of `want`. */
function expectNear(got: object | null, want: Record<string, number>): void {
  expect(got).not.toBeNull();
  expect(Object.keys(got as object).sort()).toEqual(Object.keys(want).sort());
  for (const [k, v] of Object.entries(want)) expect((got as Record<string, number>)[k], k).toBeCloseTo(v, 6);
}

function expectInside(f: CreatorFrame): void {
  const free = f.free as FrameRect;
  expect(f.subject.left).toBeGreaterThanOrEqual(free.x - 1e-6);
  expect(f.subject.right).toBeLessThanOrEqual(free.x + free.width + 1e-6);
  expect(f.subject.top).toBeGreaterThanOrEqual(free.y - 1e-6);
  expect(f.subject.bottom).toBeLessThanOrEqual(free.y + free.height + 1e-6);
}

/** What every shifted frame must do on the real camera, at both presets. */
function expectDrawn(canvas: FrameSize, p: Preset, f: CreatorFrame): void {
  const project = camera(canvas, p, f);
  // the turntable axis is drawn on the centre line of the free area, floor and head alike, and the look-at point at the centre
  expect(project(0, 0, 0).x).toBeCloseTo(f.centre.x, 6);
  expect(project(0, 1.9, 0).x).toBeCloseTo(f.centre.x, 6);
  const at = project(p.at[0], p.at[1], p.at[2]);
  expect(at.x).toBeCloseTo(f.centre.x, 6);
  expect(at.y).toBeCloseTo(f.centre.y, 6);
  // the turning figure stays inside the subject box, which is as wide as the cylinder is drawn
  const s = silhouette(project, p, p.at[1]);
  expect(s.left).toBeGreaterThanOrEqual(f.subject.left - 0.5);
  expect(s.right).toBeLessThanOrEqual(f.subject.right + 0.5);
  expect(s.right - s.left).toBeGreaterThan((f.subject.right - f.subject.left) * 0.97);
  // undistorted: 10 cm across is as many pixels as 10 cm up
  const a = project(0.05, p.at[1], 0).x - project(-0.05, p.at[1], 0).x;
  const b = project(0, p.at[1] - 0.05, 0).y - project(0, p.at[1] + 0.05, 0).y;
  expect(Math.abs(a)).toBeCloseTo(Math.abs(b), 1);
  // the picture's top and bottom edges are the subject's
  const sheet = f.scale * canvas.height;
  expect(f.subject.bottom - f.subject.top).toBeCloseTo(sheet, 6);
}

describe('creator frame', () => {
  it('desktop 1600 x 900 with the panel from x = 737: the figure is centred in the area left of the panel at both presets', () => {
    const canvas = { width: 1600, height: 900 };
    // the preview section (16 px page padding, 16 px gap to the panel) down to the top of the zoom buttons
    const free = { x: 16, y: 16, width: 705, height: 780 };
    const full = creatorFrame(canvas, free, half(FULL));
    expect(full.shifted).toBe(true);
    expectNear(full.centre, { x: 368.5, y: 406 });
    // the picture shrinks only as far as the free height asks
    expect(full.scale).toBeCloseTo(780 / 900, 9);
    expectNear(full.offset, { fullWidth: (1600 * 780) / 900, fullHeight: 780, x: (800 * 780) / 900 - 368.5, y: 390 - 406, width: 1600, height: 900 });
    expectInside(full);
    expect(full.subject.right).toBeLessThan(737);
    expectDrawn(canvas, FULL, full);

    // the head and shoulders are wider than the free area at the full picture size, so the head preset shrinks to its width
    const head = creatorFrame(canvas, free, half(HEAD));
    expect(head.shifted).toBe(true);
    expectNear(head.centre, { x: 368.5, y: 406 });
    expect(head.scale).toBeCloseTo(705 / (half(HEAD) * 900), 9);
    expect(head.scale).toBeLessThan(780 / 900);
    expect(head.subject.left).toBeCloseTo(16, 6);
    expect(head.subject.right).toBeCloseTo(721, 6);
    expectInside(head);
    expectDrawn(canvas, HEAD, head);
  });

  it('phone 844 x 390 with the panel from about x = 395: both presets fit the free area above the zoom buttons', () => {
    const canvas = { width: 844, height: 390 };
    const free = { x: 16, y: 16, width: 363, height: 270 };
    for (const p of [FULL, HEAD]) {
      const f = creatorFrame(canvas, free, half(p));
      expect(f.shifted).toBe(true);
      expectNear(f.centre, { x: 197.5, y: 151 });
      expect(f.scale).toBeCloseTo(270 / 390, 9);
      expectInside(f);
      expect(f.subject.right).toBeLessThan(395);
      expect(f.subject.bottom).toBeCloseTo(286, 6);
      expectDrawn(canvas, p, f);
    }
  });

  it('no free area keeps the centred picture: null, an empty area, an area off the canvas', () => {
    const canvas = { width: 390, height: 844 };
    for (const free of [null, { x: 0, y: 0, width: 0, height: 844 }, { x: 16, y: 16, width: 358, height: 0 }, { x: 400, y: 0, width: 200, height: 844 }, { x: -300, y: 0, width: 200, height: 844 }]) {
      const f = creatorFrame(canvas, free, half(FULL));
      expect(f.shifted).toBe(false);
      expect(f.offset).toBeNull();
      expect(f.free).toBeNull();
      expect(f.scale).toBe(1);
      expect(f.centre).toEqual({ x: 195, y: 422 });
      expect(f.subject.top).toBe(0);
      expect(f.subject.bottom).toBe(844);
      // no offset on the camera: the axis is on the canvas's centre line, as before
      expectNear(camera(canvas, FULL, f)(0, 0.92, 0), { x: 195, y: 422 });
    }
  });

  it('a free area narrower than the figure shrinks the picture to its width; one too narrow to use keeps the centred picture', () => {
    const canvas = { width: 1600, height: 900 };
    const figure = half(FULL) * 900;
    expect(figure).toBeGreaterThan(300);
    // 200 px for a figure about 324 px wide: the picture is drawn at 200 / 324 of its size, the figure exactly as wide as the area
    const narrow = creatorFrame(canvas, { x: 40, y: 0, width: 200, height: 900 }, half(FULL));
    expect(narrow.shifted).toBe(true);
    expect(narrow.scale).toBeCloseTo(200 / figure, 9);
    expect(narrow.subject.left).toBeCloseTo(40, 6);
    expect(narrow.subject.right).toBeCloseTo(240, 6);
    expectNear(narrow.centre, { x: 140, y: 450 });
    // centred in the free height, with room above and below
    expect(narrow.subject.top).toBeCloseTo(450 - (900 * narrow.scale) / 2, 6);
    expectInside(narrow);
    expectDrawn(canvas, FULL, narrow);

    // under the smallest scale the figure could not be read: the centred picture stays
    const sliver = creatorFrame(canvas, { x: 0, y: 0, width: figure * FRAME_MIN_SCALE - 1, height: 900 }, half(FULL));
    expect(sliver.shifted).toBe(false);
    expect(sliver.offset).toBeNull();
    const edge = creatorFrame(canvas, { x: 0, y: 0, width: figure * FRAME_MIN_SCALE + 1, height: 900 }, half(FULL));
    expect(edge.shifted).toBe(true);
    // the same rule for a free area too low
    expect(creatorFrame(canvas, { x: 0, y: 0, width: 700, height: 900 * FRAME_MIN_SCALE - 1 }, half(FULL)).shifted).toBe(false);
  });

  it('a free area that reaches past the canvas is cut to it, and the picture is never enlarged', () => {
    const canvas = { width: 1600, height: 900 };
    const f = creatorFrame(canvas, { x: -50, y: -20, width: 900, height: 2000 }, half(FULL));
    expect(f.free).toEqual({ x: 0, y: 0, width: 850, height: 900 });
    expect(f.scale).toBe(1);
    expect(f.centre).toEqual({ x: 425, y: 450 });
    expectNear(f.offset, { fullWidth: 1600, fullHeight: 900, x: 375, y: 0, width: 1600, height: 900 });
    // the whole canvas free is the centred picture, by another route
    const whole = creatorFrame(canvas, { x: 0, y: 0, width: 1600, height: 900 }, half(FULL));
    expectNear(whole.offset, { fullWidth: 1600, fullHeight: 900, x: 0, y: 0, width: 1600, height: 900 });
    expect(whole.subject).toEqual(creatorFrame(canvas, null, half(FULL)).subject);
  });

  it('resize: the frame follows the canvas and the free area, landscape to landscape and into a one-column portrait window', () => {
    const before = creatorFrame({ width: 1600, height: 900 }, { x: 16, y: 16, width: 705, height: 780 }, half(FULL));
    // the window is made smaller: the panel now starts at x = 475, the buttons at y = 496
    const canvas = { width: 1024, height: 600 };
    const after = creatorFrame(canvas, { x: 16, y: 16, width: 443, height: 480 }, half(FULL));
    expect(after.shifted).toBe(true);
    expectNear(after.centre, { x: 237.5, y: 256 });
    expect(after.scale).toBeCloseTo(480 / 600, 9);
    expect(after.centre.x).not.toBe(before.centre.x);
    expectInside(after);
    expectDrawn(canvas, FULL, after);
    // the same frame for the same input: nothing is kept between calls
    expect(creatorFrame(canvas, { x: 16, y: 16, width: 443, height: 480 }, half(FULL))).toEqual(after);
    // a narrow portrait window: the panel is under the preview and covers the whole width, the page reports no free area
    const portrait = creatorFrame({ width: 390, height: 844 }, null, half(FULL));
    expect(portrait.shifted).toBe(false);
    expect(portrait.centre).toEqual({ x: 195, y: 422 });
  });

  it('the cylinder is drawn a little wider than its radius at the axis, and never wider than the view allows', () => {
    const flat = 0.4 / 3.9 / Math.tan((FOV * Math.PI) / 360);
    expect(half(FULL)).toBeGreaterThan(flat);
    expect(half(FULL)).toBeLessThan(flat * 1.01);
    expect(Number.isFinite(cylinderHalfWidth(5, 1, FOV))).toBe(true);
  });
});
