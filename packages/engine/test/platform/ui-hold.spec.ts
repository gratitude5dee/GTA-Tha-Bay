import { describe, expect, it } from 'vitest';
import type { PerspectiveCamera, Scene } from 'three/webgpu';
import type { BenchmarkResult } from '@dv/shared';
import { hopeless, measureFrames, summarizeFrames, type BenchmarkRenderer } from '../../src/platform/benchmark.ts';
import { createPlatform } from '../../src/platform/create-platform.ts';
import { createMemoryStore } from '../../src/platform/platform-store.ts';
import { NO_QA_FLAGS } from '../../src/platform/qa-flags.ts';
import { UI_HOLD_MS, UiHold, type UiHoldGate } from '../../src/platform/ui-hold.ts';
import type { WorkerPort } from '../../src/assets/client.ts';
import { envFrom, fakeBenchmark, fakeFactory, FakeClock, type FakeRenderer, FakeStorage, FakeTimers, uaFixture } from './fakes.ts';

/** BD-FIX-MENU-BOOT-01: the page's UI goes before the next 3D frame; the benchmark measures only uninterrupted rendering. */

describe('UiHold', () => {
  it('holds for UI_HOLD_MS after each note, and a later note extends it', () => {
    let now = 1000;
    const hold = new UiHold(() => now);
    expect(hold.held(1000)).toBe(false);
    hold.note();
    expect(hold.held(1000)).toBe(true);
    expect(hold.held(1000 + UI_HOLD_MS - 1)).toBe(true);
    expect(hold.held(1000 + UI_HOLD_MS)).toBe(false);
    now = 1300;
    hold.note();
    expect(hold.held(1000 + UI_HOLD_MS)).toBe(true);
    expect(hold.held(1300 + UI_HOLD_MS)).toBe(false);
    // a frame stamped before the note (its callback runs after it) is held too: it would start after the page's work
    expect(hold.held(900)).toBe(true);
    expect(hold.notes).toBe(2);
  });
});

/** A renderer whose animation loop the test drives with explicit timestamps. */
class LoopRenderer implements BenchmarkRenderer {
  cb: ((t: number) => void) | null = null;
  drawn: number[] = [];
  private t = -1;
  info = { reset: (): void => undefined };
  setAnimationLoop(cb: ((t: number) => void) | null): void {
    this.cb = cb;
  }
  render(): void {
    this.drawn.push(this.t);
  }
  /** Calls the loop at `at(0)`, `at(1)`, ... until it stops (at most 10 000 callbacks). */
  runAt(at: (i: number) => number): void {
    for (let i = 0; i < 10_000 && this.cb; i++) {
      this.t = at(i);
      this.cb(this.t);
    }
  }
  /** Calls the loop at `start`, `start + step`, ... until it stops (at most 10 000 callbacks). */
  run(start: number, step: number | ((i: number) => number)): void {
    let t = start;
    for (let i = 0; i < 10_000 && this.cb; i++) {
      this.t = t;
      this.cb(t);
      t += typeof step === 'number' ? step : step(i);
    }
  }
}

function fakeBench(): { scene: Scene; camera: PerspectiveCamera; update(tSec: number): void; path: number[] } {
  const path: number[] = [];
  return { scene: {} as Scene, camera: {} as PerspectiveCamera, update: (s) => void path.push(Math.round(s * 1000)), path };
}

/** A gate that holds over [from, to). */
const window_ = (from: number, to: number): UiHoldGate => ({ held: (t) => t >= from && t < to });

describe('measureFrames: the benchmark leaves a hold out of its measurement', () => {
  const o = { durationMs: 1000, maxFrames: 180, limitMs: 1e9 };

  it('without a hold: one interval per frame and a window of t - first, as before', async () => {
    for (const hold of [undefined, null, { held: () => false }]) {
      const r = new LoopRenderer();
      const bench = fakeBench();
      const done = measureFrames(r, bench, hold === undefined ? o : { ...o, hold });
      r.run(0, 100);
      const deltas = await done;
      expect(deltas).toEqual(Array(10).fill(100));
      // the last frame is drawn at t = 1000 (t - first reaches the 1000 ms window) and the camera path follows t - first
      expect(r.drawn).toEqual([0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);
      expect(bench.path).toEqual([0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);
      expect(r.cb).toBeNull();
    }
  });

  it('without a hold it stops on the same frame as the loop before BD-FIX-MENU-BOOT-01 (60 Hz timestamps, window t - first)', async () => {
    const at = (i: number): number => (i * 1000) / 60 + 3.7;
    // The previous loop, as it was: an interval per callback after the first, stop when t - first reaches the window.
    const before: number[] = [];
    let first = -1;
    let last = -1;
    for (let i = 0; ; i++) {
      const t = at(i);
      if (first < 0) first = t;
      if (last >= 0) before.push(t - last);
      last = t;
      if (t - first >= 3000 || before.length >= 180 + 3) break;
    }
    const r = new LoopRenderer();
    const done = measureFrames(r, fakeBench(), { durationMs: 3000, maxFrames: 180, limitMs: 1e9, hold: { held: () => false } });
    r.runAt(at);
    expect(await done).toEqual(before);
    expect(r.drawn.length).toBe(before.length + 1);
  });

  it('draws nothing while held, drops the interval that spans the hold and keeps the window to drawing time', async () => {
    const r = new LoopRenderer();
    const bench = fakeBench();
    const done = measureFrames(r, bench, { ...o, hold: window_(350, 750) });
    r.run(0, 100);
    const deltas = await done;
    // 400, 500, 600 and 700 are held; the frame at 800 starts a new interval; the window still holds 1000 ms of drawing
    expect(r.drawn).toEqual([0, 100, 200, 300, 800, 900, 1000, 1100, 1200, 1300, 1400, 1500]);
    expect(deltas).toEqual(Array(10).fill(100));
    // the canned camera goes on from where it stopped
    expect(bench.path).toEqual([0, 100, 200, 300, 300, 400, 500, 600, 700, 800, 900, 1000]);
  });

  it('a hold does not change the result: p90 and the hopeless exit see uninterrupted frames only', async () => {
    // A 40 ms tier budget x 1.1 = 44 ms. Frames take 40 ms; a 600 ms hold in the middle would read as a 640 ms frame.
    const limitMs = 44;
    const r = new LoopRenderer();
    const done = measureFrames(r, fakeBench(), { durationMs: 3000, maxFrames: 30, limitMs, hold: window_(150, 750) });
    r.run(0, 40);
    const deltas = await done;
    expect(Math.max(...deltas)).toBe(40);
    expect(summarizeFrames(deltas.slice(3)).p90Ms).toBe(40);
    expect(hopeless(deltas, limitMs)).toBe(false);
    expect(deltas.length).toBe(33);
  });
});

/** A WorkerPort that answers the asset worker's `init` (the pack store opens) and records terminate. */
function answeringPort(log: string[]): WorkerPort {
  const port: WorkerPort = {
    onmessage: null,
    postMessage: (msg) => {
      if (msg.t === 'req' && msg.op === 'init') queueMicrotask(() => port.onmessage?.({ data: { t: 'res', id: msg.id, ok: true, result: { store: 'opfs', mode: 'rw' } } }));
    },
    terminate: () => void log.push('asset.terminate'),
  };
  return port;
}

async function bootPlatform(o: { hold?: UiHold; afterAssetWorker?: () => void; log: string[] }) {
  const factory = fakeFactory();
  const clock = new FakeClock();
  const platform = await createPlatform({
    canvas: { clientWidth: 400, clientHeight: 800, width: 400, height: 800 } as unknown as HTMLCanvasElement,
    flags: NO_QA_FLAGS,
    build: 'b1',
    env: envFrom(uaFixture('iphone-safari')),
    store: createMemoryStore(),
    storage: new FakeStorage(),
    createRenderer: factory.create,
    now: clock.now,
    perfNow: () => 0,
    timers: new FakeTimers(),
    send: () => undefined,
    nav: 'navigate',
    region: null,
    benchmark: (_h, t): Promise<BenchmarkResult> => {
      o.log.push(`benchmark:${t.id}`);
      return fakeBenchmark({})(t);
    },
    attachListeners: false,
    spawnAssetWorker: () => {
      o.log.push('asset.spawn');
      return answeringPort(o.log);
    },
    ...(o.afterAssetWorker ? { afterAssetWorker: o.afterAssetWorker } : {}),
    ...(o.hold ? { uiHold: o.hold } : {}),
  });
  return { platform, renderer: factory.state.renderers[0] as FakeRenderer };
}

describe('createPlatform: the render loop gives way to the page, then resumes with clamped clocks', () => {
  it('skips the frame callbacks inside a hold and resets the clocks once when it ends', async () => {
    let now = 0;
    const hold = new UiHold(() => now);
    const { platform, renderer } = await bootPlatform({ hold, log: [] });
    const drawn: number[] = [];
    platform.host.addFrameListener({ before: (t) => void drawn.push(t) });
    let resets = 0;
    platform.bindEngine({ setPaused: () => undefined, resetClock: () => void (resets += 1) });
    const loop = renderer.loop as (t: number) => void;
    expect(loop).not.toBeNull();
    for (const t of [100, 200, 300]) loop(t);
    now = 320;
    hold.note();
    for (const t of [400, 500, 600, 700, 800, 900]) loop(t);
    // 400 to 700 lie inside the 400 ms hold from 320; 800 draws, after the clocks were reset once
    expect(drawn).toEqual([100, 200, 300, 800, 900]);
    expect(resets).toBe(1);
    platform.dispose();
  });

  it('without a hold every callback the pacer lets through draws, as before', async () => {
    const { platform, renderer } = await bootPlatform({ log: [] });
    const drawn: number[] = [];
    platform.host.addFrameListener({ before: (t) => void drawn.push(t) });
    for (const t of [100, 200, 300, 400]) (renderer.loop as (t: number) => void)(t);
    expect(drawn).toEqual([100, 200, 300, 400]);
    platform.dispose();
  });
});

describe('createPlatform: sim.worker spawns right after asset.worker (BD-FIX-WEBKIT-ATTACH-02)', () => {
  it('calls afterAssetWorker after the asset worker is spawned and before the benchmark', async () => {
    const log: string[] = [];
    const { platform } = await bootPlatform({ log, afterAssetWorker: () => void log.push('sim.spawn') });
    expect(log.slice(0, 2)).toEqual(['asset.spawn', 'sim.spawn']);
    expect(log[2]).toMatch(/^benchmark:/);
    platform.dispose();
  });

  it('a throw from afterAssetWorker costs neither the pack store nor the boot', async () => {
    const log: string[] = [];
    const { platform } = await bootPlatform({
      log,
      afterAssetWorker: () => {
        throw new Error('Worker constructor failed');
      },
    });
    expect(platform.assets).not.toBeNull();
    expect(platform.assets?.storeKind).toBe('opfs');
    expect(log).not.toContain('asset.terminate');
    platform.dispose();
  });
});
