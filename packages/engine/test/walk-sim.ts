/**
 * A bare walking world for the controller tests: the flat fixture ground, the walking course, the control systems and
 * `player.default` at a chosen point. No dynamic boxes, so nothing else moves.
 */
import { SIM_DT, SimButton, type InputFrame, type SimConfig } from '@dv/shared';
import { registerControlSystems } from '../src/sim/control/index.ts';
import { Anim, CharacterBody, Control, LocalPlayer, Transform, Velocity } from '../src/sim/ecs/components.ts';
import { groundHeightfield } from '../src/sim/fixtures/world-boxes.ts';
import { walkCourseShapes } from '../src/sim/fixtures/walk-course.ts';
import { ENGINE_PREFABS, PrefabRegistry } from '../src/sim/prefabs/registry.ts';
import { createPhysicsSim, type PhysicsSim } from '../src/sim/sim-factory.ts';
import { testConfig } from './helpers.ts';

/** camYaw (u16) for each compass direction: forward is (-sin yaw, -cos yaw), so 49152 faces +X. */
export const YAW = { north: 0, west: 16384, south: 32768, east: 49152 } as const;

export interface WalkWorldOptions {
  spawn?: [number, number, number];
  yaw?: number;
  config?: Partial<SimConfig>;
  /** Skip the walking course (a plain ground). */
  noCourse?: boolean;
}

export async function createWalkSim(opts: WalkWorldOptions = {}): Promise<PhysicsSim> {
  const spawn = opts.spawn ?? [0, 0, -100];
  const sim = await createPhysicsSim(testConfig(opts.config), {
    id: 'walk-test',
    setup: (s) => {
      s.backend.addChunkStatics('ground', { heightfield: groundHeightfield(), prisms: new Float32Array(0) });
      if (!opts.noCourse) for (const [key, shapes] of Object.entries(walkCourseShapes())) s.backend.addChunkStatics(key, shapes);
      registerControlSystems(s.core, s.backend);
      const prefabs = new PrefabRegistry(s.ecs, s.backend);
      prefabs.load(ENGINE_PREFABS);
      prefabs.spawn('player.default', { pos: spawn, yaw: opts.yaw ?? 0 }, 'player:0');
      s.backend.step(SIM_DT, 1);
    },
  });
  return sim;
}

/** An InputFrame with the given fields; `tick` is filled in by `drive`. */
export function frame(f: Partial<InputFrame> = {}): InputFrame {
  return {
    tick: 0, buttons: 0, pressed: 0, released: 0, moveX: 0, moveY: 0, throttle: 0, brake: 0, steer: 0,
    camYaw: 0, camPitch: 0, context: 0, device: 7, ...f,
  };
}

export const SPRINT = 1 << SimButton.Sprint;
export const JUMP = 1 << SimButton.Jump;

/** Runs `n` ticks with the same held input; `pressed` edges are only set on the first tick when `edgeOnFirst` is true. */
export function hold(sim: PhysicsSim, n: number, f: Partial<InputFrame>, each?: (tick: number) => void): void {
  for (let i = 0; i < n; i++) {
    sim.step(1, (tick) => frame({ ...f, tick, pressed: 0, released: 0 }));
    each?.(sim.tick);
  }
}

export interface PlayerView {
  x: number;
  y: number;
  z: number;
  vy: number;
  state: number;
  owner: number;
  grounded: boolean;
  airTicks: number;
  anim: number;
}

export function player(sim: PhysicsSim): PlayerView {
  const ids = sim.ecs.query([LocalPlayer]);
  const id = ids[0] as number;
  const tr = sim.ecs.store(Transform);
  const co = sim.ecs.store(Control);
  const cb = sim.ecs.store(CharacterBody);
  return {
    x: tr.px[id] as number,
    y: tr.py[id] as number,
    z: tr.pz[id] as number,
    vy: sim.ecs.store(Velocity).vy[id] as number,
    state: co.state[id] as number,
    owner: co.owner[id] as number,
    grounded: (cb.grounded[id] as number) !== 0,
    airTicks: cb.airTicks[id] as number,
    anim: sim.ecs.store(Anim).state[id] as number,
  };
}
