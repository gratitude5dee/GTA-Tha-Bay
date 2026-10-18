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
- Rows marked "split" exceed one session and get digit suffixes (C15) before they become READY.
- M15a–M15g are post-v1 (Bay expansion). R-ROLL-01: no rooms milestone (M12b onward) starts before M05c2 is shipped and tested on Cloudflare.

## Table (READY 12 · PENDING 93)
| ID | Slug | Sessions | Status | File |
|---|---|---|---|---|
| M00 | bootstrap-ci-pwa-on-workers | 1 | READY | `M00-bootstrap-ci-pwa-on-workers.md` |
| M00a | edge-api-skeleton | 0.8 | READY | `M00a-edge-api-skeleton.md` |
| M00b | ip-provenance-gates | 1 | READY | `M00b-ip-provenance-gates.md` |
| M00c | genai-spike | 1 | READY | `M00c-genai-spike.md` |
| M01a1 | loop-ecs-detmath-physics (session 1) | 1 | READY | `M01a1-loop-ecs-detmath-physics.md` |
| M01a2 | loop-ecs-detmath-physics (session 2) | 1 | READY | `M01a2-loop-ecs-detmath-physics.md` |
| M01b1 | controller-cameras-touch (session 1) | 1 | READY | `M01b1-controller-cameras-touch.md` |
| M01b2 | controller-cameras-touch (session 2) | 1 | READY | `M01b2-controller-cameras-touch.md` |
| M01c | device-spike-renderer-host | 1 | READY | `M01c-device-spike-renderer-host.md` |
| M01d | assets-publish | 1 | READY | `M01d-assets-publish.md` |
| M01e | asset-worker-opfs-store | 1 | READY | `M01e-asset-worker-opfs-store.md` |
| M01f | world-graybox-fixture-codec | 0.5 | READY | `M01f-world-graybox-fixture-codec.md` |
| M02a1 | bake-core | 1 | PENDING | — |
| M02a2 | bake-roads-graph | 1 | PENDING | — |
| M02b1 | streaming-lod | 1 | PENDING | — |
| M02b2 | weather-time | 1 | PENDING | — |
| M02c1 | graph-services-teleports | 1 | PENDING | — |
| M02c2 | maps | 1 | PENDING | — |
| M02d1 | landmarks-kit-and-heroes | 1 | PENDING | — |
| M02d2 | landmarks-rest-and-swap | 1 | PENDING | — |
| M03a1 | vehicles-interaction-prefabs | 1 | PENDING | — |
| M03a2 | handling-model-wheel-spike | 0.5 | PENDING | — |
| M03b1 | traffic-robotaxis | 1 | PENDING | — |
| M03b2 | peds-transit | 1 | PENDING | — |
| M03c | pursuit-director | 1 | PENDING | — |
| M04a | saves-gamemode-unlocks | 1–2 | PENDING (split into digit sessions before READY) | — |
| M04b1 | shell-ui-kit-menus-settings | 1 | PENDING | — |
| M04b2 | creator-phone-hud-kit | 1 | PENDING | — |
| M04b3 | local-identity-play-token | 0.5 | PENDING | — |
| M04c | cutscene-playback-spike | 1 | PENDING | — |
| M05a1 | mission-ir-vm | 1 | PENDING | — |
| M05a2 | autoplayer-director-preview | 1 | PENDING | — |
| M05b1 | cutscene-infra-mock | 1 | PENDING | — |
| M05b2 | cutscene-player-index | 1 | PENDING | — |
| M05c1 | act1-missions-1-6 | 1 | PENDING | — |
| M05c2 | act1-vertical-slice | 1 | PENDING | — |
| M05c3 | act1-prewarm | 0.5 | PENDING | — |
| M05d | data-spine-supabase | 1 | PENDING | — |
| M05e1 | story-act2-part1 | 1 | PENDING | — |
| M05e2 | story-act2-part2 | 1 | PENDING | — |
| M05f1 | story-act3-part1 | 1 | PENDING | — |
| M05f2 | story-act3-finale | 1 | PENDING | — |
| M06a1 | npc-backend-spine | 1 | PENDING | — |
| M06a2 | soul-contract-compiler | 1 | PENDING | — |
| M06a3 | dialogue-proxy | 1 | PENDING | — |
| M06a4 | memory-voice-lipsync | 1 | PENDING | — |
| M06a5 | dialogue-panel-ui | 0.3 | PENDING | — |
| M06b1 | builder-text-private | 1 | PENDING | — |
| M06b2 | builder-images-review | 1 | PENDING | — |
| M06b3 | npc-builder-ui | 1 | PENDING | — |
| M06b4 | builder-publish-assets | 0.5 | PENDING | — |
| M06c | npc-agency-barks | 1 | PENDING | — |
| M07a1 | racing-core-director-car | 1 | PENDING | — |
| M07a2 | racing-ai-replay-ghosts | 1 | PENDING | — |
| M07b1 | racing-content-events-ladder | 1 | PENDING | — |
| M07b2 | racing-garage-replay-photo-visuals | 1 | PENDING | — |
| M08a1 | fight-core-sim-data | 1 | PENDING | — |
| M08a2 | fight-mode-training-vs | 1 | PENDING | — |
| M08b1 | fight-roster-kits-ai | 1 | PENDING | — |
| M08b2 | fight-stages-cutscenes-arcade | 1 | PENDING | — |
| M08c1 | pose-pipeline-classifier | 1 | PENDING | — |
| M08c2 | pose-calibration-gate | 1 | PENDING | — |
| M09a1 | tycoon-core-finance | 1 | PENDING | — |
| M09a2 | tycoon-events-balance | 1 | PENDING | — |
| M09b1 | tycoon-ui | 1 | PENDING | — |
| M09b2 | tycoon-vc-story | 1 | PENDING | — |
| M10a | roster-pipeline | 2 | PENDING (split into digit sessions before READY) | — |
| M10b | qa-gates-kill-drill | 1 | PENDING | — |
| M10c | roster-souls-ink-barks | 1 | PENDING | — |
| M11a | iphone-hardening-governor | 2 | PENDING (split into digit sessions before READY) | — |
| M11b1 | webxr-port | 1 | PENDING | — |
| M11b2 | per-mode-xr-and-xr-cutscenes | ≈1.3 | PENDING (split into digit sessions before READY) | — |
| M11b3 | xr-ui-panels-comfort | 0.8 | PENDING | — |
| M12a1 | p1-identity-cloud-saves | 1 | PENDING | — |
| M12a2 | age-register-cloud-save-ui | 0.5 | PENDING | — |
| M12b | rooms-core-protocol-v2 | 2 | PENDING (split into digit sessions before READY) | — |
| M12c | rooms-hardening-presence-loadtest | 2 | PENDING (split into digit sessions before READY) | — |
| M12d | online-page-invites | 0.3 | PENDING | — |
| M12e | mode-leaderboards | 1 | PENDING | — |
| M13a1 | mod-sdk-manifest-validators | 1 | PENDING | — |
| M13a2 | mod-installer-store-client | 1 | PENDING | — |
| M13a3 | mod-runtime-data-experience | 1 | PENDING | — |
| M13a4 | mod-script-sandbox | 1 | PENDING | — |
| M13a5 | mod-ui-tier | 1 | PENDING | — |
| M13a6 | mod-agent-kit | 1 | PENDING | — |
| M13a7 | store-experience-pages + vehicle-mod envelope | 0.7 | PENDING | — |
| M13b1 | forum-reports-backend | 1 | PENDING | — |
| M13b2 | forum-ugc-links + web tiles, anchor mask | 0.8 | PENDING | — |
| M13b3 | creator-place-mode | 1 | PENDING | — |
| M13b4 | forum-ui | 1 | PENDING | — |
| M13c1 | device-code-publish-login | 0.8 | PENDING | — |
| M13c2 | publish-pipeline-server | 1 | PENDING | — |
| M13c3 | publish-cli-link | 1 | PENDING | — |
| M13d1 | legal-trust-safety-backend | 1 | PENDING | — |
| M13d2 | legal-forms-ui | 0.3 | PENDING | — |
| M14a | thirdweb-siwe-link | 1 | PENDING | — |
| M14b | launch-hardening-guardrails | 2 | PENDING (split into digit sessions before READY) | — |
| M14c | a11y-audit-i18n-gate | 0.5 | PENDING | — |
| M15a | bay-expansion-framework | 2 | PENDING (split into digit sessions before READY) | — |
| M15b | oakland-core | 2 | PENDING (split into digit sessions before READY) | — |
| M15c | berkeley-richmond | 1.5 | PENDING (split into digit sessions before READY) | — |
| M15d | marin-gateway | 1 | PENDING | — |
| M15e | peninsula-north | 1.5 | PENDING (split into digit sessions before READY) | — |
| M15f | peninsula-vc-row | 2 | PENDING (split into digit sessions before READY) | — |
| M15g | south-bay-san-jose | 2 | PENDING (split into digit sessions before READY) | — |
