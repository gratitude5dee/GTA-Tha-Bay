import { describe, expect, it } from 'vitest';
import type { Portal, ShoreNode } from '@dv/shared';
import { CONTROL_OWNER, CONTROL_STATE } from '../../src/sim/control/states.ts';
import { SWIM_RESPAWN_TICKS } from '../../src/sim/control/swim.ts';
import type { WorldBoundsPort } from '../../src/sim/world/index.ts';
import { PHYSICS_CONFIG } from '../../src/sim/physics/config.ts';
import { WALK_COURSE } from '../fixtures/world-boxes.ts';
import { LocalPlayer, Velocity } from '../../src/sim/ecs/components.ts';
import { createWalkSim, hold, player, YAW } from '../walk-sim.ts';

const START: [number, number, number] = [-100, 0, WALK_COURSE.flatLaneZ];
const CHEST = PHYSICS_CONFIG.character.chestY;

/** A fake world edge: water deeper than `depth` for x < 0, one shore node at (30, 0, -90) facing the sea to the west. */
function fakePort(o: { depth?: number; shore?: ShoreNode | null } = {}): WorldBoundsPort & { asked: [number, number, boolean][]; shore: ShoreNode | null } {
  const port = {
    asked: [] as [number, number, boolean][],
    shore: o.shore === undefined ? { id: 'sn.test', x: 30, y: 0, z: -90, nx: -1, nz: 0 } : o.shore,
    portals: (): readonly Portal[] => [],
    setPortalState: () => false,
    release: () => undefined,
    sealedPortals: (): readonly string[] => [],
    nearestShore(x: number, z: number, roadAdjacent: boolean): ShoreNode | null {
      port.asked.push([x, z, roadAdjacent]);
      return port.shore;
    },
    waterDepth: (x: number): number => (x < 0 ? (o.depth ?? 2) : 0),
    onClosureChange: () => () => undefined,
  };
  return port;
}


describe('swim owner (Control 800)', () => {
  it('takes the player into Swim in deep water and respawns it at the nearest shore node within 2 s', async () => {
    const sim = await createWalkSim({ spawn: START });
    const port = fakePort();
    sim.services.world.bounds = port;
    hold(sim, 1, {});
    expect(player(sim).owner).toBe(CONTROL_OWNER.Swim);
    expect(player(sim).state).toBe(CONTROL_STATE.swim);
    const startTick = sim.tick;

    // it stays put for the stall time
    hold(sim, SWIM_RESPAWN_TICKS - 2, {});
    expect(player(sim).owner).toBe(CONTROL_OWNER.Swim);
    expect([Math.round(player(sim).x), Math.round(player(sim).z)]).toEqual([-100, -100]);
    sim.services.events.drain();

    // then it fades, goes back to the base owner and is teleported
    let arrivedAt = -1;
    for (let i = 0; i < 120 && arrivedAt < 0; i++) {
      hold(sim, 1, {});
      const p = player(sim);
      if (p.owner === CONTROL_OWNER.OnFoot && p.state === CONTROL_STATE.idle && Math.abs(p.x - 32) < 0.1) arrivedAt = sim.tick;
    }
    expect(arrivedAt).toBeGreaterThan(0);
    expect(arrivedAt - startTick).toBeLessThanOrEqual(120);   // 2 s
    const p = player(sim);
    // two metres inland of the node (the sea is to the west, so inland is east)
    expect([p.x, p.z]).toEqual([32, -90]);
    expect(p.grounded).toBe(true);
    expect(port.asked.length).toBeGreaterThan(0);
    expect(port.asked[0]![2]).toBe(false);   // on foot: any shore, not only road-adjacent
    sim.dispose();
  });

  // BD-FIX-WATERRESPAWN-01: what the e2e walk relies on. A stick held while swimming moves nothing, and once the stick is free a player put
  // back on the shore stands at the respawn point, velocity cleared, with no drift.
  it('ignores a stick held while swimming, and leaves the respawned player still at the shore point once the stick is free', async () => {
    const sim = await createWalkSim({ spawn: START });
    sim.services.world.bounds = fakePort();
    hold(sim, 1, {});
    expect(player(sim).owner).toBe(CONTROL_OWNER.Swim);
    const inWater = player(sim);
    hold(sim, 45, { moveY: -127, camYaw: YAW.west });
    expect([player(sim).x, player(sim).z]).toEqual([inWater.x, inWater.z]);

    let arrived = false;
    for (let i = 0; i < 160 && !arrived; i++) {
      hold(sim, 1, {});
      const p = player(sim);
      arrived = p.owner === CONTROL_OWNER.OnFoot && p.state === CONTROL_STATE.idle && Math.abs(p.x - 32) < 0.1;
    }
    expect(arrived).toBe(true);
    for (let i = 0; i < 120; i++) {
      hold(sim, 1, {});
      const p = player(sim);
      expect([p.x, p.z, p.state, p.owner]).toEqual([32, -90, CONTROL_STATE.idle, CONTROL_OWNER.OnFoot]);
    }
    const id = sim.ecs.query([LocalPlayer])[0] as number;
    const ve = sim.ecs.store(Velocity);
    expect([ve.vx[id], ve.vz[id]]).toEqual([0, 0]);
    sim.dispose();
  });

  it('fades out and back in with world.teleport events, in that order', async () => {
    const sim = await createWalkSim({ spawn: START });
    sim.services.world.bounds = fakePort();
    const seen: string[] = [];
    for (let i = 0; i < 160; i++) {
      hold(sim, 1, {});
      for (const e of sim.services.events.drain()) if (e.t === 'world.teleport' && e.s) seen.push(e.s);
    }
    expect(seen).toEqual(['out', 'in']);
    sim.dispose();
  });

  it('does not swim in water shallower than the chest, or on land', async () => {
    const sim = await createWalkSim({ spawn: START });
    sim.services.world.bounds = fakePort({ depth: CHEST - 0.1 });
    hold(sim, 200, {});
    expect(player(sim).owner).toBe(CONTROL_OWNER.OnFoot);
    sim.dispose();

    const dry = await createWalkSim({ spawn: [100, 0, WALK_COURSE.flatLaneZ] });
    dry.services.world.bounds = fakePort();
    hold(dry, 200, {});
    expect(player(dry).owner).toBe(CONTROL_OWNER.OnFoot);
    dry.dispose();
  });

  it('does nothing without a world port', async () => {
    const sim = await createWalkSim({ spawn: START });
    expect(sim.services.world.bounds).toBeNull();
    hold(sim, 200, {});
    expect(player(sim).owner).toBe(CONTROL_OWNER.OnFoot);
    sim.dispose();
  });

  it('keeps swimming while no shore node is known, and respawns once one is', async () => {
    const sim = await createWalkSim({ spawn: START });
    const port = fakePort({ shore: null });
    sim.services.world.bounds = port;
    hold(sim, SWIM_RESPAWN_TICKS + 60, {});
    expect(player(sim).owner).toBe(CONTROL_OWNER.Swim);
    port.shore = { id: 'sn.late', x: 40, y: 0, z: -80, nx: -1, nz: 0 };
    hold(sim, 60, {});
    const p = player(sim);
    expect(p.owner).toBe(CONTROL_OWNER.OnFoot);
    expect([p.x, p.z]).toEqual([42, -80]);
    sim.dispose();
  });

  it('is deterministic: the same run twice gives the same state hash', async () => {
    const run = async (): Promise<string> => {
      const sim = await createWalkSim({ spawn: START });
      sim.services.world.bounds = fakePort();
      hold(sim, 150, {});
      const h = sim.hash();
      sim.dispose();
      return h;
    };
    expect(await run()).toBe(await run());
  });
});

