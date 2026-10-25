/**
 * The mission store (M05c1): the compiled missions the page bundled, in one place. It answers three questions the story mode asks every
 * few ticks while no mission runs: which missions are open (`requires` hold), which of them a trigger starts now (a `marker` the player
 * stands in, an `auto` whose condition holds), and what the phone's Jobs app lists. A `phone` trigger starts from the Jobs app
 * (`mission.start`); the Contacts and Messages apps of M06 call the same command. Sim code under the C02 lint.
 */
import type { MissionIR, ModeContext, Pred, StorySlice } from '@dv/shared';
import type { DirectorScript } from '@dv/shared/contracts/c09-cutscene';
import { evalPred, hourIn, type PredEnv } from '../vm/predicates.ts';
import { byStr } from '../vm/util.ts';

/** What the page puts in `BootPayload.config.story` (the mission files it bundled; `pnpm missions:build` made them). */
export interface CatalogPayload {
  missions: MissionIR[];
  directors: DirectorScript[];
  cutscenes: { id: string; fallback: string }[];
  /** Line and key texts, English; shared by all missions. */
  lines: Record<string, string>;
  /** Display names of the cast by soul id (`content/story/cast.json`), for phone senders (M05c2). */
  names?: Record<string, string>;
  /** A new game starts the first auto mission here (WGS84 and degrees, as the autoplayer's mission-starts file), when the player is far from it. */
  autoStart?: { lat: number; lng: number; yawDeg: number } | null;
  /** The auto and marker triggers are live. Off, only the Jobs app starts a mission (QA scenes that are not about the story). */
  triggers?: boolean;
}

export interface CatalogEntry {
  ir: MissionIR;
  directors: DirectorScript[];
  cutscenes: { id: string; fallback: string }[];
}

export type JobState = 'locked' | 'available' | 'active' | 'passed';

/** One row of the Jobs app (`mode.story.jobs`). */
export interface JobRow {
  id: string;
  /** The mission title, localized text. */
  title: string;
  state: JobState;
  trigger: 'marker' | 'phone' | 'auto' | 'mode';
  /** The contact who gives the job (a soul id), when there is one. */
  giver?: string;
  /** The contact's display name (cast table), when known. */
  giverName?: string;
  /** Why a locked job is locked: the title of the mission to finish first. */
  needs?: string;
  medals?: number;
  bestSec?: number;
  /**
   * DL-734: the mission's far start could not be reached this session (the teleport refused it or the time ran out). The mission stays
   * `available`, and the Jobs app shows a Start action that runs the move to the start again.
   */
  retry?: true;
}

/** The part of `PredEnv` a start condition may read: the story slice, the clock, the wallet, the unlocks. The rest is false. */
function startEnv(story: StorySlice, ctx: ModeContext): PredEnv {
  return {
    inZone: () => false,
    inVehicle: () => false,
    distance: () => Number.POSITIVE_INFINITY,
    health: () => null,
    ko: () => false,
    destroyed: () => false,
    busted: () => false,
    heat: () => ({ level: 0, phase: 'clear' }),
    speed: () => 0,
    hour: () => ctx.clock.env().hour,
    weather: () => ctx.clock.env().weather,
    flag: (k) => story.flags[k],
    trust: (n) => story.npcRelations[n]?.trust ?? 0,
    itemCount: () => 0,
    cashCents: () => ctx.economy.balance(),
    objective: () => 'pending',
    stageSeconds: () => 0,
    eventSeen: () => false,
    modeResult: () => undefined,
    passed: (m) => story.missions[m]?.state === 'passed',
    act: () => story.act,
    unlocked: (id) => ctx.unlocks.has(id),
  };
}

export class MissionStore {
  readonly entries: CatalogEntry[];
  readonly lines: Readonly<Record<string, string>>;
  readonly names: Readonly<Record<string, string>>;
  readonly autoStart: CatalogPayload['autoStart'];
  readonly triggers: boolean;

  constructor(p: CatalogPayload) {
    this.lines = p.lines;
    this.names = p.names ?? {};
    this.autoStart = p.autoStart ?? null;
    this.triggers = p.triggers !== false;
    this.entries = [...p.missions]
      .sort((a, b) => byStr(a.id, b.id))
      .map((ir) => ({
        ir,
        directors: p.directors.filter((d) => d.id.startsWith(`${ir.id}.`)),
        cutscenes: p.cutscenes.filter((c) => c.fallback.startsWith(`${ir.id}.`)),
      }));
  }

  get(id: string): CatalogEntry | undefined {
    return this.entries.find((e) => e.ir.id === id);
  }

  titleOf(ir: MissionIR): string {
    return this.lines[ir.title] ?? ir.title;
  }

  /** Whether every `requires` predicate of the mission holds. */
  open(ir: MissionIR, story: StorySlice, ctx: ModeContext): boolean {
    const env = startEnv(story, ctx);
    const cost = { n: 0 };
    return ir.requires.every((p) => evalPred(p, env, cost));
  }

  /** The first mission an unmet `passed` requirement names, for the Jobs hint. */
  private blockedBy(ir: MissionIR, story: StorySlice): string | undefined {
    for (const p of ir.requires) {
      const m = firstPassed(p);
      if (m && story.missions[m]?.state !== 'passed') return m;
    }
    return undefined;
  }

  rows(story: StorySlice, ctx: ModeContext, activeId: string | null, startFailed: ReadonlySet<string> = new Set()): JobRow[] {
    return this.entries.map(({ ir }) => {
      const rec = story.missions[ir.id];
      const state: JobState = ir.id === activeId ? 'active' : rec?.state === 'passed' ? 'passed' : this.open(ir, story, ctx) ? 'available' : 'locked';
      const row: JobRow = { id: ir.id, title: this.titleOf(ir), state, trigger: ir.start.k };
      if (ir.giver && 'phone' in ir.giver) {
        row.giver = ir.giver.phone;
        const gn = this.names[ir.giver.phone];
        if (gn) row.giverName = gn;
      }
      if (state === 'locked') {
        const by = this.blockedBy(ir, story);
        const needs = by ? this.get(by) : undefined;
        if (needs) row.needs = this.titleOf(needs.ir);
      }
      if (rec?.medals !== undefined) row.medals = rec.medals;
      if (rec?.bestSec !== undefined) row.bestSec = rec.bestSec;
      if (state === 'available' && startFailed.has(ir.id)) row.retry = true;
      return row;
    });
  }

  /** The `auto` mission that starts now: the first open one, not passed, whose condition holds. */
  autoDue(story: StorySlice, ctx: ModeContext): CatalogEntry | null {
    if (!this.triggers) return null;
    const env = startEnv(story, ctx);
    for (const e of this.entries) {
      if (e.ir.start.k !== 'auto' || story.missions[e.ir.id]?.state === 'passed') continue;
      if (!this.open(e.ir, story, ctx)) continue;
      if (evalPred(e.ir.start.when, env, { n: 0 })) return e;
    }
    return null;
  }

  /** Missions with a start marker that the player may walk into now (open, not passed, in their hours). */
  markerCandidates(story: StorySlice, ctx: ModeContext): CatalogEntry[] {
    if (!this.triggers) return [];
    const hour = ctx.clock.env().hour;
    return this.entries.filter((e) => {
      const s = e.ir.start;
      if (s.k !== 'marker' || story.missions[e.ir.id]?.state === 'passed') return false;
      if (s.hours && !hourIn(hour, s.hours[0], s.hours[1])) return false;
      return this.open(e.ir, story, ctx);
    });
  }
}

function firstPassed(p: Pred): string | undefined {
  if (p.p === 'passed') return p.mission;
  if (p.p === 'and' || p.p === 'or') {
    for (const c of p.of) {
      const m = firstPassed(c);
      if (m) return m;
    }
  }
  return undefined;
}
