import type { ProfileId, SlotId } from '@dv/shared';

/** Why a session is read-only. */
export type ReadOnlyReason = 'conflict' | 'newer-schema';

/**
 * One service's view of the profile it works on (C05 rule 9). `seen` is the pointer generation this session last read
 * or wrote per slot (absent = 0). A write whose stored pointer differs from `seen`, or whose pointer compare-and-swap
 * loses, means another tab wrote: the session trips to read-only and stays there until the profile is loaded again.
 */
export class Session {
  readOnly: ReadOnlyReason | null = null;
  readonly seen = new Map<SlotId, number>();
  constructor(readonly profileId: ProfileId) {}

  trip(reason: ReadOnlyReason): void {
    // A conflict does not hide a newer-schema lock.
    if (this.readOnly === null || reason === 'newer-schema') this.readOnly = reason;
  }
}
