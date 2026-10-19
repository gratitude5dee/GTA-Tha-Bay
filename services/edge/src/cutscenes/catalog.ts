import catalog from '../generated/cutscene-catalog.json';
import type { Env } from '../env.ts';

const KEYS: ReadonlySet<string> = new Set(catalog.keys);

export const CUTSCENE_KEY = /^[0-9a-f]{64}$/;

/**
 * Generation never starts outside the catalog (route 27). Until M05d this is a static file of keys. Test builds may add keys
 * through `CUTSCENE_CATALOG_EXTRA`; that branch is dead code in the production bundle (`__DV_TEST_ROUTES__` is false there).
 */
export function inCatalog(env: Pick<Env, 'CUTSCENE_CATALOG_EXTRA'>, key: string): boolean {
  if (KEYS.has(key)) return true;
  if (__DV_TEST_ROUTES__ && typeof env.CUTSCENE_CATALOG_EXTRA === 'string') return env.CUTSCENE_CATALOG_EXTRA.split(',').includes(key);
  return false;
}
