import type { SaveReason, SlotId } from '@dv/shared';
import { canWrite, type ModeSaveBinding, type SaveCapability, type SaveWritePort } from '../save-port.ts';

/** The session capability of a top-level mode (C05 rule 3 and the 1.1 `exp:` addition). Null for a mode that cannot write at all. */
export function capabilityOfMode(id: string): SaveCapability | null {
  if (id === 'story' || id === 'sandbox') return id;
  if (id === 'racing' || id === 'fighter' || id === 'tycoon') return `standalone:${id}`;
  if (id.startsWith('exp:')) return `exp:${id.slice(4)}`;
  return null;
}

export interface CapabilityTarget {
  /** Applied to the SaveService before its next write (`SaveControl.setCapability`). */
  setCapability?(cap: SaveCapability | null): void;
}

/**
 * Binds the mode host to saving through the type-only face of `sim/save-port.ts`: the host sets the capability of the running
 * top-level mode, and every slot write goes through `post`, which refuses (`NOT_ALLOWED`) a slot the capability does not allow before
 * the write reaches the SaveService. The data is copied when posted, so the sim may go on changing its state while the write is
 * waiting for the next flush.
 */
export function bindModeSave(port: SaveWritePort, target: CapabilityTarget = {}): ModeSaveBinding {
  let cap: SaveCapability | null = null;
  return {
    get capability() {
      return cap;
    },
    setCapability(c) {
      cap = c;
      target.setCapability?.(c);
    },
    post(slot: SlotId, data: unknown, reason: SaveReason) {
      if (!cap || !canWrite(cap, slot)) return { ok: false, error: 'NOT_ALLOWED' };
      port.post(slot, JSON.parse(JSON.stringify(data)) as unknown, reason);
      return { ok: true };
    },
  };
}
