# 09 — Backend contracts, part 1c: C12 1.2 and C16 1.2 additions (C11 unchanged)

> Architect, Wave 5 milestone reconciliation, 2026-10-18 (`spec/11-decision-log-2.md` DL-223, DL-224). Part of `spec/domains/09-backend.md`; extends `09-backend-contracts.md` (1.0) and `09-backend-contracts-1.1.md` (1.1), which stay valid as written. Owner of every shape below: **S09**; the semantics owner of each route stays as named. Rule (06 §4.1): additive change = minor bump. **C12 → 1.2.0, C16 → 1.2.0, C11 stays 1.0.0** (wire `PROTOCOL_VERSION` 2). Sources: `spec/05-api-and-realtime.md` §3–§4 (routes 54–57, DL-182…DL-188) and the milestone-author defect reports (`spec/.milestone-defects.md`). Requirements: R-ROLL-02, R-MODE-02, R-MODE-04, R-MOD-02, R-AUTH-03, R-ENG-03, R-PLAT-05.

## 1. C12 1.2 — routes

The route table is now **#1–57**. Routes 54–57 were added to `spec/05-api-and-realtime.md` §3 by DL-186, DL-187 and DL-185; this section gives them contract types.

| # | Method & path | Phase | Owner of semantics | Milestone |
|---|---|---|---|---|
| 54 | `POST rt:/api/v1/presence/ticket` → `PresenceTicketRes` | J1 | S09, rooms Worker (DL-186) | M12c1 |
| 55 | `POST rt:/api/v1/_ops/rooms/kick` (`KickReq`) → `KickRes`; writes `audit_log` | S:mod:review \| S:ops | S09 (DL-187) | M12c1 |
| 56 | `POST /api/v1/_ops/alerts` (`AlertReq`) → 204; writes `audit_log`, forwards to `ALERT_WEBHOOK_URL` | HMAC `ALERT_HMAC` over the raw body, timestamp ±300 s | S09 (DL-185) | M14b1 |
| 57 | `GET /api/v1/admin/dash/:name` → `DashRes` | S:ops | S09 (DL-185) | M14b1 |

Routes 55–57 are exempt from the geo-gate (DL-184). Amendments to existing rows:
- **Route 20** (`POST /progress/commit`, rooms → web, `INTERNAL_HMAC`, ⓘ `Idempotency-Key`): the body is `ProgressDelta` (§2). Milestone M12c2; the `race` kind is first written by M12e.
- **Route 21** (`POST /leaderboards/:board/submit`): the body is `LeaderboardSubmit`; the validator registry (DL-183) selects the variant by board prefix: `racing.` → S06 `ScoreSubmit` (unchanged), `tycoon.` → S08 `TycoonDailySubmit`. A body whose shape does not match its prefix is `bad_request`. Transport and empty registry M12c2, validators M12e. The `tycoon.` validator calls S08's `verifyRun(setup, choices, claimed, content)` with the four arguments of `08-tycoon.md` §3.3 (the three-argument form in the 1.1 part was a citation error, no shape change).
- **Route 36 and the CLI token**: the RFC 8628 CLI token of route 10 is typed by `AccessClaims` itself (§2); `spec/05-api-and-realtime.md` §2 already names its auth class `CLI`.

## 2. C12 1.2 — types

```ts
// packages/shared/src/api/v1.ts
export interface PresenceTicketRes { ticket: string; exp: number /* epoch ms */; wsUrl: string }          // route 54

export type ProgressKind = 'activity' | 'race';                                                           // route 20
export interface ProgressDelta {
  pid: string;                       // identity profile id (UUIDv7)
  roomId: string;
  kind: ProgressKind;                // 'race' is written by M12e's room racing activity
  delta: { cash: number /* integer cents, may be negative; progress_wallet.cash never below 0 */; rep: number };
}

export interface TycoonDailySubmit {                                                                       // route 21, prefix 'tycoon.'
  board: string;                     // 'tycoon.daily.<yyyymmdd>'
  value: number;                     // claimed score
  buildId: string;
  runB64: string;                    // canonical JSON {setup, choices, claimed} (S08 encodeDailyRun), base64
  runSha256: string;
}
export type LeaderboardSubmit = ScoreSubmit | TycoonDailySubmit;                                           // discriminated by board prefix
// DataPort.leaderboards.submit(ctx: Ctx, s: LeaderboardSubmit): Promise<'accepted' | 'rejected'>   (1.1 took ScoreSubmit only)

// packages/shared/src/api/ops.ts (contract file from 1.2; routes 55–57)
export type KickCode = 'cheat_speed' | 'staff_action';                                                    // DL-187
export interface KickReq { profileId: string; code: KickCode }
export interface KickRes { kicked: boolean }                     // false: the profile holds no live seat
export interface AlertReq {
  id: string;                        // alert id A01…A12 or SP-01…SP-09 (06 §5 IDs)
  window: number;                    // epoch ms, start of the evaluated window; (id, window) de-duplicates for 10 min
  ts: number;                        // epoch ms, ±300 s of the receiver clock
  level: 'info' | 'warn' | 'page';
  value?: number;
  detail?: string;                   // ≤ 512 chars; no profile id, email or free player text
}
export type DashName = 'client' | 'edge' | 'spend' | 'pipeline' | 'recon';
export interface DashRes { name: DashName; generatedAt: number; columns: string[]; rows: (string | number | null)[][] }

// packages/shared/src/identity.ts — AccessClaims widened for the CLI token (route 10, M13c1; used by route 36, M13c2)
export type CliScope = 'mods:publish';
//   AccessClaims.aud: 'tha-bay' | 'tha-bay-cli'
//   AccessClaims.scp?: (StaffScope | CliScope)[]   — a 'tha-bay-cli' token carries exactly ['mods:publish'] and no StaffScope;
//                                                    a 'tha-bay' token never carries 'mods:publish'
```

Rules: `TycoonDailySubmit` and `ScoreSubmit` share the 16 KiB body cap of route 21. `ops.ts` imports nothing but `@dv/shared` types. Route 42 bodies stay module types of M13d1 (`packages/shared/src/api/legal.ts`, counsel-defined fields), not C12 shapes (DL-241).

## 3. C16 1.2 — telemetry names

| Name | Props | Sampling | Emitter |
|---|---|---|---|
| `app.crash` (server-only, written by the route 4 handler; never accepted from clients) | `reason: 'oom' \| 'unresponsive' \| 'other'`, `build` (12-char build id) | 100 % | S11 (M11a1) |

Chromium sends Reporting API crash reports to the `crash-reporting` endpoint group (else `default`) with `body.reason` `oom` or `unresponsive`; Safari and iOS send none, so iPhone crashes stay inferred by the heartbeat (`app.abnormal_exit`) [research/gap-observability-cost-guardrails.md §2.1 and "Verified facts" (MDN CrashReport, checked 2026-10-18)]. Privacy rules of `09-backend-contracts.md` §3 apply unchanged: the handler keeps the URL path only for its log line and writes no URL, IP or user agent into the event.

## 4. Version constants
`C12_VERSION = '1.2.0'` is set by the first milestone that adds a 1.2 member (M12c1, routes 54–55); `C16_VERSION = '1.2.0'` by M11a1 (`app.crash`). Milestones written against 1.1 stay valid (C15 L6, DL-227).
