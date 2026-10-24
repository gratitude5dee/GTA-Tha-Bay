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
  type BotInput, type CameraDirective, type EcsApi, type GameModeDescriptor, type InputContextId, type InputFrame, type InteractionApi, type JsonObject,
  type GameModeSim, type PhysicsQueries, type PrefabService, type PursuitApi, type SaveReason, type SimEvent, type SlotId, type UiBridge, type UiCommand,
  type UnlockDef, type WorldApi,
} from '@dv/shared';
import { GROUP_BIT } from '../physics/groups.ts';
import { Control, LocalPlayer, Transform } from '../ecs/components.ts';
import type { SimModule, SimModuleContext } from '../runtime.ts';
import type { DebugCommand } from '../transport/envelope.ts';
import { requestTeleport } from '../control/ownership.ts';
import type { PursuitModule } from '../pursuit/module.ts';
import type { ModeSaveBinding, SaveWritePort } from '../save-port.ts';
import { SimUiBridge, type UiOut } from '../ui/bridge.ts';
import { SimSchedulerImpl } from '../script/scheduler.ts';
import { TimelineRecorderImpl } from '../script/timeline.ts';
import { ZoneServiceImpl } from '../script/zones.ts';
import { builtinDescriptors, builtinUnlockDefs, defaultSandbox, defaultStory } from './builtin/index.ts';
import { bindModeSave } from './capability-bind.ts';
import { createCommandDispatcher, settingsView } from './commands.ts';
import { ModeEventBus, ModeHost, type SessionSlices } from './host.ts';
import { EconomyImpl, economyWallet, type ForwardingFareSink } from './economy.ts';
import { NotYetAvailable } from './stubs.ts';
import { createWorldStandin } from './world-standin.ts';
import { CONVOY_PREFABS, STORY_PREFABS, type PrefabRegistry } from '../prefabs/registry.ts';
import { UnlockRegistryImpl } from './unlocks.ts';
import { defaultSettings } from './settings-defaults.ts';
import { CombatImpl } from '../combat/combat.ts';
import { createGarageService, garageAdd, garageRecolor, garageSlots, type GarageService } from '../garage/garage.ts';

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
  /**
   * Replaces the sim of the built-in `story` mode (M05a1): receives the free-roam sim the engine would have used and returns the
   * mode's sim, which keeps free roam when no mission is active. The story package supplies it; the engine never imports it.
   */
  wrapStory?(freeroam: GameModeSim, env: StoryWrapEnv): GameModeSim;
  /** Extra or replacement unlock rows, registered after the built-in ones (racing adds its starter loaner to `unlock.racing`; M07a1). */
  unlockDefs?: readonly UnlockDef[];
}

/** What the engine hands the story mode besides the free-roam sim: session facts the `ModeContext` does not carry. */
export interface StoryWrapEnv {
  /** Build with QA flags: the story mode honours its URL flags and the debug bridge only then. */
  qa: boolean;
  /** The boot payload's config object (QA mission flags and the mission IR the page fetched). */
  bootConfig(): Readonly<Record<string, unknown>>;
  /** Comfort settings the cinematic director obeys (M05a2): `accessibility.reducedMotion` of the open profile, and the XR camera mode. */
  comfort?(): { reducedMotion: boolean; xr: boolean };
  /** QA builds: installs (null removes) the sim worker's bot input source, for the story autoplayer on a live mission (M05a2). */
  setBot?(bot: BotInput | null): void;
}

export interface ModesModule extends SimModule {
  host(): ModeHost | null;
  /** The script services of the session (M05a1); null before `onInit`. */
  script(): ScriptServices | null;
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

/** The scheduler, zone service and timeline recorder the modes module builds (M05a1). */
export interface ScriptServices {
  scheduler: SimSchedulerImpl;
  zones: ZoneServiceImpl;
  timeline: TimelineRecorderImpl;
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

/**
 * The prefab service a mode sees (M05a1): the vehicle module's registry, plus the two prefabs the mission VM spawns (`ped.actor`,
 * `marker.beam`), which are loaded at the first spawn of either, and the scripted cars `convoy.*` (M05c2), loaded at the first spawn of one. Loading them at boot would intern their strings and change the
 * `Key` ids of every session, and with them the state hash of a session that never runs a mission.
 */
export function withStoryPrefabs(reg: PrefabRegistry | null): PrefabService | null {
  if (!reg) return null;
  const story = new Set(STORY_PREFABS.map((d) => d.id));
  const convoy = new Set(CONVOY_PREFABS.map((d) => d.id));
  return {
    spawn: (id, at, key, init) => {
      if (story.has(id) && !reg.has(id)) reg.load(STORY_PREFABS);
      if (convoy.has(id) && !reg.has(id)) reg.load(CONVOY_PREFABS);
      return reg.spawn(id, { pos: at.pos, yaw: at.yaw }, key, init);
    },
    despawn: (h) => reg.despawn(h),
  };
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
  let script: ScriptServices | null = null;
  let combat: CombatImpl | null = null;
  let garage: GarageService | null = null;
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
      // The script services (M05a1) run after the mode host's tick: zone watchers, then the threads, then the timeline samples.
      { id: 'engine.script.zones', owner: 'S01', stage: SimStage.Script, order: 5, run: ({ tick }) => script?.zones.update(tick) },
      { id: 'engine.script.threads', owner: 'S01', stage: SimStage.Script, order: 10, run: ({ tick }) => script?.scheduler.run(tick) },
      { id: 'engine.script.timeline', owner: 'S01', stage: SimStage.Script, order: 90, run: ({ tick }) => script?.timeline.update(tick) },
      // Open-world melee (M05c1): the player's Attack button, the moves in progress and the wake-ups, in the rules stage with damage and infractions.
      { id: 'engine.combat', owner: 'S01', stage: SimStage.Rules, order: 40, run: () => combat?.update() },
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
    script: () => script,
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
      if (opts.unlockDefs) unl.register([...opts.unlockDefs]);

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
      // A mode's camera directive (a cinematic shot of the story director) replaces the player's camera in the snapshot while it holds.
      services.side.set('cam', () => modeCamera);
      const requested = new Set<string>();

      const playerPose = (): { x: number; y: number; z: number; yaw: number } | null => {
        const ids = s.ecs.query([LocalPlayer, Transform, Control]);
        const id = ids[0];
        if (id === undefined) return null;
        const tr = s.ecs.store(Transform);
        return { x: tr.px[id] as number, y: tr.py[id] as number, z: tr.pz[id] as number, yaw: 2 * datan2(tr.qy[id] as number, tr.qw[id] as number) };
      };

      // The script services (M05a1): the thread scheduler registers its hashed resource at the first thread.
      const sched = new SimSchedulerImpl({
        rng: services.rng,
        events: bus,
        onError: (id, e) => {
          services.events.push({ t: 'script.error', tick: tick(), s: `${id}|${e instanceof Error ? e.message : String(e)}` });
          runtime.env.log?.('error', `script thread ${id}: ${e instanceof Error ? e.message : String(e)}`);
        },
        onFirstUse: () => {
          try {
            s.core.addResource(sched.resource());
          } catch {
            // already registered
          }
        },
      });
      const zoneSvc = new ZoneServiceImpl({
        ecs: s.ecs as unknown as EcsApi,
        tick,
        edgeProbe: (x, y, z, maxM) => {
          const api = services.world.api;
          if (!api) return null;
          const hit = api.graph.nearestEdge(x, z, y, maxM);
          if (!hit) return null;
          return { edge: hit.edge, twin: api.graph.edge(hit.edge)?.twin ?? -1, distM: hit.distM };
        },
      });
      const timelineSvc = new TimelineRecorderImpl({ ecs: s.ecs as unknown as EcsApi, tick });
      script = { scheduler: sched, zones: zoneSvc, timeline: timelineSvc };

      combat = new CombatImpl({
        ecs: s.ecs as unknown as EcsApi,
        tick,
        input: () => services.input ?? null,
        report: (kind, at) => {
          try {
            lazyPursuit.report(kind, at, 'ped', 1);
          } catch (e) {
            if (!(e instanceof NotYetAvailable)) throw e;
          }
        },
        emit: (t, tk, a, b, move, damage, ko) => void services.events.push({ t, tick: tk, a, b, n: damage, s: `${move}|${ko ? 1 : 0}` }),
      });
      garage = createGarageService({
        list: () => live.core.garage,
        ui: bridge,
        heat: () => pursuitMod?.director()?.state().level ?? 0,
        world: () => services.world.api ?? null,
        prefabs: () => withStoryPrefabs((services.vehicleCtx?.prefabs as unknown as PrefabRegistry | undefined) ?? null),
        player: () => {
          const pose = playerPose();
          if (!pose) return null;
          return { x: pose.x, y: pose.y, z: pose.z, camYaw: ((services.input?.camYaw ?? 0) * 2 * Math.PI) / 65536 };
        },
        onChange: () => h.saveCore(),
        vehicleHeat: (key) => {
          try {
            return lazyPursuit.vehicleHeat(key);
          } catch {
            return 0;
          }
        },
      });

      const descriptors = new Map<string, GameModeDescriptor>();
      const wrapStory = opts.wrapStory;
      const storyEnv: StoryWrapEnv = {
        qa: runtime.env.qa,
        bootConfig: () => ctx.boot.config,
        comfort: () => ({ reducedMotion: live.settings.accessibility.reducedMotion, xr: ctx.boot.config['xr'] === true }),
        setBot: (bot) => {
          if (runtime.env.qa) runtime.bot = bot;
        },
      };
      for (const d of builtinDescriptors({
        story: () => live.story,
        sandbox: () => live.sandbox,
        playerPose,
        ...(wrapStory ? { wrapStory: (free: GameModeSim) => wrapStory(free, storyEnv) } : {}),
      })) descriptors.set(d.id, d);
      for (const d of opts.descriptors ?? []) descriptors.set(d.id, d);

      const h = (host = new ModeHost({
        descriptors: [...descriptors.values()],
        slices: () => live,
        ports: {
          tick,
          ecs: s.ecs as unknown as EcsApi,
          prefabs: withStoryPrefabs((services.vehicleCtx?.prefabs as unknown as PrefabRegistry | undefined) ?? null),
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
          zones: zoneSvc,
          scheduler: sched,
          timeline: timelineSvc,
          combat,
          garage: {
            add: (instance) => garageAdd(live.core.garage, instance),
            count: () => live.core.garage.length,
            slots: () => garageSlots(live.story.property.safehouses),
            recolor: (key, hue) => garageRecolor(live.core.garage, key, hue),
          },
          wardrobe: {
            has: (id) => live.core.inventory.wardrobe.includes(id),
            add: (id) => {
              if (!live.core.inventory.wardrobe.includes(id)) live.core.inventory.wardrobe.push(id);
            },
          },
          // Script-driven vehicles (M05a1, `ctx.vehicleAi`): the input of an NPC car, which marks the vehicle `external`.
          vehicleAi: {
            drive: (veh, input) => {
              const vc = services.vehicleCtx;
              const id = s.ecs.resolve(veh);
              const rt = vc && id !== null ? vc.store.rt.get(id) : undefined;
              if (!rt) return false;
              const q = (v: number, lo: number, hi: number): number => Math.round(Math.max(lo, Math.min(hi, v)) * 127);
              rt.external = true;
              rt.input.throttle = q(input.throttle, 0, 1);
              rt.input.brake = q(input.brake, 0, 1);
              rt.input.steer = q(input.steer, -1, 1);
              rt.input.handbrake = input.handbrake;
              return true;
            },
          },
        },
        save,
        unlocks: unl,
        economy: econ,
        sessionProfile: () => ctx.cfg.profile,
        restart: (profile, then) => void services.events.push({ t: 'mode.restart', tick: tick(), s: `${profile}|${then}` }),
        game: () => {
          const st = pursuitMod?.director()?.state();
          return { heat: st?.level ?? 0, pursuit: st !== undefined && st.phase !== 'clear', mission: live.story.activeMission !== null };
        },
        tick,
        wallMs: opts.wallMs ?? (() => 0),
        seed: () => ctx.cfg.seed,
        qa: runtime.env.qa,
      }));

      // The pursuit director's wallet and the transit fares go through EconomyApi (M03c, M03b2).
      pursuitMod?.bindWallet?.(economyWallet(econ));
      (services as { fareSink?: ForwardingFareSink | null }).fareSink?.bind(econ);
      services.world.heat = () => pursuitMod?.director()?.state().level ?? 0;

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
        garage: () => garage,
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
        garage?.publish();
        unl.publish();
        econ.publish();
        h.publish();
        bridge.flushTick();
      };
      // QA `?mission=<id>` (M05a1): the story mode starts by itself and runs that mission.
      if (runtime.env.qa && typeof ctx.boot.config['mission'] === 'object' && ctx.boot.config['mission'] !== null) h.start('story');
      publishSession();
    },

    installQa(h) {
      qaHandler = h;
    },

    onDebug(cmd: DebugCommand) {
      if (cmd.t !== 'debug.modes' || !qaHandler || !host || !economy || !unlocks || !reply) return;
      qaHandler({ host, economy, unlocks, ui, telemetry }, cmd, reply);
      // A debug command runs between ticks and the runtime sends the UI outbox right after it: the patches it raised leave with its
      // toasts, as a `command` does above (BD-FIX-CI9-W01). Before, the unlock helper's `unlock` toast left at once and its `sys.unlocks`
      // patch only at the next tick's flush, so the page showed the toast while the unlock list was still the old one.
      ui?.flushTick();
    },
  };
  return module;
}
