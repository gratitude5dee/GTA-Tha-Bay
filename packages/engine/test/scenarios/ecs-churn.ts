/**
 * Determinism scenario `ecs-churn` (M01a1 AC-11). Seed 0xC0FFEE. Each tick the Commands stage despawns a few random
 * units and spawns replacements (and toggles a Ragdoll), and the Rules stage writes RNG-driven values into every
 * unit's Transform and Velocity. 2,000 units plus one immortal player entity (`player:0`) stay alive.
 *
 * `perturbAtTick` changes one field of the player at that tick, to prove the hash notices it from then on.
 */
import { SIM_DT, SimStage, dsin, type EntityId, type SimConfig } from '@dv/shared';
import type { HeadlessSetup } from '../../src/headless/index.ts';
import { Health, LocalPlayer, Prop, Ragdoll, Transform, Velocity } from '../../src/sim/ecs/components.ts';
import type { EngineServices } from '../../src/sim/services.ts';

export const ECS_CHURN = {
  seed: 0xc0ffee,
  entities: 2000,
  ticks: 10_000,
  checkpointEvery: 600,
} as const;

export function ecsChurnConfig(hashEvery = 0): SimConfig {
  return {
    seed: ECS_CHURN.seed,
    profile: 'canonical',
    physicsBuild: 'deterministic-compat',
    tier: 'mobile-low',
    worldBake: 'ecs-churn',
    hashEvery,
  };
}

export interface ChurnOptions {
  /** Number of units kept alive (default 2000). */
  entities?: number;
  /** Add 1 to the player's hp during this tick's Publish stage. */
  perturbAtTick?: number;
}

export function setupEcsChurn(s: HeadlessSetup, opts: ChurnOptions = {}): void {
  const { ecs, core } = s;
  const count = opts.entities ?? ECS_CHURN.entities;
  ecs.definePrefab({
    id: 'churn.unit',
    components: [{ def: Transform }, { def: Velocity }, { def: Health, init: { hp: 100, max: 100 } }, { def: Prop }],
  });
  ecs.definePrefab({
    id: 'churn.player',
    components: [{ def: Transform }, { def: Health, init: { hp: 100, max: 100 } }, { def: LocalPlayer }],
  });
  ecs.commands.spawn('churn.player', undefined, 'player:0');
  for (let i = 0; i < count; i++) ecs.commands.spawn('churn.unit');

  core.addSystem({
    id: 'test.churn.structure', owner: 'S01', stage: SimStage.Commands, order: 0,
    run: ({ tick, ecs: world, services: svc }) => {
      const rng = (svc as EngineServices).rng.get('spawn');
      const units = world.query([Prop]);
      const n = units.length;
      if (n === 0) return;
      const k = 1 + (rng.nextU32() % 8);
      const picked: number[] = [];
      for (let j = 0; j < k; j++) {
        const id = units[rng.nextU32() % n] as number;
        if (!picked.includes(id)) picked.push(id);
      }
      for (const id of picked) world.commands.despawn(world.handle(id as EntityId));
      for (let j = 0; j < picked.length; j++) world.commands.spawn('churn.unit');
      const a = world.handle(units[rng.nextU32() % n] as EntityId);
      world.commands.add(a, Ragdoll, { untilTick: tick + 60, impulse: rng.nextFloat() });
      const b = world.handle(units[rng.nextU32() % n] as EntityId);
      world.commands.remove(b, Ragdoll);
    },
  });

  core.addSystem({
    id: 'test.churn.write', owner: 'S01', stage: SimStage.Rules, order: 0,
    run: ({ ecs: world, services: svc }) => {
      const rng = (svc as EngineServices).rng.get('loot');
      const tr = world.store(Transform);
      const ve = world.store(Velocity);
      const ids = world.query([Transform, Velocity]);
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i] as number;
        const vx = rng.range(-20, 20);
        ve.vx[id] = vx;
        ve.vz[id] = rng.range(-20, 20);
        tr.px[id] = (tr.px[id] as number) * 0.999 + vx * SIM_DT;
        tr.pz[id] = rng.range(-500, 500);
        tr.py[id] = dsin((tr.px[id] as number) * 0.01) * 10;
        tr.qx[id] = rng.nextFloat();
      }
    },
  });

  core.addSystem({
    id: 'test.churn.perturb', owner: 'S01', stage: SimStage.Publish, order: 0,
    run: ({ tick, ecs: world }) => {
      if (tick !== opts.perturbAtTick) return;
      const id = world.resolve(world.byKey('player:0')) as number;
      const hp = world.store(Health).hp;
      hp[id] = (hp[id] as number) + 1;
    },
  });
}
