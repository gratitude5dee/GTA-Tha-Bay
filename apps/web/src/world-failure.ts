/**
 * The world-load error of the shell (BD-FU-A02): turns what the boot learnt about the asset catalog and the world index into the detail
 * code of the `world-load` error page, or null when the world can boot or the failure is the offline path.
 *
 * Only the default boot rule (no `?world=` flag) asks: an explicit QA scenario never reads the catalog's world. A failure counts when the
 * fetch layer's retry policy has run out (M01e): the media host answered an HTTP error (a deploy whose catalog `pnpm assets:publish`
 * never uploaded answers 404), or a network error while the browser says it is online. A network error while the browser says it is
 * offline is the offline relaunch path, which M11a2 owns, and keeps the boot as it was. A `disabled` catalog (no media host configured)
 * and an `invalid` one (M01e AC-4: the game runs without packs) keep their specified behaviour too.
 */

/** The fields of `CatalogInfo` (packages/engine/src/assets/rpc.ts) this needs. */
export interface CatalogInfoLike {
  state: string;
  failure: { stage: 'pointer' | 'catalog'; status: number | null; offline: boolean } | null;
}

/** `catalog-404`, `pointer-503`, `catalog-network`, ... for a catalog that cannot be had; null otherwise. */
export function catalogFailureCode(info: CatalogInfoLike | null): string | null {
  if (!info || info.state !== 'unavailable' || !info.failure || info.failure.offline) return null;
  return `${info.failure.stage}-${info.failure.status ?? 'network'}`;
}

/** `index-http`, `index-hash-mismatch`, ... for a `WorldIndexUnavailable` from `prepareWorld`; null for anything else, offline or aborted. */
export function worldIndexFailureCode(error: unknown): string | null {
  const e = error as { name?: unknown; reason?: unknown } | null;
  if (e?.name !== 'WorldIndexUnavailable') return null;
  const reason = typeof e.reason === 'string' ? e.reason : 'unavailable';
  return reason === 'offline' || reason === 'aborted' ? null : `index-${reason}`;
}
