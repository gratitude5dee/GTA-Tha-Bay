/**
 * The index carry-over rule (spec/domains/03-story-cutscenes.md section D3, 05-assets-pipeline.md section 13): a deliberate
 * endpoint re-pin or provider switch must not orphan a shipped clip. For each ref the builder computes the desired key.
 *   1. The desired key is ready (manifest HEAD through a ReadyPort; offline means not ready): use it.
 *   2. Else the previous release's key for the same ref stays, marked `stale: true`, when it is still valid: the same
 *      characters at the same `soulVersion` and tier, no kill, and a provider that is not delisted.
 *   3. Else the desired key; the clip plays its fallback until prewarm completes.
 * Pure over its inputs.
 */
import type { CutsceneIndexEntry } from '../../../packages/shared/src/contracts/c09-cutscene.ts';
import type { VideoProviderEntry } from '../../../packages/shared/src/genai/registry.ts';

/** `has(key)`: the clip's `manifest.json` exists. Offline: always false. */
export interface ReadyPort {
  has(key: string): Promise<boolean>;
}

export const offlineReady: ReadyPort = { has: () => Promise.resolve(false) };

/** A provider is delisted when the registry no longer has it or marks it blocked. */
export function delisted(providers: Readonly<Record<string, Pick<VideoProviderEntry, 'licence'>>>, key: string): boolean {
  const p = providers[key];
  return p === undefined || p.licence.status === 'blocked';
}

const sameCast = (a: CutsceneIndexEntry['characters'], b: CutsceneIndexEntry['characters']): boolean =>
  a.length === b.length && a.every((c, i) => c.id === b[i]?.id && c.soulVersion === b[i]?.soulVersion && c.tier === b[i]?.tier);

/** True when the previous entry may still be shown for the ref whose desired entry is `desired`. */
export function previousStillValid(
  prev: CutsceneIndexEntry,
  desired: Pick<CutsceneIndexEntry, 'characters'>,
  opts: { killed: boolean; providers: Readonly<Record<string, Pick<VideoProviderEntry, 'licence'>>> },
): boolean {
  return !opts.killed && !delisted(opts.providers, prev.provider) && sameCast(prev.characters, desired.characters);
}

export interface CarryResult {
  entry: CutsceneIndexEntry;
  /** True when the previous release's key was kept. */
  carried: boolean;
}

export async function carryOver(
  desired: CutsceneIndexEntry,
  prev: CutsceneIndexEntry | undefined,
  ready: ReadyPort,
  opts: { killed: boolean; providers: Readonly<Record<string, Pick<VideoProviderEntry, 'licence'>>> },
): Promise<CarryResult> {
  if (await ready.has(desired.key)) return { entry: desired, carried: false };
  if (prev && prev.key !== desired.key && previousStillValid(prev, desired, opts)) {
    // The previous clip with the current cues and fallback: the key, its input, its provider and its length are the old ones.
    return { entry: { ...desired, key: prev.key, keyInput: prev.keyInput, provider: prev.provider, durationMs: prev.durationMs, stale: true }, carried: true };
  }
  return { entry: desired, carried: false };
}
