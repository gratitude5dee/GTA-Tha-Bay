import type { JsonObject, ModeContext, SimEventBus, TimelineRecorder, UiBridge, VmKey } from '@dv/shared';
import type { InteractionHandler } from '../interaction/interaction.ts';

/**
 * The seam between the engine and the NPC runtime (M06c). `@dv/npc` is a domain package the engine never imports, so it contributes a
 * sim module that registers an `NpcHostPort` on `services.npc`; the modes module binds it when the session starts, builds
 * `ModeContext.npc` from it and forwards the page's `mode.cmd` commands whose owner is `npc`. Engine-owned, in no contract.
 */
export interface NpcHostEnv {
  /** The sim-side view-model bridge; `peek` returns the last value patched for a key (subtitles that yield to a mission's). */
  ui: UiBridge & { peek?(k: VmKey): unknown };
  /** The mode event bus: `npc.knot.done` goes out on it. */
  events: SimEventBus;
  /** C06 recorder: hero intents are logged as `external({src: 'intent'})`. */
  timeline: TimelineRecorder;
  tick(): number;
  /** The game clock in C06 half-seconds. */
  clockT(): number;
  /** Trust of the player with an NPC, -100..100, from the open profile (0 when unknown). */
  trust(npcId: string): number;
  /** The interaction service of the vehicle module, or null in a session without one. */
  interaction: { register(h: InteractionHandler): void } | null;
}

export interface NpcHostPort {
  readonly id: string;
  /** Called once when the session starts. */
  bind(env: NpcHostEnv): void;
  /** What a mode's context exposes (C06 1.1 `ModeContext.npc`). */
  api(): ModeContext['npc'];
  /** A `mode.cmd` of the reserved owner `npc`: roster flags, a hero intent, the end of a conversation, a bark request. */
  command(name: string, args: JsonObject | null): void;
}

/** The NPC runtime of a session, set by the NPC sim module; null in a session without one. */
export interface NpcHub {
  port: NpcHostPort | null;
}

export function createNpcHub(): NpcHub {
  return { port: null };
}
