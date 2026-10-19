import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import type { ProfileId, ProfileMeta, SaveRecord } from '@dv/shared';
import { IdbStore, MemoryStore, SaveServiceImpl, openSaveDb, type SaveServiceOptions, type SaveStore } from '../../src/sim/save/index.ts';

// IdbStore uses the global IDBKeyRange, which Node lacks.
(globalThis as { IDBKeyRange?: unknown }).IDBKeyRange = IDBKeyRange;

export const T0 = 1_760_000_000_000;

export function clock(start = T0): { now: () => number; set(t: number): void; advance(ms: number): void } {
  let t = start;
  return { now: () => t, set: (v) => void (t = v), advance: (ms) => void (t += ms) };
}

export type StoreKind = 'memory' | 'idb';

/** A fresh store of the requested kind; two services given the same store model two tabs on one database. */
export async function newStore(kind: StoreKind): Promise<SaveStore> {
  return kind === 'memory' ? new MemoryStore() : new IdbStore(await openSaveDb(new IDBFactory()));
}

export function openSvc(store: SaveStore, opts: SaveServiceOptions = {}): Promise<SaveServiceImpl> {
  return SaveServiceImpl.open({ store, buildId: 'test', worldBake: 'test', ...opts });
}

/** Creates a profile, loads it and returns its meta. */
export async function mkProfile(svc: SaveServiceImpl, name = 'Player'): Promise<ProfileMeta> {
  const p = await svc.createProfile(name);
  if (!('id' in p)) throw new Error(`createProfile failed: ${JSON.stringify(p)}`);
  await svc.load(p.id);
  return p;
}

/** `{pad: 'xxx'}` whose canonical JSON is exactly `bytes` long. */
export function padded(bytes: number): { pad: string } {
  return { pad: 'x'.repeat(bytes - '{"pad":""}'.length) };
}

export async function snapshot(store: SaveStore, id: ProfileId): Promise<string> {
  const recs = (await store.listRecords(id)).sort((a, b) => (a.slot + a.gen < b.slot + b.gen ? -1 : 1));
  const ptrs = (await store.listPointers(id)).sort((a, b) => (a.slot < b.slot ? -1 : 1));
  return JSON.stringify({ recs, ptrs });
}

export async function replaceRecord(store: SaveStore, rec: SaveRecord): Promise<void> {
  await store.deleteRecord(rec.profileId, rec.slot, rec.gen);
  await store.addRecord(rec);
}
