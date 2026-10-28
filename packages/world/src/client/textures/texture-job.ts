/**
 * `world.texture`, the asset.worker job of the surface textures (M10d0): reads the tier's variant of one `texture/pbr.<set>.<map>`
 * asset through the pack store (so it is hashed, cached in OPFS and counted like every other pack) and returns the bytes transferred.
 * The KTX2 transcoding runs on the page thread's loader workers, which need the renderer's format support; this job only fetches.
 * No `three` import.
 */
import { PackUnavailable } from '@dv/engine/assets/types';
import type { AssetJob } from '@dv/engine/assets/service';
import type { QualityTierId } from '@dv/shared';

export interface TextureJobArgs {
  /** `texture/pbr.<set>.<map>` */
  ref: string;
  tier: QualityTierId;
}

export type TextureJobResult = { bytes: ArrayBuffer } | { missing: true };

export const textureJob: AssetJob = async (svc, raw, signal) => {
  const a = raw as TextureJobArgs;
  const state = await svc.catalog.load();
  if (state !== 'ready') throw new Error(`catalog ${state}`);
  // A catalog from before the texture sets has none of them: the surfaces stay procedural.
  if (!(a.ref in svc.catalog.refsWithPrefix(a.ref, a.tier))) return { result: { missing: true } satisfies TextureJobResult };
  const ref = svc.catalog.resolve(a.ref as never, a.tier);
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
  return { result: { bytes } satisfies TextureJobResult, transfer: [bytes] };
};
