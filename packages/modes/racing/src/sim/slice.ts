/**
 * `RacingSlice` (06-racing-data.md 4.4; M07a2): what the racing mode keeps in slot `mode:racing`. Its own wallet (`purseCents`) and
 * Rep, the best time and medals of each event, the best ghost of each event and the pursuit records. Pure functions over the slice;
 * the mode writes it only through `ctx.save.request` (C05), and the engine's capability check lets a standalone session write
 * `core`, `settings` and `mode:racing` only.
 *
 * `schema: 1` is an additive field against the spec text (BD-M07a2-04): every other slice carries its schema number inside.
 * Sim code under the C02 lint (no clock: the caller passes `nowMs`).
 */
import { canonicalize, DEFAULT_ASSIST, utf8Bytes, type AssistSettings, type Difficulty, type GhostEntry, type RaceId, type VehicleView } from '@dv/shared';

export const RACING_SLICE_MAX_BYTES = 1_572_864;
export const STALE_EVENT_MS = 60 * 24 * 3600 * 1000;

export interface EventRecord { bestMs?: number; bestScore?: number; medals: 0 | 1 | 2 | 3; plays: number; lastPlayed: number }

export interface RacingSlice {
  schema: 1;
  rep: number;
  purseCents: number;
  settings: { difficulty: Difficulty; assists: AssistSettings; units: 'kph' | 'mph'; vehicleView: VehicleView; hud: 'full' | 'minimal'; ghost: 'off' | 'best' | 'friend' };
  ladder: { beaten: string[]; current: number };
  events: Record<RaceId, EventRecord>;
  ghosts: Record<RaceId, GhostEntry>;
  pursuit: { bountyRecord: number; longestSec: number; evaded: number; busted: number };
  vehicleHeat: Record<string, number>;
  stats: { races: number; wins: number; distanceKm: number; driftScoreBest: number; airtimeBestSec: number; takedowns: number };
}

export function defaultRacingSlice(): RacingSlice {
  return {
    schema: 1,
    rep: 0,
    purseCents: 0,
    settings: { difficulty: 'normal', assists: { ...DEFAULT_ASSIST }, units: 'kph', vehicleView: 'chase-mid', hud: 'full', ghost: 'best' },
    ladder: { beaten: [], current: 10 },
    events: {},
    ghosts: {},
    pursuit: { bountyRecord: 0, longestSec: 0, evaded: 0, busted: 0 },
    vehicleHeat: {},
    stats: { races: 0, wins: 0, distanceKm: 0, driftScoreBest: 0, airtimeBestSec: 0, takedowns: 0 },
  };
}

/** A slice read from a save, or the default when it is empty or from the future. Missing fields take their default. */
export function readRacingSlice(raw: unknown): RacingSlice {
  const d = defaultRacingSlice();
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return d;
  const r = raw as Partial<RacingSlice>;
  if (r.schema !== 1) return d;
  return {
    ...d, ...r,
    settings: { ...d.settings, ...(r.settings ?? {}) },
    ladder: { ...d.ladder, ...(r.ladder ?? {}) },
    pursuit: { ...d.pursuit, ...(r.pursuit ?? {}) },
    stats: { ...d.stats, ...(r.stats ?? {}) },
    events: { ...(r.events ?? {}) },
    ghosts: { ...(r.ghosts ?? {}) },
    vehicleHeat: { ...(r.vehicleHeat ?? {}) },
  };
}

export const sliceBytes = (s: RacingSlice): number => utf8Bytes(canonicalize(s)).length;

/**
 * Brings the slice under `RACING_SLICE_MAX_BYTES`: the oldest ghost goes first; when no ghost is left, the records of events not
 * played in 60 days go, oldest first. Returns the ids evicted in order.
 */
export function evictToFit(s: RacingSlice, nowMs: number, cap: number = RACING_SLICE_MAX_BYTES): string[] {
  const out: string[] = [];
  while (sliceBytes(s) > cap) {
    const ghosts = Object.entries(s.ghosts).sort((a, b) => a[1].savedAt - b[1].savedAt || (a[0] < b[0] ? -1 : 1));
    if (ghosts.length > 0) {
      const id = (ghosts[0] as [string, GhostEntry])[0];
      delete s.ghosts[id];
      out.push(`ghost:${id}`);
      continue;
    }
    const stale = Object.entries(s.events)
      .filter(([, e]) => nowMs - e.lastPlayed > STALE_EVENT_MS)
      .sort((a, b) => a[1].lastPlayed - b[1].lastPlayed || (a[0] < b[0] ? -1 : 1));
    if (stale.length === 0) break;
    const id = (stale[0] as [string, EventRecord])[0];
    delete s.events[id];
    out.push(`event:${id}`);
  }
  return out;
}

export interface RunRecord {
  raceId: RaceId;
  kind: string;
  outcome: 'finish' | 'dnf';
  ms: number;
  place: number;
  medals: 0 | 1 | 2 | 3;
  rep: number;
  cashCents: number;
  /** The run wins a slot: a canonical standalone run of a timed event. */
  ghost: GhostEntry | null;
  pursuit?: { evaded: boolean; busted: boolean; bountyPoints: number; seconds: number; takedowns: number };
  distanceM?: number;
}

/** Folds one finished run into the slice: records, medals, wallet, Rep, stats, and the best ghost. */
export function applyRun(s: RacingSlice, r: RunRecord, nowMs: number): { newBest: boolean; evicted: string[] } {
  const prev = s.events[r.raceId];
  const ev: EventRecord = prev ?? { medals: 0, plays: 0, lastPlayed: nowMs };
  ev.plays++;
  ev.lastPlayed = nowMs;
  let newBest = false;
  if (r.outcome === 'finish') {
    if (ev.bestMs === undefined || r.ms < ev.bestMs) {
      ev.bestMs = r.ms;
      newBest = true;
    }
    if (r.medals > ev.medals) ev.medals = r.medals;
  }
  s.events[r.raceId] = ev;
  s.rep += r.rep;
  s.purseCents = Math.max(0, s.purseCents + r.cashCents);
  s.stats.races++;
  if (r.outcome === 'finish' && r.place === 1) s.stats.wins++;
  if (r.distanceM) s.stats.distanceKm = Math.round((s.stats.distanceKm + r.distanceM / 1000) * 1000) / 1000;
  if (r.pursuit) {
    if (r.pursuit.evaded) s.pursuit.evaded++;
    if (r.pursuit.busted) s.pursuit.busted++;
    if (r.pursuit.bountyPoints > s.pursuit.bountyRecord) s.pursuit.bountyRecord = r.pursuit.bountyPoints;
    if (r.pursuit.seconds > s.pursuit.longestSec) s.pursuit.longestSec = r.pursuit.seconds;
    s.stats.takedowns += r.pursuit.takedowns;
  }
  if (r.ghost && newBest) s.ghosts[r.raceId] = r.ghost;
  return { newBest, evicted: evictToFit(s, nowMs) };
}
