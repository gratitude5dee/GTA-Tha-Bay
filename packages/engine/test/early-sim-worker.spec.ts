import { describe, expect, it } from 'vitest';
import { earlySimWorker } from '../src/client/boot/spawn-worker.ts';
import type { WorkerLike } from '../src/sim/sim-host.ts';

/** A spawn that numbers its workers and records which were terminated. */
function fakeSpawn(): { spawn: () => WorkerLike; made: number[]; terminated: number[] } {
  const made: number[] = [];
  const terminated: number[] = [];
  const spawn = (): WorkerLike => {
    const id = made.length + 1;
    made.push(id);
    return { id, terminate: () => terminated.push(id), postMessage: () => undefined, addEventListener: () => undefined } as unknown as WorkerLike;
  };
  return { spawn, made, terminated };
}
const idOf = (w: WorkerLike): number => (w as unknown as { id: number }).id;

describe('earlySimWorker (BD-FIX-WEBKIT-ATTACH-01: sim.worker spawns before the benchmark)', () => {
  it('spawns nothing until started', () => {
    const f = fakeSpawn();
    earlySimWorker(f.spawn);
    expect(f.made).toEqual([]);
  });

  it('start spawns once; the first start of the engine takes that worker', () => {
    const f = fakeSpawn();
    const sim = earlySimWorker(f.spawn);
    sim.start();
    sim.start();
    expect(f.made).toEqual([1]);
    expect(idOf(sim.spawn())).toBe(1);
    expect(f.made).toEqual([1]);
  });

  it('every later (re)start gets a fresh worker, never the one already taken', () => {
    const f = fakeSpawn();
    const sim = earlySimWorker(f.spawn);
    sim.start();
    expect(idOf(sim.spawn())).toBe(1);
    expect(idOf(sim.spawn())).toBe(2);
    expect(idOf(sim.spawn())).toBe(3);
    expect(f.terminated).toEqual([]);
  });

  it('without an early start the engine spawns its worker when it asks, as before', () => {
    const f = fakeSpawn();
    const sim = earlySimWorker(f.spawn);
    expect(idOf(sim.spawn())).toBe(1);
    // a start that comes after the engine took its worker spawns no second, unused one
    sim.start();
    expect(f.made).toEqual([1]);
  });

  it('dispose terminates an early worker nobody took, and nothing else', () => {
    const f = fakeSpawn();
    const sim = earlySimWorker(f.spawn);
    sim.start();
    sim.dispose();
    expect(f.terminated).toEqual([1]);
    sim.start();
    expect(f.made).toEqual([1]);

    const g = fakeSpawn();
    const taken = earlySimWorker(g.spawn);
    taken.start();
    taken.spawn();
    taken.dispose();
    // the running engine owns its worker: dispose leaves it alone
    expect(g.terminated).toEqual([]);
  });
});
