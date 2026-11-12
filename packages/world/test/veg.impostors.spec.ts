import { describe, expect, it } from 'vitest';
import { FrontSide, Group, type InstancedMesh, MeshStandardNodeMaterial } from 'three/webgpu';
import { TreeForm } from '@dv/shared';
import { TREE_STRIDE } from '../src/client/chunks/mesher.ts';
import { IMPOSTOR_TRIS, billboardPosition, buildImpostorSet, createImpostorMaterial } from '../src/client/chunks/impostors.ts';
import { TREE_TRIS_CAP, buildUnderstorySet, geometryOfForm, instanceScaleOf } from '../src/client/chunks/tree-forms.ts';
import { VegetationPools, impostorOfForm } from '../src/client/chunks/vegetation-pool.ts';

/**
 * M02h5 AC-4 (`veg.impostors`): the impostor cards are 8 (crown) and 12 (palm) triangles, flat, front faces toward +z, opaque (no alpha
 * test, alpha-to-coverage, transparency or texture) and never cast; their instances carry no rotation and the horizontal scale in
 * `aTint.w` (the billboard's input). The understory geometries fit the set caps.
 */
describe('impostor cards (M02h5 AC-4)', () => {
  it('crown 8 and palm 12 triangles, flat in z = 0, normals up, every face counter-clockwise from +z', () => {
    for (const g of buildImpostorSet()) {
      expect(g.triangles).toBe(IMPOSTOR_TRIS[g.id as 'imp-crown' | 'imp-palm']);
      for (let i = 2; i < g.positions.length; i += 3) expect(g.positions[i]).toBe(0);
      for (let i = 0; i < g.normals.length; i += 3) expect([g.normals[i], g.normals[i + 1], g.normals[i + 2]]).toEqual([0, 1, 0]);
      for (let t = 0; t < g.indices.length; t += 3) {
        const p = (k: number): [number, number] => [g.positions[g.indices[t + k]! * 3]!, g.positions[g.indices[t + k]! * 3 + 1]!];
        const [a, b, c] = [p(0), p(1), p(2)];
        expect((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]), `${g.id} triangle ${t / 3}`).toBeGreaterThan(0);
      }
      expect(g.sway).toBeNull();
    }
    expect(buildImpostorSet()).toEqual(buildImpostorSet());
  });

  it('the material is opaque, front faces only, with no texture, and a billboard positionNode', () => {
    const veg = new MeshStandardNodeMaterial();
    const m = createImpostorMaterial(veg);
    expect(m.transparent).toBe(false);
    expect(m.alphaTest).toBe(0);
    expect(m.alphaToCoverage).toBe(false);
    expect(m.side).toBe(FrontSide);
    expect(m.map).toBeNull();
    expect(m.positionNode).not.toBeNull();
    expect(billboardPosition()).toBeTruthy();
  });

  it('the understory geometries fit the set caps; on low they are flattened crowns', () => {
    for (const set of ['full', 'lite'] as const) for (const g of buildUnderstorySet(set)) expect(g.triangles, `${set} ${g.id}`).toBeLessThanOrEqual(TREE_TRIS_CAP[set]);
    expect(geometryOfForm('low', TreeForm.Shrub)).toBe('crown');
    expect(geometryOfForm('low', TreeForm.Hedge)).toBe('crown');
    expect(geometryOfForm('lite', TreeForm.Hedge)).toBe('shrub');
    const [sx, sy] = instanceScaleOf('low', TreeForm.Shrub, 1.2);
    expect(sx).toBeGreaterThan(sy);
    expect(impostorOfForm('full', TreeForm.Palm)).toBe('imp-palm');
    expect(impostorOfForm('low', TreeForm.Palm)).toBe('imp-crown');
    expect(impostorOfForm('full', TreeForm.Shrub)).toBeNull();
  });

  it('impostor pools never cast, use the impostor material and write unrotated instances with sx in aTint.w', () => {
    const parent = new Group();
    const mat = new MeshStandardNodeMaterial();
    const imp = createImpostorMaterial(mat);
    const pools = new VegetationPools({
      parent, set: 'full', material: () => mat, receiveShadow: () => true, impostorMaterial: () => imp,
      scatter: { enabled: true, impostors: true, keepTree: 1, keepShrub: 1, impostorM: 150, shrubDrawM: 250, hysteresis: 0.1, rebandM: 16, writeCap: 4096 },
    });
    pools.setCasting(true);
    pools.update(0, 0);
    // two trees 1 km away: both impostors
    const t = new Float32Array(2 * TREE_STRIDE);
    t.set([10, 3, 10, 12, 1.1, TreeForm.Conifer + 64], 0);
    t.set([20, 3, 20, 9, 2.2, TreeForm.Palm + 64], TREE_STRIDE);
    pools.addUnit('u', t, 1000, 1000, true, true);
    const meshes = parent.children as InstancedMesh[];
    const crown = meshes.find((m) => m.name === 'world.vegetation:imp-crown:all')!;
    const palm = meshes.find((m) => m.name === 'world.vegetation:imp-palm:all')!;
    for (const m of meshes) if (m.userData['mode'] === 'impostor') {
      expect(m.castShadow).toBe(false);
      expect(m.material).toBe(imp);
    }
    expect(meshes.some((m) => m.castShadow)).toBe(true);
    expect(crown.count).toBe(1);
    expect(palm.count).toBe(1);
    const e = crown.instanceMatrix.array;
    // column-major: no rotation terms, the scale on the diagonal, the foot in the last column
    expect([e[1], e[2], e[4], e[6], e[8], e[9]]).toEqual([0, 0, 0, 0, 0, 0]);
    expect(e[0]).toBeCloseTo(e[10]!, 6);
    expect([e[12], e[13], e[14]]).toEqual([1010, 3, 1010]);
    const tint = crown.geometry.getAttribute('aTint');
    expect(tint.getW(0)).toBeCloseTo(e[0]!, 6);
    const r = pools.report();
    expect(r.scatter.impostors).toBe(2);
    expect(r.scatter.impostorPools).toBe(2);
    pools.dispose();
  });
});
