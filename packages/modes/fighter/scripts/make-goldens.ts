/**
 * Authors the two golden replays (`golden/vs-001.dvfight`, `golden/vs-002.dvfight`) with closed-loop "coach" scripts:
 * each decides its next macro from the live match state while authoring, and only the resulting input streams are
 * recorded, so the files stay plain open-loop replays that `fighter:replay` re-simulates.
 *
 *   DV_UPDATE_GOLDEN=1 pnpm --filter @dv/mode-fighter tsx scripts/make-goldens.ts      (the `golden-update` label applies)
 *
 * Without DV_UPDATE_GOLDEN=1 it only prints the coverage report of the existing files' scenarios and writes nothing.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FB, FF, FIGHTER_BASE, FM, FightCore, PROJ_BASE, PROJ_MAX, PROJ_WORDS, PW, Phase, St, encodeReplay, recordReplay,
} from '@dv/shared/fight';
import type { FightEvent, FightRules, FighterLoadout, FrameDataPack } from '@dv/shared/fight';
import { loadPack } from '../src/pack-files.ts';
import { ScriptBuilder } from '../src/qa/script-driver.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const here = path.dirname(fileURLToPath(import.meta.url));
const pack = loadPack(root);
const LP = FB.LP, MP = FB.MP, HP = FB.HP, LK = FB.LK, MK = FB.MK, HK = FB.HK;

const LINEUP: [FighterLoadout, FighterLoadout] = [
  { slot: 'PLAYER_FIGHTER', fighterId: 'player', scheme: 'classic', costume: 0 },
  { slot: 'PLAYER_FIGHTER', fighterId: 'player', scheme: 'classic', costume: 1 },
];
/** vs-003 (M08b1): the long-range shooter against the drone setplayer. */
const LINEUP_003: [FighterLoadout, FighterLoadout] = [
  { slot: 'ATH_SHOOTER', fighterId: 'dev_shooter', scheme: 'classic', costume: 0 },
  { slot: 'TECH_VISIONARY', fighterId: 'dev_visionary', scheme: 'classic', costume: 0 },
];

export interface View {
  tick: number; buf: Int32Array;
  w(slot: 0 | 1, word: number): number;
  dist: number; state(slot: 0 | 1): number;
  free(slot: 0 | 1): boolean;
}

function makeView(buf: Int32Array): View {
  const w = (slot: 0 | 1, word: number): number => buf[(FIGHTER_BASE[slot] as number) + word] as number;
  return {
    tick: buf[FM.Tick] as number, buf, w,
    get dist(): number { return Math.abs(w(1, FF.X) - w(0, FF.X)); },
    state: (s) => w(s, FF.State),
    free: (s) => { const st = w(s, FF.State); return (st === St.Idle || st === St.WalkF || st === St.WalkB || st === St.Crouch) && w(s, FF.Hitstop) === 0; },
  };
}

class Counter {
  log: string[] = [];
  clears = 0; rattled = 0; maxCombo = 0; timeouts = 0;
  hits = 0; blocks = 0; checks = 0; supers = 0; exHits = 0; counters = 0; kos = 0; throws = 0; techs = 0; chainMax = 0;
  push(e: FightEvent): void {
    this.log.push(`${e.tick} ${e.kind} s${e.slot} a${e.a} b${e.b}`);
    if (e.kind === 'hit') { this.hits++; if ((e.b & 2) !== 0) this.exHits++; if ((e.b & 1) !== 0) this.counters++; if (e.b === 3) this.throws++; if (e.b === 4) this.hits--; }
    else if (e.kind === 'block') this.blocks++;
    else if (e.kind === 'check') this.checks++;
    else if (e.kind === 'super') this.supers++;
    else if (e.kind === 'ko') this.kos++;
    else if (e.kind === 'cue' && e.a === 1) this.techs++;
  }
}

/** Both macros are issued together, so the two fighters stay in step; the shorter one is padded with neutral. */
type Joint = (v: View) => [number[], number[]] | null;

/** Play a joint coach and return both input streams plus the event tally. */
function author(rules: FightRules, p: FrameDataPack, coach: Joint, max: number, lineup: [FighterLoadout, FighterLoadout] = LINEUP, seen?: Set<string>): { a: number[]; b: number[]; tally: Counter; sim: FightCore; buf: Int32Array } {
  const sim = new FightCore();
  const buf = sim.init(p, rules, 2026, lineup);
  const a: number[] = [], b: number[] = [];
  const q0: number[] = [], q1: number[] = [];
  const tally = new Counter();
  const sink = { push: (e: FightEvent): void => tally.push(e) };
  for (let t = 0; t < max; t++) {
    if ((buf[FM.Phase] as number) === Phase.Fight && q0.length === 0 && q1.length === 0) {
      const m = coach(makeView(buf)) ?? [[0], [0]];
      const n = Math.max(m[0].length, m[1].length, 1);
      for (let i = 0; i < n; i++) { q0.push(m[0][i] ?? 0); q1.push(m[1][i] ?? 0); }
    }
    const i0 = q0.shift() ?? 0, i1 = q1.shift() ?? 0;
    a.push(i0); b.push(i1);
    sim.step(buf, i0, i1, sink);
    if (seen) {
      for (let q = 0; q < PROJ_MAX; q++) {
        const base = PROJ_BASE + q * PROJ_WORDS;
        const owner = (buf[base + PW.Owner] as number) - 1;
        if (owner < 0) continue;
        const def = (p.kits[lineup[owner as 0 | 1].slot].projectiles[buf[base + PW.Def] as number]);
        if (def) seen.add(def.id);
      }
      for (const sl of [0, 1] as const) { const o = FIGHTER_BASE[sl] as number; if ((buf[o + FF.State] as number) === St.Special && (buf[o + FF.ArmorLeft] as number) > 0) seen.add(`armor:${sl}`); }
    }
    for (const sl of [0, 1] as const) {
      const o = FIGHTER_BASE[sl] as number;
      if ((buf[o + FF.State] as number) === St.Clear) tally.clears = 1;
      if ((buf[o + FF.Rattled] as number) !== 0) tally.rattled = 1;
      tally.maxCombo = Math.max(tally.maxCombo, buf[o + FF.ComboHits] as number);
    }
    if ((buf[FM.Phase] as number) === Phase.TimeUp) tally.timeouts = 1;
    if ((buf[FM.Phase] as number) === Phase.MatchEnd) break;
  }
  return { a, b, tally, sim, buf };
}

const B0 = (): ScriptBuilder => new ScriptBuilder(1);
const B1 = (): ScriptBuilder => new ScriptBuilder(-1);

// ---- vs-001: normals, chains, specials, EX, super, KO ----------------------------------------------------------------
function coach001(): Joint {
  let step = 0;
  let wait = 0;
  let taunts = 0;
  const rot: ((v: View) => number[] | null)[] = [
    () => B0().press(LP).idle(5).press(MP).idle(8).press(HP).idle(30).out,                         // 5L > 5M > 5H chain
    () => B0().press(LP, 2).idle(5).press(MP, 2).idle(10).motion('623', LP).idle(40).out,          // 2L > 2M > Uplift (special cancel)
    () => B0().motion('236', MP).idle(60).out,                                                     // Spark Toss
    () => B0().press(LP | LK).idle(60).out,                                                        // throw
    (v) => (v.w(0, FF.Hype) >= 2000 ? B0().motion('236236', HP).idle(160).out : B0().motion('214', LK).idle(50).out),   // Surge
    (v) => (v.w(0, FF.Hype) >= 1000 ? B0().motion('623', LP | MP).idle(70).out : B0().press(HP).idle(30).out),   // EX Uplift
    () => B0().press(MP).idle(10).press(HP).idle(10).motion('214', MK).idle(50).out,                // normals into Skid Kick
  ];
  return (v) => {
    if (wait > 0) { wait--; return [[0], [0]]; }
    if (taunts < 10) { taunts++; return [B0().press(FB.TA).idle(62).out, [0]]; }        // build a full Hype bar first
    if (v.dist > 950) return [B0().hold(10, 6).out, [0]];
    if (!v.free(0)) return [[0], [0]];
    const p1 = v.state(1);
    if (p1 === St.Knockdown || p1 === St.Wakeup || p1 === St.Thrown || v.w(1, FF.Hitstun) > 0) return [[0], [0]];
    const m = rot[step % rot.length]?.(v) ?? [0];
    step++;
    return [m, [0]];
  };
}

// ---- vs-002: projectiles, throws, throw tech, Check, Clear, Rattled, time-out ----------------------------------------------
function coach002(): Joint {
  let seg = 0;
  const go = (n: number, v: View): void => { seg = n; if (process.env.DV_LOG === '1') console.log(`-- seg ${n} at tick ${v.tick}`); };
  const near = (v: View): boolean => v.dist <= 950;
  const settled = (v: View): boolean => v.free(0) && v.free(1) && v.w(1, FF.Hitstun) === 0 && v.w(1, FF.Blockstun) === 0 && v.w(0, FF.Hitstun) === 0;
  const idle2: [number[], number[]] = [[0], [0]];
  return (v) => {
    if (!settled(v)) return idle2;
    if (seg >= 2 && seg <= 7 && v.dist > 800) return [B0().hold(4, 6).out, [0]];      // keep the pair in throw and poke range
    switch (seg) {
      case 0: go(1, v); return [B0().motion('236', LP).idle(75).out, B1().hold(80, 5, FB.BL).out];           // Spark Toss into a guard
      case 1: if (!near(v)) return [B0().hold(10, 6).out, [0]]; go(2, v); return idle2;
      case 2: go(3, v); return [B0().press(LP | LK).idle(70).out, [0]];                                       // throw
      case 3: go(4, v); return [B0().idle(10).press(LP | LK).idle(70).out, B1().idle(13).press(LP | LK).idle(67).out];   // throw tech: P1 3 frames later
      case 4: go(5, v); return [B0().idle(20).press(LP).idle(50).out, B1().idle(20).press(MP | MK).idle(50).out];       // 5L into a Check
      case 5: go(6, v); return [B0().idle(10).press(LP).idle(4).press(MP).idle(60).out, B1().idle(16).press(HP | HK).idle(60).out];   // combo broken by Clear
      case 6: // drain Composure with Checks until Rattled
        if (v.w(1, FF.Rattled) === 0) return [[0], B1().press(MP | MK).idle(27).out];
        go(7, v); return idle2;
      case 7: go(8, v); return [B0().press(LP).idle(25).press(LP, 2).idle(25).press(MP).idle(40).press(HP).idle(30).out, B1().hold(160, 5, FB.BL).out];   // pokes on a Rattled guard
      default: return idle2;                                                                                  // run the clock out: time-out
    }
  };
}

// ---- vs-003: drones, sine shots, arcs by hold level, armor, summon --------------------------------------------------------------
function coach003(): Joint {
  let seg = 0;
  let taunts = 0;
  const go = (n: number): void => { seg = n; };
  const idle2: [number[], number[]] = [[0], [0]];
  const settled = (v: View): boolean => v.free(0) && v.free(1) && v.w(0, FF.Hitstun) === 0 && v.w(1, FF.Hitstun) === 0 && v.w(0, FF.Blockstun) === 0 && v.w(1, FF.Blockstun) === 0;
  return (v) => {
    if (!settled(v)) return idle2;
    switch (seg) {
      case 0: go(1); return [B0().motion('236', LP).idle(80).out, B1().motion('236', LP).idle(60).out];                       // arc 1, first drone
      case 1: go(2); return [B0().motion('236', LP).hold(20, 5, LP).idle(70).out, B1().motion('236', LP).idle(60).out];       // arc 2, second drone
      case 2: go(3); return [B0().motion('236', LP).hold(36, 5, LP).idle(90).out, B1().idle(150).out];                        // arc 3, drones fire sine shots
      case 3: go(4); return [B0().idle(30).out, B1().idle(30).out];
      case 4:
        if (taunts < 8 && v.w(1, FF.Hype) < 2000) { taunts++; return [B0().idle(62).out, B1().press(FB.TA).idle(62).out]; }       // build Hype for the super
        go(5); return idle2;
      case 5: go(6); return [B0().hold(30, 5, FB.BL).out, B1().motion('236236', LP).idle(220).out];                           // Roadmap Rush: the crew is called
      case 6:
        if (v.dist > 800) return [B0().hold(8, 6).out, [0]];                                                                    // close in
        go(7); return idle2;
      case 7: go(8); return [B0().idle(9).press(LP).idle(50).out, B1().motion('623', LP).idle(60).out];                       // Recall: the shield takes the poke
      case 8: go(9); return [B0().press(LP).idle(40).out, B1().idle(50).out];
      default: return idle2;
    }
  };
}

function describeRun(label: string, t: Counter, buf: Int32Array): void {
  if (process.env.DV_LOG === '1') console.log(t.log.join('\n'));
  console.log(`${label}: hits ${t.hits}, EX hits ${t.exHits}, counters ${t.counters}, blocks ${t.blocks}, checks ${t.checks}, supers ${t.supers}, throws ${t.throws}, techs ${t.techs}, KOs ${t.kos}, clear ${t.clears}, rattled ${t.rattled}, max combo ${t.maxCombo}, time-out ${t.timeouts}, winner ${buf[FM.Winner] as number}, rounds ${buf[FM.RoundsWon0] as number}-${buf[FM.RoundsWon1] as number}, tick ${buf[FM.Tick] as number}`);
}

const rules001: FightRules = { roundsToWin: 1, timerFrames: 5940, simpleDmgPct: 80, leniencyX100: 100, cpuLevel: [null, null], training: false, shutdowns: false, cinematics: 'off' };
const rules002: FightRules = { ...rules001, timerFrames: 2200 };
const rules003: FightRules = { ...rules001, timerFrames: 3000 };

const out = (a: number[], b: number[], rules: FightRules): string => {
  const rep = recordReplay(pack, rules, 2026, LINEUP, 'powell_turntable', 'm08a1', (t) => [a[t] ?? 0, b[t] ?? 0], a.length);
  return encodeReplay(rep);
};

const r1 = author(rules001, pack, coach001(), 12000);
describeRun('vs-001', r1.tally, r1.buf);
const r2 = author(rules002, pack, coach002(), 12000);
describeRun('vs-002', r2.tally, r2.buf);

const seen003 = new Set<string>();
const r3 = author(rules003, pack, coach003(), 12000, LINEUP_003, seen003);
describeRun('vs-003', r3.tally, r3.buf);
console.log(`vs-003 projectiles and states seen: ${[...seen003].sort().join(', ')}`);
const out3 = (a: number[], b: number[]): string => {
  const rep = recordReplay(pack, rules003, 2026, LINEUP_003, 'powell_turntable', 'm08b1', (t) => [a[t] ?? 0, b[t] ?? 0], a.length);
  return encodeReplay(rep);
};

if (process.env.DV_UPDATE_GOLDEN === '1') {
  writeFileSync(path.join(here, '..', 'golden', 'vs-003.dvfight'), `${out3(r3.a, r3.b)}\n`);
  writeFileSync(path.join(here, '..', 'golden', 'vs-001.dvfight'), `${out(r1.a, r1.b, rules001)}\n`);
  writeFileSync(path.join(here, '..', 'golden', 'vs-002.dvfight'), `${out(r2.a, r2.b, rules002)}\n`);
  console.log('golden files written');
}
