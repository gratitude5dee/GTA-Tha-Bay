import type { BootConfig, FeatureFlag } from '@dv/shared';
import { DEFAULT_FLAGS, type Env } from '../env.ts';
import { json } from '../errors.ts';
import { isRegionAllowed, requestCountry } from '../geo.ts';
import type { Ctx } from '../router.ts';

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

export function bootConfig(env: Env, country: string | undefined): BootConfig {
  return {
    build: env.BUILD_ID,
    minClientBuild: env.MIN_CLIENT_BUILD,
    region: isRegionAllowed(country, env) ? 'ok' : 'blocked',
    hosts: { api: env.HOST_API, rt: env.HOST_RT, id: env.HOST_ID, media: env.HOST_MEDIA, ugc: env.HOST_UGC },
    assetCatalog: '',
    flags: parseFlags(env.FLAGS_JSON),
    gov: 0,
  };
}

/** Route 2. Geo is evaluated but never blocks (R-ROLL-01): offline single-player still starts. */
export function handleBoot({ env, request }: Ctx): Response {
  return json(bootConfig(env, requestCountry(request)), { headers: { 'Cache-Control': 'no-store' } });
}
