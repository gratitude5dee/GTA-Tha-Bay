import { SIM_DT } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import type { RayHit, StaticShapeSet } from '../src/sim/physics/backend.ts';
import { GROUP_BIT } from '../src/sim/physics/groups.ts';
import { RapierBackend } from '../src/sim/physics/rapier-backend.ts';
import { groundHeightfield } from './fixtures/world-boxes.ts';

const DOWN: [number, number, number] = [0, -1, 0];

describe('scene queries and the first step (spec/03: Rapier queries see colliders only after a step)', () => {
  it('a ray hits nothing before the first step and hits the ground after it', async () => {
    const b = new RapierBackend('deterministic-compat');
    await b.init();
    b.addChunkStatics('g', { heightfield: groundHeightfield(), prisms: new Float32Array(0) });
    expect(b.castRay([0, 5, 0], DOWN, 20, GROUP_BIT.static)).toBeNull();
    b.step(SIM_DT, 1);
    expect(b.castRay([0, 5, 0], DOWN, 20, GROUP_BIT.static)?.toi).toBeCloseTo(5, 5);
    b.dispose();
  });

  it('a restored snapshot answers queries at once, without a step', async () => {
    const a = new RapierBackend('deterministic-compat');
    await a.init();
    a.addChunkStatics('g', { heightfield: groundHeightfield(), prisms: new Float32Array(0) });
    a.step(SIM_DT, 1);
    const snap = a.snapshot();
    const b = new RapierBackend('deterministic-compat');
    await b.init();
    b.addChunkStatics('g', { heightfield: groundHeightfield(), prisms: new Float32Array(0) });
    b.restore(snap);
    expect(b.castRay([0, 5, 0], DOWN, 20, GROUP_BIT.static)?.toi).toBeCloseTo(5, 5);
    expect(b.castSphere([0, 5, 0], DOWN, 0.25, 20, GROUP_BIT.static)?.toi).toBeCloseTo(4.75, 5);
    a.dispose();
    b.dispose();
  });
});

describe('staticColumn: the statics table answers at once where the queries lag a step (BD-FIX-PARKED-FALL-01)', () => {
  /** A flat 100 m square at y 0 from (0, 0) to (100, 100). */
  const field = (): StaticShapeSet => ({
    heightfield: { nx: 2, nz: 2, cell: 100, heights: new Float32Array(4), at: [0, 0, 0] },
    // an L-shaped building (concave: ear-clipped into triangles) east of the field, from (200, 0) to (240, 40), its notch at (230, 30)
    prisms: Float32Array.from([6, 0, 30, 200, 0, 240, 0, 240, 20, 220, 20, 220, 40, 200, 40]),
  });
  const ray = (b: RapierBackend, x: number, z: number): RayHit | null => b.castRay([x, 500, z], DOWN, 1000, GROUP_BIT.static);

  it('covers the heightfield and the prism pieces, not the notch of a concave prism nor the open ground', async () => {
    const b = new RapierBackend('deterministic-compat');
    await b.init();
    b.addChunkStatics('c', field());
    // before any step the queries see nothing; the table does
    expect(ray(b, 50, 50)).toBeNull();
    for (const [x, z] of [[50, 50], [0, 0], [100, 100], [210, 10], [235, 5], [205, 35]] as const) expect(b.staticColumn(x, z), `${x}, ${z}`).toBe(true);
    for (const [x, z] of [[150, 50], [-1, 50], [50, 101], [230, 30], [239, 39]] as const) expect(b.staticColumn(x, z), `${x}, ${z}`).toBe(false);
    // after a step the queries agree, at every one of those columns
    b.step(SIM_DT, 1);
    for (const [x, z] of [[50, 50], [210, 10], [235, 5], [205, 35]] as const) expect(ray(b, x, z), `${x}, ${z}`).not.toBeNull();
    for (const [x, z] of [[150, 50], [230, 30], [239, 39]] as const) expect(ray(b, x, z), `${x}, ${z}`).toBeNull();
    b.dispose();
  });

  it('stays true through an in-place rebuild and a rebase, and is false once the chunk is removed', async () => {
    const b = new RapierBackend('deterministic-compat');
    await b.init();
    b.addChunkStatics('c', field());
    b.step(SIM_DT, 1);
    // a portal refresh: the chunk's colliders are removed and added again in one go. The queries miss the rebuilt ground until the next
    // step (the new colliders take the freed slots in reverse, so the ground's old entry in the query tree now names a piece of the
    // building; where an old entry and its new collider happen to overlap, as over the building here, a ray may still hit)
    b.removeChunkStatics('c');
    b.addChunkStatics('c', field());
    expect(ray(b, 50, 50)).toBeNull();
    expect(b.staticColumn(50, 50)).toBe(true);
    expect(b.staticColumn(210, 10)).toBe(true);
    b.step(SIM_DT, 1);
    expect(ray(b, 50, 50)).not.toBeNull();
    expect(ray(b, 210, 10)).not.toBeNull();
    // the floating origin moves: the colliders are rebuilt in the new frame, the footprint is ENU
    b.rebase([1000, 0, 0]);
    expect(b.staticColumn(210, 10)).toBe(true);
    expect(b.staticColumn(150, 50)).toBe(false);
    b.removeChunkStatics('c');
    expect(b.staticColumn(50, 50)).toBe(false);
    expect(b.staticColumn(210, 10)).toBe(false);
    b.dispose();
  });

  it('is rebuilt from the shape sets of a restored snapshot', async () => {
    const a = new RapierBackend('deterministic-compat');
    await a.init();
    a.addChunkStatics('c', field());
    a.step(SIM_DT, 1);
    const snap = a.snapshot();
    const b = new RapierBackend('deterministic-compat');
    await b.init();
    b.restore(snap);
    expect(b.staticColumn(50, 50)).toBe(true);
    expect(b.staticColumn(210, 10)).toBe(true);
    expect(b.staticColumn(230, 30)).toBe(false);
    a.dispose();
    b.dispose();
  });
});
