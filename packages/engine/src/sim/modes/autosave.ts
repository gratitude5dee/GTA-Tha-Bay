import type { SaveReason, SlotId } from '@dv/shared';
import type { ModeSaveBinding } from '../save-port.ts';

/** C05 rule 4: an autosave every 300 s of free roam. */
export const AUTOSAVE_INTERVAL_TICKS = 300 * 60;

export interface AutosaveEntry {
  slot: SlotId;
  data: unknown;
}

export interface AutosaveGameState {
  /** A top-level mode is running (otherwise there is nothing to save but settings). */
  running: boolean;
  heat: number;
  /** The pursuit director is in any phase but `clear`. */
  pursuit: boolean;
  /** A mission other than its checkpoint is in progress (M05a1 sets it; false until then). */
  mission: boolean;
}

export interface AutosaveDeps {
  tick(): number;
  game(): AutosaveGameState;
  /** The slots to write for `reason` from the live state; null when nothing can be saved (no mode runs). */
  entries(reason: SaveReason): AutosaveEntry[] | null;
  binding: ModeSaveBinding;
}

/** Reasons that are explicit player or mission acts: they save whatever the heat, because the act is the safe point (or the settings page). */
const ALWAYS: ReadonlySet<SaveReason> = new Set(['checkpoint', 'settings', 'manual', 'missionPass', 'safehouse', 'import', 'migration']);

/**
 * The autosave policy of C05 rule 4. Saves happen on a mission pass, at a safehouse, on mode exit, on an unlock, every 300 s of free
 * roam at heat 0 with no mission, and when the page goes `hidden` (the same eligibility). Never during a pursuit or a mission, except
 * the mission's checkpoint; an unlock that arrives then is kept and saved as soon as the game is quiet again.
 */
export class AutosavePolicy {
  private roamTicks = 0;
  private deferred = false;
  /** Every save that was posted: tick, reason and slots (the QA bridge and the tests read it). */
  readonly log: { tick: number; reason: SaveReason; slots: SlotId[] }[] = [];

  constructor(private readonly d: AutosaveDeps) {}

  private unsafe(g: AutosaveGameState): boolean {
    return g.pursuit || g.heat > 0 || g.mission;
  }

  eligible(reason: SaveReason): boolean {
    const g = this.d.game();
    if (ALWAYS.has(reason)) return reason === 'settings' || g.running;
    return g.running && !this.unsafe(g);
  }

  /** Posts the save for `reason` if it is due. True when something was posted. */
  request(reason: SaveReason): boolean {
    if (!this.eligible(reason)) {
      if (reason === 'unlock') this.deferred = true;
      return false;
    }
    const entries = this.d.entries(reason);
    if (!entries || entries.length === 0) return false;
    const slots: SlotId[] = [];
    for (const e of entries) if (this.d.binding.post(e.slot, e.data, reason).ok) slots.push(e.slot);
    if (slots.length === 0) return false;
    this.roamTicks = 0;
    this.log.push({ tick: this.d.tick(), reason, slots });
    return true;
  }

  /** The slots for the worker's `save.request` handler (`SaveControl.collect`): the entries if the save is due, else null. */
  collect(reason: SaveReason): AutosaveEntry[] | null {
    return this.eligible(reason) ? this.d.entries(reason) : null;
  }

  /** Once per tick. */
  onTick(): void {
    const g = this.d.game();
    if (!g.running || this.unsafe(g)) return;
    if (this.deferred) {
      this.deferred = false;
      this.request('unlock');
    }
    if (++this.roamTicks >= AUTOSAVE_INTERVAL_TICKS) this.request('interval');
  }
}
