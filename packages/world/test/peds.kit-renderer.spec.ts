/** M10d4 AC-6: the instanced pedestrians drawing the kit (`PedRenderer` with an asset port), on mock asset bytes (the committed variants). */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Group, type InstancedMesh, type Object3D, type SkinnedMesh } from 'three/webgpu';
import type { QualityTierId } from '@dv/shared';
import { PackUnavailable } from '@dv/engine/assets/types';
import type { AssetService } from '@dv/engine/assets/service';
import type * as PersonGlbModule from '@dv/engine/client/avatar/person-glb';
import { PED_ASSETS, PED_BODIES, PED_PALETTE } from '../src/sim/peds/components.ts';
import { NEAR_PED_CAP, pedCap } from '../src/sim/peds/density.ts';
import { loadPedKit, PED_ART, pedKitAssets, type PedKitAssets } from '../src/client/peds/kit.ts';
import { AHEAD_PER_FRAME, ART_QUIET_FRAMES, PedRenderer } from '../src/client/peds/instances.ts';
import { ArtGate, unsettledUnits, type WorldLoad } from '../src/client/peds/art-gate.ts';
import { buildNearFigure, whitePage } from '../src/client/peds/mannequin.ts';
import { pedJob, personMeshTransfer, type PedJobArgs, type PedStopArgs } from '../src/client/peds/ped-job.ts';
import { parsePersonGlb, type PersonMesh } from '@dv/engine/client/avatar/person-glb';

/** Counts the people-GLB parses of the kit (main-thread work the gate holds back, BD-REPAIR-M10d4-03). */
const parses = vi.hoisted(() => ({ n: 0 }));
vi.mock('@dv/engine/client/avatar/person-glb', async (importOriginal) => {
  const m = await importOriginal<typeof PersonGlbModule>();
  return { ...m, parsePersonGlb: (b: Uint8Array) => (parses.n++, m.parsePersonGlb(b)) };
});

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

/** The vertex count of the mannequin's near figure. */
const MANNEQUIN_VERTICES = buildNearFigure().mesh.geometry.getAttribute('position').count;

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
            // BD-REPAIR-M10d4-04: the mannequin is opaque too now, so the vertex count tells the kit's figure from it
            expect(m.geometry.getAttribute('position').count).toBeGreaterThan(MANNEQUIN_VERTICES);
            expect((m.material as { map: unknown }).map).not.toBe(whitePage());
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

  it('the kit\'s near figure and the mannequin are built for one render program: same material class and settings, a colour map in sRGB, the same vertex attributes (BD-REPAIR-M10d4-04)', async () => {
    const r = new PedRenderer({ parent: new Group(), cap: 40, nearCap: 6, art: mock('mobile-low') });
    await settle(r);
    r.update(frame(10, () => 5), 1);
    const kitMesh = skinned(r.group)[0] as SkinnedMesh;
    const man = buildNearFigure().mesh;
    type M = { type: string; isNodeMaterial?: boolean; transparent: boolean; vertexColors: boolean; side: number; blending: number; alphaTest: number; flatShading: boolean; fog: boolean; map: { colorSpace: string; channel: number; isTexture: boolean } | null };
    const shape = (m: SkinnedMesh): Record<string, unknown> => {
      const mat = m.material as unknown as M;
      const attrs = Object.fromEntries(Object.entries(m.geometry.attributes).map(([k, a]) => [k, `${(a.array as { constructor: { name: string } }).constructor.name}x${a.itemSize}${a.normalized ? 'n' : ''}`]));
      return {
        material: mat.type, node: mat.isNodeMaterial === true, transparent: mat.transparent, vertexColors: mat.vertexColors, side: mat.side, blending: mat.blending,
        alphaTest: mat.alphaTest, flatShading: mat.flatShading, fog: mat.fog, map: mat.map ? { colorSpace: mat.map.colorSpace, channel: mat.map.channel } : null,
        attrs, bones: m.skeleton.bones.length, morphs: Object.keys(m.geometry.morphAttributes).length, castShadow: m.castShadow, receiveShadow: m.receiveShadow,
      };
    };
    expect(shape(kitMesh)).toEqual(shape(man));
    expect(shape(man)).toMatchObject({ transparent: false, vertexColors: true, map: { colorSpace: 'srgb' } });
    // the mannequin samples white: its colours are its vertex colours and its tint, as before
    const page = whitePage().image as unknown as { data: Uint8Array; width: number; height: number };
    expect([page.width, page.height, ...page.data]).toEqual([1, 1, 255, 255, 255, 255]);
    r.dispose();
  });

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
    for (let i = 0; i < 6; i++) await new Promise((res) => setTimeout(res, 0));
  };
  const QUIET: WorldLoad = { held: false, unsettled: 0, requests: 0, meshing: 0, landmarksIdle: true, artLoading: false };

  /**
   * An asset port shaped like the app's: one asset-worker read per group whose files arrive one at a time when the test calls `step()`;
   * once the read's signal aborts it answers the files it has read (a prefix), like `world.ped`. It records every request, the signals
   * the requests carried and the most requests in flight at once.
   */
  function worker(): {
    port: PedKitAssets; asked: string[][]; signals: AbortSignal[]; peak: () => number; step: (n?: number) => Promise<void>;
  } {
    const base = mock('mobile-low');
    const asked: string[][] = [];
    const signals: AbortSignal[] = [];
    const reads: { refs: string[]; got: (ArrayBuffer | Uint8Array)[]; signal: AbortSignal | undefined; done: (v: (ArrayBuffer | Uint8Array)[]) => void }[] = [];
    let peak = 0;
    const group = (refs: string[], signal?: AbortSignal): Promise<(ArrayBuffer | Uint8Array)[]> => {
      asked.push(refs);
      if (signal) signals.push(signal);
      return new Promise((done) => {
        const r = { refs, got: [] as (ArrayBuffer | Uint8Array)[], signal, done };
        reads.push(r);
        peak = Math.max(peak, reads.length);
        signal?.addEventListener('abort', () => {
          reads.splice(reads.indexOf(r), 1);
          done(r.got);
        });
      });
    };
    const step = async (n = 1): Promise<void> => {
      for (let i = 0; i < n; i++) {
        const r = reads[0];
        if (!r) break;
        const ref = r.refs[r.got.length] as string;
        // the atlas page is a PNG in the app (decoded by `image`); the people files are the committed variants
        r.got.push(ref.startsWith('texture/') ? new Uint8Array(4) : await base.bytes(ref));
        if (r.got.length === r.refs.length) {
          reads.shift();
          r.done(r.got);
        }
      }
      await flush();
    };
    const port: PedKitAssets = {
      bytes: (ref, signal) => group([ref], signal).then((g) => g[0] as ArrayBuffer | Uint8Array),
      group,
      image: async (ref, signal) => {
        const [b] = await group([ref], signal);
        if (!b) throw Object.assign(new Error('stopped'), { name: 'AbortError' });
        return (base.image as NonNullable<PedKitAssets['image']>)(ref);
      },
    };
    return { port, asked, signals, peak: () => peak, step };
  }
  const f = frame(10, () => 5);
  const bodies = Object.values(PED_ART.bodies).map((b) => b.body);
  const fars = Object.values(PED_ART.bodies).map((b) => b.far);

  /** A renderer whose gate reads `world` (mutable) once a frame, and a ticker. */
  function rig(port: PedKitAssets, world: WorldLoad): { r: PedRenderer; tick: (n: number) => Promise<void> } {
    const r = new PedRenderer({ parent: new Group(), cap: 40, nearCap: 6, art: port, worldLoad: () => ({ ...world }) });
    let t = 1;
    return {
      r,
      tick: async (n) => {
        for (let i = 0; i < n; i++) r.update(f, (t += 0.05));
        await flush();
      },
    };
  }

  it('opens after ART_QUIET_FRAMES quiet frames and shuts, stopping the step in flight, on the first frame the world has work', () => {
    const world: WorldLoad = { ...QUIET, unsettled: 3 };
    const gate = new ArtGate(() => ({ ...world }));
    const tick = (n: number): void => {
      for (let i = 0; i < n; i++) gate.frame();
    };
    tick(10);
    expect(gate.open).toBe(false);
    expect(gate.signal().aborted, 'a shut gate gives an aborted signal').toBe(true);
    world.unsettled = 0;
    tick(ART_QUIET_FRAMES - 1);
    expect(gate.open).toBe(false);
    tick(1);
    expect(gate.open).toBe(true);
    // a want pass asks for a batch that settles within the same frame: nothing is requested or retrying when the frame is read, yet the
    // pass asked, so the gate shuts and the step in flight stops
    let step = gate.signal();
    world.requests += 2;
    tick(1);
    expect(gate.open).toBe(false);
    expect(step.aborted).toBe(true);
    tick(ART_QUIET_FRAMES);
    expect(gate.open).toBe(true);
    // each kind of world work shuts it and stops the step, for ART_QUIET_FRAMES frames
    const busy: Partial<WorldLoad>[] = [{ held: true }, { unsettled: 1 }, { meshing: 1 }, { landmarksIdle: false }, { artLoading: true }];
    for (const b of busy) {
      step = gate.signal();
      Object.assign(world, b);
      tick(1);
      expect(gate.open, JSON.stringify(b)).toBe(false);
      expect(step.aborted, JSON.stringify(b)).toBe(true);
      Object.assign(world, QUIET, { requests: world.requests });
      tick(ART_QUIET_FRAMES - 1);
      expect(gate.open, JSON.stringify(b)).toBe(false);
      tick(1);
      expect(gate.open, JSON.stringify(b)).toBe(true);
    }
    // a step started in a later window carries a new signal
    expect(gate.signal().aborted).toBe(false);
    step = gate.signal();
    gate.dispose();
    expect(gate.open).toBe(false);
    expect(step.aborted, 'dispose stops the step in flight').toBe(true);
  });

  it('next() resolves on the next frame that leaves the gate open, never on a busy one, and rejects once disposed (BD-REPAIR-M10d4-04)', async () => {
    const world: WorldLoad = { ...QUIET };
    const gate = new ArtGate(() => ({ ...world }));
    for (let i = 0; i < ART_QUIET_FRAMES; i++) gate.frame();
    expect(gate.open).toBe(true);
    let got = 0;
    void gate.next().then(() => got++);
    await flush();
    expect(got, 'not on the frame it was asked in').toBe(0);
    world.meshing = 1;
    gate.frame();
    await flush();
    expect(got, 'not on a busy frame').toBe(0);
    world.meshing = 0;
    for (let i = 0; i < ART_QUIET_FRAMES - 1; i++) gate.frame();
    await flush();
    expect(got, 'not before the gate opens again').toBe(0);
    gate.frame();
    await flush();
    expect(got).toBe(1);
    const late = gate.next();
    gate.dispose();
    await expect(late).rejects.toThrow(/disposed/);
    await expect(gate.next()).rejects.toThrow(/disposed/);
    // without a world to read, at once
    await expect(new ArtGate(null).next()).resolves.toBeUndefined();
  });

  it('counts requested and retrying units as unsettled, ready, empty and failed ones as settled', () => {
    expect(unsettledUnits([{ state: 'requested' }, { state: 'retrying' }, { state: 'ready' }, { state: 'empty' }, { state: 'failed' }])).toBe(2);
  });

  it('asks for nothing while the world is busy; a read in flight stops at its next file when the world gets busy and the rest follows the next quiet window', async () => {
    const w = worker();
    const world: WorldLoad = { ...QUIET, unsettled: 3 };
    const { r, tick } = rig(w.port, world);
    await tick(20);
    expect(w.asked).toEqual([]);
    expect(r.art()).toMatchObject({ state: 'loading', near: 'mannequin' });
    expect(r.info().near).toBe(6);
    world.unsettled = 0;
    await tick(ART_QUIET_FRAMES - 1);
    expect(w.asked).toEqual([]);
    await tick(1);
    expect(w.asked).toEqual([bodies]);
    // three bodies arrive, then a want pass asks for more chunks: the read stops at once and answers the three it has
    await w.step(3);
    world.requests += 1;
    await tick(1);
    expect(w.signals[0]?.aborted).toBe(true);
    await tick(ART_QUIET_FRAMES - 1);
    expect(w.asked).toEqual([bodies]);
    await tick(1);
    expect(w.asked).toEqual([bodies, bodies.slice(3)]);
    // a landmark starts its swap while the rest of the bodies are on their way: stopped again
    await w.step(2);
    world.landmarksIdle = false;
    await tick(1);
    expect(w.signals[1]?.aborted).toBe(true);
    world.landmarksIdle = true;
    await tick(ART_QUIET_FRAMES);
    expect(w.asked).toEqual([bodies, bodies.slice(3), bodies.slice(5)]);
    // quiet from here: one read at a time, every file once
    for (let i = 0; i < 60 && r.art().state === 'loading'; i++) {
      await w.step(1);
      await tick(1);
    }
    expect(r.art()).toMatchObject({ state: 'ready', near: 'kit', far: 'kit' });
    expect(w.asked).toEqual([bodies, bodies.slice(3), bodies.slice(5), fars, PED_ART.outfits, [PED_ART.atlas]]);
    expect(w.peak()).toBe(1);
    r.dispose();
  });

  it('parses a file, builds the kit and swaps it in only while the world is quiet', async () => {
    const w = worker();
    const base = mock('mobile-low');
    let imageGo: (() => void) | null = null;
    // the atlas decode, once started, finishes whatever the world does (createImageBitmap is not stopped)
    w.port.image = (ref) => {
      w.asked.push([ref]);
      return new Promise((resolve) => (imageGo = () => void (base.image as NonNullable<PedKitAssets['image']>)(ref).then(resolve)));
    };
    const world: WorldLoad = { ...QUIET };
    const { r, tick } = rig(w.port, world);
    await tick(ART_QUIET_FRAMES);
    expect(w.asked).toEqual([bodies]);
    const before = parses.n;
    // seven bodies are read, then a cutscene holds the world: the read stops, and the seven wait unparsed
    await w.step(7);
    world.held = true;
    await tick(1);
    expect(w.signals[0]?.aborted).toBe(true);
    await tick(5);
    expect(parses.n).toBe(before);
    expect(w.asked).toHaveLength(1);
    world.held = false;
    await tick(ART_QUIET_FRAMES - 1);
    expect(parses.n).toBe(before);
    await tick(1);
    expect(parses.n).toBe(before + 7);
    expect(w.asked).toEqual([bodies, bodies.slice(7)]);
    for (let i = 0; i < 60 && imageGo === null; i++) {
      await w.step(1);
      await tick(1);
    }
    expect(w.asked.at(-1)).toEqual([PED_ART.atlas]);
    expect(parses.n).toBe(before + bodies.length + fars.length + PED_ART.outfits.length);
    // the atlas is decoded while the world streams: the kit is neither built nor swapped in until the world is quiet again
    world.unsettled = 2;
    await tick(1);
    (imageGo as unknown as () => void)();
    await tick(5);
    expect(r.art()).toMatchObject({ state: 'loading', near: 'mannequin', far: 'mannequin' });
    expect(r.info().near).toBe(6);
    world.unsettled = 0;
    await tick(ART_QUIET_FRAMES - 1);
    expect(r.art().state).toBe('loading');
    await tick(1);
    expect(r.art()).toMatchObject({ state: 'ready', near: 'kit', far: 'kit' });
    r.dispose();
  });

  it('dispose stops the read in flight and a load waiting for the gate; nothing more is asked for', async () => {
    const w = worker();
    const world: WorldLoad = { ...QUIET };
    const { r, tick } = rig(w.port, world);
    await tick(ART_QUIET_FRAMES);
    expect(w.asked).toHaveLength(1);
    r.dispose();
    expect(w.signals[0]?.aborted).toBe(true);
    await w.step(8);
    await flush();
    expect(w.asked).toHaveLength(1);
    expect(r.art().state).not.toBe('ready');

    const w2 = worker();
    const r2 = new PedRenderer({ parent: new Group(), cap: 40, nearCap: 6, art: w2.port, worldLoad: () => ({ ...QUIET, held: true }) });
    r2.update(f, 1);
    r2.dispose();
    await flush();
    expect(w2.asked, 'a disposed renderer asks for nothing').toEqual([]);
    // without `worldLoad` dispose still stops a read in flight
    const w3 = worker();
    const r3 = new PedRenderer({ parent: new Group(), cap: 40, nearCap: 6, art: w3.port });
    await flush();
    expect(w3.asked).toEqual([bodies]);
    r3.dispose();
    expect(w3.signals[0]?.aborted).toBe(true);
  });

  it('with ahead, the swap is prepared on quiet frames: each near pedestrian\'s kit figure built after one (at most AHEAD_PER_FRAME a frame), drawn once collapsed on a later one; the swap moves them in (BD-REPAIR-M10d4-04)', async () => {
    const world: WorldLoad = { ...QUIET };
    let frameNo = 0;
    const busyFrames = new Set<number>();
    const r = new PedRenderer({ parent: new Group(), cap: 40, nearCap: 6, art: mock('mobile-low'), worldLoad: () => ({ ...world }), ahead: true });
    const quietOf = (w: WorldLoad): boolean => !w.held && w.unsettled === 0 && w.meshing === 0 && w.landmarksIdle && !w.artLoading;
    const aheadSet = (): Group | undefined => r.group.children.find((o) => o.name === 'peds.ahead') as Group | undefined;
    const built = (): Object3D[] => aheadSet()?.children.filter((o) => o.name === 'ped.near') ?? [];
    /** The frame each figure was built on, and the frames each was drawn on (visible after the frame's update) with its scale. */
    const builtAt = new Map<Object3D, number>();
    const drawn: { at: number; obj: Object3D; scale: number }[] = [];
    let t = 1;
    const tick = async (n: number): Promise<void> => {
      for (let i = 0; i < n; i++) {
        frameNo++;
        if (!quietOf(world)) busyFrames.add(frameNo);
        r.update(f, (t += 0.05));
        for (const o of aheadSet()?.children ?? []) if (o.visible) drawn.push({ at: frameNo, obj: o, scale: o.scale.x });
        await flush();
        for (const o of built()) if (!builtAt.has(o)) builtAt.set(o, frameNo);
      }
    };
    // the kit loads (every step on a quiet frame); the six near pedestrians draw the mannequin meanwhile
    for (let i = 0; i < 40 && aheadSet() === undefined; i++) await tick(1);
    expect(aheadSet(), 'the set is made once the kit has loaded').toBeDefined();
    expect(r.art()).toMatchObject({ state: 'loading', near: 'mannequin' });
    for (let i = 0; i < 120 && r.art().state === 'loading'; i++) {
      world.meshing = i % 5 === 3 ? 1 : 0;
      const b = built().length;
      await tick(1);
      expect(built().length - b, 'at most AHEAD_PER_FRAME figures per frame').toBeLessThanOrEqual(AHEAD_PER_FRAME);
      if (busyFrames.has(frameNo)) expect(built().length, 'nothing is built on a busy frame').toBe(b);
    }
    expect(r.art()).toMatchObject({ state: 'ready', near: 'kit', far: 'kit' });
    // six figures, one per near pedestrian the mannequin drew, each built on a quiet frame and drawn once, collapsed, on a later quiet
    // frame, a batch a frame; then the swap
    const figures = [...builtAt.keys()];
    expect(figures).toHaveLength(6);
    expect(drawn).toHaveLength(6);
    for (const [obj, at] of builtAt) {
      expect(busyFrames.has(at), `built on frame ${at}`).toBe(false);
      const d = drawn.find((x) => x.obj === obj);
      expect(d, 'each figure drawn once').toBeDefined();
      expect(d?.at as number).toBeGreaterThan(at);
      expect(busyFrames.has(d?.at as number), `drawn on frame ${d?.at}`).toBe(false);
      expect(d?.scale).toBe(0);
    }
    // the figures built after one frame are drawn together on one later frame: as many draw frames as build frames
    expect(new Set(drawn.map((d) => d.at)).size, 'a batch a frame').toBe(new Set(builtAt.values()).size);
    expect(new Set(builtAt.values()).size).toBeGreaterThanOrEqual(Math.ceil(6 / AHEAD_PER_FRAME));
    // the next frame draws the figures built ahead at full size: no new figure, every near ped a kit figure
    await tick(1);
    const near = skinned(r.group);
    expect(near).toHaveLength(6);
    expect(near.every((m) => m.parent !== null && builtAt.has(m.parent)), 'the figures built ahead').toBe(true);
    for (const m of near) {
      expect(m.parent?.scale.x).toBe(1);
      expect(m.geometry.getAttribute('position').count).toBeGreaterThan(MANNEQUIN_VERTICES);
    }
    expect(r.group.children.filter((o) => o.name === 'ped.near')).toHaveLength(6);
    expect(aheadSet(), 'the swap took every figure, and the set with them').toBeUndefined();
    const far = r.group.children.filter((o) => (o as InstancedMesh).isInstancedMesh) as InstancedMesh[];
    expect(far).toHaveLength(PED_BODIES);
    for (const m of far) expect((m.geometry.getIndex()?.count ?? 0) / 3).toBeLessThanOrEqual(300);
    expect(r.info().objects).toBe(r.info().near + r.info().perBody.filter((n) => n > 0).length);
    r.dispose();
  });

  it('with ahead in a quiet world the preparation is pipelined: each frame draws the batch built after the frame before and builds the next (BD-REPAIR-M10d4-04)', async () => {
    const world: WorldLoad = { ...QUIET };
    const r = new PedRenderer({ parent: new Group(), cap: 40, nearCap: 10, art: mock('mobile-low'), worldLoad: () => ({ ...world }), ahead: true });
    const aheadSet = (): Group | undefined => r.group.children.find((o) => o.name === 'peds.ahead') as Group | undefined;
    const ten = frame(10, () => 5);
    const builtAt = new Map<Object3D, number>();
    const drawnAt = new Map<Object3D, number>();
    let frameNo = 0;
    let swapAt = -1;
    let t = 1;
    for (let i = 0; i < 200 && swapAt < 0; i++) {
      frameNo++;
      r.update(ten, (t += 0.05));
      for (const o of aheadSet()?.children ?? []) if (o.visible) drawnAt.set(o, frameNo);
      await flush();
      for (const o of aheadSet()?.children ?? []) if (!builtAt.has(o)) builtAt.set(o, frameNo);
      if (r.art().state === 'ready') swapAt = frameNo;
    }
    expect(swapAt).toBeGreaterThan(0);
    const built = [...builtAt.values()].sort((a, b) => a - b);
    expect(built).toHaveLength(10);
    // ten figures in batches of AHEAD_PER_FRAME (4, 4, 2), built after consecutive frames, each drawn once on the frame after its build
    const frames = [...new Set(built)];
    expect(frames).toHaveLength(Math.ceil(10 / AHEAD_PER_FRAME));
    for (let i = 1; i < frames.length; i++) expect(frames[i] as number).toBe((frames[i - 1] as number) + 1);
    for (const at of frames) expect(built.filter((x) => x === at).length).toBeLessThanOrEqual(AHEAD_PER_FRAME);
    for (const [obj, at] of builtAt) expect(drawnAt.get(obj)).toBe(at + 1);
    // the swap follows the last batch's draw within two frames
    expect(swapAt - (frames[frames.length - 1] as number)).toBeLessThanOrEqual(3);
    r.dispose();
  });

  it('with ahead and nobody near, one figure is built for the atlas page; dispose during the preparation drops what was built', async () => {
    const world: WorldLoad = { ...QUIET };
    const empty = frame(0, () => 5);
    const r = new PedRenderer({ parent: new Group(), cap: 40, nearCap: 6, art: mock('mobile-low'), worldLoad: () => ({ ...world }), ahead: true });
    let t = 1;
    for (let i = 0; i < 60 && r.art().state === 'loading'; i++) {
      r.update(empty, (t += 0.05));
      await flush();
    }
    expect(r.art().state).toBe('ready');
    // the swap moved the one figure to the near slots (free, hidden)
    expect(r.group.children.filter((o) => o.name === 'ped.near')).toHaveLength(1);
    r.dispose();
    // disposed while it prepares: the set goes, and the kit never swaps in
    const w2: WorldLoad = { ...QUIET };
    const r2 = new PedRenderer({ parent: new Group(), cap: 40, nearCap: 6, art: mock('mobile-low'), worldLoad: () => ({ ...w2 }), ahead: true });
    for (let i = 0; i < 40 && !(r2.group.children.find((o) => o.name === 'peds.ahead')?.children.length ?? 0); i++) {
      r2.update(f, (t += 0.05));
      await flush();
    }
    expect(r2.group.children.find((o) => o.name === 'peds.ahead')?.children.length).toBeGreaterThan(0);
    r2.dispose();
    await flush();
    expect(r2.group.children.some((o) => o.name === 'peds.ahead')).toBe(false);
    expect(r2.art().state).toBe('loading');
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

describe('world.ped (the kit\'s asset-worker job)', () => {
  /** A service with the kit's refs in its catalog whose store answers each `get` when the test says so. */
  function service(content: (url: string) => ArrayBuffer = () => new Uint8Array([1, 2, 3, 4]).buffer): { svc: AssetService; gets: string[]; answer: () => Promise<void>; errors: unknown[] } {
    const gets: string[] = [];
    const waiting: { ref: string; signal: AbortSignal | undefined; go: () => void; stop: (e: unknown) => void }[] = [];
    const errors: unknown[] = [];
    const svc = {
      catalog: {
        load: async () => 'ready',
        refsWithPrefix: (at: string) => ({ [at]: {} }),
        resolve: (at: string) => ({ url: at, sha256: at, bytes: 4, kind: 'character' }),
      },
      store: {
        get: (ref: { url: string }, o: { signal?: AbortSignal }) =>
          new Promise<ArrayBuffer>((resolve, reject) => {
            gets.push(ref.url);
            const stop = (e: unknown): void => reject(e);
            waiting.push({ ref: ref.url, signal: o.signal, go: () => resolve(content(ref.url)), stop });
            o.signal?.addEventListener('abort', () => stop(new PackUnavailable('aborted', ref as never)));
          }),
        reportDecodeFailure: () => Promise.reject(new Error('unused')),
      },
      noteError: (e: unknown) => {
        if (!(e instanceof PackUnavailable && e.reason === 'aborted')) errors.push(e);
      },
    } as unknown as AssetService;
    const answer = async (): Promise<void> => {
      waiting.shift()?.go();
      await ticks();
    };
    return { svc, gets, answer, errors };
  }
  const ticks = (): Promise<void> => new Promise((res) => setTimeout(res, 0));
  const refs = ['character/ped.body.a', 'character/ped.body.b', 'character/ped.body.c'];
  const never = new AbortController().signal;

  it('reads the files of a group one after another and answers them in order', async () => {
    const s = service();
    const job = pedJob(s.svc, { refs, variant: 'mobile-low', token: 't1' } satisfies PedJobArgs, never);
    await ticks();
    expect(s.gets).toEqual([refs[0]]);
    await s.answer();
    expect(s.gets).toEqual(refs.slice(0, 2));
    await s.answer();
    await s.answer();
    const out = (await job).result as { files: ArrayBuffer[] };
    expect(out.files).toHaveLength(3);
  });

  it('a stop sent by token ends the read before its next file and answers the files it has', async () => {
    const s = service();
    const job = pedJob(s.svc, { refs, variant: 'mobile-low', token: 't2' } satisfies PedJobArgs, never);
    await ticks();
    await s.answer();
    expect(s.gets).toEqual(refs.slice(0, 2));
    const stop = await pedJob(s.svc, { stop: 't2' } satisfies PedStopArgs, never);
    expect(stop.result).toEqual({ stopped: true });
    const out = (await job).result as { files: ArrayBuffer[] };
    expect(out.files).toHaveLength(1);
    expect(s.gets).toEqual(refs.slice(0, 2));
    expect(s.errors).toEqual([]);
    // a stop for a read that has ended changes nothing
    expect((await pedJob(s.svc, { stop: 't2' } satisfies PedStopArgs, never)).result).toEqual({ stopped: false });
  });

  it('the RPC abort stops a read the same way; a stop that comes first stops the read before its first file', async () => {
    const s = service();
    const ac = new AbortController();
    const job = pedJob(s.svc, { refs, variant: 'mobile-low', token: 't3' } satisfies PedJobArgs, ac.signal);
    await ticks();
    await s.answer();
    ac.abort();
    expect(((await job).result as { files: ArrayBuffer[] }).files).toHaveLength(1);
    await pedJob(s.svc, { stop: 't4' } satisfies PedStopArgs, never);
    const early = (await pedJob(s.svc, { refs, variant: 'mobile-low', token: 't4' } satisfies PedJobArgs, never)).result as { files: ArrayBuffer[] };
    expect(early.files).toEqual([]);
  });

  it('with parse the people files are parsed in the worker and come back as typed arrays, every buffer transferred (BD-REPAIR-M10d4-04)', async () => {
    const s = service((url) => bytesOf(url, 'mobile-low').slice().buffer);
    const job = pedJob(s.svc, { refs, variant: 'mobile-low', token: 't5', parse: true } satisfies PedJobArgs, never);
    await ticks();
    for (let i = 0; i < refs.length; i++) await s.answer();
    const out = await job;
    const meshes = (out.result as { meshes: PersonMesh[] }).meshes;
    expect(meshes).toHaveLength(refs.length);
    for (const [i, m] of meshes.entries()) {
      const page = parsePersonGlb(bytesOf(refs[i] as string, 'mobile-low'));
      expect(m.position).toEqual(page.position);
      expect(m.index).toEqual(page.index);
      expect(m.joints).toEqual(page.joints);
    }
    // the transfer list holds every buffer of every mesh once, so the answer moves to the page without a copy
    expect(new Set(out.transfer).size).toBe(out.transfer?.length);
    expect(out.transfer).toEqual(expect.arrayContaining(personMeshTransfer(meshes)));
    expect(out.transfer).toContain(meshes[0]?.position.buffer);
    // stopped after the first file: the parsed prefix
    const s2 = service((url) => bytesOf(url, 'mobile-low').slice().buffer);
    const job2 = pedJob(s2.svc, { refs, variant: 'mobile-low', token: 't6', parse: true } satisfies PedJobArgs, never);
    await ticks();
    await s2.answer();
    await pedJob(s2.svc, { stop: 't6' } satisfies PedStopArgs, never);
    expect(((await job2).result as { meshes: PersonMesh[] }).meshes).toHaveLength(1);
    // a file that is not a people GLB fails the read (the page's load fails and the mannequin stays)
    const s3 = service();
    const job3 = pedJob(s3.svc, { refs: refs.slice(0, 1), variant: 'mobile-low', token: 't7', parse: true } satisfies PedJobArgs, never);
    const failed = expect(job3).rejects.toThrow(/GLB/);
    await ticks();
    await s3.answer();
    await failed;
  });

  it('with decode the atlas page is decoded in the worker and its bitmap transferred; a worker without createImageBitmap answers the bytes (BD-REPAIR-M10d4-04)', async () => {
    const atlas = ['texture/ped.atlas'];
    const bitmap = { width: 256, height: 256, close: () => undefined } as unknown as ImageBitmap;
    vi.stubGlobal('createImageBitmap', async () => bitmap);
    try {
      const s = service();
      const job = pedJob(s.svc, { refs: atlas, variant: 'mobile-low', token: 't8', decode: true } satisfies PedJobArgs, never);
      await ticks();
      await s.answer();
      const out = await job;
      expect(out.result).toEqual({ bitmaps: [bitmap] });
      expect(out.transfer).toEqual([bitmap]);
      // the port hands the decoded page to the kit as it is
      const port = pedKitAssets({ job: async (_n, a) => ((a as PedJobArgs).decode ? { bitmaps: [bitmap] } : { files: [] }) }, 'mobile-low');
      expect(await port.image?.('texture/ped.atlas')).toEqual({ width: 256, height: 256, source: bitmap });
      // a page that does not decode: null (the kit draws untextured); a stopped read: rejects (asked again after the next quiet window)
      const bad = pedKitAssets({ job: async () => ({ bitmaps: [null] }) }, 'mobile-low');
      expect(await bad.image?.('texture/ped.atlas')).toBeNull();
      const cut = pedKitAssets({ job: async () => ({ bitmaps: [] }) }, 'mobile-low');
      await expect(cut.image?.('texture/ped.atlas')).rejects.toMatchObject({ name: 'AbortError' });
    } finally {
      vi.unstubAllGlobals();
    }
    // a worker whose createImageBitmap rejects the page answers its bytes (the page decodes them, as before), never a null bitmap
    vi.stubGlobal('createImageBitmap', async () => {
      throw new Error('no Blob decode in this worker');
    });
    try {
      const s3 = service();
      const job3 = pedJob(s3.svc, { refs: atlas, variant: 'mobile-low', token: 't10', decode: true } satisfies PedJobArgs, never);
      await ticks();
      await s3.answer();
      const out3 = await job3;
      expect((out3.result as { files: ArrayBuffer[] }).files).toHaveLength(1);
      expect(out3.transfer).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
    // no createImageBitmap in this worker (Node has none): the bytes, decoded on the page
    expect(typeof (globalThis as { createImageBitmap?: unknown }).createImageBitmap).toBe('undefined');
    const s2 = service();
    const job2 = pedJob(s2.svc, { refs: atlas, variant: 'mobile-low', token: 't9', decode: true } satisfies PedJobArgs, never);
    await ticks();
    await s2.answer();
    const out2 = await job2;
    expect((out2.result as { files: ArrayBuffer[] }).files).toHaveLength(1);
    expect(out2.transfer).toHaveLength(1);
  });

  it('the app\'s port asks the worker to parse the people files and parses none of them on the page', async () => {
    const calls: PedJobArgs[] = [];
    const client = {
      job: async (name: string, args: unknown): Promise<unknown> => {
        expect(name).toBe('world.ped');
        const a = args as PedJobArgs;
        calls.push(a);
        if (a.parse) return { meshes: a.refs.map((r) => parsePersonGlb(bytesOf(r, 'mobile-low'))) };
        return { files: a.refs.map(() => new Uint8Array(8).buffer) };
      },
    };
    const port = pedKitAssets(client, 'mobile-low');
    const before = parses.n;
    const kit = await loadPedKit({ ...port, image: async () => null });
    // the stand-in worker above parses each people file once (the same module); a parse on the page would double the count
    expect(parses.n - before).toBe(Object.keys(PED_ART.bodies).length * 2 + PED_ART.outfits.length);
    expect(kit).not.toBeNull();
    expect(calls.filter((c) => c.parse === true).map((c) => c.refs.length)).toEqual([8, 8, PED_ART.outfits.length]);
    expect(calls.every((c) => c.parse === true || c.refs.every((r) => r.startsWith('texture/')))).toBe(true);
    kit?.dispose();
  });
});
