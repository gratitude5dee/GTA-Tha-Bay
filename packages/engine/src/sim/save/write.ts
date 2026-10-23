import { SAVE_LIMITS, type ProfileId, type SaveRecord, type SaveResult, type SlotId } from '@dv/shared';
import { SaveInvalidData, canonicalData, recordIsIntact } from './canonical.ts';
import { slotKind } from './capability.ts';
import { fail, type SaveCtx } from './context.ts';
import type { Session } from './multitab.ts';
import { retiredGen } from './tombstones.ts';

/** C05 rule 1, steps (a) to (f). `playtimeSec` is stamped on the record. */
export async function writeSlot(
  ctx: SaveCtx,
  sess: Session,
  slot: SlotId,
  data: unknown,
  playtimeSec: number,
): Promise<SaveResult> {
  const pid: ProfileId = sess.profileId;
  const kind = slotKind(slot);

  // (a) canonicalize, size and checksum.
  let c;
  try {
    c = canonicalData(data);
  } catch (e) {
    if (e instanceof SaveInvalidData) return fail('INVALID', e.message);
    throw e;
  }
  await ctx.step?.('a');

  // (b) caps: the record, then the profile's live records plus this one.
  if (c.bytes > SAVE_LIMITS.recordMaxBytes) return fail('TOO_LARGE', `${c.bytes} bytes > ${SAVE_LIMITS.recordMaxBytes}`);
  const pointers = await ctx.store.listPointers(pid);
  let total = c.bytes;
  for (const p of pointers) {
    if (p.slot === slot) continue;
    const r = await ctx.store.getRecord(pid, p.slot, p.gen);
    if (r) total += r.bytes;
  }
  if (total > SAVE_LIMITS.profileMaxBytes) return fail('TOO_LARGE', `profile would hold ${total} bytes > ${SAVE_LIMITS.profileMaxBytes}`);
  await ctx.step?.('b');

  // (c) put the record at pointer.gen + 1. Another writer since this session last looked means CONFLICT.
  const ptr = pointers.find((p) => p.slot === slot) ?? null;
  const curGen = ptr?.gen ?? 0;
  if (curGen !== (sess.seen.get(slot) ?? 0)) return fail('CONFLICT', 'the slot was written by another session');
  const tombs = await ctx.store.listTombstones(pid);
  const gen = Math.max(curGen, retiredGen(tombs, slot)) + 1;
  const savedAt = ctx.stamp();
  const rec: SaveRecord = {
    format: 'dv-save',
    kind,
    slot,
    profileId: pid,
    schema: ctx.migrations.current[kind],
    gen,
    savedAt,
    playtimeSec,
    deviceId: ctx.deviceId,
    buildId: ctx.buildId,
    worldBake: ctx.worldBake,
    bytes: c.bytes,
    checksum: c.checksum,
    data: JSON.parse(c.json) as unknown,
  };
  if (!(await ctx.store.addRecord(rec))) return fail('CONFLICT', 'another session wrote the same generation');
  await ctx.step?.('c');

  // (d) a new read verifies the checksum. A missing record is not a checksum failure: another service's boot sweep (a second tab, or
  // the page's own SaveService opening) took it as an orphan, and (e) puts it back in the transaction that moves the pointer.
  const stored = await ctx.store.getRecord(pid, slot, gen);
  if (stored && !recordIsIntact(stored)) {
    await ctx.store.deleteRecord(pid, slot, gen);
    return fail('CHECKSUM', 'the record did not verify after writing');
  }
  await ctx.step?.('d');

  // (e) move the pointer only if it is still where we read it, with the record verified in the same transaction.
  const moved = await ctx.store.commitRecord(rec, curGen);
  if (moved !== 'ok') {
    await ctx.store.deleteRecord(pid, slot, gen);
    return moved === 'moved' ? fail('CONFLICT', 'the pointer moved while writing') : fail('CHECKSUM', 'the record did not verify after writing');
  }
  sess.seen.set(slot, gen);
  await ctx.step?.('e');

  // (f) drop generations older than keepGenerations.
  for (const r of await ctx.store.listRecords(pid)) {
    if (r.slot === slot && r.gen <= gen - SAVE_LIMITS.keepGenerations) await ctx.store.deleteRecord(pid, slot, r.gen);
  }
  await ctx.step?.('f');

  return { ok: true, gen, bytes: c.bytes };
}
