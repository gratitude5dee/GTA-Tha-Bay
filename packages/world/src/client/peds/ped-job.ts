/**
 * `world.ped`, the asset.worker job of the pedestrian kit (M10d4): reads a group of `character/ped.*`, `prop/ped.far.*` or `texture/ped.atlas`
 * assets at the variant of a tier through the pack store (hashed, cached in OPFS, counted like every pack) and returns their bytes
 * transferred. The kit parses them on the page (`kit.ts`, `person-glb.ts`). The files of a group are read ONE AFTER ANOTHER in the `idle`
 * lane, so the kit never holds more than one of the lane's two slots and the world's own `idle` reads (skyline models, L1/L2 tiles) never
 * queue behind the kit's files; one job per group keeps the page's round trips to a few (BD-REPAIR-M10d4-03). A catalog from before the
 * kit has none of them: the job answers `missing` and the renderer keeps the mannequin. No `three` import.
 */
import { PackUnavailable } from '@dv/engine/assets/types';
import type { AssetJob, AssetService } from '@dv/engine/assets/service';

export interface PedJobArgs {
  /** In order: `character/ped.body.a`, `character/ped.outfit.01`, `prop/ped.far.a` or `texture/ped.atlas`. */
  refs: string[];
  /** The variant to read (also the tier id the catalog resolves). */
  variant: 'desktop' | 'mobile' | 'mobile-low';
}

/** `files` in the order of `refs`. */
export type PedJobResult = { files: ArrayBuffer[] } | { missing: true };

async function readOne(svc: AssetService, at: string, variant: PedJobArgs['variant'], signal: AbortSignal | undefined): Promise<ArrayBuffer> {
  const ref = svc.catalog.resolve(at as never, variant);
  try {
    return await svc.store.get(ref, { priority: 'idle', ...(signal ? { signal } : {}) });
  } catch (e) {
    if (e instanceof PackUnavailable && e.reason === 'hash-mismatch') {
      try {
        return await svc.store.reportDecodeFailure(ref, signal ? { signal } : {});
      } catch (e2) {
        svc.noteError(e2, ref);
        throw e2;
      }
    }
    svc.noteError(e, ref);
    throw e;
  }
}

export const pedJob: AssetJob = async (svc, raw, signal) => {
  const a = raw as PedJobArgs;
  const state = await svc.catalog.load();
  if (state !== 'ready') throw new Error(`catalog ${state}`);
  for (const at of a.refs) if (!(at in svc.catalog.refsWithPrefix(at, a.variant))) return { result: { missing: true } satisfies PedJobResult };
  const files: ArrayBuffer[] = [];
  // one at a time: the next file is asked for once the one before it is stored
  for (const at of a.refs) files.push((await readOne(svc, at, a.variant, signal)).slice(0));
  return { result: { files } satisfies PedJobResult, transfer: files };
};
