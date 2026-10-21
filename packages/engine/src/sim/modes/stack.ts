import type { GameModeDescriptor, GameModeId, GameModeSim, ModeContext, ModeEnterArgs, SimProfile } from '@dv/shared';

/** C06 rule 1. */
export type ModeState = 'Idle' | 'Loading' | 'Entering' | 'Running' | 'Exiting' | 'Suspended';

/** At most a mode and one child embedded in it (rule 1). */
export const MAX_STACK_DEPTH = 2;

export interface StackEntry {
  readonly id: GameModeId;
  readonly desc: GameModeDescriptor;
  readonly args: ModeEnterArgs;
  readonly ctx: ModeContext;
  state: Exclude<ModeState, 'Idle'>;
  /** The loaded sim half; null while `Loading`. */
  sim: GameModeSim | null;
  /** Set when the sim import failed; the entry then exits with reason `error`. */
  failed: string | null;
  /** `unlockOnFirstEncounter` of the hook that started this child (C09), if any. */
  hookUnlock: string | null;
  /** Every state this entry went through, for the QA bridge and the tests. */
  readonly history: ModeState[];
}

/** The mode stack: index 0 is the top-level mode, index 1 its embedded child. */
export class ModeStack {
  private readonly items: StackEntry[] = [];

  get depth(): number {
    return this.items.length;
  }

  get root(): StackEntry | null {
    return this.items[0] ?? null;
  }

  get top(): StackEntry | null {
    return this.items[this.items.length - 1] ?? null;
  }

  get entries(): readonly StackEntry[] {
    return this.items;
  }

  push(e: StackEntry): void {
    this.items.push(e);
  }

  pop(): StackEntry | null {
    return this.items.pop() ?? null;
  }

  /** The state of the whole host: `Idle` with no entry, else the state of the top entry. */
  get state(): ModeState {
    return this.top?.state ?? 'Idle';
  }
}

/**
 * Rule 2: an embedded mode runs under the parent's profile, so a descriptor that requires `canonical` cannot be embedded under a
 * `local` parent (and the other way round for a `local`-only child). `any` embeds under both.
 */
export function canEmbed(child: GameModeDescriptor, parentProfile: SimProfile): boolean {
  if (!child.embeddable) return false;
  const need = child.requires.simProfile;
  return need === 'any' || need === parentProfile;
}

/** Rule 3: the profile a top-level (menu) entry of `d` runs under. */
export function entryProfile(d: GameModeDescriptor, running: SimProfile): SimProfile {
  const need = d.requires.simProfile;
  if (need === 'local' || need === 'canonical') return need;
  return d.standaloneProfile ?? running;
}
