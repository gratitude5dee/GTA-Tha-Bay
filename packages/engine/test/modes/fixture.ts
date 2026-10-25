import { RngStreams, type EcsApi, type GameModeDescriptor, type GameModeId, type GameModeSim, type JsonObject, type ModeContext, type ModeExitReason, type ModeResult, type SaveReason, type SimEvent, type SimProfile, type SlotId } from '@dv/shared';
import { SimUiBridge } from '../../src/sim/ui/bridge.ts';
import {
  AutosavePolicy, EconomyImpl, ModeEventBus, ModeHost, UnlockRegistryImpl, bindModeSave, builtinDescriptors, builtinUnlockDefs, createCommandDispatcher, freshSlices,
  type AutosaveGameState, type CommandDeps, type SessionSlices,
} from '../../src/sim/modes/index.ts';
import type { SandboxVehiclePort } from '../../src/sim/modes/sandbox-vehicle-port.ts';
import { createWaypointMemo, type Pose, type SandboxWorldPort, type WaypointMemo } from '../../src/sim/modes/builtin/index.ts';

export interface Posted {
  slot: SlotId;
  data: unknown;
  reason: SaveReason;
}

export interface Rig {
  host: ModeHost;
  slices: SessionSlices;
  ui: SimUiBridge;
  unlocks: UnlockRegistryImpl;
  economy: EconomyImpl;
  events: SimEvent[];
  posted: Posted[];
  telemetry: { name: string; props: Record<string, string | number | boolean> }[];
  restarts: { profile: SimProfile; then: GameModeId }[];
  game: Omit<AutosaveGameState, 'running'>;
  clockT: { t: number };
  tick: { n: number };
  /** Runs `n` ticks: lets pending imports settle, ticks the host, flushes the bridge. */
  run(n: number): Promise<void>;
  dispatch: (cmd: Parameters<ReturnType<typeof createCommandDispatcher>>[0]) => void;
  capabilitySet: (string | null)[];
  /** The map pin memo of the dispatcher (M04e2). */
  waypoint: WaypointMemo;
}

export interface RigOptions {
  descriptors?: GameModeDescriptor[];
  profile?: SimProfile;
  qa?: boolean;
  slices?: SessionSlices;
  builtin?: boolean;
  /** The room port (M04e0): what `ctx.net` reads. Absent in single player. */
  net?: () => ModeContext['net'];
  /** Passed to the dispatcher; absent by default. */
  teleport?: CommandDeps['teleport'];
  /** Replaces the empty world of the dispatcher; the same object is the `ctx.world` of the modes. */
  world?: () => ReturnType<CommandDeps['world']>;
  /** The clock a mode sees as `ctx.clock` (M04e1). Absent: null, as in a build without a clock. */
  clock?: unknown;
  /** The sandbox's weather hold and world speed (M04e1), for the sandbox sim and the dispatcher. */
  sandboxWorld?: () => SandboxWorldPort | null;
  /** The local player's pose for the sandbox and the dispatcher (M04e2). Absent: no player (null). */
  playerPose?: () => Pose | null;
  /** The engine side of the sandbox's car spawner (M04e3). Absent: null, as on a build without the vehicle module. */
  sandboxVehicles?: SandboxVehiclePort;
  /** What `ctx.assets.ready` answers (M04e3). The default keeps `() => true`. */
  assetsReady?: (refs: string[]) => boolean;
}

/** A sim-free harness: the real ModeHost, registry, economy, bridge and policy on fake ports. */
export function makeRig(o: RigOptions = {}): Rig {
  const slices = o.slices ?? freshSlices();
  const ui = new SimUiBridge();
  const tick = { n: 0 };
  const events: SimEvent[] = [];
  const posted: Posted[] = [];
  const capabilitySet: (string | null)[] = [];
  const telemetry: Rig['telemetry'] = [];
  const restarts: Rig['restarts'] = [];
  const game: Rig['game'] = { heat: 0, pursuit: false, mission: false };
  const clockT = { t: 0 };
  const waypoint = createWaypointMemo();
  const holder: { host: ModeHost | null } = { host: null };
  const bus = new ModeEventBus((e) => events.push(e));
  const save = bindModeSave({ post: (slot, data, reason) => void posted.push({ slot, data, reason }) }, { setCapability: (c) => void capabilitySet.push(c) });
  const tel = { emit: (name: string, props: Record<string, string | number | boolean>): void => void telemetry.push({ name, props }) };
  const unlocks = new UnlockRegistryImpl({ core: () => slices.core, ui, saveUnlock: () => void holder.host?.autosave.request('unlock'), telemetry: tel as never });
  unlocks.register(builtinUnlockDefs());
  const economy = new EconomyImpl({ wallet: () => slices.story.wallet, tick: () => tick.n, clockT: () => clockT.t, ui });
  const descriptors = [...(o.builtin === false ? [] : builtinDescriptors({ story: () => slices.story, sandbox: () => slices.sandbox, playerPose: o.playerPose ?? (() => null), waypoint: () => waypoint.get(), ...(o.sandboxVehicles ? { vehicles: () => o.sandboxVehicles as SandboxVehiclePort } : {}), ...(o.sandboxWorld ? { world: o.sandboxWorld } : {}) })), ...(o.descriptors ?? [])];
  const byId = new Map(descriptors.map((d) => [d.id, d]));
  const host = new ModeHost({
    descriptors: [...byId.values()],
    slices: () => slices,
    ports: {
      tick: () => tick.n,
      ecs: {} as EcsApi,
      prefabs: null,
      physics: { groundY: () => null, castRay: () => null },
      rng: new RngStreams(7),
      clock: (o.clock ?? null) as never,
      pursuit: null,
      interaction: null,
      camera: { direct: () => undefined, release: () => undefined },
      input: { frame: () => { throw new Error('no input in the rig'); }, push: () => undefined, pop: () => undefined },
      unlocks,
      economy,
      events: bus,
      ui,
      assets: { request: () => undefined, ready: (refs) => (o.assetsReady ? o.assetsReady(refs) : true) },
      telemetry: tel as never,
      // Lazy: `world()` is called only when a mode reads a member of `ctx.world`.
      world: (o.world ? new Proxy({}, { get: (_t, k) => (o.world?.() as unknown as Record<string | symbol, unknown>)[k] }) : {}) as never,
      ...(o.net ? { net: o.net } : {}),
    },
    save,
    unlocks,
    economy,
    sessionProfile: () => o.profile ?? 'local',
    restart: (profile, then) => void restarts.push({ profile, then }),
    game: () => game,
    tick: () => tick.n,
    wallMs: () => 1_700_000_000_000 + tick.n,
    seed: () => 42,
    qa: o.qa ?? true,
  });
  holder.host = host;
  const dispatch = createCommandDispatcher({
    host, slices: () => slices, ui, events: bus, tick: () => tick.n,
    sandboxContext: () => host.stack.entries.find((e) => e.id === 'sandbox' && e.state === 'Running')?.ctx ?? null,
    world: o.world ?? (() => ({}) as never),
    waypoint,
    ...(o.playerPose ? { playerPose: o.playerPose } : {}),
    ...(o.teleport ? { teleport: o.teleport } : {}),
    ...(o.sandboxWorld ? { sandboxWorld: o.sandboxWorld } : {}),
  });
  return {
    host, slices, ui, unlocks, economy, events, posted, telemetry, restarts, game, clockT, tick, dispatch, capabilitySet, waypoint,
    async run(n) {
      for (let i = 0; i < n; i++) {
        await Promise.resolve();
        await Promise.resolve();
        host.tick();
        tick.n++;
        ui.flushTick();
      }
    },
  };
}

export interface FixtureLog {
  calls: string[];
  lastCtx: ModeContext | null;
  result: ModeResult;
}

/** A recording mode sim. */
export function fixtureSim(log: FixtureLog, saveSlice: JsonObject | null = null): GameModeSim {
  return {
    enter(ctx) {
      log.lastCtx = ctx;
      log.calls.push('enter');
    },
    tick() {
      log.calls.push('tick');
    },
    suspendedTick() {
      log.calls.push('suspendedTick');
    },
    exit(_ctx, reason: ModeExitReason) {
      log.calls.push(`exit:${reason}`);
      return log.result;
    },
    saveSlice: () => saveSlice,
    onEvent(_ctx, e) {
      log.calls.push(`event:${e.t}${e.s ? `:${e.s}` : ''}`);
    },
  };
}

export function fixtureDescriptor(id: GameModeId, over: Partial<GameModeDescriptor>, sim: GameModeSim): GameModeDescriptor {
  return {
    id,
    version: 1,
    titleKey: `mode.${id}.title`,
    tile: { art: `ui/mode-${id}`, order: 50 },
    status: 'available',
    unlock: null,
    standalone: true,
    embeddable: true,
    requires: { simProfile: 'any', world: 'city', physics: false, xr: 'none', inputContexts: ['menu'], network: 'none' },
    saveSlot: null,
    sliceSchema: 1,
    sim: () => Promise.resolve({ default: sim }),
    ui: () => Promise.resolve({ default: { mount() {}, unmount() {}, inputContexts: ['menu'] } }),
    ...over,
  };
}

export const newLog = (): FixtureLog => ({ calls: [], lastCtx: null, result: { outcome: 'finish' } });
export { AutosavePolicy };
