import { describe, expect, it } from 'vitest';
import type { AssetCatalog, AssetManifest, AssetVariant, CatalogPointer } from '@dv/shared/assets';
import { CatalogClient, packKindOf, type CatalogRetry } from '../../src/assets/store/catalog-client.ts';
import { sha256Hex } from '../../src/assets/store/store.ts';

const enc = new TextEncoder();

function variant(key: string, seed: number): AssetVariant {
  return { key, sha256: seed.toString(16).padStart(64, '0'), bytes: 100 + seed, contentType: 'image/png', encoding: 'identity' };
}

function manifest(id: string, kind: AssetManifest['kind'], variants: AssetManifest['variants'], tags: string[] = []): AssetManifest {
  return {
    schema: 'asset/1',
    id,
    kind,
    rev: 1,
    variants,
    deps: [],
    provenance: { root: '0'.repeat(64), origin: 'authored', license: 'LicenseRef-DeeVerse-Owned', aiGenerated: false },
    status: 'active',
    visibility: 'public',
    tags,
  };
}

const CATALOG: AssetCatalog = {
  schema: 'asset-catalog/1',
  c07: '1.1.0',
  buildId: 'abc',
  gitSha: '0'.repeat(40),
  createdAt: 0,
  entries: {
    'texture/asset-smoke': manifest('asset-smoke', 'texture', {
      'mobile-low': variant('assets/texture/asset-smoke/mobile-low.aaaaaaaaaaaa.png', 1),
      mobile: variant('assets/texture/asset-smoke/mobile.bbbbbbbbbbbb.png', 2),
      desktop: variant('assets/texture/asset-smoke/desktop.cccccccccccc.png', 3),
    }),
    'world_pack/p0-64-64': manifest('p0-64-64', 'world_pack', { default: variant('assets/world_pack/p0-64-64/default.dddddddddddd.pack', 4) }, ['fixture']),
    'texture/killed': { ...manifest('killed', 'texture', { default: variant('assets/texture/killed/default.eeeeeeeeeeee.png', 5) }), status: 'killed' },
  },
};

interface Served {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  requests: string[];
}

async function serve(opts: { pointer?: Partial<CatalogPointer>; hostsMedia?: string; local?: boolean; corruptCatalog?: boolean }): Promise<Served & { pointer: CatalogPointer }> {
  const catalogBytes = enc.encode(JSON.stringify(CATALOG));
  const sha = await sha256Hex(catalogBytes);
  const pointer: CatalogPointer = { schema: 'asset-catalog-pointer/1', sha256: sha, key: `manifests/assets-${sha}.json`, bytes: catalogBytes.byteLength, ...opts.pointer };
  const requests: string[] = [];
  const media = opts.hostsMedia ?? 'https://media.test';
  const fetchFn = (url: string): Promise<Response> => {
    requests.push(url);
    if (url === 'https://app.test/api/v1/boot') return Promise.resolve(Response.json({ hosts: { media } }));
    if (url === 'https://app.test/asset-catalog.json') return Promise.resolve(Response.json(pointer));
    if (opts.local && url === 'https://app.test/media-local/asset-catalog.json') return Promise.resolve(Response.json(pointer));
    const base = opts.local ? 'https://app.test/media-local' : media;
    if (url === `${base}/${pointer.key}`) {
      const body = opts.corruptCatalog ? enc.encode(JSON.stringify({ ...CATALOG, buildId: 'tampered' })) : catalogBytes;
      return Promise.resolve(new Response(body as BodyInit));
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  };
  return { fetch: fetchFn, requests, pointer };
}

describe('CatalogClient', () => {
  it('loads a valid catalog and resolves tiers through resolveVariant', async () => {
    const s = await serve({});
    const c = new CatalogClient({ fetch: s.fetch, origin: 'https://app.test', localMedia: null });
    expect(c.state).toBe('idle');
    expect(await c.load()).toBe('ready');
    expect(c.mediaBase).toBe('https://media.test');
    expect(c.resolve('texture/asset-smoke', 'mobile-low').url).toBe('https://media.test/assets/texture/asset-smoke/mobile-low.aaaaaaaaaaaa.png');
    expect(c.resolve('texture/asset-smoke', 'xr-quest').url).toBe('https://media.test/assets/texture/asset-smoke/mobile.bbbbbbbbbbbb.png');
    expect(c.resolve('texture/asset-smoke', 'desktop-ultra').url).toContain('/desktop.');
    const pack = c.resolve('world_pack/p0-64-64', 'mobile-low');
    expect(pack).toMatchObject({ kind: 'chunk', bytes: 104, tags: ['fixture'] });
    expect(pack.sha256).toBe(CATALOG.entries['world_pack/p0-64-64']?.variants.default?.sha256);
  });

  it('a pointer whose sha256 does not match the catalog bytes gives invalid, resolves nothing and fetches no pack', async () => {
    const s = await serve({ pointer: { sha256: 'f'.repeat(64) } });
    const c = new CatalogClient({ fetch: s.fetch, origin: 'https://app.test', localMedia: null });
    expect(await c.load()).toBe('invalid');
    expect(() => c.resolve('texture/asset-smoke', 'mobile-low')).toThrow(/no catalog/);
    expect(s.requests.some((u) => u.includes('/assets/'))).toBe(false);
  });

  it('a pointer with the wrong byte count, or tampered catalog bytes, is invalid too', async () => {
    const a = await serve({});
    const wrongBytes = await serve({ pointer: { bytes: a.pointer.bytes + 1 } });
    expect(await new CatalogClient({ fetch: wrongBytes.fetch, origin: 'https://app.test', localMedia: null }).load()).toBe('invalid');
    const tampered = await serve({ corruptCatalog: true });
    expect(await new CatalogClient({ fetch: tampered.fetch, origin: 'https://app.test', localMedia: null }).load()).toBe('invalid');
  });

  it('no media base gives disabled and never touches the network for packs', async () => {
    const s = await serve({ hostsMedia: '' });
    const c = new CatalogClient({ fetch: s.fetch, origin: 'https://app.test', localMedia: null });
    expect(await c.load()).toBe('disabled');
    expect(s.requests).toEqual(['https://app.test/api/v1/boot']);
  });

  it('an unreachable boot config or catalog gives disabled or unavailable', async () => {
    const down = (): Promise<Response> => Promise.reject(new TypeError('Failed to fetch'));
    expect(await new CatalogClient({ fetch: down, origin: 'https://app.test', localMedia: null }).load()).toBe('disabled');
    const s = await serve({});
    const half = (url: string): Promise<Response> => (url.includes('/manifests/') ? Promise.resolve(new Response(null, { status: 503 })) : s.fetch(url));
    expect(await new CatalogClient({ fetch: half, origin: 'https://app.test', localMedia: null }).load()).toBe('unavailable');
  });

  it('a QA build prefers the same-origin mirror and its pointer over hosts.media', async () => {
    const s = await serve({ local: true, hostsMedia: 'https://tha-bay-media.workers.dev' });
    const c = new CatalogClient({ fetch: s.fetch, origin: 'https://app.test', localMedia: '/media-local' });
    expect(await c.load()).toBe('ready');
    expect(c.mediaBase).toBe('https://app.test/media-local');
    expect(c.resolve('texture/asset-smoke', 'mobile').url.startsWith('https://app.test/media-local/assets/')).toBe(true);
    expect(s.requests.some((u) => u.includes('tha-bay-media'))).toBe(false);
  });

  it('falls back to hosts.media when the mirror is absent', async () => {
    const s = await serve({});
    const c = new CatalogClient({ fetch: s.fetch, origin: 'https://app.test', localMedia: '/media-local' });
    expect(await c.load()).toBe('ready');
    expect(c.mediaBase).toBe('https://media.test');
  });

  it('killed entries do not resolve; AssetSource hooks are consulted first; resolveAll skips what has no variant', async () => {
    const s = await serve({});
    const c = new CatalogClient({ fetch: s.fetch, origin: 'https://app.test', localMedia: null });
    await c.load();
    expect(() => c.resolve('texture/killed', 'desktop')).toThrow(/killed/);
    expect(() => c.resolve('texture/nope', 'desktop')).toThrow(/not in the catalog/);
    expect(c.sourceFor('texture/mod.123456789abc')).toBeNull();
    const source = { matches: (r: string) => r.includes('/mod.'), open: () => Promise.resolve(null) };
    c.registerSource(source);
    expect(c.sourceFor('texture/mod.123456789abc')).toBe(source);
    expect(c.sourceFor('texture/asset-smoke')).toBeNull();
    expect(c.resolveAll('mobile-low').map((p) => p.kind).sort()).toEqual(['chunk', 'tex']);
    expect(c.allHashes().size).toBe(3 + 1 + 1);
  });

  describe('the retry policy and the failure record (BD-FU-A01, BD-FU-A02)', () => {
    const sleeps: number[] = [];
    const retry = (online = true): CatalogRetry => ({
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      random: () => 0.5,
      online: () => online,
    });

    it('a catalog the media host answers 404 for is unavailable at once, with the status and the URL', async () => {
      sleeps.length = 0;
      const s = await serve({});
      const missing = (url: string): Promise<Response> => (url.includes('/manifests/') ? (s.requests.push(url), Promise.resolve(new Response('not found', { status: 404 }))) : s.fetch(url));
      const c = new CatalogClient({ fetch: missing, origin: 'https://app.test', localMedia: null, retry: retry() });
      expect(await c.load()).toBe('unavailable');
      expect(c.failure).toEqual({ stage: 'catalog', url: `https://media.test/${s.pointer.key}`, status: 404, offline: false });
      // A 4xx other than 429 is not retried (11-platform-pwa.md section 5).
      expect(s.requests.filter((u) => u.includes('/manifests/'))).toHaveLength(1);
      expect(sleeps).toEqual([]);
      c.reset();
      expect(c.failure).toBeNull();
    });

    it('5xx and 429 are retried up to 8 attempts with the fetch layer backoff, then recorded', async () => {
      sleeps.length = 0;
      const s = await serve({});
      let n = 0;
      const flaky = (url: string): Promise<Response> => (url.includes('/manifests/') ? Promise.resolve(new Response(null, { status: n++ % 2 ? 503 : 429 })) : s.fetch(url));
      const c = new CatalogClient({ fetch: flaky, origin: 'https://app.test', localMedia: null, retry: retry() });
      expect(await c.load()).toBe('unavailable');
      expect(n).toBe(8);
      expect(sleeps).toEqual([300, 600, 1200, 2400, 4800, 5000, 5000]);
      expect(c.failure).toMatchObject({ stage: 'catalog', status: 503, offline: false });
    });

    it('a request that recovers within the retries loads the catalog', async () => {
      const s = await serve({});
      let n = 0;
      const recovering = (url: string): Promise<Response> => (url.includes('/manifests/') && n++ < 3 ? Promise.reject(new TypeError('Failed to fetch')) : s.fetch(url));
      const c = new CatalogClient({ fetch: recovering, origin: 'https://app.test', localMedia: null, retry: retry() });
      expect(await c.load()).toBe('ready');
      expect(c.failure).toBeNull();
    });

    it('a network error while the browser is offline fails at once and is marked offline (the offline relaunch path)', async () => {
      sleeps.length = 0;
      const s = await serve({});
      let n = 0;
      const offline = (url: string): Promise<Response> => (url.includes('/manifests/') ? (n++, Promise.reject(new TypeError('Failed to fetch'))) : s.fetch(url));
      const c = new CatalogClient({ fetch: offline, origin: 'https://app.test', localMedia: null, retry: retry(false) });
      expect(await c.load()).toBe('unavailable');
      expect(n).toBe(1);
      expect(sleeps).toEqual([]);
      expect(c.failure).toMatchObject({ stage: 'catalog', status: null, offline: true });
    });

    it('a pointer the app does not serve is recorded at the pointer stage', async () => {
      const s = await serve({});
      const noPointer = (url: string): Promise<Response> => (url === 'https://app.test/asset-catalog.json' ? Promise.resolve(new Response(null, { status: 404 })) : s.fetch(url));
      const c = new CatalogClient({ fetch: noPointer, origin: 'https://app.test', localMedia: null, retry: retry() });
      expect(await c.load()).toBe('unavailable');
      expect(c.failure).toMatchObject({ stage: 'pointer', url: 'https://app.test/asset-catalog.json', status: 404 });
    });
  });

  it('maps asset kinds to pack kinds', () => {
    expect(packKindOf('world_pack')).toBe('chunk');
    expect(packKindOf('texture')).toBe('tex');
    expect(packKindOf('vehicle')).toBe('mesh');
    expect(packKindOf('audio_bark')).toBe('audio');
    expect(packKindOf('data')).toBe('data');
    expect(packKindOf('cutscene')).toBe('data');
  });
});
