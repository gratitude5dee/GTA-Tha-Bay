import type { SliceKind, SlotId } from '@dv/shared';

export { canWrite, capabilityFor, type SaveCapability } from '../save-port.ts';

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
