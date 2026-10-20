/**
 * The Node runner of the `traffic-synth` determinism scenario (M03b1, AC-8; DL-678). It boots the real sim runtime with the world
 * streaming module on the `synth` bake and the `baked-world` scenario (the player standing at the City Hall arrival pose), 10,000
 * ticks in the `canonical` profile, seed 0xC0FFEE, and records the state hash at every 600th tick.
 *
 * Residency rule: before tick 0 every `p0` tile within the canonical `R_amb` plus one ring of chunks around the start is requested,
 * received and pinned (the replies are applied between ticks, in `seq` order); while the run goes the runner does not advance a tick
 * while a request is pending (it stalls and counts `stallTicks`, it never skips). The loader answers either in order and at once
 * or, for the out-of-order run, after a seeded number of event-loop turns, so arrival time never enters the hash.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Rng, chunkKeyAt, type ChunkKey, type WorldIndex } from '@dv/shared';
import { SimRuntime, attachSabWorker, bakedWorldConfig, createSabMain, type SimRuntimeEnv } from '@dv/engine/sim';
import { groundHeightAt, spawnPose } from '../../src/sim/streaming/boot.ts';
import { WORLD_PORT, type PackReply, type PackRequest, type WorldSimConfig } from '../../src/sim/streaming/channel.ts';
import { createWorldStreamingModule, type WorldStreamingModule } from '../../src/sim/streaming/module.ts';
import { STREAMING } from '../../src/sim/streaming/plan.ts';
import { AMBIENT_RADIUS_M } from '../../src/sim/traffic/density.ts';
import type { BakeData } from './bake.ts';

/** Height above the ground the page places the player at (`SPAWN_LIFT_M` of the world boot). */
const SPAWN_LIFT_M = 1.5;

export const TRAFFIC_SYNTH = { seed: 0xc0ffee, ticks: 10_000, every: 600 } as const;

export interface TrafficRunOptions {
  bake: BakeData;
  ticks?: number;
  every?: number;
  /** `shuffled` answers each request after 0 to 5 event-loop turns, drawn from a seeded stream, so replies arrive out of order. */
  order?: 'in-order' | 'shuffled';
  shuffleSeed?: number;
  /** Called after every tick with the tick that just ran. */
  onTick?: (tick: number, rt: SimRuntime, mod: WorldStreamingModule) => void;
}

export interface TrafficRunResult {
  bakeId: string;
  seed: number;
  ticks: number;
  checkpoints: Record<string, string>;
  final: string;
  /** Ticks the runner waited for a pending request (not hashed). */
  stallTicks: number;
  /** The `p0` keys requested, received and pinned before tick 0. */
  preload: ChunkKey[];
  agentsMax: number;
  stats: Record<string, unknown>;
}

class Loader {
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  private rng: Rng;
  constructor(private readonly dir: string, private readonly shuffled: boolean, seed: number) {
    this.rng = new Rng(seed);
  }
  start(): void {}
  close(): void {}
  postMessage(m: unknown): void {
    const req = m as PackRequest;
    const inPacks = path.join(this.dir, 'packs', req.ref.url);
    const buf = readFileSync(existsSync(inPacks) ? inPacks : path.join(this.dir, req.ref.url));
    const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const reply: PackReply = { seq: req.seq, bytes };
    const deliver = (): void => this.onmessage?.({ data: reply });
    if (!this.shuffled) {
      deliver();
      return;
    }
    let turns = Math.floor(this.rng.nextFloat() * 6);
    const wait = (): void => {
      if (turns-- <= 0) deliver();
      else setImmediate(wait);
    };
    setImmediate(wait);
  }
}

/** The tiles of a bake's `p0` as pack refs the loader reads from `packs/`. */
export function worldConfigOf(bake: BakeData, spawn: [number, number, number]): WorldSimConfig {
  const refs: WorldSimConfig['refs'] = {};
  const ref = (file: string): WorldSimConfig['refs'][string] => ({ url: file, sha256: '0'.repeat(64), bytes: 0, kind: 'chunk' });
  for (const t of bake.index.tiles.p0) refs[`world_pack/p0-${t}`] = ref(`p0-${t}.pack`);
  refs['map_data/sf-graph.v1'] = { ...ref('sf-graph.v1.pack'), kind: 'data' };
  refs['data/district-grid.v1'] = { ...ref('district-grid.v1.pack'), kind: 'data' };
  return { bakeId: bake.bakeId, p0Tiles: bake.index.tiles.p0, refs, spawn, index: bake.index as WorldIndex };
}

/** The `p0` chunk keys inside the residency set of a start point: within `R_amb` + one chunk of it, and the streaming ring of the tier. */
export function preloadKeys(index: WorldIndex, x: number, z: number): ChunkKey[] {
  const tier = 'mobile-low';
  const reach = Math.max(AMBIENT_RADIUS_M[tier], STREAMING.tiers[tier].physicsM) + 256 + 256;
  const out: ChunkKey[] = [];
  const have = new Set(index.tiles.p0);
  const c0 = chunkKeyAt(9, x, z).split('/').map(Number) as [number, number, number];
  const n = Math.ceil(reach / 256);
  for (let j = -n; j <= n; j++) {
    for (let i = -n; i <= n; i++) {
      const cx = (c0[1] as number) + i, cy = (c0[2] as number) + j;
      if (!have.has(`${Math.floor(cx / 4)}-${Math.floor(cy / 4)}`)) continue;
      out.push(`9/${cx}/${cy}` as ChunkKey);
    }
  }
  return out;
}

const turn = (): Promise<void> => new Promise((r) => setImmediate(r));

export async function runTrafficSynth(o: TrafficRunOptions): Promise<TrafficRunResult> {
  const { bake } = o;
  const ticks = o.ticks ?? TRAFFIC_SYNTH.ticks;
  const every = o.every ?? TRAFFIC_SYNTH.every;
  const pose = spawnPose(bake.index);
  const chunkKey = chunkKeyAt(9, pose.x, pose.z);
  const [, cx, cy] = chunkKey.split('/').map(Number) as [number, number, number];
  const near = bake.chunks((k) => {
    const [, x, y] = k.split('/').map(Number) as [number, number, number];
    return Math.abs(x - cx) <= 1 && Math.abs(y - cy) <= 1;
  });
  const ground = groundHeightAt(near, pose.x, pose.z) ?? 0;
  const spawn: [number, number, number] = [pose.x, ground + SPAWN_LIFT_M, pose.z];
  const world = worldConfigOf(bake, spawn);
  const loader = new Loader(bake.dir, o.order === 'shuffled', o.shuffleSeed ?? 1);

  const mod = createWorldStreamingModule();
  const made = createSabMain();
  const transport = attachSabWorker(made.init);
  const env: SimRuntimeEnv = { now: () => 0, blockFor: () => {}, qa: true, modules: [mod], ports: { [WORLD_PORT]: loader } };
  const runtime = new SimRuntime(transport, env);
  const cfg = { ...bakedWorldConfig('canonical', every, bake.bakeId), seed: TRAFFIC_SYNTH.seed };
  await runtime.boot(cfg, { strings: [], prefabs: [], config: { scenario: 'baked-world', spawn, spawnYaw: pose.yaw, world } });
  const sim = runtime.sim;
  const state = mod.state;
  if (!sim || !state) throw new Error('the world module did not start');

  // residency before tick 0
  const keys = preloadKeys(bake.index, pose.x, pose.z);
  state.store.pin('p0', keys);
  const loaded = state.store.preload(keys.map((key) => ({ level: 'p0' as const, key })));
  let settled = false;
  void loaded.then(() => (settled = true));
  for (let i = 0; i < 100_000 && !(settled && state.pendingCount() === 0); i++) {
    state.applyReplies();
    await turn();
  }
  if (!(settled && state.pendingCount() === 0)) throw new Error('the preload set did not arrive');

  const checkpoints: Record<string, string> = {};
  let stallTicks = 0;
  let agentsMax = 0;
  for (let i = 0; i < ticks; i++) {
    while (state.pendingCount() > 0) {
      stallTicks++;
      state.applyReplies();
      await turn();
    }
    sim.core.stepOnce();
    const t = sim.core.tick;
    if (t % every === 0 && sim.core.lastHash) checkpoints[String(t)] = sim.core.lastHash.hex;
    const n = mod.traffic?.sim.agents.size ?? 0;
    if (n > agentsMax) agentsMax = n;
    o.onTick?.(t, runtime, mod);
  }
  const final = sim.hash();
  const stats = mod.traffic ? { ...mod.traffic.sim.stats, live: mod.traffic.sim.agents.size } : {};
  runtime.dispose();
  return { bakeId: bake.bakeId, seed: TRAFFIC_SYNTH.seed, ticks, checkpoints, final, stallTicks, preload: keys, agentsMax, stats };
}

export type { SimRuntimeEnv };
