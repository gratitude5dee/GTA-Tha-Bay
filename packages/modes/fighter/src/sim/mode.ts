/**
 * `GameModeSim` of Culture Wars (M08a2; 07-fighter.md section 3): the screens (hub, select, match, results), one match on the fight
 * core per session, the CPU and the Training dummy, the camera, the ECS mirror and the view models. The sim is deterministic
 * given the inputs: `tick` maps the input frames to `FighterInput`, asks the CPU for the slots without a human, calls
 * `FightCore.step` once, mirrors and publishes. Presentation never feeds back (C02 rule 7).
 *
 * `enter`: `args.defId` may name a bout (`bout.a5`, the story hook); `args.params` is `FighterEnterParams`. With a bout or a
 * `kind` the match starts at once; with neither the hub opens. `exit` returns the `ModeResult` (FX8.4). Sim code under the C02 lint.
 */
import type { GameModeSim, JsonObject, ModeContext, ModeEnterArgs, ModeExitReason, ModeResult, SimEvent } from '@dv/shared';
import { FF, decodeInputs, decodeReplay, fromInputFrame, hashBuffer } from '@dv/shared/fight';
import type { DvFightReplay, FightRules, FighterDef, FighterLoadout, FightTuning, SchemeId } from '@dv/shared/fight';
import { advanceCam, newCamState, planCamera, toDirective, type CamState } from './camera.ts';
import { CpuDriver, kitInfo, type KitInfo } from './cpu/index.ts';
import { BOUTS, DEFAULT_STAGE, ROSTER, fighterPack, rosterBySlot, rosterEntry, stageDef } from './data.ts';
import { getFighterHost } from './host.ts';
import { FighterMatch } from './match.ts';
import { fighterRows, moveList, stageRows } from './menu.ts';
import { buildView, despawnMirror, spawnMirror, writeMirror, type MirrorTargets } from './mirror.ts';
import { addXp, sliceFromJson, sliceToJson, withUnlocks, migrateSlice, type FighterSlice } from './slice.ts';
import { DUMMY_MODES, TrainingState, type DummyMode } from './training.ts';
import { VM_MENU, VM_REPLAY, VM_TRAIN, VM_VIEW, type MenuVm, type ReplayVm } from './vm.ts';
import type { BoutDef, CpuLevel, EnterKind, FighterEnterParams, StageId } from '../types.ts';

/** Frames after `MatchEnd` begins at which the results card opens (`MATCH_END` in the tuning table). */
const RESULTS_AUTO_EXIT_TICKS = 150;

interface Sel {
  p1: string; p2: string; stage: StageId; night: boolean; cpu: CpuLevel; scheme: 'classic' | 'simple'; rounds: 1 | 2 | 3; kind: EnterKind;
  p2Human: boolean;
}

interface MatchResult {
  outcome: 'win' | 'lose';
  rounds: [number, number];
  durationSec: number;
  xp: number;
  streetCred: number;
  cashCents: number;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const clampLevel = (v: unknown, d: CpuLevel): CpuLevel => (v === 0 || v === 1 || v === 2 || v === 3 ? v : d);

/** The running session of this realm, for the QA handler and the tests. */
let active: FighterSession | null = null;
export const activeSession = (): FighterSession | null => active;

export class FighterSession {
  readonly origin: 'menu' | 'story';
  slice: FighterSlice;
  screen: MenuVm['screen'] = 'hub';
  paused = false;
  match: FighterMatch | null = null;
  training: TrainingState | null = null;
  result: MatchResult | null = null;
  sel: Sel;
  bout: BoutDef | null = null;
  bot = false;
  manual = false;
  reducedMotion = false;
  readonly cpus: [CpuDriver | null, CpuDriver | null] = [null, null];
  private readonly kits = new Map<string, KitInfo>();
  private mirror: MirrorTargets | null = null;
  private cam: CamState = newCamState();
  private lastMenu = '';
  private resultTick = -1;
  private exitRequested = false;
  /** QA: inputs set by the bridge, and steps left to take (manual mode). */
  qaInputs: [number, number] = [0, 0];
  pendingSteps = 0;
  /** Hits landed per slot and how many of them came from a special or super (an EX flag or a special-class move); QA reads it. */
  readonly stats = { hits: [0, 0], specialHits: [0, 0] };
  private replay: { r: DvFightReplay; in0: Uint16Array; in1: Uint16Array; bad: number | null; checked: number } | null = null;
  private moveListText: MenuVm['moveList'] = [];
  private lastView = '';
  /** Slot 0's inputs as `[word, tick it began]`, for the input display. */
  private readonly hist: number[][] = [];

  constructor(readonly ctx: ModeContext, args: ModeEnterArgs, slice: JsonObject | null) {
    const p = (args.params ?? {}) as FighterEnterParams;
    this.origin = ctx.origin.kind === 'story' ? 'story' : 'menu';
    this.slice = withUnlocks(sliceFromJson(slice), ctx.unlocks.list());
    const boutId = args.defId ?? p.bout;
    this.bout = boutId ? (BOUTS[boutId] ?? null) : null;
    const st = this.slice.settings;
    this.sel = {
      p1: 'player', p2: 'standin_rap_new_wave', stage: DEFAULT_STAGE, night: false, cpu: clampLevel(p.cpu, st.difficulty),
      scheme: p.scheme ?? st.scheme, rounds: p.rounds ?? 2, kind: p.kind ?? (this.bout ? 'story' : 'versus'), p2Human: p.p2 === 'human',
    };
    if (this.bout) {
      const b = this.bout;
      this.sel.p1 = b.p1 === 'player' ? 'player' : (rosterBySlot(b.p1)?.id ?? 'player');
      this.sel.p2 = rosterBySlot(b.p2)?.id ?? this.sel.p2;
      this.sel.stage = b.stage;
      this.sel.cpu = clampLevel(p.cpu ?? b.cpu, b.cpu);
      this.sel.rounds = (b.rules.roundsToWin ?? 2) as 1 | 2 | 3;
    }
    if (p.fighters) { this.sel.p1 = p.fighters[0]; this.sel.p2 = p.fighters[1]; }
    if (p.stage) this.sel.stage = p.stage;
    if (p.night !== undefined) this.sel.night = p.night;
    this.bot = p.bot === true;
    this.manual = p.manual === true;
    this.reducedMotion = p.reducedMotion === true;
    this.moveListText = this.currentMoveList();
  }

  // ---------------------------------------------------------------- kits

  private kit(slot: string): KitInfo {
    let k = this.kits.get(slot);
    if (!k) {
      const pack = fighterPack();
      const def = (pack.kits as unknown as Record<string, FighterDef>)[slot];
      if (!def) throw new Error(`fighter: no kit for ${slot}`);
      k = kitInfo(def, pack.tuning as FightTuning);
      this.kits.set(slot, k);
    }
    return k;
  }

  private currentMoveList(): MenuVm['moveList'] {
    const e = rosterEntry(this.sel.p1) ?? ROSTER[0];
    return e ? moveList(this.kit(e.slot).def, this.sel.scheme) : [];
  }

  // ---------------------------------------------------------------- starting a match

  /** Builds the match from the selection (or the replay) and puts the screen on `match`. */
  startMatch(): void {
    const ctx = this.ctx;
    const pack = fighterPack();
    const t = pack.tuning;
    const host = getFighterHost();
    const training = this.sel.kind === 'training';
    const r0 = rosterEntry(this.sel.p1) ?? (ROSTER[0] as (typeof ROSTER)[number]);
    const r1 = rosterEntry(this.sel.p2) ?? (ROSTER[1] as (typeof ROSTER)[number]);
    const scheme: SchemeId = this.sel.scheme;
    const lineup: [FighterLoadout, FighterLoadout] = [
      { slot: r0.slot, fighterId: r0.id, scheme: this.bot ? 'classic' : scheme, costume: 0 },
      { slot: r1.slot, fighterId: r1.id, scheme: this.sel.p2Human ? scheme : 'classic', costume: this.slice.lastLoadout?.costume ?? 0 },
    ];
    let rules: FightRules = {
      roundsToWin: this.sel.rounds, timerFrames: training ? 0 : t.TIMER, simpleDmgPct: t.SIMPLE_DMG_PCT,
      leniencyX100: host.leniencyX100, cpuLevel: [this.bot ? this.sel.cpu : null, training || this.sel.p2Human ? null : this.sel.cpu],
      training, shutdowns: false, cinematics: 'off',
    };
    if (training) rules = { ...rules, roundsToWin: 1 };
    if (this.bout) rules = { ...rules, ...this.bout.rules, cpuLevel: rules.cpuLevel, leniencyX100: host.leniencyX100 };
    let seed = this.ctx.tick ^ 0x5eed;
    seed = (ctx.rng('match').nextU32() ^ seed) | 0;
    if (this.replay) {
      const r = this.replay.r;
      rules = r.rules; seed = r.seed;
      lineup[0] = r.lineup[0]; lineup[1] = r.lineup[1];
    }
    this.result = null;
    this.resultTick = -1;
    this.exitRequested = false;
    this.paused = false;
    this.hist.length = 0;
    this.stats.hits[0] = 0; this.stats.hits[1] = 0; this.stats.specialHits[0] = 0; this.stats.specialHits[1] = 0;
    const m = new FighterMatch({ pack, rules, seed, lineup, stage: this.sel.stage });
    this.match = m;
    this.cam = newCamState();
    const k0 = this.kit(lineup[0].slot), k1 = this.kit(lineup[1].slot);
    this.cpus[0] = this.bot ? new CpuDriver({ slot: 0, level: this.sel.cpu, seed, kit: k0, oppKit: k1 }) : null;
    this.cpus[1] = !this.replay && !this.sel.p2Human && !this.manual ? new CpuDriver({ slot: 1, level: training ? this.slice.settings.difficulty : this.sel.cpu, seed, kit: k1, oppKit: k0 }) : null;
    this.training = training ? new TrainingState([k0, k1], t) : null;
    if (training) this.training?.setDummy('stand');
    despawnMirror(ctx, this.mirror);
    this.mirror = host.mirror ? spawnMirror(ctx, [lineup[0].fighterId, lineup[1].fighterId]) : null;
    this.screen = 'match';
    this.slice.lastLoadout = { slot: lineup[0].slot, costume: lineup[0].costume };
    this.publish(true);
  }

  // ---------------------------------------------------------------- per tick

  private humanWord(slot: 0 | 1): number {
    const f = this.ctx.input.frame(slot);
    return fromInputFrame(f);
  }

  /** Both inputs of the next tick. */
  private inputs(m: FighterMatch): [number, number] {
    const tick = m.tick;
    if (this.replay) {
      return [this.replay.in0[tick] ?? 0, this.replay.in1[tick] ?? 0];
    }
    if (this.manual) {
      // A QA match drives both slots by hand; in Training the dummy plays slot 1 as soon as it is set to anything but `stand`.
      const t = this.training;
      return t && t.dummy !== 'stand' ? [this.qaInputs[0] as number, t.dummyWord(m, 0)] : this.qaInputs;
    }
    const c0 = this.cpus[0];
    const w0 = c0 ? c0.input(m.buf, tick) : this.humanWord(0);
    let w1 = 0;
    const c1 = this.cpus[1];
    if (this.training) w1 = this.training.dummyWord(m, c1 ? c1.input(m.buf, tick) : 0);
    else if (c1) w1 = c1.input(m.buf, tick);
    else if (this.sel.p2Human) w1 = this.humanWord(1);
    return [w0, w1];
  }

  /** One sim tick of the match. */
  stepOnce(): void {
    const m = this.match;
    if (!m) return;
    const [i0, i1] = this.inputs(m);
    m.step(i0, i1);
    this.tally(m);
    const last = this.hist[this.hist.length - 1];
    if (!last || last[0] !== i0) { this.hist.push([i0, m.tick]); if (this.hist.length > 12) this.hist.shift(); }
    this.training?.observe(m, i0);
    advanceCam(m.buf, this.cam);
    if (this.replay) this.checkReplay(m);
  }

  private tally(m: FighterMatch): void {
    const ev = m.events;
    for (let i = 0; i < ev.n; i++) {
      if (ev.kind[i] !== 0) continue;
      const a = ev.slot[i] === 1 ? 1 : 0;
      this.stats.hits[a] = (this.stats.hits[a] as number) + 1;
      const mv = m.w(a, FF.Move);
      const slot = a === 0 ? this.sel.p1 : this.sel.p2;
      const kind = mv >= 0 ? this.kit(rosterEntry(slot)?.slot ?? 'PLAYER_FIGHTER').def.moves[mv]?.kind : undefined;
      if (ev.b[i] === 2 || kind === 'special' || kind === 'super') this.stats.specialHits[a] = (this.stats.specialHits[a] as number) + 1;
    }
  }

  /** The live match hash for the engine resource (`fighter.match`). */
  digest(): [number, number, number] | null {
    const m = this.match;
    if (!m) return null;
    const [lo, hi] = m.hash();
    return [lo, hi, m.tick];
  }

  tick(): void {
    const ctx = this.ctx;
    const m = this.match;
    if (!m || this.screen === 'hub' || this.screen === 'select') { this.publishMenu(); return; }
    if (this.paused) { this.publish(false); return; }
    if (this.manual || this.replay) {
      const n = Math.min(this.pendingSteps, 240);
      this.pendingSteps -= n;
      for (let i = 0; i < n && !m.ended; i++) this.stepOnce();
      if (n > 0 || this.lastView === '') this.publish(false);
      this.maybeFinish(m);
      return;
    }
    if (this.screen === 'results') {
      if (this.origin === 'story' || this.bot) {
        if (this.resultTick >= 0 && ctx.tick - this.resultTick >= RESULTS_AUTO_EXIT_TICKS) this.requestExit('completed');
      }
      this.publish(false);
      return;
    }
    this.stepOnce();
    this.publish(false);
    this.maybeFinish(m);
  }

  /** Steps `n` ticks by hand (QA); the engine tick that follows publishes. */
  qaStep(n: number): void {
    const m = this.match;
    if (!m) return;
    for (let i = 0; i < n && !m.ended; i++) this.stepOnce();
    this.publish(false);
    this.maybeFinish(m);
  }

  private maybeFinish(m: FighterMatch): void {
    if (!m.ended || this.result || this.training) return;
    const tun = fighterPack().tuning;
    if (m.phaseFrame < tun.MATCH_END) return;
    this.finish(m);
  }

  private finish(m: FighterMatch): void {
    const ctx = this.ctx;
    const win = m.winner === 0;
    const durationSec = Math.trunc(m.tick / 60);
    const reward = this.bout?.reward ?? { cashCents: 0, streetCred: 0, xp: 25 };
    const xp = win ? reward.xp : Math.trunc(reward.xp / 5);
    this.result = {
      outcome: win ? 'win' : 'lose', rounds: m.rounds, durationSec, xp,
      streetCred: win ? reward.streetCred : 0, cashCents: win ? reward.cashCents : 0,
    };
    addXp(this.slice, m.setup.lineup[0].fighterId, xp);
    this.screen = 'results';
    this.resultTick = ctx.tick;
    ctx.telemetry.emit('fight.end', {
      mode: this.sel.kind, scheme: m.setup.lineup[0].scheme, cpu: this.sel.cpu, rounds: m.rounds[0] + m.rounds[1],
      winnerSlot: m.winner, durationS: durationSec, pose: false,
    });
    this.publishMenu(true);
  }

  private requestExit(reason: ModeExitReason): void {
    if (this.exitRequested) return;
    this.exitRequested = true;
    this.ctx.events.emit({ t: 'mode.exit.request', tick: this.ctx.tick, s: reason });
  }

  // ---------------------------------------------------------------- replay mode

  loadReplay(text: string): void {
    const r = decodeReplay(text);
    this.replay = { r, in0: decodeInputs(r.inputs[0]), in1: decodeInputs(r.inputs[1]), bad: null, checked: 0 };
    this.sel.kind = 'replay';
    this.manual = true;
    this.cpus[0] = null; this.cpus[1] = null;
  }

  private checkReplay(m: FighterMatch): void {
    const rp = this.replay;
    if (!rp) return;
    const t = m.tick;
    if (t % rp.r.checkpoints.every === 0 && t > 0) {
      const k = t / rp.r.checkpoints.every - 1;
      const want = rp.r.checkpoints.hashes[k];
      const got = hashBuffer(m.buf);
      rp.checked = k + 1;
      if (want === undefined || want[0] !== got[0] || want[1] !== got[1]) rp.bad ??= k;
    }
  }

  replayModel(): ReplayVm | null {
    const rp = this.replay;
    const m = this.match;
    if (!rp || !m) return null;
    const total = Math.min(rp.in0.length, rp.in1.length);
    const done = m.tick >= total;
    const [lo, hi] = hashBuffer(m.buf);
    const hex = (v: number): string => (v >>> 0).toString(16).padStart(8, '0');
    return {
      v: 1, ticks: m.tick, checkpoints: rp.checked, ok: rp.bad === null, done, badAt: rp.bad,
      winner: m.winner, rounds: m.rounds, last: hex(hi) + hex(lo),
    };
  }

  // ---------------------------------------------------------------- publishing

  private publish(force: boolean): void {
    const ctx = this.ctx;
    const m = this.match;
    if (!m) return;
    const stage = stageDef(this.sel.stage);
    const plan = planCamera(m.buf, stage.camera, this.cam, this.reducedMotion);
    ctx.camera.direct(toDirective(plan));
    if (this.mirror) writeMirror(ctx, this.mirror, m, m.tick / 60);
    const freeze = this.cam.superT > 0 && this.cam.superT <= 45 ? 45 - this.cam.superT : 0;
    const view = buildView(m, plan, {
      stage: this.sel.stage, night: this.sel.night,
      scheme: [m.setup.lineup[0].scheme === 'simple' ? 1 : 0, m.setup.lineup[1].scheme === 'simple' ? 1 : 0],
      cpu: [this.cpus[0] ? this.cpus[0].level : -1, this.cpus[1] ? this.cpus[1].level : -1],
      ids: [m.setup.lineup[0].fighterId, m.setup.lineup[1].fighterId],
      reducedMotion: this.reducedMotion, paused: this.paused, freeze,
      ...(this.slice.settings.inputDisplay || this.training ? { inputs: this.hist.map((h) => [h[0] as number, m.tick - (h[1] as number)]) } : {}),
    });
    const json = view as unknown as JsonObject;
    // A paused or finished match repeats itself; send it once.
    const key = this.paused || (m.ended && this.screen === 'results') ? `${m.tick}:${this.paused}:${this.screen}` : '';
    if (!force && key !== '' && key === this.lastView) return;
    this.lastView = key;
    ctx.ui.patch(VM_VIEW, json);
    if (this.training) ctx.ui.patch(VM_TRAIN, this.training.model(m) as unknown as JsonObject);
    const rp = this.replayModel();
    if (rp) ctx.ui.patch(VM_REPLAY, rp as unknown as JsonObject);
    this.publishMenu(false);
  }

  menuModel(): MenuVm {
    const s = this.sel;
    return {
      v: 1, screen: this.screen, kind: s.kind === 'gallery' ? 'versus' : s.kind, paused: this.paused,
      fighters: fighterRows(this.slice.unlockedFighters), stages: stageRows(),
      p1: s.p1, p2: s.p2, stage: s.stage, night: s.night, cpu: s.cpu, scheme: s.scheme, rounds: s.rounds,
      inputDisplay: this.slice.settings.inputDisplay,
      moveList: this.screen === 'match' && this.paused ? this.moveListText : [],
      results: this.result ? { outcome: this.result.outcome, rounds: this.result.rounds, durationSec: this.result.durationSec, xp: this.result.xp } : null,
      origin: this.origin,
    };
  }

  publishMenu(force = false): void {
    const model = this.menuModel() as unknown as JsonObject;
    const json = JSON.stringify(model);
    if (!force && json === this.lastMenu) return;
    this.lastMenu = json;
    this.ctx.ui.patch(VM_MENU, model);
  }

  // ---------------------------------------------------------------- commands (UiCommand mode.cmd)

  command(name: string, args: JsonObject | null): void {
    const a = args ?? {};
    const sel = this.sel;
    switch (name) {
      case 'hub.go': {
        const to = str(a['to']);
        if (to === 'versus' || to === 'training') { sel.kind = to; this.screen = 'select'; }
        break;
      }
      case 'pick': {
        const id = str(a['id']);
        const slot = num(a['slot']);
        if (id && rosterEntry(id) && this.slice.unlockedFighters.includes(id)) {
          if (slot === 1) sel.p2 = id; else sel.p1 = id;
          this.moveListText = this.currentMoveList();
        }
        break;
      }
      case 'stage': {
        const id = str(a['id']);
        if (id && stageDef(id as StageId).id === id) sel.stage = id as StageId;
        if (typeof a['night'] === 'boolean') sel.night = a['night'];
        break;
      }
      case 'cpu': sel.cpu = clampLevel(a['level'], sel.cpu); this.slice.settings.difficulty = sel.cpu; break;
      case 'scheme': {
        const s = str(a['scheme']);
        if (s === 'classic' || s === 'simple') { sel.scheme = s; this.slice.settings.scheme = s; this.moveListText = this.currentMoveList(); }
        break;
      }
      case 'rounds': { const r = num(a['n']); if (r === 1 || r === 2 || r === 3) sel.rounds = r; break; }
      case 'p2': sel.p2Human = a['human'] === true; break;
      case 'begin': if (this.screen === 'select' || this.screen === 'hub') this.startMatch(); break;
      case 'pause': this.paused = a['on'] === true && this.screen === 'match'; break;
      case 'access': if (typeof a['reducedMotion'] === 'boolean') this.reducedMotion = a['reducedMotion']; break;
      case 'inputDisplay': this.slice.settings.inputDisplay = a['on'] === true; break;
      case 'rematch': if (this.screen === 'results' || this.screen === 'match') this.startMatch(); break;
      case 'back': {
        if (this.screen === 'results' || this.screen === 'match') { this.leaveMatch(); this.screen = 'select'; }
        else if (this.screen === 'select') this.screen = 'hub';
        else this.requestExit('quit');
        break;
      }
      case 'exit': this.requestExit(this.result ? 'completed' : 'quit'); break;
      case 'train.dummy': {
        const d = str(a['mode']);
        if (this.training && d && (DUMMY_MODES as readonly string[]).includes(d)) this.training.setDummy(d as DummyMode);
        break;
      }
      case 'train.rec': {
        if (!this.training) break;
        if (a['on'] === true) { this.training.startRecording(); } else this.training.stopRecording();
        break;
      }
      case 'train.reset': if (this.training && this.match) this.training.reset(this.match); break;
      case 'train.refill': if (this.training && this.match) this.training.refill(this.match); break;
      case 'train.overlay': {
        const k = str(a['key']);
        if (this.training && (k === 'boxes' || k === 'meter' || k === 'input' || k === 'damage')) this.training.overlay[k] = a['on'] !== false;
        break;
      }
      default: break;
    }
    this.publishMenu();
    if (this.match && this.training) this.ctx.ui.patch(VM_TRAIN, this.training.model(this.match) as unknown as JsonObject);
  }

  private leaveMatch(): void {
    despawnMirror(this.ctx, this.mirror);
    this.mirror = null;
    this.match = null;
    this.training = null;
    this.cpus[0] = null; this.cpus[1] = null;
    this.result = null;
    this.paused = false;
    this.ctx.camera.release();
    this.ctx.ui.patch(VM_VIEW, null);
    this.ctx.ui.patch(VM_TRAIN, null);
  }

  shutdown(): void {
    this.leaveMatch();
    this.ctx.ui.patch(VM_MENU, null);
    this.ctx.ui.patch(VM_REPLAY, null);
  }

  /** The `ModeResult` of the session (FX8.4). */
  modeResult(reason: ModeExitReason): ModeResult {
    const r = this.result;
    if (!r || reason !== 'completed') return { outcome: reason === 'quit' || reason === 'parentExit' ? 'quit' : 'abort' };
    return {
      outcome: r.outcome,
      data: { streetCred: r.streetCred, rounds: [r.rounds[0], r.rounds[1]], durationSec: r.durationSec },
      ...(r.cashCents > 0 ? { rewards: { cashCents: r.cashCents } } : {}),
    };
  }
}

// ---------------------------------------------------------------------------------------------------- GameModeSim

export const fighterSim: GameModeSim = {
  enter(ctx: ModeContext, args: ModeEnterArgs, slice: JsonObject | null): void {
    // The unlock of the bout hook's first encounter (`unlock.fighter`) is emitted by the mode host when the child begins (FX8.2).
    const s = new FighterSession(ctx, args, slice);
    active = s;
    getFighterHost().attach(() => s.digest());
    ctx.input.push('fighter');
    const p = (args.params ?? {}) as FighterEnterParams;
    if (typeof p.replay === 'string') s.loadReplay(p.replay);
    if (args.defId !== undefined || p.kind !== undefined || p.replay !== undefined || p.fighters !== undefined) s.startMatch();
    else { s.screen = 'hub'; s.publishMenu(true); }
  },

  tick(): void {
    active?.tick();
  },

  exit(ctx: ModeContext, reason: ModeExitReason): ModeResult {
    const s = active;
    active = null;
    if (!s) return { outcome: 'abort' };
    const res = s.modeResult(reason);
    s.shutdown();
    getFighterHost().attach(null);
    ctx.input.pop('fighter');
    if (s.origin === 'menu') ctx.save.request('modeExit');
    return res;
  },

  saveSlice(): JsonObject | null {
    return active ? sliceToJson(active.slice) : null;
  },

  migrateSlice(old: JsonObject, from: number): JsonObject {
    return migrateSlice(old, from);
  },

  onEvent(_ctx: ModeContext, e: SimEvent): void {
    if (e.t !== 'mode.cmd' || !active || typeof e.s !== 'string') return;
    let parsed: { mode?: unknown; name?: unknown; args?: unknown };
    try {
      parsed = JSON.parse(e.s) as { mode?: unknown; name?: unknown; args?: unknown };
    } catch {
      return;
    }
    if (parsed.mode !== 'fighter' || typeof parsed.name !== 'string') return;
    active.command(parsed.name, (parsed.args ?? null) as JsonObject | null);
  },
};

export default fighterSim;

