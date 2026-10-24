import { NPC_GUARDRAILS, type KillScope, type RosterFlags } from '@dv/shared';
import type { AppDeps } from '../deps.ts';
import type { Env } from '../env.ts';

/**
 * The roster kill-switch state (R-NPC-04, D-29, DL-557). The live source is the Postgres table `roster_flag`, read through a 10 s in-memory
 * isolate cache, so Postgres sees at most one read per isolate per 10 s. KV `roster:flags` (the copy route 46 writes) is only the fallback when
 * that read fails: KV can lag 60 s or more, so it is never on the live path. An open conversation is stopped by the DO broadcast
 * (`EncounterDO.indexKill`), not by this file. Bound for removal from any location: 10 s cache + 30 s client poll + one request <= 45 s.
 */
export const KV_KEY = 'roster:flags';
const CACHE_MS = NPC_GUARDRAILS.roster.isolateCacheMs;

export type RosterSource = 'postgres' | 'kv' | 'none';
export interface RosterRead {
  flags: RosterFlags;
  source: RosterSource;
}

interface Cached {
  at: number;
  read: RosterRead;
}
let cached: Cached | null = null;
let lastKvLog = -Infinity;

/** Drops this isolate's cache (route 46 does it right after a kill; tests do it between cases). */
export function dropRosterCache(): void {
  cached = null;
  lastKvLog = -Infinity;
}

const EMPTY: RosterFlags = { etag: '0', killed: {}, updatedAt: 0 };

async function kvCopy(env: Env): Promise<RosterFlags | null> {
  try {
    const raw = await env.FLAGS.get(KV_KEY, { type: 'json' });
    if (raw !== null && typeof raw === 'object' && typeof (raw as RosterFlags).etag === 'string' && typeof (raw as RosterFlags).killed === 'object') return raw as RosterFlags;
  } catch {
    // KV unavailable too: handled by the caller
  }
  return null;
}

/**
 * The current flags. Throws only when a database is configured, its read failed and KV holds no copy: the caller answers 503 rather than
 * show an empty list that would un-kill every NPC. With no database configured at all (local runs, Previews) the KV copy or an empty list is served.
 */
export async function readRoster(env: Env, deps: Pick<AppDeps, 'data' | 'now' | 'log'>): Promise<RosterRead> {
  const t = deps.now();
  if (cached !== null && t - cached.at < CACHE_MS && t >= cached.at) return cached.read;
  const port = deps.data(env);
  let read: RosterRead;
  if (port === null) {
    const kv = await kvCopy(env);
    read = { flags: kv ?? EMPTY, source: kv === null ? 'none' : 'kv' };
  } else {
    try {
      read = { flags: await port.roster.flags(), source: 'postgres' };
    } catch (e) {
      const kv = await kvCopy(env);
      if (kv === null) throw e;
      read = { flags: kv, source: 'kv' };
      // The window in which a removal can lag 60 s or more is logged (named in the M10b drill report).
      if (t - lastKvLog > 60_000) {
        lastKvLog = t;
        deps.log(JSON.stringify({ event: 'roster.source', source: 'kv' }));
      }
    }
  }
  cached = { at: t, read };
  return read;
}

/** True when the NPC is killed for `scope` ('all' kills every scope). Same source and cache as route 30. */
export async function isKilled(env: Env, deps: Pick<AppDeps, 'data' | 'now' | 'log'>, npcId: string, scope: KillScope = 'all'): Promise<boolean> {
  const entry = (await readRoster(env, deps)).flags.killed[npcId];
  return entry !== undefined && (entry.scope.includes('all') || entry.scope.includes(scope));
}

/** Writes the KV fallback copy of the current flags (route 46). */
export async function writeKvCopy(env: Env, flags: RosterFlags): Promise<void> {
  await env.FLAGS.put(KV_KEY, JSON.stringify(flags));
}
