/**
 * Scenario `physics-drop` (M01a2): a fixture ground with 12 static boxes, 64 dynamic boxes falling onto it, a
 * kinematic platform on a dsin path, an impulse every 30 ticks drawn from stream `world`, and a forced rebase by
 * +1,000 m along X at tick 5,000. Seed 0xC0FFEE.
 *
 * The debug cube view draws it, the determinism tests hash it, and the QA page runs it in Chromium and WebKit.
 */
import { dcos, dsin, SimStage, TWO_PI, type SimConfig, type SimProfile } from '@dv/shared';
import { BodyRef, RenderKey, Transform, Velocity } from '../ecs/components.ts';
import { GROUPS } from '../physics/groups.ts';
import { fixtureBoxes, groundHeightfield, GROUND_HALF_M, worldBoxesShapes } from '../fixtures/world-boxes.ts';
import type { PhysicsScenario, ScenarioSetup } from '../sim-factory.ts';

export const PHYSICS_DROP = {
  id: 'physics-drop',
  seed: 0xc0ffee,
  dynamicBoxes: 64,
  impulseEveryTicks: 30,
  rebaseTick: 5000,
  rebaseDeltaX: 1000,
  ticks: 10_000,
  checkpointEvery: 600,
} as const;

/** Asset keys the debug view maps to cube sizes (full extents, metres). */
export const DROP_ASSET_BOX = 'dbg/box/1x1x1';
export const DROP_ASSET_PLATFORM = 'dbg/platform/6x0.5x6';
export const DROP_ASSET_GROUND = `dbg/ground/${GROUND_HALF_M * 2}`;
export const dropAssetStatic = (hx: number, h: number, hz: number): string => `dbg/static/${hx * 2}x${h}x${hz * 2}`;

export function physicsDropConfig(profile: SimProfile = 'canonical', hashEvery = 0): SimConfig {
  return {
    seed: PHYSICS_DROP.seed,
    profile,
    physicsBuild: profile === 'canonical' ? 'deterministic-compat' : 'simd-compat',
    tier: 'mobile-low',
    worldBake: 'physics-drop',
    hashEvery,
  };
}

export interface DropOptions {
  /** Skip the tick-5,000 forced rebase (used by the rebase test to compare against a run without one). */
  noForcedRebase?: boolean;
}

export function setupPhysicsDrop(s: ScenarioSetup, opts: DropOptions = {}): void {
  const { ecs, core, backend, services } = s;

  backend.addChunkStatics('fixture', worldBoxesShapes());

  ecs.definePrefab({
    id: 'drop.box',
    components: [{ def: Transform }, { def: Velocity }, { def: BodyRef }, { def: RenderKey }],
  });
  ecs.definePrefab({ id: 'drop.platform', components: [{ def: Transform }, { def: BodyRef }, { def: RenderKey }] });
  ecs.definePrefab({ id: 'drop.static', components: [{ def: Transform }, { def: RenderKey }] });

  const key = (name: string): number => ecs.strings.intern(name);

  // Ground and static boxes: entities without bodies so the view can draw them.
  ecs.commands.spawn('drop.static', {
    'Transform.py': -0.05, 'Transform.qw': 1, 'RenderKey.asset': key(DROP_ASSET_GROUND), 'RenderKey.visible': 1,
  });
  for (const b of fixtureBoxes()) {
    ecs.commands.spawn('drop.static', {
      'Transform.px': b.cx, 'Transform.py': b.baseY + b.heightM / 2, 'Transform.pz': b.cz, 'Transform.qw': 1,
      'RenderKey.asset': key(dropAssetStatic(b.hx, b.heightM, b.hz)), 'RenderKey.visible': 1,
    });
  }

  // 64 dynamic boxes on an 8 x 8 grid, staggered in height, each yawed by a draw from stream `spawn`.
  const spawn = services.rng.get('spawn');
  const boxAsset = key(DROP_ASSET_BOX);
  const boxBodies: number[] = [];
  for (let i = 0; i < PHYSICS_DROP.dynamicBoxes; i++) {
    const x = ((i % 8) - 3.5) * 2.2;
    const z = (Math.floor(i / 8) - 3.5) * 2.2;
    const y = 4 + (i % 4) * 1.5;
    const yaw = spawn.range(0, TWO_PI);
    const qy = dsin(yaw / 2);
    const qw = dcos(yaw / 2);
    const body = backend.createBody({
      kind: 'dynamic', shape: 'box', dims: [0.5, 0.5, 0.5], at: [x, y, z], rot: [0, qy, 0, qw], groups: GROUPS.dynamic,
    });
    boxBodies.push(body);
    ecs.commands.spawn('drop.box', {
      'Transform.px': x, 'Transform.py': y, 'Transform.pz': z, 'Transform.qy': qy, 'Transform.qw': qw,
      'BodyRef.body': body, 'RenderKey.asset': boxAsset, 'RenderKey.visible': 1,
    });
  }

  // The kinematic platform: ECS owns its Transform; PhysicsPre hands it to Rapier as the next target.
  const platformBody = backend.createBody({
    kind: 'kinematic', shape: 'box', dims: [3, 0.25, 3], at: [0, 1, 34], groups: GROUPS.kinematic,
  });
  const platform = ecs.commands.spawn('drop.platform', {
    'Transform.py': 1, 'Transform.pz': 34, 'Transform.qw': 1,
    'BodyRef.body': platformBody, 'RenderKey.asset': key(DROP_ASSET_PLATFORM), 'RenderKey.visible': 1,
  });

  core.addSystem({
    id: 'drop.platform.path', owner: 'S01', stage: SimStage.Script, order: 0,
    run: ({ tick, ecs: world }) => {
      const id = world.resolve(platform);
      if (id === null) return;
      world.store(Transform).px[id] = 20 * dsin(tick * 0.02);
    },
  });

  core.addSystem({
    id: 'drop.impulse', owner: 'S01', stage: SimStage.PhysicsPre, order: 10,
    run: ({ tick }) => {
      if (tick === 0 || tick % PHYSICS_DROP.impulseEveryTicks !== 0) return;
      const rng = services.rng.get('world');
      const body = boxBodies[rng.nextU32() % boxBodies.length] as number;
      backend.applyImpulse(body, [rng.range(-3, 3), rng.range(2, 7), rng.range(-3, 3)]);
    },
  });

  if (!opts.noForcedRebase) {
    core.addSystem({
      id: 'drop.rebase.forced', owner: 'S01', stage: SimStage.PhysicsPre, order: -10,
      run: ({ tick }) => {
        if (tick !== PHYSICS_DROP.rebaseTick) return;
        const o = backend.origin;
        backend.rebase([o[0] + PHYSICS_DROP.rebaseDeltaX, o[1], o[2]]);
      },
    });
  }
}

export const physicsDropScenario: PhysicsScenario = {
  id: PHYSICS_DROP.id,
  setup: (s) => setupPhysicsDrop(s),
};

/** Heightfield used by the scenario, exported for tests that build their own worlds. */
export { groundHeightfield };
