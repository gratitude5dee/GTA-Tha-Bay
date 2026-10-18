import { apiError } from '../errors.ts';
import type { Ctx } from '../router.ts';

/** Placeholder until M13d. Geo-exempt so takedown requesters anywhere can reach it once it exists (R-IP-03). */
export function handleLegal({ requestId }: Ctx): Response {
  return apiError('feature_disabled', 'This route is not available yet.', requestId);
}
