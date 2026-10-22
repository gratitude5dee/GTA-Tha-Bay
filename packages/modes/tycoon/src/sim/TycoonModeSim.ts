/**
 * `GameModeSim` of Business Tycoon (M09a1): the thin C06 adapter around the pure core in `@dv/shared/tycoon`.
 *
 * Pacing (08-tycoon.md section 5.1): one sim step is one in-game week. At 1x a week is 1,200 ticks, 2x 600, 4x 300. The clock holds
 * while the player pauses, while the company is `awaiting` something (a meeting, a board vote, a bridge offer) and when the run
 * has ended. Speed changes the threshold only, never the outcome. A hidden page runs no frames and therefore no ticks.
 *
 * Commands: `setAllocation`, `setMarketing` and every command that resolves a pause apply at once; others wait in a queue that is
 * drained at the week boundary, unless the clock is not running, in which case they apply at once too. Each accepted command is
 * recorded as a `ChoiceRecord{week, seq}`, so `(setup, choices)` replays the run.
 *
 * Messages arrive as `mode.cmd` events (`UiCommand`, owner `tycoon`): `start {seed, ...setup}`, `cmd {json}`, `speed {n}`,
 * `pause {on}`, `step`, `abandon`. The view model `mode.tycoon.view` is patched whenever something changed.
 * Sim code under the C02 lint: no `Math.random`, no `Date`, no timers; every draw is a counter draw of the core.
 */
import type { GameModeSim, JsonObject, JsonValue, ModeContext, ModeEnterArgs, ModeExitReason, ModeResult, SaveReason, SimEvent } from '@dv/shared';
import {
  applyCommand,
  hashCompany,
  newRun,
  policyView,
  setupFromSeed,
  stepWeek,
  type ChoiceRecord,
  type Command,
  type CommandResult,
  type CompanyState,
  type RunSetup,
  type TycoonContent,
} from '@dv/shared/tycoon';
import { tycoonContent } from './content.ts';
import { DIVIDEND_CAP_CENTS, emptySlice, restoreRun, sliceFromJson, sliceToJson, type TycoonSlice } from './slice.ts';

export type Speed = 1 | 2 | 4;
export const VIEW_KEY = 'mode.tycoon.view' as const;
/** QA: the setup and the last choices of the live run (capped to fit the 4 KiB patch limit), so a run can be replayed elsewhere. */
export const RUN_KEY = 'mode.tycoon.run' as const;
const RUN_PATCH_BYTES = 3_400;

/** Commands that apply the moment they arrive, because they resolve a pause or are marked immediate in the UI. */
const IMMEDIATE = new Set<Command['t']>(['setAllocation', 'setMarketing', 'accept', 'walk', 'boardVote', 'bridge', 'endRun', 'exploreSale', 'goPublic', 'acceptExit', 'resolveEvent', 'vcSpoke']);

export interface SessionEnv {
  content: TycoonContent;
  /** Called after a save moment (`interval`, round close, board, run end). */
  requestSave(reason: SaveReason): void;
  /** Called when the visible state changed. */
  publish(view: TycoonView): void;
  /** Optional: the C16 names `tycoon.run_end` and friends are proposals (08-tycoon.md section 5.13) until the registry has them. */
  telemetry?(name: 'tycoon.run_end', props: Record<string, string | number | boolean>): void;
}

export interface TycoonView {
  week: number;
  phase: string;
  awaiting: string | null;
  paused: boolean;
  speed: Speed;
  hash: string;
  unverifiable: boolean;
  cash: number;
  mrr: number;
  users: number;
  headcount: number;
  runwayWeeks: number;
  valuationRef: number;
  poolAvailable: number;
  totalFd: number;
  holders: { id: string; shares: number }[];
  safes: number;
  rounds: number;
  meeting: { id: string; vcId: string; amount: number; preMoney: number; poolTargetBp: number } | null;
  result: { kind: string; win: boolean; score: number; founderPayoutCents: number } | null;
  weekTicks: number;
  weekTicksNeeded: number;
  lastError: string | null;
  raise: { kind: string; targetCents: number } | null;
  vcPool: string[];
  candidates: { id: string; role: string; skill: number; askYr: number }[];
  choices: number;
}

export function weekThreshold(content: TycoonContent, speed: Speed): number {
  const t = content.balance.sim.ticksPerWeek;
  return speed === 1 ? t.x1 : speed === 2 ? t.x2 : t.x4;
}

/** One run of the company, independent of the host: the unit the tests drive. */
export class TycoonSession {
  readonly choices: ChoiceRecord[] = [];
  state: CompanyState;
  readonly setup: RunSetup;
  speed: Speed = 1;
  paused = false;
  unverifiable = false;
  weekTicks = 0;
  lastError: string | null = null;
  private seq = 0;
  private seqWeek = -1;
  private queue: Command[] = [];
  /** Snapshot of the visible run end, so exit can report it. */
  ended = false;

  constructor(private readonly env: SessionEnv, setup: RunSetup, state?: CompanyState, choices?: ChoiceRecord[], unverifiable = false) {
    this.setup = setup;
    this.state = state ?? newRun(setup, env.content);
    if (choices) this.choices.push(...choices);
    this.unverifiable = unverifiable;
    const last = this.choices[this.choices.length - 1];
    if (last && last.week === this.state.week) {
      this.seq = last.seq + 1;
      this.seqWeek = last.week;
    }
    this.ended = this.state.phase === 'ended';
  }

  get running(): boolean {
    return !this.paused && this.state.awaiting === null && this.state.phase !== 'ended';
  }

  private record(cmd: Command): void {
    if (this.seqWeek !== this.state.week) {
      this.seqWeek = this.state.week;
      this.seq = 0;
    }
    this.choices.push({ week: this.state.week, seq: this.seq++, cmd });
  }

  private applyNow(cmd: Command): CommandResult {
    const r = applyCommand(this.state, cmd, this.env.content);
    if (r.ok) {
      this.record(cmd);
      this.lastError = null;
      if (this.state.phase === 'ended') this.onEnded();
    } else this.lastError = r.error.code;
    return r;
  }

  /** The player's entry point. Returns the result for an immediate command and `{ok: true, queued: true}` for a queued one. */
  submit(cmd: Command): CommandResult & { queued?: boolean } {
    if (this.state.phase === 'ended') return { ok: false, error: { code: 'ENDED' } };
    if (IMMEDIATE.has(cmd.t) || !this.running) {
      const r = this.applyNow(cmd);
      this.env.publish(this.view());
      return r;
    }
    this.queue.push(cmd);
    return { ok: true, queued: true };
  }

  private drain(): void {
    const q = this.queue;
    this.queue = [];
    for (const cmd of q) this.applyNow(cmd);
  }

  /** One sim tick. Runs a week when the threshold is reached and the clock is running. */
  tick(): void {
    if (!this.running) return;
    this.weekTicks += 1;
    if (this.weekTicks >= weekThreshold(this.env.content, this.speed)) {
      this.weekTicks = 0;
      this.advanceWeek();
    }
  }

  /** QA: one week now, whatever the ticks say. Refuses while the company awaits an answer. */
  stepNow(): boolean {
    if (this.state.phase === 'ended' || this.state.awaiting !== null) return false;
    this.weekTicks = 0;
    this.advanceWeek();
    return true;
  }

  private advanceWeek(): void {
    this.drain();
    if (this.state.phase === 'ended' || this.state.awaiting !== null) {
      this.env.publish(this.view());
      return;
    }
    const before = this.state.capTable.rounds.length + this.state.capTable.safes.length;
    const res = stepWeek(this.state, this.env.content);
    if (this.state.phase === 'ended') this.onEnded();
    else {
      if (this.state.week % this.env.content.balance.sim.boardIntervalWeeks === 0) this.env.requestSave('interval');
      if (this.state.capTable.rounds.length + this.state.capTable.safes.length !== before) this.env.requestSave('checkpoint');
      if (res.awaiting === 'board') this.env.requestSave('checkpoint');
    }
    this.env.publish(this.view());
  }

  private onEnded(): void {
    if (this.ended) return;
    this.ended = true;
    const r = this.state.result;
    if (r) this.env.telemetry?.('tycoon.run_end', { kind: r.kind, weeks: r.week, win: r.win, tierScore: r.score });
    this.env.requestSave('checkpoint');
  }

  setSpeed(n: number): void {
    if (n === 1 || n === 2 || n === 4) {
      // Keep the fraction of the week that has passed, so a speed change never skips or repeats a week.
      const old = weekThreshold(this.env.content, this.speed);
      this.speed = n;
      this.weekTicks = Math.min(Math.floor((this.weekTicks / old) * weekThreshold(this.env.content, n)), weekThreshold(this.env.content, n) - 1);
    }
  }

  view(): TycoonView {
    const s = this.state;
    const pv = policyView(s, this.env.content);
    const m = s.meetings.find((x) => x.phase === 'offer');
    const holders = s.capTable.holders.map((h) => {
      let n = 0;
      for (const k of Object.keys(h.shares)) n += h.shares[k as keyof typeof h.shares] ?? 0;
      return { id: h.id, shares: n };
    });
    return {
      week: s.week,
      phase: s.phase,
      awaiting: s.awaiting,
      paused: this.paused,
      speed: this.speed,
      hash: hashCompany(s),
      unverifiable: this.unverifiable,
      cash: s.cash,
      mrr: s.mrr,
      users: pv.users,
      headcount: pv.headcount,
      runwayWeeks: pv.runwayWeeks,
      valuationRef: pv.valuationRef,
      poolAvailable: pv.poolAvailable,
      totalFd: s.capTable.totalFd,
      holders,
      safes: s.capTable.safes.length,
      rounds: s.capTable.rounds.length,
      meeting: m && m.offer ? { id: m.id, vcId: m.vcId, amount: m.offer.amount, preMoney: m.offer.preMoney, poolTargetBp: m.offer.poolTargetBp } : null,
      result: s.result ? { kind: s.result.kind, win: s.result.win, score: s.result.score, founderPayoutCents: s.result.founderPayoutCents } : null,
      weekTicks: this.weekTicks,
      weekTicksNeeded: weekThreshold(this.env.content, this.speed),
      lastError: this.lastError,
      raise: s.raise ? { kind: s.raise.kind, targetCents: s.raise.targetCents } : null,
      vcPool: s.raise ? s.raise.vcPool : [],
      candidates: s.market.slice(0, 5).map((x) => ({ id: x.id, role: x.role, skill: x.skill, askYr: x.askYr })),
      choices: this.choices.length,
    };
  }

  /** The setup and as many of the newest choices as fit one patch. */
  runExport(): { setup: RunSetup; choices: ChoiceRecord[]; total: number; truncated: boolean } {
    let from = 0;
    let out = { setup: this.setup, choices: this.choices.slice(from), total: this.choices.length, truncated: false };
    while (JSON.stringify(out).length > RUN_PATCH_BYTES && from < this.choices.length) {
      from += 1;
      out = { setup: this.setup, choices: this.choices.slice(from), total: this.choices.length, truncated: true };
    }
    return out;
  }
}

// ---------------------------------------------------------------------------------------------------------------- mode

interface Held {
  session: TycoonSession | null;
  slice: TycoonSlice;
  ctx: ModeContext;
}
let held: Held | null = null;

/** The running session, for the QA bridge and the tests. */
export const activeTycoon = (): TycoonSession | null => held?.session ?? null;

function makeEnv(ctx: ModeContext, content: TycoonContent): SessionEnv {
  return {
    content,
    requestSave: (reason) => ctx.save.request(reason),
    publish: (view) => {
      ctx.ui.patch(VIEW_KEY, view as unknown as JsonValue);
      const run = activeTycoon()?.runExport();
      if (run) ctx.ui.patch(RUN_KEY, run as unknown as JsonValue);
    },
  };
}

function startRun(h: Held, args: Record<string, unknown>): void {
  const content = tycoonContent();
  const seed = typeof args['seed'] === 'number' ? args['seed'] : 1;
  const opts: Partial<RunSetup> = {};
  if (args['founder'] === 'engineer' || args['founder'] === 'hustler' || args['founder'] === 'designer') opts.founder = args['founder'];
  if (typeof args['coFounder'] === 'boolean') opts.coFounder = args['coFounder'];
  if (typeof args['thesis'] === 'string') opts.thesis = args['thesis'];
  const setup = setupFromSeed(seed, opts, content);
  h.session = new TycoonSession(makeEnv(h.ctx, content), setup);
  h.session.submit({ t: 'setAllocation', features: content.balance.setup.allocation.features, refactor: content.balance.setup.allocation.refactor, infra: content.balance.setup.allocation.infra });
  h.ctx.save.request('checkpoint');
}

/** Archives a finished run into the slice. */
function archive(h: Held): void {
  const s = h.session;
  if (!s || !s.state.result) return;
  const r = s.state.result;
  const slice = h.slice;
  slice.runs = [{ setup: s.setup, result: r, savedAt: h.ctx.tick }, ...slice.runs].slice(0, 20);
  if (r.tier !== null && r.score > slice.bestScores[r.tier]) slice.bestScores[r.tier] = r.score;
  if (r.win && r.kind !== 'miniWin') slice.dividendEarnedCents += Math.min(DIVIDEND_CAP_CENTS, Math.floor(r.founderPayoutCents * 0.0002));
  if (r.kind === 'ramen' && r.win) slice.hardcore = true;
  slice.active = null;
}

export const tycoonSim: GameModeSim = {
  enter(ctx: ModeContext, args: ModeEnterArgs, raw: JsonObject | null): void {
    const content = tycoonContent();
    const slice = sliceFromJson(raw, content);
    const h: Held = { session: null, slice, ctx };
    held = h;
    const restored = restoreRun(slice, content);
    if (restored) {
      h.session = new TycoonSession(makeEnv(ctx, content), restored.setup, restored.state, restored.choices, restored.unverifiable);
    } else if (typeof args.seed === 'number' && args.params && typeof args.params === 'object' && !Array.isArray(args.params) && (args.params as JsonObject)['autostart'] === true) {
      startRun(h, { seed: args.seed });
    }
    ctx.ui.patch(VIEW_KEY, h.session ? (h.session.view() as unknown as JsonValue) : null);
  },

  tick(): void {
    held?.session?.tick();
  },

  onEvent(_ctx: ModeContext, e: SimEvent): void {
    const h = held;
    if (!h || e.t !== 'mode.cmd' || e.s === undefined) return;
    let msg: { mode?: string; name?: string; args?: Record<string, unknown> | null };
    try {
      msg = JSON.parse(e.s) as typeof msg;
    } catch {
      return;
    }
    if (msg.mode !== 'tycoon' || typeof msg.name !== 'string') return;
    const a = msg.args ?? {};
    const s = h.session;
    switch (msg.name) {
      case 'start':
        if (!s || s.state.phase === 'ended') {
          if (s?.state.result) archive(h);
          startRun(h, a);
        }
        break;
      case 'cmd':
        if (s && typeof a['json'] === 'string') {
          try {
            s.submit(JSON.parse(a['json']) as Command);
          } catch {
            s.lastError = 'BAD_JSON';
          }
        }
        break;
      case 'speed':
        if (s && typeof a['n'] === 'number') s.setSpeed(a['n']);
        break;
      case 'pause':
        if (s) s.paused = a['on'] !== false;
        break;
      case 'step':
        s?.stepNow();
        break;
      case 'abandon':
        if (s) {
          s.submit({ t: 'endRun', reason: 'quit' });
          archive(h);
          h.session = null;
        }
        break;
      default:
        return;
    }
    h.ctx.ui.patch(VIEW_KEY, h.session ? (h.session.view() as unknown as JsonValue) : null);
  },

  exit(ctx: ModeContext, reason: ModeExitReason): ModeResult {
    const h = held;
    held = null;
    if (!h) return { outcome: 'abort' };
    ctx.ui.patch(VIEW_KEY, null);
    const r = h.session?.state.result ?? null;
    if (r) return { outcome: r.win ? 'win' : 'lose', data: { kind: r.kind, score: r.score } as JsonObject };
    return { outcome: reason === 'quit' ? 'quit' : 'abort' };
  },

  saveSlice(): JsonObject | null {
    const h = held;
    if (!h) return null;
    const content = tycoonContent();
    const s = h.session;
    if (s?.state.result) {
      archive(h);
      h.session = null;
    }
    const slice: TycoonSlice = { ...h.slice, contentVersion: content.contentVersion, balanceVersion: content.balanceVersion };
    const live = h.session;
    if (live) {
      slice.active = {
        setup: live.setup,
        choices: live.choices,
        snapshot: { week: live.state.week, state: live.state, hash: hashCompany(live.state) },
        ...(live.unverifiable ? { unverifiable: true } : {}),
      };
    } else slice.active = null;
    return sliceToJson(slice);
  },
};

export { emptySlice };
export default tycoonSim;
