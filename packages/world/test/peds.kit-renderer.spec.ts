/** M10d4 AC-6: the instanced pedestrians drawing the kit (`PedRenderer` with an asset port), on mock asset bytes (the committed variants). */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Group, type InstancedMesh, type SkinnedMesh } from 'three/webgpu';
import type { QualityTierId } from '@dv/shared';
import { PackUnavailable } from '@dv/engine/assets/types';
import type { AssetService } from '@dv/engine/assets/service';
import type * as PersonGlbModule from '@dv/engine/client/avatar/person-glb';
import { PED_ASSETS, PED_BODIES, PED_PALETTE } from '../src/sim/peds/components.ts';
import { NEAR_PED_CAP, pedCap } from '../src/sim/peds/density.ts';
import { PED_ART, type PedKitAssets } from '../src/client/peds/kit.ts';
import { ART_QUIET_FRAMES, PedRenderer } from '../src/client/peds/instances.ts';
import { ArtGate, unsettledUnits, type WorldLoad } from '../src/client/peds/art-gate.ts';
import { pedJob, type PedJobArgs, type PedStopArgs } from '../src/client/peds/ped-job.ts';

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
  function service(): { svc: AssetService; gets: string[]; answer: () => Promise<void>; errors: unknown[] } {
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
            waiting.push({ ref: ref.url, signal: o.signal, go: () => resolve(new Uint8Array([1, 2, 3, 4]).buffer), stop });
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
});
