/**
 * The leaf library and the activity subtrees (04-npc-builder.md section C8; M06c): `Goto`, `Animate`, `UseSmartObject`, `Talk`, `Flee`, plus
 * `Wander`, which picks the point the next `Goto` walks to. Leaves set the agent's velocity; the sim integrates it every tick. Every random
 * choice comes from the agent's own seeded stream. Sim code; C02 lint applies.
 */
import { TWO_PI, datan2, dcos, dsin, dsqrt } from '@dv/shared';
import type { Activity } from '@dv/shared/contracts/c10-npc';
import { ANIM, UTILITY, type NpcAgent } from './agent.ts';
import { loop, sel, seq, Status, type BtLeaf, type BtNode, type StatusId } from './bt.ts';
import type { BtCtx } from './bt-ctx.ts';
import { secondsToTicks } from './config.ts';

/** Heading for a movement or look direction: the ped convention, `atan2(-dx, -dz)` in [0, 2 pi). */
export function yawToward(dx: number, dz: number): number {
  const y = datan2(-dx, -dz);
  return y < 0 ? y + TWO_PI : y;
}

const dist = (dx: number, dz: number): number => dsqrt(dx * dx + dz * dz);

/** Sets the velocity that reaches (tx, tz) without overshooting this step. True when already there. */
function moveToward(a: NpcAgent, tx: number, tz: number, speed: number, ctx: BtCtx, arriveM: number = ctx.cfg.brains.arriveM): boolean {
  const dx = tx - a.x;
  const dz = tz - a.z;
  const d = dist(dx, dz);
  if (d <= arriveM) {
    a.vx = 0;
    a.vz = 0;
    return true;
  }
  const sp = Math.min(speed, d / ctx.stepS);
  a.vx = (dx / d) * sp;
  a.vz = (dz / d) * sp;
  a.yaw = yawToward(dx, dz);
  a.anim = sp > ctx.cfg.brains.walkMps * 1.5 ? ANIM.run : ANIM.walk;
  return false;
}

const stand = (a: NpcAgent, anim: number): void => {
  a.vx = 0;
  a.vz = 0;
  a.anim = anim;
};

/** Arrival radius while following a commute. */
const COMMUTE_ARRIVE_M = 0.25;
export const GOTO_BLOCK = 0;
export const GOTO_INTENT = 1;
export const GOTO_WANDER = 2;

/** Leaf ids. */
export const LEAF = { Goto: 1, Animate: 2, UseSmartObject: 3, Talk: 4, Flee: 5, Wander: 6 } as const;
export const LEAF_NAMES: Readonly<Record<number, string>> = { 1: 'Goto', 2: 'Animate', 3: 'UseSmartObject', 4: 'Talk', 5: 'Flee', 6: 'Wander' };

/** Walks to the schedule target (0), the intent target (1) or the wander point (2); succeeds on arrival. */
export function gotoLeaf(kind: number): BtLeaf {
  return {
    k: 'leaf',
    id: LEAF.Goto,
    name: 'Goto',
    run(a, ctx): StatusId {
      let tx = ctx.target.x;
      let tz = ctx.target.z;
      let speed = ctx.cfg.brains.walkMps;
      if (kind === GOTO_INTENT && a.intent) {
        tx = a.intent.tx;
        tz = a.intent.tz;
        if (a.intent.urgency === 2) speed = ctx.cfg.brains.walkMps * 1.6;
      } else if (kind === GOTO_WANDER) {
        tx = a.wx;
        tz = a.wz;
      }
      // An NPC that fell far behind its schedule (a long interrupt, a teleport) catches up at once instead of walking across the city.
      if (kind === GOTO_BLOCK && dist(tx - a.x, tz - a.z) > ctx.cfg.brains.snapLagM) {
        a.x = tx;
        a.z = tz;
        a.y = ctx.target.y;
      }
      // a commute target moves with the clock: stay close to it so the walk is steady instead of 1 m bursts
      const arrive = kind === GOTO_BLOCK && ctx.target.activity === 'commute' ? COMMUTE_ARRIVE_M : ctx.cfg.brains.arriveM;
      if (moveToward(a, tx, tz, speed, ctx, arrive)) {
        a.anim = ANIM.idle;
        return Status.Success;
      }
      return Status.Running;
    },
  };
}

type Range = 'anim' | 'sleep';

/** Stands still and plays `anim` for a seeded time. */
export function animateLeaf(anim: number, range: Range): BtLeaf {
  return {
    k: 'leaf',
    id: LEAF.Animate,
    name: 'Animate',
    run(a, ctx): StatusId {
      if (a.leafAux < 0) {
        const r = range === 'sleep' ? ctx.cfg.brains.sleepSeconds : ctx.cfg.brains.animSeconds;
        a.leafAux = secondsToTicks(a.rng.range(r.min, r.max));
        a.leafT = 0;
      }
      stand(a, anim);
      a.leafT += ctx.stepTicks;
      if (a.leafT >= a.leafAux) {
        a.leafT = 0;
        a.leafAux = -1;
        return Status.Success;
      }
      return Status.Running;
    },
  };
}

/**
 * Uses the prop of the block's place: at most `smartObjectSlots` NPCs per place. Fails (so a selector falls back to a plain animation)
 * when the slots are taken. The slot is released when the use ends or the tree restarts.
 */
export function useSmartObjectLeaf(anim: number): BtLeaf {
  return {
    k: 'leaf',
    id: LEAF.UseSmartObject,
    name: 'UseSmartObject',
    run(a, ctx): StatusId {
      const poi = ctx.target.poi;
      if (a.slotPoi === '') {
        if (ctx.slots.count(poi) >= ctx.cfg.brains.smartObjectSlots) return Status.Failure;
        ctx.slots.claim(poi);
        a.slotPoi = poi;
      }
      if (a.leafAux < 0) {
        a.leafAux = secondsToTicks(a.rng.range(ctx.cfg.brains.animSeconds.min, ctx.cfg.brains.animSeconds.max));
        a.leafT = 0;
      }
      stand(a, anim);
      a.leafT += ctx.stepTicks;
      if (a.leafT >= a.leafAux) {
        ctx.slots.release(a.slotPoi);
        a.slotPoi = '';
        a.leafT = 0;
        a.leafAux = -1;
        return Status.Success;
      }
      return Status.Running;
    },
  };
}

/** Picks a point within `wanderM` of the schedule target. Always succeeds. */
export function wanderLeaf(): BtLeaf {
  return {
    k: 'leaf',
    id: LEAF.Wander,
    name: 'Wander',
    run(a, ctx): StatusId {
      const r = ctx.cfg.brains.wanderM * a.rng.nextFloat();
      const ang = a.rng.nextFloat() * TWO_PI;
      a.wx = ctx.target.x + dcos(ang) * r;
      a.wz = ctx.target.z + dsin(ang) * r;
      return Status.Success;
    },
  };
}

/** Faces the player and waits while a conversation is open. */
export function talkLeaf(): BtLeaf {
  return {
    k: 'leaf',
    id: LEAF.Talk,
    name: 'Talk',
    run(a, ctx): StatusId {
      if (!a.talking) return Status.Success;
      stand(a, ANIM.idle);
      const p = ctx.env.player;
      if (p) a.yaw = yawToward(p.x - a.x, p.z - a.z);
      return Status.Running;
    },
  };
}

/** Runs from the threat (or the player when there is none) for `fleeS` seconds. */
export function fleeLeaf(): BtLeaf {
  return {
    k: 'leaf',
    id: LEAF.Flee,
    name: 'Flee',
    run(a, ctx): StatusId {
      if (a.leafAux < 0) {
        a.leafAux = secondsToTicks(ctx.cfg.brains.fleeS);
        a.leafT = 0;
        const from = a.threat ?? ctx.env.player;
        let dx = a.x - (from ? from.x : a.x - 1);
        let dz = a.z - (from ? from.z : a.z);
        const d = dist(dx, dz);
        if (d < 0.01) {
          dx = 1;
          dz = 0;
        } else {
          dx /= d;
          dz /= d;
        }
        a.wx = a.x + dx * ctx.cfg.brains.fleeMinM;
        a.wz = a.z + dz * ctx.cfg.brains.fleeMinM;
      }
      moveToward(a, a.wx, a.wz, ctx.cfg.brains.runMps, ctx);
      a.leafT += ctx.stepTicks;
      if (a.leafT >= a.leafAux) {
        a.leafT = 0;
        a.leafAux = -1;
        stand(a, ANIM.idle);
        return Status.Success;
      }
      return Status.Running;
    },
  };
}

/** The behaviour trees by id. A utility winner and, for the schedule, an activity pick one. */
export const TREE = { Sleep: 0, Work: 1, Social: 2, Patrol: 3, Idle: 4, Intent: 5, Greet: 6, Flee: 7, Hold: 8, Talk: 9, Commute: 10 } as const;
export type TreeId = (typeof TREE)[keyof typeof TREE];
export const TREE_NAMES: readonly string[] = ['sleep', 'work', 'social', 'patrol', 'idle', 'intent', 'greet', 'flee', 'hold', 'talk', 'commute'];

const toBlock = gotoLeaf(GOTO_BLOCK);
const toWander = gotoLeaf(GOTO_WANDER);

export const TREES: readonly BtNode[] = [
  /* Sleep */ loop(seq(toBlock, animateLeaf(ANIM.idle, 'sleep'))),
  /* Work */ loop(seq(toBlock, sel(useSmartObjectLeaf(ANIM.emote), animateLeaf(ANIM.emote, 'anim')), animateLeaf(ANIM.idle, 'anim'))),
  /* Social */ loop(seq(toBlock, animateLeaf(ANIM.emote, 'anim'), wanderLeaf(), toWander)),
  /* Patrol */ loop(seq(toBlock, wanderLeaf(), toWander, animateLeaf(ANIM.idle, 'anim'))),
  /* Idle */ loop(seq(toBlock, animateLeaf(ANIM.idle, 'anim'))),
  /* Intent */ loop(seq(gotoLeaf(GOTO_INTENT), animateLeaf(ANIM.idle, 'anim'))),
  /* Greet */ loop(animateLeaf(ANIM.emote, 'anim')),
  /* Flee */ loop(fleeLeaf()),
  /* Hold */ loop(animateLeaf(ANIM.idle, 'anim')),
  /* Talk */ loop(talkLeaf()),
  /* Commute */ loop(toBlock),
];

/** The schedule subtree of an activity. */
export function treeForActivity(act: Activity): TreeId {
  switch (act) {
    case 'sleep':
      return TREE.Sleep;
    case 'work': case 'hustle': case 'train': case 'record': case 'perform': case 'shop': case 'pitch': case 'race':
      return TREE.Work;
    case 'eat': case 'socialize':
      return TREE.Social;
    case 'patrol':
      return TREE.Patrol;
    case 'commute':
      return TREE.Commute;
    default:
      return TREE.Idle;
  }
}

/** The tree a utility winner runs (the schedule winner picks by activity). */
export function treeFor(winner: number, act: Activity): TreeId {
  switch (winner) {
    case UTILITY.Talk:
      return TREE.Talk;
    case UTILITY.Hold:
      return TREE.Hold;
    case UTILITY.Flee:
      return TREE.Flee;
    case UTILITY.Intent:
      return TREE.Intent;
    case UTILITY.Greet:
      return TREE.Greet;
    default:
      return treeForActivity(act);
  }
}
