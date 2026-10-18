# ADR-GENAI-01 — Video model licence gate

**Status:** proposed (owner-gated; no provider is `cleared`) · **Date:** 2026-10-18 · **Decides:** spec/03 A-08; R-CUT-01 as amended; owner questions Q-03, Q-18

## Context
R-CUT-01 names MiniMax H3 Max Turbo on fal.ai for cutscenes. fal's H3 Max and Turbo endpoints are post-trains of the open-weight H3 model, whose licence excludes the USA, the EU, the UK and South Korea and covers derivatives and hosted services [F-041]. No public fal or MiniMax text clears US commercial use of fal-hosted H3 outputs; the MiniMax API terms have no territory exclusion, and whether fal's partner endpoint `minimax/h3/*` carries them is UNVERIFIED [research/gap-video-model-licence-clearance.md §0, §2–3]. fal's terms require End Users of a customer solution to be 18+ and bar exposing its APIs to end users [F-042]. Gemini's terms bar services likely used by under-18s [F-049]. LTX-2.x has no territory exclusion and charges only at ≥ $10 M revenue [F-050]. Vendor terms and endpoints change often.

## Options considered
1. **Use H3 Max Turbo now.** Blocked by the territory clause [F-041]; $0.04/s list price does not matter [F-039].
2. **Wait for written clearance before building anything.** Stalls M05b for a vendor answer.
3. **Provider-swappable pipeline with a licence gate; ship in-engine cutscenes until a provider clears** (chosen). The in-engine director fallback is mandatory anyway (R-CUT-03).

## Decision
- All video generation goes through one provider registry: `videoProviders` in `config/genai-endpoints.json`, typed in `packages/shared/src/genai/` and executed by `services/pipeline` (A-01; DL-009). Providers are config entries, not code branches. Each carries `licence.status: cleared | pending | blocked`, `usCommercialOutputs`, `under18Audience`, `endUserMode: internal-pipeline-only | customer-solution`, duties (credit text, per-clip AI label, keep-C2PA) and evidence (URL, SHA-256 of the stored terms snapshot, written confirmation path).
- `assertCallable(entry, env)` refuses a non-`cleared` entry in `production` and any `blocked` entry; a non-production `previs` key may call `pending` entries, outputs go to R2 `previs/`, and CI fails any release catalog that references `previs/`.
- **Order.** Default `h3.partner` (`minimax/h3/{image,reference}-to-video`, $0.06/s [F-040]); `h3.maxTurbo` and `h3.max` stay `blocked` until a written MiniMax authorization covering fal customers exists; fallback 1 `ltx25.fast` (`lightricks/ltx-2.5/image-to-video/fast`); fallback 2 `gemini.omniFlash11` only after counsel confirms that Google's under-18 clause does not reach an 18+ game whose generation is internal-only (ADR-0014).
- **Internal only.** Generation is an admin workflow or CLI with a staff key (Q-17); the public game has no path to fal and a cache miss plays the in-engine director (never auto-enqueues). Player-triggered video generation is out of v1.
- **Provenance.** The provider's signed original is kept private as `cutscenes-orig/<key>/orig.mp4` (DL-179); each rendition is re-signed with our C2PA claim before release (transcoding strips fal's manifest [F-043]); playback shows an "AI-generated" badge; credits list the model, and any H3-family provider shows the literal "MiniMax H3".
- **Gates G1–G5 (all required before a live production call):** G1 `status: cleared` backed by written confirmation stored under `docs/legal/`; G2 counsel sign-off on the fal End-User reading (Q-18), H3 attribution and MiniMax content rules; G3 hashed terms snapshots with a green `genai:terms-watch`; G4 attribution UI and C2PA re-signing implemented and tested; G5 budget caps and the admin-only prewarm path (ADR-0015).

## Status log
| Provider key | Status 2026-10-18 | Blocking question |
|---|---|---|
| `h3.partner` | pending | pass-through of MiniMax API terms via fal (Q-F4, Q-M1) |
| `h3.maxTurbo`, `h3.max` | blocked | MiniMax authorization for fal customers (Q-F1, Q-F2, Q-M2) |
| `ltx25.fast` | pending | LTX API terms behind fal (Q-F6) |
| `gemini.omniFlash11` | pending | counsel on the under-18 clause |

## Consequences
- (+) A clearance, revocation or price change is a registry edit plus new cache keys; shipped clips stay valid under their recorded licence (ADR-0003).
- (+) Development never waits on a vendor.
- (−) Until a provider clears, M05c2 can ship only the in-engine fallback path ("fallback-only release"); the M05c3 prewarm waits.
- (−) The $40 cutscene line (ADR-0015) covers a few dozen clips, so most hooks stay in-engine in v1.
- (−) If no H3 path clears, R-CUT-01 is amended to "a licence-cleared video model via fal (MiniMax preferred)".

## Affected contracts and milestones
C09 (manifest `licence` block, `uiCredit`), C07 (`licence_gate`, `GenJob`), C12 (route 27 `blocked`). M00b (registry, no entry `cleared`), M00c (probes, informs only), M05b1–M05b2, M05c2–M05c3, M08b2, M10b, M14b (terms-watch, counsel).

## Owner actions
Send the written questions in `research/gap-video-model-licence-clearance.md` §9 (Q-30); record answers and evidence; flip a provider to `cleared` by a reviewed pull request that cites this ADR.

## Links
`research/gap-video-model-licence-clearance.md` §0–§8; `spec/domains/05-assets.md` §4.5, `03-story-cutscenes.md`; `spec/11-decision-log-2.md` DL-179, DL-202; `spec/99-open-questions.md` Q-03, Q-17, Q-18, Q-30; ADR-0003, ADR-0014, ADR-0015, ADR-0022.
