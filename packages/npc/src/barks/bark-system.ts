/**
 * `BarkSystem` (04-npc-builder.md section C9; M06c). Triggers (a bump, a crash nearby, heat, weather, the player's race) ask an entity to
 * bark; the system decides whether it may and which line, from the owner's pool, with the seeded stream:
 *
 *  - an entity barks at most once per `entityCooldownS` (20 s), and the same tag at most once per `tagCooldownS` (60 s) per entity;
 *  - at most `maxAudible` (2) barks are audible at once, a bark staying audible for the length of its subtitle;
 *  - a bark further than `radiusM` from the player is dropped, so the far city costs nothing;
 *  - the line plays its pre-rendered audio when the pool has one, otherwise it is a subtitle only; either way `emit` receives it and the
 *    caller patches `hud.subtitle` (and tells the audio service).
 * The cooldown table is hashed state. Sim code; C02 lint applies.
 */
import { dsqrt, Fnv64 } from '@dv/shared';
import type { BarkTag } from '@dv/shared/contracts/c10-npc';
import { SIM_HZ, type BrainConfig } from '../brains/config.ts';
import type { Sink, Source } from '../brains/sim.ts';
import type { BarkPools, WeightedRng } from './pools.ts';

export interface BarkRequest {
  tag: BarkTag;
  /** StableKey of the barking entity (`amb:…` or `npc:…`). */
  key: string;
  /** Pool owner: `archetype:<a>` or an NPC id. */
  owner: string;
  /** Subtitle speaker id. */
  speaker: string;
  x: number;
  z: number;
}

export interface BarkEmit {
  tick: number;
  key: string;
  tag: BarkTag;
  lineId: string;
  text: string;
  /** Pre-rendered `audio_bark` asset, null for a subtitle-only bark. */
  audio: string | null;
  speaker: string;
  x: number;
  z: number;
  /** Tick the subtitle (and the audible slot) ends. */
  endTick: number;
}

export type BarkVerdict = 'played' | 'far' | 'cooldown' | 'tag-cooldown' | 'full' | 'no-line';

interface Memory {
  last: number;
  tags: Map<string, number>;
}

export interface BarkSystemOptions {
  pools: BarkPools;
  rng: WeightedRng;
  cfg: BrainConfig['barks'];
  emit(e: BarkEmit): void;
}

const byStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export class BarkSystem {
  private readonly mem = new Map<string, Memory>();
  /** End ticks of the barks that are audible now. */
  private audibleUntil: number[] = [];
  /** The line each pool-and-tag said last, so a pool of two alternates. */
  private readonly lastLine = new Map<string, string>();
  played = 0;
  dropped = 0;

  constructor(private readonly o: BarkSystemOptions) {}

  audible(): number {
    return this.audibleUntil.length;
  }

  /** Seconds a subtitle stays: at least `subtitleMinS`, `subtitlePerCharS` per character. */
  subtitleTicks(text: string): number {
    const s = Math.max(this.o.cfg.subtitleMinS, this.o.cfg.subtitlePerCharS * text.length);
    return Math.ceil(s * SIM_HZ);
  }

  /** Asks `req.key` to bark. Returns what happened; only `played` reaches `emit`. */
  request(tick: number, req: BarkRequest, player: { x: number; z: number } | null): BarkVerdict {
    const cfg = this.o.cfg;
    this.expire(tick);
    if (!player) return this.drop('far');
    const dx = req.x - player.x;
    const dz = req.z - player.z;
    if (dsqrt(dx * dx + dz * dz) > cfg.radiusM) return this.drop('far');
    const m = this.mem.get(req.key);
    if (m) {
      if (tick - m.last < cfg.entityCooldownS * SIM_HZ) return this.drop('cooldown');
      const t = m.tags.get(req.tag);
      if (t !== undefined && tick - t < cfg.tagCooldownS * SIM_HZ) return this.drop('tag-cooldown');
    }
    if (this.audibleUntil.length >= cfg.maxAudible) return this.drop('full');
    const pool = this.o.pools.get(req.owner);
    const poolTag = `${req.owner}|${req.tag}`;
    const line = pool?.pick(req.tag, this.o.rng, this.lastLine.get(poolTag)) ?? null;
    if (!line) return this.drop('no-line');

    this.lastLine.set(poolTag, line.id);
    const mm = m ?? { last: 0, tags: new Map<string, number>() };
    mm.last = tick;
    mm.tags.set(req.tag, tick);
    this.mem.set(req.key, mm);
    const endTick = tick + this.subtitleTicks(line.text);
    this.audibleUntil.push(endTick);
    this.played++;
    this.o.emit({ tick, key: req.key, tag: req.tag, lineId: line.id, text: line.text, audio: line.audio, speaker: req.speaker, x: req.x, z: req.z, endTick });
    return 'played';
  }

  private drop(v: BarkVerdict): BarkVerdict {
    this.dropped++;
    return v;
  }

  private expire(tick: number): void {
    if (this.audibleUntil.length === 0) return;
    this.audibleUntil = this.audibleUntil.filter((t) => t > tick);
  }

  /** Once a second: drops finished audible slots and forgets entities whose cooldowns have long passed. */
  update(tick: number): void {
    this.expire(tick);
    if (tick % SIM_HZ !== 0) return;
    const horizon = Math.max(this.o.cfg.entityCooldownS, this.o.cfg.tagCooldownS) * SIM_HZ;
    for (const [k, m] of [...this.mem]) {
      if (tick - m.last >= horizon) this.mem.delete(k);
    }
  }

  hash(h: Fnv64): void {
    h.u32(this.audibleUntil.length);
    for (const t of this.audibleUntil) h.u32(t >>> 0);
    const keys = [...this.mem.keys()].sort(byStr);
    h.u32(keys.length);
    for (const k of keys) {
      const m = this.mem.get(k) as Memory;
      h.str(k).u32(m.last >>> 0);
      const tags = [...m.tags.keys()].sort(byStr);
      h.u32(tags.length);
      for (const t of tags) h.str(t).u32((m.tags.get(t) as number) >>> 0);
    }
    const last = [...this.lastLine.keys()].sort(byStr);
    h.u32(last.length);
    for (const k of last) h.str(k).str(this.lastLine.get(k) as string);
  }

  stateHash(): string {
    const h = new Fnv64();
    this.hash(h);
    return h.hex();
  }

  save(w: Sink): void {
    w.u32(this.audibleUntil.length);
    for (const t of this.audibleUntil) w.i32(t);
    const keys = [...this.mem.keys()].sort(byStr);
    w.u32(keys.length);
    for (const k of keys) {
      const m = this.mem.get(k) as Memory;
      w.str(k);
      w.i32(m.last);
      const tags = [...m.tags.keys()].sort(byStr);
      w.u32(tags.length);
      for (const t of tags) {
        w.str(t);
        w.i32(m.tags.get(t) as number);
      }
    }
    const last = [...this.lastLine.keys()].sort(byStr);
    w.u32(last.length);
    for (const k of last) {
      w.str(k);
      w.str(this.lastLine.get(k) as string);
    }
  }

  load(r: Source): void {
    this.audibleUntil = [];
    for (let n = r.u32(); n > 0; n--) this.audibleUntil.push(r.i32());
    this.mem.clear();
    for (let n = r.u32(); n > 0; n--) {
      const k = r.str();
      const m: Memory = { last: r.i32(), tags: new Map() };
      for (let t = r.u32(); t > 0; t--) m.tags.set(r.str(), r.i32());
      this.mem.set(k, m);
    }
    this.lastLine.clear();
    for (let n = r.u32(); n > 0; n--) this.lastLine.set(r.str(), r.str());
  }
}
