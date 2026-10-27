# 07 — Milestone files: status

> Architect, 2026-10-18 (full handoff, DL-245). One file per milestone, `spec/07-milestones/<ID>-<slug>.md`, in the C15 format of `prompt-pack/03-SPEC-TEMPLATE.md` §C (C15 1.1, `spec/domains/13-qa.md` §4). Ids, slugs, run order and dependencies come from `_PLAN.md` §1 (letter = scope, digit = session split, DL-037, DL-212). The Builder works through the files in the order of `prompt-pack/04-SONNET-KICKOFF.md` `<milestones>`, which copies the table below.

## Status values
- **READY** — the file exists, follows C15, every acceptance criterion has a proof that exists by the end of that milestone, and no criterion relies on an UNVERIFIED fact. The Builder may start it once every milestone in its Depends on is merged.
- **READY · frozen (executing)** — the twelve fast-track files (M00 … M01f). A Builder is executing M00; these files change only for a defect that blocks a Builder, and every such change is logged in the decision log (`spec/11-decision-log-2.md` from DL-245, continued in `spec/11-decision-log-4.md`; DL-341, and `spec/11-decision-log-4b.md`; DL-530, and `spec/11-decision-log-5.md` from DL-500, continued in `-5b.md`, `-5c.md` and `-5d.md`).
- **PENDING** — no file yet, or the file is being rewritten. The Builder never starts a PENDING milestone. No file is PENDING at this handoff.
- **IN PROGRESS / DONE** — set by the Builder (branch `m<id>-<slug>` exists / merged to the default branch). Record the change in this table in the milestone's PR.

The status cell's first word is the status; `· frozen (executing)` is a qualifier. M00d's lint reads the `ID`, `Status` and `File` columns by header name (DL-245).

## Freeze rule
A READY file is **frozen once a Builder starts it** (the moment its branch `m<id>-<slug>` exists). Nobody edits a started file, the Architect included, except for a blocking defect, which is logged. A correction found later goes to the decision log and into the next affected milestone's file (or a new milestone), never back into the started one, so a session always works against the text it began with. Before it starts, a READY file may still be corrected (for example after a critic pass at a `_PLAN.md` §3 checkpoint); each correction is logged.

## Ordering and parallel Builders
- The table order is the run order (`_PLAN.md` §1). A single Builder runs it top to bottom; when a file's Depends on names a milestone not yet done, that one runs first (M01f, 0.5 session, runs before M01b2 and M01e).
- **Several Builders may run at once** (DL-246): one git worktree and one branch `m<id>-<slug>` per milestone (worktrees under `.claude/worktrees/`, git-ignored); a Builder starts a milestone only when every milestone in its Depends on is **merged** to the default branch; PRs merge in run order (a later row waits for every earlier row that is in flight), and each branch rebases on the default branch before merging. Deploys come only from the default branch (`deploy.yml`); a Preview per PR is fine.
- R-ROLL-01: no rooms milestone (M12b1 onward) starts before M05c2 is deployed to staging and its ACs pass there. R-AUTH-02: M14a is the last v1 milestone; M15a–M15g are post-v1 (Bay expansion), one session each (DL-242).
- Every family above one session is split into digit-suffixed ids (DL-212).
- **Runs next: M00e** `owner-account-hardening` (row 14; formerly the owner PR #1 follow-up list, DL-605; `_PLAN.md` §0 rule 7, Q-43; M00a, M00b and M01c are merged into `claude/build`). No milestone that touches `services/edge/src`, `services/edge/test` or `services/edge/wrangler.jsonc` starts before it has merged (M05d and M13a1 name it in Depends on); milestones already executing (M00…M01f) merge as before, and M05b1 (started 2026-10-19) merges after it in run order.
- **Already executing: M00d** `qa-spec-gates` (row 13; branch `claude/build-m00d`, frozen since it started; its PR sets the row to IN PROGRESS; not gated by rule 7, it writes only a docs `services/edge/README.md`) merges as before (DL-648).
- **Study set (owner request 2026-10-23, DL-716, order amended by DL-732; `_PLAN.md` §0 rule 9):** M04e5, M04e0 and M02f1 (rows 43–45) run before M05c2; M04e1–M04e4, M04b5, M04b4, M02f2 and M01d3 (rows 49–56) run after M05c3; M07b3 follows M07b2 and M10f follows M10d4 (DL-739). M04e0 must merge before M12b1 starts; M04e5 is in the Depends on of every later sandbox file. M02f1, M04b5, M04b4 and M02f2 share files and run one at a time in that order.
- **Look program (owner decision 2026-10-26, DL-OWN-07, DL-739; `_PLAN.md` §0 rule 10):** M02g1–M02g2 (Phase 0) and M02h1–M02h7 (Phase 1) are rows 57–65, after M01d3, and run one at a time in that order (shared files and a chained render-object ledger); M10d0, M10d1 (vehicles and props) and M10d4 (pedestrians and creator parts) are rows 92–94, before M10f, and replace the one-session M10d1; M02h8 (XR look, TRAA) is row 104, after M11a1 and before M11b1, which names it in Depends on (DL-741); the look study must be committed before M02g1 starts.
- **Then: M00f** `third-party-reuse-gates` (row 15, needs M00d; formerly the reuse-gates follow-up list, DL-605; `_PLAN.md` §0 rule 8): a gate for no milestone; nothing is vendored into `third_party/` before it merges (DL-607).

## Table (READY 148, of which 12 frozen (executing); 141 v1 milestones ≈ 126.0 sessions + 7 post-v1 = 133.0 sessions; M10d1–M10d2 added by DL-390, M10d3 by DL-460, M10e by DL-500, M00e–M00f by DL-605, M02e by DL-704, M01d2 by DL-713, the study set M04e0–M04e5, M04b4, M04b5, M02f1, M02f2, M01d3, M07b3 and M10f by DL-716, the look program M02g1–M02g2, M02h1–M02h8, M10d0 and M10d4 (with M10d1 split) by DL-739; the conditional M01d4 is not listed, DL-723)

Reconciled by the Architect on 2026-10-18 (`spec/11-decision-log-3.md` DL-218…DL-244; mechanical sweep DL-244: 0 findings) and promoted to READY at the handoff (`spec/11-decision-log-2.md` DL-245). Gates (secrets, devices, owner questions) per milestone are in the kickoff list and `_PLAN-1/2/3.md`.

| # | ID | Slug | Sessions | Depends on | Status | File |
|---|---|---|---|---|---|---|
| 1 | M00 | bootstrap-ci-pwa-on-workers | 1 | — | READY · frozen (executing) | `M00-bootstrap-ci-pwa-on-workers.md` |
| 2 | M00a | edge-api-skeleton | 0.8 | M00 | READY · frozen (executing) | `M00a-edge-api-skeleton.md` |
| 3 | M00b | ip-provenance-gates | 1 | M00 | READY · frozen (executing) | `M00b-ip-provenance-gates.md` |
| 4 | M00c | genai-spike | 1 | M00b, M00a | READY · frozen (executing) | `M00c-genai-spike.md` |
| 5 | M01a1 | loop-ecs-detmath-physics | 1 | M00 | READY · frozen (executing) | `M01a1-loop-ecs-detmath-physics.md` |
| 6 | M01a2 | loop-ecs-detmath-physics | 1 | M01a1, M00 | READY · frozen (executing) | `M01a2-loop-ecs-detmath-physics.md` |
| 7 | M01b1 | controller-cameras-touch | 1 | M01a2 | READY · frozen (executing) | `M01b1-controller-cameras-touch.md` |
| 8 | M01b2 | controller-cameras-touch | 1 | M01b1, M01f, M00 | READY · frozen (executing) | `M01b2-controller-cameras-touch.md` |
| 9 | M01c | device-spike-renderer-host | 1 | M00, M00a, M01a2 | READY · frozen (executing) | `M01c-device-spike-renderer-host.md` |
| 10 | M01d | assets-publish | 1 | M00b, M00a, M01a1 | READY · frozen (executing) | `M01d-assets-publish.md` |
| 11 | M01e | asset-worker-opfs-store | 1 | M01d, M01c, M00a, M00, M01a2, M01f | READY · frozen (executing) | `M01e-asset-worker-opfs-store.md` |
| 12 | M01f | world-graybox-fixture-codec | 0.5 | M01a1, M00b | READY · frozen (executing) | `M01f-world-graybox-fixture-codec.md` |
| 13 | M00d | qa-spec-gates | 1 | M00, M01c, M00b | READY | `M00d-qa-spec-gates.md` |
| 14 | M00e | owner-account-hardening | 1 | M00a, M00b, M01c | READY | `M00e-owner-account-hardening.md` |
| 15 | M00f | third-party-reuse-gates | 0.7 | M00b, M00d | READY | `M00f-third-party-reuse-gates.md` |
| 16 | M02a1 | bake-core | 1 | M01f, M01d, M00d, M01e | READY | `M02a1-bake-core.md` |
| 17 | M02a2 | bake-roads-graph | 1 | M02a1 | READY | `M02a2-bake-roads-graph.md` |
| 18 | M02b1 | streaming-lod | 1 | M02a2, M01c, M01e, M01b2 | READY | `M02b1-streaming-lod.md` |
| 19 | M02b2 | weather-time | 1 | M02b1 | READY | `M02b2-weather-time.md` |
| 20 | M02e | look-pass | 1 | M02b1, M02b2, M01c | READY | `M02e-look-pass.md` |
| 21 | M02c1 | graph-services-teleports | 1 | M02a2, M02b1, M02b2 | READY | `M02c1-graph-services-teleports.md` |
| 22 | M02d1 | landmarks-kit-and-heroes | 1 | M02b1, M02c1 | READY | `M02d1-landmarks-kit-and-heroes.md` |
| 23 | M02d2 | landmarks-rest-and-swap | 1 | M02d1 | READY | `M02d2-landmarks-rest-and-swap.md` |
| 24 | M03a1 | vehicles-interaction-prefabs | 1 | M01b2, M02c1 | READY | `M03a1-vehicles-interaction-prefabs.md` |
| 25 | M03a2 | handling-model-wheel-spike | 0.5 | M03a1 | READY | `M03a2-handling-model-wheel-spike.md` |
| 26 | M03b1 | traffic-robotaxis | 1 | M02c1, M03a1, M02b2 | READY | `M03b1-traffic-robotaxis.md` |
| 27 | M03b2 | peds-transit | 1 | M03b1 | READY | `M03b2-peds-transit.md` |
| 28 | M03c | pursuit-director | 1 | M03a1, M03b1 | READY | `M03c-pursuit-director.md` |
| 29 | M01d2 | media-route | 0.4 | M01d, M00e | READY | `M01d2-media-route.md` |
| 30 | M04a1 | saves-gamemode-unlocks | 1 | M01b2 | READY | `M04a1-saves-gamemode-unlocks.md` |
| 31 | M04a2 | saves-gamemode-unlocks | 1 | M04a1, M03c, M03b2, M02b2 | READY | `M04a2-saves-gamemode-unlocks.md` |
| 32 | M04b1 | shell-ui-kit-menus-settings | 1 | M04a2, M00e | READY | `M04b1-shell-ui-kit-menus-settings.md` |
| 33 | M04b2 | creator-phone-hud-kit | 1 | M04b1 | READY | `M04b2-creator-phone-hud-kit.md` |
| 34 | M02c2 | maps | 1 | M02c1, M04b2, M01d2 | READY | `M02c2-maps.md` |
| 35 | M04b3 | local-identity-play-token | 0.5 | M00a, M04b1 | READY | `M04b3-local-identity-play-token.md` |
| 36 | M04c | cutscene-playback-spike | 1 | M01c, M04b1 | READY | `M04c-cutscene-playback-spike.md` |
| 37 | M04d | qa-harness-bots-goldens | 1 | M04a2, M03a1, M00d | READY | `M04d-qa-harness-bots-goldens.md` |
| 38 | M05a1 | mission-ir-vm | 1 | M04a2, M02c1 | READY | `M05a1-mission-ir-vm.md` |
| 39 | M05a2 | autoplayer-director-preview | 1 | M05a1, M04d | READY | `M05a2-autoplayer-director-preview.md` |
| 40 | M05b1 | cutscene-infra-mock | 1 | M00a, M00c, M01d | READY | `M05b1-cutscene-infra-mock.md` |
| 41 | M05b2 | cutscene-player-index | 1 | M05b1, M04c, M05a1 | READY | `M05b2-cutscene-player-index.md` |
| 42 | M05c1 | act1-missions-1-6 | 1 | M05a2, M05b2, M03c, M04b2, M02c2 | READY | `M05c1-act1-missions-1-6.md` |
| 43 | M04e5 | ip-wall-strings | 0.2 | M00b, M02c1, M03c, M04b2 | READY | `M04e5-ip-wall-strings.md` |
| 44 | M04e0 | sandbox-rooms-guard | 0.2 | M04b2, M02c2 | READY | `M04e0-sandbox-rooms-guard.md` |
| 45 | M02f1 | stream-measure | 0.6 | M02b1, M01d2, M02c2 | READY | `M02f1-stream-measure.md` |
| 46 | M05c2 | act1-vertical-slice | 1 | M05c1, M03b2 | READY | `M05c2-act1-vertical-slice.md` |
| 47 | M05d | data-spine-supabase | 1 | M05b1, M00e | READY | `M05d-data-spine-supabase.md` |
| 48 | M05c3 | act1-prewarm | 0.7 | M05c2, M05d | READY | `M05c3-act1-prewarm.md` |
| 49 | M04e1 | sandbox-world-controls | 0.8 | M04e5, M04e0, M04b2, M02b2, M03b1, M03b2 | READY | `M04e1-sandbox-world-controls.md` |
| 50 | M04e2 | sandbox-teleport-display | 0.7 | M04e1, M04e5, M04e0, M02c1, M02c2, M04b2, M04a2 | READY | `M04e2-sandbox-teleport-display.md` |
| 51 | M04e3 | sandbox-vehicle-spawner | 0.8 | M04e1, M04e5, M04e0, M03a1, M07a1, M05c1 | READY | `M04e3-sandbox-vehicle-spawner.md` |
| 52 | M04e4 | sandbox-vehicle-player-actions | 0.6 | M04e3, M04e5 | READY | `M04e4-sandbox-vehicle-player-actions.md` |
| 53 | M04b5 | settings-live-overlay-hooks | 0.8 | M01c, M04b1, M04b2 | READY | `M04b5-settings-live-overlay-hooks.md` |
| 54 | M04b4 | offline-download-ui | 0.3 | M01e, M04b1 | READY | `M04b4-offline-download-ui.md` |
| 55 | M02f2 | boot-prefetch | 0.5 | M01e, M02b1, M04b1, M04a2 | READY | `M02f2-boot-prefetch.md` |
| 56 | M01d3 | media-route-tuning | 0.4 | M01d2, M00e | READY | `M01d3-media-route-tuning.md` |
| 57 | M02g1 | look-tune | 1 | M02e, M02f2, M01c, M05c2 | READY | `M02g1-look-tune.md` |
| 58 | M02g2 | look-fixes | 0.7 | M02g1, M02d2 | READY | `M02g2-look-fixes.md` |
| 59 | M02h1 | street-markings | 1 | M02g2, M02a2 | READY | `M02h1-street-markings.md` |
| 60 | M02h2 | curbs-sidewalks | 1 | M02h1 | READY | `M02h2-curbs-sidewalks.md` |
| 61 | M02h3 | ground-cover | 1 | M02h2, M02g2, M02a2 | READY | `M02h3-ground-cover.md` |
| 62 | M02h4 | vegetation-forms | 0.75 | M02h3, M02g2 | READY | `M02h4-vegetation-forms.md` |
| 63 | M02h5 | vegetation-scatter | 0.75 | M02h4, M02h3 | READY | `M02h5-vegetation-scatter.md` |
| 64 | M02h6 | street-furniture-parking | 1 | M02h5, M02h2, M03b1 | READY | `M02h6-street-furniture-parking.md` |
| 65 | M02h7 | facade-detail | 1 | M02h6, M02g2 | READY | `M02h7-facade-detail.md` |
| 66 | M06a1 | npc-backend-spine | 1 | M05d, M04b3 | READY | `M06a1-npc-backend-spine.md` |
| 67 | M06a2 | soul-contract-compiler | 1 | M00b, M01d | READY | `M06a2-soul-contract-compiler.md` |
| 68 | M06a3 | dialogue-proxy | 1 | M06a1, M06a2 | READY | `M06a3-dialogue-proxy.md` |
| 69 | M06a4 | memory-voice-lipsync | 1 | M06a3, M04b2 | READY | `M06a4-memory-voice-lipsync.md` |
| 70 | M06a5 | dialogue-panel-ui | 0.3 | M06a3, M04b2 | READY | `M06a5-dialogue-panel-ui.md` |
| 71 | M06c | npc-agency-barks | 1 | M06a3, M03b2 | READY | `M06c-npc-agency-barks.md` |
| 72 | M06b1 | builder-text-private | 1 | M06a3 | READY | `M06b1-builder-text-private.md` |
| 73 | M07a1 | racing-core-director-car | 1 | M03a2, M04a2, M04d, M02c1 | READY | `M07a1-racing-core-director-car.md` |
| 74 | M07a2 | racing-ai-replay-ghosts | 1 | M07a1, M03c, M05c1 | READY | `M07a2-racing-ai-replay-ghosts.md` |
| 75 | M07b1 | racing-content-events-ladder | 1 | M07a2, M03b2 | READY | `M07b1-racing-content-events-ladder.md` |
| 76 | M07b2 | racing-garage-replay-photo-visuals | 1 | M07b1, M05b2 | READY | `M07b2-racing-garage-replay-photo-visuals.md` |
| 77 | M07b3 | sandbox-tune | 0.5 | M07b2, M04e3, M04e5 | READY | `M07b3-sandbox-tune.md` |
| 78 | M08a1 | fight-core-sim-data | 1 | M01a1, M05a1 | READY | `M08a1-fight-core-sim-data.md` |
| 79 | M08a2 | fight-mode-training-vs | 1 | M08a1, M04a2, M04b2, M04d, M05c1 | READY | `M08a2-fight-mode-training-vs.md` |
| 80 | M08b1 | fight-roster-kits-ai | 1 | M08a2, M06a2 | READY | `M08b1-fight-roster-kits-ai.md` |
| 81 | M08b2 | fight-stages-cutscenes-arcade | 1 | M08b1, M05b2 | READY | `M08b2-fight-stages-cutscenes-arcade.md` |
| 82 | M08c1 | pose-pipeline-classifier | 1 | M08a2 | READY | `M08c1-pose-pipeline-classifier.md` |
| 83 | M08c2 | pose-calibration-gate | 1 | M08c1 | READY | `M08c2-pose-calibration-gate.md` |
| 84 | M09a1 | tycoon-core-finance | 1 | M01a1, M04a2, M04d | READY | `M09a1-tycoon-core-finance.md` |
| 85 | M09a2 | tycoon-events-balance | 1 | M09a1, M04d | READY | `M09a2-tycoon-events-balance.md` |
| 86 | M09b1 | tycoon-ui | 1 | M09a2, M04b2 | READY | `M09b1-tycoon-ui.md` |
| 87 | M09b2 | tycoon-vc-story | 1 | M09b1, M06a3, M05a1, M05a2 | READY | `M09b2-tycoon-vc-story.md` |
| 88 | M10a1 | roster-pipeline | 1 | M05b1, M06a2, M01d, M05c3 | READY | `M10a1-roster-pipeline.md` |
| 89 | M10a2 | roster-pipeline | 1 | M10a1, M08b1 | READY | `M10a2-roster-pipeline.md` |
| 90 | M10b | qa-gates-kill-drill | 1 | M10a2, M08b2, M06a3 | READY | `M10b-qa-gates-kill-drill.md` |
| 91 | M10c | roster-souls-ink-barks | 1 | M10a2, M06a4, M06c, M05c2 | READY | `M10c-roster-souls-ink-barks.md` |
| 92 | M10d0 | art-admission | 1 | M00f, M01d, M02h7, M10a1 | READY | `M10d0-art-admission.md` |
| 93 | M10d1 | art-integration | 1 | M10d0, M05c2, M03b2, M04b2, M02h6 | READY | `M10d1-art-integration.md` |
| 94 | M10d4 | art-integration | 1 | M10d1, M10d0, M03b2, M04b2, M10a2 | READY | `M10d4-art-integration.md` |
| 95 | M10f | emote-wheel | 0.6 | M10d4, M04b2, M04e5 | READY | `M10f-emote-wheel.md` |
| 96 | M10d3 | art-integration | 1 | M10d4, M07b2, M08b2, M10a2 | READY | `M10d3-art-integration.md` |
| 97 | M10d2 | art-integration | 1 | M10d4, M10d3, M02d2, M02e | READY | `M10d2-art-integration.md` |
| 98 | M05e1 | story-act2-part1 | 1 | M05c2, M07a2, M08b2, M09b2, M07b1 | READY | `M05e1-story-act2-part1.md` |
| 99 | M05e2 | story-act2-part2 | 1 | M05e1 | READY | `M05e2-story-act2-part2.md` |
| 100 | M05f1 | story-act3-part1 | 1 | M05e2, M10b | READY | `M05f1-story-act3-part1.md` |
| 101 | M05f2 | story-act3-finale | 1 | M05f1 | READY | `M05f2-story-act3-finale.md` |
| 102 | M10e | audio-integration | 1 | M10d2, M10c, M05f2, M07b2, M08b2, M03c, M02b2 | READY | `M10e-audio-integration.md` |
| 103 | M11a1 | iphone-hardening-governor | 1 | M02b1, M03b1, M07a2, M04b5 | READY | `M11a1-iphone-hardening-governor.md` |
| 104 | M02h8 | xr-look-traa | 0.8 | M11a1, M02h7 | READY | `M02h8-xr-look-traa.md` |
| 105 | M11a2 | iphone-hardening-governor | 1 | M11a1 | READY | `M11a2-iphone-hardening-governor.md` |
| 106 | M11b1 | webxr-port | 1 | M01c, M04b2, M11a1, M02h8 | READY | `M11b1-webxr-port.md` |
| 107 | M11b3 | xr-ui-panels-comfort | 0.8 | M11b1, M06a5, M04e1, M04e4 | READY | `M11b3-xr-ui-panels-comfort.md` |
| 108 | M11b2 | per-mode-xr-and-xr-cutscenes | 0.7 | M11b1, M07b2, M08b2, M11b3 | READY | `M11b2-per-mode-xr-and-xr-cutscenes.md` |
| 109 | M11b4 | per-mode-xr-and-xr-cutscenes | 0.7 | M11b2, M09b1, M05b2 | READY | `M11b4-per-mode-xr-and-xr-cutscenes.md` |
| 110 | M12a1 | p1-identity-cloud-saves | 1 | M05d, M04b3, M06a1 | READY | `M12a1-p1-identity-cloud-saves.md` |
| 111 | M12a2 | age-register-cloud-save-ui | 0.5 | M12a1, M04b1 | READY | `M12a2-age-register-cloud-save-ui.md` |
| 112 | M06b2 | builder-images-review | 1 | M06b1, M12a1, M06a5 | READY | `M06b2-builder-images-review.md` |
| 113 | M06b3 | npc-builder-ui | 1 | M06b2, M04b2, M06a5, M06c | READY | `M06b3-npc-builder-ui.md` |
| 114 | M12b1 | rooms-core-protocol-v2 | 1 | M12a1, M05c2, M04a2, M04e0 | READY | `M12b1-rooms-core-protocol-v2.md` |
| 115 | M12b2 | rooms-core-protocol-v2 | 1 | M12b1, M04e3 | READY | `M12b2-rooms-core-protocol-v2.md` |
| 116 | M12c1 | rooms-hardening-presence-loadtest | 1 | M12b2 | READY | `M12c1-rooms-hardening-presence-loadtest.md` |
| 117 | M12c2 | rooms-hardening-presence-loadtest | 1 | M12c1 | READY | `M12c2-rooms-hardening-presence-loadtest.md` |
| 118 | M12d | online-page-invites | 0.3 | M12c1, M04b1 | READY | `M12d-online-page-invites.md` |
| 119 | M12e | mode-leaderboards | 1 | M12c2, M07b1, M09a2 | READY | `M12e-mode-leaderboards.md` |
| 120 | M13a1 | mod-sdk-manifest-validators | 1 | M04a2, M01d, M00e | READY | `M13a1-mod-sdk-manifest-validators.md` |
| 121 | M13a2 | mod-installer-store-client | 1 | M13a1, M01e, M05d | READY | `M13a2-mod-installer-store-client.md` |
| 122 | M13a3 | mod-runtime-data-experience | 1 | M13a2, M02c2, M12b1, M12c1, M04b2, M06a3 | READY | `M13a3-mod-runtime-data-experience.md` |
| 123 | M13a4 | mod-script-sandbox | 1 | M13a3 | READY | `M13a4-mod-script-sandbox.md` |
| 124 | M13a5 | mod-ui-tier | 1 | M13a3 | READY | `M13a5-mod-ui-tier.md` |
| 125 | M13a6 | mod-agent-kit | 1 | M13a4, M13a5 | READY | `M13a6-mod-agent-kit.md` |
| 126 | M13a7 | store-experience-pages | 0.7 | M13a3, M07b2, M04b1 | READY | `M13a7-store-experience-pages.md` |
| 127 | M13b1 | forum-reports-backend | 1 | M05d, M06b1, M06b2, M13a2 | READY | `M13b1-forum-reports-backend.md` |
| 128 | M13b2 | forum-ugc-links | 0.8 | M13b1, M13a3, M02c2 | READY | `M13b2-forum-ugc-links.md` |
| 129 | M13b3 | creator-place-mode | 1 | M13a3, M04b2 | READY | `M13b3-creator-place-mode.md` |
| 130 | M13b4 | forum-ui | 1 | M13b1, M04b1 | READY | `M13b4-forum-ui.md` |
| 131 | M13c1 | device-code-publish-login | 0.8 | M12a1, M04b1, M13a2 | READY | `M13c1-device-code-publish-login.md` |
| 132 | M13c2 | publish-pipeline-server | 1 | M13c1, M13a1, M13b1, M13b2 | READY | `M13c2-publish-pipeline-server.md` |
| 133 | M13c3 | publish-cli-link | 1 | M13c2, M13a6 | READY | `M13c3-publish-cli-link.md` |
| 134 | M06b4 | builder-publish-assets | 0.5 | M13c2, M06b3, M10a1 | READY | `M06b4-builder-publish-assets.md` |
| 135 | M13d1 | legal-trust-safety-backend | 1 | M13b1, M06b2, M13c2 | READY | `M13d1-legal-trust-safety-backend.md` |
| 136 | M13d2 | legal-forms-ui | 0.3 | M13d1, M04b1 | READY | `M13d2-legal-forms-ui.md` |
| 137 | M14c | a11y-audit-i18n-gate | 0.5 | M13d2, M13b4, M12d, M06b3, M11b3 | READY | `M14c-a11y-audit-i18n-gate.md` |
| 138 | M14b1 | launch-hardening-guardrails | 1 | M13d1, M06a4, M05b1 | READY | `M14b1-launch-hardening-guardrails.md` |
| 139 | M14b2 | launch-hardening-guardrails | 1 | M14b1, M12c2 | READY | `M14b2-launch-hardening-guardrails.md` |
| 140 | M14b3 | launch-hardening-guardrails | 1 | M14b2, M14c, M05f2, M10c, M10d2, M10d3, M10e, M11a2, M11b4, M12e, M13c3, M06b4, M13a7, M13b2, M13b3, M08c2, M06c, M06a5, M05c3, M02d2, M02b2 | READY | `M14b3-launch-hardening-guardrails.md` |
| 141 | M14a | thirdweb-siwe-link | 1 | M14b3, M12a1 | READY | `M14a-thirdweb-siwe-link.md` |
| 142 | M15a | bay-expansion-framework | 1 | M14a | READY | `M15a-bay-expansion-framework.md` |
| 143 | M15b | oakland-core | 1 | M15a | READY | `M15b-oakland-core.md` |
| 144 | M15c | berkeley-richmond | 1 | M15b | READY | `M15c-berkeley-richmond.md` |
| 145 | M15d | marin-gateway | 1 | M15a | READY | `M15d-marin-gateway.md` |
| 146 | M15e | peninsula-north | 1 | M15a | READY | `M15e-peninsula-north.md` |
| 147 | M15f | peninsula-vc-row | 1 | M15e | READY | `M15f-peninsula-vc-row.md` |
| 148 | M15g | south-bay-san-jose | 1 | M15f | READY | `M15g-south-bay-san-jose.md` |
