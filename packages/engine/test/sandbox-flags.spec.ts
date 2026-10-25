import { describe, expect, it } from 'vitest';
import type { EcsApi, EntityHandle } from '@dv/shared';
import { Control, EcsWorld, Health, LocalPlayer, Transform, VehicleDamage } from '../src/sim/index.ts';
import { CombatImpl, type HitEvent } from '../src/sim/combat/combat.ts';
import { MOVES } from '../src/sim/combat/moves.ts';
import { PHYSICS_CONFIG } from '../src/sim/physics/config.ts';
import { isSessionCar, noFlags, sandboxFlagsResource, SANDBOX_FLAGS_RESOURCE, SUPER_JUMP_APEX_M } from '../src/sim/sandbox-flags.ts';
import { createSimServices } from '../src/sim/services.ts';
import { UNIT_PREFAB } from './helpers.ts';
import { createWalkSim, frame, hold, JUMP, player, SPRINT, YAW } from './walk-sim.ts';
import { createVehicleWorld, drive } from './vehicle-sim.ts';

/** The state hash of the walk sim below, recorded on the merged base (before M04e4) with no flag ever set. */
const NO_FLAGS_HASH = '239f2938aee7d94e';

/** Sprints east for 600 ticks and presses Jump on every 40th tick; returns the state hash. */
async function walkHash(): Promise<string> {
  const sim = await createWalkSim({ spawn: [-100, 0, 0] });
  for (let i = 0; i < 15; i++) {
    hold(sim, 1, { moveY: -127, camYaw: YAW.east, buttons: SPRINT | JUMP });
    hold(sim, 39, { moveY: -127, camYaw: YAW.east, buttons: SPRINT });
  }
  const h = sim.core.stateHash();
  sim.dispose();
  return h;
}

describe('sandbox flags: never set (AC-2)', () => {
  it('a sprinting, jumping walk hashes to the value recorded before the flags existed', async () => {
    expect(await walkHash()).toBe(NO_FLAGS_HASH);
  });

  it('the services start with every flag off', () => {
    expect(createSimServices(1).sandboxFlags).toEqual(noFlags());
  });
});

describe('sandbox flags: readers (AC-3)', () => {
  it('combat: an immune victim keeps hp, ko and position, and the hit still fires with damage 0', () => {
    const w = new EcsWorld();
    w.definePrefab(UNIT_PREFAB);
    w.definePrefab({ id: 'fighter', components: [{ def: Transform }, { def: Health, init: { hp: 100, max: 100 } }, { def: Control }, { def: LocalPlayer }] });
    const a = w.commands.spawn('unit', {}, 'npc:attacker');
    const t = w.commands.spawn('fighter', { 'Transform.pz': -1.5 }, 'player:0');
    w.flush();
    for (const h of [a, t]) w.store(Transform).qw[w.resolve(h) as number] = 1;
    const state = { tick: 0, immune: true };
    const hits: HitEvent[] = [];
    const emitted: number[] = [];
    const combat = new CombatImpl({
      ecs: w as unknown as EcsApi,
      tick: () => state.tick,
      input: () => null,
      emit: (_t, _tk, _a, _b, _m, damage) => void emitted.push(damage),
      immune: (v: EntityHandle) => state.immune && (w as unknown as EcsApi).has(v, LocalPlayer),
    });
    combat.onHit((e) => void hits.push(e));
    const tid = w.resolve(t) as number;
    const run = (): void => {
      combat.startMove(a, 'jab');
      for (let i = 0; i < MOVES.jab.startup + MOVES.jab.active + MOVES.jab.recovery + 1; i++) {
        combat.update();
        state.tick++;
      }
    };
    const z0 = w.store(Transform).pz[tid] as number;
    run();
    expect(w.store(Health).hp[tid]).toBe(100);
    expect(w.store(Health).ko[tid]).toBe(0);
    expect(w.store(Transform).pz[tid]).toBe(z0);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ move: 'jab', damage: 0, ko: false });
    expect(emitted).toEqual([0]);
    state.immune = false;
    run();
    expect(w.store(Health).hp[tid]).toBe(100 - MOVES.jab.damage);
    expect(hits).toHaveLength(2);
    expect(hits[1]?.damage).toBe(MOVES.jab.damage);
  });

  async function jumpPeak(superJump: boolean): Promise<number> {
    const sim = await createWalkSim({ spawn: [0, 0, -100], noCourse: true });
    sim.services.sandboxFlags.superJump = superJump;
    hold(sim, 30, {});
    const y0 = player(sim).y;
    let peak = 0;
    sim.step(1, (tick) => frame({ tick, buttons: JUMP, pressed: JUMP }));
    peak = Math.max(peak, player(sim).y - y0);
    hold(sim, 200, {}, () => {
      peak = Math.max(peak, player(sim).y - y0);
    });
    sim.dispose();
    return peak;
  }

  it('jump: a standing jump peaks at 4 m with superJump and at the usual apex without it', async () => {
    const normal = await jumpPeak(false);
    expect(normal).toBeGreaterThan(PHYSICS_CONFIG.character.jumpApexM - 0.15);
    expect(normal).toBeLessThan(PHYSICS_CONFIG.character.jumpApexM + 0.15);
    const big = await jumpPeak(true);
    expect(big).toBeGreaterThan(SUPER_JUMP_APEX_M - 0.15);
    expect(big).toBeLessThan(SUPER_JUMP_APEX_M + 0.15);
  });

  it('car damage: carNoDamage spares veh:sbx0 and not veh:test0', async () => {
    const w = await createVehicleWorld({
      pos: [0, 6, 0],
      seated: false,
      setup: ({ prefabs }) => void prefabs.spawn('vehicle.sedan', { pos: [0, 6, 25], yaw: -Math.PI / 2 }, 'veh:sbx0'),
    });
    w.sim.services.sandboxFlags.carNoDamage = true;
    drive(w, 240);
    const dm = w.sim.ecs.store(VehicleDamage);
    const sbx = w.sim.ecs.resolve(w.sim.ecs.byKey('veh:sbx0')) as number;
    const tst = w.sim.ecs.resolve(w.vehicle) as number;
    expect(dm.body[sbx]).toBe(1);
    expect(dm.body[tst] as number).toBeLessThan(1);
    w.sim.dispose();
  });

  it('isSessionCar matches only veh:sbx<n>', () => {
    expect(isSessionCar('veh:sbx0' as never)).toBe(true);
    expect(isSessionCar('veh:sbx12' as never)).toBe(true);
    expect(isSessionCar('veh:test0' as never)).toBe(false);
    expect(isSessionCar('veh:sbx' as never)).toBe(false);
    expect(isSessionCar('veh:sbx1x' as never)).toBe(false);
    expect(isSessionCar(null)).toBe(false);
  });
});

describe('sandbox flags: the resource (AC-3)', () => {
  it('exists only while registered, changes the hash then, and leaves no trace after removal', async () => {
    const a = await createWalkSim({ spawn: [0, 0, -100] });
    const b = await createWalkSim({ spawn: [0, 0, -100] });
    a.services.sandboxFlags.godMode = true;
    a.core.addResource(sandboxFlagsResource(() => a.services.sandboxFlags));
    expect(() => a.core.addResource(sandboxFlagsResource(() => a.services.sandboxFlags))).toThrow();
    hold(a, 300, {});
    hold(b, 300, {});
    expect(a.hash()).not.toBe(b.hash());
    expect(a.core.removeResource(SANDBOX_FLAGS_RESOURCE)).toBe(true);
    expect(a.core.removeResource(SANDBOX_FLAGS_RESOURCE)).toBe(false);
    a.services.sandboxFlags.godMode = false;
    expect(a.hash()).toBe(b.hash());
    hold(a, 300, {});
    hold(b, 300, {});
    expect(a.hash()).toBe(b.hash());
    a.dispose();
    b.dispose();
  });

  it('the rng resource cannot be removed', async () => {
    const a = await createWalkSim({ spawn: [0, 0, -100] });
    expect(a.core.removeResource('rng')).toBe(false);
    a.dispose();
  });
});
