import type { AppDeps } from '../deps.ts';
import type { Env } from '../env.ts';
import { runCatalogSync, type JobResult } from './catalog-sync.ts';
import { runLedgerExport } from './ledger-export.ts';
import { runMemoryRetention, runStubProfileRetention, runTranscriptRetention } from './retention.ts';

/** A key that no catalog holds: the keep-alive reads it only to make one database round trip. */
const KEEPALIVE_KEY = '0'.repeat(64);

/** keepalive: one select through the DataPort. The nightly CI run (`pnpm test:staging -- keepalive`) calls it so the Free staging project never pauses. */
export async function runKeepalive(env: Env, deps: Pick<AppDeps, 'data'>): Promise<JobResult> {
  const port = deps.data(env);
  if (port === null) return { job: 'keepalive', ran: false, skipped: 'no_database' };
  await port.cutscenes.inCatalog(KEEPALIVE_KEY);
  return { job: 'keepalive', ran: true };
}

export const JOBS = {
  'catalog-sync': runCatalogSync,
  'ledger-export': runLedgerExport,
  keepalive: runKeepalive,
  // M06a1 retention (spec/domains/09-backend-db.md section 7): three crons, each also run on demand through /_test/run-scheduled?job=<name>.
  transcripts: runTranscriptRetention,
  memory: runMemoryRetention,
  'stub-profiles': runStubProfileRetention,
} as const;
export type JobName = keyof typeof JOBS;
/** The jobs the daily cron `10 3 * * *` runs. The keep-alive is not one of them: the two jobs above already touch the database every day. */
export const CRON_JOBS: readonly JobName[] = ['catalog-sync', 'ledger-export'];
/** Cron expression to the jobs it runs (wrangler `triggers.crons`). */
export const CRON_SCHEDULE: Readonly<Record<string, readonly JobName[]>> = {
  '10 3 * * *': ['catalog-sync', 'ledger-export', 'transcripts'],
  '20 3 * * *': ['memory'],
  '30 3 * * *': ['stub-profiles'],
};

/**
 * Runs the named jobs one after the other. A failing job is reported as `{ran:false, skipped:'failed:<code>'}` and does not stop the next;
 * the log line carries the job name and the error code only, never a row, a key or a message.
 */
export async function runJobs(env: Env, deps: AppDeps, names: readonly JobName[]): Promise<JobResult[]> {
  const out: JobResult[] = [];
  for (const name of names) {
    try {
      out.push(await JOBS[name](env, deps));
    } catch (e) {
      const code = e instanceof Error && 'code' in e && typeof e.code === 'string' ? e.code : e instanceof Error ? e.name : 'error';
      deps.log(JSON.stringify({ event: 'job.failed', job: name, code }));
      out.push({ job: name, ran: false, skipped: `failed:${code}` });
    }
  }
  return out;
}
