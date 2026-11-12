/**
 * M02h8 AC-2 and AC-3: the `xr` look profile.
 *
 *  - the materials: the `xr` set builds no value-noise and no bump node (every noise helper of `look/noise.ts` and `bumpNormal` are counted
 *    while the set is made; `min` and `full` build some, `xr` none), has no normal node, and on a tier that swaps chunks hard (`xr-quest`,
 *    fade 0) its L0 materials have `alphaTest` 0 and no opacity node, while the coarse levels keep the discard of their cover mask;
 *  - the layers: `grade`, `haze`, `markings`, `skyReflect`, `blob`, `ao`, and the paint is `flat`;
 *  - the legacy path: an XR tier on `legacy` (the fallback, `?look=0`, `?look=legacy`) keeps `chunk` and `coarse` and M02h1's roads material;
 *  - the fog: the world fog of both XR kinds (`linear-fade` on Quest, `height` on Vision Pro) and the backdrop fog carry the grade and the
 *    haze when a look is on, and are M02b2's nodes without one;
 *  - AC-3: on the `synth` bake the mesher runs twice on every L0 unit for `xr-quest`; the buffers, `surf` and `facade` included, are
 *    byte-identical and no unit exceeds 2,097,152 upload bytes.
 */
import { describe, expect, it, vi } from 'vitest';
import type { QualityTierId } from '@dv/shared';

const counts = vi.hoisted(() => ({ noise: 0, bump: 0 }));
vi.mock('../src/client/look/noise.ts', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  const wrap = (name: string, key: 'noise' | 'bump'): Record<string, unknown> => {
    const fn = real[name] as (...a: unknown[]) => unknown;
    if (typeof fn !== 'function') throw new Error(`look/noise.ts no longer exports ${name}: update look.xr.spec.ts`);
    return { [name]: (...a: unknown[]) => (counts[key]++, fn(...a)) };
  };
  return {
    ...real,
    ...wrap('vnoise', 'noise'), ...wrap('vnoiseAA', 'noise'), ...wrap('fbm2', 'noise'), ...wrap('fbm2AA', 'noise'), ...wrap('fbm3', 'noise'), ...wrap('fbm3AA', 'noise'),
    ...wrap('macroNoiseNode', 'noise'), ...wrap('bumpNormal', 'bump'),
  };
});

import { TIERS } from '@dv/engine/platform/tier-config';
import { gradeOwner } from '@dv/engine/platform/post';
import { DepthRules } from '../src/client/chunks/depth.ts';
import { createWorldMaterials } from '../src/client/chunks/materials.ts';
import type { MeshBuffers, UnitMesh } from '../src/client/chunks/mesh-types.ts';
import { furnitureKindsOf, meshChunk, parkedDressingRecords } from '../src/client/chunks/mesher.ts';
import { createLookNodes } from '../src/client/look/common.ts';
import { LOOK, LOOK_LAYERS, XR_TIER_IDS, isXrTierId, layersOf, lookProfileFor } from '../src/client/look/config.ts';
import { createLookMaterials, type MaterialProfile } from '../src/client/look/look-materials.ts';
import { isSurfaceId } from '../src/client/look/surfaces.ts';
import { createBackdropFog, createWorldFog } from '../src/client/sky/fog.ts';
import { createSkyNodes } from '../src/client/sky/nodes.ts';
import { SKY_TIERS } from '../src/client/sky/tiers.ts';
import { basePlan } from '../src/sim/streaming/plan.ts';
import { STREAMING_FADE_SECONDS } from '../src/client/world-view.ts';
import { bakeTiles } from './curbs.support.ts';

function build(profile: MaterialProfile, hardSwap = false): { set: ReturnType<typeof createLookMaterials>; noise: number; bump: number } {
  counts.noise = 0;
  counts.bump = 0;
  const set = createLookMaterials({ profile, look: LOOK, nodes: createLookNodes(createSkyNodes(), hardSwap ? 0 : 0.5), foundationM: 1.5, parapetM: 0.5, depth: new DepthRules(), ...(hardSwap ? { hardSwap: true } : {}) });
  return { set, noise: counts.noise, bump: counts.bump };
}

type Mat = { alphaTest: number; opacityNode: unknown; normalNode: unknown; colorNode: unknown; roughnessNode: unknown; emissiveNode: unknown; positionNode: unknown; transparent: boolean };
const mats = (m: Partial<Record<string, unknown>>): [string, Mat][] => Object.entries(m) as [string, Mat][];

describe('the xr material set (M02h8 AC-2)', () => {
  it('builds no noise and no bump node, where min and full build both kinds or the noise', () => {
    const xr = build('xr', true);
    expect(xr.noise, 'value-noise nodes of the xr set').toBe(0);
    expect(xr.bump, 'bump nodes of the xr set').toBe(0);
    xr.set.dispose();
    // the counter sees the other profiles' noise (the ground of `min` still computes it for its roughness; `full` adds the bump)
    const min = build('min');
    expect(min.noise).toBeGreaterThan(0);
    expect(min.bump).toBe(0);
    min.set.dispose();
    const full = build('full');
    expect(full.noise).toBeGreaterThan(min.noise);
    expect(full.bump).toBeGreaterThan(0);
    full.set.dispose();
    // without the hard swap (xr-visionpro) the graph is as free of them
    const vp = build('xr', false);
    expect([vp.noise, vp.bump]).toEqual([0, 0]);
    vp.set.dispose();
  });

  it('one material per object kind of L0 and of the coarse levels, none with a normal node', () => {
    const { set } = build('xr', true);
    expect(Object.keys(set.l0).sort()).toEqual(['buildings', 'roads', 'terrain', 'vegetation']);
    expect(Object.keys(set.coarse).sort()).toEqual(['massing', 'roads', 'terrain']);
    for (const [kind, m] of [...mats(set.l0), ...mats(set.coarse)]) {
      expect(m.colorNode, kind).toBeTruthy();
      expect(m.normalNode, `${kind}: no bump, no wave`).toBeFalsy();
      expect(m.transparent, kind).toBe(false);
    }
    // the buildings keep the window mask and the glass reflection in the emissive term (the `min` wall path)
    expect((set.l0.buildings as unknown as Mat).emissiveNode).toBeTruthy();
    // the L0 roads keep the `curbs` switch of the sidewalk ribbons (a position node), the terrain has none
    expect((set.l0.roads as unknown as Mat).positionNode).toBeTruthy();
    expect((set.l0.terrain as unknown as Mat).positionNode).toBeFalsy();
    set.dispose();
  });

  it('xr-quest (fade 0): the L0 materials have alphaTest 0 and no opacity node; the coarse cover masks keep their discard', () => {
    expect(STREAMING_FADE_SECONDS['xr-quest']).toBe(0);
    const { set } = build('xr', true);
    for (const [kind, m] of mats(set.l0)) {
      expect(m.alphaTest, `l0 ${kind}`).toBe(0);
      expect(m.opacityNode, `l0 ${kind}`).toBeFalsy();
    }
    for (const [kind, m] of mats(set.coarse)) {
      expect(m.alphaTest, `coarse ${kind}`).toBe(0.5);
      expect(m.opacityNode, `coarse ${kind}`).toBeTruthy();
    }
    set.dispose();
  });

  it('xr-visionpro (fade 0.5): the L0 materials keep the fade (alphaTest 0.5), the tree pools stay opaque', () => {
    expect(STREAMING_FADE_SECONDS['xr-visionpro']).toBeGreaterThan(0);
    const { set } = build('xr', false);
    for (const [kind, m] of mats(set.l0)) {
      if (kind === 'vegetation') {
        expect(m.alphaTest).toBe(0);
        continue;
      }
      expect(m.alphaTest, `l0 ${kind}`).toBe(0.5);
      expect(m.opacityNode, `l0 ${kind}`).toBeTruthy();
    }
    set.dispose();
  });

  it('createWorldMaterials builds the look materials for xr with the hard swap from the tier fade, and the flat paint', () => {
    const quest = createWorldMaterials({ fadeSeconds: STREAMING_FADE_SECONDS['xr-quest'], look: { profile: 'xr' } });
    expect(quest.look).not.toBeNull();
    expect(quest.lookOn()).toBe(true);
    expect(quest.materialFor('l0', 'terrain')).toBe(quest.look?.l0.terrain);
    expect((quest.materialFor('l0', 'buildings') as unknown as Mat).alphaTest).toBe(0);
    expect((quest.materialFor('l1', 'massing') as unknown as Mat).alphaTest).toBe(0.5);
    expect(quest.markings.base).toBe('flat');
    expect(quest.markings.mode()).toBe('flat');
    quest.dispose();
    const vp = createWorldMaterials({ fadeSeconds: STREAMING_FADE_SECONDS['xr-visionpro'], look: { profile: 'xr' } });
    expect((vp.materialFor('l0', 'buildings') as unknown as Mat).alphaTest).toBe(0.5);
    vp.dispose();
  });

  it('the legacy fallback of an XR tier keeps chunk and coarse and M02h1\'s roads material with the flat paint', () => {
    const m = createWorldMaterials({ fadeSeconds: 0, look: { profile: 'legacy' }, xrMarkings: true });
    expect(m.look).toBeNull();
    expect(m.lookOn()).toBe(false);
    expect(m.materialFor('l0', 'terrain')).toBe(m.chunk);
    expect(m.materialFor('l2', 'terrain')).toBe(m.coarse);
    expect(m.materialFor('l0', 'roads')).not.toBe(m.chunk);
    expect(m.markings.base).toBe('flat');
    expect(m.markings.mode()).toBe('flat');
    m.dispose();
  });

  it('the ao layer: the uniform the xr shade term reads starts on', () => {
    const n = createLookNodes(createSkyNodes(), 0);
    expect(n.uAO.value).toBe(1);
  });
});

describe('the xr profile as data (M02h8 AC-2)', () => {
  it('both XR tiers map to xr; its layers are the six of the milestone, each a known layer', () => {
    for (const t of XR_TIER_IDS) {
      expect(isXrTierId(t)).toBe(true);
      expect(LOOK.tierProfile[t]).toBe('xr');
      expect(lookProfileFor(t, true)).toBe('xr');
    }
    expect(isXrTierId('desktop')).toBe(false);
    expect(layersOf('xr')).toEqual(['grade', 'haze', 'markings', 'skyReflect', 'blob', 'ao']);
    for (const id of layersOf('xr')) expect(LOOK_LAYERS).toContain(id);
    // the rest off: no shadow casters, no window schedule, no curbs, bump, macro, lots or facade kit
    for (const id of ['casters', 'windows', 'curbs', 'bump', 'macro', 'lots', 'facade'] as const) expect(layersOf('xr')).not.toContain(id);
    expect(LOOK.bump.xr).toBe(0);
  });

  it('the XR tiers draw straight to the canvas: no post node, no tonemap node, so the fog nodes own the grade once', () => {
    for (const t of XR_TIER_IDS) {
      expect(TIERS[t].features.pipeline).toBe('direct');
      expect(TIERS[t].features.post).toEqual([]);
    }
    // a direct list has no `tonemap` node to own the grade: the fog nodes run it (`LookView.gradeOwner` on the direct pipeline)
    expect(gradeOwner([], 'direct')).toBe('fog');
    expect(gradeOwner(['tonemap'], 'direct')).toBe('fog');
  });

  it('Quest has blob shadows by its tier; Vision Pro has its shadow map off in look.json (two view passes), blobs on', () => {
    expect(TIERS['xr-quest'].features.shadows.mode).toBe('blob');
    expect(TIERS['xr-visionpro'].features.shadows.mode).toBe('csm1');
    expect(LOOK.shadowsOff).toContain('xr-visionpro');
    expect(LOOK.shadowsOff).not.toContain('xr-quest');
  });

  it('no street furniture and no parked dressing on xr (scope of M11b1)', () => {
    expect(furnitureKindsOf('xr').size).toBe(0);
    expect(furnitureKindsOf('legacy').size).toBe(0);
    expect(furnitureKindsOf('min').size).toBeGreaterThan(0);
  });
});

describe('the fog of the XR tiers (M02h8)', () => {
  it('Quest fades linearly to its draw distance and Vision Pro has the height fog', () => {
    expect(SKY_TIERS['xr-quest'].fog).toBe('linear-fade');
    expect(SKY_TIERS['xr-visionpro'].fog).toBe('height');
  });

  it('with a look the world fog of both kinds and the backdrop fog are other graphs than the plain M02b2 nodes, reading the grade and haze uniforms', () => {
    const n = createSkyNodes();
    const uses = (node: unknown, target: unknown): boolean => {
      const seen = new Set<unknown>();
      const walk = (x: unknown): boolean => {
        if (x === target) return true;
        if (x === null || typeof x !== 'object' || seen.has(x)) return false;
        seen.add(x);
        for (const v of Object.values(x as Record<string, unknown>)) {
          if (Array.isArray(v) ? v.some(walk) : walk(v)) return true;
        }
        return false;
      };
      return walk(node);
    };
    for (const kind of ['linear-fade', 'height'] as const) {
      const plain = createWorldFog(n, kind, false);
      const look = createWorldFog(n, kind, true);
      expect(uses(look, n.look.haze.weight), `${kind}: haze`).toBe(true);
      expect(uses(look, n.look.grade.weight), `${kind}: grade`).toBe(true);
      expect(uses(plain, n.look.haze.weight), `${kind} plain`).toBe(false);
      expect(uses(plain, n.look.grade.weight), `${kind} plain`).toBe(false);
    }
    expect(uses(createBackdropFog(n, true), n.look.grade.weight)).toBe(true);
    expect(uses(createBackdropFog(n, true), n.look.haze.weight)).toBe(true);
    expect(uses(createBackdropFog(n, false), n.look.grade.weight)).toBe(false);
  });
});

// ---- AC-3: the mesher on the synth bake -----------------------------------------------------------------------------------

const XR_QUEST_CAP = 2_097_152;
const eq = (x: ArrayBufferView | undefined, y: ArrayBufferView | undefined): boolean =>
  (x === undefined && y === undefined) || (x !== undefined && y !== undefined && Buffer.compare(Buffer.from(x.buffer, x.byteOffset, x.byteLength), Buffer.from(y.buffer, y.byteOffset, y.byteLength)) === 0);
const same = (a: MeshBuffers, b: MeshBuffers): boolean =>
  a.kind === b.kind && eq(a.positions, b.positions) && eq(a.normals, b.normals) && eq(a.colors, b.colors) && eq(a.ao, b.ao) && eq(a.indices, b.indices) && eq(a.surf, b.surf) && eq(a.facade, b.facade) && eq(a.road, b.road);

describe('the mesher on the synth bake for xr-quest (M02h8 AC-3)', () => {
  // every tile of the bake (the helper sorts them; 4096 is more than the synth bake has)
  const tiles = bakeTiles('synth', 'look.xr synth bake', 4096);

  it('the Quest tier has the 2 MiB upload cap (C13) and Vision Pro none', () => {
    expect(TIERS['xr-quest'].budget.world.maxChunkUploadBytes).toBe(XR_QUEST_CAP);
    expect(basePlan('xr-quest').uploadBytes).toBe(XR_QUEST_CAP);
    expect(basePlan('xr-visionpro').uploadBytes).toBeNull();
  });

  it('two runs on every L0 unit are byte-identical, surf and facade included, and no unit exceeds 2,097,152 upload bytes', () => {
    if (tiles.length === 0) return;
    const tier: QualityTierId = 'xr-quest';
    let units = 0, withFacade = 0, largest = 0, largestKey = '', kit = 0;
    for (const t of tiles) {
      for (const sim of t.sims) {
        const render = t.renders.find((r) => r.key === sim.key) ?? null;
        // the options of the mesh job (`jobs.ts`): the tier, the tile for the road context and the tier's upload cap
        const opts = { tier, distM: 0, tile: t.sims, maxBytes: basePlan(tier).uploadBytes };
        const a: UnitMesh = meshChunk(sim, render, opts);
        const b: UnitMesh = meshChunk(sim, render, opts);
        expect(a.objects.length, sim.key).toBe(b.objects.length);
        a.objects.forEach((o, i) => expect(same(o, b.objects[i] as MeshBuffers), `${sim.key} ${o.kind}`).toBe(true));
        for (const o of a.objects) {
          const n = o.positions.length / 3;
          // `surf` on every object, `facade` on the buildings: the xr look reads both
          expect(o.surf.length, `${sim.key} ${o.kind} surf`).toBe(n * 4);
          for (let i = 0; i < n; i++) if (!isSurfaceId(o.surf[i * 4] as number)) throw new Error(`${sim.key} ${o.kind}: surface id ${String(o.surf[i * 4])} at vertex ${i}`);
          if (o.kind === 'buildings') {
            expect(o.facade, `${sim.key} facade`).toBeDefined();
            expect((o.facade as Int16Array).length).toBe(n * 4);
            withFacade++;
          }
        }
        expect(a.stats.bytes, `${sim.key} upload bytes`).toBeLessThanOrEqual(XR_QUEST_CAP);
        if (a.stats.bytes > largest) {
          largest = a.stats.bytes;
          largestKey = sim.key;
        }
        // no facade kit geometry (the xr look has no `facade` layer), no furniture and no parked dressing records
        kit += a.stats.kit?.triangles ?? 0;
        expect(a.furniture?.length ?? 0, `${sim.key} furniture`).toBe(0);
        expect(parkedDressingRecords(sim, tier, 'xr').length).toBe(0);
        units++;
      }
    }
    expect(units).toBeGreaterThan(100);
    expect(withFacade).toBeGreaterThan(0);
    expect(kit, 'facade kit triangles on xr-quest').toBe(0);
    console.log(`look.xr AC-3: ${units} L0 units of ${tiles.length} tiles meshed twice for xr-quest; the largest is ${largestKey} at ${largest} bytes (${((largest / XR_QUEST_CAP) * 100).toFixed(1)} % of the cap)`);
  }, 600_000);
});
