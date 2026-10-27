/**
 * The client side of the leaderboard (06-racing-data.md 4.3; M07a2): `buildScoreSubmit` makes the route 21 request body of a
 * finished run, `LeaderboardPort` is the seam the transport arrives through (M12c) and the validator behind it (M12e, DL-183). The
 * only adapter today is the null one, which sends nothing.
 */
import { replaySha256, toBase64, type RaceDef, type ScoreRow, type ScoreSubmit } from '@dv/shared';
import type { RecordedRun } from './sim/recorder.ts';

export interface LeaderboardPort {
  /** Sends a submission; 'unavailable' when there is no transport. */
  submit(s: ScoreSubmit): Promise<'sent' | 'unavailable'>;
  top(board: string, limit: number): Promise<ScoreRow[]>;
}

/** The adapter until M12c: nothing is sent and no row is known. */
export const nullLeaderboard: LeaderboardPort = {
  submit: () => Promise.resolve('unavailable'),
  top: () => Promise.resolve([]),
};

/** The board of a timed event. */
export const timeBoard = (raceId: string): string => `racing.${raceId}.time`;

/**
 * The submission of a finished canonical run, or null when the run cannot be verified: it did not finish, or its inputs did not
 * fit the replay cap (a track-only replay has no leaderboard value).
 */
export function buildScoreSubmit(def: Pick<RaceDef, 'id' | 'version' | 'worldBake'>, run: RecordedRun, ms: number, handlingRev: number, buildId: string): ScoreSubmit | null {
  const h = run.header;
  if (h.finishTick === null || !run.hasInputs || h.profile !== 'canonical') return null;
  return {
    board: timeBoard(def.id),
    value: ms,
    raceId: def.id,
    raceVersion: def.version,
    worldBake: def.worldBake,
    buildId,
    vehicleDef: h.vehicleDef,
    handlingRev,
    gateTicks: h.gateTicks,
    replayB64: toBase64(run.bytes),
    replaySha256: replaySha256(run.bytes),
  };
}
