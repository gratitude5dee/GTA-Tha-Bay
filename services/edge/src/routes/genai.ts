import { json } from '../errors.ts';
import type { Ctx } from '../router.ts';

/**
 * genAI lane status (M00c wiring ahead of the M05c3/M10a1 asset jobs): reports whether the Worker
 * holds a fal.ai key and which mode the pipeline is in — never returns the key itself.
 */
export function handleGenaiStatus({ env }: Ctx): Response {
  return json({
    mode: env.FAL_MODE,
    falConfigured: typeof env.FAL_KEY === 'string' && env.FAL_KEY.length > 0,
  });
}
