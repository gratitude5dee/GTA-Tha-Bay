// C12 1.1 — API surface types shared by the client and services/edge.
// Copied from spec/domains/09-backend-contracts.md sections 2.2 and 2.5 and 09-backend-contracts-1.1.md section 2.
// Types and constants only; no IO.
// M00e adds the C12 1.0 shapes TokenRes and IdentityStateDTO (09-backend-contracts.md section 2.5) and the 1.3 members
// (09-backend-contracts-1.3.md section 2) without changing C12_VERSION (1.3 section 4).

import type { AgeBracket } from '../identity.ts';

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
  | 'mods.enabled' | 'mods.script' | 'mods.ui'
  | 'auth.password';

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

// Route 5 (M04b3, 09-backend-contracts.md section 2.5): the P0 play-token mint. The proof signs "pt-req|" + pid + "|" + ts (raw r||s, base64url).
/** The DOM `JsonWebKey` shape restricted to what a P-256 public key carries (shared has no DOM types). */
export interface DeviceJwk { kty?: string; crv?: string; x?: string; y?: string; [member: string]: unknown }
export interface PlayTokenReq { pid: string; jwk: DeviceJwk; ts: number; sig: string; age: '18p' }
export interface PlayTokenRes { token: string; exp: number }

// Route 8 and the exchange routes (09-backend-contracts.md section 2.5).
export interface TokenRes { accessToken: string; exp: number; refreshToken: string; refreshExp: number; state: IdentityStateDTO }
export interface IdentityStateDTO { profileId: string; tier: 'local' | 'device' | 'linked'; providers: { id: string; linkedAt: number }[] }

// C12 1.3 password accounts, routes 58-65 (09-backend-contracts-1.3.md section 2; ADR-ACCT-01).
export interface PasswordUser { id: string /* Supabase user id */; username: string /* ^[a-z0-9_]{3,20}$ */ }
export interface PasswordSession { accessToken: string /* SB */; expiresIn: number /* seconds */ }   // the refresh token travels only in the HttpOnly cookie dv-rt
export interface SignupReq { username: string; password: string /* 8-256 chars */; ageBracket: AgeBracket; termsVersion: string }   // route 58
export interface LoginReq { username: string; password: string; ageBracket?: AgeBracket; termsVersion?: string }                 // route 59; the optional pair is the re-acceptance
export interface PasswordSessionRes { user: PasswordUser; session: PasswordSession }                                             // routes 58-60 before M12a1
export type PasswordSignInRes = PasswordSessionRes | TokenRes;                                                                     // routes 58-59; TokenRes from M12a1 (discriminate on 'session' in res)
export interface LogoutRes { ok: true }                                                                                            // route 61
export interface PasswordMeRes { user: PasswordUser }                                                                              // route 62
export interface PasswordExportRes { username: string; ageBracket: '18p'; termsVersion: string; acceptedAt: number; createdAt: number }   // route 65; epoch ms
export interface TermsRequiredDetails { reason: 'terms_required'; termsVersion: string }                                         // ApiError.error.details of a 403 'forbidden' on routes 59, 60 and 65
