/** M10d4 AC-6: the instanced pedestrians drawing the kit (`PedRenderer` with an asset port), on mock asset bytes (the committed variants). */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Group, type InstancedMesh, type SkinnedMesh } from 'three/webgpu';
import type { QualityTierId } from '@dv/shared';
import { PED_ASSETS, PED_BODIES, PED_PALETTE } from '../src/sim/peds/components.ts';
import { NEAR_PED_CAP, pedCap } from '../src/sim/peds/density.ts';
import { PED_ART, type PedKitAssets } from '../src/client/peds/kit.ts';
import { PedRenderer } from '../src/client/peds/instances.ts';

const repo = path.resolve(import.meta.dirname, '../../..');
const bytesOf = (ref: string, variant: string): Uint8Array => {
  const [kind, id] = ref.split('/') as [string, string];
  return new Uint8Array(readFileSync(path.join(repo, 'assets/src', kind, id, `${variant}.glb`)));
};
const EDGE: Record<string, number> = { desktop: 1024, mobile: 512, 'mobile-low': 256 };
const mock = (variant: string): PedKitAssets => ({
  bytes: async (ref) => bytesOf(ref, variant),
  image: async () => ({ width: EDGE[variant] as number, height: EDGE[variant] as number, source: { width: 1, height: 1 } as unknown as ImageBitmap }),
});

type Frame = Parameters<PedRenderer['update']>[0];
type Pose = NonNullable<Frame['poses']>[number];

/** `n` ambient pedestrians around the camera at the origin, every body and outfit in turn, at distance `r(i)`. */
function frame(n: number, r: (i: number) => number, outfitShift = 0): Frame {
  const poses: Pose[] = [];
  const keys = new Map<number, string>(PED_ASSETS.map((k, i) => [i + 1, k as string]));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 6.2832;
    poses.push({
      handle: 100 + i, renderKey: (i % PED_BODIES) + 1, px: Math.cos(a) * r(i), py: 0, pz: Math.sin(a) * r(i), qx: 0, qy: 0, qz: 0, qw: 1,
      animState: 1, animP0: 1.3, animP1: (i + outfitShift) % PED_PALETTE.length, flags: 2, snapped: false,
    });
  }
  return { poses, poseCount: n, poseKeys: keys, camera: { pos: [0, 1.7, 0] } } as unknown as Frame;
}

async function settle(r: PedRenderer): Promise<void> {
  for (let i = 0; i < 500 && r.art().state === 'loading'; i++) await new Promise((res) => setTimeout(res, 10));
}

/** The visible skinned meshes (the near figures drawn this frame). */
function skinned(g: Group): SkinnedMesh[] {
  const out: SkinnedMesh[] = [];
  g.traverseVisible((o) => {
    if ((o as SkinnedMesh).isSkinnedMesh) out.push(o as SkinnedMesh);
  });
  return out;
}

const variantOf = (tier: QualityTierId): string => (tier === 'desktop' ? 'desktop' : tier === 'mobile' ? 'mobile' : 'mobile-low');
/** The profiles of the ledger table: `full`, `lite`, `min` and `legacy` (XR). */
const PROFILES: [QualityTierId, string][] = [['desktop', 'full'], ['mobile', 'lite'], ['mobile-low', 'min'], ['xr-quest', 'legacy'], ['xr-visionpro', 'legacy']];

describe('PedRenderer with the pedestrian kit', () => {
  for (const [tier, profile] of PROFILES) {
    it(`${tier} (${profile}): the kit draws the same render objects as the mannequin, within the caps of the tier`, async () => {
      const cap = pedCap(tier), nearCap = NEAR_PED_CAP[tier];
      const f = frame(Math.min(cap, 40), (i) => (i % 2 === 0 ? 6 + (i % 7) : 60 + i));
      const objects: number[] = [];
      for (const withArt of [false, true]) {
        const r = new PedRenderer({ parent: new Group(), cap, nearCap, ...(withArt ? { art: mock(variantOf(tier)) } : {}) });
        await settle(r);
        expect(r.art().state).toBe(withArt ? 'ready' : 'off');
        r.update(f, 1);
        r.update(f, 1.05);
        const info = r.info();
        expect(info.cap).toBe(cap);
        expect(info.nearCap).toBe(nearCap);
        expect(info.near).toBe(Math.min(nearCap, 20));
        expect(info.instances).toBeLessThanOrEqual(cap);
        expect(info.objects).toBe(info.near + info.perBody.filter((n) => n > 0).length);
        const near = skinned(r.group);
        expect(near).toHaveLength(info.near);
        if (withArt) {
          const a = r.art();
          expect(a).toMatchObject({ near: 'kit', far: 'kit', bodies: 8, state: 'ready' });
          expect(a.textureBytes / (1024 * 1024)).toBeLessThanOrEqual(PED_ART.limits.textureMegabytes[profile as 'full'] as number);
          expect(a.refs.filter((x) => x.startsWith('character/ped.ambient') || x === 'mannequin')).toEqual([]);
          // a near ped is one SkinnedMesh with one material on the 22 bones, with the kit's vertex count, not the mannequin's
          for (const m of near) {
            expect(Array.isArray(m.material)).toBe(false);
            expect(m.skeleton.bones).toHaveLength(22);
            expect((m.material as { vertexColors: boolean }).vertexColors).toBe(true);
            expect((m.material as { transparent: boolean }).transparent).toBe(false);
          }
          // far: one InstancedMesh per body, the kit's far figure (at most 300 triangles) with the gait and tint attributes
          const far = r.group.children.filter((o) => (o as InstancedMesh).isInstancedMesh) as InstancedMesh[];
          expect(far).toHaveLength(PED_ART.limits.farMeshes);
          for (const m of far) {
            expect((m.geometry.getIndex()?.count ?? 0) / 3).toBeLessThanOrEqual(300);
            for (const name of ['aSwing', 'aPivot', 'aTint', 'aGait', 'color']) expect(m.geometry.getAttribute(name), name).toBeDefined();
          }
        }
        objects.push(info.objects);
        r.dispose();
      }
      // objects added by the kit: 0 in every profile
      expect(objects[1]).toBe(objects[0]);
    });
  }

  it('keeps the mannequin when the kit fails to load', async () => {
    const failing: PedKitAssets = { bytes: async () => { throw new Error('404'); } };
    const r = new PedRenderer({ parent: new Group(), cap: 40, nearCap: 6, art: failing });
    await settle(r);
    expect(r.art()).toMatchObject({ state: 'failed', near: 'mannequin', far: 'mannequin', refs: ['mannequin'] });
    r.update(frame(10, () => 5), 1);
    expect(r.info().near).toBe(6);
    expect(skinned(r.group)).toHaveLength(6);
    r.dispose();
  });

  it('with artWaits the kit requests nothing until startArt, and the mannequin draws meanwhile (BD-REPAIR-M10d4-02)', async () => {
    const asked: string[] = [];
    const base = mock('mobile-low');
    const counting: PedKitAssets = { bytes: async (ref) => (asked.push(ref), base.bytes(ref)), image: base.image as NonNullable<PedKitAssets['image']> };
    const r = new PedRenderer({ parent: new Group(), cap: 40, nearCap: 6, art: counting, artWaits: true });
    await new Promise((res) => setTimeout(res, 50));
    expect(asked).toEqual([]);
    expect(r.art()).toMatchObject({ state: 'loading', near: 'mannequin', far: 'mannequin' });
    r.update(frame(10, () => 5), 1);
    expect(r.info().near).toBe(6);
    r.startArt();
    r.startArt(); // once only
    await settle(r);
    expect(r.art()).toMatchObject({ state: 'ready', near: 'kit', far: 'kit' });
    const files = Object.keys(PED_ART.bodies).length * 2 + PED_ART.outfits.length;
    expect(asked).toHaveLength(files);
    r.dispose();
  });

  it('builds no more near figures than twice the cap as the near pedestrians change outfit', async () => {
    const r = new PedRenderer({ parent: new Group(), cap: 60, nearCap: 6, art: mock('mobile-low') });
    await settle(r);
    for (let t = 0; t < 12; t++) {
      r.update(frame(10, () => 5, t), 1 + t * 0.05);
      expect(r.info().near).toBe(6);
      expect(skinned(r.group)).toHaveLength(6);
    }
    expect(r.group.children.filter((o) => o.name === 'ped.near').length).toBeLessThanOrEqual(12);
    r.dispose();
  });
});
