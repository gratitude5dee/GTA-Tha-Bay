import { describe, expect, it } from 'vitest';
import type { AssetCatalog, AssetManifest } from '@dv/shared/assets';
import { AssetClient, type WorkerPort } from '../../src/assets/client.ts';
import { AssetService, memoryPorts } from '../../src/assets/service.ts';
import type { FromWorker, ToWorker } from '../../src/assets/rpc.ts';
import { handleQa } from '../../src/assets/qa-ops.ts';
import { sha256Hex } from '../../src/assets/store/store.ts';
import { PackUnavailable } from '../../src/assets/store/types.ts';
import { bytesOf } from './helpers.ts';

const enc = new TextEncoder();

interface World {
  client: AssetClient;
  svc: AssetService;
  requests: string[];
  events: Array<{ reason: string; kind: string }>;
  packRef: string;
  bytes: Uint8Array;
  sha: string;
}

async function world(): Promise<World> {
  const bytes = bytesOf(9, 20_000);
  const sha = await sha256Hex(bytes);
  const entry: AssetManifest = {
    schema: 'asset/1',
    id: 'p0-64-64',
    kind: 'world_pack',
    rev: 1,
    variants: { default: { key: `assets/world_pack/p0-64-64/default.${sha.slice(0, 12)}.pack`, sha256: sha, bytes: bytes.byteLength, contentType: 'application/octet-stream', encoding: 'identity' } },
    deps: [],
    provenance: { root: sha, origin: 'authored', license: 'LicenseRef-DeeVerse-Owned', aiGenerated: false },
    status: 'active',
    visibility: 'public',
    tags: ['fixture'],
  };
  const catalog: AssetCatalog = { schema: 'asset-catalog/1', c07: '1.1.0', buildId: 'b', gitSha: '0'.repeat(40), createdAt: 0, entries: { 'world_pack/p0-64-64': entry } };
  const cbytes = enc.encode(JSON.stringify(catalog));
  const csha = await sha256Hex(cbytes);
  const pointer = { schema: 'asset-catalog-pointer/1', sha256: csha, key: `manifests/assets-${csha}.json`, bytes: cbytes.byteLength };
  const requests: string[] = [];
  const fetchFn = (url: string): Promise<Response> => {
    requests.push(url);
    if (url.endsWith('/api/v1/boot')) return Promise.resolve(Response.json({ hosts: { media: 'https://media.test' } }));
    if (url.endsWith('/asset-catalog.json')) return Promise.resolve(Response.json(pointer));
    if (url === `https://media.test/${pointer.key}`) return Promise.resolve(new Response(cbytes as BodyInit));
    if (url === `https://media.test/${entry.variants.default?.key}`) return Promise.resolve(new Response(bytes as BodyInit));
    return Promise.resolve(new Response(null, { status: 404 }));
  };

  let toClient: ((m: FromWorker) => void) | null = null;
  const svc = new AssetService({
    post: (m) => queueMicrotask(() => toClient?.(m)),
    makePorts: () => Promise.resolve(memoryPorts()),
    fetch: fetchFn,
    channel: null,
    tabId: 't',
    sleep: () => Promise.resolve(),
    qa: handleQa,
  });
  const port: WorkerPort = {
    postMessage: (m: ToWorker) => void svc.handle(m),
    onmessage: null,
  };
  toClient = (m) => port.onmessage?.({ data: m });
  const client = await AssetClient.start(port, { origin: 'https://app.test', localMedia: null, mobileOrXr: false }, { tier: () => 'desktop' });
  return { client, svc, requests, events: client.errLog, packRef: 'world_pack/p0-64-64', bytes, sha };
}

describe('AssetClient over AssetService (in-process loopback)', () => {
  it('opens, loads the catalog lazily, serves a pack once from the network and then from the store', async () => {
    const w = await world();
    expect(w.client.storeKind).toBe('memory-fallback');
    expect(w.client.mode).toBe('rw');
    expect(w.client.catalogState).toBe('idle');
    expect(w.requests).toHaveLength(0);

    const buf = await w.client.get(w.packRef, { priority: 'now' });
    expect(new Uint8Array(buf)).toEqual(w.bytes);
    expect(await w.client.loadCatalog()).toBe('ready');
    await w.client.get(w.packRef);
    expect(await w.client.stats()).toMatchObject({ network: 1, hits: 1, retries: 0 });
    expect(await w.client.has(w.packRef)).toBe(true);
    expect(await w.client.has(w.sha)).toBe(true);
    expect((await w.client.usage()).packs).toBe(1);
  });

  it('every reply carries the network bytes so far: bytesSeen is current when the result is used, with no stats round trip (BD-FIX-CI9-T01)', async () => {
    const w = await world();
    expect(w.client.bytesSeen).toBe(0);
    // the reply that hands over the pack already counts its bytes (and the catalog fetched on the way)
    const seenAtResult = await w.client.get(w.packRef, { priority: 'now' }).then(() => w.client.bytesSeen);
    const { bytes } = await w.client.stats();
    expect(bytes).toBeGreaterThanOrEqual(w.bytes.byteLength);
    expect(seenAtResult).toBe(bytes);
    // a store hit downloads nothing: the count stays
    await w.client.get(w.packRef);
    expect(w.client.bytesSeen).toBe(bytes);
    // a failed request carries the count too
    await expect(w.client.get('world_pack/none')).rejects.toThrow();
    expect(w.client.bytesSeen).toBe(bytes);
  });

  it('a PackRef with a wrong hash rejects with hash-mismatch and usage is unchanged', async () => {
    const w = await world();
    const ref = await w.client.resolve(w.packRef);
    await expect(w.client.get({ ...ref, sha256: '0'.repeat(64) })).rejects.toMatchObject({ name: 'PackUnavailable', reason: 'hash-mismatch' });
    expect((await w.client.usage()).packs).toBe(0);
    expect(w.events).toEqual([{ reason: 'hash-mismatch', kind: 'chunk' }]);
  });

  it('injected 503s: three give retries 3; eight reject with http and queue err.asset', async () => {
    const w = await world();
    await w.client.qa('injectFaults', { status: 503, times: 3, match: '/assets/' });
    await w.client.get(w.packRef);
    expect((await w.client.stats()).retries).toBe(3);

    await w.client.clear();
    await w.client.qa('injectFaults', { status: 503, times: 8, match: '/assets/' });
    await expect(w.client.get(w.packRef)).rejects.toMatchObject({ reason: 'http' });
    expect(w.events.at(-1)).toEqual({ reason: 'http', kind: 'chunk' });
  });

  it('err.asset is capped at 5 per reason per session', async () => {
    const w = await world();
    const ref = await w.client.resolve(w.packRef);
    for (let i = 0; i < 9; i++) await w.client.get({ ...ref, sha256: String(i).repeat(64).slice(0, 64) }).catch((e: unknown) => e);
    expect(w.events.filter((e) => e.reason === 'hash-mismatch')).toHaveLength(5);
  });

  it('pin, soft cap, evictByTag and clear work through the RPC; reopen with memory returns memory-fallback and get still works', async () => {
    const w = await world();
    await w.client.get(w.packRef);
    await w.client.pin([w.packRef]);
    await w.client.qa('settled');
    expect(((await w.client.qa('rows')) as Array<{ pinned: boolean }>)[0]?.pinned).toBe(true);
    expect(await w.client.evictByTag('fixture')).toEqual({ removed: 1 });
    expect((await w.client.usage()).packs).toBe(0);
    expect(await w.client.qa('reopen', { force: 'memory' })).toBe('memory-fallback');
    expect(new Uint8Array(await w.client.get(w.packRef))).toEqual(w.bytes);
    await w.client.clear();
    expect((await w.client.usage()).packs).toBe(0);
  });

  it('pinHashes (what an asset job pins, M02d2) pins the pack like the pin RPC and survives a reopen of the store', async () => {
    const w = await world();
    await w.client.get(w.packRef);
    w.svc.pinHashes([w.sha]);
    await w.client.qa('settled');
    expect(((await w.client.qa('rows')) as Array<{ pinned: boolean }>)[0]?.pinned).toBe(true);
    // a rebuilt store gets the pins again
    expect(await w.client.qa('reopen', { force: 'memory' })).toBe('memory-fallback');
    await w.client.get(w.packRef);
    await w.client.qa('settled');
    expect(((await w.client.qa('rows')) as Array<{ pinned: boolean }>)[0]?.pinned).toBe(true);
  });

  it('writeOrphan leaves a file without a row that reopen deletes', async () => {
    const w = await world();
    const sha = 'a'.repeat(64);
    await w.client.qa('writeOrphan', { sha });
    expect(await w.client.qa('files')).toContain(sha);
    await w.client.qa('reopen', {});
    expect(await w.client.qa('files')).not.toContain(sha);
  });

  it('downloadAll reports progress; an unknown ref gives an error with a name', async () => {
    const w = await world();
    const progress: Array<[number, number]> = [];
    await w.client.downloadAll((d, t) => progress.push([d, t]));
    expect(progress.at(-1)).toEqual([1, 1]);
    const err = await w.client.get('texture/nope').catch((e: unknown) => e);
    expect((err as Error).name).toBe('AssetNotFound');
    expect(err).not.toBeInstanceOf(PackUnavailable);
  });

  it('without a qa handler the qa op is refused', async () => {
    let toClient: ((m: FromWorker) => void) | null = null;
    const svc = new AssetService({ post: (m) => queueMicrotask(() => toClient?.(m)), makePorts: () => Promise.resolve(memoryPorts()), fetch: () => Promise.reject(new Error('x')), channel: null, tabId: 't' });
    const port: WorkerPort = { postMessage: (m) => void svc.handle(m), onmessage: null };
    toClient = (m) => port.onmessage?.({ data: m });
    const c = await AssetClient.start(port, { origin: 'https://app.test', localMedia: null, mobileOrXr: true }, { tier: () => 'mobile' });
    await expect(c.qa('files')).rejects.toThrow('not-supported');
    expect(await c.loadCatalog()).toBe('disabled');
  });
});
