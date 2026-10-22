import type { CutsceneIndex, CutsceneIndexEntry } from '@dv/shared/contracts/c09-cutscene';
import type { CatalogInput } from '@dv/shared/data-port';
import catalogFile from '../generated/cutscene-catalog.json';
import type { AppDeps } from '../deps.ts';
import type { Env } from '../env.ts';

export interface JobResult {
  job: string;
  /** False when the job did nothing: no database configured, or the call failed. */
  ran: boolean;
  /** Why it did nothing (a short code, never a message with row content). */
  skipped?: string;
  [counter: string]: string | number | boolean | undefined;
}

/** `cut.story.<mission>.<beat>` is `mission:<mission>`; other refs keep their domain: `cut.fight.faceoff.a.b` is `fight:faceoff.a.b`. BD-M05d-05. */
export function sourceOf(ref: string): string {
  const parts = ref.split('.');
  if (parts[0] !== 'cut' || parts.length < 3) return `ref:${ref}`;
  if (parts[1] === 'story') return parts.length >= 4 ? `mission:${parts.slice(2, -1).join('.')}` : `ref:${ref}`;
  return `${parts[1]}:${parts.slice(2).join('.')}`;
}

/** 'story.beat@1' to ['story.beat', 1]; a template without a numeric version counts as version 1. */
function templateOf(t: string): [string, number] {
  const at = t.lastIndexOf('@');
  if (at < 0) return [t, 1];
  const ver = Number.parseInt(t.slice(at + 1), 10);
  return [t.slice(0, at), Number.isInteger(ver) && ver >= 0 ? ver : 1];
}

export function catalogRowOf(e: CutsceneIndexEntry): CatalogInput {
  const [template_id, template_ver] = templateOf(e.keyInput.template);
  return {
    cache_key: e.key,
    template_id,
    template_ver,
    characters: e.characters.map((c) => c.id),
    source: sourceOf(e.ref),
    priority: 5,
  };
}

/** Every catalog row of an index, in index order, one per key. */
export function catalogRows(index: CutsceneIndex): CatalogInput[] {
  const seen = new Set<string>();
  const rows: CatalogInput[] = [];
  for (const e of index.entries) {
    if (seen.has(e.key)) continue;
    seen.add(e.key);
    rows.push(catalogRowOf(e));
  }
  return rows;
}

/**
 * catalog-sync (daily cron 03:10, and the staging test route for scheduled jobs): upserts every row of the shipped cutscene index into
 * `cutscene_catalog`, idempotently. A repeat writes 0 rows. In a mock-generation environment the fixture keys of the static catalog
 * (`mockKeys`) are included, so the staging demo script keeps working once route 27 reads the table.
 */
export async function runCatalogSync(env: Env, deps: Pick<AppDeps, 'data' | 'cutsceneIndex'>): Promise<JobResult> {
  const port = deps.data(env);
  if (port === null) return { job: 'catalog-sync', ran: false, skipped: 'no_database' };
  const rows = catalogRows(deps.cutsceneIndex());
  if (env.FAL_MODE === 'mock') {
    const have = new Set(rows.map((r) => r.cache_key));
    for (const key of catalogFile.mockKeys) {
      if (!have.has(key)) rows.push({ cache_key: key, template_id: 'mock', template_ver: 1, characters: [], source: 'mock', priority: 5 });
    }
  }
  const written = await port.catalog.upsert(rows);
  return { job: 'catalog-sync', ran: true, rows: rows.length, written };
}
