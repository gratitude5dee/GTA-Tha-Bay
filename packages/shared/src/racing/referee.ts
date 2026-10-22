/**
 * The race referee (06-racing.md 2.8; 06-racing-data.md 4.2; M07a1). Pure: the sim, the headless bots and, from M12e, the room
 * Durable Object call the same functions, so all of them agree on what counts as a gate. Sim code under the C02 lint.
 *
 *  - `crossedGate`: the segment of the front axle between two ticks against the gate segment, in XZ; the height difference stays
 *    within 6 m and the motion must go along the gate tangent, so a wrong-way pass does not count.
 *  - `projectToRoute`: the car on the route centreline, searched in a window of 120 m either side of the previous answer.
 *  - `refereeStep`: gates in order (a skipped gate is never counted), wrong way, stuck time, the clock of a timed event.
 *  - `placeOrder`: by lap, by gate, by distance left to the next gate, by the tick of the last gate.
 *
 * `RefereeState` carries five fields beyond the spec text (`sBest`, `startTick`, `lastGateTick`, `lastGate`, `laps`), recorded as
 * BD-M07a1-02: the wrong-way rule needs the furthest progress, and the finish time needs the tick of GO.
 */
import { SIM_DT } from '../contracts/c02-loop.ts';
import { dsqrt } from '../detmath.ts';
import { centreline, type GateDef, type RaceDef } from './race-def.ts';

export interface RefereeState {
  /** Index of the next gate to cross. */
  gate: number;
  /** 1-based. */
  lap: number;
  laps: number;
  /** Route metres at the last projection. */
  s: number;
  /** Centre of the projection window, route metres. */
  sWindow: number;
  /** Furthest route metres reached since the last gate. */
  sBest: number;
  wrongWayTicks: number;
  stuckTicks: number;
  timeLeftMs: number | null;
  speedSum: number;
  driftScore: number;
  finished: boolean;
  dnf: boolean;
  startTick: number;
  lastGateTick: number;
  /** Index of the last gate crossed (the respawn point), -1 before the first. */
  lastGate: number;
}

export type RaceEvent =
  | { t: 'race.gate'; i: number; tick: number; speedMps: number }
  | { t: 'race.lap'; lap: number; ms: number }
  | { t: 'race.finish'; ms: number; tick: number }
  | { t: 'race.dnf'; reason: 'time' | 'totaled' | 'busted' | 'abandon' }
  | { t: 'race.wrongway' }
  | { t: 'race.respawn'; at: number };

export interface RefereeRules {
  gateTolerantY: number;
  wrongWayWarnM: number;
  wrongWayRespawnTicks: number;
}
export const DEFAULT_REFEREE_RULES: RefereeRules = { gateTolerantY: 6, wrongWayWarnM: 30, wrongWayRespawnTicks: 360 };

/** Half-width of the window the projection searches, metres. */
export const PROJECTION_WINDOW_M = 120;

type V3 = readonly [number, number, number];

export function crossedGate(g: GateDef, prev: V3, cur: V3, tolerantY: number = DEFAULT_REFEREE_RULES.gateTolerantY): boolean {
  const tx = g.tangent[0];
  const tz = g.tangent[1];
  const mx = cur[0] - prev[0];
  const mz = cur[2] - prev[2];
  // positive motion along the tangent
  if (mx * tx + mz * tz <= 0) return false;
  const dy = cur[1] - g.at[1];
  if ((dy < 0 ? -dy : dy) > tolerantY) return false;
  // the gate segment runs along the perpendicular (-tz, tx) from at - half to at + half
  const hx = -tz * (g.widthM / 2);
  const hz = tx * (g.widthM / 2);
  const ax = g.at[0] - hx;
  const az = g.at[2] - hz;
  const ex = 2 * hx;
  const ez = 2 * hz;
  // signed distances of both ends of the motion to the gate line: positive ahead of the gate
  const dPrev = (prev[0] - g.at[0]) * tx + (prev[2] - g.at[2]) * tz;
  const dCur = (cur[0] - g.at[0]) * tx + (cur[2] - g.at[2]) * tz;
  if (!(dPrev < 0 && dCur >= 0)) return false;
  // where the motion meets the gate line, along the gate segment
  const t = dPrev / (dPrev - dCur);
  const px = prev[0] + mx * t - ax;
  const pz = prev[2] + mz * t - az;
  const along = (px * ex + pz * ez) / (ex * ex + ez * ez);
  return along >= 0 && along <= 1;
}

const lineCache = new WeakMap<object, Float64Array>();
function lineOf(def: Pick<RaceDef, 'line'>): Float64Array {
  let c = lineCache.get(def.line);
  if (!c) {
    c = centreline(def);
    lineCache.set(def.line, c);
  }
  return c;
}

export interface RouteProjection { s: number; lateralM: number }

export function projectToRoute(def: Pick<RaceDef, 'line' | 'routeLenM'>, p: V3, windowFrom: number): RouteProjection {
  const pts = lineOf(def);
  const step = def.line.stepM;
  const n = pts.length / 2;
  if (n < 2) return { s: 0, lateralM: 0 };
  const i0 = Math.max(0, Math.floor((windowFrom - PROJECTION_WINDOW_M) / step));
  const i1 = Math.min(n - 2, Math.ceil((windowFrom + PROJECTION_WINDOW_M) / step));
  let best = Infinity;
  let bestS = windowFrom;
  let bestLat = 0;
  for (let i = i0; i <= i1; i++) {
    const ax = pts[2 * i] as number;
    const az = pts[2 * i + 1] as number;
    const bx = pts[2 * i + 2] as number;
    const bz = pts[2 * i + 3] as number;
    const dx = bx - ax;
    const dz = bz - az;
    const l2 = dx * dx + dz * dz;
    let t = l2 > 0 ? ((p[0] - ax) * dx + (p[2] - az) * dz) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + dx * t;
    const qz = az + dz * t;
    const ex = p[0] - qx;
    const ez = p[2] - qz;
    const d2 = ex * ex + ez * ez;
    if (d2 < best) {
      best = d2;
      bestS = (i + t) * step;
      const l = dsqrt(l2);
      bestLat = l > 0 ? (-ex * dz + ez * dx) / l : 0;
    }
  }
  if (bestS > def.routeLenM) bestS = def.routeLenM;
  return { s: bestS, lateralM: bestLat };
}

export function newRefereeState(def: Pick<RaceDef, 'gates' | 'laps'>, startTick: number, timeLimitMs: number | null = null): RefereeState {
  const first = def.gates[0];
  const skipStart = first !== undefined && first.kind === 'start';
  return {
    gate: skipStart ? 1 : 0,
    lap: 1,
    laps: def.laps ?? 1,
    s: skipStart && first ? first.s : 0,
    sWindow: skipStart && first ? first.s : 0,
    sBest: skipStart && first ? first.s : 0,
    wrongWayTicks: 0,
    stuckTicks: 0,
    timeLeftMs: timeLimitMs,
    speedSum: 0,
    driftScore: 0,
    finished: false,
    dnf: false,
    startTick,
    lastGateTick: startTick,
    lastGate: skipStart ? 0 : -1,
  };
}

const MS_PER_TICK = SIM_DT * 1000;
const msBetween = (a: number, b: number): number => Math.round((b - a) * MS_PER_TICK);

/** Moves a car's referee state back to gate `at` after a respawn. */
export function resetToGate(def: Pick<RaceDef, 'gates'>, st: RefereeState, at: number): void {
  const g = def.gates[at < 0 ? 0 : at];
  const s = g ? g.s : 0;
  st.s = s;
  st.sWindow = s;
  st.sBest = s;
  st.wrongWayTicks = 0;
  st.stuckTicks = 0;
}

export function refereeStep(
  def: RaceDef, st: RefereeState, prev: V3, cur: V3, speedMps: number, tick: number, rules: RefereeRules = DEFAULT_REFEREE_RULES,
): RaceEvent[] {
  const out: RaceEvent[] = [];
  if (st.finished || st.dnf) return out;

  // the clock of a timed event
  if (st.timeLeftMs !== null) {
    st.timeLeftMs -= MS_PER_TICK;
    if (st.timeLeftMs <= 0) {
      st.timeLeftMs = 0;
      st.dnf = true;
      out.push({ t: 'race.dnf', reason: 'time' });
      return out;
    }
  }

  // stuck time: below walking pace
  if (speedMps < 1) st.stuckTicks++;
  else st.stuckTicks = 0;

  // gates, in order
  const g = def.gates[st.gate];
  if (g && crossedGate(g, prev, cur, rules.gateTolerantY)) {
    const i = st.gate;
    out.push({ t: 'race.gate', i, tick, speedMps });
    st.lastGate = i;
    st.lastGateTick = tick;
    st.sBest = g.s;
    st.wrongWayTicks = 0;
    if (g.timeBonusSec !== undefined && st.timeLeftMs !== null) st.timeLeftMs += g.timeBonusSec * 1000;
    if (g.kind === 'speedCam') st.speedSum += Math.round(speedMps * 3.6);
    st.gate++;
    if (g.kind === 'lap' || (g.kind === 'finish' && st.lap < st.laps)) {
      out.push({ t: 'race.lap', lap: st.lap, ms: msBetween(st.startTick, tick) });
      st.lap++;
      st.gate = def.gates[0]?.kind === 'start' ? 1 : 0;
    } else if (g.kind === 'finish' || st.gate >= def.gates.length) {
      st.finished = true;
      out.push({ t: 'race.finish', ms: msBetween(st.startTick, tick), tick });
      return out;
    }
  }

  // progress along the route and the wrong-way rule
  const pr = projectToRoute(def, cur, st.sWindow);
  st.s = pr.s;
  st.sWindow = pr.s;
  if (pr.s > st.sBest) st.sBest = pr.s;
  if (st.sBest - pr.s > rules.wrongWayWarnM) {
    st.wrongWayTicks++;
    if (st.wrongWayTicks === 1) out.push({ t: 'race.wrongway' });
    if (st.wrongWayTicks >= rules.wrongWayRespawnTicks) {
      out.push({ t: 'race.respawn', at: st.lastGate < 0 ? 0 : st.lastGate });
      resetToGate(def, st, st.lastGate);
    }
  } else {
    st.wrongWayTicks = 0;
  }
  return out;
}

export interface PlaceEntry {
  id: number;
  st: RefereeState;
  tickLastGate: number;
  /** Metres from the car to its next gate along the route. */
  distToNext: number;
}

/** Ids from first to last: by lap, then gate (more is ahead), then distance left to the next gate (less is ahead), then the tick of the last gate. */
export function placeOrder(states: readonly PlaceEntry[]): number[] {
  return [...states]
    .sort((a, b) => {
      if (a.st.lap !== b.st.lap) return b.st.lap - a.st.lap;
      if (a.st.gate !== b.st.gate) return b.st.gate - a.st.gate;
      if (a.distToNext !== b.distToNext) return a.distToNext - b.distToNext;
      if (a.tickLastGate !== b.tickLastGate) return a.tickLastGate - b.tickLastGate;
      return a.id - b.id;
    })
    .map((e) => e.id);
}

/** Metres from route position `s` to the next gate (0 once past the last). */
export function distanceToNextGate(def: Pick<RaceDef, 'gates'>, st: Pick<RefereeState, 'gate' | 's'>): number {
  const g = def.gates[st.gate];
  if (!g) return 0;
  const d = g.s - st.s;
  return d < 0 ? 0 : d;
}

/** Position and heading (yaw, forward is -Z) to put a car back on gate `at`. */
export function gatePose(def: Pick<RaceDef, 'gates'>, at: number): { x: number; y: number; z: number; tx: number; tz: number } | null {
  const g = def.gates[at < 0 ? 0 : at];
  if (!g) return null;
  return { x: g.at[0], y: g.at[1], z: g.at[2], tx: g.tangent[0], tz: g.tangent[1] };
}

export interface RoutePoint { x: number; y: number; z: number; tx: number; tz: number }

/** Elevation at route metres `s`, linear between the 25 m samples. */
export function routeElevation(def: Pick<RaceDef, 'elevation'>, s: number): number {
  const e = def.elevation;
  if (e.length === 0) return 0;
  const first = e[0] as { s: number; y: number };
  const last = e[e.length - 1] as { s: number; y: number };
  if (s <= first.s) return first.y;
  if (s >= last.s) return last.y;
  // elevation is sampled every 25 m from 0, so the index is direct; fall back to a scan for irregular data
  let i = Math.floor((s - first.s) / 25);
  if (i >= e.length - 1) i = e.length - 2;
  let a = e[i] as { s: number; y: number };
  while (i > 0 && a.s > s) a = e[--i] as { s: number; y: number };
  let b = e[i + 1] as { s: number; y: number };
  while (i < e.length - 2 && b.s < s) b = e[++i + 1] as { s: number; y: number };
  a = e[i] as { s: number; y: number };
  const span = b.s - a.s;
  return span > 0 ? a.y + ((b.y - a.y) * (s - a.s)) / span : a.y;
}

/** The centreline at route metres `s`: position, elevation and the unit travel direction. */
export function routePoint(def: Pick<RaceDef, 'line' | 'elevation' | 'routeLenM'>, s: number): RoutePoint {
  const pts = lineOf(def);
  const step = def.line.stepM;
  const n = pts.length / 2;
  const ss = s < 0 ? 0 : s > def.routeLenM ? def.routeLenM : s;
  let i = Math.floor(ss / step);
  if (i > n - 2) i = n - 2;
  if (i < 0) i = 0;
  const ax = pts[2 * i] as number;
  const az = pts[2 * i + 1] as number;
  const bx = pts[2 * i + 2] as number;
  const bz = pts[2 * i + 3] as number;
  const dx = bx - ax;
  const dz = bz - az;
  const l = dsqrt(dx * dx + dz * dz);
  const t = (ss - i * step) / step;
  const tt = t < 0 ? 0 : t > 1 ? 1 : t;
  return { x: ax + dx * tt, y: routeElevation(def, ss), z: az + dz * tt, tx: l > 0 ? dx / l : 0, tz: l > 0 ? dz / l : -1 };
}
