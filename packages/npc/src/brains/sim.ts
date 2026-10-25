/**
 * `BrainSim`: the named-NPC brains without the ECS (04-npc-builder.md section C8; M06c). It owns the agents, runs `ScheduleSystem`,
 * `UtilitySystem`, `BtSystem` and `NpcLodSystem` at the C02 AI rate, answers `whereIs` for any NPC at any LOD, takes the hero intents
 * (live or replayed from a recording) and hashes, saves and loads its whole state. `system.ts` mirrors it into components 768 to 775 and
 * the entities; a headless test drives it directly. Sim code; C02 lint applies.
 *
 * Time: `tick(env)` is called once per sim tick (60 Hz). It moves the agents of LOD A and B by their velocity every tick, and on every
 * second tick (the AI step, 30 Hz) classifies LOD and runs the brains: A on every 3rd AI step (staggered by slot), B on every 15th.
 */
import { dsqrt, Fnv64, type PoiId } from '@dv/shared';
import type { CompiledSoulPublic, NpcIntent } from '@dv/shared/contracts/c10-npc';
import { whereIs, type Vec3, type WhereIsResult } from '@dv/shared/npc';
import {
  ANIM, LOD, UTILITY, UTILITY_NAMES, NpcAgent,
  type BrainEnv, type BrainEvent, type BrainWorld, type IntentGoalState, type LodTier, type TraceRecord, type UtilityKind,
} from './agent.ts';
import { btReset, runTree } from './bt.ts';
import { SmartSlots, type BtCtx } from './bt-ctx.ts';
import { TREES, yawToward, treeFor } from './bt-nodes.ts';
import { BRAIN_CONFIG, AI_STEP_TICKS, SIM_HZ, type BrainConfig } from './config.ts';
import { assignLod, type LodCounts } from './lod-system.ts';
import { rollDay, scheduleStep } from './schedule-system.ts';
import { utilityStep } from './utility-system.ts';

export interface Sink {
  u8(v: number): void;
  u32(v: number): void;
  i32(v: number): void;
  f64(v: number): void;
  str(s: string): void;
}
export interface Source {
  u8(): number;
  u32(): number;
  i32(): number;
  f64(): number;
  str(): string;
}

export interface BrainSimOptions {
  /** The world seed: the daily streams derive from it. */
  seed: number;
  world: BrainWorld;
  /** LOD-A brains the tier allows. */
  cap: number;
  cfg?: BrainConfig;
  /** Receives one record per brain step run (tests compare traces). */
  trace?: (r: TraceRecord) => void;
}

interface PendingIntent {
  tick: number;
  npcId: string;
  intent: NpcIntent;
}

const DT = 1 / SIM_HZ;
/** LOD is classified every this many AI steps (6 Hz). */
const LOD_EVERY = 5;
/** A conversation that nothing closed ends by itself after this many ticks. */
const TALK_TIMEOUT_TICKS = 60 * SIM_HZ;

const SECONDS_OF_UNTIL: Record<NpcIntent['until'], number> = { next_block: 0, '30s': 30, '2m': 120, '5m': 300 };

export class BrainSim {
  readonly agents: NpcAgent[] = [];
  readonly slots = new SmartSlots();
  /** Facts for the page and the bark system, drained by `takeEvents`. */
  private events: BrainEvent[] = [];
  counts: LodCounts = { a: 0, b: 0, c: 0 };
  /** Brain steps run during the last sim tick, by tier. */
  lastSteps = { a: 0, b: 0 };
  /** Totals since the sim was built (perf reports read them). */
  totalSteps = { a: 0, b: 0 };
  /** Most LOD-A brains seen in one pass (AC-9). */
  peakA = 0;
  cap: number;
  private readonly byId = new Map<string, NpcAgent>();
  private readonly cfg: BrainConfig;
  private readonly seed: number;
  private readonly world: BrainWorld;
  private readonly trace: ((r: TraceRecord) => void) | undefined;
  private readonly routeCache = new Map<string, Vec3[]>();
  private readonly scratch: { d: number; slot: number }[] = [];
  private pending: PendingIntent[] = [];
  private readonly ctx: BtCtx;

  constructor(opts: BrainSimOptions) {
    this.seed = opts.seed;
    this.world = opts.world;
    this.cap = opts.cap;
    this.cfg = opts.cfg ?? BRAIN_CONFIG;
    this.trace = opts.trace;
    this.ctx = {
      env: { tick: 0, clockT: 0, player: null, trust: () => 0 },
      world: opts.world,
      cfg: this.cfg,
      stepTicks: AI_STEP_TICKS * this.cfg.lod.aEveryAiTicks,
      stepS: (AI_STEP_TICKS * this.cfg.lod.aEveryAiTicks) / SIM_HZ,
      slots: this.slots,
      target: { x: 0, y: 0, z: 0, poi: '', activity: 'idle' },
    };
  }

  // ---------------------------------------------------------------------------------------------------------------- roster

  /** Adds a named NPC. The slot is its spawn order. */
  add(soul: CompiledSoulPublic): NpcAgent {
    const existing = this.byId.get(soul.id);
    if (existing) return existing;
    const a = new NpcAgent(soul);
    a.slot = this.agents.length;
    this.agents.push(a);
    this.byId.set(soul.id, a);
    return a;
  }

  get(npcId: string): NpcAgent | undefined {
    return this.byId.get(npcId);
  }

  /** An NPC the roster kill-switch removed from the world (`spawn` scope) stops being simulated and drawn. */
  setEnabled(npcId: string, on: boolean): void {
    const a = this.byId.get(npcId);
    if (!a || a.enabled === on) return;
    a.enabled = on;
    if (!on) this.dropBrain(a);
  }

  /** Mission locks make an NPC busy: it holds its place and refuses Talk until every owner released. */
  lock(npcId: string, on: boolean): void {
    const a = this.byId.get(npcId);
    if (!a) return;
    a.locks = on ? a.locks + 1 : Math.max(0, a.locks - 1);
  }

  beginTalk(npcId: string): boolean {
    const a = this.byId.get(npcId);
    if (!a || a.talking) return false;
    a.talking = true;
    a.talkTicks = 0;
    return true;
  }

  endTalk(npcId: string, tick: number): void {
    const a = this.byId.get(npcId);
    if (!a || !a.talking) return;
    a.talking = false;
    a.talkTicks = 0;
    this.events.push({ kind: 'talk.end', npcId, tick });
  }

  /** A fact the NPC reacts to: nearby violence, a crash. It counts as a threat for `threatHoldS` seconds. */
  report(npcId: string, kind: string, x: number, z: number, tick: number): void {
    const a = this.byId.get(npcId);
    if (!a) return;
    a.threat = { kind, x, z, until: tick + Math.ceil(this.cfg.brains.threatHoldS * SIM_HZ) };
  }

  takeEvents(): BrainEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  // ---------------------------------------------------------------------------------------------------------------- where

  private routeOf = (a: PoiId, b: PoiId): Vec3[] => {
    const key = `${a}>${b}`;
    let r = this.routeCache.get(key);
    if (r === undefined) {
      r = this.world.pedRoute ? this.world.pedRoute(a, b) : [];
      this.routeCache.set(key, r);
    }
    return r;
  };

  /** The schedule position of an NPC at `clockT`: the zero-cost answer for any LOD. */
  scheduled(a: NpcAgent, clockT: number): WhereIsResult {
    return whereIs(a.soul, clockT, (id) => this.world.poiPos(id), this.world.pedRoute ? this.routeOf : undefined);
  }

  /** Where the NPC is now: the agent's own position while it is simulated, the schedule's otherwise. */
  whereIs(npcId: string, clockT: number): { pos: Vec3; activity: string } | null {
    const a = this.byId.get(npcId);
    if (!a || !a.enabled) return null;
    const w = this.scheduled(a, clockT);
    if (a.lod !== LOD.C && a.placed) return { pos: [a.x, a.y, a.z], activity: w.activity };
    return { pos: w.pos, activity: w.activity };
  }

  // ---------------------------------------------------------------------------------------------------------------- intents

  /** Queues an intent for the tick `tick` (live: the next tick; replay: the recorded one). */
  queueIntent(tick: number, npcId: string, intent: NpcIntent): void {
    this.pending.push({ tick, npcId, intent });
    this.pending.sort((x, y) => x.tick - y.tick);
  }

  private applyIntent(p: PendingIntent, env: BrainEnv): void {
    const a = this.byId.get(p.npcId);
    if (!a || !a.enabled) return;
    const it = p.intent;
    if (it.bark) this.events.push({ kind: 'bark', npcId: a.id, tick: env.tick, tag: it.bark });
    if (it.goal === 'continue_schedule') {
      a.intent = null;
      return;
    }
    let tx = a.x;
    let tz = a.z;
    let known = false;
    const t = it.target;
    if (it.goal === 'approach_player' || (typeof t === 'string' && t.startsWith('player:'))) {
      if (env.player) {
        tx = env.player.x;
        tz = env.player.z;
        known = true;
      }
    } else if (typeof t === 'string' && t.startsWith('npc:')) {
      const o = this.byId.get(t.slice(4));
      if (o) {
        tx = o.x;
        tz = o.z;
        known = true;
      }
    } else if (typeof t === 'string' && t.startsWith('poi.')) {
      const pos = this.world.poiPos(t as `poi.${string}`);
      if (pos) {
        tx = pos[0];
        tz = pos[2];
        known = true;
      }
    }
    if (it.goal === 'avoid_player') {
      if (env.player) a.threat = { kind: 'intent', x: env.player.x, z: env.player.z, until: env.tick + Math.ceil(this.cfg.brains.threatHoldS * SIM_HZ) };
      a.intent = null;
      return;
    }
    if (!known) {
      // A goal without a place changes nothing the legs can do; the bark (if any) already went out.
      a.intent = null;
      return;
    }
    const secs = SECONDS_OF_UNTIL[it.until];
    const goal: IntentGoalState = {
      goal: it.goal,
      target: t,
      urgency: it.urgency === 'high' ? 2 : it.urgency === 'med' ? 1 : 0,
      tx,
      tz,
      until: env.tick + secs * SIM_HZ,
      block: it.until === 'next_block' ? a.block : -1,
      bark: it.bark ?? '',
    };
    a.intent = goal;
  }

  // ---------------------------------------------------------------------------------------------------------------- the tick

  /** One sim tick. */
  tick(env: BrainEnv): void {
    this.lastSteps.a = 0;
    this.lastSteps.b = 0;
    while (this.pending.length > 0 && (this.pending[0] as PendingIntent).tick <= env.tick) {
      this.applyIntent(this.pending.shift() as PendingIntent, env);
    }
    this.integrate();
    if ((env.tick & 1) !== 0) return;
    const ai = env.tick >> 1;
    const lod = this.cfg.lod;
    if (ai % LOD_EVERY === 0) this.classify(env);
    for (const a of this.agents) {
      if (!a.enabled) continue;
      if (a.lod === LOD.A) {
        if ((ai + a.slot) % lod.aEveryAiTicks === 0) this.stepA(a, env);
      } else if (a.lod === LOD.B) {
        if ((ai + a.slot) % lod.bEveryAiTicks === 0) this.stepB(a, env);
      }
    }
  }

  private integrate(): void {
    for (const a of this.agents) {
      if (a.lod === LOD.C || !a.enabled) continue;
      if (a.vx === 0 && a.vz === 0) continue;
      a.x += a.vx * DT;
      a.z += a.vz * DT;
    }
  }

  /** LOD pass: C agents take their schedule position first, so every distance is current. */
  private classify(env: BrainEnv): void {
    for (const a of this.agents) {
      if (!a.enabled) {
        a.lod = LOD.C;
        continue;
      }
      if (a.lod === LOD.C || !a.placed) {
        const w = this.scheduled(a, env.clockT);
        a.x = w.pos[0];
        if (!a.grounded) a.y = w.pos[1];
        a.z = w.pos[2];
        a.placed = true;
        a.vx = 0;
        a.vz = 0;
      }
    }
    const before: LodTier[] = this.agents.map((a) => a.lod);
    this.counts = assignLod(this.agents, env.player, this.cap, this.cfg, this.scratch);
    if (this.counts.a > this.peakA) this.peakA = this.counts.a;
    for (const a of this.agents) {
      if (!a.enabled) continue;
      const was = before[a.slot] as LodTier;
      if (was === LOD.A && a.lod !== LOD.A) this.dropBrain(a);
      if (a.lod === LOD.C) {
        a.vx = 0;
        a.vz = 0;
      }
    }
  }

  private dropBrain(a: NpcAgent): void {
    if (a.slotPoi !== '') {
      this.slots.release(a.slotPoi);
      a.slotPoi = '';
    }
    btReset(a);
    a.tree = -1;
    a.vx = 0;
    a.vz = 0;
    a.anim = ANIM.idle;
    if (!a.enabled) a.lod = LOD.C;
  }

  private groundOf(a: NpcAgent, fallback: number): void {
    const g = this.world.groundY?.(a.x, a.z);
    if (typeof g === 'number') {
      a.y = g;
      a.grounded = true;
    } else if (!a.grounded) a.y = fallback;
  }

  /** Full brain: schedule, utility, behaviour tree. */
  private stepA(a: NpcAgent, env: BrainEnv): void {
    const lod = this.cfg.lod;
    const ctx = this.ctx;
    ctx.env = env;
    ctx.stepTicks = AI_STEP_TICKS * lod.aEveryAiTicks;
    ctx.stepS = ctx.stepTicks / SIM_HZ;
    rollDay(a, this.seed, env.clockT);
    const sr = scheduleStep(a, env.clockT);
    if (sr.changed) this.events.push({ kind: 'block', npcId: a.id, tick: env.tick, block: sr.index });
    const w = this.scheduled(a, env.clockT);
    ctx.target.x = w.pos[0];
    ctx.target.y = w.pos[1];
    ctx.target.z = w.pos[2];
    ctx.target.poi = sr.block.place;
    ctx.target.activity = sr.activity;
    if (a.threat && a.threat.until <= env.tick) a.threat = null;
    if (a.intent && (a.intent.block >= 0 ? a.intent.block !== a.block : a.intent.until <= env.tick)) a.intent = null;
    if (a.talking) {
      a.talkTicks += ctx.stepTicks;
      if (a.talkTicks >= TALK_TIMEOUT_TICKS) this.endTalk(a.id, env.tick);
    }

    const winner: UtilityKind = utilityStep(a, sr.block, env, this.cfg);
    const tree = treeFor(winner, sr.activity);
    if (winner !== a.winner || tree !== a.tree || sr.changed) {
      if (a.slotPoi !== '') {
        this.slots.release(a.slotPoi);
        a.slotPoi = '';
      }
      btReset(a);
      a.tree = tree;
      a.winner = winner;
    }
    runTree(TREES[tree] as (typeof TREES)[number], a, ctx);
    if (winner === UTILITY.Greet && a.vx === 0 && a.vz === 0 && env.player) a.yaw = yawToward(env.player.x - a.x, env.player.z - a.z);
    this.groundOf(a, w.pos[1]);
    a.aSteps++;
    this.lastSteps.a++;
    this.totalSteps.a++;
    this.trace?.({ tick: env.tick, slot: a.slot, lod: a.lod, block: a.block, winner: a.winner, leaf: a.leafId });
  }

  /** Schedule movement only. */
  private stepB(a: NpcAgent, env: BrainEnv): void {
    const lod = this.cfg.lod;
    const stepS = (AI_STEP_TICKS * lod.bEveryAiTicks) / SIM_HZ;
    rollDay(a, this.seed, env.clockT);
    const sr = scheduleStep(a, env.clockT);
    if (sr.changed) this.events.push({ kind: 'block', npcId: a.id, tick: env.tick, block: sr.index });
    const w = this.scheduled(a, env.clockT);
    a.winner = UTILITY.Schedule;
    a.leafId = 0;
    const dx = w.pos[0] - a.x;
    const dz = w.pos[2] - a.z;
    const d = dsqrt(dx * dx + dz * dz);
    if (d > this.cfg.brains.snapLagM) {
      a.x = w.pos[0];
      a.z = w.pos[2];
      a.vx = 0;
      a.vz = 0;
      a.anim = ANIM.idle;
    } else if (d <= this.cfg.brains.arriveM) {
      a.vx = 0;
      a.vz = 0;
      a.anim = ANIM.idle;
    } else {
      const sp = Math.min(this.cfg.brains.walkMps, d / stepS);
      a.vx = (dx / d) * sp;
      a.vz = (dz / d) * sp;
      a.yaw = yawToward(dx, dz);
      a.anim = ANIM.walk;
    }
    this.groundOf(a, w.pos[1]);
    a.bSteps++;
    this.lastSteps.b++;
    this.totalSteps.b++;
    this.trace?.({ tick: env.tick, slot: a.slot, lod: a.lod, block: a.block, winner: a.winner, leaf: 0 });
  }

  // ---------------------------------------------------------------------------------------------------------------- state

  /** The names the debug overlay prints for an agent. */
  describe(a: NpcAgent): string {
    return `${a.id} lod=${'ABC'[a.lod]} block=${a.block} ${UTILITY_NAMES[a.winner]}`;
  }

  hash(h: Fnv64): void {
    h.u32(this.agents.length);
    for (const a of this.agents) {
      h.str(a.id).u8(a.enabled ? 1 : 0).u8(a.lod).u8(a.placed ? 1 : 0).u8(a.grounded ? 1 : 0);
      h.f64(a.x).f64(a.y).f64(a.z).f64(a.yaw).f64(a.vx).f64(a.vz);
      h.u32(a.block >>> 0).u32(a.gameDay >>> 0).u8(a.winner).u32(a.tree >>> 0);
      for (let i = 0; i < a.stack.length; i++) h.u8(a.stack[i] as number);
      h.u32(a.leafT).u32(a.leafAux >>> 0).u8(a.leafId).u8(a.anim).f64(a.wx).f64(a.wz).str(a.slotPoi);
      h.u8(a.talking ? 1 : 0).u32(a.talkTicks).u32(a.locks).u32(a.aSteps).u32(a.bSteps);
      for (const w of a.rng.getState()) h.u32(w);
      if (a.intent) h.u8(1).str(a.intent.goal).f64(a.intent.tx).f64(a.intent.tz).u8(a.intent.urgency).u32(a.intent.until >>> 0).u32(a.intent.block >>> 0).str(a.intent.bark);
      else h.u8(0);
      if (a.threat) h.u8(1).str(a.threat.kind).f64(a.threat.x).f64(a.threat.z).u32(a.threat.until >>> 0);
      else h.u8(0);
    }
    h.u32(this.pending.length);
    for (const p of this.pending) h.u32(p.tick).str(p.npcId).str(p.intent.goal);
  }

  stateHash(): string {
    const h = new Fnv64();
    this.hash(h);
    return h.hex();
  }

  save(w: Sink): void {
    w.u32(this.agents.length);
    for (const a of this.agents) {
      w.str(a.id);
      w.u8(a.enabled ? 1 : 0);
      w.u8(a.lod);
      w.u8(a.placed ? 1 : 0);
      w.u8(a.grounded ? 1 : 0);
      w.f64(a.x); w.f64(a.y); w.f64(a.z); w.f64(a.yaw); w.f64(a.vx); w.f64(a.vz);
      w.i32(a.block); w.i32(a.gameDay); w.u8(a.winner); w.i32(a.tree);
      for (let i = 0; i < a.stack.length; i++) w.u8(a.stack[i] as number);
      w.i32(a.leafT); w.i32(a.leafAux); w.u8(a.leafId); w.u8(a.anim); w.f64(a.wx); w.f64(a.wz); w.str(a.slotPoi);
      w.u8(a.talking ? 1 : 0); w.i32(a.talkTicks); w.i32(a.locks); w.u32(a.aSteps); w.u32(a.bSteps);
      for (const s of a.rng.getState()) w.u32(s);
      if (a.intent) {
        w.u8(1); w.str(a.intent.goal); w.str(a.intent.target ?? ''); w.f64(a.intent.tx); w.f64(a.intent.tz); w.u8(a.intent.urgency);
        w.i32(a.intent.until); w.i32(a.intent.block); w.str(a.intent.bark);
      } else w.u8(0);
      if (a.threat) {
        w.u8(1); w.str(a.threat.kind); w.f64(a.threat.x); w.f64(a.threat.z); w.i32(a.threat.until);
      } else w.u8(0);
    }
    w.u32(this.pending.length);
    for (const p of this.pending) {
      w.i32(p.tick); w.str(p.npcId);
      w.str(p.intent.goal); w.str(p.intent.target ?? ''); w.u8(p.intent.urgency === 'high' ? 2 : p.intent.urgency === 'med' ? 1 : 0);
      w.str(p.intent.bark ?? ''); w.str(p.intent.until); w.u8(p.intent.target === null ? 0 : 1);
    }
  }

  load(r: Source): void {
    const n = r.u32();
    for (let k = 0; k < n; k++) {
      const id = r.str();
      const a = this.byId.get(id);
      // the roster is code: a saved NPC the roster no longer has is read and dropped
      const sink = a ?? new NpcAgent({ id } as CompiledSoulPublic);
      sink.enabled = r.u8() !== 0;
      sink.lod = r.u8() as LodTier;
      sink.placed = r.u8() !== 0;
      sink.grounded = r.u8() !== 0;
      sink.x = r.f64(); sink.y = r.f64(); sink.z = r.f64(); sink.yaw = r.f64(); sink.vx = r.f64(); sink.vz = r.f64();
      sink.block = r.i32(); sink.gameDay = r.i32(); sink.winner = r.u8() as UtilityKind; sink.tree = r.i32();
      for (let i = 0; i < sink.stack.length; i++) sink.stack[i] = r.u8();
      sink.leafT = r.i32(); sink.leafAux = r.i32(); sink.leafId = r.u8(); sink.anim = r.u8(); sink.wx = r.f64(); sink.wz = r.f64(); sink.slotPoi = r.str();
      sink.talking = r.u8() !== 0; sink.talkTicks = r.i32(); sink.locks = r.i32(); sink.aSteps = r.u32(); sink.bSteps = r.u32();
      sink.rng.setState([r.u32(), r.u32(), r.u32(), r.u32()]);
      if (r.u8() === 1) {
        const goal = r.str(); const target = r.str(); const tx = r.f64(); const tz = r.f64(); const urgency = r.u8() as 0 | 1 | 2;
        const until = r.i32(); const block = r.i32(); const bark = r.str();
        sink.intent = { goal, target: target === '' ? null : target, tx, tz, urgency, until, block, bark };
      } else sink.intent = null;
      if (r.u8() === 1) {
        const kind = r.str(); const x = r.f64(); const z = r.f64(); const until = r.i32();
        sink.threat = { kind, x, z, until };
      } else sink.threat = null;
    }
    this.pending = [];
    for (let k = r.u32(); k > 0; k--) {
      const tick = r.i32(); const npcId = r.str();
      const goal = r.str(); const target = r.str(); const urgency = r.u8();
      const bark = r.str(); const until = r.str() as NpcIntent['until']; const hasTarget = r.u8() !== 0;
      this.pending.push({
        tick, npcId,
        intent: { goal, target: hasTarget ? (target as NpcIntent['target']) : null, urgency: urgency === 2 ? 'high' : urgency === 1 ? 'med' : 'low', bark: bark === '' ? null : bark, until },
      });
    }
    this.slots.rebuild(this.agents);
  }
}
