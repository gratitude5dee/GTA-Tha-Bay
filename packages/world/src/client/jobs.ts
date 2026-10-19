/**
 * The world's jobs for asset.worker (M02b1), registered by `apps/web/src/workers/asset.worker.ts` through `runAssetWorker(scope, jobs)`.
 * Everything here runs in the worker: pack decoding, meshing, the DEM ring and the sim pack channel. No `three`.
 *
 *   world.attach  hands over one end of the sim pack channel (DL-678): requests `{seq, ref, priority}` come in, the bytes of the
 *                 pack go back transferred, or `{seq, error}`. A hash mismatch purges the cached pack and fetches it once more.
 *   world.refs    `PackRef` of every `world_pack/<family>-*` of the catalog, for the sim's request table.
 *   world.mesh    meshes one L0 chunk, L1 tile or L2 block and returns its buffers (transferred).
 *   world.far     the backdrop: the ring mesh, the massing instances or the card atlas bytes.
 */
import { PackUnavailable, type PackRef as StorePackRef } from '@dv/engine/assets/types';
import type { AssetJob, AssetService } from '@dv/engine/assets/service';
import {
  ancestorKey, decodeFarDem, decodeFarMassing, decodeL0, decodeLod, decodeP0, packRefOf, parseChunkKey,
  type ChunkKey, type FarDem, type LodUnit, type QualityTierId, type RenderChunk, type SimChunk,
} from '@dv/shared';
import type { PackErrorReason, PackReply, PackRequest } from '../sim/streaming/channel.ts';
import { basePlan } from '../sim/streaming/plan.ts';
import { massingInstances, ringMesh } from './backdrop/far-mesh.ts';
import { meshLod } from './chunks/lod-mesher.ts';
import { meshChunk } from './chunks/mesher.ts';
import { transferListOf, type UnitMesh } from './chunks/mesh-types.ts';

// ---- plain pack reads ------------------------------------------------------------------------------------------------------

type Prio = 'now' | 'soon' | 'idle';

/** Reads one pack through the store; a hash mismatch purges and fetches once more (02-world.md 5.6). */
async function readPack(svc: AssetService, asset: string, tier: QualityTierId, priority: Prio, signal?: AbortSignal): Promise<ArrayBuffer> {
  const state = await svc.catalog.load();
  if (state !== 'ready') throw new Error(`catalog ${state}`);
  const ref = svc.catalog.resolve(asset as never, tier);
  try {
    return await svc.store.get(ref, { priority, ...(signal ? { signal } : {}) });
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

/** Decodes with one purge-and-refetch on a decode failure. */
async function readDecoded<T>(svc: AssetService, asset: string, tier: QualityTierId, priority: Prio, decode: (b: ArrayBuffer) => T, signal?: AbortSignal): Promise<T> {
  const bytes = await readPack(svc, asset, tier, priority, signal);
  try {
    return decode(bytes);
  } catch {
    const ref = svc.catalog.resolve(asset as never, tier);
    const again = await svc.store.reportDecodeFailure(ref, signal ? { signal } : {});
    try {
      return decode(again);
    } catch (e) {
      const err = new Error(`${asset}: ${e instanceof Error ? e.message : String(e)}`);
      err.name = 'DecodeError';
      svc.noteError(new PackUnavailable('hash-mismatch', ref), ref);
      throw err;
    }
  }
}

// ---- decoded-tile caches ------------------------------------------------------------------------------------------------------

/** A tiny LRU keyed by string; a mesh job for the 16 chunks of one tile decodes the tile once. */
class Lru<V> {
  private readonly m = new Map<string, V>();
  constructor(private readonly cap: number) {}
  get(k: string): V | undefined {
    const v = this.m.get(k);
    if (v !== undefined) {
      this.m.delete(k);
      this.m.set(k, v);
    }
    return v;
  }
  set(k: string, v: V): void {
    this.m.delete(k);
    this.m.set(k, v);
    while (this.m.size > this.cap) this.m.delete(this.m.keys().next().value as string);
  }
  delete(k: string): boolean {
    return this.m.delete(k);
  }
  clear(): void {
    this.m.clear();
  }
}

interface L0Tile {
  sim: SimChunk[];
  render: RenderChunk[];
}

class WorldCache {
  readonly l0 = new Lru<Promise<L0Tile>>(3);
  readonly lod = new Lru<Promise<LodUnit[]>>(3);
  readonly dem = new Lru<Promise<FarDem>>(1);
}
const caches = new WeakMap<AssetService, WorldCache>();
const cacheOf = (svc: AssetService): WorldCache => {
  let c = caches.get(svc);
  if (!c) {
    c = new WorldCache();
    caches.set(svc, c);
  }
  return c;
};

const errorReason = (e: unknown): PackErrorReason =>
  e instanceof PackUnavailable ? e.reason : 'other';

// ---- the jobs --------------------------------------------------------------------------------------------------------------------

interface PortLike {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

const attach: AssetJob = (svc, args) => {
  const port = (args as { port?: PortLike }).port;
  if (!port) return Promise.reject(new Error('world.attach needs a port'));
  port.onmessage = (ev) => {
    const req = ev.data as PackRequest;
    const ref = req.ref as StorePackRef;
    void (async () => {
      try {
        let bytes: ArrayBuffer;
        if (req.refetch) {
          bytes = await svc.store.reportDecodeFailure(ref);
        } else {
          try {
            bytes = await svc.store.get(ref, { priority: req.priority });
          } catch (e) {
            if (!(e instanceof PackUnavailable) || e.reason !== 'hash-mismatch') throw e;
            bytes = await svc.store.reportDecodeFailure(ref);
          }
        }
        const reply: PackReply = { seq: req.seq, bytes };
        port.postMessage(reply, [bytes]);
      } catch (e) {
        svc.noteError(e, ref);
        const reply: PackReply = { seq: req.seq, error: { reason: errorReason(e), message: e instanceof Error ? e.message : String(e) } };
        port.postMessage(reply);
      }
    })();
  };
  return Promise.resolve({ result: null });
};

const refs: AssetJob = async (svc, args) => {
  const a = args as { prefix: string; tier: QualityTierId };
  const state = await svc.catalog.load();
  if (state !== 'ready') throw new Error(`catalog ${state}`);
  return { result: svc.catalog.refsWithPrefix(a.prefix, a.tier) };
};

export interface MeshJobArgs {
  level: 'l0' | 'l1' | 'l2';
  key: ChunkKey;
  tier: QualityTierId;
  /** Distance of the unit centre from the stream focus when requested (the profile's skip rule). */
  distM: number;
  priority?: Prio;
}
export type MeshJobResult = { mesh: UnitMesh } | { empty: true };

/**
 * Drops a failed read from its cache so a later request reads it again. A pack whose hash is wrong stays for a few seconds, so the
 * sixteen chunks of one tile that ask for it in a row fail at once instead of fetching it sixteen times.
 */
const CORRUPT_MEMORY_MS = 8000;
function forgetAfterFailure(p: Promise<unknown>, forget: () => unknown): void {
  p.catch((e: unknown) => {
    if (e instanceof PackUnavailable && e.reason === 'hash-mismatch') setTimeout(forget, CORRUPT_MEMORY_MS);
    else forget();
  });
}

async function l0Tile(svc: AssetService, tileX: number, tileY: number, tier: QualityTierId, priority: Prio, signal: AbortSignal): Promise<L0Tile> {
  const cache = cacheOf(svc);
  const id = `${tileX}-${tileY}`;
  let p = cache.l0.get(id);
  if (!p) {
    p = (async () => {
      const sim = await readDecoded(svc, `world_pack/p0-${id}`, tier, priority, (b) => decodeP0(b), signal);
      const render = await readDecoded(svc, `world_pack/l0-${id}`, tier, priority, (b) => decodeL0(b, sim), signal);
      return { sim, render };
    })();
    forgetAfterFailure(p, () => cache.l0.get(id) === p && cache.l0.delete(id));
    cache.l0.set(id, p);
  }
  return p;
}

const mesh: AssetJob = async (svc, raw, signal) => {
  const a = raw as MeshJobArgs;
  const priority = a.priority ?? (a.level === 'l0' ? 'soon' : 'idle');
  let m: UnitMesh | null = null;
  if (a.level === 'l0') {
    const host = parseChunkKey(ancestorKey(a.key, 7));
    if (!host) throw new Error(`bad chunk key ${a.key}`);
    const tile = await l0Tile(svc, host.x, host.y, a.tier, priority, signal);
    const sim = tile.sim.find((c) => c.key === a.key);
    if (!sim) return { result: { empty: true } satisfies MeshJobResult };
    m = meshChunk(sim, tile.render.find((c) => c.key === a.key) ?? null, { tier: a.tier, distM: a.distM, maxBytes: basePlan(a.tier).uploadBytes });
  } else {
    const packRef = packRefOf(a.key, a.level);
    const cache = cacheOf(svc);
    let p = cache.lod.get(packRef);
    if (!p) {
      p = readDecoded(svc, packRef, a.tier, priority, (b) => decodeLod(b), signal);
      forgetAfterFailure(p, () => cache.lod.get(packRef) === p && cache.lod.delete(packRef));
      cache.lod.set(packRef, p);
    }
    const unit = (await p).find((u) => u.key === a.key);
    if (!unit) return { result: { empty: true } satisfies MeshJobResult };
    m = meshLod(unit, a.tier, basePlan(a.tier).uploadBytes);
  }
  return { result: { mesh: m } satisfies MeshJobResult, transfer: transferListOf(m) };
};

export interface FarJobArgs {
  name: 'ring' | 'massing' | 'cards';
  tier: QualityTierId;
  ringStride?: 1 | 2 | 4;
}

const far: AssetJob = async (svc, raw, signal) => {
  const a = raw as FarJobArgs;
  const cache = cacheOf(svc);
  const dem = async (): Promise<FarDem> => {
    let p = cache.dem.get('dem');
    if (!p) {
      p = readDecoded(svc, 'world_pack/far-bay-dem', a.tier, 'soon', (b) => decodeFarDem(b), signal);
      p.catch(() => cache.dem.clear());
      cache.dem.set('dem', p);
    }
    return p;
  };
  if (a.name === 'ring') {
    const r = ringMesh(await dem(), a.ringStride ?? 1);
    const b = r.buffers;
    return { result: r, transfer: [b.positions.buffer as ArrayBuffer, b.normals.buffer as ArrayBuffer, b.colors.buffer as ArrayBuffer, b.ao.buffer as ArrayBuffer, b.indices.buffer as ArrayBuffer] };
  }
  if (a.name === 'massing') {
    const m = await readDecoded(svc, 'world_pack/far-bay-massing', a.tier, 'soon', (b) => decodeFarMassing(b), signal);
    const inst = massingInstances(m, await dem().catch(() => null));
    return { result: inst, transfer: [inst.matrices.buffer as ArrayBuffer] };
  }
  const png = await readPack(svc, 'texture/far-bay-cards', a.tier, 'soon', signal);
  return { result: { png }, transfer: [png] };
};

/** The jobs of the world, by name. */
export const worldJobs: Readonly<Record<string, AssetJob>> = {
  'world.attach': attach,
  'world.refs': refs,
  'world.mesh': mesh,
  'world.far': far,
};
