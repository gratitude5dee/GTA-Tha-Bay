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
  /** Absolute base URL of the Worker's media route, e.g. https://<host>/media (M01d2, DL-713). */
  HOST_MEDIA: string;
  /** Kill switch of /media/*: "off" answers 503; anything else serves (default on). */
  MEDIA_ROUTE?: string | undefined;
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
  /** Supabase secret key (sb_secret_..., Worker secret): the admin path of the password accounts (M00e) and the M05d data spine. */
  SUPABASE_SECRET_KEY?: string | undefined;
  /** Password sign-up switch (M00e, DL-601): route 58 answers feature_disabled unless this is exactly "on". */
  AUTH_PASSWORD_SIGNUP?: string | undefined;
  /** Operator contact printed in the privacy document and required by route 58 (DL-613, DL-635). Not a secret. */
  LEGAL_CONTACT?: string | undefined;
  /** Play-token HMAC secret, "<kid>:<base64url 32 bytes>" (M04b3, BD-M04b3-01). Absent: route 5 answers 503. Not in secrets.required (DL-679). */
  PLAY_TOKEN_HMAC?: string | undefined;
  /** Previous play-token secret, same format; verifies only. */
  PLAY_TOKEN_HMAC_PREV?: string | undefined;
  /** Optional secret that salts the daily net hash of the auth rate limit (M00e; M06a1 replaces the helper). */
  QUOTA_NET_SALT_SECRET?: string | undefined;
  /** Rate Limiting bindings of class auth (M00e). Absent in unit tests and local runs: no limit. */
  RL_AUTH?: RateLimit | undefined;
  RL_AUTH_USER?: RateLimit | undefined;
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
  'auth.password': false,
};
