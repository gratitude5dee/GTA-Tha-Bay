/** M10d4 AC-6: the instanced pedestrians drawing the kit (`PedRenderer` with an asset port), on mock asset bytes (the committed variants). */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Group, type InstancedMesh, type SkinnedMesh } from 'three/webgpu';
import type { QualityTierId } from '@dv/shared';
import { PED_ASSETS, PED_BODIES, PED_PALETTE } from '../src/sim/peds/components.ts';
import { NEAR_PED_CAP, pedCap } from '../src/sim/peds/density.ts';
import { PED_ART, type PedKitAssets } from '../src/client/peds/kit.ts';
import { ART_QUIET_FRAMES, PedRenderer } from '../src/client/peds/instances.ts';

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

describe('the kit load stays behind the world (BD-REPAIR-M10d4-03)', () => {
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await new Promise((res) => setTimeout(res, 0));
  };
  /**
   * An asset port shaped like the app's (`group`: one asset-worker job per group, its files read one after another) whose answers arrive
   * when the test says so. It records each request and the most of them in flight at once.
   */
  function deferred(): { port: PedKitAssets; asked: string[][]; peak: () => number; release: () => Promise<void> } {
    const base = mock('mobile-low');
    const asked: string[][] = [];
    const waiting: (() => void)[] = [];
    let inFlight = 0;
    let peak = 0;
    const answer = <T>(make: () => Promise<T>): Promise<T> => {
      peak = Math.max(peak, ++inFlight);
      return new Promise((resolve) => waiting.push(() => void make().then((v) => (inFlight--, resolve(v)))));
    };
    const port: PedKitAssets = {
      bytes: (ref) => (asked.push([ref]), answer(() => base.bytes(ref))),
      group: (refs) => (asked.push(refs), answer(() => Promise.all(refs.map((r) => base.bytes(r))))),
      image: (ref) => (asked.push([ref]), answer(() => (base.image as NonNullable<PedKitAssets['image']>)(ref))),
    };
    return { port, asked, peak: () => peak, release: async () => (waiting.splice(0).forEach((go) => go()), flush()) };
  }
  const f = frame(10, () => 5);
  const bodies = Object.values(PED_ART.bodies).map((b) => b.body);
  const fars = Object.values(PED_ART.bodies).map((b) => b.far);

  it('asks for nothing while the world is busy, then one group at a time, each only after quiet frames in a row', async () => {
    const d = deferred();
    let quiet = false;
    const r = new PedRenderer({ parent: new Group(), cap: 40, nearCap: 6, art: d.port, artQuiet: () => quiet });
    let t = 1;
    const tick = async (n: number): Promise<void> => {
      for (let i = 0; i < n; i++) r.update(f, (t += 0.05));
      await flush();
    };
    await tick(10);
    expect(d.asked).toEqual([]);
    expect(r.art()).toMatchObject({ state: 'loading', near: 'mannequin' });
    expect(r.info().near).toBe(6);
    quiet = true;
    await tick(ART_QUIET_FRAMES - 1);
    expect(d.asked).toEqual([]);
    await tick(1);
    expect(d.asked).toEqual([bodies]);
    // the world gets busy while the bodies are on their way: the far figures wait for quiet frames again
    quiet = false;
    await tick(1);
    await d.release();
    await tick(5);
    expect(d.asked).toEqual([bodies]);
    quiet = true;
    await tick(ART_QUIET_FRAMES - 1);
    expect(d.asked).toHaveLength(1);
    await tick(1);
    expect(d.asked).toEqual([bodies, fars]);
    // quiet from here: each group follows the one before it, never two at once
    for (let i = 0; i < 20 && r.art().state === 'loading'; i++) {
      await d.release();
      await tick(1);
    }
    expect(r.art()).toMatchObject({ state: 'ready', near: 'kit', far: 'kit' });
    expect(d.asked).toEqual([bodies, fars, PED_ART.outfits, [PED_ART.atlas]]);
    expect(d.peak()).toBe(1);
    r.dispose();
  });

  it('the swap from the mannequin waits for quiet frames too (a cutscene holding the world); dispose ends a waiting load', async () => {
    const d = deferred();
    let quiet = true;
    const r = new PedRenderer({ parent: new Group(), cap: 40, nearCap: 6, art: d.port, artQuiet: () => quiet });
    let t = 1;
    const tick = async (n: number): Promise<void> => {
      for (let i = 0; i < n; i++) r.update(f, (t += 0.05));
      await flush();
    };
    await tick(ART_QUIET_FRAMES);
    for (let i = 0; i < 20 && d.asked.length < 4; i++) {
      await d.release();
      await tick(1);
    }
    expect(d.asked).toHaveLength(4);
    // the atlas, the last file, arrives while the world is held: the mannequin stays until quiet frames come back
    quiet = false;
    await tick(1);
    await d.release();
    await tick(5);
    expect(r.art()).toMatchObject({ state: 'loading', near: 'mannequin', far: 'mannequin' });
    expect(r.info().near).toBe(6);
    quiet = true;
    await tick(ART_QUIET_FRAMES - 1);
    expect(r.art().state).toBe('loading');
    await tick(1);
    expect(r.art()).toMatchObject({ state: 'ready', near: 'kit', far: 'kit' });
    r.dispose();

    const d2 = deferred();
    const r2 = new PedRenderer({ parent: new Group(), cap: 40, nearCap: 6, art: d2.port, artQuiet: () => false });
    r2.update(f, 1);
    r2.dispose();
    await flush();
    await d2.release();
    expect(d2.asked, 'a disposed renderer asks for nothing more').toEqual([]);
    expect(r2.art().state).not.toBe('ready');
  });

  it('without a group port the files of a step still come one after another', async () => {
    const base = mock('mobile-low');
    let inFlight = 0;
    let peak = 0;
    const one: PedKitAssets = {
      bytes: async (ref) => {
        peak = Math.max(peak, ++inFlight);
        await new Promise((res) => setTimeout(res, 1));
        inFlight--;
        return base.bytes(ref);
      },
      image: base.image as NonNullable<PedKitAssets['image']>,
    };
    const r = new PedRenderer({ parent: new Group(), cap: 40, nearCap: 6, art: one });
    await settle(r);
    expect(r.art().state).toBe('ready');
    expect(peak).toBe(1);
    r.dispose();
  });
});
