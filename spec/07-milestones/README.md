# 07 — Milestone files: status

> Architect, 2026-10-18 (fast-track handoff). One file per milestone, `spec/07-milestones/<ID>-<slug>.md`, in the C15 format of `prompt-pack/03-SPEC-TEMPLATE.md` §C. Ids and slugs come from the register in `spec/00-plan.md` (letter = scope, digit = session split, DL-037). The Builder works through the READY files in the order of `prompt-pack/04-SONNET-KICKOFF.md` `<milestones>`.

## Status values
- **READY** — the file exists, follows C15, every acceptance criterion has a proof that exists by the end of that milestone, and no criterion relies on an UNVERIFIED fact. The Builder may start it.
- **PENDING** — no file yet, or the file is still being written or checked. The Builder never starts a PENDING milestone; it stops after the last READY one and reports.
- **IN PROGRESS / DONE** — set by the Builder's report (branch `m<id>-<slug>` exists / merged). Record the change in this table in the milestone's PR.

## Freeze rule
A READY file is **frozen once the Builder starts it** (the moment its branch `m<id>-<slug>` exists). Nobody edits a started file, the Architect included. A correction found later goes to `spec/11-decision-log.md` and into the next affected milestone's file (or a new milestone), never back into the started one, so a session always works against the text it began with. Before it starts, a READY file may still be corrected; each correction is logged in `spec/11-decision-log.md`.

## Ordering notes
- The kickoff list is the run order. When a READY file's Depends on names a milestone that is not done, that one runs first: M01f (0.5 session) runs before M01b2.
- Every family above one session is split into digit-suffixed ids (DL-212); M15a–M15g are each fitted to one session (DL-242).
- M15a–M15g are post-v1 (Bay expansion). R-ROLL-01: no rooms milestone (M12b onward) starts before M05c2 is shipped and tested on Cloudflare.

## Table (READY 12 · PENDING 103; order = `_PLAN.md` §1)

PENDING files exist and were reconciled by the Architect on 2026-10-18 (`spec/11-decision-log-2.md` DL-218…DL-244; mechanical sweep DL-244); each becomes READY after the critic pass of its block (`_PLAN.md` §3).

| ID | Slug | Sessions | Status | File |
|---|---|---|---|---|
| M00 | bootstrap-ci-pwa-on-workers | 1 | READY | `M00-bootstrap-ci-pwa-on-workers.md` |
| M00a | edge-api-skeleton | 0.8 | READY | `M00a-edge-api-skeleton.md` |
| M00b | ip-provenance-gates | 1 | READY | `M00b-ip-provenance-gates.md` |
| M00c | genai-spike | 1 | READY | `M00c-genai-spike.md` |
| M01a1 | loop-ecs-detmath-physics | 1 | READY | `M01a1-loop-ecs-detmath-physics.md` |
| M01a2 | loop-ecs-detmath-physics | 1 | READY | `M01a2-loop-ecs-detmath-physics.md` |
| M01b1 | controller-cameras-touch | 1 | READY | `M01b1-controller-cameras-touch.md` |
| M01b2 | controller-cameras-touch | 1 | READY | `M01b2-controller-cameras-touch.md` |
| M01c | device-spike-renderer-host | 1 | READY | `M01c-device-spike-renderer-host.md` |
| M01d | assets-publish | 1 | READY | `M01d-assets-publish.md` |
| M01e | asset-worker-opfs-store | 1 | READY | `M01e-asset-worker-opfs-store.md` |
| M01f | world-graybox-fixture-codec | 0.5 | READY | `M01f-world-graybox-fixture-codec.md` |
| M00d | qa-spec-gates | 0.5 | PENDING | `M00d-qa-spec-gates.md` |
| M02a1 | bake-core | 1 | PENDING | `M02a1-bake-core.md` |
| M02a2 | bake-roads-graph | 1 | PENDING | `M02a2-bake-roads-graph.md` |
| M02b1 | streaming-lod | 1 | PENDING | `M02b1-streaming-lod.md` |
| M02b2 | weather-time | 1 | PENDING | `M02b2-weather-time.md` |
| M02c1 | graph-services-teleports | 1 | PENDING | `M02c1-graph-services-teleports.md` |
| M02d1 | landmarks-kit-and-heroes | 1 | PENDING | `M02d1-landmarks-kit-and-heroes.md` |
| M02d2 | landmarks-rest-and-swap | 1 | PENDING | `M02d2-landmarks-rest-and-swap.md` |
| M03a1 | vehicles-interaction-prefabs | 1 | PENDING | `M03a1-vehicles-interaction-prefabs.md` |
| M03a2 | handling-model-wheel-spike | 0.5 | PENDING | `M03a2-handling-model-wheel-spike.md` |
| M03b1 | traffic-robotaxis | 1 | PENDING | `M03b1-traffic-robotaxis.md` |
| M03b2 | peds-transit | 1 | PENDING | `M03b2-peds-transit.md` |
| M03c | pursuit-director | 1 | PENDING | `M03c-pursuit-director.md` |
| M04a1 | saves-gamemode-unlocks | 1 | PENDING | `M04a1-saves-gamemode-unlocks.md` |
| M04a2 | saves-gamemode-unlocks | 1 | PENDING | `M04a2-saves-gamemode-unlocks.md` |
| M04b1 | shell-ui-kit-menus-settings | 1 | PENDING | `M04b1-shell-ui-kit-menus-settings.md` |
| M04b2 | creator-phone-hud-kit | 1 | PENDING | `M04b2-creator-phone-hud-kit.md` |
| M02c2 | maps | 1 | PENDING | `M02c2-maps.md` |
| M04b3 | local-identity-play-token | 0.5 | PENDING | `M04b3-local-identity-play-token.md` |
| M04c | cutscene-playback-spike | 1 | PENDING | `M04c-cutscene-playback-spike.md` |
| M04d | qa-harness-bots-goldens | 1 | PENDING | `M04d-qa-harness-bots-goldens.md` |
| M05a1 | mission-ir-vm | 1 | PENDING | `M05a1-mission-ir-vm.md` |
| M05a2 | autoplayer-director-preview | 1 | PENDING | `M05a2-autoplayer-director-preview.md` |
| M05b1 | cutscene-infra-mock | 1 | PENDING | `M05b1-cutscene-infra-mock.md` |
| M05b2 | cutscene-player-index | 1 | PENDING | `M05b2-cutscene-player-index.md` |
| M05c1 | act1-missions-1-6 | 1 | PENDING | `M05c1-act1-missions-1-6.md` |
| M05c2 | act1-vertical-slice | 1 | PENDING | `M05c2-act1-vertical-slice.md` |
| M05d | data-spine-supabase | 1 | PENDING | `M05d-data-spine-supabase.md` |
| M05c3 | act1-prewarm | 0.7 | PENDING | `M05c3-act1-prewarm.md` |
| M06a1 | npc-backend-spine | 1 | PENDING | `M06a1-npc-backend-spine.md` |
| M06a2 | soul-contract-compiler | 1 | PENDING | `M06a2-soul-contract-compiler.md` |
| M06a3 | dialogue-proxy | 1 | PENDING | `M06a3-dialogue-proxy.md` |
| M06a4 | memory-voice-lipsync | 1 | PENDING | `M06a4-memory-voice-lipsync.md` |
| M06a5 | dialogue-panel-ui | 0.3 | PENDING | `M06a5-dialogue-panel-ui.md` |
| M06c | npc-agency-barks | 1 | PENDING | `M06c-npc-agency-barks.md` |
| M06b1 | builder-text-private | 1 | PENDING | `M06b1-builder-text-private.md` |
| M07a1 | racing-core-director-car | 1 | PENDING | `M07a1-racing-core-director-car.md` |
| M07a2 | racing-ai-replay-ghosts | 1 | PENDING | `M07a2-racing-ai-replay-ghosts.md` |
| M07b1 | racing-content-events-ladder | 1 | PENDING | `M07b1-racing-content-events-ladder.md` |
| M07b2 | racing-garage-replay-photo-visuals | 1 | PENDING | `M07b2-racing-garage-replay-photo-visuals.md` |
| M08a1 | fight-core-sim-data | 1 | PENDING | `M08a1-fight-core-sim-data.md` |
| M08a2 | fight-mode-training-vs | 1 | PENDING | `M08a2-fight-mode-training-vs.md` |
| M08b1 | fight-roster-kits-ai | 1 | PENDING | `M08b1-fight-roster-kits-ai.md` |
| M08b2 | fight-stages-cutscenes-arcade | 1 | PENDING | `M08b2-fight-stages-cutscenes-arcade.md` |
| M08c1 | pose-pipeline-classifier | 1 | PENDING | `M08c1-pose-pipeline-classifier.md` |
| M08c2 | pose-calibration-gate | 1 | PENDING | `M08c2-pose-calibration-gate.md` |
| M09a1 | tycoon-core-finance | 1 | PENDING | `M09a1-tycoon-core-finance.md` |
| M09a2 | tycoon-events-balance | 1 | PENDING | `M09a2-tycoon-events-balance.md` |
| M09b1 | tycoon-ui | 1 | PENDING | `M09b1-tycoon-ui.md` |
| M09b2 | tycoon-vc-story | 1 | PENDING | `M09b2-tycoon-vc-story.md` |
| M10a1 | roster-pipeline | 1 | PENDING | `M10a1-roster-pipeline.md` |
| M10a2 | roster-pipeline | 1 | PENDING | `M10a2-roster-pipeline.md` |
| M10b | qa-gates-kill-drill | 1 | PENDING | `M10b-qa-gates-kill-drill.md` |
| M10c | roster-souls-ink-barks | 1 | PENDING | `M10c-roster-souls-ink-barks.md` |
| M05e1 | story-act2-part1 | 1 | PENDING | `M05e1-story-act2-part1.md` |
| M05e2 | story-act2-part2 | 1 | PENDING | `M05e2-story-act2-part2.md` |
| M05f1 | story-act3-part1 | 1 | PENDING | `M05f1-story-act3-part1.md` |
| M05f2 | story-act3-finale | 1 | PENDING | `M05f2-story-act3-finale.md` |
| M11a1 | iphone-hardening-governor | 1 | PENDING | `M11a1-iphone-hardening-governor.md` |
| M11a2 | iphone-hardening-governor | 1 | PENDING | `M11a2-iphone-hardening-governor.md` |
| M11b1 | webxr-port | 1 | PENDING | `M11b1-webxr-port.md` |
| M11b3 | xr-ui-panels-comfort | 0.8 | PENDING | `M11b3-xr-ui-panels-comfort.md` |
| M11b2 | per-mode-xr-and-xr-cutscenes | 0.7 | PENDING | `M11b2-per-mode-xr-and-xr-cutscenes.md` |
| M11b4 | per-mode-xr-and-xr-cutscenes | 0.7 | PENDING | `M11b4-per-mode-xr-and-xr-cutscenes.md` |
| M12a1 | p1-identity-cloud-saves | 1 | PENDING | `M12a1-p1-identity-cloud-saves.md` |
| M12a2 | age-register-cloud-save-ui | 0.5 | PENDING | `M12a2-age-register-cloud-save-ui.md` |
| M06b2 | builder-images-review | 1 | PENDING | `M06b2-builder-images-review.md` |
| M06b3 | npc-builder-ui | 1 | PENDING | `M06b3-npc-builder-ui.md` |
| M12b1 | rooms-core-protocol-v2 | 1 | PENDING | `M12b1-rooms-core-protocol-v2.md` |
| M12b2 | rooms-core-protocol-v2 | 1 | PENDING | `M12b2-rooms-core-protocol-v2.md` |
| M12c1 | rooms-hardening-presence-loadtest | 1 | PENDING | `M12c1-rooms-hardening-presence-loadtest.md` |
| M12c2 | rooms-hardening-presence-loadtest | 1 | PENDING | `M12c2-rooms-hardening-presence-loadtest.md` |
| M12d | online-page-invites | 0.3 | PENDING | `M12d-online-page-invites.md` |
| M12e | mode-leaderboards | 1 | PENDING | `M12e-mode-leaderboards.md` |
| M13a1 | mod-sdk-manifest-validators | 1 | PENDING | `M13a1-mod-sdk-manifest-validators.md` |
| M13a2 | mod-installer-store-client | 1 | PENDING | `M13a2-mod-installer-store-client.md` |
| M13a3 | mod-runtime-data-experience | 1 | PENDING | `M13a3-mod-runtime-data-experience.md` |
| M13a4 | mod-script-sandbox | 1 | PENDING | `M13a4-mod-script-sandbox.md` |
| M13a5 | mod-ui-tier | 1 | PENDING | `M13a5-mod-ui-tier.md` |
| M13a6 | mod-agent-kit | 1 | PENDING | `M13a6-mod-agent-kit.md` |
| M13a7 | store-experience-pages | 0.7 | PENDING | `M13a7-store-experience-pages.md` |
| M13b1 | forum-reports-backend | 1 | PENDING | `M13b1-forum-reports-backend.md` |
| M13b2 | forum-ugc-links | 0.8 | PENDING | `M13b2-forum-ugc-links.md` |
| M13b3 | creator-place-mode | 1 | PENDING | `M13b3-creator-place-mode.md` |
| M13b4 | forum-ui | 1 | PENDING | `M13b4-forum-ui.md` |
| M13c1 | device-code-publish-login | 0.8 | PENDING | `M13c1-device-code-publish-login.md` |
| M13c2 | publish-pipeline-server | 1 | PENDING | `M13c2-publish-pipeline-server.md` |
| M13c3 | publish-cli-link | 1 | PENDING | `M13c3-publish-cli-link.md` |
| M06b4 | builder-publish-assets | 0.5 | PENDING | `M06b4-builder-publish-assets.md` |
| M13d1 | legal-trust-safety-backend | 1 | PENDING | `M13d1-legal-trust-safety-backend.md` |
| M13d2 | legal-forms-ui | 0.3 | PENDING | `M13d2-legal-forms-ui.md` |
| M14c | a11y-audit-i18n-gate | 0.5 | PENDING | `M14c-a11y-audit-i18n-gate.md` |
| M14b1 | launch-hardening-guardrails | 1 | PENDING | `M14b1-launch-hardening-guardrails.md` |
| M14b2 | launch-hardening-guardrails | 1 | PENDING | `M14b2-launch-hardening-guardrails.md` |
| M14b3 | launch-hardening-guardrails | 1 | PENDING | `M14b3-launch-hardening-guardrails.md` |
| M14a | thirdweb-siwe-link | 1 | PENDING | `M14a-thirdweb-siwe-link.md` |
| M15a | bay-expansion-framework | 1 | PENDING | `M15a-bay-expansion-framework.md` |
| M15b | oakland-core | 1 | PENDING | `M15b-oakland-core.md` |
| M15c | berkeley-richmond | 1 | PENDING | `M15c-berkeley-richmond.md` |
| M15d | marin-gateway | 1 | PENDING | `M15d-marin-gateway.md` |
| M15e | peninsula-north | 1 | PENDING | `M15e-peninsula-north.md` |
| M15f | peninsula-vc-row | 1 | PENDING | `M15f-peninsula-vc-row.md` |
| M15g | south-bay-san-jose | 1 | PENDING | `M15g-south-bay-san-jose.md` |
