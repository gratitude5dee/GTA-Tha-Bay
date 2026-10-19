import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GRID_MIN_M, enuFromLatLng } from '../../../packages/shared/src/index.ts';
import { sha256Hex } from '../../ci/lib/common.ts';
import { requireBake } from '../../../tests/support/require-bake.ts';
import { loadSources, loadSynth, mapSchema } from '../src/config.ts';
import { NEIGHBOURHOODS_41 } from '../src/districts-seed.ts';
import { readRawLock } from '../src/raw-lock.ts';
import { distToSynthWater, generateSynth, inSynthLand, synthHeight } from '../src/sources/synth.ts';
import { readJsonl } from '../src/sources/socrata.ts';
import landmarks from './fixtures/landmarks.seed.json' with { type: 'json' };

const cfg = loadSynth();

describe('synth land', () => {
  it('has all 37 landmark points on generated land at least 40 m from water (DL-652)', () => {
    expect(landmarks.landmarks).toHaveLength(37);
    const bad: string[] = [];
    for (const l of landmarks.landmarks) {
      const d = inSynthLand(cfg, l.x, l.z) ? distToSynthWater(cfg, l.x, l.z) : -1;
      if (d < 40) bad.push(`${l.id} (${d < 0 ? 'in water' : `${d.toFixed(0)} m from water`})`);
    }
    expect(bad).toEqual([]);
  });

  it('lists the seeds with lat/lng that agree with their ENU point within 1 m', () => {
    for (const l of landmarks.landmarks) {
      const p = enuFromLatLng(l.lat, l.lng);
      expect(Math.hypot(p.x - l.x, p.z - l.z), l.id).toBeLessThan(1);
    }
  });

  it('gives every land pad at least 160 m', () => {
    for (const p of cfg.landPads) {
      if (p.kind === 'island') expect(p.size).toBeGreaterThanOrEqual(160);
      else {
        expect(p.width).toBeGreaterThanOrEqual(160);
        expect(p.length).toBeGreaterThanOrEqual(160);
      }
    }
  });

  it('puts City Hall at 17.6 m and keeps land above 1.5 m', () => {
    expect(synthHeight(cfg, 0, 0)).toBeCloseTo(17.6, 6);
    for (const l of landmarks.landmarks) expect(synthHeight(cfg, l.x, l.z)).toBeGreaterThanOrEqual(1.5);
    expect(synthHeight(cfg, -9300, 0)).toBeLessThan(0);
  });

  it('carries the 41 real neighbourhood names of section 8', () => {
    expect([...cfg.neighbourhoods.names].sort()).toEqual([...NEIGHBOURHOODS_41].sort());
    expect(mapSchema('synth')(cfg)).toEqual([]);
  });
});

describe('synth.deterministic', () => {
  // downtown chunk block (264-265 x 250-253) plus a margin tile: the 1,500-per-chunk band
  const box = { minX: 1920, minZ: -1664, maxX: 2432, maxZ: -640 };
  const gen = (): { dir: string; hashes: Record<string, string> } => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dv-synth-'));
    generateSynth(cfg, loadSources(), 'synth', { outDir: dir, box });
    const hashes: Record<string, string> = {};
    const walk = (d: string, rel: string): void => {
      for (const n of readdirSync(d).sort()) {
        const p = path.join(d, n);
        if (statSync(p).isDirectory()) walk(p, `${rel}${n}/`);
        else hashes[`${rel}${n}`] = sha256Hex(readFileSync(p));
      }
    };
    walk(dir, '');
    return { dir, hashes };
  };

  it('writes the same bytes twice and stamps the lock as authored synth', () => {
    const a = gen();
    const b = gen();
    expect(a.hashes).toEqual(b.hashes);
    expect(Object.keys(a.hashes)).toEqual(expect.arrayContaining(['ynuv-fyni.jsonl', 'j2bu-swwd.jsonl', 'gtr9-ntp6.jsonl', 'tkzw-k3nq.jsonl', 'osm.geojsonl', 'raw.lock.json']));
    expect(Object.keys(a.hashes).some((k) => k.startsWith('terrarium/15/'))).toBe(true);
    const lock = readRawLock(a.dir)!;
    expect(lock.synthetic).toBe(true);
    for (const s of lock.sources) {
      expect(s.licence).toBe('LicenseRef-DeeVerse-Owned');
      expect(s.url.startsWith('synth://')).toBe(true);
      expect(s.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  }, 60_000);

  it('puts exactly 1,500 buildings in each downtown chunk and never more', () => {
    const { dir } = gen();
    const rows = readJsonl<{ shape: { coordinates: number[][][][] } }>(path.join(dir, 'ynuv-fyni.jsonl'));
    const perChunk = new Map<string, number>();
    for (const r of rows) {
      const ring = r.shape.coordinates[0]![0]!;
      let sx = 0, sz = 0;
      for (const c of ring) { const p = enuFromLatLng(c[1]!, c[0]!); sx += p.x; sz += p.z; }
      const x = sx / ring.length, z = sz / ring.length;
      const k = `${Math.floor((x - GRID_MIN_M) / 256)}/${Math.floor((z - GRID_MIN_M) / 256)}`;
      perChunk.set(k, (perChunk.get(k) ?? 0) + 1);
    }
    const counts = [...perChunk.values()];
    expect(Math.max(...counts)).toBeLessThanOrEqual(1500);
    expect(counts.filter((n) => n === 1500).length).toBe(8);
  }, 60_000);
});

describe('synth bake (AC-4; needs pnpm map:build -- --area synth)', () => {
  const bake = requireBake('synth', 'synth.spec');
  const run = bake ? it : it.skip;

  run('has packs for every land tile on the straight line from (2275, -1804) to (-8300, 500)', () => {
    const index = JSON.parse(readFileSync(path.join(bake!.dir, 'world-index.json'), 'utf8')) as { tiles: { p0: string[]; l0: string[] } };
    const p0 = new Set(index.tiles.p0), l0 = new Set(index.tiles.l0);
    const [x0, z0, x1, z1] = [2275, -1804, -8300, 500] as const;
    const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 8);
    const seen = new Set<string>();
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n, z = z0 + ((z1 - z0) * i) / n;
      if (!inSynthLand(cfg, x, z)) continue;
      const t = `${Math.floor((x - GRID_MIN_M) / 1024)}-${Math.floor((z - GRID_MIN_M) / 1024)}`;
      seen.add(t);
      expect(p0.has(t), `p0 ${t}`).toBe(true);
      expect(l0.has(t), `l0 ${t}`).toBe(true);
    }
    expect(seen.size).toBeGreaterThanOrEqual(10);
  });

  run('validates the world index, stays under 1,500 buildings per chunk, 4 MiB per pack and has no key-like string', () => {
    const dir = bake!.dir;
    const index = JSON.parse(readFileSync(path.join(dir, 'world-index.json'), 'utf8')) as unknown;
    expect(mapSchema('world-index')(index)).toEqual([]);
    const report = JSON.parse(readFileSync(path.join(dir, 'bake-report.json'), 'utf8')) as {
      ok: boolean; gates: { id: string; level: string }[]; buildings: { maxPerChunk: number }; packs: { bytes: number }[];
    };
    expect(report.ok).toBe(true);
    expect(report.buildings.maxPerChunk).toBeLessThanOrEqual(1500);
    for (const p of report.packs) expect(p.bytes).toBeLessThanOrEqual(4 * 1024 * 1024);
    expect(report.gates.filter((g) => g.level === 'fail')).toEqual([]);
    expect(report.gates.find((g) => g.id === 's13.no-keys')?.level).toBe('pass');
  });
});
