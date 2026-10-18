# 09 — Backend contracts, part 1b: C12 1.1 and C16 1.1 additions (C11 unchanged)

> Architect, second contract reconciliation, 2026-10-18 (`spec/11-decision-log.md` DL-092, DL-100, DL-101, DL-103). Part of `spec/domains/09-backend.md`; extends `09-backend-contracts.md` (which is at the size cap, so additions live here). Owner of every shape below: **S09**; the semantics owner of each route stays as named. Rule (06 §4.1): additive change = minor bump. **C12 → 1.1.0, C16 → 1.1.0, C11 stays 1.0.0** (wire `PROTOCOL_VERSION` 2). Sources are the Wave 2–4 return blocks (`spec/.waves234-returns.json`). Requirements: R-NPC-03, R-NPC-05, R-MOD-01…04, R-AUTH-03, R-MODE-02, R-MODE-04, R-ENG-03, R-IP-03.

## 1. C12 1.1 — routes

Route table #1–51 (`09-backend-contracts.md` §2.4) gains two rows and amends four. The table is now **#1–53**.

| # | Method & path | Phase | RL | Owner of semantics | Milestone |
|---|---|---|---|---|---|
| 52 | `DELETE /api/v1/me/npc-memory?npcId=` (one NPC; no `npcId` = all NPCs) → 204 | P0 | api | S04 (DN-S04-04) | M06a4 |
| 53 | `GET /api/v1/mods/revoked?since=<ms>&cursor` → `RevokedRes` (`12-modding-contracts.md` B§7) | pub | api | S12 (takedowns reach installed copies within 24 h) | M13a2 |

Amendments:
- **Route 10** (`/link`, device-code approve): approves only for a profile of tier `linked`. Before M14a, P2 is reached through provider `openai` when flag `auth.openaiWeb` is on, otherwise through `supabase-oauth` (GitHub), both already in `ProviderId` (DN-S12-01, DL-145). Verification of Supabase GitHub OAuth beside Third-Party Auth is UNVERIFIED (M13c1).
- **Route 21** (leaderboards): board ids match `^(racing|fighter|tycoon)\.[a-z0-9.-]{1,96}$` (`racing.<raceId>.time|score`, `tycoon.daily.<yyyymmdd>`); submit body ≤ 16 KiB, ⓘ; `ScoreSubmit`/`ScoreRow` are S06's types (`06-racing-data.md` §4.3); a **validator registry** keyed by the board prefix selects the semantics owner: `racing.` → S06 plausibility checks with rows `verified: false` in v1; `tycoon.` → S08 `verifyRun(setup, choices, claimed, content)` from `@dv/shared/tycoon` (DL-092; four arguments per `08-tycoon.md` §3.3, DL-223).
- **Route 35** query adds `sort=new|top|installed`, `tier=<QualityTierId>` (filter on `tiersOk`) and `limit` (≤ 50).
- **Route 36** accepts a P2 browser access JWT (tier `linked`) as well as the CLI device token with scope `mods:publish`; for `UploadReq.purpose = 'mod_archive'` it enqueues `UGC_SCAN` itself, so the version row and the scan share one `moderation_item` (route 34 commit is not called).

## 2. C12 1.1 — types

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

## 3. C12 1.1 — corrections and storage (no shape change)

| Item | Decision | Source |
|---|---|---|
| `EncounterDO` instance key | `enc:<pid>:<npcId>:<encounterId>`; `encounterId` is a UUIDv7 minted by the Worker (C12 id rule), echoed in C10 `meta` | S04 |
| Migration 0003 `match_npc_memories` | recency scale 518,400 (72 game hours in C06 half-seconds), not `72*3600`; consequence of DL-058 | S04 |
| Migration 0007 | adds `forum_threads.mod_id`, `forum_boards.min_tier` value `staff`, `experiences.world_version` (C08 bakeId), `experiences.mod_sha256`; `mod_versions.state` uses C14 `ModVersionState`, `experiences.moderation_state` uses C17 `ExperienceModeration`; DTOs expose `mods.slug` as `ModId`, database UUIDs never leave the server | S12 |
| Secrets and bindings (`09-backend-ops.md` §6) | `ANTHROPIC_BUILDER_KEY` (npc-builder workspace), `ANTHROPIC_EVALS_KEY` (ci-evals), `OPENAI_MODERATION_API_KEY`; Queue `npc-builder` | S04 |
| `config/net.speedcaps.json` (C11 validation, owner S09, S06 tunes) | per-class rows in m/s: foot 12, D 58, C 77, B 89, A 105, S 119, R 63, police 73, default 95; C11 shape unchanged | S06 CCP-8 |

## 4. C16 1.1 — telemetry names

Added to the closed `TelemetryName` registry (`packages/shared/src/telemetry.ts`) with per-name JSON Schemas in `packages/shared/schemas/telemetry/`. Props are enums, buckets and numbers only; privacy rules of `09-backend-contracts.md` §3 apply unchanged (no ids, free text or sub-chunk positions; `tier` comes from the envelope). Sampling is 100 % unless stated.

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

Consent stays device-scoped (`PlatformSettings.telemetryConsent`); both toggles default on with a first-run notice and one-tap off in the US-only v1 (DL-140).

## 5. Not accepted here
C11 `ActKind.FightInput` (S07) waits for the post-M12b fight-room ADR; the optional batch-range route for world packs (S02 P6) is not added in v1; `BootConfig.hosts.modsUi` stays absent until an ADR needs the L1 UI-mod host (DL-104).
