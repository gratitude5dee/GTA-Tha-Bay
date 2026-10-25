/**
 * The `InteractKind.Talk` handler (04-npc-builder.md section C8; M06c).
 *
 * `canInteract` refuses with a reason key when the NPC is killed (`spawn` or `all` scope), busy (another conversation, a mission lock or a
 * playing knot) or in a block that is not interruptible (asleep). Otherwise `begin`:
 *  - a named NPC: puts its brain in `Talk` (it stops and faces the player) and patches `sys.dialogue.open` for the dialogue panel;
 *  - a filler pedestrian: plays a two-line exchange from its archetype ink as subtitles. No request leaves the device.
 * The sim never pauses for a conversation. Sim code; C02 lint applies.
 */
import { fnv32, type Fnv64, type KillScope } from '@dv/shared';
import { scheduleAt } from '@dv/shared/npc';
import type { InteractionContext, InteractionHandler } from '@dv/engine/sim';
import { INTERACT_KIND } from '@dv/engine/sim';
import type { EntityHandle } from '@dv/shared';
import { fillerArchetype } from '../barks/pools.ts';
import type { KnotPlayer } from './mode-context-npc.ts';
import { SIM_HZ, type BrainConfig } from './config.ts';
import type { BrainSim, Sink, Source } from './sim.ts';

/** Localisation keys of the reasons Talk can be refused (`content/ui/i18n/en.json`). */
export const TALK_REASON = {
  killed: 'npc.talk.killed',
  busy: 'npc.talk.busy',
  unavailable: 'npc.talk.unavailable',
} as const;

export interface TalkVerdictInput {
  sim: BrainSim;
  npcId: string;
  clockT: number;
  killed: readonly KillScope[];
}

/** The pure part of `canInteract` for a named NPC. */
export function talkVerdict(i: TalkVerdictInput): true | string {
  const a = i.sim.get(i.npcId);
  if (!a || !a.enabled || i.killed.includes('all') || i.killed.includes('spawn')) return TALK_REASON.killed;
  if (a.busy) return TALK_REASON.busy;
  if (!scheduleAt(a.soul, i.clockT).block.interruptible) return TALK_REASON.unavailable;
  return true;
}

/** What the entity under the prompt is. */
export type TalkTarget = { kind: 'named'; npcId: string } | { kind: 'filler'; key: string; busy: boolean };

export interface TalkDeps {
  sim: BrainSim;
  knots: KnotPlayer;
  cfg: BrainConfig['barks'];
  clockT(): number;
  killed(npcId: string): readonly KillScope[];
  /** The ui bridge of the mode host (late-bound; null before the host started). */
  patch(k: 'sys.dialogue.open', v: { npcId: string; seq: number }): void;
  /** Reads what the interactable is from its stable key and components. */
  classify(ctx: InteractionContext, target: EntityHandle): TalkTarget | null;
}

/** The knot a filler plays: the first exchange is `greeting`, one after that `smalltalk`. */
export const FILLER_KNOTS = ['greeting', 'smalltalk'] as const;

export class TalkHandler implements InteractionHandler {
  readonly kind = INTERACT_KIND.Talk;
  private seq = 0;
  /** Tick a filler may be talked to again, by key. */
  private readonly fillerReady = new Map<string, number>();
  private readonly fillerCount = new Map<string, number>();
  /** Talks begun (QA and tests). */
  begun = 0;

  constructor(private readonly d: TalkDeps) {}

  /** Only NPCs and filler pedestrians are ours; a mission's talkable keeps its own flow. */
  accepts(ctx: InteractionContext, target: EntityHandle): boolean {
    return this.d.classify(ctx, target) !== null;
  }

  canInteract(ctx: InteractionContext, _actor: EntityHandle, target: EntityHandle): true | string {
    const t = this.d.classify(ctx, target);
    if (!t) return TALK_REASON.killed;
    if (t.kind === 'named') return talkVerdict({ sim: this.d.sim, npcId: t.npcId, clockT: this.d.clockT(), killed: this.d.killed(t.npcId) });
    if (t.busy) return TALK_REASON.busy;
    if (this.d.knots.playing) return TALK_REASON.busy;
    if (ctx.tick < (this.fillerReady.get(t.key) ?? 0)) return TALK_REASON.busy;
    return true;
  }

  begin(ctx: InteractionContext, _actor: EntityHandle, target: EntityHandle): void {
    const t = this.d.classify(ctx, target);
    if (!t) return;
    this.begun++;
    if (t.kind === 'named') {
      if (!this.d.sim.beginTalk(t.npcId)) return;
      this.d.patch('sys.dialogue.open', { npcId: t.npcId, seq: ++this.seq });
      return;
    }
    const archetype = fillerArchetype(fnv32(t.key));
    const n = this.fillerCount.get(t.key) ?? 0;
    this.fillerCount.set(t.key, n + 1);
    const knot = FILLER_KNOTS[Math.min(n, FILLER_KNOTS.length - 1)] as string;
    this.d.knots.start(`archetype:${archetype}`, knot, `filler:${t.key}:${n}`, '');
    this.fillerReady.set(t.key, ctx.tick + Math.ceil(this.d.cfg.fillerTalkCooldownS * SIM_HZ));
  }

  hash(h: Fnv64): void {
    const byKey = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
    h.u32(this.seq);
    const keys = [...this.fillerReady.keys()].sort(byKey);
    h.u32(keys.length);
    for (const k of keys) h.str(k).u32((this.fillerReady.get(k) as number) >>> 0).u32(this.fillerCount.get(k) ?? 0);
  }

  save(w: Sink): void {
    const byKey = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
    w.u32(this.seq);
    const keys = [...this.fillerReady.keys()].sort(byKey);
    w.u32(keys.length);
    for (const k of keys) {
      w.str(k);
      w.i32(this.fillerReady.get(k) as number);
      w.u32(this.fillerCount.get(k) ?? 0);
    }
  }

  load(r: Source): void {
    this.seq = r.u32();
    this.fillerReady.clear();
    this.fillerCount.clear();
    for (let n = r.u32(); n > 0; n--) {
      const k = r.str();
      this.fillerReady.set(k, r.i32());
      this.fillerCount.set(k, r.u32());
    }
  }
}
