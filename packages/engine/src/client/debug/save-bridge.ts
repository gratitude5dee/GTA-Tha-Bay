import { SaveKilled, SaveServiceImpl, capabilityFor, type SlotInfo, type WriteStep } from '../../sim/save/index.ts';
import type { ProfileId, ProfileMeta, SaveGame, SaveReason, SaveResult, SlotId } from '@dv/shared';

/**
 * `window.__dvBridge.engine.save` (QA builds only; reached through the same dynamic import as the engine bridge, so a
 * production dist has neither). It drives a main-thread SaveService on the real `dv-saves` database: the production
 * service runs in sim.worker, and the two may share the database because writes are compare-and-swap (rule 9).
 */
export interface SaveBridge {
  /** Profiles; creates "Player 1" when there are none, so the demo always has one. */
  list(): Promise<ProfileMeta[]>;
  /** Writes a slot of the active profile (the first one). The capability is chosen from the slot. */
  write(slot: SlotId, data: unknown, reason?: SaveReason): Promise<SaveResult>;
  /** Loads the active profile; includes the generation and checksum of each stored slot. */
  load(): Promise<{ game: SaveGame; slots: Record<string, SlotInfo | null>; persistent: boolean }>;
  /** The next write is interrupted after `step` (default 'c') as if the tab were killed; resolves with the step that fired. */
  kill(step?: WriteStep): Promise<WriteStep | null>;
  /** Exports the active profile as `.dvsave` JSON text. */
  export(): Promise<string>;
  /** Imports `.dvsave` JSON text; `replace` goes into the active profile. */
  import(text: string, mode: 'asNew' | 'replace'): Promise<SaveResult>;
  undo(): Promise<SaveResult>;
}

export function createSaveBridge(): SaveBridge {
  let armed: WriteStep | null = null;
  let fired: WriteStep | null = null;
  let service: Promise<SaveServiceImpl> | null = null;
  let active: ProfileId | null = null;

  const open = (): Promise<SaveServiceImpl> =>
    (service ??= SaveServiceImpl.open({
      buildId: 'qa',
      onStep: (s) => {
        if (armed === s) {
          armed = null;
          fired = s;
          throw new SaveKilled(s);
        }
      },
    }));

  const ensure = async (): Promise<{ svc: SaveServiceImpl; id: ProfileId }> => {
    const svc = await open();
    let list = await svc.listProfiles();
    if (list.length === 0) {
      const made = await svc.createProfile('Player 1');
      if (!('id' in made)) throw new Error(`createProfile: ${JSON.stringify(made)}`);
      list = [made];
    }
    const id = list.find((p) => p.id === active)?.id ?? (list[0] as ProfileMeta).id;
    if (svc.activeProfile !== id) await svc.load(id);
    active = id;
    return { svc, id };
  };

  return {
    async list() {
      await ensure();
      return (await open()).listProfiles();
    },
    async write(slot, data, reason = 'manual') {
      const { svc } = await ensure();
      svc.setCapability(capabilityFor(slot));
      fired = null;
      try {
        return await svc.write(slot, data, reason);
      } catch (e) {
        if (e instanceof SaveKilled) return { ok: false, error: 'CONFLICT', detail: `killed after step ${e.after}` };
        throw e;
      }
    },
    async load() {
      const { svc, id } = await ensure();
      const game = await svc.load(id);
      const slots: Record<string, SlotInfo | null> = {};
      for (const s of ['core', 'settings', 'sandbox', 'story:auto', 'story:1', 'story:2', 'story:3', 'mode:racing', 'mode:fighter', 'mode:tycoon'] as const) {
        const info = await svc.describeSlot(id, s);
        if (info) slots[s] = info;
      }
      return { game, slots, persistent: svc.persistent };
    },
    async kill(step = 'c') {
      armed = step;
      await ensure();
      return fired;
    },
    async export() {
      const { svc, id } = await ensure();
      return (await svc.exportProfile(id)).text();
    },
    async import(text, mode) {
      const { svc, id } = await ensure();
      const r = await svc.importProfile(new Blob([text]), mode, mode === 'replace' ? id : undefined);
      if (r.ok && mode === 'asNew' && svc.lastImport) active = svc.lastImport.profileId;
      return r;
    },
    async undo() {
      const { svc, id } = await ensure();
      return svc.undoImport(id);
    },
  };
}
