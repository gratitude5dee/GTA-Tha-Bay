# S13 — QA, part C: traceability method and seed matrix

> Wave 5 · v1.0 · 2026-10-18 · continues `13-qa.md` §2.6. Format per 03-SPEC-TEMPLATE §G: `| R-ID | spec sections | milestones | tests (names) | status |`. This seed matrix is hand-built from the domain specs and `spec/07-milestones/_PLAN-*.md`; from M00d on, `tools/ci/trace.ts` regenerates it from the milestone files into `tests/reports/trace.md`, which `spec/01-product.md` copies.

## 1. Method

1. **Sources.** R-IDs: 06 §2 (42 ids). Milestones: `## Requirements` of each `spec/07-milestones/M*.md`, else (no file yet) the `**R**` field of `_PLAN-*.md`; never the union. Owner gates: `spec/trace-gates.json` (`{ [rId]: QId[] }`), open or closed per `docs/legal/launch-gates.json` (M14b3). Tests: the proofs of each AC (C15 1.1 grammar; test names follow `<package-or-suite>/<area>.<case>`, e2e tags `@<domain>[-<aspect>]`). Spec sections: the domain §1 R-ID tables.
2. **Join.** For each R-ID: the milestones that cite it, the AC proofs of those milestones, and the oracle kind of each proof (13-qa §4.2).
3. **Status** per row: `planned` (milestone files PENDING) → `ready` (all citing files READY) → `tested` (every citing milestone DONE with its proofs green on `main`) → `seen-on-device` (device ACs uploaded and verified) · `blocked (Q-NN)` when an owner gate holds the release only (a `tested` or `seen-on-device` row with an open mapped gate). `empty` and `device-only` are failure flags (item 4), not statuses. M00d's `trace.ts` computes these exactly; M14b3 consumes them unchanged.
4. **Failure rules** (test `tools/ci/test/traceability.test.ts`): an R-ID with no milestone; an R-ID whose only proofs are `device-check` while its domain §9 lists an automatable test; a milestone citing an R-ID not in 06 §2; a test tag cited by an AC that no spec in `tests/e2e/` declares once that milestone is DONE.
5. **Ownership.** The Architect verifies the generated matrix at each checkpoint (`_PLAN.md` §3); critics use it in the scope lens.

## 2. Seed matrix (status `planned`: every row cites at least one PENDING milestone)

Corrected 2026-10-18 (DL-217): the first version took milestones only from the `_PLAN-*.md` `**R**` fields and missed R-IDs that the twelve READY files cite in `## Requirements` (§1 item 1 makes the file win). Those citations and their tests are added; "(s)" marks a support or groundwork citation; the spec-section column also names the Wave 5 integration files (`spec/02`, `spec/05`, `spec/06`, `spec/10`) where they carry the design. `spec/01-product.md` §13 is the same table.

| R-ID | Spec sections | Milestones | Tests (names) | Status |
|---|---|---|---|---|
| R-PLAT-01 | 11-platform §1; 11-platform-pwa §2–§6; 09-backend-ops §1; spec/02 §4.2 | M00, M00a, M01a2, M01b2, M01c, M01d, M01e, M04a1, M04b2, M04c, M11a2 | `@pwa`, `@boot`, `check:headers`, `check:coi`, `pack-store.spec`, `@offline-relaunch`, `@ui-touch`, `heartbeat` | planned |
| R-PLAT-02 | 11-platform-xr §2–§5; 10-ui-hud-xr §2 | M00, M01b2, M01c (s), M11b1, M11b3, M11b2, M11b4 | `@xr-smoke`, `xr-session.spec`, `xr-input-routing.spec`, `xr-comfort.spec`, `@tycoon-xr`, `@xr-npc`, `@xr-story`; checklists `M01c-{quest3,visionpro}`, `M11b-{quest,visionpro}` | planned |
| R-PLAT-03 | 11-platform §2, §4; 01-engine §2 | M00, M01a1, M01a2, M01b1, M01c, M01d, M01e, M01f (s), M02b1, M11a1 | `@probe` (`gpu-probe.json`), `renderer-host.spec`, `tier-select.spec`, `@determinism`, `control.onfoot`, `world.codec` | planned |
| R-PLAT-04 | 01-engine-contracts C04; 01-engine §2 | M01b1, M01b2, M03a1 | `engine/camera.sweep100`, `@fp-tp`, `engine/lines.filbert` | planned |
| R-PLAT-05 | 11-platform §4.5, §5.5; 11-platform-perf §5 | M01b2, M01c, M11a1, M11a2, M14b2, M14b3 | `governor.spec`, `frame-pacer.spec`, `perf:verify` on `M01c-iphone15` and `M11a-*`, A03 release rule | planned |
| R-AUTH-01 | 09-backend §2; 09-backend-contracts §2; spec/05 §2 | M04b3, M06a1, M06a3, M12a1, M12a2, M14a | `@offline`, `play-token`, `refresh-reuse`, `save-conflict`, `rls-thirdparty` | planned |
| R-AUTH-02 | 09-backend §2 (identity interface) | M04b3, M14a | `packages/identity` unit suite, `siwe-link` | planned |
| R-AUTH-03 | 12-modding-publish C§2; 09-backend-contracts §2.4 rows 10–11 | M13c1, M13c3 | `device-code`, `@link`, `test:staging -- mod-publish` | planned |
| R-ROLL-01 | 09-backend §1; spec/00-plan ordering anchors; _PLAN §0 rule 4 | M00, M00a, M00d, M04b3, M05c2 | `@smoke`, `check:smoke` on staging, `@story`; `check:rollout` (M00d) | planned |
| R-ROLL-02 | 09-backend-contracts §1; 09-backend-db §2; spec/05 §4 | M01a1 (s), M01a2 (s), M01b1 (s), M01f (s), M05d, M12a1, M12b1, M12b2, M12c1, M12c2, M12d, M12e | `engine/determinism.node`, `rooms-*` suites, `@mp`, `load:rooms`, `check:db` | planned |
| R-MAP-01 | 02-world §1–§2; 02-world-bake §1–§9 | M01e (s), M01f, M02a1, M02a2, M02b1, M02c1, M02d1, M02d2, M05c1, M07b1 | `shared/c08.grid`, `map:fixture --check`, `@pack-graybox`, `map:verify`, `@world-teleport`, `landmarks.verify` | planned |
| R-MAP-02 | 02-world-maps §4, §8 | M02b1, M02d2, M15a, M15b, M15c, M15d, M15e, M15f, M15g | `@world-boot-size` (backdrop), `route-ferry-ocean-beach` | planned |
| R-MAP-03 | 02-world-maps §1–§3, §5, §7 | M02c1, M02c2, M13b2 | `@world-map`, `@world-attribution`, `anchor-rules` | planned |
| R-MAP-04 | 02-world-living §1–§8 | M02a2, M02b2, M03b1, M03b2, M06c | `@world-hash`, `world/traffic.signals`, `robotaxi.blackout`, `ped.crossing`, `@world-sky`, `downtown-rush` | planned |
| R-CUT-01 | 03-story-cutscenes §D1–§D5, §D9; 05-assets-pipeline §6; spec/06 §5, §8 | M00c, M05b1, M05b2, M05c3, M10b | `cutscene-singleflight`, `genjob-poll-fallback`, `budget-cache-first`, `cutscene-key` vectors, `check:c2pa`, `tools/assets/test/spike.test.ts` | planned |
| R-CUT-02 | 03-story-cutscenes §D4; 07-fighter-content FX6; 06-racing-data §4.2 | M05b2, M05c2, M07b2, M08b2, M05e1, M05e2, M05f1, M05f2 | `@cutscene`, `@fighter-cutscene`, `map:races validate` (intro refs), `assets:cutscene-index -- --count fighter` | planned |
| R-CUT-03 | 03-story-cutscenes §D6–§D7 | M00c (s), M04c, M05a2, M05b2, M07b2, M08b2, M05f2, M11b4 | `@cutscene` (absent → fallback ≤ 2.5 s), `director-los`, XR cutscene checklist row | planned |
| R-NPC-01 | 04-npc §1; 04-npc-contracts B5; 04-npc-builder C8–C9 | M06a2, M06c, M10a2, M10c | `npc:lint`, `npc/brains` determinism, roster completeness in `check:fighter` | planned |
| R-NPC-02 | 05-assets-pipeline §1–§5, §12; spec/06 §3, §12 | M00c, M05b1, M10a1, M10a2 | `check:pipeline` (zero calls on rerun), `assets:gen plan`, `assets:verify`, `genai:spike -- --verify` | planned |
| R-NPC-03 | 04-npc-builder C1–C7 | M06b1, M06b2, M06b3, M06b4 | `npc-builder-*` Workers suite, `@npc-builder` | planned |
| R-NPC-04 | 04-npc-contracts B1–B4; 05-assets §5.4; 05-assets-pipeline §10; spec/06 §9 | M00b, M00c, M01e (s), M06a1, M06a2, M06a4, M08b1, M08b2, M10a1, M10b | `likeness:gate`, `killswitch`, `store.rules` (`evictByTag`), `npc-tts-gating`, `@fighter-kill`, `@kill-drill` | planned |
| R-NPC-05 | 04-npc §5; 09-backend-ops §3, §5; spec/02 §4.4 | M06a1, M06a3, M06a4, M06a5, M09b2, M11b3 (s), M14b1 | `npc-talk-*` (timeout 4 s, quota, governor, cache order), `@npc-offline`, `@xr-npc`, `check:secrets -- apps/web/dist`, guardrails T1 | planned |
| R-MODE-01 | 03-story §1–§5; 03-story-missions §C1–§C11; 01-engine-save-modes PursuitDirector | M03a1, M03c, M04a1, M04a2, M04d, M05a1, M05a2, M05c1, M05c2, M05e1, M05e2, M05f1, M05f2 | `compiler`, `vm-ops`, `check:missions` (all acts), `engine/pursuit.*`, `@save-kill` | planned |
| R-MODE-02 | 06-racing §1–§6; 06-racing-data; 06-racing-content | M03a1, M03a2, M03c, M07a1, M07a2, M07b1, M07b2, M11b2, M12e, M13a7 | `racing/*` suite, `map:races par`, `@racing-det`, `@racing-vs`, `race-sprint` | planned |
| R-MODE-03 | 07-fighter-core; 07-fighter-content; 07-fighter-pose | M01a1 (s), M08a1, M08a2, M08b1, M08b2, M08c1, M08c2, M10a2, M11b2 | `shared/detmath.vectors`, `fighter:replay` goldens, `@fighter-hash`, `fighter:balance`, `fighter:pose-fixtures`, `@pose` | planned |
| R-MODE-04 | 08-tycoon; 08-tycoon-finance; 08-tycoon-events | M01a1 (s), M09a1, M09a2, M09b1, M09b2, M11b4, M12e | `shared/detmath.vectors`, finance vectors TV/WF, `check:balance`, `@tycoon-a11y`, `@tycoon-save`, `dialogue.clamp.spec` | planned |
| R-MODE-05 | 01-engine-save-modes §C06; 03-story-narrative §B7 | M04a1, M04a2, M04b1, M05c1, M05c2, M07a1, M07a2, M08a2, M09a2, M09b2, M05e1 | `engine/modes.*` (idempotent unlock), `@story` (resume with `unlock.racing`), T-10 | planned |
| R-MOD-01 | 12-modding §2; 12-modding-contracts B§1–B§5; 12-modding-publish C§1 | M00b (s), M13a1, M13a2, M13a3, M13a4, M13a5, M13a6, M13a7, M13c3 | `tools/ci/test/gates.test.ts`, `pack-deterministic`, `install-atomic`, `mod-sandbox-*`, `@mods-exp`, `check:skills`, `check:mods` | planned |
| R-MOD-02 | 12-modding-publish C§2 | M13a6, M13b3, M13c1, M13c3 | `device-code`, `@link`, `scene-ops-caps`, `test:staging -- mod-publish` | planned |
| R-MOD-03 | 12-modding-publish C§3, C§5; 09-backend-db 0007 | M13b1, M13b2, M13b4, M13c2, M13d1 | `report-threshold`, `exp-rating`, `@ui-forum`, `mod-scan-quarantine` | planned |
| R-MOD-04 | 12-modding-publish C§4; 12-modding-contracts B§6 | M13a2, M13a3, M13a7, M13b2, M13b3, M13c2 | `mods-4007`, `@mods-exp`, `anchor-rules`, `publish-flag` | planned |
| R-UI-01 | 10-ui-pages §2 (creator), §4.1 | M04b2 | `creator.spec` (`AppearanceV1` ≤ 512 B), `@creator` | planned |
| R-UI-02 | 10-ui-pages §2.9; 10-ui §2 | M04b1, M11b3, M14c | `@ui-menus`, `@ui-a11y`, `check:i18n`, XR comfort panel e2e | planned |
| R-UI-03 | 10-ui §1–§3; 10-ui-pages §2 | M00, M04b1, M04b2, M09b1, M12a2, M06b3, M12d, M13a7, M13b4, M13d2 | `@ui-shell`, `@ui-menus`, `@ui-saves`, `@ui-online`, `@ui-forum`, `@ui-legal`, `ui-screen-parity.spec` | planned |
| R-IP-01 | 05-assets §5; 05-assets-pipeline §9; spec/06 §7 | M00, M00b, M01d, M01f, M02a1, M02d1, M07a1, M07b1, M13a1, M14b3 | `provenance:check`, `ip:signatures`, `ip:strings`, `names:lint`, `names:brand`, `ip:history`, `ip:similarity` | planned |
| R-IP-02 | 04-npc-contracts B8; 05-assets-pipeline §10 | M00b, M00c, M01e (s), M06a1, M06a2, M08b1, M10a1, M10b, M10c, M14b3 | `likeness:gate`, `killswitch`, `store.rules` (`evictByTag`), `@kill-drill`, consent-index export | planned |
| R-IP-03 | 09-backend §3.4; 12-modding-publish C§3; spec/05 §5 | M00a (s), M06a5, M06b1, M06b2, M13b1, M13b4, M13c2, M13d1, M13d2 | `geo-gate` (legal routes exempt), `report-threshold`, `ncii-clock`, `evidence-audit`, `@ui-legal`, report button in `@npc` | planned |
| R-IP-04 | 07-fighter-pose FP7; 10-ui-pages §2 (age); spec/03 D-30 | M04b1, M08c1, M08c2, M12a1, M12a2, M06b2 | `@pose` (no image bytes), worker network allow-list, `@ui-age` (under-18 blocked) | planned |
| R-ENG-01 | 13-qa §1, §3.8; spec/08 §1, §6 | M00, M00a, M00b, M01a1, M01d, M00d, M04d, M13a6, M14b3 | C15 lint, `check:agents`, `check:skills`, M00 AC-1/AC-2, `assets-gates` | planned |
| R-ENG-02 | 11-platform-perf §5; spec/08 §4 | M00, M01a1, M01a2, M01c, M01d, M01e, M00d, M02b1, M04d, M11a1, M11a2, M12c2, M14b3 | `check:perf -- --fail`, `perf:verify`, `perf-budget.spec`, `engine/loop.*`, `bench:physics`, `lanes`, `load:rooms` | planned |
| R-ENG-03 | 09-backend-ops §5; 05-assets-pipeline §11; spec/10 §3–§5; DL-OWN-01 | M00a, M00b, M00c, M05b1, M05d, M05c3, M10a1, M10b, M06b4, M14b1, M14b2 | `check:prod-routes`, `genai:liveness`, `budget-cache-first`, governor levels, guardrails T1–T9, spike ledger cap | planned |
| R-ENG-04 | 10-ui §2 (a11y); 11-platform-xr §4 (comfort); 04-npc §5 (subtitles) | M01b1, M01b2, M04a2, M04b1, M04b2, M04c, M06a4, M06a5, M08a2, M09b1, M11b1, M11b3, M14c, M14b3 | `@ui-a11y`, controls remap persistence, `@cutscene` subtitles, `xr-comfort.spec`, `@tycoon-a11y` | planned |

All 42 rows are non-empty (03 §H.2).
