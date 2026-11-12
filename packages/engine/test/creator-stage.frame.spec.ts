/**
 * The creator stage frames its figure in the free area the page reports (BD-FIX-CREATOR-FRAME-01): the drawn figure, measured from its
 * own vertices through the stage camera, is centred in the area and stays inside it at both zoom presets, for the mannequin and for
 * the widest assembled figure, at every turn of the turntable; without a free area the picture stays centred; a canvas that changes
 * size is framed again.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PerspectiveCamera } from 'three/webgpu';
import { createCreatorStage, type CreatorStage, type StageAssets, type StageHost, type StageMeasure, type StageParams, type StagePart } from '../src/client/creator-stage.ts';
import type { FrameBox, FrameRect } from '../src/client/creator-frame.ts';

const repo = path.resolve(import.meta.dirname, '../../..');
const assets: StageAssets = {
  load: async (ref) => new Uint8Array(readFileSync(path.join(repo, 'assets/src/character', ref.replace('character/', ''), 'mobile.glb'))),
};
const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};

const model = (slot: StagePart['slot'], id: string): StagePart => ({ slot, ref: `character/pc-${id}`, path: 'model' });
const MANNEQUIN: StagePart[] = [{ slot: 'body', ref: '', path: 'mannequin' }, { slot: 'face', ref: '', path: 'mannequin' }];
/** The widest figure of the kit: the widest body, top, bottom and shoes, the tallest hair. */
const WIDEST: StagePart[] = [model('body', 'body-broad'), model('face', 'face-karl'), model('hair', 'hair-afro'), model('top', 'top-tee'), model('bottom', 'bottom-skirt'), model('shoes', 'shoes-skate-shoes')];
const params = (parts: StagePart[], heightScale = 1, buildScale = 1): StageParams => ({
  heightScale, buildScale, skin: 0xc58c5f, hair: 0x2a1c14, top: 0x141414, bottom: 0x262c3f, shoes: 0x8b8e93, hairStyle: 1, accessory: true, faceIndex: 1, parts,
});

/** A host with a canvas of a settable CSS size at a settable place in the viewport. */
function fakeHost(width: number, height: number, left = 0, top = 0) {
  const canvas = { clientWidth: width, clientHeight: height, getBoundingClientRect: () => ({ left: canvas.left, top: canvas.top }), left, top };
  let camera: PerspectiveCamera | null = null;
  const host: StageHost = {
    setMenuScene: (_scene, cam) => {
      camera = cam;
    },
    clearMenuScene: () => {
      camera = null;
    },
    currentCanvas: canvas,
  };
  return { host, canvas, camera: () => camera as PerspectiveCamera | null };
}

let frames: ((now: number) => void)[] = [];
/** Runs the stage's pending animation frame, as the browser would. */
const tick = (): void => {
  const run = frames;
  frames = [];
  for (const f of run) f(performance.now());
};

beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (f: (now: number) => void) => frames.push(f));
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const DESKTOP = { canvas: [1600, 900] as const, free: { x: 16, y: 16, width: 705, height: 780 }, panel: 737 };
const PHONE = { canvas: [844, 390] as const, free: { x: 16, y: 16, width: 363, height: 270 }, panel: 395 };

function expectInFree(box: FrameBox, free: FrameRect, why: string): void {
  expect(box.left, `${why} left`).toBeGreaterThanOrEqual(free.x);
  expect(box.right, `${why} right`).toBeLessThanOrEqual(free.x + free.width);
}

/** Turns the figure through a full circle and returns the box around every measured position. */
function sweep(stage: CreatorStage): { box: FrameBox; floor: StageMeasure['floor'] } {
  const box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  let floor = { x: 0, y: 0 };
  for (let i = 0; i < 12; i++) {
    const m = stage.measure() as StageMeasure;
    const f = m.figure as FrameBox;
    box.left = Math.min(box.left, f.left);
    box.right = Math.max(box.right, f.right);
    box.top = Math.min(box.top, f.top);
    box.bottom = Math.max(box.bottom, f.bottom);
    floor = m.floor;
    stage.rotate(Math.PI / 6);
  }
  return { box, floor };
}

describe('creator stage framing', () => {
  for (const [name, view] of [['desktop 1600 x 900', DESKTOP], ['phone 844 x 390', PHONE]] as const) {
    it(`${name}: the mannequin is centred in the free area and inside it, full body and head`, () => {
      const { host } = fakeHost(view.canvas[0], view.canvas[1]);
      const stage = createCreatorStage(host);
      stage.setReducedMotion(true);
      stage.show(params(MANNEQUIN, 1.08, 1.18));
      // before the page reports its layout: the centred picture, with the canvas's aspect ratio
      expect(stage.state.frame).toMatchObject({ shifted: false, scale: 1, canvas: { width: view.canvas[0], height: view.canvas[1] } });
      expect((stage.measure() as StageMeasure).floor.x).toBeCloseTo(view.canvas[0] / 2, 4);

      stage.setFreeArea(view.free);
      const centre = view.free.x + view.free.width / 2;
      for (const zoom of ['full', 'head'] as const) {
        stage.setZoom(zoom);
        const frame = stage.state.frame;
        expect(frame?.shifted, zoom).toBe(true);
        expect(frame?.centre.x, zoom).toBeCloseTo(centre, 6);
        const { box, floor } = sweep(stage);
        // the floor disc's centre and the figure's own centre are on the free area's centre line
        expect(floor.x, zoom).toBeCloseTo(centre, 4);
        expect(Math.abs((box.left + box.right) / 2 - centre), zoom).toBeLessThan(1);
        expectInFree(box, view.free, zoom);
        expect(box.right, zoom).toBeLessThan(view.panel);
        // inside the subject box the frame promises
        expect(box.left, zoom).toBeGreaterThanOrEqual((frame?.subject.left ?? 0) - 0.5);
        expect(box.right, zoom).toBeLessThanOrEqual((frame?.subject.right ?? 0) + 0.5);
        // and it is the figure that was measured, not a speck: more than half of the box
        expect(box.right - box.left, zoom).toBeGreaterThan(((frame?.subject.right ?? 0) - (frame?.subject.left ?? 0)) * 0.5);
      }
      // full body: feet and head are inside the free area vertically too
      stage.setZoom('full');
      const full = sweep(stage).box;
      expect(full.top).toBeGreaterThanOrEqual(view.free.y);
      expect(full.bottom).toBeLessThanOrEqual(view.free.y + view.free.height);
      stage.hide();
    });

    it(`${name}: the widest assembled figure at the widest build stays inside the free area, full body and head`, async () => {
      const { host } = fakeHost(view.canvas[0], view.canvas[1]);
      const stage = createCreatorStage(host, assets);
      stage.setReducedMotion(true);
      stage.show(params(WIDEST, 1, 1.18));
      await settle();
      expect(stage.state.figure).toBe('models');
      stage.setFreeArea(view.free);
      const centre = view.free.x + view.free.width / 2;
      for (const zoom of ['full', 'head'] as const) {
        stage.setZoom(zoom);
        const { box, floor } = sweep(stage);
        expect(floor.x, zoom).toBeCloseTo(centre, 4);
        expectInFree(box, view.free, zoom);
        expect(box.right, zoom).toBeLessThan(view.panel);
        expect(box.left, zoom).toBeGreaterThanOrEqual((stage.state.frame?.subject.left ?? 0) - 0.5);
        expect(box.right, zoom).toBeLessThanOrEqual((stage.state.frame?.subject.right ?? 0) + 0.5);
      }
      stage.hide();
    });
  }

  it('the figure is not stretched: the canvas aspect ratio is set at show, not at the host\'s next resize', () => {
    const { host, camera } = fakeHost(1600, 900);
    const stage = createCreatorStage(host);
    stage.show(params(MANNEQUIN));
    expect(camera()?.aspect).toBeCloseTo(1600 / 900, 9);
    stage.setFreeArea(DESKTOP.free);
    expect(camera()?.aspect).toBeCloseTo(1600 / 900, 9);
    const view = camera()?.view;
    expect(view?.enabled).toBe(true);
    // the sheet the frustum is drawn on has the canvas's aspect ratio: no stretch
    expect((view?.fullWidth ?? 0) / (view?.fullHeight ?? 1)).toBeCloseTo(1600 / 900, 9);
    stage.hide();
  });

  it('no free area keeps the centred picture, and null after an area returns to it', () => {
    const { host, camera } = fakeHost(390, 844);
    const stage = createCreatorStage(host);
    stage.setReducedMotion(true);
    stage.show(params(MANNEQUIN));
    stage.setFreeArea(null);
    expect(stage.state.frame).toMatchObject({ shifted: false, offset: null, centre: { x: 195, y: 422 } });
    expect(camera()?.view?.enabled ?? false).toBe(false);
    stage.setFreeArea({ x: 0, y: 0, width: 390, height: 300 });
    expect(stage.state.frame?.shifted).toBe(true);
    expect(camera()?.view?.enabled).toBe(true);
    stage.setFreeArea(null);
    expect(stage.state.frame?.shifted).toBe(false);
    expect(camera()?.view?.enabled).toBe(false);
    expect((stage.measure() as StageMeasure).floor.x).toBeCloseTo(195, 4);
    stage.hide();
  });

  it('the free area is in viewport pixels: a canvas that does not start at the viewport corner is allowed for', () => {
    const { host } = fakeHost(800, 600, 100, 50);
    const stage = createCreatorStage(host);
    stage.show(params(MANNEQUIN));
    stage.setFreeArea({ x: 100, y: 50, width: 400, height: 600 });
    expect(stage.state.frame?.free).toEqual({ x: 0, y: 0, width: 400, height: 600 });
    expect(stage.state.frame?.centre.x).toBeCloseTo(200, 6);
    stage.hide();
  });

  it('a canvas that changes size is framed again on the next frame, and the page\'s new free area is applied at once', () => {
    const { host, canvas, camera } = fakeHost(1600, 900);
    const stage = createCreatorStage(host);
    stage.setReducedMotion(true);
    stage.show(params(MANNEQUIN));
    stage.setFreeArea(DESKTOP.free);
    expect(stage.state.frame?.canvas).toEqual({ width: 1600, height: 900 });
    canvas.clientWidth = 1024;
    canvas.clientHeight = 600;
    tick();
    expect(stage.state.frame?.canvas).toEqual({ width: 1024, height: 600 });
    expect(camera()?.aspect).toBeCloseTo(1024 / 600, 9);
    // the page's observers then report the layout of the new window
    const free = { x: 16, y: 16, width: 443, height: 480 };
    stage.setFreeArea(free);
    expect(stage.state.frame?.centre.x).toBeCloseTo(237.5, 6);
    const { box, floor } = sweep(stage);
    expect(floor.x).toBeCloseTo(237.5, 4);
    expectInFree(box, free, 'after resize');
    // the same area again changes nothing
    const before = stage.state.frame;
    stage.setFreeArea({ ...free });
    expect(stage.state.frame).toBe(before);
    stage.hide();
  });

  it('hide forgets the free area; a host without a canvas keeps the camera as the host set it', () => {
    const { host } = fakeHost(1600, 900);
    const stage = createCreatorStage(host);
    stage.show(params(MANNEQUIN));
    stage.setFreeArea(DESKTOP.free);
    stage.hide();
    expect(stage.measure()).toBeNull();
    stage.show(params(MANNEQUIN));
    expect(stage.state.frame?.shifted).toBe(false);
    stage.hide();

    let cam: PerspectiveCamera | null = null;
    const bare: StageHost = { setMenuScene: (_s, c) => (cam = c), clearMenuScene: () => undefined };
    const plain = createCreatorStage(bare);
    plain.show(params(MANNEQUIN));
    plain.setFreeArea(DESKTOP.free);
    expect(plain.state.frame).toBeNull();
    expect((cam as PerspectiveCamera | null)?.view ?? null).toBeNull();
    expect(plain.measure()).toBeNull();
    plain.hide();
  });
});
