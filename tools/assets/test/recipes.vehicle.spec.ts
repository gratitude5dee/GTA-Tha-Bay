/** M10d1 AC-3, AC-4 and AC-5 (assets): the recipes are deterministic, name their nodes by the C07 contract and stay inside their budgets. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { ART_NODE, PART } from '../../../packages/shared/src/assets/art-parts.ts';
import { toolsRoot } from '../../ci/lib/common.ts';
import { simplifierReady } from '../src/lod.ts';
import { ART_ASSETS, buildModel, refOf } from '../src/recipes/catalog.ts';
import { FIDELITIES, VARIANT_OF, modelBounds, modelStats, walk, writeModelGlb, type ModelDoc } from '../src/recipes/model.ts';
import { planArtAsset } from '../src/vehicle-gen.ts';

interface Row { id: string; kind: string; tag: string; fidelity: Record<'hi' | 'mid' | 'lo', { tris: number; materials: number; fileBytes: number }> }
const budgets = (JSON.parse(readFileSync(path.join(toolsRoot, 'config/asset-budgets.json'), 'utf8')) as { rows: Row[] }).rows;
const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

beforeAll(async () => {
  await simplifierReady();
});

const nodeNames = (d: ModelDoc): Set<string> => {
  const out = new Set<string>();
  walk(d, (n) => out.add(n.name));
  return out;
};

describe('the 24 art assets', () => {
  it('are the vehicles and props of the milestone', () => {
    expect(ART_ASSETS).toHaveLength(24);
    expect(ART_ASSETS.filter((a) => a.kind === 'vehicle')).toHaveLength(11);
    expect(new Set(ART_ASSETS.map(refOf)).size).toBe(24);
  });

  it('build three variants within their budget row, with LOD stats', () => {
    for (const a of ART_ASSETS) {
      const row = budgets.find((r) => r.kind === a.kind && r.id !== undefined && a.tag === r.tag) as Row;
      expect(row, refOf(a)).toBeDefined();
      for (const f of FIDELITIES) {
        const s = modelStats(buildModel(a, f));
        expect(s.tris, `${refOf(a)} ${f} tris`).toBeLessThanOrEqual(row.fidelity[f].tris);
        expect(s.materials, `${refOf(a)} ${f} materials`).toBeLessThanOrEqual(row.fidelity[f].materials);
        expect(s.tris).toBeGreaterThan(0);
      }
      const hi = modelStats(buildModel(a, 'hi')).tris, mid = modelStats(buildModel(a, 'mid')).tris, lo = modelStats(buildModel(a, 'lo')).tris;
      expect(mid, refOf(a)).toBeLessThanOrEqual(hi);
      expect(lo, refOf(a)).toBeLessThanOrEqual(mid);
    }
  }, 120_000);

  it('are byte-identical across two runs', async () => {
    for (const a of ART_ASSETS.filter((x) => ['traffic.sedan', 'police.cruiser', 'cone', 'transit.bus'].includes(x.id))) {
      for (const f of FIDELITIES) {
        const x = await writeModelGlb(buildModel(a, f));
        const y = await writeModelGlb(buildModel(a, f));
        expect(sha(x), `${refOf(a)} ${f}`).toBe(sha(y));
      }
    }
  }, 120_000);

  it('plan files, a spec with the C07 vehicle extras and an authored provenance record per variant', async () => {
    const def = ART_ASSETS.find((a) => a.id === 'traffic.sedan') as (typeof ART_ASSETS)[number];
    const p = await planArtAsset(def);
    expect(p.files.map((f) => f.path)).toEqual(FIDELITIES.map((f) => `assets/src/vehicle/traffic.sedan/${VARIANT_OF[f]}.glb`));
    const spec = JSON.parse(p.spec) as { extras: { t: string; fictionalMake: string; wheelRadiusM: number; nodes: { body: string; wheels: string[] } }; tags: string[]; stats: Record<string, { tris: number }> };
    expect(spec.extras.t).toBe('vehicle');
    expect(spec.extras.fictionalMake).toBeTruthy();
    expect(spec.extras.nodes.wheels).toEqual(['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr']);
    expect(spec.tags).toContain('class:traffic');
    expect(Object.keys(spec.stats).sort()).toEqual(['desktop', 'mobile', 'mobile-low']);
    for (const r of p.records) {
      const rec = JSON.parse(r.text) as { origin: string; license: string; ai_generated: boolean };
      expect(rec).toMatchObject({ origin: 'authored', license: 'LicenseRef-DeeVerse-Owned', ai_generated: false });
    }
  });
});

describe('the vehicle node contract (C07 1.1, H6)', () => {
  it('names body, four wheels with a tyre and a rim each, two steering pivots, four lamps and a small collider', () => {
    for (const a of ART_ASSETS.filter((x) => x.kind === 'vehicle')) {
      for (const f of FIDELITIES) {
        const d = buildModel(a, f);
        const names = nodeNames(d);
        for (const n of [ART_NODE.body, ...ART_NODE.wheels, ...ART_NODE.steers, ...ART_NODE.tyres, ...ART_NODE.rims, ...ART_NODE.lights, ART_NODE.collider]) {
          expect(names.has(n), `${refOf(a)} ${f}: ${n}`).toBe(true);
        }
        let hull = 0;
        walk(d, (n) => {
          if (n.name === ART_NODE.collider) for (const m of n.meshes ?? []) hull += m.vertexCount;
        });
        expect(hull).toBeLessThanOrEqual(64);
      }
    }
  });

  it('puts the wheel pivots at the hubs: left wheels at +X (glTF), front steering pivots parent the front wheels', () => {
    const d = buildModel(ART_ASSETS.find((a) => a.id === 'traffic.sedan') as (typeof ART_ASSETS)[number], 'hi');
    const at: Record<string, [number, number, number]> = {};
    const parentOf: Record<string, string | null> = {};
    walk(d, (n, w, p) => {
      at[n.name] = [w[0], w[1], w[2]];
      parentOf[n.name] = p?.name ?? null;
    });
    expect((at['wheel_fl'] as number[])[0]).toBeGreaterThan(0);
    expect((at['wheel_fr'] as number[])[0]).toBeLessThan(0);
    expect((at['wheel_fl'] as number[])[2]).toBeGreaterThan(0);
    expect((at['wheel_rl'] as number[])[2]).toBeLessThan(0);
    expect(parentOf['wheel_fl']).toBe('steer_fl');
    expect(parentOf['wheel_fr']).toBe('steer_fr');
    expect(parentOf['wheel_rl']).toBeNull();
    // the hub height is the tyre radius: the model stands on y = 0
    const b = modelBounds(d);
    expect(b[1]).toBeCloseTo(0, 2);
  });

  it('tags every vertex with a known part id, glass only in the glass primitive of the hi variant', () => {
    const d = buildModel(ART_ASSETS.find((a) => a.id === 'police.cruiser') as (typeof ART_ASSETS)[number], 'hi');
    const known = new Set<number>(Object.values(PART));
    const seen = new Set<number>();
    walk(d, (n) => {
      for (const m of n.meshes ?? []) {
        for (const p of m.part) {
          expect(known.has(p)).toBe(true);
          seen.add(p);
          if (p === PART.glass && n.name !== ART_NODE.collider) expect(m.material).toBe('glass');
        }
      }
    });
    for (const p of [PART.paint, PART.glass, PART.tyre, PART.rim, PART.lampHead, PART.lampBrake, PART.sirenRed, PART.sirenBlue, PART.livery]) expect(seen.has(p)).toBe(true);
  });

  it('are fictional: no real make or model in an extras string', () => {
    const real = ['ford', 'chevrolet', 'toyota', 'honda', 'tesla', 'waymo', 'volkswagen', 'bmw', 'mercedes', 'mustang', 'camry', 'civic', 'prius', 'transit connect'];
    const makes = ART_ASSETS.flatMap((a) => (a.vehicle ? [a.vehicle.make.toLowerCase()] : []));
    expect(makes).toHaveLength(11);
    for (const m of makes) for (const r of real) expect(m.includes(r), `${m} contains ${r}`).toBe(false);
  });
});
