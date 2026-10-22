import type { ServerDataPort } from '@dv/shared/data-port';
import type { Env } from '../env.ts';
import { supabaseDataPort } from './supabase/index.ts';

let cached: { url: string; key: string; env: string; port: ServerDataPort } | null = null;
let testPort: ServerDataPort | null | undefined;

/**
 * Test seam for code that cannot take the app's injected `deps.data`: the Durable Objects build their own port from `env`. A Workers-pool test
 * passes an InMemoryDataPort (or null for "no database") here and `undefined` to restore the default. Production code never calls it.
 */
export function setDataPortForTests(port: ServerDataPort | null | undefined): void {
  testPort = port;
}

/**
 * The Supabase DataPort for this environment, or null when the Worker has no database configured (SUPABASE_URL or the
 * SUPABASE_SECRET_KEY secret is absent: unit tests, previews, local dev). Callers treat null as "use the static fallback"; single-player
 * never needs the database (R-ROLL-01). The client is built once per isolate.
 */
export function configuredDataPort(env: Pick<Env, 'SUPABASE_URL' | 'SUPABASE_SECRET_KEY' | 'ENVIRONMENT'>): ServerDataPort | null {
  if (testPort !== undefined) return testPort;
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  if (cached === null || cached.url !== url || cached.key !== key || cached.env !== env.ENVIRONMENT) {
    cached = { url, key, env: env.ENVIRONMENT, port: supabaseDataPort({ url, secretKey: key, env: env.ENVIRONMENT }) };
  }
  return cached.port;
}
