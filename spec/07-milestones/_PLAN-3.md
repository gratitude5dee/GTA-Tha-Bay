# Milestone plan — part 3: identity and multiplayer, modding and UGC, launch, Bay expansion (blocks F–I)

> S13 · 2026-10-18 · same field legend as `_PLAN-1.md`. R-ROLL-01: nothing in block F from M12b1 on starts before M05c2 is shipped and tested on staging. R-AUTH-02: M14a is the last v1 milestone, directly before Bay expansion.

## Block F — identity and multiplayer

### M12a1 · p1-identity-cloud-saves — 1 · risk H · S09
- **Goal:** ES256 issuer and JWKS (route 6), register with Turnstile (7), token rotation (8–9), `auth:tpa`, staff scopes, migration 0005, `HttpCloudSync`, save routes 15–19 and 50–51, version-affinity rule, gradual production deploys.
- **R** R-AUTH-01, R-ROLL-02, R-IP-04 · **Dep** M05d, M04b3, M06a1 (`PlayerQuotaDO`, TOFU key binding, route 14) · **Read** `09-backend-contracts.md` §2 (identity, routes 6–9, 15–19, 50–51); `09-backend-db.md` §3 (0005), §8; `09-backend-ops.md` §1.3, §2 · **Out** `services/edge/src/id`, `packages/identity/src/device`, `supabase/migrations/0005_saves.sql` · **C** C12 1.1, C05 1.1
- **Gate** Q-15 (`id.<domain>`), `ID_SIGNING_JWK_CURRENT`, `ID_SIGNING_JWK_NEXT`, `TURNSTILE_SECRET`, Supabase Pro · **Proof** `pnpm check:workers -- refresh-reuse`; `pnpm check:workers -- save-conflict`; `pnpm test:staging -- rls-thirdparty`

### M12a2 · age-register-cloud-save-ui — 0.5 · risk L · S10
- **Goal:** age bracket POST (under-18 blocked), register page, cloud-save status, conflict choice, forget.
- **R** R-AUTH-01, R-UI-03, R-IP-04 · **Dep** M12a1, M04b1 · **Read** `10-ui-pages.md` §2 (profile, saves), §5 · **Out** `packages/ui/src/pages/{account,saves}` · **C** C12 1.1, C05 1.1
- **Gate** none · **Proof** `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-age`; `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-saves`

### M06b2 · builder-images-review — 1 · risk M · S04, S09
- **Goal:** presigned uploads and commit (route 34), image moderation chain and `UGC_SCAN` queue, text descriptions, attestation, P2 submit (test-issuer tokens until M13c1), case decisions on the NPC queue of route 43, community list, reports (route 41: `npc_soul` and NPC dialogue `chat_turn`, with the panel's report button turned on, DL-543); UGC buckets created (DL-182).
- **R** R-NPC-03, R-IP-02/03 · **Dep** M06b1, M12a1, M06a5 · **Read** `04-npc-builder.md` C3, C5; `09-backend-db.md` §4 · **Out** `services/edge/src/{ugc,npc-builder}` · **C** C12 1.1, C10 1.0
- **Gate** Q-16 (photo uploads private-only until filings are approved), `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` as Worker secrets, `OPENAI_MODERATION_API_KEY` · **Proof** `pnpm check:workers -- npc-builder` (images text-only, submit tier, report unpublish); `pnpm check:workers -- npc-chat-report`; `pnpm check:e2e -- --project=chromium-webgl2 --grep @npc-builder`; `pnpm check:e2e -- --project=chromium-webgl2 --grep @npc-report`

### M06b3 · npc-builder-ui — 1 · risk M · S10
- **Goal:** the NPC builder pages over the route 33 API in the step order of `04-npc-builder.md` §C1 (S04 owns the flow, DL-234): draft, generate, preview chat, private talk, submit.
- **R** R-NPC-03, R-UI-03 · **Dep** M06b2, M04b2, M06a5, M06c · **Read** `04-npc-builder.md` C1; `10-ui-pages.md` §2 · **Out** `packages/ui/src/pages/npc-builder` · **C** C10 1.0 (builder types)
- **Gate** none · **Proof** `pnpm check:e2e -- --project=chromium-webgl2 --grep @npc-builder`; `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-a11y`

### M12b1 · rooms-core-protocol-v2 — 1 · risk H · S09 (split 1 of 2)
- **Goal:** `tha-bay-rooms` Worker with `RoomDO` and `DirectoryDO` (tag `rooms-v1` alone), tickets and routes 22–24, C11 codec and clock in `packages/net`, build gate 4002, rooms Preview and deploy.
- **R** R-ROLL-02 · **Dep** M12a1, M05c2, M04a2, M04e0 (sandbox rooms guard, DL-719) · **Read** `09-backend-contracts.md` §1; `09-backend-ops.md` §1 · **Out** `services/rooms`, `packages/net/src/{protocol,clock}` · **C** C11 1.0 (`PROTOCOL_VERSION` 2)
- **Gate** `ROOM_TICKET_HMAC`, `ROOM_RESUME_HMAC`, `INTERNAL_HMAC`; `pnpm deploy:bootstrap` for the new Worker · **Proof** `pnpm check:unit -- packages/net` (round trip; 10,000-buffer fuzz never throws); `pnpm check:workers -- rooms-build`; `pnpm check:workers -- rooms-forged-id`

### M12b2 · rooms-core-protocol-v2 — 1 · risk H · S09 (+S01) (split 2 of 2)
- **Goal:** interest management, `validated` authority with `config/net.speedcaps.json`, close codes, client prediction ring, net slots, hash cadence; two clients on staging.
- **R** R-ROLL-02 · **Dep** M12b1, M04e3 · **Read** `09-backend-contracts.md` §1; `01-engine.md` §8 (M12b row); DL-719 (sandbox descriptor `requires.network: 'optional'`; AC-10 re-proves `sandbox-guard.spec.ts` with the real `net`) · **Out** `services/rooms/src/room`, `packages/net/src/client`, `packages/engine/src/net` · **C** C11 1.0, C02 1.1 (NetIn/NetOut)
- **Gate** staging · **Proof** `pnpm check:workers -- rooms-speed`; `pnpm check:e2e -- --project=chromium-webgl2 --grep @mp` (isolated pages, peer sees the move within 150 ms of server tick)

### M12c1 · rooms-hardening-presence-loadtest — 1 · risk M · S09 (split 1 of 2)
- **Goal:** resume and ghosts, drain (route 48, `rooms:drain`), `PresenceDO` (26), invites (25), `ACT` interactions, mods refusal 4007 hook.
- **R** R-ROLL-02 · **Dep** M12b2 · **Read** `09-backend-contracts.md` §1 (resume, presence, close codes) · **Out** `services/rooms/src/{presence,invites}` · **C** C11 1.0, C12 1.2 (routes 54–55)
- **Gate** none · **Proof** `pnpm check:workers -- rooms-resume` (same slot within 5 s); `pnpm check:workers -- rooms-afk-hibernate`

### M12c2 · rooms-hardening-presence-loadtest — 1 · risk H · S09, S13 (split 2 of 2)
- **Goal:** migration 0006 progress and leaderboard tables with route 20 (`ProgressDelta`), route 21 transport with an empty validator registry (DL-183), opt-in moderated chat with `chat_turn` report evidence (DL-239), load bots (`tests/load/rooms.ts`, `13-qa.md` §3.10); `rooms.capMax` stays off in v1 (32 players need a 32-bot run, DL-239).
- **R** R-ROLL-02, R-ENG-02 · **Dep** M12c1 · **Read** `09-backend-db.md` §3 (0006); `09-backend.md` §9; `13-qa.md` §3.10 · **Out** `tests/load`, `supabase/migrations/0006_online.sql` · **C** C11 1.0, C12 1.2 (`ProgressDelta`, `LeaderboardSubmit`)
- **Gate** staging; operator machine as the second location · **Proof** `pnpm load:rooms -- --bots 16 --minutes 30` (tick p99 ≤ 10 ms, zero overload); `pnpm check:db`

### M12d · online-page-invites — 0.3 · risk L · S10
- **Goal:** online page, invites, presence, chat panel (default off), nameplates.
- **R** R-ROLL-02, R-UI-03 · **Dep** M12c1, M04b1 · **Read** `10-ui-pages.md` §2 (online); `10-ui-hud-xr.md` §8 · **Out** `packages/ui/src/pages/online` · **C** C11 1.0, C12 1.1
- **Gate** none · **Proof** `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-online`

### M12e · mode-leaderboards — 1 · risk M · S06, S08
- **Goal:** route 21 validator registry, racing plausibility validator and `RaceActivityData` referee, `tycoon.daily.<yyyymmdd>` board with `verifyRun`.
- **R** R-MODE-02/04, R-ROLL-02 · **Dep** M12c2, M07b1, M09a2 · **Read** `06-racing-data.md` §4.3; `08-tycoon.md` §8 (M12e row); `09-backend-contracts.md` §2.4 row 21 · **Out** `services/edge/src/leaderboards`, `packages/shared/src/{racing,tycoon}/verify` · **C** C12 1.2 (`TycoonDailySubmit`), C11 1.0
- **Gate** none · **Proof** `pnpm check:workers -- leaderboards` (forged run rejected, valid run accepted)

## Block G — modding, UGC, legal

### M13a1 · mod-sdk-manifest-validators — 1 · risk L · S12
- **Goal:** C14/C17 types and schemas, shared validators, archive, deterministic `dv mod pack`, `dv mod check`, `ModBudgetReport`.
- **R** R-MOD-01, R-IP-01 · **Dep** M04a2, M01d, M00e (§0 rule 7) · **Read** `12-modding-contracts.md` B§1–B§4, B§6 · **Out** `packages/shared/src/mod`, `packages/mod-sdk`, `tools/cli` · **C** C14 1.0, C17 1.0, C07 1.1
- **Gate** none · **Proof** `pnpm check:unit -- packages/shared/src/mod` (`pack-deterministic`, `check-parity`, `manifest-schema`, `permission-tier-matrix`)

### M13a2 · mod-installer-store-client — 1 · risk M · S12 (+S09)
- **Goal:** install registry and journal, OPFS blobs, install/uninstall/update/rollback, local import, route 35 and client, route 53 revocation poll, the whole migration 0007 (mods, experiences, forum objects, device codes; DL-228).
- **R** R-MOD-01/04 · **Dep** M13a1, M01e, M05d · **Read** `12-modding-contracts.md` B§5, B§7; `09-backend-contracts-1.1.md` §1 · **Out** `packages/engine/src/client/mods`, `services/edge/src/mods`, `supabase/migrations/0007_ugc_forum.sql` · **C** C14 1.0, C12 1.1
- **Gate** none · **Proof** `pnpm check:unit -- packages/engine/src/client/mods` (`install-atomic`, `uninstall-byte-equal`, `revoked`); `pnpm check:workers -- mods`

### M13a3 · mod-runtime-data-experience — 1 · risk M · S12
- **Goal:** `ModHost`, permission broker, scene ops, ECS shims, `ExperienceMode`, `modsActive()` with room refusal 4007, mod saves, map markers, route 37 GET, `mod-scene-budget`.
- **R** R-MOD-01/04 · **Dep** M13a2, M02c2, M12b1, M12c1 (4007 refusal hook), M04b2, M06a3 · **Read** `12-modding.md` §2, §5; `12-modding-contracts.md` B§3, B§5–B§6 · **Out** `packages/engine/src/{sim/mods,client/mods}` (DL-220) · **C** C14 1.0, C17 1.0, C06 1.1, C05 1.1 (`mod:<id>`)
- **Gate** none · **Proof** `pnpm check:workers -- mods-4007`; `pnpm check:e2e -- --project=chromium-webgl2 --grep @mods-exp`; `pnpm check:perf -- --scenario mod-scene-budget`

### M13a4 · mod-script-sandbox — 1 · risk H · S12
- **Goal:** `mod.worker` with QuickJS, budgets, fault policy, security suite, iPhone spike; `mods.script` stays off until recorded (DL-147).
- **R** R-MOD-01 · **Dep** M13a3 · **Read** `12-modding.md` §5; `12-modding-contracts.md` B§5 · **Out** `packages/engine/src/workers/mod` · **C** C14 1.0 (`ModMsg v1`)
- **Gate** Q-13 device · **Proof** `pnpm check:unit -- packages/engine/src/workers` (`mod-sandbox-*`, `mod-perm-denied`, `mod-cmd-flood`); `pnpm check:perf -- --scenario mod-hostile`; manual `M13a4-iphone15`

### M13a5 · mod-ui-tier — 1 · risk H · S12
- **Goal:** `ModUiHost` with L2 panels first (DL-146), `dv-panel/1`, XR panel path, COEP matrix; `mods.ui` off until recorded.
- **R** R-MOD-01 · **Dep** M13a3 · **Read** `12-modding.md` §5–§6 · **Out** `packages/ui/src/mods` · **C** C14 1.0, C13 1.1
- **Gate** Q-13 devices · **Proof** `pnpm check:e2e -- --project=chromium-webgl2 --grep @mods-ui-isolation`; manual `M13a5-{iphone15,quest3}` records the COEP matrix

### M13a6 · mod-agent-kit — 1 · risk M · S12
- **Goal:** kit `AGENTS.md`, mirrored skills and `check:skills`, knowledge base and `dv kb`, `dv mod dev` hot reload, mock host, `thabay-mcp`, examples; `check:agents` gains the kit limit.
- **R** R-MOD-01/02, R-ENG-01 · **Dep** M13a4, M13a5 · **Read** `12-modding-publish.md` C§1; `13-qa.md` §3.8 · **Out** `packages/mod-sdk/{AGENTS.md,examples}`, `skills/`, `.claude/skills`, `.agents/skills`, `tools/cli/src/mcp` · **C** C14 1.0
- **Gate** Q-22 (npm publication step only) · **Proof** `pnpm check:skills && pnpm check:agents && pnpm check:mods`

### M13a7 · store-experience-pages — 0.7 · risk L · S10, S06
- **Goal:** experiences and mods pages and store; vehicle-mod envelope validator hook against `CLASS_ENVELOPE`.
- **R** R-MOD-01/04, R-UI-03, R-MODE-02 · **Dep** M13a3, M07b2, M04b1 · **Read** `10-ui-pages.md` §2 (experiences, mods); `06-racing-content.md` C.2 · **Out** `packages/ui/src/pages/{experiences,mods}`, `packages/shared/src/mod/vehicle` · **C** C14 1.0, C17 1.0
- **Gate** none · **Proof** `pnpm check:unit -- packages/shared/src/mod` (envelope rejects an out-of-class vehicle mod); `pnpm check:e2e -- --project=chromium-webgl2 --grep @mods-store`

### M13b1 · forum-reports-backend — 1 · risk M · S09
- **Goal:** routes 38–40 over the forum objects of M13a2's migration 0007 (no migration here, DL-228), votes, search, auto-unlist on reports.
- **R** R-MOD-03, R-IP-03 · **Dep** M05d, M06b1, M06b2, M13a2 · **Read** `09-backend-db.md` §3 (0007); `09-backend-contracts.md` §2.4 rows 38–41 · **Out** `services/edge/src/forum` · **C** C12 1.1
- **Gate** none · **Proof** `pnpm check:workers -- report-threshold`; `pnpm check:db`

### M13b2 · forum-ugc-links — 0.8 · risk L · S12, S02
- **Goal:** experience and mod threads, ratings → `rating`, store↔forum links; `map:webtiles`, `anchor-mask.v1`, `world.describe` export.
- **R** R-MOD-03/04, R-MAP-03 · **Dep** M13b1, M13a3, M02c2 · **Read** `12-modding-publish.md` C§4–C§5; `02-world-maps.md` §1, §7 · **Out** `services/edge/src/forum/links`, `tools/map/src/webtiles` · **C** C17 1.0, C08 1.0
- **Gate** none · **Proof** `pnpm check:workers -- exp-rating`; `pnpm check:workers -- anchor-rules`

### M13b3 · creator-place-mode — 1 · risk M · S12 (+S10)
- **Goal:** in-game data-tier creator (prop placer, ≤ 512 ops), local pack, publish handoff for players without an agent (DL-153).
- **R** R-MOD-02/04 · **Dep** M13a3, M04b2 · **Read** `12-modding.md` §2; `12-modding-contracts.md` B§4 · **Out** `packages/engine/src/client/mods/creator`, `packages/ui/src/mods/creator` (DL-220) · **C** C14 1.0, C17 1.0
- **Gate** none · **Proof** `pnpm check:unit -- packages/shared/src/mod` (`scene-ops-caps`); `pnpm check:e2e -- --project=chromium-webgl2 --grep @mods-exp`

### M13b4 · forum-ui — 1 · risk L · S10
- **Goal:** forum pages, threads, votes, report button on every UGC surface.
- **R** R-MOD-03, R-UI-03, R-IP-03 · **Dep** M13b1, M04b1 · **Read** `10-ui-pages.md` §2 (community) · **Out** `packages/ui/src/pages/forum` · **C** C12 1.1
- **Gate** none · **Proof** `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-forum`; `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-a11y`

### M13c1 · device-code-publish-login — 0.8 · risk M · S09, S10
- **Goal:** device-code login (route 10, RFC 8628) and `/link` approval page; publish identity before M14a per the DL-145 ADR; route 11 OpenAI flow behind `AUTH_OPENAI_WEB` (off unless OpenAI grants a client).
- **R** R-AUTH-03, R-MOD-02 · **Dep** M12a1, M04b1, M13a2 (`device_codes` in 0007) · **Read** `12-modding-publish.md` C§2; `09-backend-contracts.md` §2.4 rows 10–11 · **Out** `services/edge/src/id/device-code`, `packages/ui/src/pages/link` · **C** C12 1.2 (CLI `AccessClaims`)
- **Gate** DL-145 ADR; `OPENAI_OIDC_CLIENT_SECRET` only if granted · **Proof** `pnpm check:workers -- device-code`; `pnpm check:e2e -- --project=chromium-webgl2 --grep @link`

### M13c2 · publish-pipeline-server — 1 · risk M · S12
- **Goal:** server scan stages, routes 36 and 37 POST, publish state machine, anchor validator, rebake Workflow, revocation; `ugc.publish` stays false in production.
- **R** R-MOD-03/04, R-IP-03 · **Dep** M13c1, M13a1, M13b1, M13b2 · **Read** `12-modding-publish.md` C§3–C§4, C§7 · **Out** `services/edge/src/publish`, `services/pipeline/rebake` · **C** C14 1.0, C17 1.0, C12 1.2
- **Gate** none · **Proof** `pnpm check:workers -- mod-scan-quarantine`; `pnpm check:workers -- anchor-rules`; `pnpm check:workers -- publish-flag`

### M13c3 · publish-cli-link — 1 · risk M · S12
- **Goal:** `dv login`, `dv mod publish`, attestation, `/link` rules, `openai` adapter behind its flag; flow B only after an ADR (DL-148).
- **R** R-MOD-01/02, R-AUTH-03 · **Dep** M13c2, M13a6 · **Read** `12-modding-publish.md` C§1–C§2 · **Out** `tools/cli/src/publish`, `packages/identity/src/openai` · **C** C14 1.0, C12 1.1
- **Gate** Q-22 (npm step only) · **Proof** `pnpm check:mods`; `pnpm test:staging -- mod-publish` (`dv mod publish --dry-run` with a `mods:publish` token)

### M06b4 · builder-publish-assets — 0.5 · risk M · S04 (+S05)
- **Goal:** builder `assets` sub-route into an owner-approved custom-3D queue counted against the DL-OWN-01 cap (default creator-kit bodies; no player-triggered fal); publish end to end.
- **R** R-NPC-03, R-ENG-03 · **Dep** M13c2, M06b3, M10a1 (`assets:gen`) · **Read** `04-npc-builder.md` C3, C5; spec/11-decision-log.md DL-OWN-01 · **Out** `services/edge/src/npc-builder/assets` · **C** C10 1.0, C07 1.1
- **Gate** owner approval per job; `budget_program` cap · **Proof** `pnpm check:workers -- npc-builder` (job refused without approval; approved job queued in mock); `pnpm check:pipeline`

### M13d1 · legal-trust-safety-backend — 1 · risk H · S09
- **Goal:** DMCA, counter-notice and NCII intake (route 42), migration 0008, SLA pager, NCMEC case records and evidence reads (44), hash banks (45), copy sweep, evidence buckets; then `ugc.publish` may flip in production (DL-151).
- **R** R-IP-03, R-MOD-03 · **Dep** M13b1, M06b2, M13c2 (uploads and image hashes; `HashBankPort`, revocations) · **Read** `09-backend.md` §3.4; `09-backend-db.md` §3 (0008) · **Out** `services/edge/src/legal`, `supabase/migrations/0008_legal.sql` · **C** C12 1.1
- **Gate** Q-16 filings; `NCMEC_API_CREDENTIALS`, `PHOTODNA_KEY` after approval · **Proof** `pnpm check:workers -- ncii-clock`; `pnpm check:workers -- evidence-audit`; `pnpm check:workers -- report-threshold`

### M13d2 · legal-forms-ui — 0.3 · risk L · S10
- **Goal:** DMCA, counter-notice and NCII forms; legal pages wired to counsel-reviewed text when supplied.
- **R** R-IP-03, R-UI-03 · **Dep** M13d1, M04b1 · **Read** `10-ui-pages.md` §2 (legal) · **Out** `packages/ui/src/pages/legal` · **C** C12 1.1
- **Gate** Q-23 for final text · **Proof** `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-legal`

## Block H — launch

### M14c · a11y-audit-i18n-gate — 0.5 · risk L · S10
- **Goal:** axe audit of every page, colour-vision palette validation, i18n report gate, troubleshooting page final; `AgeSignalProvider` wired (`10-ui-pages.md` §2.4 rule 5, DL-241).
- **R** R-ENG-04, R-UI-02 · **Dep** M13d2, M13b4, M12d, M06b3, M11b3 · **Read** `10-ui.md` §9; `10-ui-hud-xr.md` §8 · **Out** `packages/ui` fixes, `tests/e2e/a11y` · **C** —
- **Gate** none · **Proof** `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-a11y` (zero critical or serious on every page); `pnpm check:i18n`

### M14b1 · launch-hardening-guardrails — 1 · risk M · S09 (split 1 of 3)
- **Goal:** complete `config/guardrails.yaml`, AI Gateway layer-2 rules, vendor layer-1 caps, reconciliation cron, alert sink and wiring (SP-01…SP-09, A01–A12), staging-only synthetic endpoints, release-candidate suite T1–T3 and T7–T9.
- **R** R-ENG-03, R-NPC-05 · **Dep** M13d1, M06a4, M05b1 · **Read** `09-backend-ops.md` §4–§5; [research/gap-observability-cost-guardrails.md Rec 3] · **Out** `config/guardrails.yaml`, `services/edge/src/{ops,alerts}`, `packages/shared/src/api/ops.ts`, `tools/ops/suites/guardrails` · **C** C12 1.2 (routes 56–57), C16 1.1
- **Gate** `ANTHROPIC_ADMIN_KEY`, `FAL_KEY_BILLING`, `ALERT_HMAC`, `ALERT_WEBHOOK_URL`; Anthropic workspace `synthetic` · **Proof** `pnpm test:ops -- --suite guardrails`; `pnpm check:prod-routes` (synthetic endpoints absent in production)

### M14b2 · launch-hardening-guardrails — 1 · risk M · S09 (split 2 of 3)
- **Goal:** nightly staging suite T4–T6 plus T9 (three green nights before launch), backup restore drill, quarterly staging kill-switch drill (`quarterly.yml`, DL-480), gradual rollout default with the A03 abnormal-exit release rule, enforcing CSP (DL-191, DL-241), full telemetry registry audit.
- **R** R-ENG-03, R-PLAT-05 · **Dep** M14b1, M12c2 · **Read** `09-backend-ops.md` §2, §4; `09-backend-db.md` §7 · **Out** `tools/ops/suites/{guardrails-nightly,restore-drill}`, `apps/web/public/_headers`, `.github/workflows/{nightly,quarterly}.yml` · **C** C16 1.2
- **Gate** staging · **Proof** `pnpm test:ops -- --suite guardrails-nightly`; `pnpm test:ops -- --suite restore-drill`; `pnpm check:telemetry`

### M14b3 · launch-hardening-guardrails — 1 · risk H · S13, S05, S06 (split 3 of 3)
- **Goal:** release-candidate gate: DoD audit H1–H10, trace report with no empty row, full device pass, `ip:history`, `ip:similarity` (Zone R), terms watch, names knock-out applied (DN-S06-02), sign-offs recorded in `docs/legal/launch-gates.json` (Q-18, Q-21, Q-23), the `art-final` gate (DL-390; audio rules from M10e, DL-500), flag-flip checklist, `release.yml`.
- **R** R-IP-01/02, R-ENG-01/02/04, R-PLAT-05 · **Dep** M14b2, M14c, M05f2, M10c, M10d2, M10d3, M10e, M11a2, M11b4, M12e, M13c3, M06b4, M13a7, M13b2, M13b3, M08c2, M06c, M06a5, M05c3, M02d2, M02b2 · **Read** `13-qa-critics.md` §2; `spec/08-test-and-ci.md` §3.3, §5.7; `05-assets-pipeline.md` §9 · **Out** `.github/workflows/release.yml`, `docs/legal/launch-gates.json`, `docs/device-runs/M14b3/` · **C** C15 1.1
- **Gate** Q-13, Q-15, Q-18, Q-21, Q-23 (release only) · **Proof** `pnpm check:unit -- tools/ci` (launch-gate record complete; trace has no empty row); `pnpm ip:history`; `pnpm names:lint`; manual `M14b3-*` device pass then `pnpm perf:verify`

### M14a · thirdweb-siwe-link — 1 · risk M · S09 (+S10) · **last v1 milestone (R-AUTH-02)**
- **Goal:** migration 0009, SIWE nonce and verify (route 12), merge requests (13), Thirdweb adapter behind the single `IdentityService` interface, link page, `/link` registry entry and a linked-publish proof (DL-349); re-run the release gate subset.
- **R** R-AUTH-02/01 · **Dep** M14b3, M12a1 · **Read** `09-backend-contracts.md` §2.4 rows 12–13; `09-backend-db.md` §3 (0009) · **Out** `packages/identity/src/thirdweb`, `services/edge/src/id/siwe`, `supabase/migrations/0009_link.sql` · **C** C12 1.1
- **Gate** Thirdweb Growth plan ($99/month, F-059) owner approval · **Proof** `pnpm check:workers -- siwe-link` (reused nonce fails; fresh nonce links without data loss); `pnpm check:workers -- siwe-linked-publish` (device code, route 36, NPC submit after the link); `pnpm check:unit -- packages/identity`; `pnpm test:ops -- --suite guardrails`

## Block I — Bay expansion (post-v1; each id is one session with a capped area core, no new ids, DL-242)

| ID | Slug | Sessions | Dep | Goal | Read | Key proof |
|---|---|---|---|---|---|---|
| M15a | bay-expansion-framework | 1 | M14a | portal and backdrop-to-district framework; bake areas beyond SF | `02-world-maps.md` §4, §8; `02-world-bake.md` §8 | a fixture district streams through its portal (`pnpm map:verify`, `pnpm check:perf -- --scenario route-ferry-ocean-beach`) |
| M15b | oakland-core | 1 | M15a | Oakland core districts | same | Bay Bridge portal streams Oakland; graph gates pass |
| M15c | berkeley-richmond | 1 | M15b | Berkeley and Richmond | same | district gates and attribution |
| M15d | marin-gateway | 1 | M15a | Golden Gate portal to Marin | same | portal streaming |
| M15e | peninsula-north | 1 | M15a | northern Peninsula | same | district gates |
| M15f | peninsula-vc-row | 1 | M15e | Sand Hill and VC row | same | district gates; tycoon locations resolve |
| M15g | south-bay-san-jose | 1 | M15f | San Jose and the South Bay | same | district gates |

Gates for all M15 scopes: R-MAP-02; OSM/DataSF-equivalent sources and attribution per area (licence check per source before bake).
