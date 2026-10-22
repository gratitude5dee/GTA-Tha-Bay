/**
 * The modes sim module (M04a2): ModeHost, the unlock registry, the economy, the autosave policy and the UI bridge, applied to the sim
 * worker through the `SimModule` hook (DL-651) next to the world and pursuit modules.
 *
 *  - It builds everything in `onInit`, when the sim, the clock, the vehicle module and (on a world build) the world services exist.
 *  - The economy binds the pursuit director's `WalletPort` and the transit `FareSink` (forwarding objects the other modules took at
 *    their start), so the bust fine and the fares go through `EconomyApi` with their idempotency keys.
 *  - Its hashed resources (`economy`) are registered the first time they are used, so a session that never touches money hashes as before.
 *  - Sim code under the C02 lint: no `Date`, no timers; the worker injects wall time.
 */
import {
  SimStage, datan2,
  type CameraDirective, type EcsApi, type GameModeDescriptor, type InputContextId, type InputFrame, type InteractionApi, type JsonObject,
  type PhysicsQueries, type PrefabService, type PursuitApi, type SaveReason, type SimEvent, type SlotId, type UiBridge, type UiCommand, type WorldApi,
} from '@dv/shared';
import { GROUP_BIT } from '../physics/groups.ts';
import { Control, LocalPlayer, Transform } from '../ecs/components.ts';
import type { SimModule, SimModuleContext } from '../runtime.ts';
import type { DebugCommand } from '../transport/envelope.ts';
import { requestTeleport } from '../control/ownership.ts';
import type { PursuitModule } from '../pursuit/module.ts';
import type { ModeSaveBinding, SaveWritePort } from '../save-port.ts';
import { SimUiBridge, type UiOut } from '../ui/bridge.ts';
import { builtinDescriptors, builtinUnlockDefs, defaultSandbox, defaultStory } from './builtin/index.ts';
import { bindModeSave } from './capability-bind.ts';
import { createCommandDispatcher, settingsView } from './commands.ts';
import { ModeEventBus, ModeHost, type SessionSlices } from './host.ts';
import { EconomyImpl, economyWallet, type ForwardingFareSink } from './economy.ts';
import { NotYetAvailable } from './stubs.ts';
import { createWorldStandin } from './world-standin.ts';
import { UnlockRegistryImpl } from './unlocks.ts';
import { defaultSettings } from './settings-defaults.ts';

export * from './host.ts';
export * from './stack.ts';
export * from './context.ts';
export * from './unlocks.ts';
export * from './economy.ts';
export * from './autosave.ts';
export * from './capability-bind.ts';
export * from './commands.ts';
export * from './stubs.ts';
export * from './world-standin.ts';
export { builtinDescriptors, builtinUnlockDefs, defaultSandbox, defaultStory, applyToggle, NEVER_WANTED, COMING_SOON_IDS } from './builtin/index.ts';
export { defaultSettings } from './settings-defaults.ts';

export const MODES_MODULE_ID = 'engine.modes';
/** The clock is pushed to the HUD view model this often (ticks); the minute of game time changes about every two ticks. */
const CLOCK_PATCH_EVERY = 30;

export interface ModesModuleOptions {
  /** Reads the open profile's slices; the worker takes them from the SaveService. Default: a fresh profile. */
  loadSlices?(profileId?: string): Promise<SessionSlices>;
  /** Wall-clock milliseconds (the worker passes `Date.now`; the sim has no clock of its own). */
  wallMs?(): number;
  /** Extra or replacement descriptors, registered after the built-in ones (tests, later modes). */
  descriptors?: readonly GameModeDescriptor[];
}

export interface ModesModule extends SimModule {
  host(): ModeHost | null;
  economy(): EconomyImpl | null;
  unlocks(): UnlockRegistryImpl | null;
  ui(): SimUiBridge | null;
  slices(): SessionSlices | null;
  /** Applies a `UiCommand` now (between ticks) and flushes the view-model patches it caused. */
  command: (cmd: UiCommand) => void;
  /** `SaveControl.collect`: the slots to write for a `save.request` message, or null when no save is due. */
  collect(reason: SaveReason): { slot: SlotId; data: unknown }[] | null;
  /** The telemetry events the sim queued for the page, newest last (QA). */
  telemetryQueue(): readonly { name: string; props: Record<string, string | number | boolean> }[];
  /** Installs the QA command handler (`qa.ts`); the QA worker entry does it, so a production bundle carries no QA ops. */
  installQa(h: ModesQaHandler): void;
}

/** What the QA handler may touch. */
export interface ModesQaContext {
  host: ModeHost;
  economy: EconomyImpl;
  unlocks: UnlockRegistryImpl;
  ui: SimUiBridge | null;
  telemetry: readonly { name: string; props: Record<string, string | number | boolean> }[];
}
export type ModesQaHandler = (cx: ModesQaContext, cmd: Extract<DebugCommand, { t: 'debug.modes' }>, reply: (name: string, data: unknown) => void) => void;

/** DL-681: the world's `{t: 'world.boundary', s: 'countyLine'}` event is one toast with the key `world.boundary.countyLine`. */
export function boundaryToast(ui: UiBridge, e: SimEvent): boolean {
  if (e.t !== 'world.boundary' || e.s !== 'countyLine') return false;
  ui.toast({ id: 'world.boundary.countyLine', kind: 'info', text: 'world.boundary.countyLine' });
  return true;
}

export function freshSlices(): SessionSlices {
  return {
    core: { avatar: {}, unlocks: [], firstEncounters: {}, garage: [], inventory: { items: [], wardrobe: [] }, stats: { distanceKm: 0, pursuitsEscaped: 0, busted: 0, fightsWon: 0, racesWon: 0, playtimeSec: 0 } },
    story: defaultStory(),
    sandbox: defaultSandbox(),
    settings: defaultSettings(),
  };
}

const ZERO_FRAME = (tick: number): InputFrame => ({ tick, buttons: 0, pressed: 0, released: 0, moveX: 0, moveY: 0, throttle: 0, brake: 0, steer: 0, camYaw: 0, camPitch: 0, context: 0, device: 0 });

export function createModesModule(opts: ModesModuleOptions = {}): ModesModule {
  let sim: SimModuleContext['sim'] | null = null;
  let host: ModeHost | null = null;
  let economy: EconomyImpl | null = null;
  let unlocks: UnlockRegistryImpl | null = null;
  let ui: SimUiBridge | null = null;
  let slices: SessionSlices | null = null;
  let dispatch: ((cmd: UiCommand) => void) | null = null;
  let reply: ((name: string, data: unknown) => void) | null = null;
  let qaHandler: ModesQaHandler | null = null;
  const telemetry: { name: string; props: Record<string, string | number | boolean> }[] = [];

  const module: ModesModule = {
    id: MODES_MODULE_ID,
    systems: [
      {
        id: 'engine.modes.tick', owner: 'S01', stage: SimStage.Script, order: 0,
        run: () => host?.tick(),
      },
      {
        id: 'engine.modes.ui', owner: 'S01', stage: SimStage.Publish, order: 900,
        run: ({ tick, services }) => {
          if (!ui) return;
          const clock = (services as { clock?: { now(): { t: number; paused: boolean }; env(): { hour: number; weather: string } } | null }).clock;
          if (clock && tick % CLOCK_PATCH_EVERY === 0) {
            const t = clock.now();
            ui.patch('hud.clock', { t: t.t, hour: Math.floor(clock.env().hour * 100) / 100, weather: clock.env().weather, paused: t.paused });
          }
          ui.flushTick();
        },
      },
    ],
    host: () => host,
    economy: () => economy,
    unlocks: () => unlocks,
    ui: () => ui,
    slices: () => slices,
    command: (cmd) => {
      dispatch?.(cmd);
      ui?.flushTick();
    },
    collect: (reason) => host?.autosave.collect(reason) ?? null,
    telemetryQueue: () => telemetry,

    async onInit(ctx) {
      sim = ctx.sim;
      const s = sim;
      const services = s.services;
      const runtime = ctx.runtime;
      try {
        slices = (await opts.loadSlices?.()) ?? freshSlices();
      } catch (e) {
        runtime.env.log?.('warn', `modes: profile not loaded, starting a fresh one (${e instanceof Error ? e.message : String(e)})`);
        slices = freshSlices();
      }
      const live = slices;
      const bridge = (ui = new SimUiBridge());
      const bus = new ModeEventBus((e: SimEvent) => void services.events.push(e));
      // Engine events the shell shows as toasts (DL-681): hook the log's `push` once, leave every event in the log.
      const log = services.events;
      const push = log.push.bind(log);
      log.push = (e: SimEvent): void => {
        push(e);
        boundaryToast(bridge, e);
      };
      const tick = (): number => s.core.tick;
      const noPort: SaveWritePort = { post: () => undefined };
      const control = runtime.saveControl;
      const save: ModeSaveBinding = bindModeSave(control ?? noPort, control ?? {});
      const tel = {
        emit: (name: string, props: Record<string, string | number | boolean>): void => {
          telemetry.push({ name, props });
          if (telemetry.length > 50) telemetry.shift();
          services.events.push({ t: 'telemetry', tick: tick(), s: `${name}|${JSON.stringify(props)}` });
        },
      };

      economy = new EconomyImpl({
        wallet: () => live.story.wallet,
        tick,
        clockT: () => services.clock?.now().t ?? tick(),
        ui: bridge,
        onFirstUse: () => {
          try {
            s.core.addResource((economy as EconomyImpl).resource());
          } catch {
            // already registered
          }
        },
      });
      const econ = economy;

      const unl = (unlocks = new UnlockRegistryImpl({
        core: () => live.core,
        ui: bridge,
        saveUnlock: () => void host?.autosave.request('unlock'),
        telemetry: tel as never,
      }));
      unl.register(builtinUnlockDefs());

      const backend = s.backend;
      const physics: PhysicsQueries = {
        groundY: (x, z) => {
          const hit = backend.castRay([x, 500, z], [0, -1, 0], 1000, GROUP_BIT.static);
          return hit ? 500 - hit.toi : null;
        },
        castRay: (o, dir, maxM) => {
          const hit = backend.castRay(o, dir, maxM, 0xffff & ~GROUP_BIT.sensor);
          return hit ? { toi: hit.toi, normal: hit.normal, entity: hit.entity } : null;
        },
      };
      const standin = createWorldStandin({ groundY: physics.groundY });
      const world = new Proxy({} as WorldApi, {
        get: (_t, k) => ((services.world.api ?? standin) as unknown as Record<string, unknown>)[k as string],
      });
      const pursuitMod = (runtime.env.modules ?? []).find((m) => m.id === 'engine.pursuit') as PursuitModule | undefined;
      const lazyPursuit = new Proxy({} as PursuitApi, {
        get: (_t, k) => {
          const dir = pursuitMod?.director() as unknown as Record<string, unknown> | null | undefined;
          if (!dir) throw new NotYetAvailable(`pursuit.${String(k)}`, 'M03c (needs a world build)');
          const f = dir[k as string];
          return typeof f === 'function' ? (f as (...a: unknown[]) => unknown).bind(dir) : f;
        },
      });
      const contexts: InputContextId[] = [];
      let modeCamera: CameraDirective | null = null;
      const requested = new Set<string>();

      const playerPose = (): { x: number; y: number; z: number; yaw: number } | null => {
        const ids = s.ecs.query([LocalPlayer, Transform, Control]);
        const id = ids[0];
        if (id === undefined) return null;
        const tr = s.ecs.store(Transform);
        return { x: tr.px[id] as number, y: tr.py[id] as number, z: tr.pz[id] as number, yaw: 2 * datan2(tr.qy[id] as number, tr.qw[id] as number) };
      };

      const descriptors = new Map<string, GameModeDescriptor>();
      for (const d of builtinDescriptors({ story: () => live.story, sandbox: () => live.sandbox, playerPose })) descriptors.set(d.id, d);
      for (const d of opts.descriptors ?? []) descriptors.set(d.id, d);

      const h = (host = new ModeHost({
        descriptors: [...descriptors.values()],
        slices: () => live,
        ports: {
          tick,
          ecs: s.ecs as unknown as EcsApi,
          prefabs: (services.vehicleCtx?.prefabs as unknown as PrefabService | undefined) ?? null,
          physics,
          rng: services.rng,
          clock: services.clock,
          pursuit: lazyPursuit,
          interaction: (services.vehicleCtx?.interaction as unknown as InteractionApi | undefined) ?? null,
          camera: {
            direct: (d) => {
              modeCamera = d;
              services.camera.reason = 'mode';
            },
            release: () => {
              modeCamera = null;
              services.camera.reason = 'player';
            },
          },
          input: {
            frame: () => services.input ?? ZERO_FRAME(tick()),
            push: (c) => {
              contexts.push(c);
              bridge.patch('sys.inputContext', [...contexts]);
            },
            pop: (c) => {
              const i = contexts.lastIndexOf(c);
              if (i >= 0) contexts.splice(i, 1);
              bridge.patch('sys.inputContext', [...contexts]);
            },
          },
          unlocks: unl,
          economy: econ,
          events: bus,
          ui: bridge,
          assets: {
            request: (refs) => {
              for (const r of refs) requested.add(r);
            },
            ready: () => true,
          },
          telemetry: tel as never,
          world,
        },
        save,
        unlocks: unl,
        economy: econ,
        sessionProfile: () => ctx.cfg.profile,
        restart: (profile, then) => void services.events.push({ t: 'mode.restart', tick: tick(), s: `${profile}|${then}` }),
        game: () => {
          const st = pursuitMod?.director()?.state();
          return { heat: st?.level ?? 0, pursuit: st !== undefined && st.phase !== 'clear', mission: false };
        },
        tick,
        wallMs: opts.wallMs ?? (() => 0),
        seed: () => ctx.cfg.seed,
        qa: runtime.env.qa,
      }));
      void modeCamera;

      // The pursuit director's wallet and the transit fares go through EconomyApi (M03c, M03b2).
      pursuitMod?.bindWallet?.(economyWallet(econ));
      (services as { fareSink?: ForwardingFareSink | null }).fareSink?.bind(econ);

      dispatch = createCommandDispatcher({
        host: h,
        slices: () => live,
        ui: bridge,
        events: bus,
        tick,
        sandboxContext: () => {
          const e = h.stack.entries.find((x) => x.id === 'sandbox' && x.state === 'Running');
          return e ? e.ctx : null;
        },
        world: () => (services.world.api ?? standin),
        ride: () => services.ride,
        selectProfile: (id) => {
          void (opts.loadSlices?.(id) ?? Promise.reject(new Error('no profile store')))
            .then((next) => {
              Object.assign(live, next);
              publishSession();
            })
            .catch((e: unknown) => bridge.toast({ id: 'save.profile', kind: 'warning', text: 'save.profile.failed', params: { reason: e instanceof Error ? e.message : String(e) } }));
        },
        teleport: (x, y, z) => {
          const r = requestTeleport(s.ecs, services, s.ecs.byKey('player:0'), [x, y, z], tick());
          return r.ok;
        },
      });
      runtime.uiCommand = (cmd) => module.command(cmd);
      runtime.uiOutbox = (): UiOut | null => bridge.takeOutbox();
      reply = (name, data) => void runtime.transport.postEvent({ v: 1, t: 'qa', seq: 0, p: { name, data } });

      if (ctx.boot.config['unlockAll'] === true) h.setUnlockAll(true);
      // What the shell reads: the registered modes (tile data), the open profile and its settings (M04b1).
      const hidden = new Set(unl.defs().filter((u) => u.hidden === true).map((u) => u.id));
      bridge.patch(
        'sys.modes',
        h.list().map((m) => {
          const d = descriptors.get(m.id);
          return { id: m.id, titleKey: m.titleKey, order: m.order, art: m.art, status: m.status, standalone: m.standalone, unlock: d?.unlock ?? null, hidden: d?.unlock != null && hidden.has(d.unlock), xr: d?.requires.xr ?? 'none', network: d?.requires.network ?? 'none', simProfile: d?.requires.simProfile ?? 'any' };
        }) as unknown as JsonObject[],
      );
      const publishSession = (): void => {
        bridge.patch('sys.controls', live.settings.controls as unknown as JsonObject);
        bridge.patch('sys.settings', settingsView(live.settings));
        bridge.patch('sys.profile', live.profile ? { ...live.profile } : null);
        bridge.patch('sys.avatar', live.core.avatar);
        bridge.patch('sys.garage', live.core.garage as unknown as JsonObject[]);
        unl.publish();
        econ.publish();
        h.publish();
        bridge.flushTick();
      };
      publishSession();
    },

    installQa(h) {
      qaHandler = h;
    },

    onDebug(cmd: DebugCommand) {
      if (cmd.t !== 'debug.modes' || !qaHandler || !host || !economy || !unlocks || !reply) return;
      qaHandler({ host, economy, unlocks, ui, telemetry }, cmd, reply);
    },
  };
  return module;
}
