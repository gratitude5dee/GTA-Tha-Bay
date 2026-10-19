# M10a2 — roster-pipeline

## Goal
After this session the v1 character roster that fits DL-OWN-01 is generated, retargeted, published and locked, within the $42 character line. The default roster is:
- up to 8 Standard models, one per v1 fighter slot;
- up to 12 Lean models for the Act 1 cast (Q-27);
- creator-kit bodies for everyone else, and authored creator-kit stand-ins (DL-180).

Every published character resolves on all six quality tiers through `VARIANT_FALLBACK`. Each roster fighter has `anim/<slug>.base` from the Meshy library clips and `anim/<slug>.moves`, retargeted from the authored mannequin clips. Where a signature clip is not yet authored, the move falls back to the M08 library set (Q-24). `check:fighter` sees every slot resolve.

Slots whose souls are real-derived stay `blocked:research` until Q-19 and Q-25 are answered. Their Standard estimate stays reserved in the line, so the batch can be finished later with the same commands.

## Requirements
- R-NPC-02: the full chain from sheet to glTF in R2, with provenance and gates, for the v1 roster.
- R-NPC-01: generated bodies for the roster and Act 1 cast that the soul layer refers to.
- R-MODE-03: roster fighters get models and retargeted move clips bound by move id to the frame-locked player.

## Depends on
- **M10a1**: `assets:gen plan/run/gate/ledger`, optimize, retarget, verify, publish, the ledger, the canary.
- **M08b1**: the eight kits, `content/fighter/roster.json`, `check:fighter`, the tier and fame-domain gates.
- Contracts: C07 1.1 (`VARIANT_FALLBACK`, provenance, lock file, `likeness` block, `assetTier`), C04 1.1 (`bay_rig_v1`, `HUMANOID_BONES`, fighter `AnimStateId` 160–207 consumed via clips).

## Scope in
- **Plan the batch** with `--tier all`.
  - Eligible: every `active` roster entry with `pipeline: standard` or `lean`, `research ≠ pending`, compiled soul present and every gate verdict `ok`.
  - Reserved: fighter slots whose subject is real-derived, listed as `blocked:research`.
  - The plan must keep the total of the ledger, the eligible estimate and the reserved estimate at or below 42,000,000 micros.
- **Run stages 2–5** for the eligible slugs, two jobs at a time (fal default concurrency).
  - The run stops at the H1, H3 and H4 human gates.
  - Unattended runs never cross a human gate.
  - A rejected candidate stays in `.genai/work/` and is re-run with a new seed only from the $8 buffer with owner sign-off (Q-26).
- **Optimize, verify and publish per slug.**
  - Each slug gets three fidelities within `config/asset-budgets.json` (Hero/fighter rows for Standard, Named-NPC rows for Lean), plus `portrait/<slug>` and `mouth_atlas` (Standard only; Lean is jaw-only per §1).
  - The provenance chain has the `likeness` block.
  - Lock PRs are merged after H5.
- **Signature clips (S07 FX7).**
  - Retarget the authored mannequin clip GLBs in `assets/src/anim/mannequin/*.glb` with `assets:retarget --rig bay_rig_v1 --clips <glb> --to <slug>` for each published fighter, at 60 fps when the kit asks.
  - Output `anim/<slug>.moves`, clip name = move id.
  - Moves without an authored clip map to the library set in `content/fighter/clip-fallbacks.json` and are listed in the report.
  - Never retarget at runtime.
- **Bind the roster.**
  - Update `content/fighter/roster.json` `assets` (`model`, `animBase`, `animMoves`, `portrait`) for published fighters, and the `standIn.assets` for every slot (authored creator-kit bodies).
  - Update `assets.*` refs in the Act 1 cast souls (C10 compiled `assets` fields) and bump `soulVersion` only where the public JSON changes (lint L14).
- **Catalog.** Rebuild the immutable catalog and pointer through the M01d flow, so the Worker's static `asset-catalog.json` pointer changes in a versioned deploy.
- **Idempotence check.** A second `plan` lists zero outstanding jobs for the eligible set, and `run` makes zero calls (runbook step 7).
- **Close-out.** Reconcile the ledger against the fal dashboard, record cost per slug from the ledger, snapshot the registry in the PR.

## Scope out
- The real-derived fighter models: they wait for Q-19 and Q-25, with the same commands and their reservation in the line.
- The gate-hardening drill, the kill purge and the fighter cutscene prewarm: M10b.
- Normalising real souls, ink and barks: M10c.
- Generated voices: none (DL-OWN-01). Voices stay Workers AI t1.
- Twelve-fighter roster and Premium tier: post-v1.

## Deliverables
- `content/npcs/roster.json` (`rosterVersion` bump, pipeline fields confirmed), `content/fighter/roster.json` (asset refs), `content/fighter/clip-fallbacks.json` (move id → library clip), and the Act 1 cast `content/npcs/<id>/soul.md` asset refs.
- `assets/src/character/<slug>/asset.json`, `assets/src/anim/<slug>.{base,moves}/asset.json`, `assets/src/portrait/<slug>/asset.json`: one set per published slug, written by `assets:publish`.
- `assets/assets.lock.json`, `assets/provenance/**` (records written by the tools), `apps/web/public/asset-catalog.json` and `services/edge/src/generated/asset-catalog.json` (pointer).
- `tools/assets/src/report.ts`: the batch report (slugs, stages, gate decisions, cost per slug, fallback moves) written to `docs/runbooks/reports/M10a2-batch.md`.
- `tools/ci/check-fighter.ts` (M08b1): extend so every slot's four refs (and the stand-in's) must resolve for all six tiers through `resolveVariant`.
- `packages/modes/fighter/test/roster.assets.spec.ts`.
- Hand-written files: about 14. Tool-generated asset records grow with the roster and are not counted toward the 40-file guideline.

## Interfaces
- C07 1.1: asset records, lock file, `VARIANT_FALLBACK`. Cross-domain refs stay `'<kind>/<id>'`.
- C04 1.1: clip names bind to move ids. `AnimStateId` stays the u8 state (fighter block 160–207); the move playing is `FighterView.move`.
- C10 1.0: `assets.*` refs in compiled souls are `AssetRef` strings.
- No contract shape changes.

## Acceptance criteria
- AC-1 Given the batch is published When the plan runs again over the whole roster Then it lists zero outstanding jobs for every eligible slug, lists real-derived fighter slots as `blocked:research` with their reserved estimate, and makes zero `FalPort` calls — proof: `pnpm assets:gen -- plan --roster content/npcs/roster.json --tier all`
- AC-2 Given the updated roster manifest When the NPC build validates it Then rules R1–R7 pass: at most 8 `standard`, at most 12 `lean`, no `premium`, every real-derived entry has an active original stand-in — proof: `pnpm npc:build`
- AC-3 Given the new asset records When the asset and IP gates run Then every character has `hi`, `mid` and `lo` within its budget row, every file has a provenance record chaining to a generated root with the `likeness` block, and the likeness gate passes — proof: `pnpm check:assets && pnpm provenance:check && pnpm likeness:gate`
- AC-4 Given `content/fighter/roster.json` When the fighter content gate runs Then every v1 slot and its stand-in resolve `model`, `animBase`, `animMoves` and `portrait` on each of the six tiers, and every kit move id has a clip in `anim/<slug>.moves` or an entry in `clip-fallbacks.json` — proof: `pnpm check:fighter`
- AC-5 Given each retargeted `anim/<slug>.moves` When the roster asset test inspects it Then clip names equal the kit's move ids, the frame count in `extras` equals the kit's total frames for each move at the declared fps, and the A5 drift result recorded at retarget is a pass — proof: `pnpm check:unit -- packages/modes/fighter/test/roster.assets.spec.ts`
- AC-6 Given the lock file and the published objects When asset verification runs Then every locked variant hashes to its key and every published key answers HEAD with `Content-Type` and `Cache-Control: public, max-age=31536000, immutable` — proof: `pnpm assets:verify`
- AC-7 Given a QA build on the new catalog When a Versus bout between two published fighters runs at the `desktop` tier and again with `?tier=mobile-low` Then the fighters render their `hi` and `lo` variants respectively, clips stay frame-locked, and the `@fighter-hash` golden is unchanged — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @fighter-hash`
- AC-8 Given the operator's ledger When the batch closes Then `assets:gen ledger --line characters` shows a total at or below 42,000,000 micros (M10a1 canary included), cost per slug is in `docs/runbooks/reports/M10a2-batch.md`, and the fal dashboard reconcile is noted — proof: manual: operator workstation, run `pnpm assets:gen -- ledger --line characters` and attach the output and the reconcile note to the PR
- AC-9 Given the new catalog pointer When the Preview deploys Then it boots, `/asset-catalog.json` is the new immutable catalog, and the `preview.yml` smoke step passes — proof: `pnpm build && pnpm deploy:preview`

## Test plan
- **Static gates:** `check:assets`, `provenance:check`, `likeness:gate`, `npc:build`, `check:fighter`, `assets:verify`.
- **Unit:** `roster.assets.spec.ts` (clip names, frame counts).
- **E2E:** `@fighter-hash` and `@fighter` on `chromium-webgl2` (presentation-only change, so the hashes stay equal).
- **Deployed:** Preview; `preview.yml` runs `check:headers`, `check:coi` and `check:smoke` on its URL.
- **Operator:** the live batch, human gates, ledger and reconcile.

## Demo script
1. `pnpm assets:gen -- plan --roster content/npcs/roster.json --tier all`: the eligible, done and blocked lists print.
2. Operator: run the stages for the next two slugs, decide H1, H3 and H4, then optimize, verify and publish.
3. `pnpm check:fighter`: every slot resolves.
4. `VITE_DV_QA=1 pnpm dev`, open Versus and see the generated fighters; add `?tier=mobile-low` to see the `lo` variants.
5. `pnpm assets:gen -- ledger --line characters`: the total is at or below $42.

## Effort
1 Builder session plus operator time for the human gates; about 14 hand-written files; risk **high**. Vendor failures and human-gate latency set the pace. Batches of two at a time need several hours of wall-clock time.

## Risks & fallbacks
- **Mesh or rig failures** use up the buffer. Fall back to Lean (Tripo) for the slug only with the owner's word (Q-26). Otherwise keep the gray-box or creator-kit body and list the slug as `pending` in the report; a slug left on `character/graybox.<slug>` gets M10d3's creator-kit body (DL-460).
- **No art-lead clips** (Q-24, U-FGT-7): every fighter uses the library fallbacks. Frame data is unchanged, so the game remains correct.
- **Q-19 and Q-25 stay open**: only originals are generated. The reserved line amount stays unspent and the milestone is complete for the eligible set.
- **Ledger drift** against the dashboard (per-request billing retrieval is UNVERIFIED): record the difference, never raise the cap (Q-14 closed).

## Notes for the Builder
- Read first: `05-assets-pipeline.md` §3, §4, §11, §12; `07-fighter-content.md` FX1, FX7; `04-npc-contracts.md` §B5; the M10a1 runbook `docs/runbooks/roster-batch.md`.
- **Secrets and gates.**
  - `FAL_KEY`: operator only (Q-17).
  - `ANTHROPIC_API_KEY`: vision QA.
  - `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`: publish.
  - `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`: the Preview, CI only.
  - Owner gates: Q-19, Q-24, Q-25, Q-26 and Q-27, as above.
  - Without `FAL_KEY` the Builder still completes everything CI-provable: roster data, clip fallbacks, the `check:fighter` extension, tests. The operator's batch then lands as a follow-up commit on the same branch.
- **Stand-ins (DL-180)** are authored creator-kit bodies with a palette variant, `origin: authored`, tier `original`. They are never fal output.
- **Spend.** Every paid command prints its estimate and needs `--live`; CI stays `FAL_MODE=mock` (DL-OWN-01).
