import type { AppDeps } from '../deps.ts';
import type { Env } from '../env.ts';
import { runCatalogSync, type JobResult } from './catalog-sync.ts';
import { runLedgerExport } from './ledger-export.ts';
import { runBuilderDraftRetention, runMemoryRetention, runStubProfileRetention, runTranscriptRetention } from './retention.ts';

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
  // M06a1 retention (spec/domains/09-backend-db.md section 7): three dispatcher jobs, each also run on demand through the test-only run-scheduled route of staging and previews.
  transcripts: runTranscriptRetention,
  memory: runMemoryRetention,
  'stub-profiles': runStubProfileRetention,
  // M06b1: unpublished builder drafts 180 days after their last update.
  'builder-drafts': runBuilderDraftRetention,
} as const;
export type JobName = keyof typeof JOBS;
/**
 * The jobs `POST /api/v1/_test/run-scheduled` runs when neither `job` nor `at` is given (M05d). The keep-alive is not one of them: the 03:10 tick
 * already touches the database every day.
 */
export const CRON_JOBS: readonly JobName[] = ['catalog-sync', 'ledger-export'];

/**
 * The one Cron Trigger of each Worker (BD-FIX-CRON-01: the dispatcher of DL-746, brought forward from M13c1). Workers Free allows 5 Cron
 * Triggers per account and 10 ms of CPU per invocation (spec/03-decisions-and-facts-2.md section 8), so each Worker has one expression, and a
 * tick with no job due does no I/O and returns at once.
 */
export const DISPATCH_CRON = '*/5 * * * *';
/** The dispatcher's period: every table time is a multiple of it, so a tick of `DISPATCH_CRON` lands on it (test/scheduled-dispatch.test.ts). */
export const DISPATCH_INTERVAL_MS = 300_000;
const DAY_MS = 86_400_000;

/**
 * The dispatcher table: UTC time of day (`HH:MM`, on the 5-minute grid) to the jobs that tick runs, in order. The times are those of the four
 * daily expressions it replaces (`10 3`, `20 3`, `30 3`, `40 3 * * *`). A new job is a row here, never a new Cron Trigger.
 */
export const SCHEDULE: Readonly<Record<string, readonly JobName[]>> = {
  '03:10': ['catalog-sync', 'ledger-export', 'transcripts'],
  '03:20': ['memory'],
  '03:30': ['stub-profiles'],
  '03:40': ['builder-drafts'],
};

/**
 * The UTC `HH:MM` of the minute that holds `scheduledTime` (epoch ms, `ScheduledController.scheduledTime`: the minute the tick was scheduled
 * for, not when it started), or null when it is not a finite number. A table row matches one minute of the day only, so a job runs once a day
 * whatever expression ticks (the `*\/5` dispatcher, an old daily expression, or a denser one), and never at another time.
 */
export function slotOf(scheduledTime: number): string | null {
  if (!Number.isFinite(scheduledTime)) return null;
  const minutes = Math.floor((((Math.floor(scheduledTime) % DAY_MS) + DAY_MS) % DAY_MS) / 60_000);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * The jobs due in the tick scheduled at `scheduledTime`: the table row of its minute, or none. The cron expression is not read, so the four daily
 * expressions still deployed until the operator applies `DISPATCH_CRON` (`wrangler triggers deploy`) dispatch the same jobs at the same times.
 */
export function dueJobs(scheduledTime: number): readonly JobName[] {
  const slot = slotOf(scheduledTime);
  return slot === null ? [] : (SCHEDULE[slot] ?? []);
}

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
