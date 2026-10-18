import { json } from '../errors.ts';
import { requestCountry } from '../geo.ts';
import type { Ctx, Route } from '../router.ts';

/**
 * The /api/v1/_test namespace exists only in staging and preview bundles. index.ts imports this file inside
 * `if (__DV_TEST_ROUTES__)`, so the production bundle contains neither the handlers nor the path strings
 * (proved by check:prod-routes). These routes are not geo-gated: the geo-gate e2e reads the edge country here.
 */
function handleEchoCountry({ request }: Ctx): Response {
  return json({ country: requestCountry(request) ?? null });
}

export const TEST_ROUTES: readonly Route[] = [
  { methods: ['GET'], path: '/api/v1/_test/echo-country', handler: handleEchoCountry },
];
