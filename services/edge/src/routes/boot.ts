import type { BootConfig, FeatureFlag } from '@dv/shared';
import { DEFAULT_FLAGS, type Env } from '../env.ts';
import { json } from '../errors.ts';
import pointer from '../generated/asset-catalog.json' with { type: 'json' };
import { isRegionAllowed, requestCountry } from '../geo.ts';
import type { AdminPath } from '../deps.ts';
import type { Ctx } from '../router.ts';
import { signupBlockedReason } from './auth.ts';

/** Flags come from the FLAGS_JSON var until KV arrives (M05b). Unknown keys and non-boolean values are ignored. */
export function parseFlags(raw: string): Record<FeatureFlag, boolean> {
  const flags: Record<FeatureFlag, boolean> = { ...DEFAULT_FLAGS };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) {
      for (const key of Object.keys(DEFAULT_FLAGS) as FeatureFlag[]) {
        const value = (parsed as Record<string, unknown>)[key];
        if (typeof value === 'boolean') flags[key] = value;
      }
    }
  } catch {
    /* a bad FLAGS_JSON leaves every flag off */
  }
  return flags;
}

/** The manifest key of the catalog pointer that shipped with this Worker version (assets:publish, M01d); empty when absent. */
function catalogKey(): string {
  const key = (pointer as { key?: unknown }).key;
  return typeof key === 'string' ? key : '';
}

export function bootConfig(env: Env, country: string | undefined, adminPath: AdminPath): BootConfig {
  const flags = parseFlags(env.FLAGS_JSON);
  // auth.password is true exactly when route 58 would accept a sign-up, whatever FLAGS_JSON says (C12 1.3, DL-601).
  flags['auth.password'] = signupBlockedReason(env, adminPath) === null;
  return {
    build: env.BUILD_ID,
    minClientBuild: env.MIN_CLIENT_BUILD,
    region: isRegionAllowed(country, env) ? 'ok' : 'blocked',
    hosts: { api: env.HOST_API, rt: env.HOST_RT, id: env.HOST_ID, media: env.HOST_MEDIA, ugc: env.HOST_UGC },
    assetCatalog: catalogKey(),
    flags,
    gov: 0,
  };
}

/** Route 2. Geo is evaluated but never blocks (R-ROLL-01): offline single-player still starts. */
export function handleBoot({ env, request, deps }: Ctx): Response {
  return json(bootConfig(env, requestCountry(request), deps.adminPath), { headers: { 'Cache-Control': 'no-store' } });
}
