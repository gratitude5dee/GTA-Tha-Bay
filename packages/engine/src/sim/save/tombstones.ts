import { SAVE_LIMITS, type ProfileId, type SlotId, type Tombstone } from '@dv/shared';
import type { SaveCtx } from './context.ts';

const DAY_MS = 86_400_000;

/** The newest tombstone for `slot` (a slot tombstone), or null. */
export function latestFor(tombs: readonly Tombstone[], slot: SlotId): Tombstone | null {
  let best: Tombstone | null = null;
  for (const t of tombs) if (t.slot === slot && (best === null || t.deletedAt > best.deletedAt)) best = t;
  return best;
}

/** Highest generation a tombstone has retired for `slot`; new writes start above it. */
export function retiredGen(tombs: readonly Tombstone[], slot: SlotId): number {
  let g = 0;
  for (const t of tombs) if (t.slot === slot && t.gen > g) g = t.gen;
  return g;
}

/**
 * Rule 6: an incoming record never resurrects a slot (or profile) that was deleted after the record was saved.
 * A record saved after the deletion is a new life of the slot and passes.
 */
export function blocksRecord(tombs: readonly Tombstone[], slot: SlotId, savedAt: number): boolean {
  for (const t of tombs) if ((t.slot === slot || t.slot === '*') && t.deletedAt > savedAt) return true;
  return false;
}

export async function writeTombstone(ctx: SaveCtx, profileId: ProfileId, slot: SlotId | '*', gen: number): Promise<Tombstone> {
  const t: Tombstone = { profileId, slot, gen, deletedAt: ctx.stamp() };
  await ctx.store.addTombstone(t);
  return t;
}

const syncedKey = (id: ProfileId): string => `tombstonesSynced:${id}`;

/** S09 reports that every tombstone with `deletedAt <= upTo` reached the server. */
export async function markSynced(ctx: SaveCtx, profileId: ProfileId, upTo: number): Promise<void> {
  const cur = (await ctx.store.getMeta<number>(syncedKey(profileId))) ?? 0;
  if (upTo > cur) await ctx.store.setMeta(syncedKey(profileId), upTo);
}

/** Deletes tombstones older than the retention window that are marked synced. Returns how many were purged. */
export async function purge(ctx: SaveCtx, profileId: ProfileId, nowMs: number): Promise<number> {
  const synced = (await ctx.store.getMeta<number>(syncedKey(profileId))) ?? 0;
  const cutoff = nowMs - SAVE_LIMITS.tombstoneRetentionDays * DAY_MS;
  let n = 0;
  for (const t of await ctx.store.listTombstones(profileId)) {
    if (t.deletedAt < cutoff && t.deletedAt <= synced) {
      await ctx.store.deleteTombstone(t);
      n++;
    }
  }
  return n;
}
