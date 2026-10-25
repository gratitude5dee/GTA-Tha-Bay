/**
 * DL-736 (BD-FIX-SPAWN-11): a matching checkpoint of a saved game is restored only once the ground under the saved player pose is there.
 * After a reload the saved pose's tiles are not resident yet; the old resume wrote the pose straight into `Transform` and the player
 * fell until the below-the-world net caught it. Now the resume pre-streams the saved pose's `p0` tile and its ring
 * (`WorldServices.prestream`), waits within the far start's budget with the `mission.startLoading` hint, and then writes the player and
 * the cast as saved, a seated player seated again. When the budget runs out the checkpoint is kept and the Jobs app offers a Start.
 */
import type { EntityHandle, JsonObject, StorySlice } from '@dv/shared';
import { Transform } from '@dv/engine/sim';
import { describe, expect, it } from 'vitest';
import { at, circle, defineMission, npc, phoneTrigger, stage, vehicle, waitFor } from '../src/authoring/index.ts';
import type { CatalogPayload } from '../src/missions/store.ts';
import { PLACE_BUDGET_TICKS, PLACE_HINT_AFTER_TICKS, PLACE_HINT_EVERY_TICKS, StoryController } from '../src/mode.ts';
import { CHECKPOINT_SCHEMA } from '../src/vm/constants.ts';
import { SEAT_WAIT_TICKS } from '../src/vm/checkpoint.ts';
import { SET_DOWN_SIDE_M } from '../src/vm/runtime.ts';
import { ll, makeHarness, seatPlayer, type Harness } from './harness.ts';

const ID = 'm.t.resume';
/** Where the checkpoint was saved: far from the boot spawn at the origin, as after a reload. */
const SAVED = { x: 2400, y: 3.5, z: -1800, yaw: 1.25 };
const CAR = { x: 2402, y: 3.2, z: -1801, yaw: 1.25 };
const PAL = { x: 2410, y: 3.4, z: -1795, yaw: -0.5 };
/** Where the fake port's `setDown` puts the player, from the car's centre (a stand-in for the engine's exit point). */
const PORT_SIDE = { x: -1.79, z: 0.4 };
const mission = defineMission({
  id: ID,
  version: 1,
  district: 'd3',
  start: phoneTrigger('npc_test'),
  cast: {
    pal: npc({ soul: 'npc_test', role: 'ally', spawn: at(...ll(SAVED.x + 40, SAVED.z)) }),
    car: vehicle({ prefab: 'vehicle.compact', spawn: at(...ll(SAVED.x + 60, SAVED.z)), playerUsable: true }),
  },
  zones: { z: circle(...ll(SAVED.x, SAVED.z), 5) },
  stages: [stage('a', [waitFor(6000, { id: 'long' })]), stage('b', [waitFor(6000, { id: 'longer' })], { checkpoint: true })],
});

/** The saved `activeMission`: stage 1 with the player at `SAVED` (in the cast car when `seated`), the car and the ally where they stood. */
function saved(seated: boolean): NonNullable<StorySlice['activeMission']> {
  const data = {
    missionId: ID, version: 1, worldBake: 'test-bake', stage: 1, attempt: 1, seed: 1, rng: [1, 2, 3, 4], elapsedSec: 12, flags: {}, objectivesDone: [], talkResults: {},
    player: { x: SAVED.x, y: SAVED.y, z: SAVED.z, yaw: SAVED.yaw, health: 0.75, ...(seated ? { vehicle: 'car' } : {}) },
    cast: { car: { alive: true, ...CAR }, pal: { alive: true, ...PAL, health: 0.5 } },
    walletDeltaCents: 0,
  };
  return { id: ID, checkpoint: { schema: CHECKPOINT_SCHEMA, data: data as unknown as JsonObject } };
}

interface Setup {
  h: Harness;
  c: StoryController;
  /** Whether the saved pose's tiles are resident (the fake pre-stream's `ready`). */
  ground: { resident: boolean; collider: boolean };
  prestreams: { x: number; z: number; released: boolean }[];
  seats: { rider: EntityHandle; vehicle: EntityHandle }[];
  setDowns: { rider: EntityHandle; vehicle: EntityHandle }[];
  shown: { tick: number; text: string }[];
  jobsStart(id: string): void;
  run(ticks: number): Promise<void>;
}

function setup(o: {
  seated?: boolean;
  seatPort?: boolean;
  /** What the fake seat port's `seat` answers (default: it seats and answers true). */
  seatOk?: boolean;
  /** The fake port's `setDown`: absent (an older port) or one that records the call and puts the player beside the car. */
  setDown?: boolean;
  /** The cast car's spawn never lands (its entity is gone again within the same flush). */
  noCar?: boolean;
} = {}): Setup {
  const ground = { resident: false, collider: false };
  const h = makeHarness({ groundY: (x, z) => (Math.hypot(x - SAVED.x, z - SAVED.z) < 400 ? (ground.collider ? 3 : null) : 0) });
  const prestreams: Setup['prestreams'] = [];
  (h.ctx.world as unknown as { prestream: unknown }).prestream = (x: number, z: number) => {
    const rec = { x, z, released: false };
    prestreams.push(rec);
    return {
      ready: () => !rec.released && ground.resident,
      release: () => {
        rec.released = true;
      },
    };
  };
  const seats: Setup['seats'] = [];
  const setDowns: Setup['setDowns'] = [];
  if (o.seatPort !== false) {
    (h.ctx as unknown as { vehicleSeat: unknown }).vehicleSeat = {
      seat: (rider: EntityHandle, veh: EntityHandle) => {
        seats.push({ rider, vehicle: veh });
        if (o.seatOk === false) return false;
        seatPlayer(h, veh);
        return true;
      },
      ...(o.setDown === true
        ? {
            setDown: (rider: EntityHandle, veh: EntityHandle) => {
              setDowns.push({ rider, vehicle: veh });
              h.put(rider, CAR.x + PORT_SIDE.x, CAR.z + PORT_SIDE.z, CAR.y);
              return true;
            },
          }
        : {}),
    };
  }
  if (o.noCar === true) {
    const spawn = h.ctx.prefabs.spawn.bind(h.ctx.prefabs);
    (h.ctx.prefabs as unknown as { spawn: unknown }).spawn = (id: string, at: never, key?: never): EntityHandle => {
      const e = spawn(id, at, key);
      if (key === `mis:${ID}:car`) h.ecs.commands.despawn(e);
      return e;
    };
  }
  h.story.activeMission = saved(o.seated === true);
  (h.story.missions as Record<string, unknown>)[ID] = { state: 'available' };
  const payload: CatalogPayload = { missions: [mission], directors: [], cutscenes: [], lines: {}, names: {}, triggers: true };
  const c = new StoryController({ qa: false, bootConfig: () => ({ story: payload }) });
  c.attach(h.ctx, h.story);
  const shown: Setup['shown'] = [];
  const run = async (ticks: number): Promise<void> => {
    for (let i = 0; i < ticks; i++) {
      const before = h.calls.toasts.length;
      c.advance(h.ctx);
      h.ecs.flush();
      for (const t of h.calls.toasts.slice(before)) shown.push({ tick: h.tickNo.n, text: t.text });
      h.tickNo.n++;
      await Promise.resolve();
    }
  };
  const jobsStart = (id: string): void => {
    const before = h.calls.toasts.length;
    c.onEvent(h.ctx, { t: 'mode.cmd', tick: h.tickNo.n, s: JSON.stringify({ mode: 'story', name: 'mission.start', args: { id } }) });
    for (const t of h.calls.toasts.slice(before)) shown.push({ tick: h.tickNo.n, text: t.text });
  };
  return { h, c, ground, prestreams, seats, setDowns, shown, jobsStart, run };
}

const pose = (h: Harness, e: EntityHandle): [number, number, number] => {
  const id = h.ecs.resolve(e) as number;
  const tr = h.ecs.store(Transform);
  return [tr.px[id] as number, tr.py[id] as number, tr.pz[id] as number];
};
const fails = (h: Harness): unknown[] => h.calls.telemetry.filter((t) => t.name === 'mission.fail').map((t) => t.props['reason']);
type JobRowLike = { id: string; state: string; retry?: boolean };
const jobRow = (h: Harness, id: string): JobRowLike | undefined => ((h.vm.get('mode.story.jobs') ?? []) as unknown as JobRowLike[]).find((r) => r.id === id);

describe('checkpoint resume waits for its ground (DL-736)', () => {
  it('with the tiles not resident yet it waits, then restores the exact saved pose of the player and the cast', async () => {
    const { h, c, ground, prestreams, run } = setup();
    await run(16);
    // the saved pose's tiles are asked for, and nothing is written yet: the player stays at the boot spawn, no mission runs
    expect(prestreams).toEqual([{ x: SAVED.x, z: SAVED.z, released: false }]);
    expect(c.rt?.active ?? false).toBe(false);
    expect(pose(h, h.player)).toEqual([0, 0, 0]);
    expect(h.story.activeMission?.id).toBe(ID);
    await run(600);
    expect(c.rt?.active ?? false).toBe(false);
    expect(pose(h, h.player)).toEqual([0, 0, 0]);
    // the tiles are resident, but no static collider is under the pose yet: still waiting
    ground.resident = true;
    await run(30);
    expect(c.rt?.active ?? false).toBe(false);
    // the ground is there: the checkpoint is restored as saved, with no placement search
    ground.collider = true;
    await run(16);
    expect(c.rt?.active).toBe(true);
    expect(c.rt?.stageIndex).toBe(1);
    expect(prestreams[0]!.released).toBe(true);
    expect(pose(h, h.player)).toEqual([SAVED.x, SAVED.y, SAVED.z]);
    expect(pose(h, h.at(`mis:${ID}:car`))).toEqual([CAR.x, CAR.y, CAR.z]);
    expect(pose(h, h.at(`mis:${ID}:pal`))).toEqual([PAL.x, PAL.y, PAL.z]);
    expect(c.rt?.actors.healthFrac('player')).toBeCloseTo(0.75, 6);
    expect(c.rt?.actors.healthFrac('pal')).toBeCloseTo(0.5, 6);
    expect(fails(h)).toEqual([]);
    expect(h.calls.toasts.map((t) => t.text)).not.toContain('mission.startUnreachable');
  });

  it('a resume of a player saved in the cast car keeps the seat', async () => {
    const { h, c, ground, seats, run } = setup({ seated: true });
    ground.resident = true;
    ground.collider = true;
    await run(20);
    expect(c.rt?.active).toBe(true);
    const car = h.at(`mis:${ID}:car`);
    expect(seats).toEqual([{ rider: h.player, vehicle: car }]);
    expect(c.rt?.actors.playerVehicle()).toBe(car);
    expect(c.rt?.actors.inVehicle('player', 'car')).toBe(true);
    expect(pose(h, car)).toEqual([CAR.x, CAR.y, CAR.z]);
    expect(pose(h, h.player)).toEqual([SAVED.x, SAVED.y, SAVED.z]);
    // seated once, not again every tick
    await run(60);
    expect(seats).toHaveLength(1);
  });

  it('with no seat port the seated player is set down on foot at the saved pose', async () => {
    const { h, c, ground, seats, run } = setup({ seated: true, seatPort: false });
    ground.resident = true;
    ground.collider = true;
    await run(20);
    expect(c.rt?.active).toBe(true);
    expect(seats).toHaveLength(0);
    expect(pose(h, h.player)).toEqual([SAVED.x, SAVED.y, SAVED.z]);
  });

  it('shows the loading hint while it waits, and when the budget runs out keeps the checkpoint with mission.startUnreachable and a Jobs Start', async () => {
    const { h, c, prestreams, shown, ground, jobsStart, run } = setup();
    await run(PLACE_BUDGET_TICKS + 30);
    expect(c.rt?.active ?? false).toBe(false);
    // the checkpoint is kept, the player was never moved, the mission is available with a Start
    expect(h.story.activeMission?.id).toBe(ID);
    expect(pose(h, h.player)).toEqual([0, 0, 0]);
    expect(h.story.missions[ID]?.state).toBe('available');
    const texts = shown.map((t) => t.text);
    expect(texts.filter((t) => t === 'mission.startUnreachable')).toHaveLength(1);
    expect(fails(h)).toEqual(['unresolved']);
    expect(prestreams[0]!.released).toBe(true);
    await run(31);
    expect(jobRow(h, ID)).toMatchObject({ state: 'available', retry: true });
    // the hint: first after 5 s, then at most every 20 s
    const hints = shown.filter((t) => t.text === 'mission.startLoading').map((t) => t.tick);
    expect(hints.length).toBeGreaterThanOrEqual(8);
    expect(hints[0]!).toBeGreaterThanOrEqual(PLACE_HINT_AFTER_TICKS);
    for (let i = 1; i < hints.length; i++) expect(hints[i]! - hints[i - 1]!).toBeGreaterThanOrEqual(PLACE_HINT_EVERY_TICKS);
    // nothing else starts it meanwhile, and the checkpoint is not dropped by a trigger pass
    await run(600);
    expect(c.rt?.active ?? false).toBe(false);
    expect(h.story.activeMission?.id).toBe(ID);
    // a Jobs Start waits again with a fresh budget, and resumes the checkpoint (not stage 0) once the ground is there
    jobsStart(ID);
    expect(prestreams).toHaveLength(2);
    expect(c.rt?.active ?? false).toBe(false);
    ground.resident = true;
    ground.collider = true;
    await run(16);
    expect(c.rt?.active).toBe(true);
    expect(c.rt?.stageIndex).toBe(1);
    expect(pose(h, h.player)).toEqual([SAVED.x, SAVED.y, SAVED.z]);
    await run(31);
    expect(jobRow(h, ID)?.retry).toBeUndefined();
  });

  it('the next load tries again: a fresh attach waits for the ground with a fresh budget', async () => {
    const first = setup();
    await first.run(PLACE_BUDGET_TICKS + 30);
    expect(first.h.story.activeMission?.id).toBe(ID);
    // a new session over the same saved slice (the reload): the resume runs again
    first.c.attach(first.h.ctx, first.h.story);
    first.ground.resident = true;
    first.ground.collider = true;
    await first.run(20);
    expect(first.prestreams).toHaveLength(2);
    expect(first.c.rt?.active).toBe(true);
    expect(first.c.rt?.stageIndex).toBe(1);
  });

  it('a world with no pre-stream (gray-box, headless) restores the checkpoint at once, as before', async () => {
    const { h, c, run } = setup();
    delete (h.ctx.world as unknown as { prestream?: unknown }).prestream;
    await run(16);
    expect(c.rt?.active).toBe(true);
    expect(pose(h, h.player)).toEqual([SAVED.x, SAVED.y, SAVED.z]);
  });

  it('a seated resume keeps the pre-stream until the player is seated in the cast car spawned the next tick (BD-FIX-SPAWN-12)', async () => {
    const { c, ground, prestreams, seats, run } = setup({ seated: true });
    ground.resident = true;
    ground.collider = true;
    // tick 0: the trigger pass restores the checkpoint; the cast car is a deferred spawn, so the seat is still to come
    await run(1);
    expect(c.rt?.active).toBe(true);
    expect(c.rt?.restorePending?.seat?.vehicle).toBe('car');
    expect(seats).toHaveLength(0);
    expect(prestreams[0]!.released).toBe(false);
    // tick 1: the car exists, the player is seated, and only then are the tiles let go
    await run(1);
    expect(seats).toHaveLength(1);
    expect(c.rt?.restorePending).toBeNull();
    expect(prestreams[0]!.released).toBe(true);
  });

  it('a seat whose car never comes holds the pre-stream for SEAT_WAIT_TICKS, then sets the player down at the saved pose and lets go', async () => {
    const { h, c, ground, prestreams, seats, run } = setup({ seated: true, noCar: true });
    ground.resident = true;
    ground.collider = true;
    await run(1);
    expect(c.rt?.active).toBe(true);
    await run(SEAT_WAIT_TICKS - 1);
    // tick SEAT_WAIT_TICKS - 1: still waiting for the car, still pinned
    expect(c.rt?.restorePending?.seat).not.toBeNull();
    expect(prestreams[0]!.released).toBe(false);
    await run(1);
    expect(c.rt?.restorePending).toBeNull();
    expect(prestreams[0]!.released).toBe(true);
    expect(seats).toHaveLength(0);
    expect(pose(h, h.player)).toEqual([SAVED.x, SAVED.y, SAVED.z]);
  });

  it('a mode exit before the seat is written releases the held pre-stream', async () => {
    const { h, c, ground, prestreams, run } = setup({ seated: true, noCar: true });
    ground.resident = true;
    ground.collider = true;
    await run(2);
    expect(prestreams[0]!.released).toBe(false);
    c.exit(h.ctx, 'quit');
    expect(prestreams[0]!.released).toBe(true);
  });

  it('a seat the port refuses sets the player down on foot beside the car through the port, with a debug event (BD-FIX-SPAWN-12)', async () => {
    const { h, c, ground, seats, setDowns, run } = setup({ seated: true, seatOk: false, setDown: true });
    ground.resident = true;
    ground.collider = true;
    await run(20);
    expect(c.rt?.active).toBe(true);
    const car = h.at(`mis:${ID}:car`);
    expect(seats).toEqual([{ rider: h.player, vehicle: car }]);
    expect(setDowns).toEqual([{ rider: h.player, vehicle: car }]);
    expect(c.rt?.actors.playerVehicle()).toBeNull();
    const p = pose(h, h.player);
    expect(p).toEqual([CAR.x + PORT_SIDE.x, CAR.y, CAR.z + PORT_SIDE.z]);
    expect(c.rt?.eventLog.filter((e) => e.t === 'resume.seatFailed').map((e) => e.data)).toEqual([{ vehicle: 'car', how: 'port' }]);
    // asked once, not every tick
    await run(60);
    expect(seats).toHaveLength(1);
    expect(setDowns).toHaveLength(1);
  });

  it('a refused seat on a port without setDown puts the player SET_DOWN_SIDE_M to the car\'s left, clear of it, never at the saved seat pose', async () => {
    const { h, c, ground, run } = setup({ seated: true, seatOk: false });
    ground.resident = true;
    ground.collider = true;
    await run(20);
    expect(c.rt?.active).toBe(true);
    expect(c.rt?.actors.playerVehicle()).toBeNull();
    const p = pose(h, h.player);
    const car = pose(h, h.at(`mis:${ID}:car`));
    expect(Math.hypot(p[0] - car[0], p[2] - car[2])).toBeCloseTo(SET_DOWN_SIDE_M, 6);
    expect(p).not.toEqual([SAVED.x, SAVED.y, SAVED.z]);
    // the left of a car facing yaw (forward (-sin, -cos)) is (-cos, +sin)
    const yaw = c.rt?.actors.yawOf(h.at(`mis:${ID}:car`)) ?? 0;
    expect(p[0]).toBeCloseTo(car[0] - Math.cos(yaw) * SET_DOWN_SIDE_M, 6);
    expect(p[2]).toBeCloseTo(car[2] + Math.sin(yaw) * SET_DOWN_SIDE_M, 6);
    expect(c.rt?.eventLog.filter((e) => e.t === 'resume.seatFailed').map((e) => e.data)).toEqual([{ vehicle: 'car', how: 'side' }]);
  });

  it('a mode exit while it waits releases the pre-stream and keeps the checkpoint', async () => {
    const { h, c, prestreams, run } = setup();
    await run(16);
    c.exit(h.ctx, 'quit');
    expect(prestreams[0]!.released).toBe(true);
    expect(h.story.activeMission?.id).toBe(ID);
  });
});
