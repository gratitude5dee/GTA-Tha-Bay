/**
 * The world release of M02c2 (DL-670, DL-688, DL-695): which environment serves the real `sf` world, and what `deploy:prod` checks
 * before it ships one. Pure over an injected file reader and writer, so the unit tests run it on a fixture tree.
 *
 * Environment names (DL-661): release key `staging` is `deploy:prod -- --env staging`, `assets:publish -- --env staging` and
 * `assets/world/pointer.staging.json`; release key `production` is `deploy:prod` with no `--env`, `assets:publish -- --env prod`
 * and `assets/world/pointer.production.json`. No command takes `--env production`.
 */
import { createHash } from 'node:crypto';
import { odblOffer, type OdblAttributionInput, type OdblCreditsInput } from './odbl-offer.ts';

export type ReleaseKey = 'staging' | 'production';

/** An absent `--env` is the production Worker. */
export const releaseKeyOf = (env: string | undefined): ReleaseKey => (env === 'staging' ? 'staging' : 'production');

export const RELEASE_FILE = 'config/world/release.json';
export const POINTER_WEB = 'apps/web/public/asset-catalog.json';
export const POINTER_EDGE = 'services/edge/src/generated/asset-catalog.json';
export const ASSETS_LOCK = 'assets/assets.lock.json';
export const WORLD_LOCK = 'assets/world/sf.lock.json';
export const pointerFile = (key: ReleaseKey): string => `assets/world/pointer.${key}.json`;
export const metaFile = (key: ReleaseKey): string => `assets/world/pointer.${key}.meta.json`;

export interface ReleaseIo {
  /** Text of a repo-relative file, or null when it does not exist. */
  read(rel: string): string | null;
  write(rel: string, text: string): void;
}

export interface ReleaseFile {
  schema: 'world-release/1';
  staging: 'sf' | null;
  production: 'sf' | null;
}

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

export function readRelease(io: ReleaseIo): ReleaseFile | { error: string } {
  const text = io.read(RELEASE_FILE);
  if (text === null) return { schema: 'world-release/1', staging: null, production: null };
  try {
    const v = JSON.parse(text) as Partial<ReleaseFile>;
    const ok = (x: unknown): x is 'sf' | null => x === null || x === 'sf';
    if (v.schema !== 'world-release/1' || !ok(v.staging) || !ok(v.production)) return { error: `${RELEASE_FILE} is not a world-release/1 file` };
    return { schema: 'world-release/1', staging: v.staging, production: v.production };
  } catch (e) {
    return { error: `${RELEASE_FILE}: ${(e as Error).message}` };
  }
}

/** Whether `release.json` names `sf` for the key. */
export function releaseNamesSf(io: ReleaseIo, key: ReleaseKey): boolean {
  const r = readRelease(io);
  return !('error' in r) && r[key] === 'sf';
}

interface PointerMeta {
  schema?: string;
  assetsLockSha256?: string;
  worldLockSha256?: string;
  /** SHA-256 of the `data/world-index` blob the pointer's catalog holds (additive to the DL-688 shape). */
  worldIndexSha256?: string;
}

function readMeta(io: ReleaseIo, key: ReleaseKey): PointerMeta | null {
  const t = io.read(metaFile(key));
  if (t === null) return null;
  try {
    return JSON.parse(t) as PointerMeta;
  } catch {
    return null;
  }
}

/** The SHA-256 the world lock gives `data/world-index`, or null when the lock is missing or has no such entry. */
export function worldIndexSha(io: ReleaseIo): string | null {
  const t = io.read(WORLD_LOCK);
  if (t === null) return null;
  try {
    const lock = JSON.parse(t) as { entries?: Record<string, { variants?: { default?: string } }> };
    return lock.entries?.['data/world-index']?.variants?.default ?? null;
  } catch {
    return null;
  }
}

/** The stale-lock message of DL-688, or null when the pointer was built from the locks of this checkout. */
export function staleLockMessage(io: ReleaseIo, key: ReleaseKey): string | null {
  const metaText = io.read(metaFile(key));
  if (metaText === null) return null;
  let meta: PointerMeta;
  try {
    meta = JSON.parse(metaText) as PointerMeta;
  } catch {
    return `world release ${key}: ${metaFile(key)} is not JSON; re-run assets:publish --world`;
  }
  const a = io.read(ASSETS_LOCK), w = io.read(WORLD_LOCK);
  const curA = a === null ? '' : sha256(a), curW = w === null ? '' : sha256(w);
  if ((meta.assetsLockSha256 ?? '') === curA && (meta.worldLockSha256 ?? '') === curW) return null;
  const was = `${(meta.assetsLockSha256 ?? '').slice(0, 12)}+${(meta.worldLockSha256 ?? '').slice(0, 12)}`;
  const now = `${curA.slice(0, 12)}+${curW.slice(0, 12)}`;
  return `world release ${key}: pointer built from lock ${was}, current lock ${now}; re-run assets:publish --world`;
}

/**
 * Before the build step: when `release.json` names `sf` for the key, checks the pointer and swaps it over both pointer files of
 * the deploy checkout (never committed). Returns the failure message or null.
 */
export function prepareWorldRelease(io: ReleaseIo, key: ReleaseKey, log: (l: string) => void = () => undefined): string | null {
  const rel = readRelease(io);
  if ('error' in rel) return `world release ${key}: ${rel.error}`;
  if (rel[key] !== 'sf') return null;
  const pointer = io.read(pointerFile(key));
  const fail = `world release ${key}: pointer missing or without data/world-index`;
  if (pointer === null) return fail;
  // the pointer names the merged manifest by key and hash; the world index is proven by the world lock and the meta file that
  // assets:publish --world wrote beside the pointer (the SHA-256 of the data/world-index blob it merged)
  let parsed: { key?: string; sha256?: string };
  try {
    parsed = JSON.parse(pointer) as typeof parsed;
  } catch {
    return fail;
  }
  if (typeof parsed.key !== 'string' || typeof parsed.sha256 !== 'string') return fail;
  const worldIndex = worldIndexSha(io);
  if (worldIndex === null) return fail;
  const meta = readMeta(io, key);
  if (meta === null || meta.worldIndexSha256 !== worldIndex) return fail;
  const stale = staleLockMessage(io, key);
  if (stale) return stale;
  io.write(POINTER_WEB, pointer);
  io.write(POINTER_EDGE, pointer);
  log(`world release ${key}: ${pointerFile(key)} replaces the committed pointers in this checkout`);
  return null;
}

/** After the build step: the ODbL offer must be in the attribution and in the built credits (DL-695). Returns the failure message or null. */
export function checkOdblOffer(io: ReleaseIo, key: ReleaseKey, creditsRel: string): string | null {
  if (!releaseNamesSf(io, key)) return null;
  const parse = <T>(rel: string): T | null => {
    const t = io.read(rel);
    if (t === null) return null;
    try {
      return JSON.parse(t) as T;
    } catch {
      return null;
    }
  };
  const r = odblOffer({ attribution: parse<OdblAttributionInput>('config/attribution.world.json'), credits: parse<OdblCreditsInput>(creditsRel) });
  return r.status === 'pass' ? null : `world release ${key}: ODbL offer missing (${r.evidence})`;
}
