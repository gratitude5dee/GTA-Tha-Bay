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
  /** EncounterDO: one instance per conversation `enc:<pid>:<npcId>:<encounterId>`, plus the per-NPC open-set index `enc:index:<npcId>` (M06a1). */
  ENCOUNTER: DurableObjectNamespace;
  /** PlayerQuotaDO: `q:p:<pid>` per player and `q:n:<netHash>` per network (M06a1). */
  QUOTA: DurableObjectNamespace;
  /** Background jobs: `summarize`, `forget`, `export` (queue tha-bay-jobs). Absent where no queue is bound: the job then runs inline. */
  JOBS?: Queue<unknown> | undefined;
  /** Spend events of settled turns (queue tha-bay-spend), consumed into BudgetGovernorDO.ingest. Absent: events are ingested inline. */
  SPEND?: Queue<unknown> | undefined;
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
  /** State of /media/*: "off" answers 503; "throttle" applies RL_MEDIA per network and answers 429 when denied; anything else serves (default "on"). M01d3. */
  MEDIA_ROUTE?: 'on' | 'throttle' | 'off' | undefined;
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
  /** Rate Limiting binding of /media/* under MEDIA_ROUTE="throttle" (M01d3): 1000 per 10 s per network key. Absent: no limit. */
  RL_MEDIA?: RateLimit | undefined;
  /** Rate Limiting binding of class `talk` (M06a3): 4 turns per 10 s per player, burst control only (the quotas are exact). Absent: no limit. */
  RL_TALK?: RateLimit | undefined;
  /** `live` calls Anthropic; anything else (including absent) replays recorded streams. Production must be `live` (check:prod-routes). */
  ANTHROPIC_MODE?: string | undefined;
  /** Anthropic key of the workspace `npc-runtime` (Worker secret, M06a3). Absent in live mode: talk answers upstream_unavailable. */
  ANTHROPIC_API_KEY?: string | undefined;
  /** AI Gateway base URL `https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/anthropic` (gw-dialogue). Unset: calls go to the Anthropic API directly (U-NPC-02). */
  AIG_BASE?: string | undefined;
  /** Value of the `env` field of `cf-aig-metadata`; default is ENVIRONMENT. The synthetic T4 run sets `synthetic` (M14b1). */
  AIG_ENV?: string | undefined;
  /** Workers AI (M06a4): `@cf/baai/bge-m3` embeddings for NPC memory and Aura text-to-speech. No key. Absent: memory and voice are skipped. */
  AI?: Ai | undefined;
  /** Background jobs of the NPC builder (queue tha-bay-npc-builder, M06b1): validate, soul generation, probes. Absent (and in Previews): the job runs inline. */
  BUILDER?: Queue<unknown> | undefined;
  /** `live` calls OpenAI moderation and Workers AI Llama Guard; anything else replays fixtures. Production must be `live` (check:prod-routes). */
  MODERATION_MODE?: string | undefined;
  /** OpenAI key for `/v1/moderations` (Worker secret, M06b1). Absent in live mode: validation falls back to Llama Guard. */
  OPENAI_MODERATION_API_KEY?: string | undefined;
  /** Anthropic key of the workspace `npc-builder` (Worker secret, M06b1): builder classifier, soul generation, preview and probes. Absent in live mode: the soul job answers upstream_unavailable. */
  ANTHROPIC_BUILDER_KEY?: string | undefined;
  /** ElevenLabs key for the t2 voice tier (Worker secret, optional; Q-20 keeps t2 off). Absent: t2 is never selected. */
  ELEVENLABS_API_KEY?: string | undefined;
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
