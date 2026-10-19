# 04 — Data models, part 7: C11 room protocol, C12 API and identity types, C16 telemetry

> Wave 5 integration (Architect), 2026-10-18. Part of `spec/04-data-models.md`. Text at 06 v1.1, copied verbatim from `spec/domains/09-backend-contracts.md` §1–§3 and `09-backend-contracts-1.1.md` §2, §4 (S09). The owner specs stay normative. The route table (#1–53), hosts and rate limits are in the owner spec and `spec/05-api-and-realtime.md`; the database is part 10 of this file set. The telemetry batch JSON Schema below is integration text derived from the C16 TypeScript; the TypeScript wins on any difference.

## C11 — `NetMessage` + room protocol v2

| Field | Value |
|---|---|
| Owner · version | S09 · `C11_VERSION = '1.0.0'`; wire `PROTOCOL_VERSION = 2` |
| Source paths | `packages/net/src/protocol/v2.ts`, `packages/net/src/protocol/codec.ts` (pure encode/decode, bounds-checked, fuzz-tested); clock `packages/net/src/clock.ts` |
| Defined in | `09-backend-contracts.md` §1.1–§1.9 (rules, join/resume sequence, clock, exclusions) |
| Created in | M12b family (rooms core); hardened in M12c family |
| Consumers | S01, S02, S06, S07, S08, S10, S12, S13; milestones M12b family, M12c family (`load:rooms`), M12d, M12e |

Rules (§1.1): one WebSocket per player per room to `wss://rt.<domain>`; client game frames binary little-endian, the only client text frame is `ping`; server JSON text only for `welcome`, `handoff`, `notice`, `kick`; the server assigns `sid` and `slot`, profile ids never appear on the wire; `seq` mod 2¹⁶ with a 32,768 window; authority `validated` in M12b (`authoritative` only by ADR after the M12c load test, A-04 v1); any active mod is refused with close 4007.

```ts
// packages/net/src/protocol/v2.ts
export const PROTOCOL_VERSION = 2 as const;
export const C11_VERSION = '1.0.0' as const;   // contract version; PROTOCOL_VERSION is the wire number

export const NET = {
  SERVER_HZ: 20, TICK_MS: 50, CLIENT_SIM_HZ: 60,           // A-04, C02
  CAP_DEFAULT: 16, CAP_MAX: 32,                            // D-06; CAP_MAX behind flag rooms.capMax
  MAX_CLIENT_FRAME_B: 2048, MAX_SERVER_FRAME_B: 16384,
  BUCKET_BURST: 40, BUCKET_PER_S: 30,                      // per socket token bucket
  STRIKES_TO_CLOSE: 5,                                     // malformed/oversize frames per 10 s
  ACK_INTERVAL_MS: 250, ACK_DEGRADE_TICKS: 10, ACK_KICK_TICKS: 40,
  AFK_STOP_MS: 60_000, CHECKPOINT_TICKS: 100, EMPTY_GC_MS: 600_000,
  CLIENT_PING_MS: 20_000, LIVENESS_TIMEOUT_MS: 30_000,
  RESUME_TTL_MS: 60_000, RESUME_REFRESH_MS: 30_000,
  EVENT_REPLAY_MS: 15_000, EVENT_REPLAY_MAX: 256,
  TICKET_TTL_MS: 30_000,
  CELL_M: 64, INTEREST_FOOT_M: 150, INTEREST_VEHICLE_M: 300, INTEREST_HYSTERESIS_M: 70,
  BAND_NEAR_M: 50,        // ≤50 m every tick; 50 m–radius every 2nd tick; beyond radius (hysteresis zone) every 4th
  INTERP_MIN_MS: 45, INTERP_MAX_MS: 300, INTERP_INITIAL_MS: 80, INTERP_DECAY: 0.02,
  EXTRAP_MAX_MS: 250, CLOCK_WINDOW: 90, SNAP_BUFFER: 20,
  RECONNECT_MIN_MS: 250, RECONNECT_MAX_MS: 4000,
  CHAT_MAX_CHARS: 280, MOBILE_SEND_HZ: 10,
} as const;
```

```ts
export enum Frame {            // first byte of every binary frame
  IN = 1,      // c→s input + claimed pose, 20 Hz (10 Hz on mobile with 2 samples)
  SNAP = 2,    // s→c per-recipient snapshot
  EV = 3,      // s→c reliable event, evSeq-numbered
  ACK = 4,     // c→s last snapshot tick + last evSeq, every 250 ms
  BYE = 5,     // c→s clean leave (frees slot now, no ghost)
  ACT = 6,     // c→s action request (vehicle enter/exit, interact, pickup, mission join)
  CHAT = 7,    // c→s text chat (opt-in setting; off by default)
  // 8..15 reserved: VSIG (voice signaling) 8, DELTA_SNAP 9 (M12c+ optimisation)
}

export enum Close {
  Normal = 1000, GoingAway = 1001, Policy = 1008, TooSlow = 1013,
  Auth = 4001, BuildMismatch = 4002, RoomFull = 4003, Kicked = 4004,
  ResumeExpired = 4005, RegionBlocked = 4006, ModsActive = 4007, Draining = 4008,
}
```

```ts
/** IN (c→s). Header 16 B + n × 12 B samples + optional 16 B pose. ≤ 2048 B. */
export interface InHeader {
  type: Frame.IN;          // u8  @0
  flags: number;           // u8  @1  bit0 HAS_POSE, bit1 IN_VEHICLE, bit2 PAUSED (menu/AFK hint)
  seq: number;             // u16 @2  per-socket, wraps
  clientTimeMs: number;    // u32 @4  performance.now() truncated, for RTT/clock
  inputTick: number;       // u32 @8  client's estimate of server tick of sample[0]
  sampleCount: number;     // u8  @12 1..2 (desktop/XR 1 @20 Hz; mobile 2 @10 Hz)
  _pad: [0, 0, 0];         //     @13..15
}
export interface InSample {          // 12 B, one per 50 ms server tick
  moveX: number; moveY: number;      // i8 ×2  −127..127
  yaw: number;                       // u16
  pitch: number;                     // i16
  buttons: number;                   // u16  C03 SimButton bits 0–15 (S01 owns the table; bits ≥ 16 are never sent)
  throttle: number; steer: number;   // i8 ×2
  brake: number;                     // u8   0..127 (= C03 InputFrame.brake, so prediction replays match)
  _pad: 0;                           // u8
}
export interface InPose {            // 16 B, present when flags.HAS_POSE (always in `validated` rooms)
  x: number; y: number; z: number;   // f32 ×3
  yaw: number;                       // u16
  vehicleSlot: number;               // u16  0xFFFF = on foot
}

/** SNAP (s→c). Header 16 B + count × 28 B. ≤ 16 KiB (≤ 584 entities; v1 interest caps far lower). */
export interface SnapHeader {
  type: Frame.SNAP;        // u8  @0
  flags: number;           // u8  @1  bit0 DEGRADED (recipient on every-other-tick), bit1 CORRECTION (own pose rejected → snap to entry)
  count: number;           // u16 @2
  tick: number;            // u32 @4  server tick
  serverTimeMs: number;    // u32 @8  Date.now() mod 2^32
  ackSeq: number;          // u16 @12 last IN.seq applied for this recipient
  _pad: number;            // u16 @14
}
export enum EntityKind { Player = 0, Vehicle = 1, Npc = 2, Pickup = 3 }
export enum EntityFlag { InVehicle = 1, Downed = 2, Action = 4, Ragdoll = 8, Entering = 16, Interior = 32, Afk = 64, Braking = 128 }
export interface SnapEntity {        // 28 B
  slot: number;                      // u16  player slot, or vehicle/npc/pickup slot (namespace = kind)
  kind: EntityKind;                  // u8
  flags: number;                     // u8   EntityFlag bitset
  x: number; y: number; z: number;   // f32 ×3
  yaw: number;                       // u16
  vx: number; vy: number; vz: number;// i16 ×3 cm/s
  anim: number;                      // u8   AnimStateId (S01 registry, 01-engine-contracts.md)
  seat: number;                      // u8   0xFF none
  vehicleSlot: number;               // u16  0xFFFF none
}

/** EV (s→c). Header 8 B + UTF-8 JSON payload (≤ 1024 B). */
export interface EvHeader { type: Frame.EV; kind: EvKind /*u8*/; evSeq: number /*u16*/; len: number /*u16*/; _pad: number /*u16*/ }

/** ACK (c→s). 8 B. */
export interface AckFrame { type: Frame.ACK; _pad: 0; lastEvSeq: number /*u16*/; lastSnapTick: number /*u32*/ }

/** BYE (c→s). 2 B: type, reason u8 (0 quit, 1 handoff, 2 background). */
/** ACT (c→s). 12 B. */
export interface ActFrame { type: Frame.ACT; kind: ActKind /*u8*/; actSeq: number /*u16*/; target: number /*u32 entity slot or mission instance id*/; arg: number /*u32*/ }
export enum ActKind { EnterVehicle = 1, ExitVehicle = 2, Interact = 3, Pickup = 4, JoinActivity = 5, LeaveActivity = 6 }
/** CHAT (c→s). 4 B header (type, _pad, u16 len) + UTF-8 ≤ 280 chars. Server moderates before fan-out. */
```

```ts
export enum EvKind {
  Joined = 1, Left = 2, Appearance = 3, VehicleSpawn = 4, VehicleOwner = 5, ActResult = 6,
  Hit = 7, Feed = 8, Activity = 9, Chat = 10, World = 11, Resume = 12, TeleportGrant = 13,
  Notice = 14, NpcBusy = 15, Correction = 16,
}
export interface EvPayloads {
  [EvKind.Joined]: { slot: number; sid: string; name: string; look: string /* base64 AppearanceV1 ≤ 512 B: S10's versioned binary encoding of C05 CoreSlice.avatar (PlayerAvatar); fixed obligation on S10, 06 §4.3 */ };
  [EvKind.Left]: { slot: number; reason: 'quit' | 'timeout' | 'kicked' | 'handoff' };
  [EvKind.Appearance]: { slot: number; look: string };
  [EvKind.VehicleSpawn]: { vehicleSlot: number; prefabId: string /* C06 PrefabDef id, kind 'vehicle' */; seed: number; x: number; y: number; z: number; yaw: number };
  [EvKind.VehicleOwner]: { vehicleSlot: number; ownerSlot: number | null };
  [EvKind.ActResult]: { actSeq: number; ok: boolean; reason?: 'occupied' | 'too_far' | 'cooldown' | 'invalid' };
  [EvKind.Hit]: { from: number; to: number; kind: 'melee' | 'vehicle' | 'fall'; amount: number };   // no firearms (D-30)
  [EvKind.Feed]: { key: string; params: Record<string, string | number> };                     // i18n key, never free text
  [EvKind.Activity]: { instanceId: number; modeId: string; state: 'open' | 'countdown' | 'running' | 'finished'; data: unknown /* mode-owned, ≤ 768 B */ };
  [EvKind.Chat]: { slot: number; msgId: number; text: string };
  [EvKind.World]: { clockT: number /* C06 WorldClockState.t, integer game half-seconds since day 0 */; weather: WeatherPreset /* S01 engine-world.ts */; trafficSeed: number };
  [EvKind.Resume]: { token: string; exp: number };
  [EvKind.TeleportGrant]: { x: number; y: number; z: number; yaw: number; reason: 'spawn' | 'fast_travel' | 'activity' };
  [EvKind.Notice]: { kind: 'drain' | 'maintenance' | 'cap_change'; at: number };
  [EvKind.NpcBusy]: { npcId: string; bySlot: number | null };   // reserved: never emitted in v1 (DL-350)
  [EvKind.Correction]: { x: number; y: number; z: number; yaw: number; vehicleSlot: number | null; reason: 'speed' | 'bounds' | 'teleport' | 'vehicle' };
}
```

```ts
export interface WelcomeV2 {
  t: 'welcome'; protocol: 2; roomId: string; sid: string; slot: number;
  hz: 20; tick: number; serverTimeMs: number; cap: number;
  authority: 'validated' | 'authoritative';
  cellSize: 64; interest: { foot: 150; vehicle: 300; hysteresis: 70 };
  peers: { slot: number; sid: string; name: string; look: string }[];
  world: EvPayloads[EvKind.World];
  resume: { token: string; exp: number };
  lastEvSeq: number;
  resumed: boolean;              // true when a resume token restored this slot
}
export interface HandoffV2 { t: 'handoff'; roomId: string; ticket: string; reason: 'district' | 'rebalance' }  // reserved for district shards (post-M12c)
export interface NoticeV2  { t: 'notice'; kind: 'drain' | 'maintenance'; at: number }
export interface KickV2    { t: 'kick'; code: string /* policy code */ }
```

Not in C11 v2 (§1.9, §5 of the 1.1 file): voice, `ActKind.FightInput` (waits for the post-M12b fight-room ADR), `authoritative` server physics. Per-class speed caps live in `config/net.speedcaps.json` (m/s: foot 12, D 58, C 77, B 89, A 105, S 119, R 63, police 73, default 95; C12 1.1 §3).

## C12 — API surface, identity, DataPort (types)

| Field | Value |
|---|---|
| Owner · version | S09 · `C12_VERSION = '1.3.0'` from M12c1; `'1.1.0'` from M00a until then (1.2 additions: `spec/domains/09-backend-contracts-1.2.md` §1–§2, DL-223; 1.3 additions, landed by M00e: `09-backend-contracts-1.3.md` §1–§2, DL-604) |
| Source paths | `packages/shared/src/api/v1.ts`, `api/budget.ts`, `api/mods.ts` (C14/C17 DTOs, S12 semantics), `data-port.ts`, `identity.ts` (re-exported by `@dv/identity`), `db.gen.ts` (generated); request schemas `packages/shared/schemas/api/*.schema.json` generated by `tools/ci/gen-api-schemas.ts` |
| Defined in | `09-backend-contracts.md` §2; `09-backend-contracts-1.1.md` §1–§3; `09-backend-contracts-1.2.md` §1–§2; `09-backend-contracts-1.3.md` §1–§2; `09-backend-db.md`; `09-backend-ops.md` §3, §5 |
| Created in | M00a (`ApiError`, `HTTP_FOR`, `BootConfig`, `FeatureFlag`); M00e (1.3: `'password'`, `auth.password`, DTOs of routes 58–62, 64, 65); M04b3 (local identity, play token); M05d (DataPort, migrations 0001–0002); M12a1 (P1 identity, cloud saves) |
| Consumers | S03, S04, S05, S06, S08, S10, S12, S13; milestones M00a, M00e, M04b3, M05b1, M05d, M06a1, M06a3, M06b1, M12a1, M12a2, M12e, M13a2, M13b1, M13c1, M13d1, M14a |

Conventions (§2.1): JSON bodies, SSE for dialogue; `X-Client-Build` request header; `X-Request-Id` (UUIDv7) response header; `Idempotency-Key` (UUIDv7) on every write marked ⓘ, stored 24 h; ids UUIDv7 minted in the Worker; times epoch ms; pagination `?cursor=<opaque>&limit≤50` → `{items, next?}`.

Errors:

```ts
// packages/shared/src/api/v1.ts
export const C12_VERSION = '1.1.0' as const;   // M00a writes 1.1.0; M12c1 sets '1.3.0' (1.2: routes 54–57 DTOs (api/ops.ts), ProgressDelta, LeaderboardSubmit, CLI AccessClaims; 1.3 from M00e: delta below)
export type ApiErrorCode =
  | 'bad_request' | 'unauthorized' | 'forbidden' | 'not_found' | 'conflict' | 'gone'
  | 'payload_too_large' | 'unsupported_media_type' | 'rate_limited' | 'quota_exhausted'
  | 'budget_offline' | 'region_blocked' | 'age_blocked' | 'tier_required' | 'build_mismatch'
  | 'feature_disabled' | 'kill_switched' | 'moderation_blocked' | 'upstream_unavailable' | 'internal';
export interface ApiError {
  error: { code: ApiErrorCode; message: string; requestId: string; retryAfterMs?: number;
           details?: Record<string, unknown> };
}
export const HTTP_FOR: Record<ApiErrorCode, number> = {
  bad_request: 400, unauthorized: 401, forbidden: 403, not_found: 404, conflict: 409, gone: 410,
  payload_too_large: 413, unsupported_media_type: 415, rate_limited: 429, quota_exhausted: 429,
  budget_offline: 503, region_blocked: 451, age_blocked: 403, tier_required: 403, build_mismatch: 409,
  feature_disabled: 404, kill_switched: 410, moderation_blocked: 422, upstream_unavailable: 503, internal: 500,
};
```

Identity (pure types in `@dv/shared`, DL-055):

```ts
// packages/shared/src/identity.ts
export type ProviderId = 'device' | 'openai' | 'thirdweb' | 'supabase-oauth';
export type Tier = 'local' | 'device' | 'linked';         // P0 | P1 | P2/P3 (D-04)
export type AgeBracket = 'u13' | '13_15' | '16_17' | '18p';
export interface IdentityState {
  profileId: string;                   // UUIDv7 minted on device at first launch; never a provider subject; not the C05 save ProfileId (one identity holds ≤ 64 save profiles)
  tier: Tier;
  ageBracket: AgeBracket | null;       // from the neutral age screen (S10); only '18p' may use online features (D-30)
  providers: { id: ProviderId; display?: string; linkedAt: number }[];
  deviceKeyThumbprint: string;         // RFC 7638 SHA-256 thumbprint of the device public JWK
}
export interface IdentityService {
  current(): IdentityState;
  /** P0: HMAC play token; P1+: ES256 access JWT. null if offline or under-18. */
  authHeader(): Promise<{ Authorization: string } | null>;
  register(turnstileToken: string): Promise<IdentityState>;            // P0 → P1 (M12a)
  link(p: Exclude<ProviderId, 'device'>): Promise<IdentityState>;      // full-page redirect via /account/* (M13c, M14a)
  unlink(p: ProviderId): Promise<IdentityState>;                       // refused if it would orphan the profile
  signInOnNewDevice(p: 'thirdweb' | 'openai'): Promise<IdentityState>; // may open a merge request
  forget(): Promise<void>;                                             // DELETE /api/v1/me, then wipe local
  onChange(cb: (s: IdentityState) => void): () => void;
}
```

Token formats:

```ts
/** P0 play token (rate-limit and quota identity only; M06a). Header: `Authorization: PlayToken <tok>`. */
export interface PlayTokenClaims { v: 1; pid: string; dkt: string; age: '18p'; iat: number; exp: number /* iat + 24 h */; kid: string }
// tok = "pt1." + b64url(JSON claims) + "." + b64url(HMAC-SHA256(PLAY_TOKEN_HMAC[kid], first two parts))

/** P1+ access JWT, ES256, header {alg:'ES256', kid, typ:'JWT'}, TTL 1 h. Header: `Authorization: Bearer <jwt>`. */
export interface AccessClaims {
  iss: string;                 // 'https://id.<domain>'
  sub: string;                 // profile_id
  aud: 'tha-bay' | 'tha-bay-cli';   // 1.2: 'tha-bay-cli' = RFC 8628 CLI token (M13c1)
  role: 'authenticated';       // required by Supabase Third-Party Auth [research/auth-ugc-input-maps.md §1.2]
  tier: 'device' | 'linked';
  prv: ProviderId[];
  ab: AgeBracket;
  scp?: (StaffScope | CliScope)[];   // staff scopes, or exactly ['mods:publish'] on a CLI token (CliScope, 1.2)
  iat: number; exp: number; jti: string;
}
export type StaffScope = 'mod:review' | 'mod:trust_lead' | 'admin' | 'ops';
/** CLI token from RFC 8628 device flow (M13c): same JWT shape, aud 'tha-bay-cli', scp ['mods:publish'], TTL 1 h, refresh 30 d. */
```

Request and response types (selected; the remaining DTOs follow in the same file):

```ts
export interface BootConfig {
  build: string; minClientBuild: string;
  region: 'ok' | 'blocked';                     // blocked → online features hidden; offline single-player still runs from cache
  hosts: { api: string; rt: string; id: string; media: string; ugc: string };
  assetCatalog: string;                          // key of the current C07 AssetCatalog (manifests/assets-<sha256>.json); the C07 CatalogPointer ships as /asset-catalog.json in the Worker's static assets [research/gap-ci-cd-release-assets.md §2.2]
  flags: Record<FeatureFlag, boolean>;
  gov: 0 | 1 | 2 | 3;                            // BudgetGovernor level (D-28)
}
export type FeatureFlag = 'mp.enabled' | 'npc.dialogue' | 'npc.voice' | 'npc.builder' | 'cutscene.generated'
  | 'forum.enabled' | 'ugc.publish' | 'auth.openaiWeb' | 'auth.thirdweb' | 'telemetry.verbose';

export interface PlayTokenReq { pid: string; jwk: JsonWebKey; ts: number; sig: string; age: '18p' }
export interface PlayTokenRes { token: string; exp: number }
export interface RegisterReq { turnstileToken: string; displayName?: string; age: '18p' }   // auth via PlayToken header
export interface TokenRes { accessToken: string; exp: number; refreshToken: string; refreshExp: number; state: IdentityStateDTO }
export type TokenReq = { grant: 'refresh'; refreshToken: string } | { grant: 'device_assertion'; pid: string; ts: number; sig: string /* over "tok-req|pid|ts" */ };
export interface IdentityStateDTO { profileId: string; tier: 'local' | 'device' | 'linked'; providers: { id: string; linkedAt: number }[] }

/** RFC 8628 (M13c). */
export interface DeviceCodeRes { device_code: string; user_code: string /* 8 chars XXXX-XXXX */; verification_uri: string /* https://<domain>/link */; expires_in: 600; interval: 5 }
export interface DeviceTokenReq { device_code: string; grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }
// errors per RFC 8628: authorization_pending | slow_down | access_denied | expired_token

/** Cloud saves (M12a). Sync unit = one C05 SaveRecord (S01) per (saveProfileId, SlotId); S09 treats `data` as opaque JSON ≤ 256 KiB inline. */
export interface CloudSaveRecord {
  saveProfileId: string;            // C05 ProfileId: 32-hex, ≤ 64 per identity profile [research/repos-grand-v.md (d)]
  slot: SlotId;                     // C05 SlotId verbatim: core | settings | sandbox | story:auto|1|2|3 | mode:<id> | mod:<id>
  kind: SliceKind; schema: number;  // copied from the SaveRecord; a schema newer than the build is refused (NEWER_SCHEMA)
  version: number;                  // server-assigned monotonic per (profile, saveProfile, slot)
  updatedAt: number;                // SaveRecord.savedAt (client ms) round-tripped
  sha256: string; bytes: number;    // computed by the Worker over the uploaded bytes; C05's fnv1a64 `checksum` stays inside the record
  data?: unknown;                   // the C05 SaveRecord when bytes ≤ 262,144
  blobUrl?: string;                 // presigned GET (15 min) when stored in R2 (records ≤ 2 MiB, C05 SAVE_LIMITS)
  deletedAt?: number;               // tombstone
}
export interface SaveProfileUpsert { name: string /* 1–80, NFC, unique per identity */; createdAt: number /* C05 ProfileMeta.createdAt, ms */ }   // route 50 (DL-063)
export interface SaveSyncRes { profiles: { id: string; name: string; createdAt: number; updatedAt: number; deletedAt?: number }[]; records: CloudSaveRecord[]; cursor: string }
// PUT conflict: 409 {error:{code:'conflict', details:{server: CloudSaveRecord}}}; the client stores the server copy in the dv-saves `conflicts` store and the player picks (C05 rule 10).

export interface AssignReq { district: 'sf'; inviteCode?: string; modsActive: boolean }
export interface AssignRes { roomId: string; wsUrl: string; ticket: string; ticketExp: number; build: string }

export interface CutsceneStatus {
  key: string; state: 'ready' | 'pending' | 'absent' | 'failed' | 'blocked';
  manifestUrl?: string;             // media.<domain>/cutscenes/<key>/manifest.json when ready (C09, S03/S05 shape)
  reason?: 'not_in_catalog' | 'kill_switched' | 'budget' | 'region';
}
export interface RosterFlags { etag: string; killed: Record<string /*npcId*/, { scope: KillScope[]; standIn: string }> ; updatedAt: number }
export type KillScope = 'all' | 'spawn' | 'fighter' | 'cutscene' | 'voice' | 'marketing' | 'ugc';

export type ReportCategory = 'child_safety' | 'intimate_image' | 'real_person_likeness' | 'copyright'
  | 'harassment_hate' | 'violence_threat' | 'self_harm' | 'spam_scam' | 'other';
export interface ReportReq { target: { kind: ModSubject; id: string }; category: ReportCategory; note?: string /* ≤ 1000 */ }
export type ModSubject = 'npc_draft' | 'npc_asset' | 'mod_version' | 'experience' | 'forum_post' | 'forum_attachment' | 'chat_turn' | 'profile';
// category 'copyright' → 409 {details:{redirect:'/legal/dmca'}}: a §512 notice needs its own elements [research/gap-trust-safety-tooling.md §6.7]

export interface UploadReq { purpose: 'npc_image' | 'npc_backstory' | 'mod_archive' | 'experience_thumb' | 'forum_attachment' | 'save_blob';
  contentType: 'image/png' | 'image/jpeg' | 'image/webp' | 'text/markdown' | 'text/plain' | 'application/zip' | 'application/octet-stream'; bytes: number }
export interface UploadRes { uploadId: string; putUrl: string; expiresAt: number; headers: { 'Content-Type': string } }
```

DataPort (server side; one Supabase implementation plus `InMemoryDataPort`; no supabase-js in `apps/web`, D-02):

```ts
export interface Ctx { profileId: string | null; tier: Tier; jwt?: string; requestId: string; staff?: StaffScope[] }
export interface DataPort {
  profiles: { ensureLocal(pid: string, dkt: string): Promise<'created' | 'exists' | 'key_mismatch'>;
              upgrade(ctx: Ctx, displayName?: string): Promise<void>; get(ctx: Ctx): Promise<ProfileRow | null>;
              exportAll(ctx: Ctx): Promise<ReadableStream<Uint8Array>>; forget(ctx: Ctx): Promise<void> };
  identity: { putRefresh(pid: string, family: string, hash: Uint8Array, exp: number): Promise<void>;
              rotateRefresh(hash: Uint8Array): Promise<{ pid: string; family: string } | 'reused' | null>;
              link(ctx: Ctx, provider: ProviderId, subject: string): Promise<'linked' | { mergeRequestId: string }>;
              deviceCode: DeviceCodeStore };
  saves: { sync(ctx: Ctx, since?: string): Promise<SaveSyncRes>;
           putProfile(ctx: Ctx, saveProfileId: string, p: SaveProfileUpsert): Promise<void>;   // route 50
           deleteProfile(ctx: Ctx, saveProfileId: string): Promise<void>;                     // route 51
           put(ctx: Ctx, rec: CloudSaveRecord, ifMatch: number | null): Promise<CloudSaveRecord | { conflict: CloudSaveRecord }>;
           tombstone(ctx: Ctx, id: SaveKey, ifMatch: number): Promise<void> };
  progress: { commit(pid: string, key: string, delta: ProgressDelta): Promise<'applied' | 'duplicate'> };
  leaderboards: { top(board: string, n: number): Promise<ScoreRow[]>; submit(ctx: Ctx, s: LeaderboardSubmit /* 1.2: ScoreSubmit | TycoonDailySubmit */): Promise<'accepted' | 'rejected'> };
  npcMemory: { relationship(pid: string, npcId: string): Promise<RelationshipRow | null>;
               topK(pid: string, npcId: string, q: Float32Array, gameTime: number /* C06 clock half-seconds */, k?: number): Promise<MemoryHit[]>;
               write(pid: string, npcId: string, m: MemoryWrite[]): Promise<void>;
               applySummary(pid: string, npcId: string, s: SummaryPatch): Promise<void> };
  cutscenes: { record(row: CutsceneRow): Promise<void>; inCatalog(key: string): Promise<boolean> };
  ugc: UgcStore; forum: ForumStore; moderation: ModerationStore; ledger: LedgerStore; roster: RosterStore;
}
```

**C12 1.1 delta** (DL-092, DL-100, DL-101, DL-103, DL-119, DL-139):

```ts
// packages/shared/src/identity.ts — IdentityService gains (S10, DL-101):
attestAge(bracket: AgeBracket): Promise<IdentityState>;   // persists the bracket in IndexedDB dv-identity; from M12a also POSTs route 15
// In v1 every bracket other than '18p' is blocked by the neutral age screen (DL-139); AgeBracket keeps all four values for a later TEEN_MODE.

// packages/shared/src/api/budget.ts — PlayerQuota.reserve kind gains 'builder_text' (S04, DL-119):
//   soul generation and builder preview chat; counted apart from the dialogue cost cap; caps P0/P1 2/day and 1 per draft per hour,
//   linked 10/day; billed to the npc-builder Anthropic workspace. 'builder_job' (fal-backed) stays linked-only (D-30).
reserve(r: { kind: 'turn' | 'voice_line' | 'builder_text' | 'builder_job' | 'upload' | 'post' | 'report'; npcId?: string; estMicros: number }): Promise<…>;

// packages/shared/src/api/v1.ts
export type ModSubject = 'npc_draft' | 'npc_asset' | 'npc_soul' | 'mod_version' | 'experience' | 'forum_post' | 'forum_attachment' | 'chat_turn' | 'profile';
export interface RosterFlags { etag: string; killed: Record<string /* NpcId */, { scope: KillScope[]; standIn: AssetRef /* character/<id>, copied from the soul */ }>; updatedAt: number }
export interface BootConfig { /* 1.0 fields */ hosts: { api: string; rt: string; id: string; media: string; ugc: string; modsUi?: string /* absent in v1 (DN-S12-02) */ } }
export type FeatureFlag = /* 1.0 members */ | 'mods.enabled' | 'mods.script' | 'mods.ui';   // all default false until their milestones record a pass

// packages/shared/src/data-port.ts — DataPort.npcMemory imports MemoryWrite, MemoryHit, SummaryPatch from contracts/c10-npc.ts (C10 §B2.6).
```

**C12 1.3 delta** (DL-604, ADR-ACCT-01; M00e lands it): `ProviderId` gains `'password'` (never grants `linked`); `FeatureFlag` gains `'auth.password'` (true exactly when route 58 accepts a sign-up); routes 58–66 with `SignupReq`, `LoginReq`, `PasswordSessionRes`, `PasswordSignInRes` (`PasswordSessionRes | TokenRes`, `TokenRes` from M12a1), `LogoutRes`, `PasswordMeRes`, `PasswordExportRes`, `TermsRequiredDetails` (403 `forbidden` details on routes 59, 60 and 65); route 66 answers the module type `LegalDocRes` (`api/legal.ts`). TypeScript in `09-backend-contracts-1.3.md` §2.

1.1 routes: #52 `DELETE /api/v1/me/npc-memory?npcId=` (M06a4) and #53 `GET /api/v1/mods/revoked?since=<ms>&cursor` → `RevokedRes` (M13a2); amendments to routes 10, 21 (board regex `^(racing|fighter|tycoon)\.[a-z0-9.-]{1,96}$`, validator registry by prefix), 35 and 36 are in `09-backend-contracts-1.1.md` §1.

## C16 — `TelemetryEvent`

| Field | Value |
|---|---|
| Owner · version | S09 · `C16_VERSION = '1.2.0'` from M11a1; `'1.1.0'` from M00a until then (1.2: server-only `app.crash`, `spec/domains/09-backend-contracts-1.2.md` §3, DL-224) |
| Source paths | `packages/shared/src/telemetry.ts`; schemas `packages/shared/schemas/telemetry/batch.schema.json` and `names.schema.json`; client `packages/engine/src/platform/telemetry/` (S11) |
| Defined in | `09-backend-contracts.md` §3; `09-backend-contracts-1.1.md` §4 |
| Created in | M00a (types, batch schema, first names); every emitter milestone adds its names' `$defs`; M14b audits the registry |
| Consumers | every emitter (S01–S04, S06–S08, S10–S12) and S13; milestones M00a, M01c, M05a1, M06a3, M07a1, M08a2, M09a1, M11a family, M13a3, M14b family |

```ts
// packages/shared/src/telemetry.ts
export const C16_VERSION = '1.1.0' as const;   // M00a writes 1.1.0; M11a1 sets '1.2.0' (1.2: server-only 'app.crash')
export interface TelemetryEvent {
  name: TelemetryName;                               // registry below; unknown names are dropped at ingest
  ts: number;                                        // client epoch ms
  sessionId: string;                                 // crypto.randomUUID() per app launch; NEVER the profileId
  props: Record<string, string | number | boolean>;  // ≤ 16 keys; strings ≤ 128 chars; per-name JSON Schema
}
export interface TelemetryBatch {
  v: 1; build: string; seq0: number;                 // seq of events[0] within the session (dedupe)
  env: TelemetryEnvelope; events: TelemetryEvent[];  // ≤ 50 events, body ≤ 64 KiB
}
export interface TelemetryEnvelope {
  tier: QualityTierId;                                          // C13: desktop-ultra | desktop | mobile | mobile-low | xr-quest | xr-visionpro
  deviceClass: DeviceClass;                                     // C13: desktop | iphone | ipad | android | quest | avp | unknown
  osMajor: number; displayMode: 'standalone' | 'tab' | 'xr'; backend: 'webgpu' | 'webgl2';
}
export type TelemetryName =
  | 'app.start' | 'app.ready' | 'app.abnormal_exit' | 'app.cold_resume' | 'app.hidden'
  | 'perf.minute'
  | 'err.js' | 'err.promise' | 'err.gpu' | 'err.asset'
  | 'net.ws' | 'net.api'
  | 'mode.enter' | 'mode.exit' | 'mission.start' | 'mission.fail' | 'mission.complete'
  | 'cutscene.play' | 'npc.turn.client'
  | 'xr.session' | 'settings.tier_override' | 'tier.decision' | 'storage.persist' | 'pose.calibrate' | 'err.sim'
  // server-only (written by Workers/DOs, never accepted from clients):
  | 'genai.cost' | 'quota.block' | 'genjob.state' | 'room.tick' | 'room.hours' | 'budget.level' | 'recon.drift'
  | 'auth.event' | 'mod.case';
```

Required props per name (excerpt; the full JSON Schemas live in `packages/shared/schemas/telemetry/`):

| Name | Props (all required unless `?`) | Sampling |
|---|---|---|
| `app.start` | `nav`, `coi`, `store: 'opfs'|'memory'`, `backend`, `tier` (S11) | 100 % |
| `tier.decision` | `tier`, `source` (C13 `TierDecisionSource`), `benchP90Ms?` (S11) | 100 % |
| `storage.persist` | `granted` (S11) | 100 % |
| `err.sim` | `cause: 'error'|'stall'`, `tick` (S01 `sim.worker` crash) | 100 % |
| `app.ready` | `bootMs`, `phaseShellMs`, `phaseWorldMs`, `nav: 'navigate'|'reload'|'back_forward'` | 100 % |
| `app.abnormal_exit` | `prevSid`, `lastBeatAgoMs`, `scene`, `mode`, `chunkKey`, `memEstMB`, `gpuEstMB`, `cause: 'jetsam'|'gpu_lost'|'hang'|'unknown'` (server classifies) | 100 % |
| `perf.minute` | `fpsP50`, `fpsP5`, `frameP95Ms`, `drawCalls`, `tris`, `texMBEst`, `gpuMBEst`, `memEstMB` | mobile/XR 100 %, desktop 25 % |
| `err.js` | `fp` (message+top-frame hash), `msg` (scrubbed ≤ 128), `top` (file:line:col) | 100 %, ≤ 5 per fp per session |
| `net.ws` | `evt: 'open'|'close'|'resume'|'correction'`, `code?`, `rttMs?` | 100 % |
| `cutscene.play` | `key8` (first 8 hex), `cached`, `fallback`, `reason?` | 100 % |
| `npc.turn.client` | `ttftMs`, `fallback`, `reason?` | 100 % |
| `pose.calibrate` | `ok`, `ms`, `delegate: 'cpu'|'gpu'` (aggregate only; no landmarks, R-IP-04) | 100 % |
| `genai.cost` (server) | `vendor`, `model`, `usdMicros`, `cacheHit`, `tier` | 100 % |
| `room.tick` (server, every 10 s per room) | `p50Ms`, `p99Ms`, `players`, `overloads` | 100 % |

C16 1.1 names (added to `TelemetryName`; props are enums, buckets and numbers only; `tier` comes from the envelope, DL-166):

| Name | Props | Emitter |
|---|---|---|
| `world.stream` | `residentL0`, `missCount`, `uploadP95Ms`, `bytesMB` (10 % sampling) | S02 |
| `mission.start`, `mission.fail`, `mission.complete` (existing names, props now fixed) | `mid` (C09 MissionId), `stage`, `reason?`, `sec`, `attempt` | S03 |
| `unlock.emit` | `id` (C06 `UnlockEventId`) | S03 / ModeHost |
| `cutscene.play` (existing; props added) | `path: 'video' \| 'fallback' \| 'instant'`, `trigger?` (C09 `FallbackTrigger`) | S03 |
| `npc.encounter.client` | `turns`, `fallbacks`, `voiceTier`, `model` | S04 |
| `npc.voice.client` | `ttfaMs`, `tier` | S04 |
| `npc.builder.step` | `step`, `ok` | S04 |
| `racing.start`, `racing.finish`, `racing.pursuit_end`, `racing.photo`, `racing.replay_view` | as `06-racing-data.md` §4.5 | S06 |
| `racing.verify_fail` (server-only) | as `06-racing-data.md` §4.5 | S06 validator |
| `fight.end` | `mode`, `scheme`, `cpu`, `rounds`, `winnerSlot`, `durationS`, `pose` | S07 |
| `pose.session` | `durationS`, `camFpsP50`, `latencyEstP95Ms`, `level`, `endReason` (aggregates only, R-IP-04) | S07 |
| `tycoon.run_end` | `kind`, `weeks`, `win`, `tierScore` | S08 |
| `tycoon.round` | `kind`, `clamped`, `dilutionBp` | S08 |
| `tycoon.negotiation` | `turns`, `fallback`, `clamped` | S08 |
| `ui.page` | `page` (S10 `PageId`), `ms` | S10 |
| `ui.onboard` | `step`, `outcome` | S10 |
| `pwa.install` | `evt` | S10 |
| `mod.install`, `mod.uninstall`, `mod.fault`, `mod.session`, `exp.enter`, `exp.exit` | enums and buckets; `mod` = first 8 hex of SHA-256(`ModId`) | S12 |

Privacy rules (§3, testable by `tools/ci/check-telemetry.ts`): the ingest Worker never reads or stores `CF-Connecting-IP`, `User-Agent` or `Cookie`; no profile id, player id, wallet, email, free text, or coordinates finer than a C08 z=9 chunk key; `scrub()` truncates to 512 characters; consent is device-scoped (`PlatformSettings.telemetryConsent`), both toggles default on (DL-140); Analytics Engine retention 3 months, `telemetry_daily` rollup 25 months [research/gap-observability-cost-guardrails.md Rec 1.5].

**Runtime JSON Schema — telemetry batch** (`packages/shared/schemas/telemetry/batch.schema.json`, draft 2020-12; the Worker checks the 64 KiB body limit before parsing; each event's `props` is then validated against `names.schema.json` `$defs[<name>]`; an unknown name, or a server-only name sent by a client, is dropped, not rejected):

```json
{"$schema":"https://json-schema.org/draft/2020-12/schema","$id":"telemetry-batch-1","type":"object","additionalProperties":false,
 "required":["v","build","seq0","env","events"],
 "properties":{
  "v":{"const":1},"build":{"type":"string","minLength":1},"seq0":{"type":"integer","minimum":0},
  "env":{"type":"object","additionalProperties":false,"required":["tier","deviceClass","osMajor","displayMode","backend"],"properties":{
    "tier":{"enum":["desktop-ultra","desktop","mobile","mobile-low","xr-quest","xr-visionpro"]},
    "deviceClass":{"enum":["desktop","iphone","ipad","android","quest","avp","unknown"]},
    "osMajor":{"type":"integer","minimum":0},"displayMode":{"enum":["standalone","tab","xr"]},"backend":{"enum":["webgpu","webgl2"]}}},
  "events":{"type":"array","minItems":1,"maxItems":50,"items":{"$ref":"#/$defs/event"}}},
 "$defs":{
  "event":{"type":"object","additionalProperties":false,"required":["name","ts","sessionId","props"],"properties":{
    "name":{"type":"string","pattern":"^[a-z0-9_]+(\\.[a-z0-9_]+)+$"},
    "ts":{"type":"integer","minimum":0},
    "sessionId":{"type":"string","pattern":"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"},
    "props":{"type":"object","maxProperties":16,"additionalProperties":{"anyOf":[{"type":"string","maxLength":128},{"type":"number"},{"type":"boolean"}]}}}}}}
```

Example `names.schema.json` entry (the pattern every name follows; `cutscene.play` after DL-193):

```json
{"$defs":{"cutscene.play":{"type":"object","additionalProperties":false,"required":["key8","cached","fallback","path"],"properties":{
  "key8":{"type":"string","pattern":"^[0-9a-f]{8}$"},"cached":{"type":"boolean"},"fallback":{"type":"boolean"},"reason":{"type":"string","maxLength":32},
  "path":{"enum":["video","fallback","instant"]},
  "trigger":{"enum":["not_ready","not_permitted","media_error","start_stall","mid_stall","codec","budget","policy","offline","degraded_sequence","setting_off"]}}}}}
```

**C12 1.2 and C16 1.2 (DL-223, DL-224).** The new shapes are normative in `spec/domains/09-backend-contracts-1.2.md` §2–§3 and are copied verbatim into code: `PresenceTicketRes` (route 54), `ProgressKind` and `ProgressDelta` (route 20), `TycoonDailySubmit` and `LeaderboardSubmit` (route 21), `CliScope`, and the contract file `packages/shared/src/api/ops.ts` with `KickCode`, `KickReq`, `KickRes`, `AlertReq`, `DashName`, `DashRes` (routes 55–57); C16 adds the server-only name `app.crash {reason, build}`.
