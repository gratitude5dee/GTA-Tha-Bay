import type { SliceKind, SlotId } from '@dv/shared';

/** Per-session write capability (C05 rule 3 and the 1.1 `exp:` addition). Engine-internal, not a contract. */
export type SaveCapability =
  | 'story'
  | 'sandbox'
  | `standalone:${'racing' | 'fighter' | 'tycoon'}`
  | `exp:${string}`;

const SLOT_RE = /^(core|settings|sandbox|story:(auto|1|2|3)|mode:(racing|fighter|tycoon)|mod:[a-z0-9][a-z0-9._-]{0,63})$/;

export function isSlotId(s: string): s is SlotId {
  return SLOT_RE.test(s);
}

/** The slice kind a slot stores. */
export function slotKind(slot: SlotId): SliceKind {
  if (slot.startsWith('story:')) return 'story';
  if (slot.startsWith('mode:')) return slot.slice(5) as 'racing' | 'fighter' | 'tycoon';
  if (slot.startsWith('mod:')) return 'mod';
  return slot as 'core' | 'settings' | 'sandbox';
}

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
