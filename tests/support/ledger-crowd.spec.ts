import { readFileSync } from 'node:fs';
import { Group, type Object3D } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { buildNearFigure } from '../../packages/world/src/client/peds/mannequin.ts';
import { PedRenderer } from '../../packages/world/src/client/peds/instances.ts';
import { TRANSIT_ART, TransitRenderer } from '../../packages/world/src/client/transit/render.ts';
import { PED_BODIES } from '../../packages/world/src/sim/peds/components.ts';
import { NEAR_PED_CAP } from '../../packages/world/src/sim/peds/density.ts';
import { NEAR_PED_CAP as PERF_NEAR_PED_CAP, PED_FAR_DRAWS_MAX } from '../../tools/ci/perf-check.ts';
import { crowdMax, crowdParts } from '../e2e/ledger-helpers.ts';

/**
 * BD-FIX-LEDGER-SETTLED-01: the ledger cases hide the transit and the pedestrians in the frame they count, and add `crowdMax(tier)` back
 * in every ceiling they assert. These cases pin `crowdMax` to the renderers and the tables that bound those layers, so that a new
 * pedestrian body, a new transit kind or a larger near cap shows up here instead of quietly widening a ceiling.
 */
type Mesh = Object3D & { isMesh?: boolean; isInstancedMesh?: boolean; isSkinnedMesh?: boolean; castShadow: boolean };
const meshes = (root: Object3D): Mesh[] => {
  const out: Mesh[] = [];
  root.traverse((o) => {
    if ((o as Mesh).isMesh === true) out.push(o as Mesh);
  });
  return out;
};
const transitCounts = (JSON.parse(readFileSync(new URL('../../config/world/transit.json', import.meta.url), 'utf8')) as { counts: Record<string, Record<string, number>> }).counts;
const TIERS = ['desktop-ultra', 'desktop', 'mobile', 'mobile-low', 'xr-quest', 'xr-visionpro'] as const;

describe('crowdMax, the most the hidden crowd draws (BD-FIX-LEDGER-SETTLED-01)', () => {
  it('the far pedestrians are one instanced mesh per body, none casts a shadow', () => {
    const parent = new Group();
    const r = new PedRenderer({ parent, cap: 32, nearCap: 6 });
    const far = meshes(r.group);
    expect(far.length).toBe(PED_BODIES);
    expect(far.every((m) => m.isInstancedMesh === true && !m.castShadow)).toBe(true);
    expect(PED_BODIES).toBe(PED_FAR_DRAWS_MAX);
  });

  it('a near pedestrian is one skinned mesh that casts no shadow, up to the tier cap of both tables', () => {
    const fig = buildNearFigure();
    const parts = meshes(fig.root);
    expect(parts.length).toBe(1);
    expect(parts[0]?.isSkinnedMesh).toBe(true);
    expect(parts[0]?.castShadow).toBe(false);
    for (const tier of TIERS) expect(NEAR_PED_CAP[tier], tier).toBe(PERF_NEAR_PED_CAP[tier]);
  });

  it('the transit is one instanced mesh per kind, none casts a shadow, and the kinds are the moving rows of transit.json plus the entrances', () => {
    const parent = new Group();
    const r = new TransitRenderer({ parent, trafficCap: 16, carsDrawn: () => 0 });
    const kinds = meshes(r.group);
    expect(kinds.every((m) => m.isInstancedMesh === true && !m.castShadow)).toBe(true);
    expect(kinds.map((m) => m.name).sort()).toEqual(Object.keys(TRANSIT_ART).map((k) => `transit.${k}`).sort());
    const moving = Object.keys(transitCounts).map((k) => (k === 'air' ? 'airliner' : k));
    expect([...moving, 'entrance'].sort()).toEqual(Object.keys(TRANSIT_ART).sort());
  });

  it('adds the three per tier', () => {
    for (const tier of TIERS) {
      const runs = Object.values(transitCounts).filter((row) => (row[tier] ?? 0) > 0).length + 1;
      expect(crowdParts(tier), tier).toEqual({ pedFar: PED_BODIES, pedNear: NEAR_PED_CAP[tier], transit: runs });
    }
    expect(Object.fromEntries(TIERS.map((t) => [t, crowdMax(t)]))).toEqual({
      'desktop-ultra': 38, desktop: 38, mobile: 26, 'mobile-low': 20, 'xr-quest': 22, 'xr-visionpro': 30,
    });
  });
});
