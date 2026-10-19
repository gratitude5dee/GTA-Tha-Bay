/**
 * Scenario `walk-drop` (M01b1): `physics-drop` plus the walking course and the player. The player is `player.default`
 * spawned at the start of the ramp lane and driven by input: the QA page and the Node test feed it a seeded
 * `BotInput` script (`walk-drop-bot.ts`), the live page feeds it the keyboard.
 *
 * Same seed and checkpoints as `physics-drop`; its goldens are `test/golden/determinism.walk-drop.json`.
 */
import { datan2, dcos, dsin, dsqrt, HALF_PI, PI, SIM_DT, type SimConfig, type SimProfile } from '@dv/shared';
import { walkCourseShapes, WALK_COURSE, stepBoxes } from '../fixtures/walk-course.ts';
import { registerControlSystems } from '../control/index.ts';
import { ENGINE_PREFABS, PrefabRegistry } from '../prefabs/registry.ts';
import type { PhysicsScenario, ScenarioSetup } from '../sim-factory.ts';
import { dropAssetStatic, PHYSICS_DROP, physicsDropConfig, setupPhysicsDrop, type DropOptions } from './physics-drop.ts';

export const WALK_DROP = {
  id: 'walk-drop',
  seed: PHYSICS_DROP.seed,
  ticks: PHYSICS_DROP.ticks,
  checkpointEvery: PHYSICS_DROP.checkpointEvery,
  /** Where the player starts: the foot of the ramp lane, 30 m before the grade, facing +X. */
  spawn: [WALK_COURSE.featureX - 30, 0, WALK_COURSE.rampLaneZ] as [number, number, number],
  spawnYaw: -HALF_PI,
} as const;

export function walkDropConfig(profile: SimProfile = 'canonical', hashEvery = 0): SimConfig {
  return { ...physicsDropConfig(profile, hashEvery), worldBake: 'walk-drop' };
}

/** Draws the sloped parts of the course as thin slabs (the physics uses the heightfields). */
function spawnSlab(s: ScenarioSetup, lengthM: number, widthM: number, centre: [number, number, number], pitchRad: number): void {
  const { ecs } = s;
  const thick = 0.2;
  // A slab rising toward +X is rotated about +Z by the grade angle: q = (0, 0, sin(a/2), cos(a/2)).
  ecs.commands.spawn('drop.static', {
    'Transform.px': centre[0],
    'Transform.py': centre[1],
    'Transform.pz': centre[2],
    'Transform.qz': dsin(pitchRad / 2),
    'Transform.qw': dcos(pitchRad / 2),
    'RenderKey.asset': ecs.strings.intern(dropAssetStatic(lengthM / 2, thick, widthM / 2)),
    'RenderKey.visible': 1,
  });
}

export function setupWalkDrop(s: ScenarioSetup, opts: DropOptions = {}): void {
  const { ecs, backend, core } = s;
  setupPhysicsDrop(s, opts);

  // The course: statics for the physics, boxes and slabs for the view.
  for (const [key, shapes] of Object.entries(walkCourseShapes())) backend.addChunkStatics(key, shapes);
  const c = WALK_COURSE;
  for (const b of stepBoxes()) {
    ecs.commands.spawn('drop.static', {
      'Transform.px': b.cx, 'Transform.py': b.baseY + b.heightM / 2, 'Transform.pz': b.cz, 'Transform.qw': 1,
      'RenderKey.asset': ecs.strings.intern(dropAssetStatic(b.hx, b.heightM, b.hz)), 'RenderKey.visible': 1,
    });
  }
  const rampRise = c.rampLengthM * c.rampGrade;
  const rampAngle = datan2(rampRise, c.rampLengthM);
  const rampSlope = dsqrt(c.rampLengthM * c.rampLengthM + rampRise * rampRise);
  spawnSlab(s, rampSlope, 2 * c.laneHalfWidthM, [c.featureX + c.rampLengthM / 2, rampRise / 2, c.rampLaneZ], rampAngle);
  const bankRise = (c.bankLengthM * dsin(c.bankDeg * (PI / 180))) / dcos(c.bankDeg * (PI / 180));
  const bankSlope = dsqrt(c.bankLengthM * c.bankLengthM + bankRise * bankRise);
  spawnSlab(s, bankSlope, 2 * c.laneHalfWidthM, [c.featureX + c.bankLengthM / 2, bankRise / 2, c.bankLaneZ], datan2(bankRise, c.bankLengthM));

  // The player.
  // No vault resource here: the goldens of this scenario (test/golden/determinism.walk-drop.json) predate M01b2 and a new
  // resource would change the hash.
  registerControlSystems(core, backend, { vault: false });
  const prefabs = new PrefabRegistry(ecs, backend);
  prefabs.load(ENGINE_PREFABS);
  prefabs.spawn('player.default', { pos: [...WALK_DROP.spawn], yaw: WALK_DROP.spawnYaw }, 'player:0');

  // Rapier's broad phase learns about new colliders at the next step; queries before it see no statics.
  // One step here puts every collider in front of the first tick's character move.
  backend.step(SIM_DT, 1);
}

export const walkDropScenario: PhysicsScenario = {
  id: WALK_DROP.id,
  setup: (s) => setupWalkDrop(s),
};
