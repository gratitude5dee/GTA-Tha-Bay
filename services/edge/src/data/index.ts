import type { ServerDataPort } from '@dv/shared/data-port';
import type { Env } from '../env.ts';
import { supabaseDataPort } from './supabase/index.ts';

let cached: { url: string; key: string; env: string; port: ServerDataPort } | null = null;

/**
 * The Supabase DataPort for this environment, or null when the Worker has no database configured (SUPABASE_URL or the
 * SUPABASE_SECRET_KEY secret is absent: unit tests, previews, local dev). Callers treat null as "use the static fallback"; single-player
 * never needs the database (R-ROLL-01). The client is built once per isolate.
 */
export function configuredDataPort(env: Pick<Env, 'SUPABASE_URL' | 'SUPABASE_SECRET_KEY' | 'ENVIRONMENT'>): ServerDataPort | null {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  if (cached === null || cached.url !== url || cached.key !== key || cached.env !== env.ENVIRONMENT) {
    cached = { url, key, env: env.ENVIRONMENT, port: supabaseDataPort({ url, secretKey: key, env: env.ENVIRONMENT }) };
  }
  return cached.port;
}
