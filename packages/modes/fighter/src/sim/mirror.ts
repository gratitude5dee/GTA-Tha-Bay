/**
 * The mirror of a match (FC2 "ECS mirror"): the buffer is the truth; two projections leave it. The ECS projection (`FighterView`
 * 1280, `FightDigest` 1281, `ProjectileView` 1282, `StageProp` 1283) exists when the fighter sim module is on, and carries the
 * match hash into the engine `stateHash`. The view model `mode.fighter.view` is what the presenter and the HUD read; it exists in
 * every session. Fighters are entities with the StableKey `npc:<fighterId>` (the player: `player:0` when no such entity exists);
 * the projectile pool is 16 entities spawned once and reused, `pfb:fx:<serial>`. Sim code under the C02 lint.
 */
import { NULL_HANDLE, type EntityHandle, type ModeContext, type StableKey } from '@dv/shared';
import { FF, FM, PROJ_BASE, PROJ_MAX, PROJ_WORDS, PW } from '@dv/shared/fight';
import { FighterView, FightDigest, ProjectileView, StageProp } from '../components.ts';
import type { CamPlan } from './camera.ts';
import type { FighterMatch } from './match.ts';
import type { FightView, FighterRow } from './vm.ts';

export interface MirrorTargets {
  fighters: [EntityHandle, EntityHandle];
  projectiles: EntityHandle[];
  digest: EntityHandle;
  stage: EntityHandle;
}

const NEUTRAL_AT = { pos: [0, 0, 0] as [number, number, number], yaw: 0 };

/** Spawns the mirror entities. Returns null when the components or the prefabs are not there (the module is off): the mode then runs on the view model alone. */
export function spawnMirror(ctx: ModeContext, ids: [string, string]): MirrorTargets | null {
  try {
    ctx.ecs.store(FighterView);
    ctx.ecs.store(FightDigest);
  } catch {
    return null;
  }
  try {
    const hasPlayer = ctx.ecs.byKey('player:0' as StableKey) !== NULL_HANDLE;
    const key = (slot: 0 | 1): StableKey => (slot === 0 && !hasPlayer && ids[0] === 'player' ? 'player:0' : (`npc:${ids[slot]}` as StableKey));
    const fighters: [EntityHandle, EntityHandle] = [
      ctx.prefabs.spawn('fighter.view', NEUTRAL_AT, key(0), { 'FighterView.slot': 0 }),
      ctx.prefabs.spawn('fighter.view', NEUTRAL_AT, key(1), { 'FighterView.slot': 1 }),
    ];
    const projectiles: EntityHandle[] = [];
    for (let i = 0; i < PROJ_MAX; i++) projectiles.push(ctx.prefabs.spawn('fighter.projectile', NEUTRAL_AT, `pfb:fx:${i}` as StableKey));
    const digest = ctx.prefabs.spawn('fighter.digest', NEUTRAL_AT, 'pfb:fx:digest' as StableKey);
    const stage = ctx.prefabs.spawn('fighter.stage', NEUTRAL_AT, 'pfb:fx:stage' as StableKey);
    return { fighters, projectiles, digest, stage };
  } catch {
    return null;
  }
}

export function despawnMirror(ctx: ModeContext, t: MirrorTargets | null): void {
  if (!t) return;
  try {
    for (const h of [...t.fighters, ...t.projectiles, t.digest, t.stage]) ctx.prefabs.despawn(h);
  } catch {
    // the world is going away
  }
}

/** Writes the buffer into the components; the digest is the match hash of this tick. Handles that do not resolve yet (spawned this tick) are skipped. */
export function writeMirror(ctx: ModeContext, t: MirrorTargets, m: FighterMatch, stagePhase: number): void {
  const ecs = ctx.ecs;
  const fv = ecs.store(FighterView);
  for (let s = 0; s < 2; s++) {
    const id = ecs.resolve(t.fighters[s as 0 | 1]);
    if (id === null) continue;
    fv.slot[id] = s;
    fv.state[id] = m.w(s as 0 | 1, FF.State);
    fv.move[id] = Math.max(0, m.w(s as 0 | 1, FF.Move) + 1);
    fv.frame[id] = m.w(s as 0 | 1, FF.MoveFrame);
    fv.facing[id] = m.w(s as 0 | 1, FF.Facing);
    fv.hitFlash[id] = Math.min(255, m.w(s as 0 | 1, FF.Hitstop) * 10);
  }
  const pv = ecs.store(ProjectileView);
  for (let p = 0; p < PROJ_MAX; p++) {
    const id = ecs.resolve(t.projectiles[p] as EntityHandle);
    if (id === null) continue;
    const b = PROJ_BASE + p * PROJ_WORDS;
    const owner = m.buf[b + PW.Owner] as number;
    pv.kind[id] = owner === 0 ? 0 : 1 + (m.buf[b + PW.Def] as number);
    pv.owner[id] = owner;
    pv.frame[id] = Math.min(65535, m.buf[b + PW.Frame] as number);
  }
  const did = ecs.resolve(t.digest);
  if (did !== null) {
    const [lo, hi] = m.hash();
    const dg = ecs.store(FightDigest);
    dg.lo[did] = lo; dg.hi[did] = hi; dg.tick[did] = m.tick;
  }
  const sid = ecs.resolve(t.stage);
  if (sid !== null) {
    const sp = ecs.store(StageProp);
    sp.prop[sid] = 0; sp.phase[sid] = stagePhase;
  }
}

const row = (m: FighterMatch, s: 0 | 1): FighterRow => [
  m.w(s, FF.X), m.w(s, FF.Y), m.w(s, FF.Facing), m.w(s, FF.State), m.w(s, FF.Move), m.w(s, FF.MoveFrame), m.w(s, FF.Hitstop),
  m.w(s, FF.Hp), m.w(s, FF.Hype), m.w(s, FF.Composure), m.w(s, FF.Rattled), m.w(s, FF.ComboHits), m.w(s, FF.Hitstun), m.w(s, FF.Blockstun), m.w(s, FF.Invuln),
];

export interface ViewExtras {
  stage: string; night: boolean; scheme: [number, number]; cpu: [number, number]; ids: [string, string];
  reducedMotion: boolean; paused: boolean; freeze: number;
}

/** The view model of this tick (`mode.fighter.view`). */
export function buildView(m: FighterMatch, plan: CamPlan, x: ViewExtras): FightView {
  const projectiles: number[][] = [];
  for (let p = 0; p < PROJ_MAX; p++) {
    const b = PROJ_BASE + p * PROJ_WORDS;
    const owner = m.buf[b + PW.Owner] as number;
    if (owner === 0) continue;
    projectiles.push([owner - 1, m.buf[b + PW.Def] as number, m.buf[b + PW.X] as number, m.buf[b + PW.Y] as number, m.buf[b + PW.Frame] as number, m.buf[b + PW.Ex] as number, m.buf[b + PW.Dir] as number]);
  }
  return {
    v: 1,
    t: m.tick,
    ph: m.phase, pf: m.phaseFrame, rd: m.round, rw: m.rounds, tm: m.buf[FM.Timer] as number,
    f: [row(m, 0), row(m, 1)],
    p: projectiles,
    e: m.events.rows(),
    cam: [plan.cx, plan.dist, plan.dollyFrames, plan.shakeMilli, plan.height, plan.fovDeg],
    st: x.stage, nt: x.night ? 1 : 0,
    fz: x.freeze,
    sc: x.scheme, cpu: x.cpu, id: x.ids,
    rm: x.reducedMotion ? 1 : 0,
    pa: x.paused ? 1 : 0,
  };
}

