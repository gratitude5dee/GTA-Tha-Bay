/**
 * The world's asset.worker jobs (M02b1) against a stand-in service that serves the synth bake: `world.mesh` for an L0 chunk, an L1
 * tile and an L2 block (and `empty` for a unit not in its pack), `world.far`, `world.refs`, and the sim pack channel `world.attach`
 * with its failure handling (a wrong hash is purged and fetched once more, then the error reaches the sim; an unavailable pack
 * reports `offline` or `http`).
 */
import { readFileSync } from 'node:fs';
import { MessageChannel } from 'node:worker_threads';
import { PackUnavailable } from '@dv/engine/assets/types';
import type { AssetService } from '@dv/engine/assets/service';
import { decodeP0, type ChunkKey } from '@dv/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { worldJobs, type MeshJobResult } from '../src/client/jobs.ts';
import type { PackReply } from '../src/sim/streaming/channel.ts';
import { requireBake } from '../../../tests/support/require-bake.ts';

const bake = requireBake('synth', 'jobs.spec synth bake');

interface Fakes {
  svc: AssetService;
  gets: string[];
  refetches: string[];
  errors: unknown[];
  /** Behaviour of the next `get` calls, per asset name substring: 'hash' fails once with a hash mismatch, 'offline' always. */
  fail: Map<string, 'hash' | 'hash-twice' | 'offline' | 'http'>;
}

function fakes(dir: string): Fakes {
  const gets: string[] = [];
  const refetches: string[] = [];
  const errors: unknown[] = [];
  const fail = new Map<string, 'hash' | 'hash-twice' | 'offline' | 'http'>();
  const bytesOf = (url: string): ArrayBuffer => {
    const name = url.replace(/^asset:/, '');
    const file = name === 'texture/far-bay-cards' ? 'far-bay-cards.png' : `${name.replace('world_pack/', '')}.pack`;
    const b = readFileSync(`${dir}/packs/${file}`);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  };
  const svc = {
    catalog: {
      load: async () => 'ready',
      resolve: (ref: string) => ({ url: `asset:${ref}`, sha256: ref, bytes: 0, kind: 'chunk' as const }),
      refsWithPrefix: (prefix: string) => ({ [`${prefix}64-64`]: { url: `asset:${prefix}64-64`, sha256: 'x', bytes: 1, kind: 'chunk' } }),
    },
    store: {
      get: async (ref: { url: string; sha256: string }) => {
        gets.push(ref.sha256);
        for (const [needle, mode] of fail) {
          if (!ref.sha256.includes(needle)) continue;
          if (mode === 'offline') throw new PackUnavailable('offline', ref as never);
          if (mode === 'http') throw new PackUnavailable('http', ref as never);
          throw new PackUnavailable('hash-mismatch', ref as never);
        }
        return bytesOf(ref.url);
      },
      reportDecodeFailure: async (ref: { url: string; sha256: string }) => {
        refetches.push(ref.sha256);
        const mode = [...fail.entries()].find(([needle]) => ref.sha256.includes(needle))?.[1];
        if (mode === 'hash-twice') throw new PackUnavailable('hash-mismatch', ref as never);
        return bytesOf(ref.url);
      },
    },
    noteError: (e: unknown) => void errors.push(e),
  } as unknown as AssetService;
  return { svc, gets, refetches, errors, fail };
}

const signal = new AbortController().signal;
const mesh = (f: Fakes, level: 'l0' | 'l1' | 'l2', key: ChunkKey, tier: 'desktop' | 'mobile-low' = 'desktop'): Promise<MeshJobResult> =>
  (worldJobs['world.mesh'] as NonNullable<(typeof worldJobs)[string]>)(f.svc, { level, key, tier, distM: 0 }, signal).then((r) => r.result as MeshJobResult);

describe('world.mesh', () => {
  it('meshes an L0 chunk from p0 and l0 (decoded once per tile), an L1 tile and an L2 block', async () => {
    if (!bake) return;
    const f = fakes(bake.dir);
    const a = await mesh(f, 'l0', '9/256/256');
    const b = await mesh(f, 'l0', '9/256/257');
    expect('mesh' in a && a.mesh.level).toBe('l0');
    expect('mesh' in b && b.mesh.key).toBe('9/256/257');
    // Two chunks of one tile: p0 and l0 of the tile were read once each.
    expect(f.gets.filter((g) => g === 'world_pack/p0-64-64')).toHaveLength(1);
    expect(f.gets.filter((g) => g === 'world_pack/l0-64-64')).toHaveLength(1);
    const l1 = await mesh(f, 'l1', '7/64/64');
    expect('mesh' in l1 && l1.mesh.objects.length).toBeGreaterThan(0);
    const l2 = await mesh(f, 'l2', '5/16/16');
    expect('mesh' in l2 && l2.mesh.level).toBe('l2');
  });

  it('answers empty for a unit that is not in its pack and applies the 2 MB cap of mobile-low', async () => {
    if (!bake) return;
    const f = fakes(bake.dir);
    // A chunk of tile 64-64 that the pack does not carry (its tile covers 4 x 4 chunks at z=9).
    const have = new Set(decodeP0(new Uint8Array(readFileSync(`${bake.dir}/packs/p0-64-64.pack`))).map((c) => c.key));
    const missing = [0, 1, 2, 3].flatMap((i) => [0, 1, 2, 3].map((j) => `9/${256 + i}/${256 + j}` as ChunkKey)).find((k) => !have.has(k));
    if (missing) expect(await mesh(f, 'l0', missing)).toEqual({ empty: true });
    const dense = await mesh(f, 'l0', '9/256/256', 'mobile-low');
    expect('mesh' in dense && dense.mesh.stats.bytes).toBeLessThanOrEqual(2 * 1024 * 1024);
  });

  it('a wrong hash is purged and fetched once more; a second wrong hash is an error and is counted', async () => {
    if (!bake) return;
    const f = fakes(bake.dir);
    f.fail.set('p0-64-64', 'hash');
    const ok = await mesh(f, 'l0', '9/256/256');
    expect('mesh' in ok).toBe(true);
    expect(f.refetches).toContain('world_pack/p0-64-64');
    const g = fakes(bake.dir);
    g.fail.set('p0-64-64', 'hash-twice');
    await expect(mesh(g, 'l0', '9/256/256')).rejects.toMatchObject({ name: 'PackUnavailable', reason: 'hash-mismatch' });
    expect(g.errors.length).toBeGreaterThan(0);
  });
});

describe('world.far, world.refs', () => {
  it('returns the ring, the massing instances and the card atlas bytes', async () => {
    if (!bake) return;
    const f = fakes(bake.dir);
    const far = worldJobs['world.far'] as NonNullable<(typeof worldJobs)[string]>;
    const ring = (await far(f.svc, { name: 'ring', tier: 'desktop' }, signal)).result as { buffers: { positions: Float32Array } };
    expect(ring.buffers.positions.length).toBeGreaterThan(1000);
    const massing = (await far(f.svc, { name: 'massing', tier: 'desktop' }, signal)).result as { count: number };
    expect(massing.count).toBeGreaterThan(100);
    const cards = (await far(f.svc, { name: 'cards', tier: 'mobile' }, signal)).result as { png: ArrayBuffer };
    // A PNG signature.
    expect(Array.from(new Uint8Array(cards.png).slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    const refs = (await (worldJobs['world.refs'] as NonNullable<(typeof worldJobs)[string]>)(f.svc, { prefix: 'world_pack/p0-', tier: 'desktop' }, signal)).result as Record<string, unknown>;
    expect(Object.keys(refs)).toEqual(['world_pack/p0-64-64']);
  });
});

describe('world.attach (the sim pack channel)', () => {
  beforeAll(() => undefined);

  function open(f: Fakes): { sim: { postMessage(m: unknown): void; next(): Promise<PackReply>; close(): void } } {
    const ch = new MessageChannel();
    void (worldJobs['world.attach'] as NonNullable<(typeof worldJobs)[string]>)(f.svc, { port: ch.port1 }, signal);
    const queue: PackReply[] = [];
    const waiting: ((r: PackReply) => void)[] = [];
    ch.port2.on('message', (m: PackReply) => {
      const w = waiting.shift();
      if (w) w(m);
      else queue.push(m);
    });
    return {
      sim: {
        postMessage: (m) => ch.port2.postMessage(m),
        next: () => (queue.length ? Promise.resolve(queue.shift() as PackReply) : new Promise<PackReply>((r) => waiting.push(r))),
        close: () => {
          ch.port1.close();
          ch.port2.close();
        },
      },
    };
  }
  const ref = (name: string): { url: string; sha256: string; bytes: number; kind: 'chunk' } => ({ url: `asset:${name}`, sha256: name, bytes: 0, kind: 'chunk' });

  it('answers a request with the bytes of the pack and the same seq', async () => {
    if (!bake) return;
    const f = fakes(bake.dir);
    const { sim } = open(f);
    sim.postMessage({ seq: 7, ref: ref('world_pack/p0-64-64'), priority: 'now' });
    const r = await sim.next();
    expect(r.seq).toBe(7);
    expect('bytes' in r && r.bytes.byteLength).toBeGreaterThan(1000);
    sim.close();
  });

  it('purges and fetches once more on a wrong hash, and on a refetch request', async () => {
    if (!bake) return;
    const f = fakes(bake.dir);
    f.fail.set('p0-64-64', 'hash');
    const { sim } = open(f);
    sim.postMessage({ seq: 1, ref: ref('world_pack/p0-64-64'), priority: 'now' });
    const a = await sim.next();
    expect('bytes' in a).toBe(true);
    expect(f.refetches).toEqual(['world_pack/p0-64-64']);
    f.fail.clear();
    sim.postMessage({ seq: 2, ref: ref('world_pack/p0-64-64'), priority: 'now', refetch: true });
    const b = await sim.next();
    expect('bytes' in b).toBe(true);
    expect(f.refetches).toHaveLength(2);
    sim.close();
  });

  it('reports the reason when the pack cannot be had: offline, http, or a hash that stays wrong', async () => {
    if (!bake) return;
    const f = fakes(bake.dir);
    const { sim } = open(f);
    f.fail.set('p0-64-63', 'offline');
    sim.postMessage({ seq: 1, ref: ref('world_pack/p0-64-63'), priority: 'now' });
    expect(await sim.next()).toMatchObject({ seq: 1, error: { reason: 'offline' } });
    f.fail.set('p0-63-64', 'http');
    sim.postMessage({ seq: 2, ref: ref('world_pack/p0-63-64'), priority: 'soon' });
    expect(await sim.next()).toMatchObject({ seq: 2, error: { reason: 'http' } });
    f.fail.set('p0-63-63', 'hash-twice');
    sim.postMessage({ seq: 3, ref: ref('world_pack/p0-63-63'), priority: 'now' });
    expect(await sim.next()).toMatchObject({ seq: 3, error: { reason: 'hash-mismatch' } });
    expect(f.errors.length).toBe(3);
    sim.close();
  });
});
