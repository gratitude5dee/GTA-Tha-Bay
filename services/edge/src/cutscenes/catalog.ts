import catalog from '../generated/cutscene-catalog.json';
import type { AppDeps } from '../deps.ts';
import type { Env } from '../env.ts';

const KEYS: ReadonlySet<string> = new Set(catalog.keys);

export const CUTSCENE_KEY = /^[0-9a-f]{64}$/;

/** The static gate used when no database is configured: the keys of the shipped index plus, in test builds, `CUTSCENE_CATALOG_EXTRA`. */
export function staticInCatalog(env: Pick<Env, 'CUTSCENE_CATALOG_EXTRA'>, key: string): boolean {
  if (KEYS.has(key)) return true;
  // Dead code in the production bundle (`__DV_TEST_ROUTES__` is false there).
  if (__DV_TEST_ROUTES__ && typeof env.CUTSCENE_CATALOG_EXTRA === 'string') return env.CUTSCENE_CATALOG_EXTRA.split(',').includes(key);
  return false;
}

/** 'down' means the database was configured but the call failed: callers fall back to the R2 ready test and never start generation. */
export type CatalogAnswer = 'yes' | 'no' | 'down';

/**
 * Generation never starts outside the catalog (route 27). The catalog is the `cutscene_catalog` table (M05d) behind `DataPort.cutscenes.inCatalog`;
 * a Worker with no database configured (unit tests, previews, local dev) uses the static key list of the shipped index instead.
 */
export async function inCatalog(env: Env, deps: Pick<AppDeps, 'data'>, key: string): Promise<CatalogAnswer> {
  const port = deps.data(env);
  if (port === null) return staticInCatalog(env, key) ? 'yes' : 'no';
  try {
    return (await port.cutscenes.inCatalog(key)) ? 'yes' : 'no';
  } catch {
    return 'down';
  }
}
