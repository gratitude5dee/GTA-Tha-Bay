import type { FeatureFlag } from '@dv/shared';
import type { Env } from '../env.ts';
import { parseFlags } from '../routes/boot.ts';
import { readFeatures, type KsRecord } from './admin.ts';

/**
 * Reads of the FLAGS namespace for the dialogue route (M06a3). KV is eventually consistent (60 s or more), so none of this is an atomic
 * switch: a kill that must stop a conversation now goes through `EncounterDO.kill` (route 46). These reads decide whether a new turn starts.
 */

/** The names (`ks:<name>`) of `candidates` that are in force: `on` and not expired. Reads only the named keys, in parallel. */
export async function activeKillSwitches(env: Pick<Env, 'FLAGS'>, candidates: readonly string[], nowMs: number): Promise<Set<string>> {
  const out = new Set<string>();
  const records = await Promise.all(
    candidates.map(async (name) => {
      try {
        return [name, await env.FLAGS.get<Partial<KsRecord>>(name, { type: 'json', cacheTtl: 30 })] as const;
      } catch {
        return [name, null] as const; // KV down: a switch that cannot be read is not in force; the governor and the quotas still hold
      }
    }),
  );
  for (const [name, rec] of records) {
    if (rec !== null && rec.on === true && (rec.expiresAt == null || rec.expiresAt > nowMs)) out.add(name);
  }
  return out;
}

/** The governor level published to KV `gov:level` by BudgetGovernorDO. 0 when absent or unreadable. */
export async function governorLevel(env: Pick<Env, 'FLAGS'>): Promise<0 | 1 | 2 | 3> {
  try {
    const rec = await env.FLAGS.get<{ level?: number }>('gov:level', { type: 'json', cacheTtl: 30 });
    const l = rec?.level;
    return l === 1 || l === 2 || l === 3 ? l : 0;
  } catch {
    return 0;
  }
}

/** A feature flag: the staff-set value in KV `flags:features` wins, else the FLAGS_JSON var, else the default (off). */
export async function featureOn(env: Pick<Env, 'FLAGS' | 'FLAGS_JSON'>, flag: FeatureFlag): Promise<boolean> {
  try {
    const kv = (await readFeatures(env))[flag];
    if (typeof kv === 'boolean') return kv;
  } catch {
    // fall through to the var
  }
  return parseFlags(env.FLAGS_JSON)[flag];
}
