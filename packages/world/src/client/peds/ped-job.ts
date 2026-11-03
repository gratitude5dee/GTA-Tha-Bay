/**
 * `world.ped`, the asset.worker job of the pedestrian kit (M10d4): reads a group of `character/ped.*`, `prop/ped.far.*` or `texture/ped.atlas`
 * assets at the variant of a tier through the pack store (hashed, cached in OPFS, counted like every pack) and returns their bytes
 * transferred. With `parse` (what the app sends, BD-REPAIR-M10d4-04) the people files are parsed here (`person-glb.ts`, as `world.vehicle`
 * decodes its models in this worker) and come back as typed arrays, transferred, so the page does no parse (36 main-thread tasks); with
 * `decode` the atlas page is decoded here (`createImageBitmap`) and comes back as a transferred `ImageBitmap`, or as its bytes when this
 * worker cannot decode it (no `createImageBitmap`, or one that rejects the file: the page then decodes it, as before). The files of a
 * group are read ONE AFTER ANOTHER in the `idle` lane, so the kit never holds more than one of the lane's two slots; one job per group
 * keeps the page's round trips to a few.
 *
 * A read carries a `token`; the page stops it with a second `world.ped` call `{ stop: token }` when the world gets busy (`art-gate.ts`).
 * The read then stops before its next file and answers the files it has, a prefix of `refs`; the file in flight stops waiting (the store
 * still caches its pack, so asking again later is a cache hit). The stop is a message of its own because the world view's job port does
 * not carry an `AbortSignal` to the worker (`boot-world.ts` forwards the name and the arguments only); the RPC's own abort stops a read
 * the same way (BD-REPAIR-M10d4-03). A catalog from before the kit has none of them: the job answers `missing` and the renderer keeps the
 * mannequin. No `three` import.
 */
import { PackUnavailable } from '@dv/engine/assets/types';
import type { AssetJob, AssetService } from '@dv/engine/assets/service';
import { parsePersonGlb, type PersonMesh } from '@dv/engine/client/avatar/person-glb';

export interface PedJobArgs {
  /** In order: `character/ped.body.a`, `character/ped.outfit.01`, `prop/ped.far.a` or `texture/ped.atlas`. */
  refs: string[];
  /** The variant to read (also the tier id the catalog resolves). */
  variant: 'desktop' | 'mobile' | 'mobile-low';
  /** Names the read for a later `{ stop: token }`. */
  token?: string;
  /** Parse each file here (people `.glb` files only) and answer `meshes` instead of `files`. */
  parse?: boolean;
  /** Decode each file here as an image (the atlas page) and answer `bitmaps` instead of `files` (when the worker decodes every file). */
  decode?: boolean;
}

/** Stops the read of `token` before its next file (a read that has ended, or never started, is not affected). */
export interface PedStopArgs {
  stop: string;
}

/**
 * `files` (or `meshes`, parsed, or `bitmaps`, decoded) in the order of `refs`: all of them, or the first ones when the read was stopped.
 * The worker never answers a null bitmap (it answers `files` then); the type keeps it for a port that does (the page draws untextured).
 */
export type PedJobResult =
  | { files: ArrayBuffer[] }
  | { meshes: PersonMesh[] }
  | { bitmaps: (ImageBitmap | null)[] }
  | { missing: true }
  | { stopped: boolean };

/** Every buffer a parsed mesh holds, once each (the transfer list of a `meshes` answer). */
export function personMeshTransfer(meshes: readonly PersonMesh[]): ArrayBuffer[] {
  const out = new Set<ArrayBuffer>();
  const add = (a: ArrayBufferView | null): void => {
    if (a && a.buffer instanceof ArrayBuffer) out.add(a.buffer);
  };
  for (const m of meshes) {
    for (const a of [m.position, m.normal, m.uv, m.ao, m.part, m.joints, m.weights, m.swing, m.pivot, m.index]) add(a);
    for (const t of m.targets) add(t.position);
  }
  return [...out];
}

/** Reads in flight by token, so that a stop finds them. */
const running = new Map<string, AbortController>();
/** Stops that arrived before their read started (bounded: a token is used once). */
const stoppedEarly = new Set<string>();
const STOPPED_EARLY_MAX = 64;

async function readOne(svc: AssetService, at: string, variant: PedJobArgs['variant'], signal: AbortSignal): Promise<ArrayBuffer> {
  const ref = svc.catalog.resolve(at as never, variant);
  try {
    return await svc.store.get(ref, { priority: 'idle', signal });
  } catch (e) {
    if (e instanceof PackUnavailable && e.reason === 'hash-mismatch') {
      try {
        return await svc.store.reportDecodeFailure(ref, { signal });
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
  if (typeof (raw as PedStopArgs).stop === 'string') {
    const token = (raw as PedStopArgs).stop;
    const read = running.get(token);
    if (read) read.abort();
    else {
      if (stoppedEarly.size >= STOPPED_EARLY_MAX) stoppedEarly.delete(stoppedEarly.values().next().value as string);
      stoppedEarly.add(token);
    }
    return { result: { stopped: read !== undefined } satisfies PedJobResult };
  }
  const a = raw as PedJobArgs;
  // registered before the first await, so a stop sent after this read always finds it
  const own = new AbortController();
  const onAbort = (): void => own.abort();
  if (signal?.aborted) own.abort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  if (a.token !== undefined) {
    if (stoppedEarly.delete(a.token)) own.abort();
    running.set(a.token, own);
  }
  try {
    const state = await svc.catalog.load();
    if (state !== 'ready') throw new Error(`catalog ${state}`);
    for (const at of a.refs) if (!(at in svc.catalog.refsWithPrefix(at, a.variant))) return { result: { missing: true } satisfies PedJobResult };
    const files: ArrayBuffer[] = [];
    // one at a time: the next file is asked for once the one before it is stored, and not at all once the read is stopped
    for (const at of a.refs) {
      if (own.signal.aborted) break;
      try {
        files.push((await readOne(svc, at, a.variant, own.signal)).slice(0));
      } catch (e) {
        if (own.signal.aborted) break;
        throw e;
      }
    }
    if (a.parse === true) {
      // a file that is not a people GLB throws here, so the page's load fails and the mannequin stays, as with a parse on the page
      const meshes = files.map((f) => parsePersonGlb(new Uint8Array(f)));
      return { result: { meshes } satisfies PedJobResult, transfer: personMeshTransfer(meshes) };
    }
    if (a.decode === true && typeof globalThis.createImageBitmap === 'function') {
      const bitmaps: (ImageBitmap | null)[] = [];
      for (const f of files) bitmaps.push(await createImageBitmap(new Blob([f], { type: 'image/png' })).catch(() => null));
      if (bitmaps.every((b) => b !== null)) return { result: { bitmaps } satisfies PedJobResult, transfer: bitmaps as ImageBitmap[] };
      // a page this worker cannot decode (a worker whose createImageBitmap takes no Blob): the bytes, so the page decodes them as before
      for (const b of bitmaps) b?.close();
    }
    return { result: { files } satisfies PedJobResult, transfer: files };
  } finally {
    if (a.token !== undefined && running.get(a.token) === own) running.delete(a.token);
    signal?.removeEventListener('abort', onAbort);
  }
};
