# Architecture decision records

One file per decision, in the `03-SPEC-TEMPLATE.md` §E format (≤ 800 words). `spec/03-decisions-and-facts.md` links every D-xx and A-xx here; `spec/11-decision-log.md` and `spec/11-decision-log-2.md` hold the dated change history (DL-nnn). A superseding ADR sets the old one to `superseded` and links back.

| ADR | Title | Status | Decides |
|---|---|---|---|
| [0001](ADR-0001-package-layout.md) | Package layout | accepted | A-01 |
| [0002](ADR-0002-mission-scripting-dsl.md) | Mission scripting DSL | accepted | A-02 |
| [0003](ADR-0003-cutscene-cache-key.md) | Cutscene cache key | accepted | A-03 |
| [0004](ADR-0004-netcode-model.md) | Netcode model | accepted | A-04, D-06 |
| [0005](ADR-0005-building-representation.md) | Building representation per tier | accepted | A-05, D-15 |
| [0006](ADR-0006-v1-vertical-slice.md) | v1 vertical slice and milestone order | accepted | A-06, A-09 |
| [0007](ADR-0007-display-name.md) | Display name | accepted | A-07 |
| [GENAI-01](ADR-GENAI-01-video-model-licence-gate.md) | Video model licence gate | **proposed, owner-gated** | A-08, D-18 (video) |
| [0008](ADR-0008-supabase-over-convex.md) | Supabase over Convex | accepted | D-02, G1 |
| [0009](ADR-0009-identity-spine.md) | Identity spine and auth phases | accepted | D-03, D-04 |
| [0010](ADR-0010-renderer-strategy.md) | Renderer strategy | accepted | D-07, D-09, D-10, D-11 |
| [0011](ADR-0011-physics-and-determinism.md) | Physics and determinism | accepted | D-12, D-13 |
| [0012](ADR-0012-modding-tiers-and-sandboxes.md) | Modding tiers and sandboxes | accepted | D-26 |
| [0013](ADR-0013-likeness-tiers-and-kill-switch.md) | Likeness tiers and kill-switch | accepted | D-29, G2 |
| [0014](ADR-0014-audience-and-content.md) | Audience and content | accepted | D-30 |
| [0015](ADR-0015-cost-controls.md) | Cost controls | accepted | D-28, G3, DL-OWN-01 |
| [0016](ADR-0016-animstateid-blocks.md) | `AnimStateId` blocks 128–255 | accepted | DL-091 |
| [0017](ADR-0017-worker-topology.md) | Worker topology | accepted | D-08, DL-152 |
| [0018](ADR-0018-publish-identity-before-m14a.md) | Publish identity before M14a | accepted | DL-145 |
| [0019](ADR-0019-modding-agent-and-publish-login.md) | Modding agent flow and publish login | accepted | D-05, DL-148 |
| [0020](ADR-0020-hosting-and-web-delivery.md) | Hosting, PWA shell and asset delivery | accepted | D-01, D-16, D-17 |
| [0021](ADR-0021-world-data-and-map-stack.md) | World data sources and map stack | accepted | D-14, D-25 |
| [0022](ADR-0022-genai-pipeline-and-cutscene-delivery.md) | GenAI pipeline and cutscene delivery | accepted | D-18, D-19, D-20 |
| [0023](ADR-0023-npc-runtime.md) | NPC runtime | accepted | D-21, D-22, D-23 |
| [0024](ADR-0024-pose-input.md) | Pose input | accepted | D-24 |
| [0025](ADR-0025-ci-cd-and-release.md) | CI/CD and release | accepted | D-27 |
| [0026](ADR-0026-us-only-region.md) | US-only region and geo-gate | accepted | A-10 |
| [0027](ADR-0027-xr-scope-beyond-v1.md) | XR scope beyond v1 | proposed, deferred | DL-029 |
| [0028](ADR-0028-fight-room-transport.md) | Fight-room transport and rollback | proposed, deferred | DL-104 |
| [0029](ADR-0029-authoritative-server-physics.md) | Authoritative server physics | proposed, deferred | A-04 gate |
| [0030](ADR-0030-ui-mod-l1-host.md) | UI-mod L1 network-origin host | proposed, conditional | DL-104, DL-146 |

Rules: a status change or amendment edits the ADR and adds a DL entry; a contract-shape change still goes through the Architect (`prompt-pack/06-SHARED-CONTEXT.md` §4.1).
