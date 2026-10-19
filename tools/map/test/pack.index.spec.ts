import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GroundClass, canonicalize, readHeader, sha256Hex, type WorldIndex } from '../../../packages/shared/src/index.ts';
import { TOOL_ID, configHashesOf, loadSources, mapSchema } from '../src/config.ts';
import { districtSeeds } from '../src/districts-seed.ts';
import { readRawLock, stampsOf } from '../src/raw-lock.ts';
import { bakeExcerpt } from './helpers.ts';

describe('S13 pack and world index on the civic-excerpt', () => {
  it('writes a world index that validates and carries every §5 property', async () => {
    const b = await bakeExcerpt();
    const index = JSON.parse(readFileSync(path.join(b.outDir, 'world-index.json'), 'utf8')) as WorldIndex;
    expect(mapSchema('world-index')(index)).toEqual([]);
    for (const k of ['schema', 'c08', 'bakeId', 'worldSeed', 'areas', 'tiles', 'landmarks', 'pois', 'districts', 'portals', 'transit', 'sources']) expect(index).toHaveProperty(k);
    expect(index.schema).toBe('world-index/1');
    expect(index.c08).toBe('1.0.0');
    expect(index.landmarks.length).toBeGreaterThan(0);
    expect(index.landmarks.length).toBeLessThanOrEqual(37);
    expect(index.tiles.l1.length).toBeGreaterThan(0);
    expect(index.tiles.l2.length).toBeGreaterThan(0);
    expect(index.areas.map((a) => a.id)).toEqual(['sf', 'bay-backdrop']);
  });

  it('derives bakeId from the sorted source hashes, tool version and config hashes (C08 rule 16)', async () => {
    const b = await bakeExcerpt();
    const cfg = loadSources();
    const lock = readRawLock(path.join(b.outDir))!;
    // the bake-directory copy of raw.lock.json carries the content-world stamp as well; the bakeId hashes the raw sources only
    const sourceHashes = Object.fromEntries(lock.sources.filter((s) => s.id !== 'content-world').map((s) => [s.id, s.sha256]));
    const want = sha256Hex(canonicalize({ sourceHashes, toolVersion: TOOL_ID, configHashes: configHashesOf(cfg, 'civic-excerpt') }));
    expect(b.result.bakeId).toBe(want);
    const index = JSON.parse(readFileSync(path.join(b.outDir, 'world-index.json'), 'utf8')) as WorldIndex;
    expect(index.bakeId).toBe(want);
    expect(index.worldSeed).toBe(Number.parseInt(want.slice(0, 8), 16) >>> 0);
  });

  it('holds SourceStamp records verbatim from raw.lock.json, with the attribution from sources.json', async () => {
    const b = await bakeExcerpt();
    const cfg = loadSources();
    const index = JSON.parse(readFileSync(path.join(b.outDir, 'world-index.json'), 'utf8')) as WorldIndex;
    const lock = readRawLock(b.outDir)!;
    expect(index.sources).toEqual(stampsOf(lock, cfg));
    const fp = index.sources.find((s) => s.id === 'datasf-footprints')!;
    expect(fp).toMatchObject({ licence: 'PDDL-1.0', attribution: 'City and County of San Francisco', url: 'https://data.sf.gov/resource/ynuv-fyni.json' });
    expect(fp.retrievedAt).toMatch(/Z$/);
    // the synthetic OSM part of the excerpt is stamped as such, not as © OpenStreetMap contributors
    expect(index.sources.find((s) => s.id === 'osm')!.attribution).toMatch(/Synthetic test data/);
    expect(Object.keys(index.sources[0]!).sort()).toEqual(['attribution', 'id', 'licence', 'retrievedAt', 'sha256', 'url']);
  });

  it('lists the 10 districts, outer, stage and 41 neighbourhoods', async () => {
    const b = await bakeExcerpt();
    const index = JSON.parse(readFileSync(path.join(b.outDir, 'world-index.json'), 'utf8')) as WorldIndex;
    expect(index.districts).toHaveLength(53);
    expect(index.districts.filter((d) => d.kind === 'nhood')).toHaveLength(41);
    expect(index.districts.map((d) => d.id)).toEqual(districtSeeds().map((d) => d.id));
    for (const d of index.districts) expect(d.id).toMatch(/^[a-z0-9-]{2,32}$/);
  });

  it('writes p0 and l0 packs for each z=7 tile that holds a baked chunk, with the bakeId in every header', async () => {
    const b = await bakeExcerpt();
    const index = JSON.parse(readFileSync(path.join(b.outDir, 'world-index.json'), 'utf8')) as WorldIndex;
    expect(index.tiles.p0).toEqual(index.tiles.l0);
    expect(index.tiles.p0).toEqual(['63-63', '63-64', '64-63', '64-64']);
    for (const t of index.tiles.p0) {
      for (const f of ['p0', 'l0']) {
        const h = readHeader(readFileSync(path.join(b.outDir, 'packs', `${f}-${t}.pack`)));
        expect(h.bakeId).toBe(b.result.bakeId);
        expect(h.hostZ).toBe(7);
        expect(h.chunkCount).toBe(4);
      }
    }
  });

  it('fills HEIGHT, PRISM, GROUND and the road sections in p0 and BUILDING and TREE in l0', async () => {
    const b = await bakeExcerpt();
    for (const c of b.sim) {
      expect(c.height.dm).toHaveLength(65 * 65);
      expect(c.ground).toHaveLength(64 * 64);
      expect(c.edges.length).toBeGreaterThan(0);
      expect(c.nodes.length).toBeGreaterThan(0);
      // inland: no water cell anywhere in the excerpt
      expect(c.ground.some((g) => g === GroundClass.Water || g === GroundClass.WaterShallow)).toBe(false);
    }
    expect(b.sim.some((c) => c.prisms.length > 0)).toBe(true);
    expect(b.render.some((c) => c.buildings.length > 0)).toBe(true);
    expect(b.render.reduce((n, c) => n + c.trees.length / 4, 0)).toBeGreaterThan(1000);
    expect(b.sim.some((c) => c.ground.some((g) => g === GroundClass.Park))).toBe(true);
  });

  it('keeps every pack under 4 MiB and writes bake-report.json without wall-clock values', async () => {
    const b = await bakeExcerpt();
    const text = readFileSync(path.join(b.outDir, 'bake-report.json'), 'utf8');
    expect(text).not.toMatch(/"ms"|elapsed|duration/i);
    expect(b.report.counts['packs']).toBeGreaterThanOrEqual(8);
    const rep = JSON.parse(text) as { packs: { bytes: number }[]; ok: boolean };
    for (const p of rep.packs) expect(p.bytes).toBeLessThan(4 * 1024 * 1024);
    expect(rep.ok).toBe(true);
    expect(readFileSync(path.join(b.outDir, 'bake-times.json'), 'utf8')).toMatch(/"ms"/);
  });
});
