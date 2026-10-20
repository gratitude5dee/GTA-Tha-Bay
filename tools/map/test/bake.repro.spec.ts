import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runBake, runRepro, synthFresh } from '../src/bake.ts';
import { CIVIC_FIXTURE_DIR, loadSources, loadSynth, type SourcesConfig } from '../src/config.ts';

const roots = (): { outRoot: string; cacheRoot: string } => {
  const r = mkdtempSync(path.join(tmpdir(), 'dv-repro-'));
  return { outRoot: path.join(r, 'world'), cacheRoot: path.join(r, 'cache') };
};
const quiet = (): void => {};

describe('bake.repro: the civic-excerpt bakes byte-identically', () => {
  it('runs twice with --force into two directories and finds no differing byte (AC-3)', async () => {
    const r = await runRepro({ area: 'civic-excerpt', ...roots(), log: quiet });
    expect(r.ok).toBe(true);
    expect(r.differing).toEqual([]);
    expect(Object.keys(r.first.hashes).sort()).toEqual(Object.keys(r.second.hashes).sort());
    expect(Object.keys(r.first.hashes)).toContain('bake-report.json');
    expect(Object.keys(r.first.hashes)).toContain('world-index.json');
    expect(Object.keys(r.first.hashes)).toContain('district-grid.v1.pack');
    expect(Object.keys(r.first.hashes).filter((k) => /^packs\/(p0|l0)-.*\.pack$/.test(k))).toHaveLength(8);
    expect(Object.keys(r.first.hashes)).toEqual(expect.arrayContaining(['packs/sf-graph.v1.pack', 'transit-routes.json', 'packs/far-bay-dem.pack', 'packs/far-bay-massing.pack', 'packs/far-bay-cards.png']));
    expect(Object.keys(r.first.hashes)).not.toContain('bake-times.json');
    expect(r.first.gates.filter((g) => g.level === 'fail')).toEqual([]);
  }, 60_000);
});

describe('bake stages and the stage cache', () => {
  it('runs selected stages, reads the others from the cache, and refuses an uncached stage', async () => {
    const o = { area: 'civic-excerpt' as const, ...roots(), log: quiet };
    await expect(runBake({ ...o, stages: ['pack'] })).rejects.toThrow(/not selected and has no cached output/);
    const lines: string[] = [];
    await runBake({ ...o, stages: ['water', 'terrain', 'roads', 'junctions', 'grading', 'buildings', 'ped', 'tags', 'places', 'district-grid', 'lod'], log: (l) => lines.push(l) });
    expect(lines.join('\n')).toMatch(/water: done/);
    const full = await runBake({ ...o, stages: ['pack'], log: (l) => lines.push(l) });
    expect(full.ok).toBe(true);
    expect(lines.join('\n')).toMatch(/water: cached/);
    const forced = await runBake({ ...o, force: true, log: (l) => lines.push(l) });
    expect(forced.hashes).toEqual(full.hashes);
  }, 60_000);

  it('fails the bake when a gate fails, and still writes the report', async () => {
    const cfg = JSON.parse(JSON.stringify(loadSources())) as SourcesConfig;
    cfg.areas['civic-excerpt'].gates.s0.minRows['datasf-footprints'] = 1_000_000;
    const r = await runBake({ area: 'civic-excerpt', ...roots(), cfg, log: quiet });
    expect(r.ok).toBe(false);
    expect(r.gates.find((g) => g.id === 's0.rows.datasf-footprints')?.level).toBe('fail');
    expect(JSON.parse(readFileSync(path.join(r.outDir, 'bake-report.json'), 'utf8'))).toMatchObject({ ok: false });
  }, 60_000);

  it('refuses a raw snapshot that no longer matches raw.lock.json', async () => {
    const raw = mkdtempSync(path.join(tmpdir(), 'dv-raw-'));
    cpSync(CIVIC_FIXTURE_DIR, raw, { recursive: true });
    writeFileSync(path.join(raw, 'tkzw-k3nq.jsonl'), '{"treeid":"x","species":"y","latitude":"37.78","longitude":"-122.42"}\n');
    await expect(runBake({ area: 'civic-excerpt', ...roots(), rawDir: raw, log: quiet })).rejects.toThrow(/tkzw-k3nq.*sha256/);
  });

  it('changes the bake id when a source hash changes', async () => {
    const raw = mkdtempSync(path.join(tmpdir(), 'dv-raw-'));
    cpSync(CIVIC_FIXTURE_DIR, raw, { recursive: true });
    const a = await runBake({ area: 'civic-excerpt', ...roots(), rawDir: raw, log: quiet });
    const lockPath = path.join(raw, 'raw.lock.json');
    const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as { sources: { id: string; sha256: string }[] };
    lock.sources.find((s) => s.id === 'osm')!.sha256 = '0'.repeat(64);
    // the osm file keeps its bytes but the lock now names another hash: the bake refuses it, so re-hash the file to match
    writeFileSync(path.join(raw, 'osm.geojsonl'), `${readFileSync(path.join(raw, 'osm.geojsonl'), 'utf8')}\n`);
    const { createHash } = await import('node:crypto');
    lock.sources.find((s) => s.id === 'osm')!.sha256 = createHash('sha256').update(readFileSync(path.join(raw, 'osm.geojsonl'))).digest('hex');
    writeFileSync(lockPath, JSON.stringify(lock));
    const b = await runBake({ area: 'civic-excerpt', ...roots(), rawDir: raw, log: quiet });
    expect(b.bakeId).not.toBe(a.bakeId);
  }, 60_000);

  it('knows when synth sources are stale', () => {
    const raw = mkdtempSync(path.join(tmpdir(), 'dv-synth-fresh-'));
    expect(synthFresh(raw, loadSynth(), loadSources(), 'synth')).toBe(false);
  });
});
