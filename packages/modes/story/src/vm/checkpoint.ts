/**
 * Mission checkpoints (C09 `MissionCheckpointV1`, section C6): written on entry to a stage that has `checkpoint` into
 * `StorySlice.activeMission`, followed by `ctx.save.request('checkpoint')`. A retry restores the player's pose and health, the
 * cast, the mission flags, the wallet delta, the mission RNG and the mission clock, and restarts that stage's threads. Carried
 * cast entries are recorded as mission flags named `mis.carry.<cast>` (the checkpoint shape has no field for them). Sim code under
 * the C02 lint.
 */
import type { CastName, JsonObject, MissionCheckpointV1 } from '@dv/shared';
import { CHECKPOINT_SCHEMA } from './constants.ts';
import type { MissionRuntime } from './runtime.ts';
import { byStr } from './util.ts';

const CARRY_PREFIX = 'mis.carry.';

export function captureCheckpoint(rt: MissionRuntime): MissionCheckpointV1 {
  const a = rt.actors;
  const flags: MissionCheckpointV1['flags'] = {};
  const story = rt.story();
  for (const k of [...rt.touchedFlags].sort(byStr)) {
    const v = story.flags[k];
    if (v !== undefined) flags[k] = v;
  }
  for (const c of [...rt.carriedSet].sort(byStr)) flags[`${CARRY_PREFIX}${c}`] = true;

  const cast: MissionCheckpointV1['cast'] = {};
  for (const name of Object.keys(rt.ir.cast).sort(byStr)) {
    const cr = rt.castRt.get(name);
    const h = a.cast(name);
    if (!cr || (h === null && (!cr.live || rt.carriedSet.has(name)))) {
      cast[name] = { alive: false };
      continue;
    }
    if (h === null) {
      // spawned this tick: the entity exists from the next stage, so the spawn pose stands for it
      const sp = rt.rm.spawns[name];
      cast[name] = sp ? { alive: true, x: sp.pos[0], y: sp.pos[1], z: sp.pos[2], yaw: sp.yaw } : { alive: true };
      continue;
    }
    const p = a.posOf(h) ?? [0, 0, 0];
    const entry: MissionCheckpointV1['cast'][string] = { alive: !a.isKo(name), x: p[0], y: p[1], z: p[2], yaw: a.yawOf(h) };
    const hp = a.healthFrac(name);
    if (hp !== null) entry.health = hp;
    cast[name] = entry;
  }

  const ph = a.player();
  const pp = ph ? (a.posOf(ph) ?? [0, 0, 0]) : [0, 0, 0];
  const pv = a.playerVehicle();
  const vehicleName = pv === null ? undefined : Object.keys(rt.ir.cast).find((n) => a.cast(n) === pv);
  const player: MissionCheckpointV1['player'] = { x: pp[0] as number, y: pp[1] as number, z: pp[2] as number, yaw: ph ? a.yawOf(ph) : 0, health: a.healthFrac('player') ?? 1 };
  if (vehicleName !== undefined) player.vehicle = vehicleName;

  return {
    missionId: rt.ir.id,
    version: rt.ir.version,
    worldBake: rt.rm.bake,
    stage: Math.max(0, rt.stageIndex),
    attempt: rt.attempt,
    seed: rt.seed,
    rng: rt.rng.getState(),
    elapsedSec: rt.clock / 60,
    flags,
    objectivesDone: [...rt.doneIds].sort(byStr),
    talkResults: { ...rt.talkResults },
    player,
    cast,
    walletDeltaCents: rt.walletDelta,
  };
}

/** Writes the checkpoint into the story slice and asks for a save. */
export function writeCheckpoint(rt: MissionRuntime, cp: MissionCheckpointV1): void {
  rt.story().activeMission = { id: cp.missionId, checkpoint: { schema: CHECKPOINT_SCHEMA, data: cp as unknown as JsonObject } };
  rt.ctx.save.request('checkpoint');
}

/** The checkpoint of a slice's `activeMission` for `missionId`, when it matches this version and world bake; null otherwise. */
export function readCheckpoint(active: { id: string; checkpoint: { schema: number; data: JsonObject } } | null, missionId: string, version: number, bake: string): MissionCheckpointV1 | null {
  if (!active || active.id !== missionId || active.checkpoint.schema !== CHECKPOINT_SCHEMA) return null;
  const cp = active.checkpoint.data as unknown as MissionCheckpointV1;
  return cp.version === version && cp.worldBake === bake ? cp : null;
}

/** Ticks a resumed save waits for the cast vehicle it seats the player in before it sets the player down on foot instead (DL-736). */
export const SEAT_WAIT_TICKS = 30;

/**
 * Puts the world and the mission state back to what `cp` holds. The stage's threads are restarted by the caller. With `load` (a saved
 * game resumed after a load, DL-736) the cast is spawned at its saved poses and the player and the cast are written as saved, with no
 * placement search; the cast's health, and the player seated in the cast vehicle `cp.player.vehicle`, follow on the first tick those
 * entities exist (`MissionRuntime.restorePending`), since a spawn is a deferred ECS command.
 */
export function restoreCheckpoint(rt: MissionRuntime, cp: MissionCheckpointV1, load = false): void {
  const a = rt.actors;
  const story = rt.story();

  // mission flags: the ones the mission touched go back to their checkpoint value, or away
  for (const k of [...rt.touchedFlags]) {
    const v = cp.flags[k];
    if (v === undefined) delete story.flags[k];
    else story.flags[k] = v;
  }
  rt.carriedSet.clear();
  for (const k of Object.keys(cp.flags)) {
    if (k.startsWith(CARRY_PREFIX)) rt.carriedSet.add(k.slice(CARRY_PREFIX.length));
  }

  const pending: NonNullable<MissionRuntime['restorePending']> = { health: new Map(), seat: null };
  // cast
  for (const name of Object.keys(rt.ir.cast).sort(byStr) as CastName[]) {
    const c = cp.cast[name];
    const cr = rt.castRt.get(name);
    if (!cr) continue;
    if (!c || !c.alive || rt.carriedSet.has(name)) {
      rt.despawnCast(name, true);
      continue;
    }
    if (a.cast(name) === null) rt.spawnCast(name, c.x !== undefined && c.y !== undefined && c.z !== undefined ? { pos: [c.x, c.y, c.z], yaw: c.yaw ?? 0 } : undefined);
    const h = a.cast(name);
    if (h !== null && c.x !== undefined && c.y !== undefined && c.z !== undefined) {
      a.place(h, [c.x, c.y, c.z], c.yaw ?? 0);
      if (c.health !== undefined) a.setHealth(h, c.health);
    } else if (h === null && load && c.health !== undefined) {
      pending.health.set(name, c.health);
    }
  }

  // the player: as saved; a player saved in a cast vehicle is put back in its seat once the vehicle exists
  const ph = a.player();
  if (ph !== null) {
    const pos: [number, number, number] = [cp.player.x, cp.player.y, cp.player.z];
    const inCast = load && cp.player.vehicle !== undefined && rt.castRt.has(cp.player.vehicle) && !rt.carriedSet.has(cp.player.vehicle);
    if (inCast) pending.seat = { vehicle: cp.player.vehicle as string, pos, yaw: cp.player.yaw, until: rt.ctx.tick + SEAT_WAIT_TICKS };
    else a.place(ph, pos, cp.player.yaw);
    a.setHealth(ph, cp.player.health);
  }
  rt.restorePending = pending.health.size > 0 || pending.seat !== null ? pending : null;

  // wallet: whatever the mission credited after the checkpoint is taken back
  const surplus = rt.walletDelta - cp.walletDeltaCents;
  if (surplus > 0) {
    rt.revokeGen++;
    rt.ctx.economy.debit(surplus, 'mission.retry', `mis:${rt.ir.id}:revoke:${rt.revokeGen}`);
  }
  rt.walletDelta = cp.walletDeltaCents;

  // M02g1: the world clock is not part of the checkpoint, and a stage that holds or releases it ran before this one. The `clock` ops of the
  // stages before the checkpoint stage run again, in order, so a resume or a retry finds the clock as the mission left it (m.a1.01: the
  // dawn lock at `to_gate`, then the release and the blend to clear at `truck`: never fogged at `tow_home`).
  for (let i = 0; i < cp.stage && i < rt.ir.stages.length; i++) {
    for (const op of rt.ir.stages[i]?.onEnter ?? []) if (op.op === 'clock') rt.applyClockOp(op);
  }

  rt.rng.setState(cp.rng);
  rt.clock = Math.round(cp.elapsedSec * 60);
  rt.doneIds = new Set(cp.objectivesDone);
  rt.talkResults = { ...cp.talkResults };
}
