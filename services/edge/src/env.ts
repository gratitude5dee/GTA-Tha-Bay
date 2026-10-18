import type { FeatureFlag } from '@dv/shared';

declare global {
  /** Replaced at build time through wrangler `define`: false in prod, true in staging and previews. */
  const __DV_TEST_ROUTES__: boolean;
}

export interface Env {
  ASSETS: Fetcher;
  /** Analytics Engine dataset tha_bay_telemetry. Absent in a runtime that does not provide it. */
  AE?: AnalyticsEngineDataset | undefined;
  ENVIRONMENT: string;
  /** Comma-separated ISO country codes allowed to use online features. */
  GEO_ALLOW: string;
  BUILD_ID: string;
  MIN_CLIENT_BUILD: string;
  HOST_API: string;
  HOST_RT: string;
  HOST_ID: string;
  HOST_MEDIA: string;
  HOST_UGC: string;
  /** JSON object of FeatureFlag to boolean; unknown keys are ignored. */
  FLAGS_JSON: string;
  FAL_MODE: string;
}

export const DEFAULT_FLAGS: Readonly<Record<FeatureFlag, boolean>> = {
  'mp.enabled': false,
  'npc.dialogue': false,
  'npc.voice': false,
  'npc.builder': false,
  'cutscene.generated': false,
  'forum.enabled': false,
  'ugc.publish': false,
  'auth.openaiWeb': false,
  'auth.thirdweb': false,
  'telemetry.verbose': false,
  'mods.enabled': false,
  'mods.script': false,
  'mods.ui': false,
};
