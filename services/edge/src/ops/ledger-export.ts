import type { SpendEvent } from '@dv/shared';
import type { AppDeps } from '../deps.ts';
import type { Env } from '../env.ts';
import type { JobResult } from './catalog-sync.ts';

/** The part of BudgetGovernorDO this job calls. */
interface GovernorExportRpc {
  exportBatch(limit?: number): Promise<SpendEvent[]>;
  markExported(jobIds: string[]): Promise<number>;
}

const PAGE = 500;
/** One run exports at most this many pages, so a backlog cannot hold the cron open; the next run continues. */
const MAX_PAGES = 20;

/**
 * ledger-export (nightly cron, and the staging test route for scheduled jobs): appends the settled, not yet exported rows of the
 * BudgetGovernorDO ledger to `genai_ledger` with `env = ENVIRONMENT`, then marks them exported. `append` skips a row whose
 * (env, job_id) is stored, so a crash between the two steps costs nothing on the next run. A rerun adds 0 rows.
 */
export async function runLedgerExport(env: Env, deps: Pick<AppDeps, 'data'>): Promise<JobResult> {
  const port = deps.data(env);
  if (port === null) return { job: 'ledger-export', ran: false, skipped: 'no_database' };
  const gov = env.GOVERNOR.get(env.GOVERNOR.idFromName(`gov:${env.ENVIRONMENT}`)) as unknown as GovernorExportRpc;
  let read = 0;
  let appended = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const batch = await gov.exportBatch(PAGE);
    if (batch.length === 0) break;
    read += batch.length;
    appended += await port.ledger.append(batch.map((r) => ({ ...r, env: env.ENVIRONMENT })));
    await gov.markExported(batch.flatMap((r) => (r.jobId === undefined ? [] : [r.jobId])));
    if (batch.length < PAGE) break;
  }
  return { job: 'ledger-export', ran: true, read, appended };
}
