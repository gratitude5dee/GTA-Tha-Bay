import { describe, expect, it } from 'vitest';
import { Group, MeshStandardNodeMaterial } from 'three/webgpu';
import { Rng, splitmix32 } from '@dv/shared';
import { TREE_STRIDE } from '../src/client/chunks/mesher.ts';
import { POOLS_PER_SET, PoolLayout, VegetationPools } from '../src/client/chunks/vegetation-pool.ts';

/**
 * M02h4 AC-4: the vegetation pools under 200 scripted unit adds, removals and `drawM` crossings. Each drawn unit's instances appear once in
 * the prefix, `count` is the sum of the drawn ranges, freed ranges are reused, capacity only doubles, only the `near` pools cast and hold
 * only units within `dynamicCasterRadiusM`, and the pool counts are 10 / 5 / 2.
 */

/** Every invariant of a layout: no two ranges overlap, the drawn ones tile `[0, count)` in prefix order, the hidden ones and the free list tile `[count, capacity)`. */
function checkLayout(l: PoolLayout, live: Map<string, { len: number; drawn: boolean }>): void {
  // the capacity is a power of two, at least the minimum
  expect(Math.log2(l.capacity) % 1).toBe(0);
  let at = 0;
  let sum = 0;
  for (const id of l.order) {
    const r = l.ranges.get(id);
    expect(r, `${id} in the prefix has a range`).toBeDefined();
    expect(r!.drawn).toBe(true);
    expect(r!.start, `${id} packed at the front`).toBe(at);
    at += r!.len;
    sum += r!.len;
  }
  expect(l.count, 'count is the sum of the drawn ranges').toBe(sum);
  expect(new Set(l.order).size, 'each drawn unit once in the prefix').toBe(l.order.length);
  // the cells beyond the prefix: each in exactly one hidden range or free interval
  const cells = new Int32Array(l.capacity);
  for (const [, r] of l.ranges) for (let i = r.start; i < r.start + r.len; i++) cells[i] = (cells[i] as number) + 1;
  for (const [a, b] of l.free) {
    expect(a, 'free intervals lie beyond the prefix').toBeGreaterThanOrEqual(l.count);
    for (let i = a; i < b; i++) cells[i] = (cells[i] as number) + 1;
  }
  for (let i = 0; i < l.capacity; i++) expect(cells[i], `cell ${i} covered once`).toBe(1);
  for (let i = 1; i < l.free.length; i++) expect(l.free[i]![0]).toBeGreaterThan(l.free[i - 1]![1]);
  // the layout agrees with the script
  expect(l.ranges.size).toBe(live.size);
  for (const [id, u] of live) {
    const r = l.ranges.get(id)!;
    expect(r.len).toBe(u.len);
    expect(r.drawn).toBe(u.drawn);
  }
}

describe('pool layout (AC-4)', () => {
  it('200 scripted adds, removals and drawM crossings keep every invariant; capacity only doubles', () => {
    const rng = new Rng(splitmix32(20261101));
    const l = new PoolLayout();
    const live = new Map<string, { len: number; drawn: boolean }>();
    let next = 0;
    let cap = l.capacity;
    for (let step = 0; step < 200; step++) {
      const r = rng.nextFloat();
      const ids = [...live.keys()];
      if (r < 0.4 || ids.length === 0) {
        const id = `u${next++}`;
        const len = 1 + (rng.nextU32() % 40);
        const drawn = rng.nextFloat() < 0.7;
        l.add(id, len, drawn);
        live.set(id, { len, drawn });
      } else if (r < 0.65) {
        const id = ids[rng.nextU32() % ids.length] as string;
        l.remove(id);
        live.delete(id);
      } else {
        const id = ids[rng.nextU32() % ids.length] as string;
        const u = live.get(id)!;
        l.setDrawn(id, !u.drawn);
        u.drawn = !u.drawn;
      }
      checkLayout(l, live);
      // capacity only grows, by doubling
      if (l.capacity !== cap) {
        expect(l.capacity / cap % 2, `step ${step}: capacity ${cap} -> ${l.capacity}`).toBe(0);
        expect(l.capacity).toBeGreaterThan(cap);
      }
      cap = l.capacity;
    }
    expect(l.grows).toBeGreaterThan(0);
  });

  it('a freed range is reused: a unit of the same size after a removal takes no new capacity', () => {
    const l = new PoolLayout(64);
    l.add('a', 20, false);
    l.add('b', 20, false);
    l.add('c', 20, false);
    const cap = l.capacity;
    const at = l.ranges.get('b')!.start;
    l.remove('b');
    l.add('d', 20, false);
    expect(l.capacity).toBe(cap);
    expect(l.ranges.get('d')!.start).toBe(at);
    // the drawn prefix: a removal slides only the tail, and the new unit joins at the end
    const p = new PoolLayout(64);
    p.add('x', 5, true);
    p.add('y', 7, true);
    p.add('z', 3, true);
    const writes = p.remove('x');
    expect(writes.map((w) => w.id)).toEqual(['y', 'z']);
    expect(p.ranges.get('y')!.start).toBe(0);
    expect(p.ranges.get('z')!.start).toBe(7);
    expect(p.count).toBe(10);
    const join = p.add('w', 4, true);
    expect(join[0]).toEqual({ id: 'w', start: 10, len: 4 });
  });
});

// ---- the meshes ----------------------------------------------------------------------------------------------------------------

/** A unit's tree records: `n` trees, forms cycling 0..4 from `seed`, heights 6..20 m. */
function unitTrees(n: number, seed: number): Float32Array {
  const t = new Float32Array(n * TREE_STRIDE);
  for (let i = 0; i < n; i++) {
    const o = i * TREE_STRIDE;
    t[o] = 10 + ((i * 37) % 230);
    t[o + 1] = 2;
    t[o + 2] = 10 + ((i * 53) % 230);
    t[o + 3] = 6 + ((i + seed) % 15);
    t[o + 4] = (i * 0.7) % 6.28;
    t[o + 5] = ((i + seed) % 5) + 8 * ((i * 3) % 8);
  }
  return t;
}

describe('vegetation pools (AC-4)', () => {
  const mat = new MeshStandardNodeMaterial();
  const make = (set: 'full' | 'lite' | 'low' | 'cone'): { pools: VegetationPools; parent: Group } => {
    const parent = new Group();
    return { pools: new VegetationPools({ parent, set, material: () => mat, receiveShadow: () => false }), parent };
  };

  it('the pool counts are 10 on full, 5 on lite, 2 on low and 1 cone', () => {
    for (const [set, n] of [['full', 10], ['lite', 5], ['low', 2], ['cone', 1]] as const) {
      const { pools, parent } = make(set);
      expect(pools.poolCount, set).toBe(n);
      expect(POOLS_PER_SET[set]).toBe(n);
      expect(parent.children.length).toBe(n);
      for (const c of parent.children) expect((c as { frustumCulled: boolean }).frustumCulled).toBe(false);
      pools.dispose();
    }
  });

  it('200 scripted steps on full: drawn instances in the prefixes match the units, only the near pools cast and hold only near units', () => {
    const { pools } = make('full');
    pools.setCasting(true);
    const rng = new Rng(splitmix32(4242));
    const live = new Map<string, { n: number; drawn: boolean; near: boolean }>();
    let next = 0;
    let caps = pools.keys().map((k) => k.capacity);
    for (let step = 0; step < 200; step++) {
      const r = rng.nextFloat();
      const ids = [...live.keys()];
      if (r < 0.35 || ids.length === 0) {
        const id = `l0:9/${next}/${next}`;
        const n = 1 + (rng.nextU32() % 30);
        const drawn = rng.nextFloat() < 0.7;
        const near = rng.nextFloat() < 0.3;
        pools.addUnit(id, unitTrees(n, next), next * 256, 0, drawn, near);
        live.set(id, { n, drawn, near });
        next++;
      } else if (r < 0.55) {
        const id = ids[rng.nextU32() % ids.length] as string;
        pools.removeUnit(id);
        live.delete(id);
      } else if (r < 0.85) {
        const id = ids[rng.nextU32() % ids.length] as string;
        const u = live.get(id)!;
        pools.setDrawn(id, !u.drawn);
        u.drawn = !u.drawn;
      } else {
        const id = ids[rng.nextU32() % ids.length] as string;
        const u = live.get(id)!;
        pools.setNear(id, !u.near);
        u.near = !u.near;
      }
      // the drawn instances: every drawn unit's trees once, in its band's pools
      let want = 0;
      for (const u of live.values()) if (u.drawn) want += u.n;
      expect(pools.drawnInstances(), `step ${step}`).toBe(want);
      for (const p of pools.pools) {
        expect(p.mesh.count).toBe(p.layout.count);
        expect(p.mesh.visible).toBe(p.layout.count > 0);
        // only the near pools cast; a near pool holds only near units, a far pool only far ones
        expect(p.mesh.castShadow).toBe(p.band === 'near');
        for (const id of p.layout.ranges.keys()) expect(live.get(id)!.near, `${p.key} holds ${id}`).toBe(p.band === 'near');
        // the instance data of each drawn range is its unit's source
        for (const id of p.layout.order) {
          const r = p.layout.ranges.get(id)!;
          const src = p.src.get(id)!;
          expect(Array.from(p.matrices.subarray(r.start * 16, (r.start + r.len) * 16))).toEqual(Array.from(src.m.subarray(0, r.len * 16)));
        }
      }
      // capacities only double
      const now = pools.keys().map((k) => k.capacity);
      now.forEach((c, i) => expect(c === caps[i] || c === (caps[i] as number) * 2 || c % (caps[i] as number) === 0).toBe(true));
      caps = now;
    }
    // the casters switched off: no pool casts
    pools.setCasting(false);
    for (const p of pools.pools) expect(p.mesh.castShadow).toBe(false);
    pools.dispose();
  });

  it('the totals count one render object per pool that draws, with the drawn instances triangles', () => {
    const { pools } = make('low');
    expect(pools.totals().objects).toBe(0);
    pools.addUnit('a', unitTrees(10, 0), 0, 0, true, false);
    const t = pools.totals();
    // forms 0..4 cycle: the palm (form 4) and the crown (the rest) both draw
    expect(t.objects).toBe(2);
    const r = pools.report();
    expect(r.set).toBe('low');
    expect(r.forms.reduce((n, f) => n + f.instances, 0)).toBe(10);
    expect(r.forms.reduce((n, f) => n + f.tris, 0)).toBe(t.triangles);
    pools.setDrawn('a', false);
    expect(pools.totals().objects).toBe(0);
    pools.dispose();
  });
});
