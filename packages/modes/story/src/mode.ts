/**
 * The `story` mode (C06 `GameModeSim`, M05a1): the engine's free-roam sim of M04a2 plus one `MissionRuntime`. With no mission active
 * it is exactly free roam. A mission starts through `StoryController.begin` (load-time resolution behind the `starting` phase, the
 * saved-state reconcile, then `MissionRuntime.start`); in this milestone the only caller is the QA boot path (`?mission=<id>`,
 * whose IR the page puts in the boot payload). The mission store, the Jobs app and the markers that start a mission come with
 * M05c1. Sim code under the C02 lint.
 */
import type { GameModeSim, JsonValue, MissionIR, ModeContext, ModeExitReason, Placement, SimEvent, StorySlice, TeleportResult } from '@dv/shared';
import type { DirectorScript } from '@dv/shared/contracts/c09-cutscene';
import { WORLD_STANDIN_BAKE, type StoryWrapEnv } from '@dv/engine/sim';
import { resolveMission } from './compiler/resolve.ts';
import type { CompileError } from './compiler/types.ts';
import { readCheckpoint } from './vm/checkpoint.ts';
import { MissionRuntime } from './vm/runtime.ts';
import { Actors } from './vm/actors.ts';
import type { VehicleDriver } from './vm/tasks.ts';
import { DEFAULT_FLAGS, type RuntimeFlags, type StoryCommand } from './vm/types.ts';
import { missionDeps } from './vm/deps.ts';
import { MissionStore, type CatalogPayload, type JobRow } from './missions/store.ts';
import { StoryPlaces, type ShopPorts } from './missions/index.ts';
import { storyTeleportPolicy, type PolicyLike } from './fast-travel-policy.ts';
import { storyUnlockDefs } from './unlock-defs.ts';

/** What the page puts in `BootPayload.config.mission` for `?mission=<id>` (QA builds only). */
export interface QaMissionBoot {
  id: string;
  ir: MissionIR;
  stage?: number;
  seed?: number;
  hooks?: RuntimeFlags['hooks'];
  talk?: RuntimeFlags['talk'];
  beats?: RuntimeFlags['beats'];
  directors?: DirectorScript[];
  /** The CutsceneRefs the mission's cutscene beats name (M05b2): id and fallback DirectorScript id. */
  cutscenes?: { id: string; fallback: string }[];
  /** Text of the lines and keys, for how long a `say` holds. */
  lines?: Record<string, string>;
  /**
   * Wait for the page's `debug.release` before the mission starts (DL-715 as amended). A page with a streamed world sets it, and its mission
   * gate releases the mission once a real first gesture has run the media unlock and the world is revealed, the order a player's game
   * runs in (apps/web/src/qa/mission-gate.ts; past its deadline the gate reports why the mission did not start).
   */
  hold?: boolean;
}

export type BeginResult = { ok: true } | { ok: false; errors: CompileError[] };

export interface BeginOptions {
  stage?: number;
  /** Replaces the story seed in the mission seed (QA `?seed=`). */
  seed?: number;
  /** Continue from the saved checkpoint when it matches this version and world bake. Default: start fresh. */
  resume?: boolean;
  flags?: Partial<RuntimeFlags>;
  directors?: readonly DirectorScript[];
  cutscenes?: readonly { id: string; fallback: string }[];
  lines?: Readonly<Record<string, string>>;
}

type ShopGarage = NonNullable<ShopPorts['garage']>;
type ShopWardrobe = NonNullable<ShopPorts['wardrobe']>;
const DEBUG_EVERY = 6;
/** The triggers and the Jobs list are looked at every 15 ticks (4 Hz). */
const TRIGGER_EVERY = 15;
/** The most phone messages kept for the Messages app. */
const MAX_MESSAGES = 60;
/** A new game moves the player to the first auto mission's start only when it is farther than this from it. */
const AUTO_PLACE_MIN_M = 300;
/**
 * The move to the first auto mission's start (BD-FIX-SPAWN-01, DL-734) is a `TeleportApi.request('respawn', ...)`: pre-streamed, placed on
 * resident ground, faded. A transient answer (the destination is still streaming, the player is still settling from the boot spawn, or no
 * answer in time) is asked again, first `PLACE_RETRY_FIRST_TICKS` later, the gap doubling up to `PLACE_RETRY_MAX_TICKS` (60, 120, 240,
 * 480, 600, 600, ... ticks). The budget is checked when a retry is scheduled and again when it would be sent: no request goes out once
 * `PLACE_BUDGET_TICKS` (10,800 ticks, 3 min) have passed since the first one. The last request may be sent just inside the budget and is
 * then given its `PLACE_ANSWER_TICKS`, so in the worst case the wait ends 10,800 + 1,800 = 12,600 ticks (3.5 min) after the first request.
 * Only a hard refusal, or a transient answer once the budget is spent, leaves the mission unstarted. Every limit counts sim ticks (60 Hz),
 * never the wall clock (C02).
 */
export const PLACE_RETRY_FIRST_TICKS = 60;
export const PLACE_RETRY_MAX_TICKS = 600;
/** The teleport answers within its own limits (8 s of pre-stream, 15 s of move); past this (30 s) the request counts as a timeout. */
export const PLACE_ANSWER_TICKS = 1800;
/** No request is sent once the wait for the start has lasted this long (3 min); the request then in flight is the last one. */
export const PLACE_BUDGET_TICKS = 10800;
/** The loading hint (`mission.startLoading`) shows once the wait has lasted 5 s, then at most once every 20 s. */
const PLACE_HINT_AFTER_TICKS = 300;
const PLACE_HINT_EVERY_TICKS = 1200;
const TELEPORT_TRANSIENT = new Set(['world.teleport.notLoaded', 'world.teleport.busy']);

/** The gap before the next request of the move to a far start, after `tries` requests: 60, 120, 240, 480, then 600 ticks. */
export function placeRetryGap(tries: number): number {
  let gap = PLACE_RETRY_FIRST_TICKS;
  for (let i = 1; i < tries && gap < PLACE_RETRY_MAX_TICKS; i++) gap *= 2;
  return gap < PLACE_RETRY_MAX_TICKS ? gap : PLACE_RETRY_MAX_TICKS;
}
const sq = (n: number): number => n * n;

/** The local player's position on the ground plane, or null while it does not exist. */
function playerXZ(ctx: ModeContext): [number, number] | null {
  const p = new Actors(() => ctx, () => '').pos('player');
  return p ? [p[0], p[2]] : null;
}

function playerInVehicle(ctx: ModeContext): boolean {
  return new Actors(() => ctx, () => '').playerVehicle() !== null;
}
/** The QA boot path starts the mission on the first tick, before the gray-box colliders exist: it asks again every 6 ticks for this long. */
const PATIENCE_TICKS = 900;

/** The pieces the story mode holds, apart from the `GameModeSim` shell, so that tests and the QA boot can drive them. */
export class StoryController {
  rt: MissionRuntime | null = null;
  ctx: ModeContext | null = null;
  story: StorySlice | null = null;
  /** Missions that failed to resolve this session, with why. */
  readonly disabled = new Map<string, CompileError[]>();
  private debugMod: { publishMissionDebug(ctx: ModeContext, rt: MissionRuntime): void } | null = null;
  private debugLoading = false;
  private directors = new Map<string, DirectorScript>();
  private cutscenes = new Map<string, { fallback: string }>();
  /** The session's play counter of `cut.request` (u32); shared by the missions of this controller. */
  private playSerial = 0;
  private lines: Readonly<Record<string, string>> = {};
  private flags: RuntimeFlags = { ...DEFAULT_FLAGS };
  /** A mission waiting for the world under it to be resident (the QA boot path); see `PATIENCE_TICKS`. */
  private pending: { ir: MissionIR; o: BeginOptions; deadline: number; held: boolean } | null = null;
  /** QA: the page's `debug.release` came (it may come before the mode enters); a held boot mission then starts at once. */
  private released = false;
  /** The bundled missions of the page (`BootPayload.config.story`), null for a headless host and the QA scenes without them. */
  store: MissionStore | null = null;
  /** Missions a trigger tried to start this session and that did not resolve: not tried again (the Jobs app still can). */
  private triedTrigger = new Set<string>();
  private startMarks = new Map<string, { handle: number | null; blip: string }>();
  private startPos = new Map<string, [number, number] | null>();
  private jobsJson = '';
  /** Safehouses and shops (M05c1); ticks only with a catalog (the page), so a headless run is unchanged. */
  private readonly places = new StoryPlaces({
    ctx: () => this.ctx as ModeContext,
    story: () => this.story as StorySlice,
    ports: (c) => {
      const x = c as ModeContext & { garage?: ShopGarage; wardrobe?: ShopWardrobe };
      return { garage: x.garage ?? null, wardrobe: x.wardrobe ?? null, respray: (k: string) => c.pursuit.respray(k) };
    },
  });

  /** The saved `activeMission` was offered to `begin` once this session (M05c2: resume from the last checkpoint after a reload). */
  private triedResume = false;
  /** The phone messages of this session (`text` ops), oldest first; the Messages app reads `mode.story.messages`. */
  private messages: { from: string; name: string; text: string; at: number }[] = [];
  /** The teleport policy that was in place before the story rule (M05c2); put back on exit. */
  private teleportRestore: (() => void) | null = null;
  /**
   * A new game's move to the start of its first auto mission (BD-FIX-SPAWN-01): the mission starts only once the teleport has put the
   * player on resident ground there. `result` is filled by the teleport's promise; `started` is the tick of the first request, `asked` of
   * the current one, `retryAt` of the next one; `hintAt` is the tick of the last loading hint (-1: none yet).
   */
  private placing: {
    id: string;
    /** The start the player is moved to (the new game's start, `CatalogPayload.autoStart`). */
    at: { lat: number; lng: number; yawDeg: number };
    tries: number;
    started: number;
    asked: number;
    retryAt: number;
    hintAt: number;
    result: TeleportResult | null;
    serial: number;
    /** The reason of the last transient answer, for the toast when the budget runs out before the next request. */
    lastReason: string;
  } | null = null;
  private placeSerial = 0;
  /**
   * Missions whose far start could not be reached this session (DL-734): they stay `available`, and the Jobs app offers a Start action
   * (`JobRow.retry`) that runs the move again with a fresh budget.
   */
  private readonly startFailed = new Set<string>();

  constructor(private readonly env: StoryWrapEnv) {}

  /** A `text` op ran: keep the line and publish the threads (display name from the cast table, text from the line table). */
  private addMessage(from: string, line: string, tick: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.messages.push({ from, name: this.store?.names[from] ?? from, text: this.lines[line] ?? this.store?.lines[line] ?? line, at: tick });
    if (this.messages.length > MAX_MESSAGES) this.messages.splice(0, this.messages.length - MAX_MESSAGES);
    ctx.ui.patch('mode.story.messages', this.messages.map((m) => ({ ...m })) as unknown as JsonValue);
  }

  /** Story fast travel: installs the rule of `fast-travel-policy.ts` on the world's teleport service (a host without one is left alone). */
  private installFastTravel(ctx: ModeContext): void {
    this.teleportRestore?.();
    this.teleportRestore = null;
    const tp = (ctx.world as { teleport?: { policy?: PolicyLike } } | undefined)?.teleport;
    if (!tp || !tp.policy) return;
    const before = tp.policy;
    const defs = storyUnlockDefs();
    const mine = storyTeleportPolicy(before, {
      inMission: () => this.rt?.active === true,
      districtAt: (x, z) => ctx.world.query.districtAt(x, z),
      hasUnlock: (id) => ctx.unlocks.has(id as never),
      defs: () => defs,
    });
    tp.policy = mine;
    this.teleportRestore = () => {
      if (tp.policy === mine) tp.policy = before;
    };
  }

  attach(ctx: ModeContext, story: StorySlice): void {
    this.ctx = ctx;
    this.story = story;
    this.installFastTravel(ctx);
    this.messages = [];
    this.triedResume = false;
    this.rt?.dispose();
    this.rt = null;
    this.pending = null;
    this.placing = null;
    this.startFailed.clear();
    this.triedTrigger.clear();
    this.startMarks.clear();
    this.startPos.clear();
    this.jobsJson = '';
    this.places.reset();
    const cfg = this.env.bootConfig()['story'] as CatalogPayload | undefined;
    this.store = cfg && typeof cfg === 'object' && Array.isArray(cfg.missions) ? new MissionStore(cfg) : null;
    // The Jobs list is there from the tick the mode enters, not from the first trigger pass up to 30 ticks later: a pause in between
    // stops the ticks, and the phone's Jobs app then listed no mission for the whole pause (BD-FIX-CI9-W02).
    if (this.store) this.publishJobs(ctx, this.store, story, null);
  }

  /** `?mission=<id>` in a QA build: the page put the IR in the boot payload. */
  qaAutostart(): void {
    if (import.meta.env.VITE_DV_QA !== '1' || !this.env.qa || !this.ctx) return;
    const boot = this.env.bootConfig()['mission'] as QaMissionBoot | undefined;
    if (!boot || typeof boot !== 'object' || !boot.ir) return;
    this.pending = { ir: boot.ir, deadline: this.ctx.tick + PATIENCE_TICKS, held: boot.hold === true && !this.released, o: {
      ...(boot.stage !== undefined ? { stage: boot.stage } : {}),
      ...(boot.seed !== undefined ? { seed: boot.seed } : {}),
      flags: { ...(boot.hooks ? { hooks: boot.hooks } : {}), ...(boot.talk ? { talk: boot.talk } : {}), ...(boot.beats ? { beats: boot.beats } : {}) },
      ...(boot.directors ? { directors: boot.directors } : {}),
      ...(boot.cutscenes ? { cutscenes: boot.cutscenes } : {}),
      ...(boot.lines ? { lines: boot.lines } : {}),
    } };
  }

  /** Loads, resolves and starts a mission. A mission that does not resolve is disabled (`E_REF_*`, telemetry `unresolved`). */
  begin(ir: MissionIR, o: BeginOptions = {}): BeginResult {
    const ctx = this.ctx as ModeContext;
    const story = this.story as StorySlice;
    this.flags = { ...DEFAULT_FLAGS, ...(o.flags ?? {}) };
    this.directors = new Map((o.directors ?? []).map((d) => [d.id, d]));
    this.cutscenes = new Map((o.cutscenes ?? []).map((c) => [c.id, { fallback: c.fallback }]));
    this.lines = o.lines ?? {};

    // a saved mission of another version or world bake is dropped: the mission is `available` again, never a broken checkpoint
    const saved = story.activeMission;
    const cp = saved && saved.id === ir.id ? readCheckpoint(saved, ir.id, ir.version, ctx.world.resolver.bake) : null;
    if (saved && saved.id === ir.id && (!cp || o.resume !== true)) story.activeMission = null;
    if (story.missions[ir.id]?.state !== 'passed') story.missions[ir.id] = { state: 'available', ...(story.missions[ir.id]?.bestSec !== undefined ? { bestSec: story.missions[ir.id]?.bestSec as number } : {}) };

    const res = resolveMission(ir, ctx.world.resolver);
    if ('errors' in res) {
      this.disabled.set(ir.id, res.errors);
      ctx.telemetry.emit('mission.fail', { mid: ir.id, stage: 0, sec: 0, attempt: 1, reason: 'unresolved' });
      ctx.ui.toast({ id: `mission:${ir.id}:disabled`, kind: 'warning', text: 'mission.disabled', params: { code: res.errors[0]?.code ?? 'E_REF_ZONE', pointer: res.errors[0]?.pointer ?? '/' } });
      return { ok: false, errors: res.errors };
    }
    this.disabled.delete(ir.id);

    this.rt?.dispose();
    const rt = new MissionRuntime({
      story: () => story,
      flags: this.flags,
      directors: this.directors,
      cutscenes: this.cutscenes,
      playCounter: () => ++this.playSerial,
      lineText: (id) => this.lines[id] ?? id,
      onText: (from, line, tick) => this.addMessage(from, line, tick),
      timerScale: () => 1,
      comfort: () => this.env.comfort?.() ?? { reducedMotion: false, xr: false },
    });
    rt.bind(ctx);
    rt.setDriver(() => (ctx as ModeContext & { vehicleAi?: VehicleDriver | null }).vehicleAi ?? null);
    this.rt = rt;
    const storySeed = story.world.seed;
    const seed = missionDeps().missionSeed(o.seed ?? storySeed, ir.id, 1);
    rt.start(res, { attempt: 1, seed, ...(o.resume === true && cp ? { from: cp } : {}) });
    if (o.stage !== undefined && o.stage > 0) rt.jumpTo(o.stage);
    return { ok: true };
  }

  /** One sim tick of the story mode: `advance`, then the QA debug state. A headless host (the canonical runner, Node) calls `advance` alone. */
  tick(ctx: ModeContext): void {
    this.advance(ctx);
    this.qaTick(ctx);
  }

  /** The QA boot start (when the world under the mission is resident), then the runtime's tick. Touches no `import.meta.env`. */
  advance(ctx: ModeContext): void {
    this.ctx = ctx;
    const waiting = this.pending;
    if (waiting && !waiting.held && ctx.tick % 6 === 0) {
      // `starting`: resolve again until the world under the mission is there, then start it; at the deadline start it anyway, which reports why not
      if (!('errors' in resolveMission(waiting.ir, ctx.world.resolver)) || ctx.tick >= waiting.deadline) {
        this.pending = null;
        this.begin(waiting.ir, waiting.o);
      }
    }
    if (this.store) {
      this.triggers(ctx, this.store);
      if (this.story) this.places.tick(ctx);
    }
    const rt = this.rt;
    if (!rt) return;
    if (rt.active) rt.tick(ctx);
  }

  /** Starts a catalog mission by id (the Jobs app, a trigger). A mission already running is never replaced. */
  startById(id: string, ctx: ModeContext): BeginResult | null {
    const store = this.store;
    const entry = store?.get(id);
    if (!store || !entry || this.pending || this.rt?.active || this.placing) return null;
    this.clearStartMarks(ctx);
    return this.begin(entry.ir, { directors: entry.directors, cutscenes: entry.cutscenes, lines: store.lines });
  }

  /** The triggers and the Jobs list, a few times a second while no mission runs. */
  private triggers(ctx: ModeContext, store: MissionStore): void {
    const story = this.story;
    if (!story || ctx.tick % TRIGGER_EVERY !== 0) return;
    const busy = this.pending !== null || this.rt?.active === true || this.placing !== null;
    if (this.placing) this.stepPlacing(ctx);
    if (busy) {
      if (this.startMarks.size > 0) this.clearStartMarks(ctx);
    } else {
      this.checkTriggers(ctx, store, story);
    }
    if (ctx.tick % (TRIGGER_EVERY * 2) === 0) this.publishJobs(ctx, store, story, busy ? (this.rt?.missionId ?? null) : null);
  }

  /** `mode.story.jobs`, when the rows changed since the last patch. */
  private publishJobs(ctx: ModeContext, store: MissionStore, story: StorySlice, activeId: string | null): void {
    const rows: JobRow[] = store.rows(story, ctx, activeId, this.startFailed);
    const json = JSON.stringify(rows);
    if (json === this.jobsJson) return;
    this.jobsJson = json;
    ctx.ui.patch('mode.story.jobs', rows as unknown as JsonValue);
  }

  /**
   * A mission that was running when the game was saved (`StorySlice.activeMission`, written at a checkpoint) continues from that
   * checkpoint once the mode is back: before any trigger. A checkpoint of another version or world bake is dropped by `begin`, which
   * leaves the mission `available` again. Tried once per session.
   */
  private resumeSaved(ctx: ModeContext, store: MissionStore, story: StorySlice): boolean {
    const saved = story.activeMission;
    if (this.triedResume || !saved) return false;
    this.triedResume = true;
    const entry = store.get(saved.id);
    if (!entry) {
      story.activeMission = null;
      return false;
    }
    this.clearStartMarks(ctx);
    this.triedTrigger.add(saved.id);
    const res = this.begin(entry.ir, { directors: entry.directors, cutscenes: entry.cutscenes, lines: store.lines, resume: true });
    return res.ok;
  }

  private checkTriggers(ctx: ModeContext, store: MissionStore, story: StorySlice): void {
    if (!store.triggers) return;
    if (this.resumeSaved(ctx, store, story)) return;
    const due = store.autoDue(story, ctx);
    if (due && !this.triedTrigger.has(due.ir.id)) {
      // a new game starts at the Yard: move the player there first, and start the mission once it stands on the ground there
      if (store.autoStart && Object.keys(story.missions).length === 0 && this.farFrom(ctx, store.autoStart)) {
        this.beginPlacing(ctx, due.ir.id, store.autoStart);
        return;
      }
      this.triedTrigger.add(due.ir.id);
      const res = this.startById(due.ir.id, ctx);
      if (res && !res.ok) return;
      if (res) return;
    }
    const player = playerXZ(ctx);
    const cands = store.markerCandidates(story, ctx);
    const keep = new Set<string>();
    for (const e of cands) {
      const s = e.ir.start;
      if (s.k !== 'marker') continue;
      const at = this.startXZ(ctx, e.ir.id, s.at);
      if (!at) continue;
      keep.add(e.ir.id);
      this.showStartMark(ctx, e.ir.id, at, e.ir.title);
      if (!player || this.triedTrigger.has(e.ir.id)) continue;
      const dx = player[0] - at[0];
      const dz = player[1] - at[1];
      if (dx * dx + dz * dz > s.radiusM * s.radiusM) continue;
      if (s.onFoot === true && playerInVehicle(ctx)) continue;
      this.triedTrigger.add(e.ir.id);
      this.startById(e.ir.id, ctx);
      return;
    }
    for (const id of [...this.startMarks.keys()]) if (!keep.has(id)) this.removeStartMark(ctx, id);
  }

  private startXZ(ctx: ModeContext, id: string, at: Placement): [number, number] | null {
    const known = this.startPos.get(id);
    if (known !== undefined) return known;
    if (!Array.isArray(at.at)) return null;
    const e = ctx.world.resolver.toEnu({ lat: at.at[0], lng: at.at[1] });
    const p: [number, number] = [e[0], e[2]];
    this.startPos.set(id, p);
    return p;
  }

  private showStartMark(ctx: ModeContext, id: string, at: [number, number], titleKey: string): void {
    const gy = ctx.physics.groundY(at[0], at[1]);
    const have = this.startMarks.get(id);
    if (have && (have.handle !== null || gy === null)) return;
    let handle: number | null = null;
    if (gy !== null) {
      try {
        handle = ctx.prefabs.spawn('marker.beam', { pos: [at[0], gy, at[1]], yaw: 0 }, `story:start:${id}` as never) as unknown as number;
      } catch {
        handle = null;
      }
    }
    const blip = `story:start:${id}`;
    try {
      ctx.world.map.setBlip({ id: blip, kind: 'mission', shape: 'diamond', colorToken: 'mission', x: at[0], z: at[1], priority: 8, labelKey: titleKey });
    } catch {
      // a world without a map layer
    }
    this.startMarks.set(id, { handle, blip });
  }

  private removeStartMark(ctx: ModeContext, id: string): void {
    const m = this.startMarks.get(id);
    if (!m) return;
    try {
      if (m.handle !== null) ctx.prefabs.despawn(m.handle as never);
      ctx.world.map.removeBlip(m.blip);
    } catch {
      // already gone
    }
    this.startMarks.delete(id);
  }

  private clearStartMarks(ctx: ModeContext): void {
    for (const id of [...this.startMarks.keys()]) this.removeStartMark(ctx, id);
  }

  /** True when the player is farther than `AUTO_PLACE_MIN_M` from the new game's start (or does not exist yet). */
  private farFrom(ctx: ModeContext, at: { lat: number; lng: number }): boolean {
    const e = ctx.world.resolver.toEnu({ lat: at.lat, lng: at.lng });
    const p = playerXZ(ctx);
    return !p || sq(p[0] - e[0]) + sq(p[1] - e[2]) >= AUTO_PLACE_MIN_M * AUTO_PLACE_MIN_M;
  }

  /**
   * The far start a Start from the Jobs app moves the player to first (DL-734), or null when the mission starts where the player is: a
   * mission whose far start failed this session, while the player is farther than `AUTO_PLACE_MIN_M` from it. Other missions keep the
   * M05c1 Jobs start (with the triggers on, the auto trigger has made the first move before the phone can open; a QA scene with the
   * triggers off starts missions where the player stands, as the gray-box `@story` tests do).
   */
  private farStartFor(ctx: ModeContext, id: string): { lat: number; lng: number; yawDeg: number } | null {
    const at = this.store?.autoStart;
    if (!at || !this.startFailed.has(id) || !this.store?.get(id)) return null;
    return this.farFrom(ctx, at) ? at : null;
  }

  /** Starts a move to a far start with a fresh budget; the mission starts once the teleport has put the player there. */
  private beginPlacing(ctx: ModeContext, id: string, at: { lat: number; lng: number; yawDeg: number }): void {
    this.clearStartMarks(ctx);
    this.placing = { id, at, tries: 0, started: ctx.tick, asked: ctx.tick, retryAt: ctx.tick, hintAt: -1, result: null, serial: 0, lastReason: 'not-loaded' };
    this.stepPlacing(ctx);
  }

  /**
   * One step of a move to a far start (BD-FIX-SPAWN-01, DL-734). The player is never put down where the ground is not resident (the
   * void under the city): the world's teleport pre-streams the destination, places the player on its ground and only then answers. On
   * `ok` the mission starts. A transient answer (`notLoaded`, `busy`, or no answer within `PLACE_ANSWER_TICKS`) is asked again, spaced
   * out, while the wait is inside `PLACE_BUDGET_TICKS` (checked when the retry is scheduled and when it would be sent), and a non-blocking
   * hint says the area is still loading. A hard refusal (water, blocked, out of bounds, forbidden), a gray-box world (no baked world: its
   * stand-in refuses every teleport), or a transient answer once the budget is spent leaves the mission `available`: a toast says why,
   * telemetry records `mission.fail {reason: 'unresolved'}`, and the Jobs app offers a Start that tries again (03-story.md section 5).
   */
  private stepPlacing(ctx: ModeContext): void {
    const pl = this.placing;
    if (!pl) return;
    if (ctx.world.resolver.bake === WORLD_STANDIN_BAKE) return this.failPlacing(ctx, pl, 'no-world');
    const r = pl.result;
    if (r === null) {
      if (pl.serial !== 0 && ctx.tick - pl.asked < PLACE_ANSWER_TICKS) return this.hintPlacing(ctx, pl);
      if (pl.serial !== 0) pl.result = { ok: false, reason: 'not-loaded', messageKey: 'world.teleport.notLoaded' };
      else if (ctx.tick < pl.retryAt) return this.hintPlacing(ctx, pl);
      // the budget is looked at again when the retry would go out: no request is sent after it
      else if (pl.tries > 0 && ctx.tick - pl.started >= PLACE_BUDGET_TICKS) return this.failPlacing(ctx, pl, pl.lastReason);
      else return this.askPlace(ctx, pl);
    }
    const res = pl.result as TeleportResult;
    if (res.ok) {
      this.placing = null;
      this.dismissHint(ctx, pl);
      this.startFailed.delete(pl.id);
      this.triedTrigger.add(pl.id);
      this.startById(pl.id, ctx);
      return;
    }
    if (TELEPORT_TRANSIENT.has(res.messageKey) && ctx.tick - pl.started < PLACE_BUDGET_TICKS) {
      pl.lastReason = res.reason;
      pl.result = null;
      pl.serial = 0;
      pl.retryAt = ctx.tick + placeRetryGap(pl.tries);
      this.hintPlacing(ctx, pl);
      return;
    }
    this.failPlacing(ctx, pl, res.reason);
  }

  /** The non-blocking loading hint while the move waits for its start: after `PLACE_HINT_AFTER_TICKS`, once per `PLACE_HINT_EVERY_TICKS`. */
  private hintPlacing(ctx: ModeContext, pl: NonNullable<StoryController['placing']>): void {
    if (ctx.tick - pl.started < PLACE_HINT_AFTER_TICKS) return;
    if (pl.hintAt >= 0 && ctx.tick - pl.hintAt < PLACE_HINT_EVERY_TICKS) return;
    pl.hintAt = ctx.tick;
    ctx.ui.toast({ id: `mission:${pl.id}:loading`, kind: 'info', text: 'mission.startLoading' });
  }

  /**
   * Takes the loading hint off the screen once the wait is over (the mission starts, or its start is unreachable). `UiBridge` has no
   * dismiss call, so the story sends the hint's id again with an empty text, which the shell reads as a dismiss (BD-FIX-SPAWN-04).
   */
  private dismissHint(ctx: ModeContext, pl: NonNullable<StoryController['placing']>): void {
    if (pl.hintAt < 0) return;
    ctx.ui.toast({ id: `mission:${pl.id}:loading`, kind: 'info', text: '' });
  }

  /** The far start cannot be reached: the mission stays `available` and the Jobs app offers to try again. */
  private failPlacing(ctx: ModeContext, pl: NonNullable<StoryController['placing']>, reason: string): void {
    const id = pl.id;
    this.placing = null;
    this.dismissHint(ctx, pl);
    this.triedTrigger.add(id);
    this.startFailed.add(id);
    ctx.telemetry.emit('mission.fail', { mid: id, stage: 0, sec: 0, attempt: 1, reason: 'unresolved' });
    ctx.ui.toast({ id: `mission:${id}:start`, kind: 'warning', text: 'mission.startUnreachable', params: { reason } });
    // the Jobs row offers its Start action at once, not at the next list pass
    if (this.store && this.story) this.publishJobs(ctx, this.store, this.story, null);
  }

  private askPlace(ctx: ModeContext, pl: NonNullable<StoryController['placing']>): void {
    const at = pl.at;
    const e = ctx.world.resolver.toEnu({ lat: at.lat, lng: at.lng });
    const serial = ++this.placeSerial;
    pl.serial = serial;
    pl.tries++;
    pl.asked = ctx.tick;
    let req: Promise<TeleportResult>;
    try {
      req = ctx.world.teleport.request('respawn', { x: e[0], z: e[2], yaw: (at.yawDeg * Math.PI) / 180 });
    } catch {
      req = Promise.resolve({ ok: false, reason: 'not-loaded', messageKey: 'world.teleport.notLoaded' });
    }
    void req.then(
      (r) => {
        if (this.placing === pl && pl.serial === serial) pl.result = r;
      },
      () => {
        if (this.placing === pl && pl.serial === serial) pl.result = { ok: false, reason: 'not-loaded', messageKey: 'world.teleport.notLoaded' };
      },
    );
  }

  /** QA builds only: the debug state for the overlay and the bridge; the literal test lets a production build drop the import. */
  qaTick(ctx: ModeContext): void {
    const rt = this.rt;
    if (!rt) return;
    if (import.meta.env.VITE_DV_QA === '1' && this.env.qa) {
      if (!this.debugMod && !this.debugLoading) {
        this.debugLoading = true;
        void import('./debug/bridge.ts').then((m) => {
          this.debugMod = m;
        });
      } else if (this.debugMod && ctx.tick % DEBUG_EVERY === 0) {
        this.debugMod.publishMissionDebug(ctx, rt);
      }
    }
  }

  suspendedTick(ctx: ModeContext): void {
    this.rt?.suspendedTick(ctx);
  }

  /** Commands that arrive as `UiCommand mode.cmd {mode: 'story'}`. */
  onEvent(_ctx: ModeContext, e: SimEvent): void {
    if (e.t !== 'mode.cmd' || e.s === undefined) return;
    let msg: { mode?: string; name?: string; args?: Record<string, unknown> | null };
    try {
      msg = JSON.parse(e.s) as typeof msg;
    } catch {
      return;
    }
    if (msg.mode !== 'story' || typeof msg.name !== 'string') return;
    const a = msg.args ?? {};
    if (msg.name === 'mission.start') {
      if (typeof a['id'] === 'string') {
        const id = a['id'];
        // DL-734: a far start (one that failed this session, or a new game's first mission) is first a move, with a fresh budget
        const far = this.farStartFor(_ctx, id);
        if (far && !this.pending && !this.rt?.active && !this.placing) {
          this.beginPlacing(_ctx, id, far);
          return;
        }
        const res = this.startById(id, _ctx);
        if (res === null) _ctx.ui.toast({ id: `mission:start:${id}`, kind: 'warning', text: 'jobs.busy' });
      }
      return;
    }
    if (msg.name === 'debug.release') {
      if (import.meta.env.VITE_DV_QA === '1' && this.env.qa) this.release(_ctx);
      return;
    }
    if (this.store && this.places.command(_ctx, msg.name, a)) return;
    if (!this.rt) return;
    switch (msg.name) {
      case 'talk.result':
        if (typeof a['talkId'] === 'string' && typeof a['outcome'] === 'string') {
          const path = a['path'] === 'llm' || a['path'] === 'ink' ? a['path'] : 'scripted';
          this.rt.command({ name: 'talk.result', talkId: a['talkId'], outcome: a['outcome'], turns: typeof a['turns'] === 'number' ? a['turns'] : 0, path });
        }
        return;
      case 'mission.retry':
      case 'mission.quit':
        this.rt.command({ name: msg.name } as StoryCommand);
        return;
      default:
        if (import.meta.env.VITE_DV_QA === '1' && this.env.qa && msg.name.startsWith('debug.')) this.debugCommand(msg.name, a);
    }
  }

  /** QA `debug.release`: a boot mission held for the page (`QaMissionBoot.hold`) starts now; its patience counts from here. */
  release(ctx: ModeContext): void {
    this.released = true;
    const waiting = this.pending;
    if (waiting?.held) {
      waiting.held = false;
      waiting.deadline = ctx.tick + PATIENCE_TICKS;
    }
  }

  private debugCommand(name: string, a: Record<string, unknown>): void {
    const rt = this.rt as MissionRuntime;
    switch (name) {
      case 'debug.jump':
        if (typeof a['stage'] === 'number') rt.command({ name: 'debug.jump', stage: a['stage'] });
        return;
      case 'debug.pass':
        rt.command({ name: 'debug.pass' });
        return;
      case 'debug.fail':
        rt.command({ name: 'debug.fail' });
        return;
      case 'debug.flag':
        if (typeof a['key'] === 'string' && (typeof a['value'] === 'boolean' || typeof a['value'] === 'number' || typeof a['value'] === 'string')) {
          rt.command({ name: 'debug.flag', key: a['key'], value: a['value'] });
        }
        return;
      case 'debug.autoplay':
        void this.liveAutoplay(a['on'] !== false);
        return;
      case 'debug.predicate':
        if (typeof a['path'] === 'string' && this.ctx) {
          const value = rt.predicateAt(a['path']);
          this.ctx.ui.patch('mode.story.predicate', { path: a['path'], value, tick: this.ctx.tick });
        }
        return;
      default:
        return;
    }
  }

  /** QA: the story autoplayer plays the running mission live (`__dvBridge.mission.autoplay`). Not an oracle: the live profile is `local`. */
  private async liveAutoplay(on: boolean): Promise<void> {
    // the literal test lets a production build drop the import (a class method is not tree-shaken, so the guard sits here)
    if (import.meta.env.VITE_DV_QA !== '1' || !this.env.qa) return;
    const live = await import('./autoplay/live.ts');
    const host = { ctx: () => this.ctx, rt: () => this.rt, setBot: (b: Parameters<NonNullable<StoryWrapEnv['setBot']>>[0]) => this.env.setBot?.(b) };
    if (on) live.startLiveAutoplay(host);
    else live.stopLiveAutoplay(host);
  }

  exit(ctx: ModeContext, reason: ModeExitReason): void {
    this.pending = null;
    this.placing = null;
    this.teleportRestore?.();
    this.teleportRestore = null;
    const rt = this.rt;
    if (!rt) return;
    rt.bind(ctx);
    if (rt.active) rt.abort(reason === 'kill' ? 'kill' : reason === 'quit' ? 'quit' : 'modeExit');
    rt.dispose();
    this.rt = null;
  }
}

/**
 * The story mode's sim and its controller; a headless host (`headless: true`, Node: no `import.meta.env`, no QA boot or debug state)
 * keeps the controller to start a mission and to observe the runtime.
 */
export function createStoryMode(freeroam: GameModeSim, env: StoryWrapEnv, o: { headless?: boolean } = {}): { sim: GameModeSim; controller: StoryController } {
  const c = new StoryController(env);
  const sim: GameModeSim = {
    enter(ctx, args, slice) {
      freeroam.enter(ctx, args, slice);
      c.attach(ctx, slice as unknown as StorySlice);
      if (o.headless !== true) c.qaAutostart();
    },
    tick(ctx) {
      freeroam.tick(ctx);
      if (o.headless === true) c.advance(ctx);
      else c.tick(ctx);
    },
    suspendedTick(ctx) {
      c.suspendedTick(ctx);
    },
    exit(ctx, reason) {
      c.exit(ctx, reason);
      return freeroam.exit(ctx, reason);
    },
    saveSlice: (ctx) => freeroam.saveSlice(ctx),
    onEvent(ctx, e) {
      c.onEvent(ctx, e);
    },
  };
  return { sim, controller: c };
}

/** The engine's `ModesModuleOptions.wrapStory`: free roam plus the mission runtime. */
export function wrapStory(freeroam: GameModeSim, env: StoryWrapEnv): GameModeSim {
  return createStoryMode(freeroam, env).sim;
}
