import { Fnv64 } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { GROUPS } from '../src/sim/physics/groups.ts';
import { needsRebase, snapOrigin } from '../src/sim/physics/origin.ts';
import { RapierBackend } from '../src/sim/physics/rapier-backend.ts';
import { BodyRef, LocalPlayer, Transform, Velocity } from '../src/sim/ecs/components.ts';
import { createPhysicsSim, type PhysicsScenario } from '../src/sim/sim-factory.ts';
import { testConfig } from './helpers.ts';
import { groundHeightfield } from './fixtures/world-boxes.ts';
import { PHYSICS_DROP, physicsDropConfig, setupPhysicsDrop } from './scenarios/physics-drop.ts';

const SIM_DT = 1 / 60;

/** A ground 256 m wide centred on x = 1500 and a box that has settled on it. */
async function farWorld(): Promise<{ backend: RapierBackend; box: number }> {
  const backend = new RapierBackend('deterministic-compat');
  await backend.init();
  const hf = groundHeightfield();
  hf.at = [1500 - 128, 0, -128];
  backend.addChunkStatics('far', { heightfield: hf, prisms: new Float32Array(0) });
  const box = backend.createBody({ kind: 'dynamic', shape: 'box', dims: [0.5, 0.5, 0.5], at: [1500, 3, 0], groups: GROUPS.dynamic });
  for (let t = 0; t < 120; t++) backend.step(SIM_DT, 1);
  return { backend, box };
}

function runHash(backend: RapierBackend, box: number, ticks: number): string {
  const out = new Float64Array(13);
  const h = new Fnv64();
  for (let t = 0; t < ticks; t++) {
    backend.step(SIM_DT, 1);
    backend.readBody(box, out);
    for (let i = 0; i < 13; i++) h.f64(out[i] as number);
  }
  return h.hex();
}

describe('floating origin (AC-2)', () => {
  it('rebase([1000, 0, 0]) moves the frame, not the world: ENU position changes by at most 1e-3 m', async () => {
    const { backend, box } = await farWorld();
    const before = new Float64Array(13);
    const after = new Float64Array(13);
    backend.readBody(box, before);
    expect(before[0]).toBeGreaterThan(1499.9);
    expect(before[1]).toBeCloseTo(0.5, 2);
    backend.rebase([1000, 0, 0]);
    expect(backend.origin).toEqual([1000, 0, 0]);
    backend.readBody(box, after);
    for (let i = 0; i < 3; i++) expect(Math.abs((after[i] as number) - (before[i] as number)), `axis ${i}`).toBeLessThanOrEqual(1e-3);
    expect(backend.rebases).toBe(1);
    backend.dispose();
  });

  it('statics are rebuilt in the new frame: the box stays on the ground after the rebase', async () => {
    const { backend, box } = await farWorld();
    backend.rebase([1000, 0, 0]);
    const out = new Float64Array(13);
    for (let t = 0; t < 300; t++) backend.step(SIM_DT, 1);
    backend.readBody(box, out);
    expect(out[1]).toBeGreaterThan(0.45);
    expect(out[1]).toBeLessThan(0.55);
    // A second box dropped after the rebase also lands on the rebuilt ground.
    const second = backend.createBody({ kind: 'dynamic', shape: 'box', dims: [0.5, 0.5, 0.5], at: [1520, 4, 10], groups: GROUPS.dynamic });
    for (let t = 0; t < 200; t++) backend.step(SIM_DT, 1);
    backend.readBody(second, out);
    expect(out[1]).toBeCloseTo(0.5, 1);
    backend.dispose();
  });

  it('the 600 ticks after a rebase hash identically across two runs', async () => {
    const hashes: string[] = [];
    for (let run = 0; run < 2; run++) {
      const { backend, box } = await farWorld();
      backend.rebase([1000, 0, 0]);
      hashes.push(runHash(backend, box, 600));
      backend.dispose();
    }
    expect(hashes[0]).toBe(hashes[1]);
  });

  it('rebase to the current origin is a no-op', async () => {
    const { backend } = await farWorld();
    backend.rebase([0, 0, 0]);
    expect(backend.rebases).toBe(0);
    backend.dispose();
  });

  it('needsRebase compares the horizontal distance with the limit; snapOrigin rounds to whole metres and keeps the height', () => {
    expect(needsRebase([999, 50, 0], [0, 0, 0])).toBe(false);
    expect(needsRebase([1000.01, 0, 0], [0, 0, 0])).toBe(true);
    expect(needsRebase([700, 0, 800], [0, 0, 0])).toBe(true); // 1063 m
    expect(needsRebase([1500, 0, 0], [1000, 0, 0])).toBe(false);
    expect(snapOrigin([1500.6, 33, -20.4], [0, 2, 0])).toEqual([1501, 2, -20]);
  });
});

describe('automatic rebase in PhysicsPre', () => {
  const playerScenario: PhysicsScenario = {
    id: 'rebase-follow',
    setup: ({ ecs }) => {
      ecs.definePrefab({ id: 'player', components: [{ def: Transform }, { def: LocalPlayer }] });
      ecs.commands.spawn('player', { 'Transform.qw': 1 }, 'player:0');
    },
  };

  it('rebases when the LocalPlayer entity is more than 1,000 m from the origin, and not before', async () => {
    const sim = await createPhysicsSim(testConfig(), playerScenario);
    const px = sim.ecs.store(Transform).px;
    const id = sim.ecs.resolve(sim.ecs.byKey('player:0')) as number;
    px[id] = 900;
    sim.step(2);
    expect(sim.backend.rebases).toBe(0);
    px[id] = 1500.4;
    sim.step(1);
    expect(sim.backend.rebases).toBe(1);
    expect(sim.backend.origin).toEqual([1500, 0, 0]);
    px[id] = 2400;
    sim.step(1);
    expect(sim.backend.rebases).toBe(1); // 900 m from the new origin
    px[id] = 2501;
    sim.step(1);
    expect(sim.backend.rebases).toBe(2);
    expect(sim.backend.origin).toEqual([2501, 0, 0]);
    sim.dispose();
  });

  it('follows the entity named in the options instead of the LocalPlayer tag', async () => {
    const scenario: PhysicsScenario = {
      id: 'rebase-key',
      setup: ({ ecs }) => {
        ecs.definePrefab({ id: 'thing', components: [{ def: Transform }] });
        ecs.commands.spawn('thing', { 'Transform.px': 3000, 'Transform.qw': 1 }, 'npc:cab');
      },
    };
    const sim = await createPhysicsSim(testConfig(), scenario, { physics: { followKey: 'npc:cab' } });
    sim.step(1);
    expect(sim.backend.origin).toEqual([3000, 0, 0]);
    sim.dispose();
  });
});

describe('physics-drop forced rebase', () => {
  it('the +1,000 m rebase at tick 5,000 happens once and the boxes keep their ENU positions', async () => {
    const sim = await createPhysicsSim(physicsDropConfig('canonical'), { id: 'drop', setup: (s) => setupPhysicsDrop(s) });
    sim.step(PHYSICS_DROP.rebaseTick);
    expect(sim.backend.rebases).toBe(0);
    const tr = sim.ecs.store(Transform);
    const bodies = sim.ecs.query([BodyRef, Velocity, Transform]);
    const before = Array.from(bodies, (id) => tr.px[id] as number);
    sim.step(1);
    expect(sim.backend.rebases).toBe(1);
    expect(sim.backend.origin).toEqual([1000, 0, 0]);
    sim.step(1);
    // Sleeping or resting boxes did not jump: every ENU x stays within 0.5 m of where it was a tick earlier.
    const after = Array.from(bodies, (id) => tr.px[id] as number);
    const worst = Math.max(...after.map((x, i) => Math.abs(x - (before[i] as number))));
    expect(worst).toBeLessThan(0.5);
    sim.dispose();
  }, 60_000);
});

