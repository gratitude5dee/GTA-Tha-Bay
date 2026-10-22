import { describe, expect, it } from 'vitest';
import { GRID_MIN_M, type MapBlip } from '@dv/shared';
import { AreaBannerTracker, BANNER_GAP_TICKS, NHOOD_NONE } from '../src/client/map/banner.ts';
import { MINIMAP_MAX_BLIPS, MINIMAP_MAX_TILES, MINIMAP_VISIBLE_TILES, createMinimap, type TileImage, type TileRaster } from '../src/client/map/minimap.ts';
import { mapPaletteOf, minimapRadiusM, type MapFrame, type MinimapOptions } from '../src/client/map/views.ts';
import { fakeCanvas, fakeTile } from './fixtures/fake-canvas.ts';

class FakeRaster implements TileRaster {
  readonly calls: [number, number, number][] = [];
  readonly tiles: ReturnType<typeof fakeTile>[] = [];
  constructor(readonly inWorker: boolean) {}
  raster(level: 9 | 7, cx: number, cy: number): Promise<TileImage | null> {
    this.calls.push([level, cx, cy]);
    const t = fakeTile();
    this.tiles.push(t);
    return Promise.resolve(t as unknown as TileImage);
  }
}

const opts = (o: Partial<MinimapOptions> = {}): MinimapOptions => ({ sizePx: 160, shape: 'circle', northUp: false, refreshHz: 30, palette: mapPaletteOf('default'), ...o });
const frame = (x: number, z: number, mode: MapFrame['mode'] = 'foot', speedMps = 0, yaw = 0): MapFrame => ({ x, z, yaw, speedMps, mode, heat: 0, tick: 0 });
const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

/** A view with a clock the test advances 100 ms per call (every frame passes the refresh gate). */
function rig(inWorker: boolean, o: Partial<MinimapOptions> = {}) {
  const raster = new FakeRaster(inWorker);
  const cv = fakeCanvas(160, 160);
  let t = 0;
  const view = createMinimap({ raster, now: () => (t += 100) });
  view.attach(cv as unknown as HTMLCanvasElement, opts(o));
  return { raster, cv, view };
}

describe('minimap radius (AC-3)', () => {
  it('is 150 m on foot, clamp(250 + 3 v, 250, 450) driving and 600 racing', () => {
    expect(minimapRadiusM('foot', 0)).toBe(150);
    expect(minimapRadiusM('foot', 40)).toBe(150);
    expect(minimapRadiusM('vehicle', 0)).toBe(250);
    expect(minimapRadiusM('vehicle', 40)).toBe(370);
    expect(minimapRadiusM('vehicle', 100)).toBe(450);
    expect(minimapRadiusM('vehicle', Number.NaN)).toBe(250);
    expect(minimapRadiusM('race', 12)).toBe(600);
  });

  it('draws at those radii for the player on foot, driving at 40 m/s and racing', async () => {
    const { view } = rig(true);
    view.frame(frame(0, 0, 'foot'), [], null);
    expect(view.stats.last.radiusM).toBe(150);
    expect(view.stats.last.level).toBe(9);
    view.frame(frame(0, 0, 'vehicle', 40), [], null);
    expect(view.stats.last.radiusM).toBe(370);
    expect(view.stats.last.level).toBe(7);
    view.frame(frame(0, 0, 'race', 55), [], null);
    expect(view.stats.last.radiusM).toBe(600);
    await settle();
  });
});

describe('minimap tiles (AC-3)', () => {
  it('draws at most 9 tiles per frame, in the 3 x 3 window around the player', async () => {
    const { view, cv, raster } = rig(true);
    for (let i = 0; i < 6; i++) {
      cv.rec.clear();
      view.frame(frame(100, 100, 'race'), [], null);
      await settle();
      expect(cv.rec.count('drawImage')).toBeLessThanOrEqual(MINIMAP_VISIBLE_TILES);
    }
    cv.rec.clear();
    view.frame(frame(100, 100, 'race'), [], null);
    expect(cv.rec.count('drawImage')).toBe(view.stats.last.tilesDrawn);
    expect(view.stats.last.tilesDrawn).toBeGreaterThan(0);
    expect(view.stats.last.tilesDrawn).toBeLessThanOrEqual(9);
    // every z7 tile requested lies in the 3 x 3 window of the player's tile
    const pc = Math.floor((100 - GRID_MIN_M) / 1024);
    for (const [level, cx, cy] of raster.calls) {
      expect(level).toBe(7);
      expect(Math.abs(cx - pc)).toBeLessThanOrEqual(1);
      expect(Math.abs(cy - pc)).toBeLessThanOrEqual(1);
    }
  });

  it('never holds more than 48 tiles while the player crosses the city, closing evicted ones', async () => {
    const { view, raster } = rig(true);
    let maxResident = 0;
    for (let i = 0; i < 400; i++) {
      view.frame(frame(i * 90, i * 40, 'foot'), [], null);
      await settle();
      maxResident = Math.max(maxResident, view.stats.tilesResident);
    }
    expect(maxResident).toBeLessThanOrEqual(MINIMAP_MAX_TILES);
    expect(view.stats.tilesResident).toBeLessThanOrEqual(MINIMAP_MAX_TILES);
    expect(raster.calls.length).toBeGreaterThan(MINIMAP_MAX_TILES);
    expect(raster.tiles.filter((t) => t.closed).length).toBeGreaterThan(0);
    expect(view.stats.tileMisses).toBe(raster.calls.length);
  });

  it('starts at most one chunk per frame without a worker rasteriser, and three with one', async () => {
    const main = rig(false);
    for (let i = 0; i < 5; i++) {
      main.view.frame(frame(100, 100, 'foot'), [], null);
      expect(main.view.stats.last.started).toBeLessThanOrEqual(1);
      await settle();
    }
    expect(main.raster.calls.length).toBe(4);   // the four tiles that meet the 150 m circle at (100, 100), one per frame
    const worker = rig(true);
    worker.view.frame(frame(100, 100, 'foot'), [], null);
    expect(worker.view.stats.last.started).toBe(3);
  });

  it('rasterises each tile once, then draws it from the cache', async () => {
    const { view, raster } = rig(true);
    for (let i = 0; i < 12; i++) {
      view.frame(frame(100, 100, 'foot'), [], null);
      await settle();
    }
    const keys = raster.calls.map((c) => c.join('/'));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('holds back frames faster than the refresh rate', () => {
    const raster = new FakeRaster(true);
    const cv = fakeCanvas();
    let t = 0;
    const view = createMinimap({ raster, now: () => t });
    view.attach(cv as unknown as HTMLCanvasElement, opts({ refreshHz: 20 }));
    view.frame(frame(0, 0), [], null);
    expect(view.stats.last.skipped).toBe(false);
    t = 20;
    view.frame(frame(0, 0), [], null);
    expect(view.stats.last.skipped).toBe(true);
    t = 60;
    view.frame(frame(0, 0), [], null);
    expect(view.stats.last.skipped).toBe(false);
  });
});

describe('minimap blips (AC-3)', () => {
  const blip = (i: number, x: number, z: number, kind: MapBlip['kind'] = 'mission'): MapBlip => ({ id: `b${i}`, kind, shape: 'diamond', colorToken: 'x', x, z, priority: 100 - i });

  it('draws at most 64 blips', () => {
    const { view } = rig(true);
    const blips = Array.from({ length: 100 }, (_v, i) => blip(i, (i % 10) * 5, Math.floor(i / 10) * 5));
    view.frame(frame(0, 0), blips, null);
    expect(view.stats.last.blipsDrawn).toBe(MINIMAP_MAX_BLIPS);
  });

  it('clamps blips outside the radius to the rim', () => {
    const { view, cv } = rig(true);
    view.frame(frame(0, 0), [blip(1, 5000, 0), blip(2, 0, -9000, 'waypoint'), blip(3, 20, 10, 'shop')], null);
    expect(view.stats.last.rimBlips).toBe(2);
    const half = 80;
    const centres = cv.rec.ops.filter((o) => o[0] === 'translate').map((o) => Math.hypot(o[1] as number, o[2] as number));
    // the first translate is the view centre; every glyph translate is inside the circle
    for (const d of centres.slice(1)) expect(d).toBeLessThanOrEqual(half + 1e-6);
  });

  it('keeps the heading up by rotating the map with the yaw and the north up by not rotating it', () => {
    const headingUp = rig(true);
    headingUp.view.frame(frame(0, 0, 'foot', 0, 1), [], null);
    expect(headingUp.cv.rec.ops.some((o) => o[0] === 'rotate' && o[1] === 1)).toBe(true);
    const northUp = rig(true, { northUp: true });
    northUp.view.frame(frame(0, 0, 'foot', 0, 1), [], null);
    expect(northUp.cv.rec.ops.some((o) => o[0] === 'rotate' && o[1] === 1)).toBe(false);
  });

  it('shows no attribution label', () => {
    const { view, cv } = rig(true);
    view.frame(frame(0, 0), [], null);
    expect(cv.rec.count('fillText')).toBe(0);
    expect(cv.rec.count('strokeText')).toBe(0);
  });

  it('draws nothing after dispose', () => {
    const { view, cv } = rig(true);
    view.dispose();
    cv.rec.clear();
    view.frame(frame(0, 0), [], null);
    expect(cv.rec.ops).toEqual([]);
  });
});

describe('neighbourhood banner (AC-6)', () => {
  const slugs = ['mission', 'soma', 'castro'];

  it('emits nhood.<slug> once per change and at most once per 3 s', () => {
    const b = new AreaBannerTracker(slugs);
    const out: string[] = [];
    const feed = (tick: number, idx: number): void => {
      const p = b.update(tick, idx);
      if (p) out.push(p.key);
    };
    // a path across three neighbourhoods, twice, inside 3 s
    [0, 1, 2, 0, 1, 2].forEach((idx, i) => feed(i * 20, idx));
    expect(out).toEqual(['nhood.mission']);
    // still in the last one when the quiet period ends
    feed(BANNER_GAP_TICKS + 1, 2);
    feed(BANNER_GAP_TICKS + 2, 2);
    expect(out).toEqual(['nhood.mission', 'nhood.castro']);
    expect(b.emittedCount).toBe(2);
  });

  it('drops a change the player has already left when the quiet period ends', () => {
    const b = new AreaBannerTracker(slugs);
    expect(b.update(0, 0)?.key).toBe('nhood.mission');
    expect(b.update(30, 1)).toBeNull();
    expect(b.update(60, 0)).toBeNull();
    expect(b.update(BANNER_GAP_TICKS + 5, 0)).toBeNull();
    expect(b.emittedCount).toBe(1);
  });

  it('ignores the outside (255) and unknown indices, and starts again after reset', () => {
    const b = new AreaBannerTracker(slugs, 60);
    expect(b.update(0, NHOOD_NONE)).toBeNull();
    expect(b.update(0, 99)).toBeNull();
    expect(b.update(10, 2)?.key).toBe('nhood.castro');
    expect(b.update(80, 1)?.key).toBe('nhood.soma');
    b.reset();
    expect(b.current).toBe(NHOOD_NONE);
    expect(b.update(90, 1)?.key).toBe('nhood.soma');
  });
});
