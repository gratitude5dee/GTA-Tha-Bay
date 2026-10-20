/**
 * A scripted harness for the LandmarkLayer (M02d1, M02d2): landmarks on a line, a mock asset client, a mock chunk port with staged
 * meshes, an upload gate that runs the swap commits when a test says so, and the skyline set. Shared by the layer and skyline specs.
 */
import type { ChunkKey, QualityTierId } from '@dv/shared';
import type { LandmarkModelData } from '../../src/client/chunks/landmark-glb.ts';
import { LANDMARKS_RUNTIME, LandmarkLayer, type LandmarkDeps, type LandmarkHandle, type LandmarkSpot, type LandmarksRuntimeConfig, type PreparedRemesh, type SwapTask } from '../../src/client/chunks/landmark-layer.ts';
import { proxyIdOf } from '../../src/client/chunks/proxy-mask.ts';

export const model = (id: string, anchor: 'ground' | 'sea' = 'ground', fidelity = 'hi'): LandmarkModelData => ({
  id, fidelity, anchor, primitives: [], triangles: 100, vertices: 200, bounds: [0, 0, 0, 1, 1, 1],
});
export const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

export interface Harness {
  layer: LandmarkLayer;
  spots: LandmarkSpot[];
  clock: { ms: number };
  chunks: Map<ChunkKey, { proxies: number[]; masked: number[]; rerecords: number }>;
  /** Every request for a mesh (staged `prepare` or direct `remesh`), in order. */
  remeshes: { key: ChunkKey; mask: number[]; staged?: boolean; applied?: boolean; done?: boolean }[];
  mounted: string[];
  disposed: string[];
  /** Full-fidelity model loads by landmark id; `skyLoads` are the skyline (`lo`) reads. */
  loads: string[];
  skyLoads: string[];
  fail: Set<string>;
  ground: { ready: boolean };
  /** The world's first reveal (the skyline waits for it). */
  revealed: { value: boolean };
  /** The latest visibility of each mounted model by landmark id (`lm.x#sky` for the skyline instance). */
  visible: Map<string, boolean>;
  /** Gate tasks waiting for their frame, and the ones that ran. */
  queued: SwapTask[];
  ran: { id: string; uploads: number }[];
  /** Holds the staged chunk meshes until `releasePrepared()` (a slow worker). */
  hold: { on: boolean; pending: (() => void)[] };
  releasePrepared(): void;
  /** Runs every queued gate task (the model joins the scene). */
  runTasks(): void;
  /** Commits every requested direct remesh and every applied staged mesh the way the upload gate would (one re-record each). */
  commit(): void;
  /** runTasks, then commit. */
  settle(): void;
  step(x: number, frames?: number): Promise<void>;
}

export interface HarnessOpts {
  auto?: boolean;
  seaIds?: string[];
  /** Skyline: the draw distance of the tier and the landmark ids in the set. */
  skyline?: { rangeM: number; ids: string[] };
  qa?: boolean;
  ids?: string[];
}

/** Landmarks on a line: spot i at x = xs[i]; chunk `9/i/0` holds the proxy of landmark i. */
export function harness(tier: QualityTierId, xs: number[], opts: HarnessOpts = {}): Harness {
  const idOf = (i: number): string => opts.ids?.[i] ?? `lm.s${i}`;
  const spots: LandmarkSpot[] = xs.map((x, i) => ({ id: idOf(i), index: i, x, z: 0, asset: `building/${idOf(i)}` }));
  const chunks = new Map<ChunkKey, { proxies: number[]; masked: number[]; rerecords: number }>();
  spots.forEach((_s, i) => chunks.set(`9/${i}/0` as ChunkKey, { proxies: [proxyIdOf(i)], masked: [], rerecords: 0 }));
  const h: Harness = {
    layer: null as never, spots, clock: { ms: 1000 }, chunks, remeshes: [], mounted: [], disposed: [], loads: [], skyLoads: [], fail: new Set(), ground: { ready: true },
    revealed: { value: true }, visible: new Map(), queued: [], ran: [], hold: { on: false, pending: [] },
    releasePrepared() {
      this.hold.on = false;
      for (const f of this.hold.pending.splice(0)) f();
    },
    runTasks() {
      for (const t of this.queued.splice(0)) {
        t.run({ uploads: 1 });
        this.ran.push({ id: t.id, uploads: 1 });
      }
    },
    commit() {
      for (const r of this.remeshes) {
        if (r.done || (r.staged && !r.applied)) continue;
        const c = chunks.get(r.key)!;
        c.masked = [...r.mask];
        c.rerecords++;
        r.done = true;
        h.layer.onChunkCommitted(r.key, 0.5, 1);
      }
    },
    settle() {
      this.runTasks();
      this.commit();
    },
    async step(x, frames = 1) {
      for (let i = 0; i < frames; i++) {
        this.layer.update({ x, z: 0 }, this.clock.ms / 1000);
        await flush();
        if (opts.auto) this.settle();
        this.clock.ms += 16;
      }
    },
  };
  const cfg: LandmarksRuntimeConfig | undefined = opts.skyline ? { ...LANDMARKS_RUNTIME, skyline: { ...LANDMARKS_RUNTIME.skyline, ids: opts.skyline.ids } } : undefined;
  const deps: LandmarkDeps = {
    tier,
    spots,
    reconcileEvery: 1,
    ...(cfg ? { config: cfg } : {}),
    ...(opts.skyline ? { skylineRangeM: opts.skyline.rangeM } : {}),
    ready: () => h.revealed.value,
    ...(opts.qa ? { qa: true } : {}),
    load: (spot, o) => {
      (o.skyline ? h.skyLoads : h.loads).push(spot.id);
      return h.fail.has(spot.id) ? Promise.reject(new Error(`no model for ${spot.id}`)) : Promise.resolve(model(spot.id, opts.seaIds?.includes(spot.id) ? 'sea' : 'ground', o.skyline ? 'lo' : 'hi'));
    },
    mount: (spot, m) => {
      // a skyline (`lo`) instance is told apart by the `#sky` suffix
      const k = m.fidelity === 'lo' ? `${spot.id}#sky` : spot.id;
      h.mounted.push(k);
      h.visible.set(k, true);
      const handle: LandmarkHandle = {
        objects: 3,
        triangles: 100,
        setVisible: (v) => void h.visible.set(k, v),
        dispose: () => void h.disposed.push(k),
      };
      return handle;
    },
    chunks: {
      states: () => [...chunks.entries()].map(([key, c]) => ({ key, proxies: c.proxies, masked: c.masked })),
      prepare: (key, mask) => {
        h.remeshes.push({ key, mask, staged: true });
        const p: PreparedRemesh = { key, mask };
        if (!h.hold.on) return Promise.resolve(p);
        return new Promise((res) => h.hold.pending.push(() => res(p)));
      },
      apply: (p) => {
        const rec = h.remeshes.find((r) => r.staged && !r.applied && r.key === p.key);
        if (rec) rec.applied = true;
      },
      remesh: (key, mask) => void h.remeshes.push({ key, mask }),
      rerecords: (key) => chunks.get(key)?.rerecords ?? 0,
    },
    queue: (task) => void h.queued.push(task),
    groundY: () => (h.ground.ready ? 12.5 : null),
    waterY: 0,
    now: () => h.clock.ms,
  };
  h.layer = new LandmarkLayer(deps);
  return h;
}

