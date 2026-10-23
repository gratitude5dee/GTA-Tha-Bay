/**
 * The `story` mode (C06 `GameModeSim`, M05a1): the engine's free-roam sim of M04a2 plus one `MissionRuntime`. With no mission active
 * it is exactly free roam. A mission starts through `StoryController.begin` (load-time resolution behind the `starting` phase, the
 * saved-state reconcile, then `MissionRuntime.start`); in this milestone the only caller is the QA boot path (`?mission=<id>`,
 * whose IR the page puts in the boot payload). The mission store, the Jobs app and the markers that start a mission come with
 * M05c1. Sim code under the C02 lint.
 */
import type { GameModeSim, JsonValue, MissionIR, ModeContext, ModeExitReason, Placement, SimEvent, StorySlice } from '@dv/shared';
import type { DirectorScript } from '@dv/shared/contracts/c09-cutscene';
import type { StoryWrapEnv } from '@dv/engine/sim';
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
/** A new game moves the player to the first auto mission's start only when it is farther than this from it. */
const AUTO_PLACE_MIN_M = 300;
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

  constructor(private readonly env: StoryWrapEnv) {}

  attach(ctx: ModeContext, story: StorySlice): void {
    this.ctx = ctx;
    this.story = story;
    this.rt?.dispose();
    this.rt = null;
    this.pending = null;
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
    if (!store || !entry || this.pending || this.rt?.active) return null;
    this.clearStartMarks(ctx);
    return this.begin(entry.ir, { directors: entry.directors, cutscenes: entry.cutscenes, lines: store.lines });
  }

  /** The triggers and the Jobs list, a few times a second while no mission runs. */
  private triggers(ctx: ModeContext, store: MissionStore): void {
    const story = this.story;
    if (!story || ctx.tick % TRIGGER_EVERY !== 0) return;
    const busy = this.pending !== null || this.rt?.active === true;
    if (busy) {
      if (this.startMarks.size > 0) this.clearStartMarks(ctx);
    } else {
      this.checkTriggers(ctx, store, story);
    }
    if (ctx.tick % (TRIGGER_EVERY * 2) === 0) this.publishJobs(ctx, store, story, busy ? (this.rt?.missionId ?? null) : null);
  }

  /** `mode.story.jobs`, when the rows changed since the last patch. */
  private publishJobs(ctx: ModeContext, store: MissionStore, story: StorySlice, activeId: string | null): void {
    const rows: JobRow[] = store.rows(story, ctx, activeId);
    const json = JSON.stringify(rows);
    if (json === this.jobsJson) return;
    this.jobsJson = json;
    ctx.ui.patch('mode.story.jobs', rows as unknown as JsonValue);
  }

  private checkTriggers(ctx: ModeContext, store: MissionStore, story: StorySlice): void {
    if (!store.triggers) return;
    const due = store.autoDue(story, ctx);
    if (due && !this.triedTrigger.has(due.ir.id)) {
      this.triedTrigger.add(due.ir.id);
      if (store.autoStart && Object.keys(story.missions).length === 0) this.placePlayer(ctx, store.autoStart);
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

  /** A new game begins at the Yard: the player is moved there when the first auto mission starts and the story is fresh. */
  private placePlayer(ctx: ModeContext, at: { lat: number; lng: number; yawDeg: number }): void {
    const e = ctx.world.resolver.toEnu({ lat: at.lat, lng: at.lng });
    const p = playerXZ(ctx);
    if (p && sq(p[0] - e[0]) + sq(p[1] - e[2]) < AUTO_PLACE_MIN_M * AUTO_PLACE_MIN_M) return;
    const h = ctx.ecs.byKey('player:0');
    if (h === 0) return;
    const gy = ctx.physics.groundY(e[0], e[2]);
    new Actors(() => ctx, () => '').place(h, [e[0], gy ?? e[1], e[2]], (at.yawDeg * Math.PI) / 180);
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
        const res = this.startById(a['id'], _ctx);
        if (res === null) _ctx.ui.toast({ id: `mission:start:${a['id']}`, kind: 'warning', text: 'jobs.busy' });
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
