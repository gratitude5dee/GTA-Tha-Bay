/**
 * `world.ped`, the asset.worker job of the pedestrian kit (M10d4): reads one `character/ped.*`, `prop/ped.far.*` or `texture/ped.atlas`
 * asset at the variant of a tier through the pack store (hashed, cached in OPFS, counted like every pack) and returns its bytes
 * transferred. The kit parses them on the page (`kit.ts`, `person-glb.ts`). A catalog from before the kit has none of them: the job
 * answers `missing` and the renderer keeps the mannequin. No `three` import.
 */
import { PackUnavailable } from '@dv/engine/assets/types';
import type { AssetJob } from '@dv/engine/assets/service';

export interface PedJobArgs {
  /** `character/ped.body.a`, `character/ped.outfit.01`, `prop/ped.far.a` or `texture/ped.atlas` */
  ref: string;
  /** The variant to read (also the tier id the catalog resolves). */
  variant: 'desktop' | 'mobile' | 'mobile-low';
}

export type PedJobResult = { bytes: ArrayBuffer } | { missing: true };

export const pedJob: AssetJob = async (svc, raw, signal) => {
  const a = raw as PedJobArgs;
  const state = await svc.catalog.load();
  if (state !== 'ready') throw new Error(`catalog ${state}`);
  if (!(a.ref in svc.catalog.refsWithPrefix(a.ref, a.variant))) return { result: { missing: true } satisfies PedJobResult };
  const ref = svc.catalog.resolve(a.ref as never, a.variant);
  let bytes: ArrayBuffer;
  try {
    bytes = await svc.store.get(ref, { priority: 'idle', ...(signal ? { signal } : {}) });
  } catch (e) {
    if (e instanceof PackUnavailable && e.reason === 'hash-mismatch') {
      try {
        bytes = await svc.store.reportDecodeFailure(ref, signal ? { signal } : {});
      } catch (e2) {
        svc.noteError(e2, ref);
        throw e2;
      }
    } else {
      svc.noteError(e, ref);
      throw e;
    }
  }
  const copy = bytes.slice(0);
  return { result: { bytes: copy } satisfies PedJobResult, transfer: [copy] };
};
