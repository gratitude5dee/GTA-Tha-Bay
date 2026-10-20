/**
 * M02e: the look materials build their TSL graphs for every profile (a graph error such as a branch outside a function throws while
 * the material is made), one material per object kind and level, shared between kinds where the kind has the same surface rules,
 * and `WorldMaterials` chooses between them and the legacy pair.
 */
import { describe, expect, it } from 'vitest';
import { createWorldMaterials } from '../src/client/chunks/materials.ts';
import { LOOK } from '../src/client/look/config.ts';
import { createFacadeAtlasHook } from '../src/client/look/facade.ts';
import { createLookMaterials } from '../src/client/look/look-materials.ts';
import { createLookNodes } from '../src/client/look/common.ts';
import { createSkyNodes } from '../src/client/sky/nodes.ts';
import { waveNormal } from '../src/client/look/water.ts';

describe('createLookMaterials', () => {
  for (const profile of ['full', 'lite', 'min'] as const) {
    it(`${profile}: builds one material per object kind of L0 and of the coarse levels`, () => {
      const nodes = createLookNodes(createSkyNodes(), 0.5);
      const set = createLookMaterials({ profile, look: LOOK, nodes, foundationM: 1.5, parapetM: 0.5 });
      expect(Object.keys(set.l0).sort()).toEqual(['buildings', 'roads', 'terrain', 'vegetation']);
      expect(Object.keys(set.coarse).sort()).toEqual(['massing', 'roads', 'terrain']);
      // Terrain and roads share the ground material of their level, so the pipelines stay few.
      expect(set.l0.terrain).toBe(set.l0.roads);
      expect(set.coarse.terrain).toBe(set.coarse.roads);
      for (const m of [...Object.values(set.l0), ...Object.values(set.coarse)]) {
        expect(m?.alphaTest).toBe(0.5);
        expect(m?.opacityNode).toBeTruthy();
      }
      // The coarse surfaces sit behind a detailed L0 wall in depth (reversed depth buffer: a negative offset is farther); L0 has none.
      for (const m of Object.values(set.coarse)) {
        expect(m?.polygonOffset).toBe(true);
        expect(m?.polygonOffsetFactor).toBeLessThan(0);
        expect(m?.polygonOffsetUnits).toBeLessThan(0);
      }
      for (const m of Object.values(set.l0)) expect(m?.polygonOffset).toBe(false);
      set.dispose();
    });
  }

  it('the building material of full has glass metalness and a night emissive node; min has the emissive window mask only', () => {
    const nodes = createLookNodes(createSkyNodes(), 0);
    const full = createLookMaterials({ profile: 'full', look: LOOK, nodes, foundationM: 1.5, parapetM: 0.5 });
    const min = createLookMaterials({ profile: 'min', look: LOOK, nodes, foundationM: 1.5, parapetM: 0.5 });
    expect(full.l0.buildings?.metalnessNode).toBeTruthy();
    expect(full.l0.buildings?.emissiveNode).toBeTruthy();
    expect(min.l0.buildings?.emissiveNode).toBeTruthy();
    // The water of min is a flat colour: its ground material sets no normal node.
    expect((min.l0.terrain as unknown as { normalNode: unknown }).normalNode).toBeFalsy();
    expect((full.l0.terrain as unknown as { normalNode: unknown }).normalNode).toBeTruthy();
    full.dispose();
    min.dispose();
  });
});

describe('WorldMaterials with a look', () => {
  it('chooses the look material while the look is on and the legacy pair when it is off', () => {
    const m = createWorldMaterials({ fadeSeconds: 0.5, look: { profile: 'full' } });
    expect(m.lookOn()).toBe(true);
    expect(m.materialFor('l0', 'buildings')).toBe(m.look?.l0.buildings);
    expect(m.materialFor('l1', 'massing')).toBe(m.look?.coarse.massing);
    expect(m.setLook(false)).toBe(true);
    expect(m.materialFor('l0', 'buildings')).toBe(m.chunk);
    expect(m.materialFor('l2', 'terrain')).toBe(m.coarse);
    expect(m.setLook(true)).toBe(true);
    m.dispose();
  });

  it('a legacy tier has no look materials and refuses to switch one on', () => {
    const m = createWorldMaterials({ fadeSeconds: 0, look: { profile: 'legacy' } });
    expect(m.look).toBeNull();
    expect(m.lookOn()).toBe(false);
    expect(m.setLook(true)).toBe(false);
    expect(m.materialFor('l0', 'terrain')).toBe(m.chunk);
    const none = createWorldMaterials({ fadeSeconds: 0 });
    expect(none.look).toBeNull();
    m.dispose();
    none.dispose();
  });

  it('the clocks reach both the legacy and the look nodes', () => {
    const m = createWorldMaterials({ fadeSeconds: 0.5, look: { profile: 'lite' } });
    m.setTime(12);
    m.setLookTime(7);
    m.setFadeSeconds(0.25);
    expect(m.lookNodes.uTime.value).toBe(12);
    expect(m.lookNodes.uLook.value).toBe(7);
    expect(m.lookNodes.uFade.value).toBe(0.25);
    m.dispose();
  });
});

describe('water and the façade atlas hook', () => {
  it('builds the wave normal for four, two and one waves', () => {
    const nodes = createLookNodes(createSkyNodes(), 0);
    for (const count of [4, 2, 1]) expect(waveNormal(LOOK, nodes, count)).toBeTruthy();
  });

  it('the atlas hook stores a texture or null and no shader reads it in this milestone', () => {
    const hook = createFacadeAtlasHook();
    expect(hook.get()).toBeNull();
    const tex = {} as never;
    hook.set(tex);
    expect(hook.get()).toBe(tex);
    hook.set(null);
    expect(hook.get()).toBeNull();
  });
});
