import {
  SAVE_LIMITS,
  type ProfileId,
  type ProfileMeta,
  type SaveRecord,
  type SaveResult,
  type SlotId,
  type Tombstone,
} from '@dv/shared';
import { recordIsIntact } from './canonical.ts';
import { slotKind } from './capability.ts';
import { fail, type SaveCtx } from './context.ts';
import { intactRecord } from './load.ts';
import { newProfile, normalizeName, randomHex32, uniqueName } from './profiles.ts';
import { validateEnvelope, validateSlice } from './schemas.ts';
import { blocksRecord, retiredGen } from './tombstones.ts';

/** A `.dvsave` file: JSON `{format, records[], tombstones[]}` plus the profile name (C05 `exportProfile`). */
export interface DvSaveFile {
  format: 'dvsave';
  v: 1;
  exportedAt: number;
  profile: { name: string; playtimeSec: number };
  records: SaveRecord[];
  tombstones: Tombstone[];
}

export async function buildExport(ctx: SaveCtx, profile: ProfileMeta): Promise<DvSaveFile> {
  const records: SaveRecord[] = [];
  for (const p of (await ctx.store.listPointers(profile.id)).sort((a, b) => (a.slot < b.slot ? -1 : 1))) {
    const found = await intactRecord(ctx, p);
    if (found) records.push(found.rec);
  }
  const tombstones = (await ctx.store.listTombstones(profile.id)).sort((a, b) => a.deletedAt - b.deletedAt);
  return { format: 'dvsave', v: 1, exportedAt: ctx.stamp(), profile: { name: profile.name, playtimeSec: profile.playtimeSec }, records, tombstones };
}

export function exportBlob(file: DvSaveFile): Blob {
  return new Blob([JSON.stringify(file)], { type: 'application/json' });
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

type Parsed = { ok: true; file: DvSaveFile } | { ok: false; result: SaveResult };

/** Parses and validates a whole file; any bad record rejects the whole import (rule 8). */
export async function parseImport(ctx: SaveCtx, b: Blob): Promise<Parsed> {
  let raw: unknown;
  try {
    raw = JSON.parse(await b.text());
  } catch {
    return { ok: false, result: fail('INVALID', 'not JSON') };
  }
  if (!isObj(raw) || raw['format'] !== 'dvsave' || raw['v'] !== 1 || !Array.isArray(raw['records']) || !Array.isArray(raw['tombstones']) || !isObj(raw['profile'])) {
    return { ok: false, result: fail('INVALID', 'not a .dvsave file') };
  }
  const profile = raw['profile'];
  if (typeof profile['name'] !== 'string' || typeof profile['playtimeSec'] !== 'number') return { ok: false, result: fail('INVALID', 'bad profile block') };
  const seen = new Set<string>();
  let total = 0;
  for (const r of raw['records'] as unknown[]) {
    if (isObj(r) && typeof r['bytes'] === 'number' && r['bytes'] > SAVE_LIMITS.recordMaxBytes) return { ok: false, result: fail('TOO_LARGE', 'a record exceeds the size cap') };
    const env = validateEnvelope(r);
    if (env !== null) return { ok: false, result: fail('INVALID', env) };
    const rec = r as SaveRecord;
    if (slotKind(rec.slot) !== rec.kind) return { ok: false, result: fail('INVALID', `${rec.slot}: kind ${rec.kind} does not match the slot`) };
    if (seen.has(rec.slot)) return { ok: false, result: fail('INVALID', `${rec.slot}: duplicate slot`) };
    seen.add(rec.slot);
    if (rec.schema > ctx.migrations.current[rec.kind]) return { ok: false, result: fail('NEWER_SCHEMA', `${rec.slot}: schema ${rec.schema} is newer than this build`) };
    if (!recordIsIntact(rec)) return { ok: false, result: fail('INVALID', `${rec.slot}: checksum mismatch`) };
    const bad = validateSlice(rec.kind, rec.schema, rec.data);
    if (bad !== null) return { ok: false, result: fail('INVALID', `${rec.slot}: ${bad}`) };
    total += rec.bytes;
  }
  if (total > SAVE_LIMITS.profileMaxBytes) return { ok: false, result: fail('TOO_LARGE', 'the profile exceeds the size cap') };
  for (const t of raw['tombstones'] as unknown[]) {
    if (!isObj(t) || typeof t['slot'] !== 'string' || typeof t['gen'] !== 'number' || typeof t['deletedAt'] !== 'number') return { ok: false, result: fail('INVALID', 'bad tombstone') };
  }
  return { ok: true, file: raw as unknown as DvSaveFile };
}

export interface ImportOutcome {
  result: SaveResult;
  profileId: ProfileId | null;
  imported: SlotId[];
  /** Slots left out because a tombstone is newer than the incoming record (rule 6). */
  skipped: SlotId[];
}

const none = (result: SaveResult): ImportOutcome => ({ result, profileId: null, imported: [], skipped: [] });

export async function importAsNew(ctx: SaveCtx, file: DvSaveFile, random: (n: number) => Uint8Array): Promise<ImportOutcome> {
  const profiles = await ctx.store.listProfiles();
  if (profiles.length >= SAVE_LIMITS.maxProfiles) return none(fail('PROFILE_LIMIT'));
  const name = uniqueName(profiles, normalizeName(file.profile.name) ?? 'Imported');
  const id = randomHex32(random) as ProfileId;
  const now = ctx.stamp();
  const meta: ProfileMeta = { ...newProfile(id, name, ctx.deviceId, now), playtimeSec: file.profile.playtimeSec };
  let bytes = 0;
  const imported: SlotId[] = [];
  for (const r of file.records) {
    const rec: SaveRecord = { ...r, profileId: id, gen: 1 };
    if (!(await ctx.store.addRecord(rec))) return none(fail('INVALID', 'duplicate record'));
    await ctx.store.setPointer({ profileId: id, slot: rec.slot, gen: 1, savedAt: rec.savedAt });
    bytes += rec.bytes;
    imported.push(rec.slot);
  }
  for (const t of file.tombstones) await ctx.store.addTombstone({ ...t, profileId: id });
  await ctx.store.putProfile(meta);
  return { result: { ok: true, gen: imported.length, bytes }, profileId: id, imported, skipped: [] };
}

export async function importReplace(ctx: SaveCtx, file: DvSaveFile, into: ProfileId): Promise<ImportOutcome> {
  const target = await ctx.store.getProfile(into);
  if (!target) return none(fail('INVALID', 'no such profile'));
  const tombs = await ctx.store.listTombstones(into);
  const pointers = new Map((await ctx.store.listPointers(into)).map((p) => [p.slot, p] as const));
  const undoGen: Partial<Record<SlotId, number>> = {};
  const imported: SlotId[] = [];
  const skipped: SlotId[] = [];
  let bytes = 0;
  for (const r of file.records) {
    if (blocksRecord(tombs, r.slot, r.savedAt)) {
      skipped.push(r.slot);
      continue;
    }
    const prev = pointers.get(r.slot)?.gen ?? 0;
    const gen = Math.max(prev, retiredGen(tombs, r.slot)) + 1;
    const rec: SaveRecord = { ...r, profileId: into, gen };
    if (!(await ctx.store.addRecord(rec))) return none(fail('CONFLICT', `${r.slot}: generation ${gen} already exists`));
    await ctx.store.setPointer({ profileId: into, slot: r.slot, gen, savedAt: rec.savedAt });
    undoGen[r.slot] = prev;
    imported.push(r.slot);
    bytes += rec.bytes;
    // Older generations are left for the boot sweep so that undo restores the stored records exactly.
  }
  await ctx.store.putProfile({ ...target, updatedAt: ctx.stamp(), importedFrom: { at: ctx.stamp(), undoGen: undoGen as Record<SlotId, number> } });
  return { result: { ok: true, gen: imported.length, bytes }, profileId: into, imported, skipped };
}

/** Moves the pointers back to the generations stored in `importedFrom.undoGen` (rule 8). */
export async function undoImport(ctx: SaveCtx, id: ProfileId): Promise<{ result: SaveResult; slots: SlotId[] }> {
  const profile = await ctx.store.getProfile(id);
  if (!profile) return { result: fail('INVALID', 'no such profile'), slots: [] };
  if (!profile.importedFrom) return { result: fail('INVALID', 'nothing to undo'), slots: [] };
  const entries = Object.entries(profile.importedFrom.undoGen) as [SlotId, number][];
  const prevRecords = new Map<SlotId, SaveRecord>();
  for (const [slot, prev] of entries) {
    if (prev === 0) continue;
    const rec = await ctx.store.getRecord(id, slot, prev);
    if (!rec || !recordIsIntact(rec)) return { result: fail('INVALID', `${slot}: the previous generation is gone`), slots: [] };
    prevRecords.set(slot, rec);
  }
  const all = await ctx.store.listRecords(id);
  for (const [slot, prev] of entries) {
    const rec = prevRecords.get(slot);
    if (rec) await ctx.store.setPointer({ profileId: id, slot, gen: prev, savedAt: rec.savedAt });
    else await ctx.store.deletePointer(id, slot);
    for (const r of all) if (r.slot === slot && r.gen > prev) await ctx.store.deleteRecord(id, slot, r.gen);
  }
  const { importedFrom: _gone, ...rest } = profile;
  await ctx.store.putProfile({ ...rest, updatedAt: ctx.stamp() });
  return { result: { ok: true, gen: entries.length, bytes: 0 }, slots: entries.map(([s]) => s) };
}
