/**
 * `TycoonSlice` schema 1 (08-tycoon.md section 4.6) and the load path.
 * A run is saved as `(setup, choices)` plus a snapshot of the state with its hash. On load the choices are replayed and the hash is
 * compared with the snapshot; when the content or balance version differs, or the hash does not match, the snapshot is used and the
 * run is marked `unverifiable` (BD-M09a1-08: an optional `unverifiable` flag on `active`). A player's run is never discarded.
 */
import { hashCompany, replay, type ChoiceRecord, type CompanyState, type RunResult, type RunSetup, type SectorId, type TycoonContent } from '@dv/shared/tycoon';
import type { JsonObject } from '@dv/shared';

export interface TycoonSlice {
  schema: 1;
  contentVersion: string;
  balanceVersion: string;
  active: { setup: RunSetup; choices: ChoiceRecord[]; snapshot: { week: number; state: CompanyState; hash: string } | null; unverifiable?: boolean } | null;
  runs: { setup: RunSetup; result: RunResult; savedAt: number }[];
  bestScores: Record<'acq' | 'unicorn' | 'ipo' | 'ramen', number>;
  unlockedSectors: SectorId[];
  hardcore: boolean;
  dividendEarnedCents: number;
}

export const MAX_RUN_HISTORY = 20;
export const SLICE_MAX_BYTES = 100 * 1024;
/** A winning standalone run adds 0.02 % of the founder payout, capped at $10,000 per run (08-tycoon.md section 5.11). */
export const DIVIDEND_CAP_CENTS = 1_000_000;

export function emptySlice(c: TycoonContent): TycoonSlice {
  return {
    schema: 1,
    contentVersion: c.contentVersion,
    balanceVersion: c.balanceVersion,
    active: null,
    runs: [],
    bestScores: { acq: 0, unicorn: 0, ipo: 0, ramen: 0 },
    unlockedSectors: ['b2b-saas'],
    hardcore: false,
    dividendEarnedCents: 0,
  };
}

export const sliceToJson = (s: TycoonSlice): JsonObject => s as unknown as JsonObject;

/** Accepts the stored JSON as a slice; fills anything missing from the empty slice so an older partial record still loads. */
export function sliceFromJson(raw: JsonObject | null, c: TycoonContent): TycoonSlice {
  if (raw === null) return emptySlice(c);
  const base = emptySlice(c);
  const r = raw as unknown as Partial<TycoonSlice>;
  return {
    schema: 1,
    contentVersion: typeof r.contentVersion === 'string' ? r.contentVersion : base.contentVersion,
    balanceVersion: typeof r.balanceVersion === 'string' ? r.balanceVersion : base.balanceVersion,
    active: r.active ?? null,
    runs: Array.isArray(r.runs) ? r.runs : [],
    bestScores: { ...base.bestScores, ...(r.bestScores ?? {}) },
    unlockedSectors: Array.isArray(r.unlockedSectors) ? r.unlockedSectors : base.unlockedSectors,
    hardcore: r.hardcore === true,
    dividendEarnedCents: typeof r.dividendEarnedCents === 'number' ? r.dividendEarnedCents : 0,
  };
}

export interface RestoredRun {
  state: CompanyState;
  setup: RunSetup;
  choices: ChoiceRecord[];
  /** True when the replay did not reproduce the snapshot or the versions differ. */
  unverifiable: boolean;
  /** 'replay' = the replayed state was used (hash matched the snapshot); 'snapshot' = the stored snapshot was used. */
  source: 'replay' | 'snapshot';
}

/** The load path of section 4.6.2. Returns null when the slice has no active run. */
export function restoreRun(slice: TycoonSlice, c: TycoonContent): RestoredRun | null {
  const a = slice.active;
  if (a === null) return null;
  const sameVersions = slice.contentVersion === c.contentVersion && slice.balanceVersion === c.balanceVersion && a.setup.contentVersion === c.contentVersion && a.setup.balanceVersion === c.balanceVersion;
  if (sameVersions) {
    try {
      const snap = a.snapshot;
      const out = replay(a.setup, a.choices, c, snap ? snap.week : undefined);
      if (snap === null || hashCompany(out.state) === snap.hash) {
        return { state: out.state, setup: a.setup, choices: a.choices, unverifiable: a.unverifiable === true, source: 'replay' };
      }
    } catch {
      // fall through to the snapshot
    }
  }
  if (a.snapshot) return { state: a.snapshot.state, setup: a.setup, choices: a.choices, unverifiable: true, source: 'snapshot' };
  // Nothing to fall back on (no snapshot and a replay that failed): start the run again from its setup.
  return { state: replay(a.setup, [], c).state, setup: a.setup, choices: [], unverifiable: true, source: 'snapshot' };
}

/** Bytes of the canonical JSON of the slice, for the 100 KB budget. */
export function sliceBytes(s: TycoonSlice): number {
  return new TextEncoder().encode(JSON.stringify(s)).length;
}
