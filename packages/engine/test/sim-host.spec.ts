import type { BootPayload, FrameSignal, SimConfig } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { SimHostImpl } from '../src/sim/sim-host.ts';
import { InProcessWorker } from './inprocess-worker.ts';
import { physicsDropConfig } from './scenarios/physics-drop.ts';

const BOOT: BootPayload = { strings: [], prefabs: [], config: { scenario: 'physics-drop' } };
const sig = (frame: number, nowMs: number, dtSec = 1 / 60, paused = false): FrameSignal => ({ frame, nowMs, dtSec, paused, timeScale: 1 });

function makeHost(onCrash?: (r: string, d: string) => void): { host: SimHostImpl; workers: InProcessWorker[] } {
  const workers: InProcessWorker[] = [];
  const host = new SimHostImpl({
    spawn: () => {
      const w = new InProcessWorker();
      workers.push(w);
      return w;
    },
    sab: true,
    qa: true,
    ...(onCrash ? { onCrash } : {}),
  });
  return { host, workers };
}

/** `start` waits for the worker's ready event, which fires after the async boot. */
async function startHost(host: SimHostImpl, workers: InProcessWorker[], cfg: SimConfig): Promise<void> {
  const started = host.start(cfg, BOOT);
  await workers[workers.length - 1]?.ready();
  await started;
}

describe('SimHost over SimCore', () => {
  it('start boots the worker; frame sends the signal and reads the snapshot pair; stats arrive as events', async () => {
    const { host, workers } = makeHost();
    await startHost(host, workers, physicsDropConfig('canonical', 1));
    expect(host.kind).toBe('sab');
    let now = 0;
    for (let f = 0; f < 120; f++) {
      now += 16.7;
      host.frame(sig(f, now));
      workers[0]?.pump();
    }
    host.frame(sig(121, now + 16.7));
    expect(host.view?.cur.tick).toBeGreaterThanOrEqual(110);
    expect(host.view?.cur.count).toBeGreaterThanOrEqual(64);
    expect(host.report?.physicsBuild).toBe('deterministic-compat');
    expect(host.stats.tick).toBeGreaterThan(0);
    expect(host.crashed).toBeNull();
    await host.dispose();
    expect(workers[0]?.terminated).toBe(true);
  }, 60_000);

  it('a worker that stops producing snapshots for 2 s while frames flow is reported as stalled', async () => {
    const crashes: string[] = [];
    const { host, workers } = makeHost((r, d) => crashes.push(`${r}: ${d}`));
    await startHost(host, workers, physicsDropConfig('canonical'));
    let now = 0;
    for (let f = 0; f < 10; f++) {
      now += 16.7;
      host.frame(sig(f, now));
      workers[0]?.pump();
    }
    // The worker is stuck: frames keep flowing, nothing is pumped.
    for (let f = 10; f < 200; f++) {
      now += 16.7;
      host.frame(sig(f, now));
    }
    expect(crashes).toHaveLength(1);
    expect(crashes[0]).toMatch(/^stalled: no snapshot for/);
    expect(host.crashed).toMatch(/^stalled/);
    await host.dispose();
  }, 60_000);

  it('slow frames (0.8 s apart, a page on software GL) are not a stall in 2 s of wall time; a stuck worker is still caught after enough of them (BD-REPAIR-M10d1-03)', async () => {
    const crashes: string[] = [];
    const { host, workers } = makeHost((r, d) => crashes.push(`${r}: ${d}`));
    await startHost(host, workers, physicsDropConfig('canonical'));
    let now = 0;
    for (let f = 0; f < 3; f++) {
      now += 16.7;
      host.frame(sig(f, now));
      workers[0]?.pump();
    }
    // The worker answers late: three frames 0.8 s apart (2.4 s of wall time) with no fresh snapshot.
    for (let f = 3; f < 6; f++) {
      now += 800;
      host.frame(sig(f, now));
    }
    expect(crashes).toEqual([]);
    workers[0]?.pump();
    now += 800;
    host.frame(sig(6, now));
    expect(crashes).toEqual([]);
    // Stuck for good: 0.8 s frames, each worth 250 ms, so the ninth frame without a snapshot is the stall.
    for (let f = 7; f < 40; f++) {
      now += 800;
      host.frame(sig(f, now));
    }
    expect(crashes).toHaveLength(1);
    expect(crashes[0]).toMatch(/^stalled: no snapshot for/);
    await host.dispose();
  }, 60_000);

  it('hiding the page (a long gap between frames) or pausing does not count as a stall', async () => {
    const crashes: string[] = [];
    const { host, workers } = makeHost((r, d) => crashes.push(`${r}: ${d}`));
    await startHost(host, workers, physicsDropConfig('canonical'));
    host.frame(sig(0, 100));
    workers[0]?.pump();
    host.frame(sig(1, 60_000)); // tab was hidden for a minute
    host.frame(sig(2, 60_017));
    expect(crashes).toEqual([]);
    for (let f = 3; f < 400; f++) host.frame(sig(f, 60_017 + f * 16.7, 1 / 60, true)); // paused: no ticks, no stall
    expect(crashes).toEqual([]);
    await host.dispose();
  }, 60_000);

  it('a worker error event is reported once', async () => {
    const crashes: string[] = [];
    const { host, workers } = makeHost((r, d) => crashes.push(`${r}: ${d}`));
    await startHost(host, workers, physicsDropConfig('canonical'));
    workers[0]?.fail('boom');
    workers[0]?.fail('boom again');
    expect(crashes).toEqual(['error: boom']);
    await host.dispose();
  }, 60_000);

  it('restart terminates the worker and starts another one with the other build; restarts counts it', async () => {
    const { host, workers } = makeHost();
    await startHost(host, workers, physicsDropConfig('canonical'));
    expect(host.cfg?.physicsBuild).toBe('deterministic-compat');
    const restarted = host.restart(physicsDropConfig('local'));
    await workers[1]?.ready();
    await restarted;
    expect(workers[0]?.terminated).toBe(true);
    expect(workers).toHaveLength(2);
    expect(workers[1]?.cfg?.physicsBuild).toBe('simd-compat');
    expect(host.restarts).toBe(1);
    expect(host.crashed).toBeNull();
    // The new session runs.
    host.frame(sig(0, 10));
    workers[1]?.pump();
    host.frame(sig(1, 26.7));
    workers[1]?.pump();
    host.frame(sig(2, 43.4));
    expect(host.view?.cur.tick).toBeGreaterThan(0);
    await host.dispose();
  }, 60_000);

  it('debug.stall blocks the worker through the injected sleep and debug.step runs ticks while paused', async () => {
    const { host, workers } = makeHost();
    await startHost(host, workers, physicsDropConfig('canonical'));
    const rt = workers[0]?.runtime;
    expect(rt).toBeTruthy();
    let blocked = 0;
    (rt as unknown as { env: { blockFor: (ms: number) => void } }).env.blockFor = (ms) => {
      blocked += ms;
    };
    host.sendDebug({ t: 'debug.stall', ms: 500 });
    workers[0]?.pump();
    expect(blocked).toBe(500);
    host.frame(sig(0, 0, 0, true));
    workers[0]?.pump();
    const before = rt?.sim?.tick ?? -1;
    host.stepOnce();
    host.sendDebug({ t: 'debug.step', n: 4 });
    workers[0]?.pump();
    expect((rt?.sim?.tick ?? 0) - before).toBe(5);
    host.sendDebug({ t: 'debug.rebase', to: [2000, 0, 0] });
    workers[0]?.pump();
    expect(rt?.sim?.backend.origin).toEqual([2000, 0, 0]);
    await host.dispose();
  }, 60_000);

  it('debug commands are ignored when the build is not a QA build, and save.request answers not-implemented', async () => {
    const workers: InProcessWorker[] = [];
    const host = new SimHostImpl({ spawn: () => { const w = new InProcessWorker(); workers.push(w); return w; }, sab: true, qa: false });
    await startHost(host, workers, physicsDropConfig('canonical'));
    host.sendDebug({ t: 'debug.crash' });
    expect(() => workers[0]?.pump()).not.toThrow();
    host.transport?.sendControl({ t: 'save.request', reason: 'hidden' });
    workers[0]?.pump();
    host.frame(sig(0, 10));
    expect(host.events.some((e) => e.t === 'ctl.result' && e.p.ok === false && e.p.reason === 'not-implemented')).toBe(true);
    await host.dispose();
  }, 60_000);

  it('debug.crash throws out of the runtime so the worker shell can report it', async () => {
    const { host, workers } = makeHost();
    await startHost(host, workers, physicsDropConfig('canonical'));
    host.sendDebug({ t: 'debug.crash' });
    expect(() => workers[0]?.pump()).toThrow(/debug\.crash/);
    await host.dispose();
  }, 60_000);
});
