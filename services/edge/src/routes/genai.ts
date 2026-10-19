import { apiError, json } from '../errors.ts';
import type { Ctx } from '../router.ts';

/**
 * genAI lane status (M00c wiring ahead of the M05c3/M10a1 asset jobs): reports whether the Worker
 * holds a fal.ai key and which mode the pipeline is in — never returns the key itself.
 * Route 63 answers not_found in production for all of v1 (M00e item 13); staging and previews keep the status.
 */
export function handleGenaiStatus({ env, requestId }: Ctx): Response {
  if (env.ENVIRONMENT === 'prod') return apiError('not_found', 'No such route.', requestId);
  return json({
    mode: env.FAL_MODE,
    falConfigured: typeof env.FAL_KEY === 'string' && env.FAL_KEY.length > 0,
  });
}
