/**
 * M02h5 AC-3: `map:fetch -- --area sf --only osm --no-download` re-runs only the osmium steps from the cached extract. With the
 * cached extract only the osmium commands run and only the `osm` lock entry changes (same `extract.sha256`); without it the command
 * exits non-zero naming the extract, with no download call. Osmium shell and download injected; no network.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSources, type SourcesConfig } from '../src/config.ts';
import { PBF_NAME, osmRoutes, type OsmDownloader } from '../src/sources/osm.ts';
import { runFetch } from '../src/stages/s0-fetch.ts';
import { useTempDirs } from '../../ci/test-tmp.ts';

const tempDir = useTempDirs();
const cfg = loadSources();
const osm = cfg.sources.find((s) => s.id === 'osm')!;
const PBF = Buffer.from('cached-extract-bytes');
const PBF_SHA = createHash('sha256').update(PBF).digest('hex');

interface Lock { sources: { id: string; url: string; sha256: string; rows: number; retrievedAt: string; extract?: { sha256: string; bytes: number; route: number } }[] }
const readLock = (dir: string): Lock => JSON.parse(readFileSync(path.join(dir, 'raw.lock.json'), 'utf8')) as Lock;

function recorder(calls: string[]): OsmDownloader {
  return async (url, file) => {
    calls.push(url);
    writeFileSync(file, PBF);
  };
}

/** An osmium shell that records every command; the export writes `rows` GeoJSON lines. */
function shellOf(rawDir: string, cmds: string[], rows: number): (cmd: string) => number {
  return (cmd) => {
    cmds.push(cmd);
    if (cmd.includes('osmium export') && cmd.includes(osm.file)) writeFileSync(path.join(rawDir, osm.file), '{"type":"Feature"}\n'.repeat(rows));
    return 0;
  };
}

/** A raw dir holding the cached extract, its sidecar, an earlier export and a lock with an `osm` entry and one other source. */
function seeded(): { rawDir: string; contentDir: string; other: Lock['sources'][number] } {
  const dir = tempDir('dv-osm-only-');
  const rawDir = path.join(dir, 'raw');
  const contentDir = path.join(dir, 'content');
  return { rawDir, contentDir, other: { id: 'datasf-trees', url: 'https://data.sfgov.org/resource/tkzw-k3nq.json', sha256: 'a'.repeat(64), rows: 7, retrievedAt: '2026-10-01T00:00:00Z' } };
}

describe('map:fetch --only osm --no-download (M02h5)', () => {
  it('with the cached extract runs only the osmium steps and changes only the osm entry', async () => {
    const { rawDir, contentDir, other } = seeded();
    // the first fetch downloads the extract (route 0) and exports two features
    const first: string[] = [];
    const only: SourcesConfig = JSON.parse(JSON.stringify(cfg)) as SourcesConfig;
    only.areas.sf.sources = ['osm', 'datasf-trees'];
    const code0 = await runFetch({ area: 'sf', cfg: only, env: {}, rawDir, contentDir, osmDownload: recorder(first), osmShell: shellOf(rawDir, [], 2), only: ['osm'], log: () => {} });
    expect(code0).toBe(0);
    expect(first).toEqual([osmRoutes(osm)[0]!.url]);
    // a lock entry of another source the re-derivation must not touch
    const lock0 = readLock(rawDir);
    writeFileSync(path.join(rawDir, 'raw.lock.json'), `${JSON.stringify({ ...lock0, sources: [...lock0.sources, other] }, null, 2)}\n`);
    const before = readLock(rawDir);
    const osm0 = before.sources.find((s) => s.id === 'osm')!;
    expect(osm0.extract?.sha256).toBe(PBF_SHA);

    // the re-derivation: a new tag filter exports three features; no download, only osmium commands
    const calls: string[] = [];
    const cmds: string[] = [];
    const lines: string[] = [];
    const code = await runFetch({
      area: 'sf', cfg: only, env: {}, rawDir, contentDir, osmDownload: recorder(calls), osmShell: shellOf(rawDir, cmds, 3), only: ['osm'], noDownload: true, log: (l) => lines.push(l),
    });
    expect(code).toBe(0);
    expect(calls).toEqual([]);
    expect(cmds.length).toBeGreaterThan(1);
    for (const c of cmds) expect(c.startsWith('osmium ')).toBe(true);
    expect(cmds.some((c) => c.includes('osmium tags-filter') && c.includes('natural=coastline,water,tree,tree_row,wood,scrub') && c.includes('barrier=hedge'))).toBe(true);
    expect(cmds.some((c) => c.includes(path.join(rawDir, PBF_NAME)))).toBe(true);
    const after = readLock(rawDir);
    const osm1 = after.sources.find((s) => s.id === 'osm')!;
    expect(osm1.extract).toEqual(osm0.extract);
    expect(osm1.rows).toBe(3);
    expect(osm1.sha256).not.toBe(osm0.sha256);
    // every other entry is byte-for-byte what it was
    expect(after.sources.filter((s) => s.id !== 'osm')).toEqual(before.sources.filter((s) => s.id !== 'osm'));
    expect(after.sources.map((s) => s.id).sort()).toEqual(before.sources.map((s) => s.id).sort());
    expect(lines.join('\n')).toContain(`re-derived from the cached extract (sha256 ${PBF_SHA}, no download)`);
  });

  it('without the cached extract exits non-zero naming it, with no download call', async () => {
    const { rawDir, contentDir } = seeded();
    const calls: string[] = [];
    const cmds: string[] = [];
    const lines: string[] = [];
    const code = await runFetch({
      area: 'sf', cfg, env: {}, rawDir, contentDir, osmDownload: recorder(calls), osmShell: shellOf(rawDir, cmds, 1), only: ['osm'], noDownload: true, log: (l) => lines.push(l),
    });
    expect(code).not.toBe(0);
    expect(calls).toEqual([]);
    expect(cmds.filter((c) => c !== 'osmium --version')).toEqual([]);
    expect(lines.join('\n')).toContain(path.join(rawDir, PBF_NAME));
  });

  it('rejects an --only id that is not a source of the area', async () => {
    const { rawDir, contentDir } = seeded();
    const code = await runFetch({ area: 'sf', cfg, env: {}, rawDir, contentDir, osmShell: () => 0, only: ['nope'], noDownload: true, log: () => {} });
    expect(code).toBe(2);
  });
});
