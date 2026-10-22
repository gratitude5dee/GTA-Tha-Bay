/**
 * Ref resolution of the CutscenePlayer (spec/domains/03-story-cutscenes.md section D7, step 2): a CutsceneRef id goes through the
 * shipped index, the roster flags, the settings, route 27 and the manifest, and ends in either a playable clip description or the
 * fallback trigger that explains why not. Never throws: every failure is a trigger.
 */
import type { CutsceneStatus } from '@dv/shared';
import type { CutsceneIndex, CutsceneIndexEntry, CutsceneManifest, CutsceneRefId, FallbackTrigger } from '@dv/shared/contracts/c09-cutscene';
import { baseOf } from './hosts.ts';
import type { CutsceneConfig, Timers } from './triggers.ts';

export interface ResolveDeps {
  /** The shipped `data/cutscene-index`; null until it is loaded. */
  index(): CutsceneIndex | null;
  /** True when a cast member of the entry is killed for cutscenes (`RosterFlags` scope `cutscene` or `all`). */
  suppressed(characters: readonly { id: string }[]): boolean;
  /** `ProfileSettings.cutscenes`: `generated` is the "Generated cutscenes" switch. */
  settings(): { generated: boolean };
  /** The boot flag `cutscene.generated` (kill switch of the platform flags). */
  bootEnabled(): boolean;
  online(): boolean;
  /** Route 27; null when the request failed. */
  status(key: string): Promise<CutsceneStatus | null>;
  /** The manifest at `url`; null on a 404, a network error or malformed JSON. */
  fetchManifest(url: string): Promise<CutsceneManifest | null>;
  timers: Timers;
  cfg: CutsceneConfig;
  /** False in QA builds that serve the fixture clips under any key; production requires `manifest.key` to equal the entry key. */
  strictKey?: boolean;
}

export interface Resolved {
  ok: true;
  ref: CutsceneRefId;
  entry: CutsceneIndexEntry;
  manifest: CutsceneManifest;
  manifestUrl: string;
  /** Directory of the manifest, with a trailing slash. */
  base: string;
  /** The result came from `prefetch`. */
  prefetched: boolean;
}
export interface Unresolved {
  ok: false;
  trigger: FallbackTrigger;
  /** The index entry, when there was one (its cues feed the fallback subtitles). */
  entry?: CutsceneIndexEntry;
}
export type Resolution = Resolved | Unresolved;

const fail = (trigger: FallbackTrigger, entry?: CutsceneIndexEntry): Unresolved => ({ ok: false, trigger, ...(entry ? { entry } : {}) });

/** A promise that settles to `onTimeout` when `ms` pass first. */
export function within<T>(p: Promise<T>, ms: number, timers: Timers, onTimeout: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const h = timers.setTimeout(() => resolve(onTimeout), ms);
    p.then(
      (v) => {
        timers.clearTimeout(h);
        resolve(v);
      },
      () => {
        timers.clearTimeout(h);
        resolve(onTimeout);
      },
    );
  });
}

export function entryOf(deps: Pick<ResolveDeps, 'index'>, ref: CutsceneRefId): CutsceneIndexEntry | undefined {
  return deps.index()?.entries.find((e) => e.ref === ref);
}

/** The checks that need no network, in the order of section D7: setting, boot flag, entry, roster kill, offline. */
export function precheck(deps: ResolveDeps, ref: CutsceneRefId): Unresolved | { ok: true; entry: CutsceneIndexEntry } {
  const entry = entryOf(deps, ref);
  if (!deps.settings().generated) return fail('setting_off', entry);
  if (!deps.bootEnabled()) return fail('policy', entry);
  if (!entry) return fail('not_ready');
  if (deps.suppressed(entry.characters)) return fail('policy', entry);
  if (!deps.online()) return fail('offline', entry);
  return { ok: true, entry };
}

/** Index entry, flags, route 27 and the manifest of one ref. */
export async function resolveRef(deps: ResolveDeps, ref: CutsceneRefId, prefetched = false): Promise<Resolution> {
  const pre = precheck(deps, ref);
  if (!pre.ok) return pre;
  const { entry } = pre;
  try {
    const status = await within(deps.status(entry.key), deps.cfg.manifestTimeoutMs, deps.timers, null);
    if (status === null) return fail(deps.online() ? 'not_ready' : 'offline', entry);
    if (status.state === 'blocked') return fail('policy', entry);
    if (status.state !== 'ready' || !status.manifestUrl) return fail('not_ready', entry);
    const manifest = await within(deps.fetchManifest(status.manifestUrl), deps.cfg.manifestTimeoutMs, deps.timers, null);
    if (manifest === null || manifest.schema !== 'cutscene-asset/1' || (deps.strictKey !== false && manifest.key !== entry.key)) return fail('not_ready', entry);
    return { ok: true, ref, entry, manifest, manifestUrl: status.manifestUrl, base: baseOf(status.manifestUrl), prefetched };
  } catch {
    return fail('not_ready', entry);
  }
}
