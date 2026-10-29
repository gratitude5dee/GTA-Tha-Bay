/** M10d1: the remodel of a licensed vehicle base (scales, offsets, dropped badge and grille nodes, a `changes` list). */
import { beforeAll, describe, expect, it } from 'vitest';
import { simplifierReady } from '../src/lod.ts';
import { changesText, remodelVehicle } from '../src/import/vehicle.ts';
import { ART_ASSETS, buildModel } from '../src/recipes/catalog.ts';
import { Mesh } from '../src/recipes/mesh.ts';
import { modelBounds, modelStats, walk, type ModelDoc } from '../src/recipes/model.ts';

beforeAll(async () => {
  await simplifierReady();
});

/** A stand-in "base": the sedan recipe with a badge node and a grille node added, as a low-poly pack's car might carry. */
function base(): ModelDoc {
  const d = buildModel(ART_ASSETS.find((a) => a.id === 'traffic.sedan') as (typeof ART_ASSETS)[number], 'hi');
  const badge = new Mesh('detail');
  badge.vertex([0, 0.8, 2.3], [0, 0, 1], [1, 1, 1], 1);
  badge.vertex([0.1, 0.8, 2.3], [0, 0, 1], [1, 1, 1], 1);
  badge.vertex([0.05, 0.9, 2.3], [0, 0, 1], [1, 1, 1], 1);
  badge.tri(0, 1, 2);
  return { ...d, roots: [{ ...d.roots[0]!, children: [...(d.roots[0]!.children ?? []), { name: 'front_badge', meshes: [badge] }, { name: 'grille_main', meshes: [badge] }] }, ...d.roots.slice(1)] };
}

describe('remodelVehicle', () => {
  it('drops badge and grille nodes and says so in `changes`', () => {
    const b = base();
    const r = remodelVehicle(b, {});
    const names: string[] = [];
    walk(r.doc, (n) => names.push(n.name));
    expect(names).not.toContain('front_badge');
    expect(names).not.toContain('grille_main');
    expect(r.changes[0]).toMatch(/removed 2 nodes/);
    // the input is untouched
    const before: string[] = [];
    walk(b, (n) => before.push(n.name));
    expect(before).toContain('front_badge');
  });

  it('scales each axis to the target size and records it', () => {
    const r = remodelVehicle(base(), { size: [1.9, 1.4, 4.9] });
    const b = modelBounds(r.doc);
    expect(b[3] - b[0]).toBeCloseTo(1.9, 1);
    expect(b[4] - b[1]).toBeCloseTo(1.4, 1);
    expect(b[5] - b[2]).toBeCloseTo(4.9, 1);
    expect(r.changes.some((c) => c.startsWith('scaled to 1.90 x 1.40 x 4.90'))).toBe(true);
  });

  it('moves the roof and the nose and lists each change in the attribution text', () => {
    const before = modelBounds(buildModel(ART_ASSETS.find((a) => a.id === 'traffic.sedan') as (typeof ART_ASSETS)[number], 'hi'));
    const r = remodelVehicle(base(), { roofOffsetM: 0.12, roofFromY: 1.0, hoodOffsetM: -0.05, hoodFromZ: 1.2, hoodAboveY: 0.6 });
    expect(modelBounds(r.doc)[4]).toBeCloseTo(before[4] + 0.12, 2);
    expect(r.changes.some((c) => c.startsWith('raised the roof by 0.12 m'))).toBe(true);
    expect(r.changes.some((c) => c.startsWith('lowered the nose line by 0.05 m'))).toBe(true);
    expect(changesText(r.changes)).toContain('; ');
    expect(modelStats(r.doc).tris).toBeGreaterThan(0);
  });

  it('is deterministic', () => {
    const a = remodelVehicle(base(), { size: [1.9, 1.4, 4.9], roofOffsetM: 0.1 });
    const b = remodelVehicle(base(), { size: [1.9, 1.4, 4.9], roofOffsetM: 0.1 });
    expect(a.changes).toEqual(b.changes);
    expect(modelBounds(a.doc)).toEqual(modelBounds(b.doc));
  });
});
