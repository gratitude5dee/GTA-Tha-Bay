import type { ServerDataPort } from '@dv/shared/data-port';
import { InMemoryDataPort } from '@dv/shared/data-port.memory';
import { now } from '../clock.ts';
import type { AppDeps } from '../deps.ts';
import type { Env } from '../env.ts';
import { anthropicMode } from '../npc/upstream.ts';

/**
 * The database of the NPC builder. A configured Supabase port is always used. Where none is configured (local runs, Previews, the e2e Worker)
 * and the Worker is in fixture mode, drafts and private souls live in a per-isolate InMemoryDataPort so the whole flow can be tried without
 * secrets; a live Worker without a database answers `upstream_unavailable` instead of pretending (check:prod-routes keeps production live).
 */
let fallback: InMemoryDataPort | null = null;

export function builderPort(env: Env, deps: Pick<AppDeps, 'data'>): { port: ServerDataPort; ephemeral: boolean } | null {
  const real = deps.data(env);
  if (real !== null) return { port: real, ephemeral: false };
  if (anthropicMode(env) !== 'fixture') return null;
  fallback ??= new InMemoryDataPort({ now, env: env.ENVIRONMENT });
  return { port: fallback, ephemeral: true };
}

/** Test seam: drops the per-isolate fallback port. */
export function resetFallbackPortForTests(): void {
  fallback = null;
}
