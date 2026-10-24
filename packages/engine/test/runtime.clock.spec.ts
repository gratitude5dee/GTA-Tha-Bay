/**
 * The clock as the page-hosted sim runs it (M02b2): installed by `SimRuntime.boot`, published as the snapshot side block `env`, and
 * driven by the QA debug commands `debug.hour`, `debug.weather` and `debug.clock.pause`; a module adds its own side entries and
 * receives the debug commands the engine does not own.
 */
import type { BootPayload, EnvState, FrameSignal } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import type { SimModule } from '../src/sim/runtime.ts';
import { SimHostImpl } from '../src/sim/sim-host.ts';
import { isDebugCommand } from '../src/sim/transport/envelope.ts';
import { InProcessWorker } from './inprocess-worker.ts';
import { physicsDropConfig } from './scenarios/physics-drop.ts';

const BOOT: BootPayload = { strings: [], prefabs: [], config: { scenario: 'physics-drop' } };
const sig = (frame: number, nowMs: number): FrameSignal => ({ frame, nowMs, dtSec: 1 / 60, paused: false, timeScale: 1 });

async function boot(modules: SimModule[] = []): Promise<{ host: SimHostImpl; worker: InProcessWorker; run(frames: number): void }> {
  const workers: InProcessWorker[] = [];
  const host = new SimHostImpl({
    spawn: () => {
      const w = new InProcessWorker(modules);
      workers.push(w);
      return w;
    },
    sab: true,
    qa: true,
  });
  const started = host.start(physicsDropConfig('canonical', 1), BOOT);
  await workers[0]?.ready();
  await started;
  const worker = workers[0] as InProcessWorker;
  let now = 0;
  let f = 0;
  return {
    host,
    worker,
    run(frames: number) {
      for (let i = 0; i < frames; i++) {
        now += 16.7;
        host.frame(sig(f++, now));
        worker.pump();
      }
      host.frame(sig(f++, now + 16.7));
    },
  };
}

const envOf = (host: SimHostImpl): EnvState => host.view?.cur.side['env'] as EnvState;

describe('the clock in the page-hosted sim (M02b2)', () => {
  it('publishes the EnvState in the snapshot side block and advances 30 game seconds per second', async () => {
    const { host, run } = await boot();
    run(60);
    const a = envOf(host);
    expect(a).toMatchObject({ weather: 'clear', night: 0 });
    run(60);
    const b = envOf(host);
    // 60 ticks are 60 half-seconds: 30 game seconds, an eightieth of an hour.
    expect(b.hour - a.hour).toBeGreaterThan(0.0075);
    expect(b.hour - a.hour).toBeLessThan(0.0092);
    await host.dispose();
  }, 60_000);

  it('debug.hour sets the hour and, with pause, holds it; debug.weather switches at once; debug.clock.pause releases the clock', async () => {
    const { host, worker, run } = await boot();
    run(5);
    expect(worker.runtime?.clock).not.toBeNull();
    host.sendDebug({ t: 'debug.hour', h: 21.5, pause: true });
    host.sendDebug({ t: 'debug.weather', w: 'karl-fog', blendSec: 0 });
    run(30);
    expect(envOf(host)).toMatchObject({ hour: 21.5, night: 1, weather: 'karl-fog', next: 'karl-fog' });
    expect(envOf(host).fogBankM).toBeGreaterThan(200);
    run(30);
    expect(envOf(host).hour).toBe(21.5); // held
    host.sendDebug({ t: 'debug.clock.pause', on: false });
    run(60);
    expect(envOf(host).hour).toBeGreaterThan(21.5);
    await host.dispose();
  }, 60_000);

  it('a module contributes side entries and sees the debug commands', async () => {
    const seen: string[] = [];
    const module: SimModule = { id: 'test', systems: [], side: () => ({ bo: 1 }), onDebug: (c) => void seen.push(c.t) };
    const { host, run } = await boot([module]);
    host.sendDebug({ t: 'debug.blackout', on: true });
    run(10);
    expect(host.view?.cur.side['bo']).toBe(1);
    expect(seen).toContain('debug.blackout');
    await host.dispose();
  }, 60_000);

  it('the new debug commands are validated', () => {
    expect(isDebugCommand({ t: 'debug.hour', h: 13 })).toBe(true);
    expect(isDebugCommand({ t: 'debug.hour', h: 13, pause: true })).toBe(true);
    expect(isDebugCommand({ t: 'debug.hour', h: 'noon' })).toBe(false);
    expect(isDebugCommand({ t: 'debug.weather', w: 'rain', blendSec: 30 })).toBe(true);
    expect(isDebugCommand({ t: 'debug.weather', w: 'hail', blendSec: 30 })).toBe(false);
    expect(isDebugCommand({ t: 'debug.weather', w: 'rain', blendSec: -1 })).toBe(false);
    expect(isDebugCommand({ t: 'debug.clock.pause', on: true })).toBe(true);
    expect(isDebugCommand({ t: 'debug.blackout', on: 1 })).toBe(false);
  });
});
