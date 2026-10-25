import { NPC_GUARDRAILS } from '@dv/shared';
import { MEMORY_TTL_MS } from '@dv/shared/npc/memory';
import type { AppDeps } from '../deps.ts';
import type { Env } from '../env.ts';
import { EXPORT_TTL_MS } from './export.ts';
import { runForget } from './forget.ts';
import type { JobResult } from './catalog-sync.ts';

/**
 * The retention crons (spec/domains/09-backend-db.md section 7), each also reachable through `/_test/run-scheduled?job=<name>`:
 *   03:10 `transcripts`     encounter_transcripts rows past expires_at (closed_at + 30 d) and their PRIVATE objects; exports older than 7 days
 *   03:20 `memory`          npc_memory past expires_at (180 d after last access) and npc_relationship unseen for 180 d
 *   03:30 `stub-profiles`   tier 'local' profiles unseen for 180 d, and soft-deleted profiles the forget job missed; each goes through the forget steps
 *   03:40 `builder-drafts`  unpublished NPC builder drafts 180 d after their last update, with their private souls (M06b1)
 * A fresh row or object is never touched. Log lines carry counts only.
 */
const BATCH = 500;
const MAX_ROUNDS = 20;

export async function runTranscriptRetention(env: Env, deps: Pick<AppDeps, 'data' | 'log' | 'now'>): Promise<JobResult> {
  const port = deps.data(env);
  if (port === null) return { job: 'transcripts', ran: false, skipped: 'no_database' };
  const t = deps.now();
  let rows = 0;
  let objects = 0;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const expired = await port.maintenance.expiredTranscripts(t, BATCH);
    if (expired.length === 0) break;
    await env.PRIVATE.delete(expired.map((e) => e.r2_key));
    objects += expired.length;
    rows += await port.maintenance.deleteTranscripts(expired.map((e) => e.encounter_id));
    if (expired.length < BATCH) break;
  }
  // Exports live 7 days (the download link's lifetime).
  let exportsDeleted = 0;
  let cursor: string | undefined;
  do {
    const page = await env.PRIVATE.list({ prefix: 'exports/', limit: 1000, ...(cursor === undefined ? {} : { cursor }) });
    // An export's name carries its creation time (exports/<profile>/<ts>.zip); a pending marker, which has none, goes after a day.
    const old = page.objects
      .filter((o) => {
        const m = /\/([0-9]{10,16})\.zip$/.exec(o.key);
        return m ? Number(m[1]) < t - EXPORT_TTL_MS : o.uploaded.getTime() < t - 86_400_000;
      })
      .map((o) => o.key);
    if (old.length > 0) await env.PRIVATE.delete(old);
    exportsDeleted += old.length;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor !== undefined);
  deps.log(JSON.stringify({ event: 'retention.transcripts', rows, objects, exports: exportsDeleted }));
  return { job: 'transcripts', ran: true, rows, objects, exports: exportsDeleted };
}

export async function runMemoryRetention(env: Env, deps: Pick<AppDeps, 'data' | 'log' | 'now'>): Promise<JobResult> {
  const port = deps.data(env);
  if (port === null) return { job: 'memory', ran: false, skipped: 'no_database' };
  const counts = await port.maintenance.purgeMemory(deps.now());
  deps.log(JSON.stringify({ event: 'retention.memory', ...counts }));
  return { job: 'memory', ran: true, ...counts };
}

export async function runStubProfileRetention(env: Env, deps: Pick<AppDeps, 'data' | 'log' | 'now'>): Promise<JobResult> {
  const port = deps.data(env);
  if (port === null) return { job: 'stub-profiles', ran: false, skipped: 'no_database' };
  const t = deps.now();
  const ids = [...new Set([...(await port.maintenance.stubProfiles(t - MEMORY_TTL_MS, BATCH)), ...(await port.maintenance.deletedProfiles(t - 3_600_000, BATCH))])];
  let profiles = 0;
  for (const id of ids) {
    const r = await runForget(env, deps, id);
    if (r?.purged) profiles++;
  }
  deps.log(JSON.stringify({ event: 'retention.stub_profiles', profiles }));
  return { job: 'stub-profiles', ran: true, profiles };
}

/**
 * 03:40 `builder-drafts` (M06b1): drafts that were never published, 180 days after their last update (04-npc-builder.md section C2), with the
 * private souls written for them and those souls' PRIVATE objects. Published and in-review drafts are never touched.
 */
export async function runBuilderDraftRetention(env: Env, deps: Pick<AppDeps, 'data' | 'log' | 'now'>): Promise<JobResult> {
  const port = deps.data(env);
  if (port === null) return { job: 'builder-drafts', ran: false, skipped: 'no_database' };
  const cutoff = deps.now() - NPC_GUARDRAILS.builder.draftRetentionDays * 86_400_000;
  let drafts = 0;
  let objects = 0;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const gone = await port.builder.purgeStaleDrafts(cutoff, 100);
    for (const g of gone) {
      for (const key of g.promptKeys) {
        const base = key.replace(/\/soul\.prompt\.txt$/, '');
        await env.PRIVATE.delete([`${base}/soul.prompt.txt`, `${base}/soul.compiled.json`, `${base}/soul.ink`]);
        objects += 3;
      }
    }
    drafts += gone.length;
    if (gone.length < 100) break;
  }
  deps.log(JSON.stringify({ event: 'retention.builder-drafts', drafts, objects }));
  return { job: 'builder-drafts', ran: true, drafts, objects };
}
