// C12 1.1 — API surface types shared by the client and services/edge.
// Copied from spec/domains/09-backend-contracts.md sections 2.2 and 2.5 and 09-backend-contracts-1.1.md section 2.
// Types and constants only; no IO.

export const C12_VERSION = '1.1.0' as const;

export type ApiErrorCode =
  | 'bad_request' | 'unauthorized' | 'forbidden' | 'not_found' | 'conflict' | 'gone'
  | 'payload_too_large' | 'unsupported_media_type' | 'rate_limited' | 'quota_exhausted'
  | 'budget_offline' | 'region_blocked' | 'age_blocked' | 'tier_required' | 'build_mismatch'
  | 'feature_disabled' | 'kill_switched' | 'moderation_blocked' | 'upstream_unavailable' | 'internal';

export interface ApiError {
  error: {
    code: ApiErrorCode;
    message: string;
    requestId: string;
    retryAfterMs?: number;
    details?: Record<string, unknown>;
  };
}

export const HTTP_FOR: Record<ApiErrorCode, number> = {
  bad_request: 400, unauthorized: 401, forbidden: 403, not_found: 404, conflict: 409, gone: 410,
  payload_too_large: 413, unsupported_media_type: 415, rate_limited: 429, quota_exhausted: 429,
  budget_offline: 503, region_blocked: 451, age_blocked: 403, tier_required: 403, build_mismatch: 409,
  feature_disabled: 404, kill_switched: 410, moderation_blocked: 422, upstream_unavailable: 503, internal: 500,
};

export type FeatureFlag =
  | 'mp.enabled' | 'npc.dialogue' | 'npc.voice' | 'npc.builder' | 'cutscene.generated'
  | 'forum.enabled' | 'ugc.publish' | 'auth.openaiWeb' | 'auth.thirdweb' | 'telemetry.verbose'
  | 'mods.enabled' | 'mods.script' | 'mods.ui';

// Route 27 (spec/domains/09-backend-contracts.md section 2.5; M05b1).
export interface CutsceneStatus {
  key: string; state: 'ready' | 'pending' | 'absent' | 'failed' | 'blocked';
  manifestUrl?: string;             // media.<domain>/cutscenes/<key>/manifest.json when ready (C09, S03/S05 shape)
  reason?: 'not_in_catalog' | 'kill_switched' | 'budget' | 'region';
}

export interface BootConfig {
  build: string;
  minClientBuild: string;
  /** blocked: online features hidden; offline single-player still runs from cache. */
  region: 'ok' | 'blocked';
  /** `modsUi` is absent in v1 (DN-S12-02). */
  hosts: { api: string; rt: string; id: string; media: string; ugc: string; modsUi?: string };
  /** Key of the current C07 AssetCatalog; empty until M01d. */
  assetCatalog: string;
  flags: Record<FeatureFlag, boolean>;
  /** BudgetGovernor level (D-28). */
  gov: 0 | 1 | 2 | 3;
}
