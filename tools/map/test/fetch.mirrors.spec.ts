/** S0 OSM mirrors (DL-703): primary fails, the first mirror serves, the lock names it. Fetcher injected; no network. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSources, validateSources, type SourcesConfig } from '../src/config.ts';
import { ensureOsmPbf, osmRoutes, type OsmDownloader } from '../src/sources/osm.ts';
import { runFetch } from '../src/stages/s0-fetch.ts';
import { useTempDirs } from '../../ci/test-tmp.ts';

// BD-FIX-TMP-01: temp folders made here are removed after the last test of this file.
const tempDir = useTempDirs();

const cfg = loadSources();
const osm = cfg.sources.find((s) => s.id === 'osm')!;
const BYTES = Buffer.from('fake-pbf-bytes');
const sha = createHash('sha256').update(BYTES).digest('hex');

function downloader(failing: string[], calls: string[]): OsmDownloader {
  return async (url, file) => {
    calls.push(url);
    if (failing.includes(url)) throw new Error('read ECONNRESET');
    writeFileSync(file, BYTES);
  };
}
const tmp = (): string => tempDir('dv-osm-');

describe('sources.json mirrors (DL-703)', () => {
  it('keeps Geofabrik as primary and lists BBBike then the openstreetmap.fr state extract', () => {
    expect(osm.url).toContain('download.geofabrik.de');
    expect(osmRoutes(osm).map((r) => new URL(r.url).hostname)).toEqual(['download.geofabrik.de', 'download.bbbike.org', 'download.openstreetmap.fr']);
    expect(osm.mirrors?.map((m) => m.coverage)).toEqual(['play', 'california']);
  });

  it('validates the mirrors and rejects a malformed or denied one', () => {
    expect(validateSources(cfg)).toEqual([]);
    const bad = JSON.parse(JSON.stringify(cfg)) as SourcesConfig;
    bad.sources.find((s) => s.id === 'osm')!.mirrors = [{ url: 'http://insecure.example/x.pbf', coverage: 'play' }];
    expect(validateSources(bad).length).toBeGreaterThan(0);
    const bad2 = JSON.parse(JSON.stringify(cfg)) as SourcesConfig;
    bad2.sources.find((s) => s.id === 'osm')!.mirrors = [{ url: 'https://example.org/x.pbf', coverage: 'world' as never }];
    expect(validateSources(bad2).length).toBeGreaterThan(0);
  });
});

describe('ensureOsmPbf', () => {
  it('uses the first mirror when the primary resets the connection and records it', async () => {
    const dir = tmp();
    const calls: string[] = [];
    const lines: string[] = [];
    const [primary, bbbike] = osmRoutes(osm);
    const got = await ensureOsmPbf(osm, dir, { download: downloader([primary!.url], calls), log: (l) => lines.push(l), now: () => '2026-10-19T00:00:00Z' });
    expect(calls).toEqual([primary!.url, bbbike!.url]);
    expect(got.served).toEqual({ url: bbbike!.url, sha256: sha, bytes: BYTES.length, routeIndex: 1, retrievedAt: '2026-10-19T00:00:00Z' });
    expect(lines.join('\n')).toContain('failed (read ECONNRESET); trying the next route');
    expect(existsSync(`${got.pbf}.part`)).toBe(false);
  });

  it('falls through to the last mirror and throws with every failure when none answers', async () => {
    const calls: string[] = [];
    const [p, m1, m2] = osmRoutes(osm);
    const got = await ensureOsmPbf(osm, tmp(), { download: downloader([p!.url, m1!.url], calls) });
    expect(got.served.url).toBe(m2!.url);
    const all = osmRoutes(osm).map((r) => r.url);
    await expect(ensureOsmPbf(osm, tmp(), { download: downloader(all, []) })).rejects.toThrow(/no OSM route answered[\s\S]*bbbike[\s\S]*openstreetmap\.fr/);
  });

  it('reuses a finished download without calling any route', async () => {
    const dir = tmp();
    await ensureOsmPbf(osm, dir, { download: downloader([], []) });
    const calls: string[] = [];
    const again = await ensureOsmPbf(osm, dir, { download: downloader([], calls) });
    expect(again.reused).toBe(true);
    expect(calls).toEqual([]);
  });
});

describe('map:fetch osm route in the lock', () => {
  it('writes the mirror URL, the extract hash and the export hash into raw.lock.json', async () => {
    const dir = tmp();
    const rawDir = path.join(dir, 'raw');
    const contentDir = path.join(dir, 'content');
    const only: SourcesConfig = JSON.parse(JSON.stringify(cfg)) as SourcesConfig;
    only.areas.sf.sources = ['osm'];
    const [primary, bbbike] = osmRoutes(osm);
    const calls: string[] = [];
    const shell = (cmd: string): number => {
      // The export step writes the GeoJSON lines the bake reads; the other osmium steps are no-ops here.
      if (cmd.includes('osmium export')) writeFileSync(path.join(rawDir, osm.file), '{"type":"Feature"}\n{"type":"Feature"}\n');
      return 0;
    };
    const lines: string[] = [];
    const code = await runFetch({ area: 'sf', cfg: only, env: {}, rawDir, contentDir, osmDownload: downloader([primary!.url], calls), osmShell: shell, log: (l) => lines.push(l) });
    expect(code).toBe(0);
    expect(calls).toEqual([primary!.url, bbbike!.url]);
    const lock = JSON.parse(readFileSync(path.join(rawDir, 'raw.lock.json'), 'utf8')) as { sources: { id: string; url: string; sha256: string; rows: number; retrievedAt: string; extract?: { sha256: string; bytes: number; route: number } }[] };
    const e = lock.sources.find((s) => s.id === 'osm')!;
    expect(e.url).toBe(bbbike!.url);
    expect(e.rows).toBe(2);
    expect(e.retrievedAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    expect(e.extract).toEqual({ sha256: sha, bytes: BYTES.length, route: 1 });
    expect(e.sha256).toBe(createHash('sha256').update('{"type":"Feature"}\n{"type":"Feature"}\n').digest('hex'));
    expect(lines.join('\n')).toContain(`extract served by ${bbbike!.url}`);
    // a second run reuses the export and still names the mirror
    const again = await runFetch({ area: 'sf', cfg: only, env: {}, rawDir, contentDir, osmDownload: downloader(osmRoutes(osm).map((r) => r.url), []), osmShell: shell, log: () => {} });
    expect(again).toBe(0);
    const lock2 = JSON.parse(readFileSync(path.join(rawDir, 'raw.lock.json'), 'utf8')) as typeof lock;
    expect(lock2.sources.find((s) => s.id === 'osm')!.url).toBe(bbbike!.url);
  });
});
