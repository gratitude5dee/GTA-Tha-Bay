import type { CatalogInput, CatalogStore, CutsceneRow, DataPort } from '@dv/shared/data-port';
import { must, mustMaybe, toIso, type Db } from './client.ts';

const CHUNK = 500;

export function cutscenes(db: Db): DataPort['cutscenes'] {
  return {
    async record(row: CutsceneRow) {
      must(
        'cutscenes',
        await db.from('cutscenes').upsert(
          {
            cache_key: row.cache_key,
            status: row.status,
            r2_prefix: row.r2_prefix,
            endpoint_id: row.endpoint_id,
            endpoint_updated_at: row.endpoint_updated_at,
            provider_request_id: row.provider_request_id,
            cost_usd_micros: row.cost_usd_micros,
            workflow_instance: row.workflow_instance,
            char_ids: row.char_ids,
            created_at: toIso(row.created_at),
            ready_at: row.ready_at === null ? null : toIso(row.ready_at),
            error: row.error,
          },
          { onConflict: 'cache_key' },
        ),
      );
    },
    async inCatalog(key: string) {
      const row = mustMaybe('cutscene_catalog', await db.from('cutscene_catalog').select('cache_key').eq('cache_key', key).maybeSingle());
      return row !== null;
    },
  };
}

const same = (a: CatalogInput, b: CatalogInput): boolean =>
  a.template_id === b.template_id &&
  a.template_ver === b.template_ver &&
  a.source === b.source &&
  a.priority === b.priority &&
  a.characters.length === b.characters.length &&
  a.characters.every((c, i) => c === b.characters[i]);

/** The write side of the catalog (BD-M05d-03). The diff against the stored rows keeps a repeat sync at 0 writes. */
export function catalog(db: Db): CatalogStore {
  async function stored(): Promise<Map<string, CatalogInput>> {
    const out = new Map<string, CatalogInput>();
    for (let from = 0; ; from += 1000) {
      const page = must(
        'cutscene_catalog',
        await db.from('cutscene_catalog').select('cache_key,template_id,template_ver,characters,source,priority').order('cache_key').range(from, from + 999),
      );
      for (const r of page) out.set(r.cache_key, r);
      if (page.length < 1000) return out;
    }
  }
  return {
    async upsert(rows) {
      const have = await stored();
      const changed = rows.filter((r) => {
        const old = have.get(r.cache_key);
        return old === undefined || !same(old, r);
      });
      for (let i = 0; i < changed.length; i += CHUNK) {
        must('cutscene_catalog', await db.from('cutscene_catalog').upsert(changed.slice(i, i + CHUNK), { onConflict: 'cache_key' }));
      }
      return changed.length;
    },
    async keys() {
      return [...(await stored()).keys()];
    },
  };
}
