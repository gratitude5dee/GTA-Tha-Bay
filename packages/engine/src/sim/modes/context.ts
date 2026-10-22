import {
  SIM_DT,
  type AssetRef, type CameraDirective, type CombatApi, type EcsApi, type EntityHandle, type EconomyApi, type GameModeId, type InputContextId, type InputFrame,
  type InteractionApi, type ModeContext, type ModeEnterArgs, type ModeOrigin, type PhysicsQueries, type PrefabService, type PursuitApi,
  type Rng, type RngStreams, type SaveReason, type SimEventBus, type SimScheduler, type TelemetryName, type TimelineRecorder, type UiBridge,
  type UnlockApi, type VehicleInstance, type WorldApi, type WorldClockApi, type ZoneService,
} from '@dv/shared';
import { NotYetAvailable, combatStub, npcStub, schedulerStub, timelineStub, zonesStub } from './stubs.ts';

/** The engine services a `ModeContext` is assembled from (C06). A service that is not there yet is `null` and becomes a `NotYetAvailable` stub. */
export interface ContextPorts {
  tick(): number;
  ecs: EcsApi;
  prefabs: PrefabService | null;
  physics: PhysicsQueries;
  rng: RngStreams;
  clock: WorldClockApi | null;
  pursuit: PursuitApi | null;
  interaction: InteractionApi | null;
  camera: { direct(d: CameraDirective): void; release(): void };
  input: { frame(player?: number): InputFrame; push(c: InputContextId): void; pop(c: InputContextId): void };
  unlocks: UnlockApi;
  economy: EconomyApi;
  events: SimEventBus;
  ui: UiBridge;
  assets: { request(refs: AssetRef[], prio: 'now' | 'soon'): void; ready(refs: AssetRef[]): boolean };
  /** Asks the autosave policy for a save with `reason` (C05 rule 4 decides whether it happens). */
  saveRequest(reason: SaveReason): void;
  telemetry: { emit(name: TelemetryName, props: Record<string, string | number | boolean>): void };
  world: WorldApi;
  startChild(parent: GameModeId, id: GameModeId, args: Omit<ModeEnterArgs, 'origin'>): boolean;
  /** The script services (M05a1). A build without them keeps the `NotYetAvailable` stubs. */
  zones?: ZoneService | null;
  scheduler?: SimScheduler | null;
  timeline?: TimelineRecorder | null;
  /** The open-world melee (M05c1). A build without it keeps the `NotYetAvailable` stub. */
  combat?: CombatApi | null;
  /** Sets the input of a script-driven vehicle (NPC cars of a mission). Reaches the mode as `ctx.vehicleAi`, which is not part of C06 (BD-M05a1-04). */
  vehicleAi?: VehicleAiPort | null;
  /** The garage (M05c1): a story reward car lands through it. Reaches the mode as `ctx.garage`, which is not part of C06 (BD-M05c1). */
  garage?: GaragePort | null;
}

export interface GaragePort {
  /** Adds an instance, idempotent by `id`; never refused for lack of room. False when the id was already there. */
  add(instance: VehicleInstance): boolean;
  /** Cars in the garage and the slots the owned safehouses offer. */
  count(): number;
  slots(): number;
}

export interface VehicleAiPort {
  drive(h: EntityHandle, input: { throttle: number; brake: number; steer: number; handbrake: boolean }): boolean;
}

function missing<T extends object>(service: string, milestone: string, methods: readonly string[]): T {
  const o: Record<string, unknown> = {};
  for (const m of methods) {
    o[m] = (): never => {
      throw new NotYetAvailable(`${service}.${m}`, milestone);
    };
  }
  return o as T;
}

/**
 * The only capability surface of a mode (C06 rule 7). One context per stack entry, so `rng` is prefixed with that mode's id and
 * `startChild` knows its parent. `tick` reads the sim tick live. Members whose services have not landed throw `NotYetAvailable`
 * when called, naming the milestone: zones, scheduler and timeline M05a1 (real services since M05a1; the stubs remain for a context built without them), combat (real since M05c1), npc M06a3; and, on a build that has
 * none, the clock (M02b2), the pursuit director (M03c) and the interaction service (M03a1). `net` is null (single player).
 */
export function createModeContext(p: ContextPorts, id: GameModeId, origin: ModeOrigin): ModeContext {
  const clock = p.clock ?? missing<WorldClockApi>('clock', 'M02b2', ['now', 'env', 'setHour', 'pause', 'lock', 'unlock', 'forceWeather']);
  const pursuit = p.pursuit ?? missing<PursuitApi>('pursuit', 'M03c', ['state', 'report', 'setHeat', 'capHeat', 'clear', 'setProfile', 'setRouteHint', 'vehicleHeat', 'respray', 'spawnNamedUnit']);
  const interaction = p.interaction ?? missing<InteractionApi>('interaction', 'M03a1', ['register', 'current', 'setEnabled']);
  const prefabs = p.prefabs ?? missing<PrefabService>('prefabs', 'M03a1', ['spawn', 'despawn']);
  const zones = p.zones ?? zonesStub();
  const scheduler = p.scheduler ?? schedulerStub();
  const timeline = p.timeline ?? timelineStub();
  const combat = p.combat ?? combatStub();
  const npc = npcStub();
  const ctx: ModeContext = {
    get tick() {
      return p.tick();
    },
    dt: SIM_DT,
    origin,
    ecs: p.ecs,
    prefabs,
    physics: p.physics,
    rng: (stream: string): Rng => p.rng.get(`mode:${id}:${stream}`),
    clock,
    pursuit,
    interaction,
    zones,
    scheduler,
    timeline,
    camera: p.camera,
    input: p.input,
    unlocks: p.unlocks,
    economy: p.economy,
    combat,
    events: p.events,
    ui: p.ui,
    assets: p.assets,
    save: { request: (reason) => p.saveRequest(reason) },
    telemetry: p.telemetry,
    net: null,
    world: p.world,
    npc,
    startChild: (child, args) => p.startChild(id, child, args),
  };
  if (p.vehicleAi) (ctx as ModeContext & { vehicleAi: VehicleAiPort }).vehicleAi = p.vehicleAi;
  if (p.garage) (ctx as ModeContext & { garage: GaragePort }).garage = p.garage;
  return ctx;
}
