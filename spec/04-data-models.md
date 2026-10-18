# 04 — Data models (index)

> Wave 5 integration (Architect), 2026-10-18. Builder-facing consolidation of every contract C01–C17 at `prompt-pack/06-SHARED-CONTEXT.md` **v1.2** (frozen, all 17 final; DL-156, Reconciliation 3 DL-218…DL-244), the runtime JSON Schemas, the database schema, save-game versioning and the id and unit conventions. This file is the index; the contract text is split over nine part files to stay under the 6,000-word ceiling (03-SPEC-TEMPLATE §A). Every TypeScript block in the parts is copied verbatim from the owner's domain spec; the owner spec is normative and wins on any difference (06 §4.1 rule 5), and a difference found later is a defect to log in `spec/11-decision-log-2.md`, never a reason to edit a shape here. Shapes change only through the Architect (06 §4.1).

## 1. File map

| Part | File | Contents |
|---|---|---|
| 1 | `spec/04-data-models.md` (this file) | contract index, 1.1 merge rule, C15 format, JSON Schema registry, ids and units, integration corrections |
| 2 | `spec/04-data-models-engine.md` | C01 ECS, C02 loop and determinism, C03 input, C04 camera, anim and audio types, `PhysicsBackend`, `AnimStateId` blocks |
| 3 | `spec/04-data-models-saves-modes.md` | C05 SaveGame (+ save-record JSON Schema), C06 GameMode, pursuit, clock, interaction, prefabs, hooks, economy, UI bridge; save-game versioning and migration rules |
| 4 | `spec/04-data-models-assets-world.md` | C07 manifest, provenance (+ JSON Schemas), registry, genAI jobs; C08 chunks, road graph, services, `world.bounds.json` |
| 5 | `spec/04-data-models-story.md` | C09 mission IR, authoring API, cutscene types (+ mission-IR schema bounds) |
| 6 | `spec/04-data-models-npc.md` | C10 soul frontmatter, compiled outputs, dialogue, intents, memory, voice, builder API (+ soul and roster JSON Schemas) |
| 7 | `spec/04-data-models-net-api.md` | C11 room protocol v2, C12 API and identity types, DataPort, C16 telemetry (+ batch JSON Schema) |
| 8 | `spec/04-data-models-platform.md` | C13 tiers, budgets, device profile, settings, renderer, XR, PWA, pack store, perf (+ tier-decision schema) |
| 9 | `spec/04-data-models-mods.md` | C14 manifest (+ JSON Schema), ModAPI, protocol, install records, route DTOs; C17 experience descriptor (+ JSON Schema) |
| 10 | `spec/04-data-models-db.md` | Postgres schema by migration file, S05 pipeline tables, indexes and RLS, retention |

## 2. Contract index

`C##_VERSION` is exported by each contract file with the value below (06 v1.2 §4.2; 06 §4.1 rule 2). Where a later milestone performs a bump, the cell names it and the constant in code keeps the earlier value until that milestone lands (`09-backend-contracts-1.2.md` §4). Wire and format numbers are separate.

| # | Contract | Owner | Ver | Wire / format numbers | Primary source path(s) | Part | Created in | Consumers (06 §4.2) |
|---|---|---|---|---|---|---|---|---|
| C01 | `EntityId` + ECS conventions | S01 | 1.0.0 | — | `packages/shared/src/contracts/c01-ecs.ts` | 2 | M01a1 | all |
| C02 | `GameLoop` + determinism | S01 | 1.1.0 | — | `contracts/c02-loop.ts` | 2 | M01a1 | all |
| C03 | `InputAction` map | S01 | 1.1.0 | `InputFrame` packs into C11 `IN` | `contracts/c03-input.ts` | 2 | M01a1 (types), M01b1 | S03, S06, S07, S10, S11, S12 |
| C04 | `CameraRig` + anim/audio types | S01 | 1.1.0 | u8 `AnimStateId` | `contracts/c04-camera.ts`, `contracts/anim-states.ts` | 2 | M01b1 | S02, S03, S06, S07, S08, S09, S11 |
| C05 | `SaveGame` | S01 | 1.2.0 (1.1.0 until M05e1) | `format 'dv-save'`, slice `schema` | `contracts/c05-save.ts` | 3 | M04a family | S03, S04, S06, S07, S08, S09, S10, S12 |
| C06 | `GameMode` + unlocks + `ModeContext` services | S01 | 1.1.0 | — | `contracts/c06-modes.ts`, `engine-pursuit.ts`, `engine-world.ts`, `ui-bridge.ts` | 3 | M04a family (ModeHost); M02b2, M03a1, M03c, M04b1 | S02, S03, S04, S06, S07, S08, S10, S12 |
| C07 | `AssetManifest` + provenance + genAI jobs | S05 | 1.1.0 | `asset/1`, `provenance/1.0`, `genjob/1` | `packages/shared/src/assets/{c07,provenance}.ts`, `genai/types.ts` | 4 | M00b, M01d | S02, S03, S04, S06, S07, S09, S10, S11, S12 |
| C08 | `WorldChunk` + `RoadGraph` + world services | S02 | 1.0.0 | `DVWP` 1 | `packages/shared/src/world/{c08,c08-api,pack-codec}.ts`, `config/world.bounds.json` | 4 | M01f, M02a1 | S01, S03, S04, S06, S07, S09, S10, S11, S12 |
| C09 | `MissionScript` + cutscenes | S03 | 1.0.0 | `mission-ir/1`, `cutscene-asset/1`, `cutscene-index/1`, `director/1` | `contracts/c09-mission.ts`, `c09-cutscene.ts`, `genai/cutscene-key.ts` | 5 | M04c, M05a1, M05b2 | S04, S05, S06, S07, S09, S10, S11, S12 |
| C10 | `NPCSoul` + dialogue | S04 | 1.1.0 (1.0.0 until M06a3) | `soul/1.0`, `npc-roster/1` | `contracts/c10-npc.ts`, `c10-npc-builder.ts` | 6 | M06a2, M06a3, M06b1 | S03, S05, S07, S08, S09, S10, S12 |
| C11 | `NetMessage` + room protocol | S09 | 1.0.0 | `PROTOCOL_VERSION` 2 | `packages/net/src/protocol/{v2,codec}.ts` | 7 | M12b family | S01, S02, S06, S07, S08, S10, S12, S13 |
| C12 | API + identity + DB | S09 | 1.2.0 (1.1.0 until M12c1) | routes #1–57 (54–57 from 1.2), migrations 0001–0009 | `packages/shared/src/api/{v1,budget,mods}.ts`, `data-port.ts`, `identity.ts`, `db.gen.ts`, `supabase/migrations/*` | 7, 10 | M00a, M04b3, M05d, M12a1 | S03, S04, S05, S06, S08, S10, S12, S13 |
| C13 | `QualityTier` + budgets + platform services | S11 | 1.1.0 | `tier-decision` v1, `PerfReport` v1 | `packages/shared/src/platform/{c13,xr-comfort}.ts`, `config/tier-budgets.json` | 8 | M00, M01c, M01e | S01, S02, S03, S05, S06, S07, S08, S09, S10, S12 |
| C14 | `ModManifest` + `ModAPI` | S12 | 1.0.0 | `dv-mod/1`, `MODAPI_VERSION` 1.0.0, `ModMsg v1` | `contracts/c14-mod.ts`, `c14-modapi.ts`, `c14-protocol.ts` | 9 | M13a1 | S03, S05, S09, S10, S11 |
| C15 | Milestone + AC format | S13 | 1.1.0 (DL-214) | — | none (document format, §4 below) | 1 | M00 onward | all |
| C16 | `TelemetryEvent` | S09 | 1.2.0 (1.1.0 until M11a1) | `TelemetryBatch.v` 1 | `packages/shared/src/telemetry.ts`, `schemas/telemetry/` | 7 | M00a | all emitters; S13 |
| C17 | `ExperienceDescriptor` | S12 | 1.0.0 | — | `contracts/c17-experience.ts` | 9 | M13a1 | S02, S09, S10 |

Paths without a package prefix are under `packages/shared/src/`. One owner per id type (06 §4.1 rule 4): C08 owns `LatLng`, `ChunkKey`, `LandmarkId`, `PoiId`, `DistrictId`; C10 owns `NpcId`; C14 owns `ModId`; C06 owns `GameModeId`, `UnlockEventId`; C05 owns `SlotId`, the save `ProfileId` and (DL-194) `JsonValue`/`JsonObject`; C12 owns the identity profile id. Consumers import these and never redeclare them under the same name. Mode owners own their def ids and board ids (`ModeHook.defId`: racing `RaceId`, fighter `bout.<id>`, tycoon `mini8w`; boards `<mode>.<…>`; DL-092, DL-157).

Deferred contract work (do not implement early): C06 1.2 per-wheel readout after the M03a2 spike (DL-104); sloped deck strips (C08 P2) after M02a2; C11 `ActKind.FightInput` after the post-M12b fight-room ADR; the L1 UI-mod host (`BootConfig.hosts.modsUi`) only by ADR.

## 3. Applying 1.1 deltas (merge rule)

Owner specs publish 1.0 shapes and then a "1.1 additions" block that repeats only the changed declarations (`/* 1.0 members */` stands for the unchanged part). In code there is exactly one declaration per name, in the contract file the owner names:

1. **Union types** (`DeviceKind`, `ControlId`, `SaveReason`, `FeatureFlag`, `PostNode`, `ModSubject`): the 1.1 line replaces the 1.0 line; appended members keep the index of every 1.0 member (C03 `InputFrame.device`).
2. **Interfaces** (`InputRouter`, `ControlsSettings`, `XRRigParams`, `ProfileSettings`, `GameModeDescriptor`, `GameModeUI`, `ModeContext`, `PursuitProfile`, `PursuitApi`, `TimelineRecorder`, `RendererHost`, `BootConfig`, `PlayerQuota`, `IdentityService`, `PlatformSettings`, C07 `KindExtras` vehicle `nodes`): add the 1.1 members to the 1.0 declaration in the same file; a 1.1 member that redefines a 1.0 field (C04 `XRRigParams.origin`, C12 `RosterFlags.standIn`, `BootConfig.hosts`) replaces it. Do not rely on cross-file declaration merging.
3. **New declarations** (`BotInput`, `XrPanels`, `AssetSource`, `UiBridge` family, `weekdayOf`, `ToastKind`) are added as written.
4. The contract constant stays `'1.1.0'` (C02–C04, C06, C07, C13; C05, C12, C16 until the 1.2 milestone named in §2, then `'1.2.0'`) and nothing in a 1.0 shape changes meaning (06 §4.1 rule 3). `pnpm typecheck` over `packages/shared` is the proof that the merge compiles.

## 4. C15 — milestone and acceptance-criteria format

Owner S13, version 1.1.0 (DL-214; `c15-milestone.ts` and lint L1–L8 per `spec/domains/13-qa.md` §4, delivered by M00d), normative text `prompt-pack/03-SPEC-TEMPLATE.md` §C. C15 has no TypeScript; the heading block below is the contract, and every file in `spec/07-milestones/` uses it verbatim. Consumers: all milestone authors and every Builder session; first file M00.

```
# M## — <slug>
## Goal            (one paragraph: what exists when this is done that did not before)
## Requirements    (R-IDs, with one clause each on how this milestone serves them)
## Depends on      (milestone IDs; contract versions)
## Scope in        (bullet list)
## Scope out       (bullet list; what later milestone takes it)
## Deliverables    (files/packages to create or change, by path; config; scripts)
## Interfaces      (C## touched; any proposed change must go through an ADR)
## Acceptance criteria
  AC-1  Given <state> When <action> Then <observable result>  — proof: `<exact command>` or "manual: <device, steps>"
  AC-2  …
## Test plan       (unit/integration/e2e/perf/device; names and commands)
## Demo script     (what the operator does to see it, step by step, ≤ 10 steps)
## Effort          (builder sessions; files touched estimate; risk level)
## Risks & fallbacks
## Notes for the Builder (gotchas, order of work, what to read first)
```
Rules: one Sonnet 5.5 session per milestone (≈2–4 h agentic work, ≲40 files); every AC has a proof; no AC references an `UNVERIFIED` fact; M00 is always "repo bootstrap + CI + deploy a hello-world PWA to Cloudflare"; each milestone leaves the app deployable.

Binding additions (spec/.wave5-notes.md items 5, 6, 15): milestone ids follow the register in `spec/00-plan.md` (digit suffixes only for M01a, M01b, M04a, M10a, M11a, M11b2, M12b, M12c, M14b); an AC never contains an UNVERIFIED item, and a device run records such items as checklist output; the fast-track files M00…M01f keep their ids, slugs and scope.

## 5. Runtime JSON Schema registry

Draft 2020-12 everywhere, compiled ahead of time to standalone Ajv validators where the owner says so (no runtime schema compilation in the Worker or `sim.worker`). JSON Schema is used only for runtime-validated data (06 §5).

| Data | Schema file | Owner | Text in | Validated by | Lands in |
|---|---|---|---|---|---|
| save-record envelope | `packages/engine/src/sim/save/schema/save-record.v1.schema.json` (+ `<kind>.v<n>.schema.json`) | S01 | part 3 | `SaveService` load, import; golden-file CI | M04a family |
| player avatar (`CoreSlice.avatar`) | `packages/shared/schemas/ui/avatar.v1.schema.json` | S10 | `10-ui-pages.md` §4.1 | `SaveService`, mod SDK | M04b2 |
| provenance record | `packages/shared/schemas/provenance-1.0.schema.json` | S05 | part 4 | `provenance:check`, mod validators | M00b |
| asset manifest | `packages/shared/schemas/asset-1.schema.json` | S05 | part 4 (integration text, DL-199) | `check:assets` | M01d |
| genAI registry | `packages/shared/schemas/genai-endpoints-1.schema.json` | S05 | `05-assets.md` §4.5 | `genai:liveness`, `check:assets` | M00b |
| mission IR | `packages/shared/schemas/mission-ir-1.schema.json` (generated + bounds) | S03 | part 5 | `missions:build`, load, `dv mod check` | M05a1 |
| soul.md frontmatter | `packages/shared/schemas/npc/soul-1.0.schema.json` (+ roster, turn, intent, summary, request, voice, bark schemas) | S04 | part 6 | `npc:lint`, `npc:build`, builder validate | M06a2 |
| mod manifest | `packages/shared/schemas/mod/manifest.v1.schema.json` (+ data-tier schemas) | S12 | part 9 | `dv mod check`, Queue scan, installer | M13a1 |
| experience descriptor | `packages/shared/schemas/mod/experience-descriptor.v1.schema.json` | S12 | part 9 (integration text, DL-199) | route 37, client marker load | M13a1 |
| telemetry batch and names | `packages/shared/schemas/telemetry/batch.schema.json`, `names.schema.json` | S09 | part 7 (batch: integration text, DL-199) | ingest Worker route 3, `check:telemetry` | M00a |
| API request bodies | `packages/shared/schemas/api/*.schema.json` (generated by `tools/ci/gen-api-schemas.ts`) | S09 | `09-backend-contracts.md` §2.5 | every `/api/v1/*` write | M00a onward (`check:api`) |
| tier decision | `$id tier-decision.v1` (in `packages/shared/src/platform/`) | S11 | part 8 | boot read of `dv-platform` | M01c |
| perf report | `tools/ci/schemas/perf-report.v1.json` | S11 | part 8 | `check:perf`, `perf:verify` | M01c |
| world index, world config | `tools/map/schemas/*.schema.json` | S02 | `02-world-contracts.md` §5 | `check:unit`, `map:build` | M01f, M02a1 |
| prefabs | `packages/engine/src/sim/prefabs/schema/prefab.schema.json` | S01 | `01-engine-save-modes.md` prefabs | build and mod load | M01b1 |

## 6. Shared identifiers and units

Consolidated from 06 §4.3 and the contract files; every row is binding on every contract.

| Thing | Rule | Owner |
|---|---|---|
| Server-minted ids | UUIDv7 minted in the Worker: database primary keys (except append-only `bigint identity` logs), `X-Request-Id`, `encounterId`, upload ids, experience placement ids, merge requests | C12 |
| Client-minted ids | identity profile id: UUIDv7 minted on the device at first launch (JWT `sub`); `Idempotency-Key`: UUIDv7; save `ProfileId` and `deviceId`: 32 lowercase hex from 16 random bytes; telemetry `sessionId`: `crypto.randomUUID()` per launch, never a profile id | C12, C05, C16 |
| Derived ids | user NPC `u_` + 26-char Crockford base32 of a UUIDv7; mod asset refs `<kind>/mod.<sha256[0:12]>`; telemetry `mod` = first 8 hex of SHA-256(`ModId`) | C10, C14, C16 |
| Persistent entity identity | C01 `StableKey` (`player:`, `veh:`, `npc:`, `amb:<cell>:<slot>`, `mis:`, `pfb:`); `EntityId` never leaves a session | C01 |
| Id patterns | `MissionId` `^m\.[a-z0-9][a-z0-9.-]{1,80}$`; `NpcId` `^[a-z][a-z0-9_-]{2,47}$`; `ModId` `<a>.<b>` ≤ 41; `AssetId` `^[a-z0-9][a-z0-9._-]{1,62}$`; `UnlockEventId` `^unlock\.`; `CutsceneRefId` `cut.*`; board `^(racing\|fighter\|tycoon)\.[a-z0-9.-]{1,96}$`; landmarks `lm.<slug>`, POIs `poi.<nhood>.<name>`, districts `d1…d10`, `outer`, `stage`, 41 neighbourhood slugs | C09, C10, C14, C07, C06, C12, C08 |
| Time | epoch milliseconds (integer) in wire JSON, saves, catalogs, reports, telemetry; database `timestamptz`; ISO-8601 `Z` only in repo-audited files (provenance records, registry, terms index; DL-059); sim ticks 60 Hz (`SIM_DT`), server ticks 20 Hz; game clock in C06 half-seconds (172,800 per game day, `weekdayOf`) | C02, C06, C07, C12 |
| Money | game economy: integer cents (`cashCents`, `EconomyApi`); genAI spend: integer USD micros (`budgetUsdMicros`, `usd_micros`, `cap_usd_micros`; programme cap 100,000,000 per DL-OWN-01); registry list prices decimal USD | C06, C07, C12 |
| Coordinates | ENU metres from San Francisco City Hall (37.7793 N, −122.4193 W), +X east, +Y up, −Z north; f64 in the sim, f32 on the wire; lat/lng only in authored data, tools and C17 anchors (C08 `LatLng {lat, lng}`; C09 IR `LatLngTuple`) | C08, C11 |
| Location keys | C08 `ChunkKey` `z/x/y` (z 9/7/5/3); telemetry, route 37 and C17 carry z=9 keys only; ambient cells `amb:9/x/y:<slot>` | C08 |
| Angles | radians in the sim; u16 yaw and i16 pitch on the wire | C03, C11 |
| Hashes | SHA-256 lowercase hex for content, cache and job keys (`canonicalize` in `packages/shared/src/json.ts`, `sha256Hex` in `hash.ts`, RFC 8785); FNV-1a-64 only for sim `stateHash` and C05 checksums | C02, C05, C07, C09 |
| World version | C05 `worldBake` = C08 `WorldIndex.bakeId` (64 hex) = C17 `worldVersion` = C14 `compat.world` entries | C08 |
| Tiers | C13 `QualityTierId` only (six ids); C07 variants add `default` | C13, C07 |
| Likeness | `consented \| parody \| fictionalized`, C07 adds `original`; assets and cutscene keys use C10 `assetTier()` | C10, C07 |
| Browser storage | prefix `dv-`: IndexedDB `dv-saves`, `dv-packs`, `dv-platform`, `dv-identity`, `dv-mods`, `dv-ui`; OPFS `dv/packs/<sha256>.bin`, `dv/mods/`; `localStorage['dv.hb']` | 06 §5 |

## 7. Corrections made during this integration

Logged in `spec/11-decision-log-2.md` (block "Wave 5: data models"); the owner or consumer file named was edited so that the verbatim copies in the parts carry the fix. No contract shape changed and no version moved: each row is a visibility fix, a consumer alignment to its owner, or storage text the owner had stated in prose.

| DL | Correction | Files changed |
|---|---|---|
| DL-171 (assets and cost integration entry) | fal programme cap in C07 text: $1,000 → $100 (`programCapUsdMicros` 100,000,000) per DL-OWN-01; the data-model pass made the same edit and cites that entry | `05-assets.md` §4.7, §5.3 |
| DL-193 | `cutscene.play` telemetry: consumers put the `FallbackTrigger` in `reason`; C16 1.1 owner defines `path` and `trigger` | `03-story-cutscenes.md` §D7, `07-fighter-content.md` FX6.5 |
| DL-194 | `JsonValue`/`JsonObject` were non-exported in `c05-save.ts` yet imported by C09; C14 redeclared `JsonValue` | `01-engine-save-modes.md` §C05, `12-modding-contracts.md` B§3 |
| DL-195 | server save tombstones kept 90 d against C05 `tombstoneRetentionDays` 180 | `09-backend-db.md` §3.5, §7 |
| DL-196 | `ToastKind` used by `UiBridge` but declared nowhere | `10-ui.md` §3.3 |
| DL-197 | C12 1.1 storage corrections (0003 recency scale, 0007 `mod_id`, `world_version`, `mod_sha256`, state enums, `min_tier 'staff'`) existed only as prose | `09-backend-db.md` §3.3, §3.7 |
| DL-198 | 0002 S05 pipeline tables had no DDL | `spec/04-data-models-db.md` §3.2a; pointer in `09-backend-db.md` §3.2 |
| DL-199 | runtime JSON Schemas for the asset manifest, experience descriptor and telemetry batch written from the TypeScript; file paths fixed | parts 4, 7, 9 |
