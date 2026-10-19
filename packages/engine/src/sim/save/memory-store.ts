import type { ProfileId, ProfileMeta, SaveRecord, SlotId, SlotPointer, Tombstone } from '@dv/shared';
import { tombstoneKey, type SaveStore } from './store.ts';

const clone = <T>(v: T): T => structuredClone(v);

/**
 * In-memory SaveStore with the same semantics as the IndexedDB one. Used when IndexedDB throws on open
 * (`SaveService.persistent === false`, the S10 banner) and as the shared backing of tests. Two services may share one
 * instance to model two tabs on one database.
 */
export class MemoryStore implements SaveStore {
  readonly persistent = false;
  private profiles = new Map<string, ProfileMeta>();
  private records = new Map<string, SaveRecord>();
  private pointers = new Map<string, SlotPointer>();
  private tombstones = new Map<string, Tombstone>();
  private meta = new Map<string, unknown>();

  private rk = (p: string, s: string, g: number): string => `${p}|${s}|${g}`;
  private pk = (p: string, s: string): string => `${p}|${s}`;

  async listProfiles(): Promise<ProfileMeta[]> {
    return [...this.profiles.values()].map(clone);
  }
  async getProfile(id: ProfileId): Promise<ProfileMeta | null> {
    const p = this.profiles.get(id);
    return p ? clone(p) : null;
  }
  async putProfile(meta: ProfileMeta): Promise<void> {
    this.profiles.set(meta.id, clone(meta));
  }
  async deleteProfileData(id: ProfileId): Promise<void> {
    this.profiles.delete(id);
    for (const k of [...this.records.keys()]) if (k.startsWith(`${id}|`)) this.records.delete(k);
    for (const k of [...this.pointers.keys()]) if (k.startsWith(`${id}|`)) this.pointers.delete(k);
  }

  async addRecord(rec: SaveRecord): Promise<boolean> {
    const k = this.rk(rec.profileId, rec.slot, rec.gen);
    if (this.records.has(k)) return false;
    this.records.set(k, clone(rec));
    return true;
  }
  async getRecord(profileId: ProfileId, slot: SlotId, gen: number): Promise<SaveRecord | null> {
    const r = this.records.get(this.rk(profileId, slot, gen));
    return r ? clone(r) : null;
  }
  async deleteRecord(profileId: ProfileId, slot: SlotId, gen: number): Promise<void> {
    this.records.delete(this.rk(profileId, slot, gen));
  }
  async listRecords(profileId: ProfileId): Promise<SaveRecord[]> {
    const out: SaveRecord[] = [];
    for (const [k, r] of this.records) if (k.startsWith(`${profileId}|`)) out.push(clone(r));
    return out;
  }

  async getPointer(profileId: ProfileId, slot: SlotId): Promise<SlotPointer | null> {
    const p = this.pointers.get(this.pk(profileId, slot));
    return p ? { ...p } : null;
  }
  async listPointers(profileId: ProfileId): Promise<SlotPointer[]> {
    const out: SlotPointer[] = [];
    for (const [k, p] of this.pointers) if (k.startsWith(`${profileId}|`)) out.push({ ...p });
    return out;
  }
  async casPointer(next: SlotPointer, expectedGen: number): Promise<boolean> {
    const k = this.pk(next.profileId, next.slot);
    const cur = this.pointers.get(k);
    if ((cur?.gen ?? 0) !== expectedGen) return false;
    this.pointers.set(k, { ...next });
    return true;
  }
  async setPointer(p: SlotPointer): Promise<void> {
    this.pointers.set(this.pk(p.profileId, p.slot), { ...p });
  }
  async deletePointer(profileId: ProfileId, slot: SlotId): Promise<void> {
    this.pointers.delete(this.pk(profileId, slot));
  }

  async addTombstone(t: Tombstone): Promise<void> {
    this.tombstones.set(`${t.profileId}|${tombstoneKey(t)}`, { ...t });
  }
  async listTombstones(profileId: ProfileId): Promise<Tombstone[]> {
    const out: Tombstone[] = [];
    for (const [k, t] of this.tombstones) if (k.startsWith(`${profileId}|`)) out.push({ ...t });
    return out;
  }
  async deleteTombstone(t: Tombstone): Promise<void> {
    this.tombstones.delete(`${t.profileId}|${tombstoneKey(t)}`);
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    return this.meta.has(key) ? clone(this.meta.get(key) as T) : undefined;
  }
  async setMeta(key: string, value: unknown): Promise<void> {
    this.meta.set(key, clone(value));
  }
  close(): void {}
}
