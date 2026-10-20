/**
 * QA page (built only when VITE_DV_QA=1, with a world: `DV_WORLD=synth`): runs the `traffic-synth` scenario in sim.worker (M03b1, AC-9).
 *
 * It does what the game page does for the sim and nothing else: the packs come from the same-origin mirror under `/media-local/`, one
 * `MessageChannel` to the worker answers its pack requests (each after a seeded 0 to 5 ms, so replies arrive out of order), and the
 * residency rule of DL-678 holds: before tick 0 the `p0` set around the fixed start is requested, received and pinned; ticks run in
 * batches of 600 and a batch starts only when nothing is pending. The 16 hashes at every 600th tick and the hash at tick 10,000 are
 * published on `window.__dvBridge.world.qa.hash`, where the Playwright test `@world-hash` compares them with
 * packages/world/test/golden/traffic-synth.json (made by the Node runner).
 */
import { SimHostImpl, bakedWorldConfig, type WorkerLike } from '@dv/engine/sim';
import { chunkKeyAt, decodeP0, Rng, type FrameSignal, type WorldIndex } from '@dv/shared';
import { TRAFFIC_SYNTH, WORLD_PORT, groundHeightAt, preloadKeys, spawnPose, type PackReply, type PackRequest, type WorldSimConfig } from '@dv/world/sim';

interface CatalogEntry {
  variants: { default: { key: string; sha256: string; bytes: number } };
}

interface HashResult {
  scenario: string;
  bakeId: string;
  seed: number;
  ticks: number;
  physicsBuild: string;
  checkpoints: Record<string, string>;
  final: string;
  stallTicks: number;
  preload: { wanted: number; resident: number; pending: number; atTick: number };
  agentsMax: number;
  out: { requests: number; maxInFlight: number };
  runMs: number;
}

const out = document.getElementById('out');
const results: Record<string, unknown> = {};
(window as unknown as { __dvBridge?: Record<string, unknown> }).__dvBridge = { world: { qa: results } };

const print = (text: string): void => {
  if (out) out.textContent = text;
};
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function json<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return (await r.json()) as T;
}

async function main(): Promise<void> {
  const t0 = performance.now();
  print('reading the catalog');
  const pointer = await json<{ key: string }>('/asset-catalog.json');
  const manifest = await json<{ entries: Record<string, CatalogEntry> }>(`/media-local/${pointer.key}`);
  const entry = (ref: string): CatalogEntry => {
    const e = manifest.entries[ref];
    if (!e) throw new Error(`the catalog has no ${ref}: build with DV_WORLD=synth`);
    return e;
  };
  const urlOf = (e: CatalogEntry): string => `/media-local/${e.variants.default.key}`;
  const index = await json<WorldIndex>(urlOf(entry('data/world-index')));

  const refs: WorldSimConfig['refs'] = {};
  const packRef = (ref: string, kind: 'chunk' | 'data'): WorldSimConfig['refs'][string] => {
    const e = entry(ref);
    return { url: urlOf(e), sha256: e.variants.default.sha256, bytes: e.variants.default.bytes, kind };
  };
  for (const tile of index.tiles.p0) refs[`world_pack/p0-${tile}`] = packRef(`world_pack/p0-${tile}`, 'chunk');
  refs['map_data/sf-graph.v1'] = packRef('map_data/sf-graph.v1', 'data');
  refs['data/district-grid.v1'] = packRef('data/district-grid.v1', 'data');

  // the fixed start: the City Hall arrival pose, on the ground of its tile
  const pose = spawnPose(index);
  const startKey = chunkKeyAt(9, pose.x, pose.z);
  const [, kx, ky] = startKey.split('/').map(Number) as [number, number, number];
  const tileRef = refs[`world_pack/p0-${Math.floor(kx / 4)}-${Math.floor(ky / 4)}`];
  if (!tileRef) throw new Error(`no p0 tile under the start ${startKey}`);
  const tile = decodeP0(await (await fetch(tileRef.url)).arrayBuffer());
  const ground = groundHeightAt(tile, pose.x, pose.z) ?? 0;
  const spawn: [number, number, number] = [pose.x, ground + TRAFFIC_SYNTH.spawnLiftM, pose.z];
  const world: WorldSimConfig = { bakeId: index.bakeId, p0Tiles: index.tiles.p0, refs, spawn, index };

  // the pack channel: this page plays asset.worker
  let requests = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  const delays = new Rng(7);
  const channel = new MessageChannel();
  channel.port1.onmessage = (ev: MessageEvent): void => {
    const req = ev.data as PackRequest;
    requests++;
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    const wait = Math.floor(delays.nextFloat() * 6);
    void (async () => {
      let reply: PackReply;
      let transfer: Transferable[] = [];
      try {
        await sleep(wait);
        const bytes = await (await fetch(req.ref.url)).arrayBuffer();
        reply = { seq: req.seq, bytes };
        transfer = [bytes];
      } catch (e) {
        reply = { seq: req.seq, error: { reason: 'other', message: String(e) } };
      }
      inFlight--;
      channel.port1.postMessage(reply, transfer);
    })();
  };

  const cfg = { ...bakedWorldConfig('canonical', TRAFFIC_SYNTH.every, index.bakeId), seed: TRAFFIC_SYNTH.seed };
  const host = new SimHostImpl({
    spawn: () => new Worker(new URL('../workers/sim.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike,
    sab: false,
    qa: true,
    initExtras: () => ({ ports: { [WORLD_PORT]: channel.port2 }, transfer: [channel.port2] }),
    onLog: (level, message) => {
      if (level !== 'info') console.warn(`sim.worker ${level}: ${message}`);
    },
  });
  results['error'] = null;
  let frameNo = 0;
  const pump = (): void => {
    const sig: FrameSignal = { frame: frameNo++, nowMs: performance.now(), dtSec: 0, paused: true, timeScale: 1 };
    host.frame(sig);
  };
  const until = async (cond: () => boolean, what: string, timeoutMs = 120_000): Promise<void> => {
    const end = performance.now() + timeoutMs;
    while (!cond()) {
      if (host.crashed) throw new Error(`the sim worker failed: ${host.crashed}`);
      if (performance.now() > end) throw new Error(`timed out waiting for ${what}`);
      pump();
      await sleep(4);
    }
  };
  let opId = 0;
  const ask = async (op: string, args?: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const id = ++opId;
    host.sendDebug({ t: 'debug.world', id, op, ...(args ? { args } : {}) });
    const name = `world.reply.${id}`;
    await until(() => host.qaResults.has(name), `the reply to ${op}`);
    return host.qaResults.get(name) as Record<string, unknown>;
  };

  print('starting sim.worker');
  await host.start(cfg, { strings: [], prefabs: [], config: { scenario: 'baked-world', spawn, spawnYaw: pose.yaw, world } });

  // residency rule: request, receive and pin the set before tick 0
  const keys = preloadKeys(index, pose.x, pose.z);
  print(`preloading ${keys.length} chunks`);
  await ask('preload', { keys });
  let state: Record<string, unknown> = { pending: 1, resident: 0, wanted: keys.length };
  const settleStart = performance.now();
  while ((state['pending'] as number) > 0 || (state['resident'] as number) < keys.length) {
    if (performance.now() - settleStart > 120_000) throw new Error('the preload set did not arrive');
    state = await ask('settle', { keys });
    await sleep(10);
  }
  const preload = { wanted: keys.length, resident: state['resident'] as number, pending: state['pending'] as number, atTick: 0 };

  // ticks in batches of 600; a batch starts only when nothing is pending
  const checkpoints: Record<string, string> = {};
  let stallTicks = 0;
  let agentsMax = 0;
  let tick = 0;
  const physicsBuild = cfg.physicsBuild;
  while (tick < TRAFFIC_SYNTH.ticks) {
    for (let guard = 0; ; guard++) {
      const s = await ask('settle', { keys });
      if ((s['pending'] as number) === 0) break;
      stallTicks += 1;
      if (guard > 5000) throw new Error('a pack stayed pending');
      await sleep(5);
    }
    const n = Math.min(TRAFFIC_SYNTH.every, TRAFFIC_SYNTH.ticks - tick);
    const target = tick + n;
    host.sendDebug({ t: 'debug.step', n });
    await until(() => (host.report?.stats.tick ?? 0) >= target, `tick ${target}`, 300_000);
    tick = target;
    if (tick % TRAFFIC_SYNTH.every === 0) {
      const h = host.report?.hash;
      if (!h || h.tick !== tick) throw new Error(`no hash for tick ${tick}`);
      checkpoints[String(tick)] = h.hex;
    }
    const t = await ask('traffic');
    agentsMax = Math.max(agentsMax, Number(t?.['agents'] ?? 0));
    print(`tick ${tick} of ${TRAFFIC_SYNTH.ticks}, agents ${String(t?.['agents'])}`);
  }
  const fin = await ask('hash');
  const result: HashResult = {
    scenario: TRAFFIC_SYNTH.id,
    bakeId: index.bakeId,
    seed: TRAFFIC_SYNTH.seed,
    ticks: TRAFFIC_SYNTH.ticks,
    physicsBuild,
    checkpoints,
    final: String(fin['hash']),
    stallTicks,
    preload,
    agentsMax,
    out: { requests, maxInFlight },
    runMs: performance.now() - t0,
  };
  results['hash'] = result;
  print([`bake ${result.bakeId.slice(0, 12)}`, `preload ${preload.resident}/${preload.wanted} resident before tick 0`, `checkpoints ${Object.keys(checkpoints).length}`, `final ${result.final}`, `run ${result.runMs.toFixed(0)} ms`].join('\n'));
  document.documentElement.dataset['dvWorldHash'] = 'done';
}

main().catch((e: unknown) => {
  results['error'] = String(e instanceof Error ? (e.stack ?? e.message) : e);
  print(`error: ${String(results['error'])}`);
  document.documentElement.dataset['dvWorldHash'] = 'error';
});
