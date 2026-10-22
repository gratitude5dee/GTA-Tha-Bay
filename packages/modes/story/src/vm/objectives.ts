/**
 * Objectives (C09 section C3 `ObjectiveDef`): one scheduler thread per active objective. A step reads the world, decides whether the
 * objective is `running`, `done` or `failed`, and the runtime acts on the state in its own tick (join modes, stage change, fail).
 * Each step costs 1 op plus the predicate nodes it evaluates. Sim code under the C02 lint.
 */
import type { ObjectiveDef } from '@dv/shared';
import { dsqrt } from '@dv/shared';
import { distXZ, type Vec3 } from './actors.ts';
import { hookStep } from './hooks.ts';
import type { MissionRuntime } from './runtime.ts';
import type { ObjRt } from './types.ts';

export type ObjResult = 'running' | 'done' | 'failed';
const TICKS_PER_SEC = 60;
const COLLECT_REACH_M = 1.8;
const STOPPED_MPS = 0.6;
/** Without `untilZone` or `untilEvent` a follow ends after this many seconds inside the band. */
const FOLLOW_DEFAULT_SEC = 10;
/** Without `sec` or `untilZone` a protect ends after this many seconds. */
const PROTECT_DEFAULT_SEC = 10;

const ticks = (sec: number): number => Math.ceil(sec * TICKS_PER_SEC);

/** Where the player is for zone and distance tests: the vehicle it drives, else the character. */
const playerSide = (rt: MissionRuntime): string => (rt.actors.playerVehicle() !== null ? 'playerVehicle' : 'player');

export function objectiveStep(rt: MissionRuntime, o: ObjRt): () => ObjResult {
  const d = o.def;
  const elapsed = (): number => rt.clock - o.since;
  switch (d.k) {
    case 'goto':
      return () => {
        rt.cost(1);
        const side = playerSide(rt);
        if (!rt.zoneInside(side, d.zone)) return 'running';
        if (d.onFoot === true && rt.actors.playerVehicle() !== null) return 'running';
        if (d.inVehicle !== undefined && !rt.actors.inVehicle('player', d.inVehicle)) return 'running';
        if (d.stopped === true && rt.actors.speed('player') > STOPPED_MPS) return 'running';
        return 'done';
      };
    case 'enterVehicle':
      return () => {
        rt.cost(1);
        return rt.actors.inVehicle('player', d.vehicle) ? 'done' : 'running';
      };
    case 'follow':
      return () => {
        rt.cost(1);
        const dist = rt.actors.distance('player', d.target);
        if (dist > d.band[1]) o.data['lost'] = (o.data['lost'] ?? 0) + 1;
        else o.data['lost'] = 0;
        if ((o.data['lost'] ?? 0) > ticks(d.loseAfterSec)) return 'failed';
        if (d.untilZone !== undefined) return rt.zoneInside('player', d.untilZone) || rt.zoneInside(playerSide(rt), d.untilZone) ? 'done' : 'running';
        if (d.untilEvent !== undefined) return rt.eventCount(d.untilEvent) > (o.data['base'] ?? 0) ? 'done' : 'running';
        if (dist <= d.band[1]) o.data['held'] = (o.data['held'] ?? 0) + 1;
        return (o.data['held'] ?? 0) >= ticks(FOLLOW_DEFAULT_SEC) ? 'done' : 'running';
      };
    case 'chase':
      return () => {
        rt.cost(1);
        const dist = rt.actors.distance(playerSide(rt), d.target);
        o.data['held'] = dist <= d.catchDist ? (o.data['held'] ?? 0) + 1 : 0;
        return (o.data['held'] ?? 0) > ticks(d.holdSec ?? 0) ? 'done' : 'running';
      };
    case 'escape':
      return () => {
        rt.cost(1);
        return rt.heat().level === 0 ? 'done' : 'running';
      };
    case 'survive':
      return () => {
        rt.cost(1);
        return elapsed() >= ticks(d.sec) ? 'done' : 'running';
      };
    case 'wait':
      return () => {
        rt.cost(1);
        return elapsed() >= ticks(d.sec) ? 'done' : 'running';
      };
    case 'collect':
      return () => {
        rt.cost(1);
        if (rt.isCarried(d.cast)) return 'done';
        const h = rt.actors.cast(d.cast);
        if (h === null) return 'running';
        if (rt.actors.distance('player', d.cast) > COLLECT_REACH_M) return 'running';
        rt.carry(d.cast);
        return 'done';
      };
    case 'deliver':
      return () => {
        rt.cost(1);
        if (d.fragile !== undefined && rt.actors.damage(d.cast) > d.fragile) return 'failed';
        const side = playerSide(rt);
        if (rt.isCarried(d.cast)) return rt.zoneInside(side, d.to) ? deliverIt(rt, d.cast) : 'running';
        const h = rt.actors.cast(d.cast);
        if (h !== null && rt.zoneInside(d.cast, d.to)) return 'done';
        return 'running';
      };
    case 'protect':
      return () => {
        rt.cost(1);
        const f = rt.actors.healthFrac(d.target);
        if (rt.actors.cast(d.target) === null || (f !== null && f < d.minHealth)) return 'failed';
        if (d.untilZone !== undefined && rt.zoneInside(d.target, d.untilZone)) return 'done';
        const sec = d.sec ?? (d.untilZone === undefined ? PROTECT_DEFAULT_SEC : Infinity);
        return elapsed() >= ticks(sec) ? 'done' : 'running';
      };
    case 'talk':
      return () => {
        rt.cost(1);
        if (o.data['offered'] === undefined) {
          o.data['offered'] = 1;
          rt.offerTalk(d.talk, o);
        }
        return rt.talkResults[d.talk.id] !== undefined ? 'done' : 'running';
      };
    case 'photo':
      return () => {
        rt.cost(1);
        if (rt.eventCount('photo.taken') <= (o.data['base'] ?? 0)) return 'running';
        o.data['base'] = rt.eventCount('photo.taken');
        if (d.maxDistM === undefined) return 'done';
        const subject = d.subject.startsWith('lm.') ? rt.landmarkPos(d.subject) : rt.actors.pos(d.subject);
        const me = rt.actors.pos('player');
        return subject !== null && me !== null && distXZ(me, subject) <= d.maxDistM ? 'done' : 'running';
      };
    case 'stealth':
      return () => {
        rt.cost(1);
        const seen = rt.eventCount('npc.detect') - (o.data['base'] ?? 0);
        if (seen > d.detectBudget) return 'failed';
        return rt.zoneInside(playerSide(rt), d.zone) ? 'done' : 'running';
      };
    case 'defeat':
      return () => {
        rt.cost(d.targets.length);
        return d.targets.every((t) => rt.actors.cast(t) === null || rt.actors.isKo(t)) ? 'done' : 'running';
      };
    case 'score':
      return () => {
        rt.cost(1);
        const got = rt.eventSum(`score.${d.metric}`) - (o.data['base'] ?? 0);
        o.data['score'] = got;
        if (got >= d.target) return 'done';
        return elapsed() > ticks(d.withinSec) ? 'failed' : 'running';
      };
    case 'mode':
      return hookStep(rt, o, d);
  }
}

function deliverIt(rt: MissionRuntime, cast: string): ObjResult {
  rt.uncarry(cast);
  return 'done';
}

/** Initial `data` of an objective when it becomes active: baselines of the event counters it reads. */
export function startObjective(rt: MissionRuntime, d: ObjectiveDef, o: ObjRt): void {
  switch (d.k) {
    case 'follow':
      o.data['base'] = d.untilEvent !== undefined ? rt.eventCount(d.untilEvent) : 0;
      break;
    case 'photo':
      o.data['base'] = rt.eventCount('photo.taken');
      break;
    case 'stealth':
      o.data['base'] = rt.eventCount('npc.detect');
      break;
    case 'score':
      o.data['base'] = rt.eventSum(`score.${d.metric}`);
      break;
    default:
      break;
  }
}

/** The world point an objective points at (the marker), or null when it has none. */
export function objectiveTarget(rt: MissionRuntime, d: ObjectiveDef): Vec3 | null {
  switch (d.k) {
    case 'goto':
      return rt.zoneCenter(d.zone);
    case 'deliver':
      return rt.zoneCenter(d.to);
    case 'follow':
      return d.untilZone !== undefined ? rt.zoneCenter(d.untilZone) : rt.actors.pos(d.target);
    case 'chase':
    case 'protect':
      return rt.actors.pos(d.target);
    case 'collect':
      return rt.actors.pos(d.cast);
    case 'enterVehicle':
      return d.vehicle === 'any' ? null : rt.actors.pos(d.vehicle);
    case 'stealth':
      return rt.zoneCenter(d.zone);
    case 'photo':
      return d.subject.startsWith('lm.') ? rt.landmarkPos(d.subject) : rt.actors.pos(d.subject);
    case 'talk':
      return rt.actors.pos(d.talk.npc);
    case 'defeat':
      return rt.actors.pos(d.targets[0] ?? '');
    default:
      return null;
  }
}

export const lengthXZ = (a: number, b: number): number => dsqrt(a * a + b * b);
