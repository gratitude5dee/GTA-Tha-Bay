import type { ProfileId, SaveRecord, Tombstone } from '@dv/shared';
import type { SaveCtx } from './context.ts';
import { intactRecord } from './load.ts';

/**
 * `changesSince` (C05, the sync unit for M12a1): the current record of every slot saved after `cursor` and every
 * tombstone written after it. The cursor is a wall-clock ms stamp that is unique per device (the service stamps
 * strictly increasing times), so `savedAt > cursor` loses nothing. The returned cursor is the newest stamp seen, or the
 * input cursor when nothing changed.
 */
export async function changesSince(
  ctx: SaveCtx,
  profileId: ProfileId,
  cursor: number,
): Promise<{ records: SaveRecord[]; tombstones: Tombstone[]; cursor: number }> {
  const records: SaveRecord[] = [];
  let next = cursor;
  for (const p of await ctx.store.listPointers(profileId)) {
    if (p.savedAt <= cursor) continue;
    const found = await intactRecord(ctx, p);
    if (found) {
      records.push(found.rec);
      next = Math.max(next, found.rec.savedAt);
    }
  }
  records.sort((a, b) => a.savedAt - b.savedAt);
  const tombstones = (await ctx.store.listTombstones(profileId)).filter((t) => t.deletedAt > cursor).sort((a, b) => a.deletedAt - b.deletedAt);
  for (const t of tombstones) next = Math.max(next, t.deletedAt);
  return { records, tombstones, cursor: next };
}
