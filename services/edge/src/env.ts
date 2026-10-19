import type { FeatureFlag } from '@dv/shared';

declare global {
  /** Replaced at build time through wrangler `define`: false in prod, true in staging and previews. */
  const __DV_TEST_ROUTES__: boolean;
}

export interface Env {
  ASSETS: Fetcher;
  /** Public media bucket: cutscenes/<key>/... (immutable, manifest written last). */
  MEDIA: R2Bucket;
  /** Private bucket: cutscenes-orig/<key>/orig.mp4 and pipeline work files. */
  PRIVATE: R2Bucket;
  /** Kill switches `ks:*`, `gov:level`, `jwks:fal`, feature flags. */
  FLAGS: KVNamespace;
  FAL_GATE: DurableObjectNamespace;
  GOVERNOR: DurableObjectNamespace;
  CUTSCENE_JOB: DurableObjectNamespace;
  /** Workflow `gen-job` (GenJobWorkflow). */
  GEN_WF: Workflow;
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
  /** fal.ai key (secret) — absent in staging mock mode and local dev. */
  FAL_KEY?: string | undefined;
  /** Supabase project URL, e.g. https://<ref>.supabase.co (var, non-secret). */
  SUPABASE_URL?: string | undefined;
  /** Supabase anon/publishable key (var, public by design). */
  SUPABASE_ANON_KEY?: string | undefined;
  /** Bearer token for the staff routes until staff JWTs arrive (M12a1). Absent: those routes answer 401. */
  OPS_TOKEN?: string | undefined;
  /** Test only (compiled out of the production bundle): extra catalog keys, comma separated. */
  CUTSCENE_CATALOG_EXTRA?: string | undefined;
  /** Supabase service-role key (secret) — reserved for the M05d data spine. */
  SUPABASE_SECRET_KEY?: string | undefined;
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
