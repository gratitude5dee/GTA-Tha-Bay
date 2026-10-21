import type { SaveErrorCode, SaveReason, SlotId } from '@dv/shared';

/**
 * The type-only face of saving for `sim/modes/` (M04a2, DL-659 part 2). Nothing under `sim/modes/` imports `sim/save/**`, so the
 * DOM-free sim program (`tsconfig.sim.json` excludes `sim/save/**`) stays free of IndexedDB. `sim/save/capability.ts` re-exports
 * the capability pieces from here; `workers/save-control.ts` implements `SaveWritePort`.
 */

/** Per-session write capability (C05 rule 3 and the 1.1 `exp:` addition). Engine-internal, not a contract. */
export type SaveCapability =
  | 'story'
  | 'sandbox'
  | `standalone:${'racing' | 'fighter' | 'tycoon'}`
  | `exp:${string}`;

/** Whether a session with `cap` may write `slot`. */
export function canWrite(cap: SaveCapability, slot: SlotId): boolean {
  if (cap === 'story') return slot === 'core' || slot === 'settings' || slot.startsWith('story:');
  if (cap === 'sandbox') return slot === 'settings' || slot === 'sandbox' || slot.startsWith('mod:');
  if (cap.startsWith('standalone:')) return slot === 'core' || slot === 'settings' || slot === `mode:${cap.slice(11)}`;
  if (cap.startsWith('exp:')) return slot === `mod:${cap.slice(4)}`;
  return false;
}

/** The capability a QA caller should use to write `slot` (QA bridge only). */
export function capabilityFor(slot: SlotId): SaveCapability {
  if (slot.startsWith('mode:')) return `standalone:${slot.slice(5) as 'racing' | 'fighter' | 'tycoon'}`;
  if (slot === 'sandbox' || slot.startsWith('mod:')) return 'sandbox';
  return 'story';
}

/** What a sim system holds to request a save of a slot's data. Writes happen at the next flush, latest per slot wins. */
export interface SaveWritePort {
  post(slot: SlotId, data: unknown, reason: SaveReason): void;
}

/** The session side of the save binding: the capability of the running top-level mode and a write path that checks it. */
export interface ModeSaveBinding {
  readonly capability: SaveCapability | null;
  setCapability(cap: SaveCapability | null): void;
  /** Posts a slot write if the capability allows it; otherwise answers `NOT_ALLOWED` and writes nothing. */
  post(slot: SlotId, data: unknown, reason: SaveReason): { ok: true } | { ok: false; error: Extract<SaveErrorCode, 'NOT_ALLOWED'> };
}
