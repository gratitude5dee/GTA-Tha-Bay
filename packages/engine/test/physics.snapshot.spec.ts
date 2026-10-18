import { describe, expect, it } from 'vitest';
import { GROUPS } from '../src/sim/physics/groups.ts';
import { RapierBackend } from '../src/sim/physics/rapier-backend.ts';
import { createPhysicsSim } from '../src/sim/sim-factory.ts';
import { groundHeightfield } from './fixtures/world-boxes.ts';
import { physicsDropConfig, physicsDropScenario } from './scenarios/physics-drop.ts';

describe('snapshot and restore (AC-3)', () => {
  it('physics-drop: snapshot at tick 3,000, run on to 6,000 (hash H), restore, re-run: hash H again', async () => {
    const sim = await createPhysicsSim(physicsDropConfig('canonical'), physicsDropScenario);
    sim.step(3000);
    expect(sim.tick).toBe(3000);
    const snap = sim.snapshot();
    const at3000 = sim.hash();
    sim.step(3000);
    expect(sim.tick).toBe(6000);
    const h = sim.hash();
    expect(sim.backend.rebases).toBe(1); // the tick-5,000 rebase is inside the replayed span

    sim.restore(snap);
    expect(sim.tick).toBe(3000);
    expect(sim.hash()).toBe(at3000);
    expect(sim.backend.rebases).toBe(0);
    sim.step(3000);
    expect(sim.tick).toBe(6000);
    expect(sim.hash()).toBe(h);
    expect(sim.backend.rebases).toBe(1);
    sim.dispose();
  }, 120_000);

  it('a second sim built fresh and restored from the snapshot gives the same hash at tick 6,000', async () => {
    const a = await createPhysicsSim(physicsDropConfig('canonical'), physicsDropScenario);
    a.step(3000);
    const snap = a.snapshot();
    a.step(3000);
    const h = a.hash();
    const b = await createPhysicsSim(physicsDropConfig('canonical'), physicsDropScenario);
    b.restore(snap);
    b.step(3000);
    expect(b.hash()).toBe(h);
    a.dispose();
    b.dispose();
  }, 120_000);

  it('backend snapshot alone: bodies, statics and the origin round-trip', async () => {
    const backend = new RapierBackend('simd-compat');
    await backend.init();
    backend.addChunkStatics('g', { heightfield: groundHeightfield(), prisms: new Float32Array(0) });
    const id = backend.createBody({ kind: 'dynamic', shape: 'box', dims: [0.5, 0.5, 0.5], at: [0, 6, 0], groups: GROUPS.dynamic });
    backend.rebase([100, 0, 0]);
    for (let t = 0; t < 30; t++) backend.step(1 / 60, 1);
    const snap = backend.snapshot();
    const a = new Float64Array(13);
    for (let t = 0; t < 90; t++) backend.step(1 / 60, 1);
    backend.readBody(id, a);

    for (let t = 0; t < 40; t++) backend.step(1 / 60, 1);
    backend.restore(snap);
    expect(backend.origin).toEqual([100, 0, 0]);
    expect(backend.bodyCount).toBe(1);
    for (let t = 0; t < 90; t++) backend.step(1 / 60, 1);
    const b = new Float64Array(13);
    backend.readBody(id, b);
    expect([...b]).toEqual([...a]);
    // Rebuilding statics after a restore works: a rebase still moves the ground.
    backend.rebase([200, 0, 0]);
    for (let t = 0; t < 60; t++) backend.step(1 / 60, 1);
    backend.readBody(id, b);
    expect(b[1]).toBeCloseTo(0.5, 1);
    backend.dispose();
  });

  it('restoring a snapshot of the other build is refused', async () => {
    const simd = new RapierBackend('simd-compat');
    const det = new RapierBackend('deterministic-compat');
    await simd.init();
    await det.init();
    expect(() => det.restore(simd.snapshot())).toThrow(/simd-compat/);
    expect(() => det.restore(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(/bad snapshot/);
    simd.dispose();
    det.dispose();
  });
});
