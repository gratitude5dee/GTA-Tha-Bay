import { describe, expect, it } from 'vitest';
import { requestRagdoll, requestTeleport } from '../src/sim/control/ownership.ts';
import { CONTROL_OWNER, CONTROL_PHASE, CONTROL_REASON, CONTROL_REASON_EN, CONTROL_STATE, packPending, phaseOf, requestedOf } from '../src/sim/control/states.ts';
import { Control } from '../src/sim/ecs/components.ts';
import type { PhysicsSim } from '../src/sim/sim-factory.ts';
import { WALK_COURSE } from './fixtures/world-boxes.ts';
import { createWalkSim, frame, hold, player, YAW } from './walk-sim.ts';

const START: [number, number, number] = [-100, 0, WALK_COURSE.flatLaneZ];

const handleOf = (sim: PhysicsSim) => sim.ecs.byKey('player:0');

/** The state after each tick, as a de-duplicated sequence that starts with the state before the first tick. */
function stateTrace(sim: PhysicsSim, ticks: number, f = {}): number[] {
  const out = [player(sim).state];
  for (let i = 0; i < ticks; i++) {
    hold(sim, 1, f);
    const s = player(sim).state;
    if (out[out.length - 1] !== s) out.push(s);
  }
  return out;
}

describe('ownership machine: teleport (AC-6)', () => {
  it('a target with no statics goes 700, 701, and back to Ready after 300 ticks with the reason; the position is unchanged', async () => {
    const sim = await createWalkSim({ spawn: START });
    hold(sim, 5, {});
    const before = player(sim);
    expect(requestTeleport(sim.ecs, sim.services, handleOf(sim), [5000, 0, 0], sim.tick)).toEqual({ ok: true });
    expect(player(sim).state).toBe(CONTROL_STATE.teleportPending);
    sim.services.events.drain();

    hold(sim, 1, {});
    expect(player(sim).state).toBe(CONTROL_STATE.teleportWaiting);
    hold(sim, 298, {}); // 299 ticks since the request
    expect(player(sim).state).toBe(CONTROL_STATE.teleportWaiting);
    hold(sim, 1, {}); // the 300th
    const after = player(sim);
    expect(after.state).toBe(CONTROL_STATE.idle);
    expect(after.owner).toBe(CONTROL_OWNER.OnFoot);
    expect([after.x, after.y, after.z]).toEqual([before.x, before.y, before.z]);

    const id = sim.ecs.query([Control])[0] as number;
    expect(phaseOf(sim.ecs.store(Control).pending[id] as number)).toBe(CONTROL_PHASE.Ready);

    const events = sim.services.events.drain();
    const refused = events.find((e) => e.t === 'control.refused');
    expect(refused?.s).toBe(CONTROL_REASON.groundNotLoaded);
    expect(CONTROL_REASON_EN[CONTROL_REASON.groundNotLoaded]).toBe('Ground not loaded; player was not moved');
    expect(events.filter((e) => e.t === 'control.transition').map((e) => e.n)).toEqual([701, 100]);
    sim.dispose();
  });

  it('input is ignored while the teleport waits: the player does not move', async () => {
    const sim = await createWalkSim({ spawn: START });
    hold(sim, 5, {});
    const before = player(sim);
    requestTeleport(sim.ecs, sim.services, handleOf(sim), [5000, 0, 0], sim.tick);
    hold(sim, 120, { moveY: -127, camYaw: YAW.east });
    const mid = player(sim);
    expect(mid.state).toBe(CONTROL_STATE.teleportWaiting);
    expect(mid.x).toBe(before.x);
    sim.dispose();
  });

  it('a target over ground succeeds: 700, 701, then 100 after the settle, standing on the floor at the target', async () => {
    const sim = await createWalkSim({ spawn: START });
    hold(sim, 5, {});
    requestTeleport(sim.ecs, sim.services, handleOf(sim), [30, 12, -90], sim.tick);
    const trace = stateTrace(sim, 60);
    expect(trace).toEqual([CONTROL_STATE.teleportPending, CONTROL_STATE.teleportWaiting, CONTROL_STATE.idle]);
    const p = player(sim);
    expect([p.x, p.z]).toEqual([30, -90]);
    expect(p.y).toBeCloseTo(0, 3);
    expect(p.grounded).toBe(true);
    // And it walks on from there.
    hold(sim, 60, { moveY: -127, camYaw: YAW.east });
    expect(player(sim).x).toBeCloseTo(34.2, 0);
    sim.dispose();
  });

  it('a second request while one is pending is refused as busy', async () => {
    const sim = await createWalkSim({ spawn: START });
    expect(requestTeleport(sim.ecs, sim.services, handleOf(sim), [5000, 0, 0], sim.tick).ok).toBe(true);
    expect(requestTeleport(sim.ecs, sim.services, handleOf(sim), [1, 0, 1], sim.tick)).toEqual({ ok: false, reason: CONTROL_REASON.busy });
    expect(requestRagdoll(sim.ecs, handleOf(sim))).toEqual({ ok: false, reason: CONTROL_REASON.busy });
    sim.dispose();
  });
});

describe('ownership machine: ragdoll stub (AC-6)', () => {
  it('passes 300, 301, 100 within 180 ticks plus the get-up time, and the player does not walk meanwhile', async () => {
    const sim = await createWalkSim({ spawn: START });
    hold(sim, 5, {});
    const before = player(sim);
    expect(requestRagdoll(sim.ecs, handleOf(sim)).ok).toBe(true);
    sim.services.events.drain();
    const t0 = sim.tick;

    const trace: number[] = [];
    let readyAt = -1;
    for (let i = 0; i < 260; i++) {
      // Held input for the first 100 ticks, while the ragdoll owns the player; none afterwards, so 100 is visible.
      hold(sim, 1, i < 100 ? { moveY: -127, camYaw: YAW.east } : {});
      const s = player(sim).state;
      if (trace[trace.length - 1] !== s) trace.push(s);
      if (readyAt < 0 && s === CONTROL_STATE.idle) readyAt = sim.tick - t0;
    }
    expect(trace.slice(0, 3)).toEqual([CONTROL_STATE.ragdoll, CONTROL_STATE.gettingUp, CONTROL_STATE.idle]);
    expect(readyAt).toBeGreaterThan(180);
    expect(readyAt).toBeLessThanOrEqual(180 + 60 + 1);
    // The held input did not move the player while the ragdoll owned it.
    expect(player(sim).x).toBe(before.x);

    const names = sim.services.events.drain().map((e) => e.s ?? '');
    expect(names[0]).toContain('Ready>Waiting');
    expect(names.some((n) => n.includes('Active') && n.includes('Ragdoll'))).toBe(true);
    expect(names[names.length - 1]).toContain('OnFoot Leaving>Ready');
    sim.dispose();
  });

  it('ragdoll is refused while a teleport is in progress and while the owner is not OnFoot', async () => {
    const sim = await createWalkSim({ spawn: START });
    requestRagdoll(sim.ecs, handleOf(sim));
    hold(sim, 1, {});
    expect(requestRagdoll(sim.ecs, handleOf(sim))).toEqual({ ok: false, reason: CONTROL_REASON.wrongOwner });
    expect(requestTeleport(sim.ecs, sim.services, handleOf(sim), [1, 0, 1], sim.tick)).toEqual({ ok: false, reason: CONTROL_REASON.wrongOwner });
    sim.dispose();
  });

  it('the pending field packs phase and requested owner into one byte', () => {
    const packed = packPending(CONTROL_PHASE.Leaving, CONTROL_OWNER.Arrested);
    expect(packed).toBeLessThan(256);
    expect(phaseOf(packed)).toBe(CONTROL_PHASE.Leaving);
    expect(requestedOf(packed)).toBe(CONTROL_OWNER.Arrested);
  });
});

describe('ownership machine: determinism', () => {
  it('a checkpoint taken during a teleport wait restores to the same hashes', async () => {
    const sim = await createWalkSim({ spawn: START });
    hold(sim, 5, {});
    requestTeleport(sim.ecs, sim.services, handleOf(sim), [5000, 0, 0], sim.tick);
    hold(sim, 100, { moveY: -127, camYaw: YAW.east });
    const bytes = sim.snapshot();
    const run = (): string[] => {
      const hashes: string[] = [];
      for (let i = 0; i < 6; i++) {
        sim.step(60, (tick) => frame({ tick, moveY: -127, camYaw: YAW.east }));
        hashes.push(sim.hash());
      }
      return hashes;
    };
    const first = run();
    sim.restore(bytes);
    expect(run()).toEqual(first);
    sim.dispose();
  });
});
