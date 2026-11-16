/**
 * M02h6: the global furniture pools under chunk churn: a unit's records take slots on upload and give them back on unload (zero-scale
 * matrices, the count lowered past freed slots at the top); a pool at its cap gives the farthest unit's slots to a nearer one; one render
 * object per drawing pool, none with the `furniture` layer or the look off; the kit stays within 24 to 150 triangles per item.
 */
import { Group, type InstancedMesh } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { FurnitureKind, type UnitMesh } from '../src/client/chunks/mesh-types.ts';
import { FurniturePools } from '../src/client/furniture/pools.ts';
import { FURNITURE_POOLS, kitGeometry } from '../src/client/furniture/kit.ts';
import { createSkyNodes } from '../src/client/sky/nodes.ts';

const program = { id: 1, cycleTicks: 120, offsetTicks: 0, pedWalkTicks: 0, phases: [{ startTick: 0, greenTicks: 50, amberTicks: 10, clearTicks: 0, movements: [3] }] };

function unit(key: string, ox: number, oz: number, kinds: number[]): UnitMesh {
  const f: number[] = [];
  kinds.forEach((k, i) => f.push(k, 10 + i * 3, 1, 20, 0.5, k === FurnitureKind.signal ? 0 : k === FurnitureKind.wire ? 12 : 0));
  return {
    level: 'l0', key: key as UnitMesh['key'], originX: ox, originZ: oz, objects: [], trees: new Float32Array(0), lamps: new Float32Array(0), furniture: Float32Array.from(f),
    heads: kinds.includes(FurnitureKind.signal) ? [{ junction: 1, movement: 3, program }] : [], stats: { triangles: 0, vertices: 0, buildings: 0, skipped: 0, maxBuildingTris: 0, filtered: false, bytes: 0 },
    proxies: [], masked: [],
  };
}

const meshes = (p: FurniturePools): Map<string, InstancedMesh> => new Map((p.group.children as InstancedMesh[]).map((m) => [m.name.slice('furniture.'.length), m]));

describe('furniture pools', () => {
  it('the kit: 24 to 150 triangles per item on every profile', () => {
    for (const profile of ['full', 'lite', 'min'] as const) {
      for (const pool of FURNITURE_POOLS) {
        const k = kitGeometry(pool, profile);
        for (const [kind, n] of Object.entries(k.triangles)) {
          expect(n, `${profile} ${pool} kind ${kind}`).toBeGreaterThanOrEqual(24);
          expect(n, `${profile} ${pool} kind ${kind}`).toBeLessThanOrEqual(150);
        }
        expect(k.positions.length / 3).toBeLessThan(65536);
      }
    }
    // min draws no meter and no blade
    expect(kitGeometry('post', 'min').triangles[FurnitureKind.meter]).toBeUndefined();
    expect(kitGeometry('post', 'full').triangles[FurnitureKind.stop]).toBeGreaterThan(kitGeometry('post', 'min').triangles[FurnitureKind.stop] as number);
  });

  it('profiles build their pools: full five, lite three, min two', () => {
    const sky = createSkyNodes();
    for (const [profile, want] of [['full', ['signal', 'post', 'shelter', 'pole', 'wire']], ['lite', ['signal', 'post', 'shelter']], ['min', ['signal', 'post']]] as const) {
      const p = new FurniturePools({ parent: new Group(), profile, sky });
      expect(p.names).toEqual(want);
      p.dispose();
    }
  });

  it('upload and unload under churn: slots return, freed slots are zero scale, counts follow', () => {
    const p = new FurniturePools({ parent: new Group(), profile: 'full', sky: createSkyNodes(), caps: { signal: 64, post: 256, shelter: 32, pole: 64, wire: 64 } });
    const live = new Map<string, number>();
    let seed = 7;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) >>> 0;
      return seed / 4294967296;
    };
    for (let step = 0; step < 300; step++) {
      const id = `l0:9/${Math.floor(rnd() * 12)}/1`;
      if (live.has(id) && rnd() < 0.5) {
        p.removeUnit(id);
        live.delete(id);
      } else {
        const n = 1 + Math.floor(rnd() * 6);
        const kinds = Array.from({ length: n }, () => [FurnitureKind.stop, FurnitureKind.hydrant, FurnitureKind.meter, FurnitureKind.pole, FurnitureKind.signal][Math.floor(rnd() * 5)] as number);
        p.addUnit(id, unit(id, rnd() * 1000, 0, kinds));
        live.set(id, kinds.length);
      }
      const r = p.report();
      const total = Object.values(r.pools).reduce((a, b) => a + b.instances, 0);
      expect(total).toBe([...live.values()].reduce((a, b) => a + b, 0));
    }
    for (const id of [...live.keys()]) p.removeUnit(id);
    for (const m of meshes(p).values()) {
      expect(m.count).toBe(0);
      expect(m.visible).toBe(false);
      expect((m.instanceMatrix.array as Float32Array).every((v) => v === 0)).toBe(true);
    }
    expect(p.objects).toBe(0);
  });

  it('a pool at its cap gives the farthest unit\'s slots to a nearer one', () => {
    const p = new FurniturePools({ parent: new Group(), profile: 'min', sky: createSkyNodes(), caps: { signal: 4, post: 4 } });
    p.setFocus(0, 0);
    p.addUnit('far', unit('9/0/0', 2000, 0, [0, 0, 0, 0]));
    expect(p.report().pools['post']?.instances).toBe(4);
    p.addUnit('near', unit('9/0/1', 0, 0, [0, 0]));
    expect(p.report().pools['post']?.instances).toBe(4);
    // a third, farther still, gets nothing
    p.addUnit('farther', unit('9/0/2', 5000, 0, [0]));
    expect(p.report().pools['post']?.instances).toBe(4);
    expect(p.report().dropped).toBeGreaterThanOrEqual(3);
    p.removeUnit('far');
    expect(p.report().pools['post']?.instances).toBe(2);
  });

  it('one render object per drawing pool; none with the layer or the look off; heads report their aspects', () => {
    const p = new FurniturePools({ parent: new Group(), profile: 'lite', sky: createSkyNodes() });
    p.addUnit('a', unit('9/0/0', 0, 0, [FurnitureKind.stop, FurnitureKind.signal, FurnitureKind.shelter]));
    expect(p.objects).toBe(3);
    p.update(0, false, 0, 0, 0);
    expect(p.report().heads).toMatchObject({ n: 1, total: 1, aspects: { green: 1 } });
    expect(p.headCodes()[0]?.code).toBe(1);
    p.setLayer(false);
    expect(p.objects).toBe(0);
    p.setLayer(true);
    p.setLookOn(false);
    expect(p.objects).toBe(0);
    p.setLookOn(true);
    expect(p.objects).toBe(3);
    // wires and poles are not drawn on lite
    p.addUnit('b', unit('9/0/1', 0, 0, [FurnitureKind.pole, FurnitureKind.wire]));
    expect(p.objects).toBe(3);
    p.dispose();
  });
});
