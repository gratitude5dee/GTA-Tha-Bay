import { mockJwks } from '@dv/pipeline/core';
import type { GovLevel, SpendEvent, Vendor } from '@dv/shared';
import { apiError, json } from '../errors.ts';
import { requestCountry } from '../geo.ts';
import { CRON_JOBS, JOBS, runJobs, type JobName } from '../ops/scheduled.ts';
import type { Ctx, Route } from '../router.ts';

/**
 * The /api/v1/_test namespace exists only in staging and preview bundles. index.ts imports this file inside
 * `if (__DV_TEST_ROUTES__)`, so the production bundle contains neither the handlers nor the path strings
 * (proved by check:prod-routes). These routes are not geo-gated: the geo-gate e2e reads the edge country here.
 */
function handleEchoCountry({ request }: Ctx): Response {
  return json({ country: requestCountry(request) ?? null });
}

/** The public half of the mock webhook signing key, in the shape of fal's own JWKS. */
async function handleFalJwks(): Promise<Response> {
  return json(await mockJwks());
}

interface GovernorTestRpc {
  level(): Promise<{ level: GovLevel; byVendor: Record<Vendor, number> }>;
  ingest(batch: SpendEvent[]): Promise<void>;
  alarmLog(): Promise<{ threshold: string; spent: number }[]>;
  spentMicros(v: Vendor): Promise<number>;
}

/** GET: the governor's level, per-vendor percentages, fal spend and alarm log. POST: ingest a SpendEvent batch. */
async function handleSpend({ request, env, requestId }: Ctx): Promise<Response> {
  const gov = env.GOVERNOR.get(env.GOVERNOR.idFromName(`gov:${env.ENVIRONMENT}`)) as unknown as GovernorTestRpc;
  if (request.method === 'POST') {
    const batch = (await request.json()) as unknown;
    if (!Array.isArray(batch)) return apiError('bad_request', 'Expected a SpendEvent array.', requestId);
    await gov.ingest(batch as SpendEvent[]);
  }
  return json({ ...(await gov.level()), falSpentUsdMicros: await gov.spentMicros('fal'), alarms: await gov.alarmLog() });
}

/**
 * Runs the scheduled jobs the way the cron would (Previews run no Cron Triggers): `?job=catalog-sync|ledger-export|keepalive`, or the
 * two cron jobs when `job` is absent or `all`. The SLA pager and reconciliation jobs arrive with M06a and M14b.
 */
async function handleRunScheduled({ url, env, deps, requestId }: Ctx): Promise<Response> {
  const job = url.searchParams.get('job');
  let names: readonly JobName[];
  if (job === null || job === 'all') names = CRON_JOBS;
  else if (Object.hasOwn(JOBS, job)) names = [job as JobName];
  else return apiError('bad_request', 'Unknown job.', requestId, { details: { jobs: Object.keys(JOBS) } });
  return json({ ran: await runJobs(env, deps, names) });
}

/** No queue consumers exist yet (SPEND arrives with M06a3); nothing to drain. */
function handleDrainQueue(): Response {
  return json({ drained: 0 });
}

export const TEST_ROUTES: readonly Route[] = [
  { methods: ['GET'], path: '/api/v1/_test/echo-country', handler: handleEchoCountry },
  { methods: ['GET'], path: '/api/v1/_test/fal-jwks', handler: handleFalJwks },
  { methods: ['GET', 'POST'], path: '/api/v1/_test/spend', handler: handleSpend },
  { methods: ['POST'], path: '/api/v1/_test/run-scheduled', handler: handleRunScheduled },
  { methods: ['POST'], path: '/api/v1/_test/drain-queue', handler: handleDrainQueue },
];
