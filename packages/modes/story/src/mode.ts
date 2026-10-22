/**
 * The `story` mode (C06 `GameModeSim`, M05a1): the engine's free-roam sim of M04a2 plus one `MissionRuntime`. With no mission active
 * it is exactly free roam. A mission starts through `StoryController.begin` (load-time resolution behind the `starting` phase, the
 * saved-state reconcile, then `MissionRuntime.start`); in this milestone the only caller is the QA boot path (`?mission=<id>`,
 * whose IR the page puts in the boot payload). The mission store, the Jobs app and the markers that start a mission come with
 * M05c1. Sim code under the C02 lint.
 */
import type { GameModeSim, MissionIR, ModeContext, ModeExitReason, SimEvent, StorySlice } from '@dv/shared';
import type { DirectorScript } from '@dv/shared/contracts/c09-cutscene';
import type { StoryWrapEnv } from '@dv/engine/sim';
import { resolveMission } from './compiler/resolve.ts';
import type { CompileError } from './compiler/types.ts';
import { readCheckpoint } from './vm/checkpoint.ts';
import { MissionRuntime } from './vm/runtime.ts';
import type { VehicleDriver } from './vm/tasks.ts';
import { DEFAULT_FLAGS, type RuntimeFlags, type StoryCommand } from './vm/types.ts';
import { missionDeps } from './vm/deps.ts';

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

const DEBUG_EVERY = 6;
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
  private pending: { ir: MissionIR; o: BeginOptions; deadline: number } | null = null;

  constructor(private readonly env: StoryWrapEnv) {}

  attach(ctx: ModeContext, story: StorySlice): void {
    this.ctx = ctx;
    this.story = story;
    this.rt?.dispose();
    this.rt = null;
    this.pending = null;
  }

  /** `?mission=<id>` in a QA build: the page put the IR in the boot payload. */
  qaAutostart(): void {
    if (import.meta.env.VITE_DV_QA !== '1' || !this.env.qa || !this.ctx) return;
    const boot = this.env.bootConfig()['mission'] as QaMissionBoot | undefined;
    if (!boot || typeof boot !== 'object' || !boot.ir) return;
    this.pending = { ir: boot.ir, deadline: this.ctx.tick + PATIENCE_TICKS, o: {
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
    if (waiting && ctx.tick % 6 === 0) {
      // `starting`: resolve again until the world under the mission is there, then start it; at the deadline start it anyway, which reports why not
      if (!('errors' in resolveMission(waiting.ir, ctx.world.resolver)) || ctx.tick >= waiting.deadline) {
        this.pending = null;
        this.begin(waiting.ir, waiting.o);
      }
    }
    const rt = this.rt;
    if (!rt) return;
    if (rt.active) rt.tick(ctx);
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
    if (e.t !== 'mode.cmd' || e.s === undefined || !this.rt) return;
    let msg: { mode?: string; name?: string; args?: Record<string, unknown> | null };
    try {
      msg = JSON.parse(e.s) as typeof msg;
    } catch {
      return;
    }
    if (msg.mode !== 'story' || typeof msg.name !== 'string') return;
    const a = msg.args ?? {};
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
