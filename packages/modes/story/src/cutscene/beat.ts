/**
 * Beat locks (spec/domains/03-story-cutscenes.md section D3.4, M05b2). `content/cutscenes/beats.lock.json` stores, per story
 * cutscene ref, `sha256(canonicalize({slots, cues}))` and the beat revision `rev`. The revision is the `@<rev>` suffix of the ref's
 * `stage` (`beat.<refId>@<rev>`), which is part of the cache key, so an edit to the beat text can never ship under an old key:
 * `missions:build` and the index builder fail when slots or cues changed and the revision did not.
 * Pure: the build tools read and write the file.
 */
import type { CutsceneRef } from '@dv/shared/contracts/c09-cutscene';
import { canonicalize, sha256Hex } from '@dv/shared';

export const BEATS_LOCK_SCHEMA = 'beats-lock/1';

export interface BeatLockEntry {
  rev: number;
  sha256: string;
}
export interface BeatsLock {
  schema: typeof BEATS_LOCK_SCHEMA;
  beats: Record<string, BeatLockEntry>;
}

export const emptyBeatsLock = (): BeatsLock => ({ schema: BEATS_LOCK_SCHEMA, beats: {} });

/** The hash of what a beat says: the authored slots and the cues. */
export function beatDigest(ref: Pick<CutsceneRef, 'slots' | 'cues'>): string {
  return sha256Hex(canonicalize({ slots: ref.slots, cues: ref.cues }));
}

/** The revision in `beat.<refId>@<rev>`; null when the stage is not a beat stage of this ref. */
export function beatRev(ref: Pick<CutsceneRef, 'id' | 'stage'>): number | null {
  const m = /^beat\.(.+)@(\d+)$/.exec(ref.stage ?? '');
  if (!m || m[1] !== ref.id) return null;
  return Number(m[2]);
}

/** Refs that belong to the lock: story refs (their stage is a beat stage). */
export const isStoryRef = (ref: Pick<CutsceneRef, 'hook'>): boolean => ref.hook === 'story.beat' || ref.hook === 'story.establish';

export interface BeatLockProblem {
  ref: string;
  message: string;
}

/** The problems of `refs` against `lock`; empty when every story ref matches its lock entry. */
export function checkBeatsLock(refs: readonly CutsceneRef[], lock: BeatsLock): BeatLockProblem[] {
  const out: BeatLockProblem[] = [];
  for (const ref of refs) {
    if (!isStoryRef(ref)) continue;
    const rev = beatRev(ref);
    if (rev === null) {
      out.push({ ref: ref.id, message: `stage must be beat.${ref.id}@<rev>` });
      continue;
    }
    const entry = lock.beats[ref.id];
    if (!entry) {
      out.push({ ref: ref.id, message: 'is not in content/cutscenes/beats.lock.json (run: pnpm assets:cutscene-index -- --update-lock)' });
      continue;
    }
    const sha = beatDigest(ref);
    if (sha === entry.sha256 && rev === entry.rev) continue;
    if (sha !== entry.sha256 && rev === entry.rev) {
      out.push({ ref: ref.id, message: `slots or cues changed without a rev bump (rev ${rev}); bump the @rev of its stage` });
    } else if (rev < entry.rev) {
      out.push({ ref: ref.id, message: `rev ${rev} is behind the lock (rev ${entry.rev})` });
    } else {
      out.push({ ref: ref.id, message: `rev ${rev} is not locked yet (lock has ${entry.rev}); run: pnpm assets:cutscene-index -- --update-lock` });
    }
  }
  for (const id of Object.keys(lock.beats).sort()) {
    if (!refs.some((r) => r.id === id)) out.push({ ref: id, message: 'is in beats.lock.json but no ref has this id (remove the lock entry)' });
  }
  return out;
}

/** The lock for `refs` after a deliberate update: refuses (returns the problems) when a ref changed without a rev bump. */
export function updateBeatsLock(refs: readonly CutsceneRef[], lock: BeatsLock): { lock: BeatsLock; problems: BeatLockProblem[] } {
  const problems: BeatLockProblem[] = [];
  const beats: Record<string, BeatLockEntry> = {};
  for (const ref of [...refs].filter(isStoryRef).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const rev = beatRev(ref);
    if (rev === null) {
      problems.push({ ref: ref.id, message: `stage must be beat.${ref.id}@<rev>` });
      continue;
    }
    const sha256 = beatDigest(ref);
    const old = lock.beats[ref.id];
    if (old && old.sha256 !== sha256 && old.rev === rev) {
      problems.push({ ref: ref.id, message: `slots or cues changed without a rev bump (rev ${rev}); bump the @rev of its stage` });
      continue;
    }
    if (old && rev < old.rev) {
      problems.push({ ref: ref.id, message: `rev ${rev} is behind the lock (rev ${old.rev})` });
      continue;
    }
    beats[ref.id] = { rev, sha256 };
  }
  return { lock: { schema: BEATS_LOCK_SCHEMA, beats }, problems };
}
