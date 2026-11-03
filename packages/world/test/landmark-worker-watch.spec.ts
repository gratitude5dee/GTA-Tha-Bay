/**
 * BD-FIX-LANDMARK-PREPARE-01: `WorkerWatch` counts how long asset.worker has said nothing while the landmark layer asks it something,
 * each frame adding at most 250 ms, so frames that take seconds on a busy page (whose messages wait behind them) do not make a live
 * worker look gone.
 */
import { describe, expect, it } from 'vitest';
import { SILENT_FRAME_CAP_MS, WorkerWatch } from '../src/client/chunks/worker-watch.ts';

function line(): { heard: number; answers: (() => void)[]; watch: WorkerWatch } {
  const l = { heard: 0, answers: [] as (() => void)[], watch: null as unknown as WorkerWatch };
  l.watch = new WorkerWatch({
    held: () => new Promise((res) => l.answers.push(() => res([]))),
    heard: () => l.heard,
  });
  return l;
}

describe('WorkerWatch', () => {
  it('counts nothing while no question is out, however long the frames', () => {
    const l = line();
    for (let t = 0; t <= 60_000; t += 5000) l.watch.frame(t);
    expect(l.watch.silentMs).toBe(0);
  });

  it('while a question is out, each silent frame adds its length, at most 250 ms', () => {
    const l = line();
    l.watch.frame(0);
    void l.watch.ask([1]);
    l.watch.frame(16);
    l.watch.frame(32);
    expect(l.watch.silentMs).toBe(32);
    l.watch.frame(5032);
    expect(l.watch.silentMs).toBe(32 + SILENT_FRAME_CAP_MS);
  });

  it('anything heard from the worker starts the count again, and an answered question stops it', async () => {
    const l = line();
    l.watch.frame(0);
    void l.watch.ask([1]);
    l.watch.frame(200);
    l.watch.frame(400);
    expect(l.watch.silentMs).toBe(400);
    // a reply to something else: the worker is alive and working through its queue
    l.heard++;
    l.watch.frame(600);
    expect(l.watch.silentMs).toBe(0);
    l.watch.frame(800);
    expect(l.watch.silentMs).toBe(200);
    l.heard++;
    l.answers.shift()?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(l.watch.asking).toBe(0);
    l.watch.frame(5000);
    expect(l.watch.silentMs).toBe(0);
  });
});
