import { makeDeps, type AdminPath, type AppDeps } from './deps.ts';
import type { Env } from './env.ts';
import { apiError } from './errors.ts';
import { isGeoExempt, isRegionAllowed, requestCountry } from './geo.ts';
import { withIsolationHeaders } from './headers.ts';
import { dispatch, pathMatches, type Ctx, type Route } from './router.ts';
import { ADMIN_PATH, handleDeleteMe, handleExportMe, handleLogin, handleLogout, handleMe, handleRefresh, handleSignup } from './routes/auth.ts';
import { handleCutsceneStatus, handleFalHook, handlePrewarm } from './cutscenes/routes.ts';
import { handlePlayToken } from './id/playtoken.ts';
import { handleBoot } from './routes/boot.ts';
import { handleKill } from './routes/admin-roster.ts';
import { handlePutFlag } from './routes/admin-flags.ts';
import { handleGenaiStatus } from './routes/genai.ts';
import { handleHealth } from './routes/health.ts';
import { handleLegal } from './routes/legal.ts';
import { handleMedia } from './routes/media.ts';
import { handleDeleteMe as handleForgetMe, handleExport, handleMe as handleIdentityMe } from './routes/me.ts';
import { handleBrowserReport } from './routes/reports-browser.ts';
import { handleNpc } from './routes/npc-talk.ts';
import { handleForgetNpcMemory } from './routes/me-npc-memory.ts';
import { handleRoster } from './routes/roster.ts';
import { handleTelemetry } from './routes/telemetry.ts';
import { handleQueueBatch } from './ops/jobs.ts';
import { CRON_JOBS, CRON_SCHEDULE, runJobs } from './ops/scheduled.ts';
import { uuidv7 } from './uuidv7.ts';

export { BudgetGovernorDO } from './budget/BudgetGovernorDO.ts';
export { PlayerQuotaDO } from './budget/QuotaDO.ts';
export { CutsceneJobDO } from './cutscenes/CutsceneJobDO.ts';
export { EncounterDO } from './npc/EncounterDO.ts';
export { FalGateDO, GenJobWorkflow } from '@dv/pipeline';
export { TranscoderContainer } from '@dv/pipeline';

const ROUTES: readonly Route[] = [
  { methods: ['GET'], path: '/api/v1/health', handler: handleHealth },
  { methods: ['GET'], path: '/api/v1/boot', handler: handleBoot },
  { methods: ['POST'], path: '/api/v1/t', handler: handleTelemetry },
  { methods: '*', path: '/api/v1/legal', prefix: true, handler: handleLegal },
  { methods: ['POST'], path: '/api/v1/id/play-token', handler: handlePlayToken },
  { methods: ['POST'], path: '/api/v1/auth/signup', handler: handleSignup },
  { methods: ['POST'], path: '/api/v1/auth/login', handler: handleLogin },
  { methods: ['POST'], path: '/api/v1/auth/refresh', handler: handleRefresh },
  { methods: ['POST'], path: '/api/v1/auth/logout', handler: handleLogout },
  { methods: ['GET'], path: '/api/v1/auth/me', handler: handleMe },
  { methods: ['DELETE'], path: '/api/v1/auth/me', handler: handleDeleteMe },
  { methods: ['GET'], path: '/api/v1/auth/me/export', handler: handleExportMe },
  { methods: ['GET'], path: '/api/v1/genai/status', handler: handleGenaiStatus },
  { methods: ['POST'], path: '/api/v1/reports/browser', handler: handleBrowserReport },
  { methods: ['GET'], path: '/api/v1/cutscenes', prefix: true, handler: handleCutsceneStatus },
  { methods: ['POST'], path: '/api/v1/admin/cutscenes/prewarm', handler: handlePrewarm },
  { methods: ['POST'], path: '/api/v1/hooks/fal', handler: handleFalHook },
  // M06a1: roster (30), kill (46), flags (47), identity state, export and forget (14). Staff routes carry the ops token until M12a1.
  { methods: ['GET'], path: '/api/v1/roster', handler: handleRoster },
  { methods: ['GET'], path: '/api/v1/me', handler: handleIdentityMe },
  { methods: ['DELETE'], path: '/api/v1/me', handler: handleForgetMe },
  { methods: ['GET'], path: '/api/v1/me/export', handler: handleExport },
  { methods: ['POST'], path: '/api/v1/admin/roster', prefix: true, handler: handleKill },
  { methods: ['PUT'], path: '/api/v1/admin/flags', prefix: true, handler: handlePutFlag },
  // M06a4: route 52, DELETE /api/v1/me/npc-memory?npcId= (204).
  { methods: ['DELETE'], path: '/api/v1/me/npc-memory', handler: handleForgetNpcMemory },
  // M06a3: route 31, POST /api/v1/npc/:npcId/talk (SSE).
  { methods: '*', path: '/api/v1/npc', prefix: true, handler: handleNpc },
];

/** Test routes are loaded behind a build-time constant so the production bundle does not contain them. */
async function testRoutes(): Promise<readonly Route[]> {
  if (__DV_TEST_ROUTES__) {
    return (await import('./routes/test.ts')).TEST_ROUTES;
  }
  return [];
}

async function route(request: Request, env: Env, url: URL, requestId: string, deps: AppDeps, exec?: ExecutionContext): Promise<Response> {
  // run_worker_first names /account so this redirect does not depend on the assets layer's trailing-slash handling (M00e item 10).
  if (url.pathname === '/account') {
    return new Response(null, { status: 308, headers: { Location: '/account/', 'Cache-Control': 'no-store' } });
  }
  // Public R2 media (M01d2, DL-713): before the ASSETS fallthrough and the geo gate (media is geo-exempt, A-10); the handler owns its methods.
  // The two same-origin unlock clips of FirstGestureUnlock (M04c, public/media/) are static assets, not R2 keys.
  if (url.pathname === '/media/blank.mp4' || url.pathname === '/media/blank.webm') return env.ASSETS.fetch(request);
  if (url.pathname.startsWith('/media/')) return handleMedia(request, env, url);
  if (!url.pathname.startsWith('/api/v1/') && url.pathname !== '/api/v1') {
    // run_worker_first covers /api/* only; anything else under /api/ is not a route, anything else is an asset.
    if (url.pathname.startsWith('/api/')) return apiError('not_found', 'No such route.', requestId);
    return env.ASSETS.fetch(request);
  }
  const ctx: Ctx = { request, env, url, requestId, deps, exec };
  const tests = await testRoutes();
  if (tests.some((r) => pathMatches(r, url.pathname))) return dispatch(tests, ctx);
  if (!isGeoExempt(url.pathname, request.method) && !isRegionAllowed(requestCountry(request), env)) {
    return apiError('region_blocked', 'This service is not available in your region.', requestId);
  }
  return dispatch(ROUTES, ctx);
}

/**
 * Builds the Worker handler. The account routes take the admin path, a log sink and a clock by injection (M00e, DL-611):
 * tests pass stubs, production code calls `createApp()` and gets the recorded `ADMIN_PATH`.
 */
export function createApp(overrides: { adminPath?: AdminPath } & Partial<Omit<AppDeps, 'adminPath'>> = {}): {
  fetch(request: Request, env: Env, exec?: ExecutionContext): Promise<Response>;
  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void>;
  queue(batch: MessageBatch<unknown>, env: Env): Promise<void>;
} {
  const { adminPath, ...rest } = overrides;
  const deps = makeDeps(adminPath ?? ADMIN_PATH, rest);
  return {
    async fetch(request: Request, env: Env, exec?: ExecutionContext): Promise<Response> {
      const requestId = uuidv7();
      const url = new URL(request.url);
      let res: Response;
      try {
        res = await route(request, env, url, requestId, deps, exec);
      } catch {
        // Never log request bodies or headers (F-027); the request id is enough to find the invocation.
        res = apiError('internal', 'Internal error.', requestId);
      }
      res = withIsolationHeaders(res, url.pathname, env);
      res.headers.set('X-Request-Id', requestId);
      return res;
    },
    /** Queue consumers of `tha-bay-jobs` and `tha-bay-spend` (M06a1). */
    queue(batch, env) {
      return handleQueueBatch(batch, env, deps);
    },
    /** Cron `10 3 * * *` (M05d): catalog-sync, then ledger-export. Cron Triggers do not run in Previews; the staging-only test route for scheduled jobs stands in there. */
    scheduled(controller, env, ctx) {
      const jobs = CRON_SCHEDULE[controller.cron] ?? CRON_JOBS;
      ctx.waitUntil(runJobs(env, deps, jobs).then((results) => deps.log(JSON.stringify({ event: 'cron.done', cron: controller.cron, results }))));
      return Promise.resolve();
    },
  };
}

export default createApp() satisfies ExportedHandler<Env>;
