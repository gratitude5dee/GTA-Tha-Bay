/**
 * The `missions-sf` suite of the canonical runner (M05c1): one mission on the real `sf` bake, headless, in Node. Same story mode,
 * same bot and same flags as the `missions` suite on the gray-box block (`packages/modes/story/src/scenario.ts`); the world is what
 * the game runs: the sim runtime with the world streaming module (road graph, chunk statics), the pursuit module and the modes
 * module, booted on the `baked-world` scenario with the player standing at the start of the mission.
 *
 * Determinism: the pack loader answers a request at once, and the world module applies replies only at the start of the next
 * tick, in request order, so the arrival of a pack never depends on wall time. The chunks around the start are requested, received
 * and pinned before tick 0 (the residency rule of DL-678). No ambient traffic and no pedestrians run (`WorldSimConfig.ambient` is
 * absent): a mission that wants cars spawns them as cast.
 *
 * Node only (reads the bake from `dist/world`); it never reaches a browser bundle.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { chunkKeyAt, enuFromLatLng, type InputFrame, type SimChunk, type UnlockDef, type WorldIndex, type BotInput, decodeP0 } from '../../../packages/shared/src/index.ts';
import {
  SimRuntime, attachSabWorker, bakedWorldConfig, createModesModule, createPursuitModule, createSabMain, type SimModule, type SimRuntimeEnv,
} from '../../../packages/engine/src/sim/index.ts';
import { registerScenarioLoader, type LoadedScenario, type RunSpec, type ScenarioEnv } from '../../../packages/engine/src/qa/index.ts';
import { groundHeightAt } from '../../../packages/world/src/sim/streaming/boot.ts';
import { WORLD_PORT, type PackReply, type PackRequest, type WorldSimConfig } from '../../../packages/world/src/sim/streaming/channel.ts';
import { createWorldStreamingModule } from '../../../packages/world/src/sim/streaming/module.ts';
import { preloadKeys } from '../../../packages/world/src/sim/traffic/scenario.ts';
import { headlessFighterDescriptor } from '../../../packages/modes/fighter/src/qa/headless.ts';
import { createStoryMode, type StoryController } from '../../../packages/modes/story/src/mode.ts';
import { observeMission, type MissionObs } from '../../../packages/modes/story/src/autoplay/observe.ts';
import { resolveMission } from '../../../packages/modes/story/src/compiler/resolve.ts';
import { decodeBundle, missionFlags, type MissionBundle, type MissionsHandle } from '../../../packages/modes/story/src/scenario.ts';
import type { ChunkKey } from '../../../packages/shared/src/index.ts';

export const SF_MISSIONS_SUITE = 'missions-sf';

/** Where the bot starts a mission that has no marker: `config/autoplay/mission-starts.json` (per mission), else the Yard gate. */
export interface MissionStarts {
  default: { lat: number; lng: number; yawDeg?: number };
  missions: Record<string, { lat: number; lng: number; yawDeg?: number }>;
}

export interface SfBake {
  bakeId: string;
  dir: string;
  index: WorldIndex;
}

export function loadSfBake(root: string): SfBake | null {
  const pointer = path.join(root, 'dist', 'world', 'latest-sf.json');
  if (!existsSync(pointer)) return null;
  const { bakeId } = JSON.parse(readFileSync(pointer, 'utf8')) as { bakeId: string };
  const dir = path.join(root, 'dist', 'world', bakeId);
  if (!existsSync(path.join(dir, 'world-index.json'))) return null;
  return { bakeId, dir, index: JSON.parse(readFileSync(path.join(dir, 'world-index.json'), 'utf8')) as WorldIndex };
}

/** The pack channel: reads the file at once and replies in the same call; the world module applies the reply at the next tick. */
class SyncLoader {
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  constructor(private readonly dir: string) {}
  start(): void {}
  close(): void {}
  postMessage(m: unknown): void {
    const req = m as PackRequest;
    const inPacks = path.join(this.dir, 'packs', req.ref.url);
    const buf = readFileSync(existsSync(inPacks) ? inPacks : path.join(this.dir, req.ref.url));
    const reply: PackReply = { seq: req.seq, bytes: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer };
    this.onmessage?.({ data: reply });
  }
}

function worldConfigOf(bake: SfBake, spawn: [number, number, number]): WorldSimConfig {
  const refs: WorldSimConfig['refs'] = {};
  const ref = (file: string): WorldSimConfig['refs'][string] => ({ url: file, sha256: '0'.repeat(64), bytes: 0, kind: 'chunk' });
  for (const t of bake.index.tiles.p0) refs[`world_pack/p0-${t}`] = ref(`p0-${t}.pack`);
  refs['map_data/sf-graph.v1'] = { ...ref('sf-graph.v1.pack'), kind: 'data' };
  refs['data/district-grid.v1'] = { ...ref('district-grid.v1.pack'), kind: 'data' };
  refs['data/transit-routes.v1'] = { ...ref('transit-routes.json'), kind: 'data' };
  return { bakeId: bake.bakeId, p0Tiles: bake.index.tiles.p0, refs, spawn, index: bake.index };
}

/** The p0 chunks within `rings` chunks of (x, z). */
function chunksAround(bake: SfBake, x: number, z: number, rings: number): SimChunk[] {
  const [, cx, cy] = chunkKeyAt(9, x, z).split('/').map(Number) as [number, number, number];
  const tiles = new Set<string>();
  for (let dy = -rings; dy <= rings; dy++) for (let dx = -rings; dx <= rings; dx++) tiles.add(`${Math.floor((cx + dx) / 4)}-${Math.floor((cy + dy) / 4)}`);
  const out: SimChunk[] = [];
  for (const t of [...tiles].sort()) {
    const f = path.join(bake.dir, 'packs', `p0-${t}.pack`);
    if (!existsSync(f)) continue;
    for (const c of decodeP0(readFileSync(f))) {
      const [, x2, y2] = c.key.split('/').map(Number) as [number, number, number];
      if (Math.abs(x2 - cx) <= rings && Math.abs(y2 - cy) <= rings) out.push(c);
    }
  }
  return out;
}

const NEUTRAL: InputFrame = { tick: 0, buttons: 0, pressed: 0, released: 0, moveX: 0, moveY: 0, throttle: 0, brake: 0, steer: 0, camYaw: 0, camPitch: 0, context: 0, device: 7 };
const MAX_WARMUP_TICKS = 1200;
const turn = (): Promise<void> => new Promise((r) => setImmediate(r));

export interface SfLoaderOptions {
  bake: SfBake;
  starts: MissionStarts;
  unlockDefs?: readonly UnlockDef[];
  /** Overrides the start pose of a mission (tests). */
  startOf?(bundle: MissionBundle): { lat: number; lng: number; yawDeg?: number } | null;
}

/** Where the bot starts: a marker trigger's own place, the per-mission entry of the starts table, else the table's default (the Yard). */
export function startOfMission(ir: MissionBundle['ir'], starts: MissionStarts): { lat: number; lng: number; yawDeg?: number } {
  const t = ir.start;
  if (t.k === 'marker' && Array.isArray(t.at.at)) return { lat: t.at.at[0], lng: t.at.at[1], ...(t.at.yawDeg !== undefined ? { yawDeg: t.at.yawDeg } : {}) };
  return starts.missions[ir.id] ?? starts.default;
}

async function loadSf(o: SfLoaderOptions, spec: RunSpec, env: ScenarioEnv): Promise<LoadedScenario & MissionsHandle> {
  const missionBytes = env.packs['mission'];
  if (!missionBytes) throw new Error(`suite '${SF_MISSIONS_SUITE}' needs the compiled mission (ScenarioEnv.packs.mission) for ${spec.scenario}`);
  const bundle = decodeBundle(missionBytes);
  if (bundle.ir.id !== spec.scenario) throw new Error(`suite '${SF_MISSIONS_SUITE}': scenario ${spec.scenario}, bundle holds ${bundle.ir.id}`);
  const params = (spec.bot.params ?? {}) as Record<string, unknown>;
  const { bake } = o;

  const at = o.startOf?.(bundle) ?? startOfMission(bundle.ir, o.starts);
  const p = enuFromLatLng(at.lat, at.lng);
  const near = chunksAround(bake, p.x, p.z, 1);
  const ground = groundHeightAt(near, p.x, p.z);
  if (ground === null) throw new Error(`world bake ${bake.bakeId.slice(0, 12)} has no ground at the start of ${bundle.ir.id} (${at.lat}, ${at.lng})`);
  const spawn: [number, number, number] = [p.x, ground + 1.5, p.z];
  const yaw = ((at.yawDeg ?? 0) * Math.PI) / 180;

  const holder: { controller: StoryController | null } = { controller: null };
  const mod = createWorldStreamingModule();
  const pursuit = createPursuitModule();
  // M08a2: the real fighter plays the bout hook (the bot plays the player's side); the `?hooks=stub` flag still takes the stub.
  const modes = createModesModule({
    // the loop has no turns for promises, so the sim half answers at once (headless descriptor)
    descriptors: [headlessFighterDescriptor()],
    ...(o.unlockDefs ? { unlockDefs: [...o.unlockDefs] } : {}),
    wrapStory: (free, senv) => {
      const m = createStoryMode(free, senv, { headless: true });
      holder.controller = m.controller;
      return m.sim;
    },
  });
  const made = createSabMain();
  const transport = attachSabWorker(made.init);
  const rtEnv: SimRuntimeEnv = {
    now: () => 0,
    blockFor: () => {},
    qa: true,
    modules: [mod, pursuit, modes] as SimModule[],
    ports: { [WORLD_PORT]: new SyncLoader(bake.dir) },
    ...(env.retry ? { retry: env.retry as never } : {}),
  };
  const runtime = new SimRuntime(transport, rtEnv);
  const cfg = { ...bakedWorldConfig('canonical', 0, bake.bakeId), seed: spec.seed };
  await runtime.boot(cfg, { strings: [], prefabs: [], config: { scenario: 'baked-world', spawn, spawnYaw: yaw, parked: false, world: worldConfigOf(bake, spawn) } });
  const sim = runtime.sim;
  const state = mod.state;
  if (!sim || !state) throw new Error('the world module did not start');
  // the input of the runner's step is player 0's frame; the runtime's own input system reads it from here
  runtime.bot = { device: 'bot', frame: () => sim.services.input ?? NEUTRAL } as BotInput;

  // residency before tick 0
  const keys: ChunkKey[] = preloadKeys(bake.index, p.x, p.z);
  state.store.pin('p0', keys);
  let settled = false;
  void state.store.preload(keys.map((key) => ({ level: 'p0' as const, key }))).then(() => (settled = true));
  for (let i = 0; i < 100_000 && !(settled && state.pendingCount() === 0); i++) {
    state.applyReplies();
    await turn();
  }
  if (!(settled && state.pendingCount() === 0)) throw new Error('the preload set did not arrive');

  sim.core.addResource({
    name: 'story.mission',
    hash: (h) => h.str(holder.controller?.rt?.stateHash() ?? ''),
    save() {},
    load() {},
  });

  const host = modes.host();
  if (!host) throw new Error(`suite '${SF_MISSIONS_SUITE}': the modes module has no host`);
  const started = host.startQa('story');
  if (!started.ok) throw new Error(`suite '${SF_MISSIONS_SUITE}': the story mode did not start (${JSON.stringify(started)})`);

  // Warm up: the player is released onto the ground, the road graph and the world services come up, the mode enters and the mission resolves
  const ctrl = (): StoryController => holder.controller as StoryController;
  let ready = false;
  let released = 0;
  for (let i = 0; i < MAX_WARMUP_TICKS && !ready; i++) {
    sim.step(1);
    await Promise.resolve();
    await Promise.resolve();
    const c = holder.controller;
    ready = c !== null && c.ctx !== null && c.story !== null && sim.services.world.api !== null && !('errors' in resolveMission(bundle.ir, c.ctx.world.resolver));
    if (ready) released = i;
  }
  const begun = ctrl().begin(bundle.ir, {
    seed: spec.seed,
    flags: missionFlags(spec),
    directors: bundle.directors,
    lines: bundle.lines,
    ...(typeof params['stage'] === 'number' ? { stage: params['stage'] } : {}),
  });
  if (!begun.ok) throw new Error(`suite '${SF_MISSIONS_SUITE}': ${bundle.ir.id} did not resolve in the world (after ${released} warm-up ticks): ${begun.errors.map((e) => `${e.code} ${e.pointer} ${e.message}`).join('; ')}`);

  const script = modes.script();
  if (!script) throw new Error(`suite '${SF_MISSIONS_SUITE}': the modes module has no script services`);
  const mission = (): MissionObs | null => {
    const c = holder.controller;
    return c && c.rt && c.ctx ? observeMission(c.rt, c.ctx) : null;
  };
  const wrapped = new Proxy(sim, {
    get(target, k) {
      if (k === 'dispose') return () => runtime.dispose();
      const v = Reflect.get(target, k) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
  const handle: MissionsHandle = { sim: wrapped, controller: ctrl(), modes, bundle, timeline: script.timeline, mission };
  env.onLoaded?.(handle);
  return {
    ...handle,
    observe: () => (mission() ?? { phase: 'none' }) as unknown as Readonly<Record<string, unknown>>,
  } as LoadedScenario & MissionsHandle;
}

let registered = false;

/** Registers the `missions-sf` loader (once per process; the bake and the starts table are those of the first call). */
export function registerSfMissionsLoader(o: SfLoaderOptions): void {
  if (registered) return;
  registerScenarioLoader(SF_MISSIONS_SUITE, (spec, env) => loadSf(o, spec, env));
  registered = true;
}

