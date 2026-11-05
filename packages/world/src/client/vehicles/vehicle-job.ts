/**
 * `world.vehicle`, the asset.worker job of the vehicle and prop models (M10d1): reads one `vehicle/...` or `prop/...` asset at the
 * variant of a tier through the pack store (hashed, cached in OPFS, counted like every pack), decodes it (`art-glb.ts`) and returns the
 * model with its buffers transferred. No `three` import.
 */
import { PackUnavailable } from '@dv/engine/assets/types';
import type { AssetJob } from '@dv/engine/assets/service';
import { artTransferList, type ArtModelData } from '@dv/engine/client/vehicle/art-model';
import type { QualityTierId } from '@dv/shared';
import { readArtGlb } from './art-glb.ts';

/** The variant of the models a tier draws: the desktop tiers `desktop`, mobile `mobile`, mobile-low and the XR tiers `mobile-low`. */
export function artVariantOf(tier: QualityTierId): 'desktop' | 'mobile' | 'mobile-low' {
  if (tier === 'desktop' || tier === 'desktop-ultra') return 'desktop';
  if (tier === 'mobile') return 'mobile';
  return 'mobile-low';
}

export interface VehicleJobArgs {
  /** `vehicle/traffic.sedan` */
  ref: string;
  /** The variant to read; it is also the tier id the catalog resolves (`desktop`, `mobile` and `mobile-low` are tier ids). */
  variant: 'desktop' | 'mobile' | 'mobile-low';
  /** Keep the model's nodes in the file's own +Z-forward frame. Default false: the engine's -Z. */
  noFlip?: boolean;
}

export type VehicleJobResult = { model: ArtModelData } | { missing: true };

export const vehicleJob: AssetJob = async (svc, raw, signal) => {
  const a = raw as VehicleJobArgs;
  const state = await svc.catalog.load();
  if (state !== 'ready') throw new Error(`catalog ${state}`);
  // A catalog from before the art has none of them: the stand-ins stay.
  if (!(a.ref in svc.catalog.refsWithPrefix(a.ref, a.variant))) return { result: { missing: true } satisfies VehicleJobResult };
  const ref = svc.catalog.resolve(a.ref as never, a.variant);
  let bytes: ArrayBuffer;
  try {
    bytes = await svc.store.get(ref, { priority: 'soon', ...(signal ? { signal } : {}) });
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
  const opts = { flip: a.noFlip !== true };
  let model: ArtModelData;
  try {
    model = await readArtGlb(bytes, opts);
  } catch {
    const again = await svc.store.reportDecodeFailure(ref, signal ? { signal } : {});
    try {
      model = await readArtGlb(again, opts);
    } catch (e) {
      const err = new Error(`${a.ref}: ${e instanceof Error ? e.message : String(e)}`);
      err.name = 'DecodeError';
      throw err;
    }
  }
  return { result: { model } satisfies VehicleJobResult, transfer: artTransferList(model) };
};
