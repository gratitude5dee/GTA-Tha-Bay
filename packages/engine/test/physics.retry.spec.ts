import { describe, expect, it } from 'vitest';
import { PhysicsInitError } from '../src/sim/physics/backend.ts';
import { loadRapierBuild, type RapierModule } from '../src/sim/physics/load-build.ts';
import { RapierBackend } from '../src/sim/physics/rapier-backend.ts';

/** A loader that throws for its first `failures` calls, then loads the real build. */
function flaky(failures: number): { load: (b: 'simd-compat' | 'deterministic-compat') => Promise<RapierModule>; calls: () => number } {
  let calls = 0;
  return {
    calls: () => calls,
    load: async (b) => {
      calls++;
      if (calls <= failures) throw new Error(`wasm fetch failed (call ${calls})`);
      return loadRapierBuild(b);
    },
  };
}

describe('PhysicsBackend.init retry (AC-4)', () => {
  it('a loader that fails twice resolves on attempt 3, after two jittered, growing waits', async () => {
    const f = flaky(2);
    const waits: number[] = [];
    const draws = [0.1, 0.9];
    const backend = new RapierBackend('deterministic-compat', {
      load: f.load,
      retry: { baseMs: 100, sleep: (ms) => { waits.push(ms); return Promise.resolve(); }, jitter: () => draws.shift() ?? 0.5 },
    });
    await backend.init();
    expect(f.calls()).toBe(3);
    expect(waits).toEqual([100 * 1 * 0.6, 100 * 2 * 1.4]);
    // The backend works afterwards.
    const id = backend.createBody({ kind: 'dynamic', shape: 'sphere', dims: [0.5], at: [0, 1, 0], groups: 0xffffffff });
    expect(id).toBeGreaterThan(0);
    backend.dispose();
  });

  it('with four failures init rejects with PhysicsInitError and attempts === 4', async () => {
    const f = flaky(4);
    const backend = new RapierBackend('simd-compat', { load: f.load });
    const err = await backend.init().then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(PhysicsInitError);
    expect((err as PhysicsInitError).attempts).toBe(4);
    expect((err as PhysicsInitError).build).toBe('simd-compat');
    expect(f.calls()).toBe(4);
    expect(String((err as Error).message)).toContain('wasm fetch failed (call 4)');
  });

  it('three failures still succeed on the fourth and last attempt', async () => {
    const f = flaky(3);
    const backend = new RapierBackend('deterministic-compat', { load: f.load });
    await backend.init();
    expect(f.calls()).toBe(4);
    backend.dispose();
  });

  it('an init that already succeeded does not load again', async () => {
    const f = flaky(0);
    const backend = new RapierBackend('deterministic-compat', { load: f.load });
    await backend.init();
    await backend.init();
    expect(f.calls()).toBe(1);
    backend.dispose();
  });

  it('exclusive loading refuses a second, different build in the same realm', async () => {
    // Earlier tests in this file may already have loaded a build through the default loader; load one explicitly first.
    await loadRapierBuild('deterministic-compat', { exclusive: true });
    await expect(loadRapierBuild('simd-compat', { exclusive: true })).rejects.toThrow(/SimHost\.restart/);
    await expect(loadRapierBuild('deterministic-compat', { exclusive: true })).resolves.toBeDefined();
  });
});
