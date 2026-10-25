/**
 * Where hero intents begin (04-npc-builder.md section C8; M06c). The sim knows when something worth an LLM thought happens to a hero and
 * what the scene looks like, so it writes the `NPCIntentRequest` and publishes it on the view-model key `sys.npc.intents`. The client
 * driver (`client/intent-driver.ts`) decides whether to send it. Triggers:
 *
 *  - `block_boundary`   the hero's schedule block changed;
 *  - `player_near`      the player came within `intentTriggerRadiusM` (40 m) of a hero whose trust has |trust| >= `intentTriggerTrust` (40);
 *  - `encounter_ended`  a conversation with the hero closed;
 *  - `world_event`      a `NearbyEvent` within `worldEventRadiusM` (150 m);
 *  - `mission_state`    a mission started, failed or passed (a mode reports it through the `npc` command channel).
 * The sim keeps its own gap of `intentMinSecondsPerNpc` per hero so a busy scene cannot flood the queue; the client enforces the rest.
 * Nothing here calls out. Sim code; C02 lint applies.
 */
import { dsqrt, chunkKeyAt, type Fnv64 } from '@dv/shared';
import type { IntentTrigger, NearbyEvent, NPCIntentRequest } from '@dv/shared/contracts/c10-npc';
import type { StableKey } from '@dv/shared';
import { LOD, type BrainEnv, type NpcAgent } from './agent.ts';
import { SIM_HZ, type BrainConfig } from './config.ts';
import type { BrainSim, Sink, Source } from './sim.ts';

export interface PublishedIntentRequest {
  /** Monotonic id; the driver ignores ids it has handled. */
  rid: number;
  req: NPCIntentRequest;
}

interface RecentEvent {
  kind: NearbyEvent;
  x: number;
  z: number;
  tick: number;
}

/** How long a world event stays in a situation: 30 s. */
const EVENT_KEEP_TICKS = 30 * SIM_HZ;
const MAX_QUEUE = 6;

export class IntentRequests {
  private rid = 0;
  private queue: PublishedIntentRequest[] = [];
  private readonly lastTick = new Map<string, number>();
  private readonly near = new Set<string>();
  private recent: RecentEvent[] = [];
  /** Requests written (QA and tests). */
  written = 0;

  constructor(private readonly cfg: BrainConfig, private readonly enabled: boolean) {}

  private heroes(sim: BrainSim): NpcAgent[] {
    return sim.agents.filter((a) => a.enabled && a.soul.roles.hero);
  }

  /** Records a world event; heroes within the event radius are asked about it. */
  worldEvent(sim: BrainSim, env: BrainEnv, kind: NearbyEvent, x: number, z: number): void {
    this.recent.push({ kind, x, z, tick: env.tick });
    if (this.recent.length > 16) this.recent.shift();
    const r = this.cfg.throttles.worldEventRadiusM;
    for (const a of this.heroes(sim)) {
      if (a.lod === LOD.C) continue;
      const dx = a.x - x;
      const dz = a.z - z;
      if (dsqrt(dx * dx + dz * dz) <= r) this.write(sim, env, a, 'world_event');
    }
  }

  blockBoundary(sim: BrainSim, env: BrainEnv, npcId: string): void {
    const a = sim.get(npcId);
    if (a && a.enabled && a.soul.roles.hero) this.write(sim, env, a, 'block_boundary');
  }

  encounterEnded(sim: BrainSim, env: BrainEnv, npcId: string): void {
    const a = sim.get(npcId);
    if (a && a.enabled && a.soul.roles.hero) this.write(sim, env, a, 'encounter_ended');
  }

  missionState(sim: BrainSim, env: BrainEnv): void {
    for (const a of this.heroes(sim)) {
      if (a.lod === LOD.C) continue;
      this.write(sim, env, a, 'mission_state');
    }
  }

  /** Every AI step: a hero the player has just come close to, with trust either way, is asked about it. */
  scan(sim: BrainSim, env: BrainEnv): void {
    const p = env.player;
    if (!p) {
      this.near.clear();
      return;
    }
    const radius = this.cfg.throttles.intentTriggerRadiusM;
    for (const a of this.heroes(sim)) {
      const dx = a.x - p.x;
      const dz = a.z - p.z;
      const inside = a.lod !== LOD.C && dsqrt(dx * dx + dz * dz) <= radius;
      const was = this.near.has(a.id);
      if (inside && !was) {
        this.near.add(a.id);
        if (Math.abs(env.trust(a.id)) >= this.cfg.throttles.intentTriggerTrust) this.write(sim, env, a, 'player_near');
      } else if (!inside && was) this.near.delete(a.id);
    }
  }

  /** The scene around a hero, in the shape of route 32. */
  situation(sim: BrainSim, env: BrainEnv, a: NpcAgent): NPCIntentRequest['situation'] {
    const near: NPCIntentRequest['situation']['nearby'] = [];
    const p = env.player;
    if (p) {
      const dx = p.x - a.x;
      const dz = p.z - a.z;
      near.push({ key: 'player:0' as StableKey, kind: 'player', distM: Math.round(dsqrt(dx * dx + dz * dz)) });
    }
    const others: { key: StableKey; distM: number; slot: number }[] = [];
    for (const o of sim.agents) {
      if (o === a || !o.enabled || o.lod === LOD.C) continue;
      const dx = o.x - a.x;
      const dz = o.z - a.z;
      const d = dsqrt(dx * dx + dz * dz);
      if (d <= this.cfg.throttles.worldEventRadiusM) others.push({ key: o.key as StableKey, distM: Math.round(d), slot: o.slot });
    }
    others.sort((x, y) => x.distM - y.distM || x.slot - y.slot);
    for (const o of others) {
      if (near.length >= this.cfg.intent.maxNearby) break;
      near.push({ key: o.key, kind: 'npc', distM: o.distM });
    }
    const events: NearbyEvent[] = [];
    for (const e of this.recent) {
      if (env.tick - e.tick > EVENT_KEEP_TICKS) continue;
      if (!events.includes(e.kind)) events.push(e.kind);
    }
    const trust = env.trust(a.id);
    return {
      clockT: env.clockT,
      chunkKey: chunkKeyAt(9, a.x, a.z),
      poiId: a.soul.schedule[a.block]?.place ?? null,
      activeBlock: Math.max(0, a.block),
      nearby: near,
      events,
      relation: { trust: Math.round(trust), met: trust !== 0 },
    };
  }

  private write(sim: BrainSim, env: BrainEnv, a: NpcAgent, trigger: IntentTrigger): void {
    if (!this.enabled) return;
    const gap = this.cfg.throttles.intentMinSecondsPerNpc * SIM_HZ;
    const last = this.lastTick.get(a.id);
    if (last !== undefined && env.tick - last < gap) return;
    this.lastTick.set(a.id, env.tick);
    this.written++;
    const entry: PublishedIntentRequest = {
      rid: ++this.rid,
      req: { npcId: a.id, soulVersion: a.soul.soulVersion, trigger, situation: this.situation(sim, env, a) },
    };
    this.queue.push(entry);
    if (this.queue.length > MAX_QUEUE) this.queue.shift();
  }

  /** The next request to publish, if any; one per call so each rides its own view-model patch. */
  next(): PublishedIntentRequest | null {
    return this.queue.shift() ?? null;
  }

  get pending(): number {
    return this.queue.length;
  }

  hash(h: Fnv64): void {
    h.u32(this.rid).u32(this.queue.length);
    for (const q of this.queue) h.u32(q.rid).str(q.req.npcId).str(q.req.trigger);
    const ids = [...this.lastTick.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    h.u32(ids.length);
    for (const k of ids) h.str(k).u32((this.lastTick.get(k) as number) >>> 0);
    for (const e of this.recent) h.str(e.kind).f64(e.x).f64(e.z).u32(e.tick >>> 0);
  }

  save(w: Sink): void {
    w.u32(this.rid);
    const ids = [...this.lastTick.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    w.u32(ids.length);
    for (const k of ids) {
      w.str(k);
      w.i32(this.lastTick.get(k) as number);
    }
    w.u32(this.recent.length);
    for (const e of this.recent) {
      w.str(e.kind); w.f64(e.x); w.f64(e.z); w.i32(e.tick);
    }
  }

  load(r: Source): void {
    this.rid = r.u32();
    this.lastTick.clear();
    for (let n = r.u32(); n > 0; n--) this.lastTick.set(r.str(), r.i32());
    this.recent = [];
    for (let n = r.u32(); n > 0; n--) this.recent.push({ kind: r.str() as NearbyEvent, x: r.f64(), z: r.f64(), tick: r.i32() });
    this.queue = [];
    this.near.clear();
  }
}
