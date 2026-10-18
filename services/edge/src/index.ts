import type { Env } from './env.ts';
import { apiError } from './errors.ts';
import { isGeoExempt, isRegionAllowed, requestCountry } from './geo.ts';
import { withIsolationHeaders } from './headers.ts';
import { dispatch, pathMatches, type Ctx, type Route } from './router.ts';
import { handleBoot } from './routes/boot.ts';
import { handleHealth } from './routes/health.ts';
import { handleLegal } from './routes/legal.ts';
import { handleTelemetry } from './routes/telemetry.ts';
import { uuidv7 } from './uuidv7.ts';

const ROUTES: readonly Route[] = [
  { methods: ['GET'], path: '/api/v1/health', handler: handleHealth },
  { methods: ['GET'], path: '/api/v1/boot', handler: handleBoot },
  { methods: ['POST'], path: '/api/v1/t', handler: handleTelemetry },
  { methods: '*', path: '/api/v1/legal', prefix: true, handler: handleLegal },
];

/** Test routes are loaded behind a build-time constant so the production bundle does not contain them. */
async function testRoutes(): Promise<readonly Route[]> {
  if (__DV_TEST_ROUTES__) {
    return (await import('./routes/test.ts')).TEST_ROUTES;
  }
  return [];
}

async function route(request: Request, env: Env, url: URL, requestId: string): Promise<Response> {
  if (!url.pathname.startsWith('/api/v1/') && url.pathname !== '/api/v1') {
    // run_worker_first covers /api/* only; anything else under /api/ is not a route, anything else is an asset.
    if (url.pathname.startsWith('/api/')) return apiError('not_found', 'No such route.', requestId);
    return env.ASSETS.fetch(request);
  }
  const ctx: Ctx = { request, env, url, requestId };
  const tests = await testRoutes();
  if (tests.some((r) => pathMatches(r, url.pathname))) return dispatch(tests, ctx);
  if (!isGeoExempt(url.pathname) && !isRegionAllowed(requestCountry(request), env)) {
    return apiError('region_blocked', 'This service is not available in your region.', requestId);
  }
  return dispatch(ROUTES, ctx);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestId = uuidv7();
    const url = new URL(request.url);
    let res: Response;
    try {
      res = await route(request, env, url, requestId);
    } catch {
      // Never log request bodies or headers (F-027); the request id is enough to find the invocation.
      res = apiError('internal', 'Internal error.', requestId);
    }
    res = withIsolationHeaders(res, url.pathname);
    res.headers.set('X-Request-Id', requestId);
    return res;
  },
} satisfies ExportedHandler<Env>;
