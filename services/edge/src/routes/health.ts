import { json } from '../errors.ts';
import type { Ctx } from '../router.ts';

/** Route 1. Never geo-gated. */
export function handleHealth({ env }: Ctx): Response {
  return json({ ok: true, build: env.BUILD_ID, env: env.ENVIRONMENT });
}
