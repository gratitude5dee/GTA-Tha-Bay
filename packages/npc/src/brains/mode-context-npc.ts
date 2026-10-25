/**
 * `ModeContext.npc` (C06 1.1; M06c): what missions and modes may ask of the NPC runtime from the sim side.
 *
 *  - `whereIs(npcId)`: the NPC's position and activity, at zero tick cost for an NPC at LOD C;
 *  - `isKilled(npcId, scope)`: the roster kill-switch flags, as the page last delivered them;
 *  - `playKnot(npcId, knot, playId)`: plays the NPC's ink knot offline. Each line is patched as `hud.subtitle` for `max(1.5 s, 0.06 s per
 *    character)`, one after the other; when the last one has run out the SimEvent `npc.knot.done` fires once with `s: playId`. The NPC
 *    counts as busy (it refuses Talk) while its knot plays.
 * `KnotPlayer` also plays the two-line exchange of a filler pedestrian. Sim code; C02 lint applies.
 */
import type { Fnv64, KillScope, ModeContext, SimEvent } from '@dv/shared';
import type { SubtitleLane } from '../barks/subtitle-lane.ts';
import { SIM_HZ, type BrainConfig } from './config.ts';
import type { BrainSim, Sink, Source } from './sim.ts';

export interface KnotLine {
  text: string;
  /** Subtitle speaker id: `player` or the NPC / archetype speaker. */
  speaker: string;
}

/** Where the lines of a knot come from: the NPC's compiled ink, loaded before the first tick (`InkRunner`). */
export interface KnotSource {
  /** `owner` is an NPC id or `archetype:<a>`. Null when the owner has no story at all. */
  lines(owner: string, knot: string): KnotLine[] | null;
}

interface Play {
  owner: string;
  /** NPC id whose busy flag the play holds, '' for a filler. */
  lock: string;
  knot: string;
  playId: string;
  lines: KnotLine[];
  idx: number;
  /** Tick the current line ends. */
  until: number;
  started: boolean;
}

export interface KnotPlayerOptions {
  source: KnotSource;
  lane: SubtitleLane;
  cfg: BrainConfig['barks'];
  /** The SimEvent bus of the mode context. */
  events: { emit(e: SimEvent): void };
  /** Marks the NPC busy while a knot plays. */
  lock?(npcId: string, on: boolean): void;
}

export class KnotPlayer {
  private queue: Play[] = [];
  done = 0;

  constructor(private readonly o: KnotPlayerOptions) {}

  get playing(): boolean {
    return this.queue.length > 0;
  }

  lineTicks(text: string): number {
    return Math.ceil(Math.max(this.o.cfg.subtitleMinS, this.o.cfg.subtitlePerCharS * text.length) * SIM_HZ);
  }

  /** Queues a knot. `lock` is the NPC id to hold busy ('' for a filler). */
  start(owner: string, knot: string, playId: string, lock: string): void {
    const lines = this.o.source.lines(owner, knot) ?? [];
    if (lock !== '') this.o.lock?.(lock, true);
    this.queue.push({ owner, lock, knot, playId, lines, idx: 0, until: 0, started: false });
  }

  update(tick: number): void {
    const p = this.queue[0];
    if (!p) return;
    if (!p.started) {
      p.started = true;
      p.until = tick;
    }
    if (tick < p.until) return;
    const line = p.lines[p.idx];
    if (!line) {
      this.queue.shift();
      if (p.lock !== '') this.o.lock?.(p.lock, false);
      this.done++;
      this.o.events.emit({ t: 'npc.knot.done', tick, s: p.playId });
      // the next play in the queue starts on this very tick
      this.update(tick);
      return;
    }
    const end = tick + this.lineTicks(line.text);
    this.o.lane.show(line.speaker, line.text, tick, end);
    p.until = end;
    p.idx++;
  }

  hash(h: Fnv64): void {
    h.u32(this.queue.length);
    for (const p of this.queue) h.str(p.owner).str(p.lock).str(p.knot).str(p.playId).u32(p.idx).u32(p.until >>> 0).u8(p.started ? 1 : 0);
  }

  save(w: Sink): void {
    w.u32(this.queue.length);
    for (const p of this.queue) {
      w.str(p.owner); w.str(p.lock); w.str(p.knot); w.str(p.playId); w.u32(p.idx); w.i32(p.until); w.u8(p.started ? 1 : 0);
    }
  }

  load(r: Source): void {
    this.queue = [];
    for (let n = r.u32(); n > 0; n--) {
      const owner = r.str(); const lock = r.str(); const knot = r.str(); const playId = r.str();
      const idx = r.u32(); const until = r.i32(); const started = r.u8() !== 0;
      this.queue.push({ owner, lock, knot, playId, lines: this.o.source.lines(owner, knot) ?? [], idx, until, started });
    }
  }
}

export interface ModeNpcDeps {
  sim: BrainSim;
  knots: KnotPlayer;
  clockT(): number;
  /** The roster kill flags the page delivered: scopes by NPC id. */
  killed(npcId: string): readonly KillScope[];
}

const idOf = (npcId: string): string => (npcId.startsWith('npc:') ? npcId.slice(4) : npcId);

/** The `ModeContext.npc` object a mode receives. */
export function createModeNpcApi(d: ModeNpcDeps): ModeContext['npc'] {
  return {
    whereIs(npcId) {
      return d.sim.whereIs(idOf(npcId), d.clockT());
    },
    isKilled(npcId, scope) {
      const scopes = d.killed(idOf(npcId));
      return scopes.includes('all') || scopes.includes(scope);
    },
    playKnot(npcId, knot, playId) {
      const id = idOf(npcId);
      d.knots.start(id, knot, playId, d.sim.get(id) ? id : '');
    },
  };
}
