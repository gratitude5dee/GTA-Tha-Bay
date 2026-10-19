import {
  SAVE_LIMITS,
  type JsonObject,
  type ProfileId,
  type SaveErrorCode,
  type SaveRecord,
  type SliceKind,
  type SlotId,
  type SlotPointer,
} from '@dv/shared';
import { recordIsIntact } from './canonical.ts';
import { slotKind } from './capability.ts';
import type { SaveCtx } from './context.ts';
import { MigrationError, migrateData } from './migrate.ts';

export interface LoadedSlot {
  slot: SlotId;
  kind: SliceKind;
  /** Migrated data, or the raw data of a newer schema; null when no generation could be read. */
  data: JsonObject | null;
  gen: number;
  savedAt: number;
  /** First problem met while looking for a readable generation. Set even when a fallback generation loaded. */
  error?: SaveErrorCode;
  /** The record is from a newer build: the session must stay read-only. */
  newer: boolean;
}

/** Candidate generations for a pointer: the pointer's, then the previous ones kept (C05 rule 2, `keepGenerations`). */
function candidates(ptr: SlotPointer): number[] {
  const out: number[] = [];
  for (let g = ptr.gen; g >= 1 && g > ptr.gen - SAVE_LIMITS.keepGenerations; g--) out.push(g);
  return out;
}

/** The newest intact record of a slot (no migration). Reads only; nothing is mutated. */
export async function intactRecord(ctx: SaveCtx, ptr: SlotPointer): Promise<{ rec: SaveRecord; fellBack: boolean } | null> {
  for (const g of candidates(ptr)) {
    const rec = await ctx.store.getRecord(ptr.profileId, ptr.slot, g);
    if (rec && recordIsIntact(rec)) return { rec, fellBack: g !== ptr.gen };
  }
  return null;
}

/** Rule 2 and rule 5: read the pointer's record, fall back to the previous generation on a checksum or migration failure. */
export async function loadSlot(ctx: SaveCtx, ptr: SlotPointer): Promise<LoadedSlot> {
  const kind = slotKind(ptr.slot);
  let error: SaveErrorCode | undefined;
  for (const g of candidates(ptr)) {
    const rec = await ctx.store.getRecord(ptr.profileId, ptr.slot, g);
    if (!rec || !recordIsIntact(rec)) {
      error ??= 'CHECKSUM';
      continue;
    }
    if (rec.schema > ctx.migrations.current[kind]) {
      return { slot: ptr.slot, kind, data: rec.data as JsonObject, gen: g, savedAt: rec.savedAt, error: 'NEWER_SCHEMA', newer: true };
    }
    try {
      const data = migrateData(ctx.migrations, kind, rec.schema, rec.data as JsonObject);
      return { slot: ptr.slot, kind, data, gen: g, savedAt: rec.savedAt, ...(error ? { error } : {}), newer: false };
    } catch (e) {
      if (!(e instanceof MigrationError)) throw e;
      error ??= 'INVALID';
    }
  }
  return { slot: ptr.slot, kind, data: null, gen: 0, savedAt: 0, ...(error ? { error } : {}), newer: false };
}

export async function loadAll(ctx: SaveCtx, profileId: ProfileId): Promise<LoadedSlot[]> {
  const out: LoadedSlot[] = [];
  const pointers = (await ctx.store.listPointers(profileId)).sort((a, b) => (a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0));
  for (const p of pointers) out.push(await loadSlot(ctx, p));
  return out;
}

/** Boot sweep (C05 rule 1): delete records no pointer reaches, and generations older than `keepGenerations`. */
export async function sweepOrphans(ctx: SaveCtx, profileId: ProfileId): Promise<number> {
  const pointers = new Map((await ctx.store.listPointers(profileId)).map((p) => [p.slot, p.gen] as const));
  let n = 0;
  for (const rec of await ctx.store.listRecords(profileId)) {
    const gen = pointers.get(rec.slot);
    if (gen === undefined || rec.gen > gen || rec.gen <= gen - SAVE_LIMITS.keepGenerations) {
      await ctx.store.deleteRecord(profileId, rec.slot, rec.gen);
      n++;
    }
  }
  return n;
}
