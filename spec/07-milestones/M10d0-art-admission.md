# M10d0 — art-admission

## Goal
After this session third-party art enters lawfully and the first licensed art is on screen (DL-OWN-07 Phase 2). Four packs have dated snapshots, `spec/03` facts and U-AST-10 closed; `provenance:check` refuses unsnapshotted or unvetted licensed files; Credits gets a CC-BY-ready Art section; the DL-OWN-06 checklist is written and partly automated. Six CC0 PBR sets ship as KTX2 with mobile variants, tiled onto the M02e and Phase 1 surfaces within texture memory and with 0 added render objects. The fal split is in config.

## Requirements
- R-IP-01: every third-party file has a snapshot, provenance, a vetting review and credits.
- R-UI-03: Credits shows art attributions, licence links and change notes.
- R-MAP-01: asphalt, sidewalks, lots, yards and walls read as real materials.
- R-PLAT-03: TSL and KTX2 on one `WebGPURenderer` (WebGPU and WebGL2).
- R-PLAT-05 (s): `mobile-low` keeps its texture, memory and object budgets.
- R-ENG-02: a render-object ledger per profile; texture bytes in `check:perf`.

## Depends on
- **M00f:** `provenance:check --emit-credits` (`attributions`), `license:scan`, `config/license-allowlist.json` (CC0-1.0 and CC-BY-4.0 already listed).
- **M01d:** `assets:catalog`, `assets:verify`, the lock, `assets/src/<kind>/<id>/asset.json`, `VariantStats.texGpuBytes`, `codec.tex` `ktx2-uastc`/`ktx2-etc1s`.
- **M02h7** (last Phase 1 row, `_PLAN.md` §0 rule 10): its wall `albedo` seam; through the chain M02h2 (`Curb`, `Gutter`, `Lot`, `Plaza`), M02h3 (cover classes) and the M02g1 ledger chain.
- **M10a1:** `config/guardrails.yaml` `genai.lines`, written by M10a1 at the DL-OWN-07 split (DL-740).
- Contracts: C07 1.1 and C13 1.2, read only.

## Scope in
† = design value, tuned here.

Evidence: art-source study ("Licence gate setup", "Ground"); capture study "Ground, sidewalks and curbs". On `claude/build`: procedural ground (`look/ground.ts:39–63`); `look.no-fetch.spec.ts:25–33`; one PNG texture (`jobs.ts:298`); Credits lacks art (`pages/system.tsx:106–139`) though `provenance-check.ts:166–171` writes `attributions`; one program cap (`guardrails.yaml:7`); hard-coded spike cap (`spike/plan.json:3`, `genai-spike.ts:492–493`).

- **Packs:**
  - Snapshots `docs/legal/licenses/{polyhaven,ambientcg,quaternius,kenney,cc-by-4.0}.md` (text, URL, date; CC BY 4.0 for later imports).
  - Register `docs/legal/licenses/packs.json` (schema `config/schemas/art-packs.schema.json`): `{id, hosts[], spdx, snapshot: {path, sha256, retrieved}, courtesy?, use: 'import' | 'snapshot-only'}`.
  - Poly Haven, ambientCG `import`; Quaternius (with the Universal Animation Library) and Kenney `snapshot-only` for M10d1/M10d4.
  - One `spec/03` §7 row per pack; a BD row closes U-AST-10 for the four (Freesound stays open).
- **Gate** (`gates/provenance.ts`): a `licensed` record fails on a `source.url` host in no pack, a snapshot hash differing from the register, a licence other than the pack's `spdx` (or NC, ND, SA, editorial), no `review` `{gate: 'art-vetting', decision: 'approve'}`, or, for CC-BY, an `attribution` lacking title, author, source URL, licence URL or `changes:`. Derived KTX2 needs a licensed root.
- **Vetting** (`docs/legal/art-vetting-checklist.md`): reject when origin is unclear. Reject on:
  - real make or model names, badges, grilles or silhouettes; every vehicle item gets its own silhouette check (rule `V-SIL`, answered by the reviewer per vehicle in its intake record: side and three-quarter profile against the denylisted makes, remodel or drop on a match; low-poly packs such as OpenGameArt and Quaternius often follow real cars);
  - game-style names (`_lod0`, `vehshare`, `.yft`, `.ytd`, a `_hi` token, franchise tags);
  - franchise-heavy uploaders;
  - no authorship evidence (wireframe, WIP, portfolio);
  - storefront logos, people, murals or public art.

  SF landmarks: geometry in-world only, never logo or key art (`research/legal-ip-likeness.md` lines 423–425, 489). OpenGameArt is handled like Sketchfab, with a page snapshot. `SKETCHFAB_API_TOKEN` access is UNVERIFIED, so the owner hand-downloads into git-ignored `content-incoming/`. Intake records: `assets/intake/<pack>/<item>.json` (schema `config/schemas/art-intake.schema.json`); `vet.ts` automates the name, licence, denylist and evidence rules, and the reviewer answers the rest.
- **Texture sets** `texture/pbr.<set>.<map>`: `asphalt` (cracks, patching), `concrete`, `pavers`, `grass-dirt`, `brick`, `stucco`; maps `albedo` (ETC1S), `normal`, `orm` (UASTC); 1024² / 512² / 256² † for `desktop` / `mobile` / `mobile-low`, from vetted Poly Haven or ambientCG CC0 maps. `assets:import -- textures` encodes with KTX-Software as a separate process (F-017), writes `texGpuBytes` and provenance (licensed → derived); `--check` verifies committed outputs without `ktx`.
- **Runtime:** `textures/ktx2.ts` wraps `KTX2Loader` (same-origin transcoder, re-initialised in `onRendererReplaced`); `textures/surface-textures.ts` loads the tier variant via the pack store after first playable, counts transcoded bytes and drops the top mip past `gpuMB`. `look/` gets textures only via `setSurfaceTextures(bindings | null)`.
- **Config** `config/world/surface-textures.json` + schema:
  - `bindings` by surface name: asphalt ← `road.*`, `ground.Asphalt`, `Junction`; concrete ← `sidewalk`, `Curb`, `Gutter`; pavers ← `Plaza`, `Lot`, `ground.Paved`; grass-dirt ← `ground.Grass|Park|Dirt` and cover classes; brick ← Commercial, Industrial, Civic walls; stucco ← ResLow, ResMid walls. Markings stay procedural on top.
  - `budgets` (download / GPU) †: desktop tiers 12 / 40 MB, mobile 4 / 12, mobile-low 1 / 3, XR 0; each ≤ 5 % of `maxTextureMB`, against the 2,048 MB iPhone WebContent kill (F-009).
  - `unsupported`: backends where KTX2 fails, each with a `spec/03` §7 row.
- **Tiling node** (`look/tiling.ts`, TSL): `full` hex stochastic (3 taps) on all maps plus triplanar on terrain over 25° †; `lite` a 2-tap blend; `min` 1-tap albedo; `legacy`/`xr` none. World `xz / tileM`, footprint fade to the set mean; walls through M02h7's `albedo` seam (`base × detail`); wetness stays M02b2's.
- **QA:** `platform-flags.json` `world.textures` (default `true`); `setLookLayer('textures', on)`; `look().textures` `{mode: 'stochastic'|'single'|'albedo'|'off', sets, refs, format, gpuBytes, downloadBytes, mipDrop}`.
- **Ledger:** `docs/look/M10d0-render-ledger.json` in M02g1's shape, with `perLayer.textures` and `textureMB` (`DV_LOOK_WRITE=1` writes it, otherwise it is checked). Plan: +0 objects and triangles on every profile.
- **Credits:** `credits.json` `art[]` `{pack, title, author, sourceUrl, licence, licenceUrl, changes}` per CC-BY record plus a courtesy line per used CC0 pack, rendered as an Art section (`credits.art*` keys).
- **fal split:**
  - `guardrails.yaml` `genai.lines` (USD micros, as M10a1 wrote them; correct any drift): spike 4,000,000; characters 42,000,000; cutscenes 38,000,000; vehiclesProps 14,000,000; buffer 2,000,000 (sum = program cap).
  - Mirrored into the generated constant; `genai/lines.ts` `lineCapMicros(line)`, read by the spike plan, ledger and `genai-spike.ts`.

## Scope out
- Vehicles, props, peds (the $14 line): M10d1/M10d4. Facade atlas: M10d2. HDRIs, Sketchfab and OpenGameArt imports: later art milestones, via this checklist.
- `05-assets-pipeline.md` §7/§11 and `spec/99` U-AST-10 edits: the Architect. Worker per-line enforcement: none in v1.

## Deliverables
- `tools/assets/src/import/{cli.ts, texture-set.ts, vet.ts, packs.ts}`, root script **`assets:import`** (`textures [--check]`, `vet <dir>`), `tools/assets/test/{import.textures.spec.ts, import.vet.spec.ts}`.
- `tools/ci/provenance-check.ts`, `packages/shared/src/assets/{gates/provenance.ts, credits.ts}`, `tools/ci/test/provenance-licensed.test.ts`.
- `packages/world/src/client/textures/{ktx2.ts, surface-textures.ts, config.ts}`, `look/{tiling.ts, ground.ts, facade.ts, look-materials.ts}`, `{world-view.ts, world-bridge.ts}`, `packages/world/test/{textures.config, textures.budget, look.tiling}.spec.ts`.
- `packages/engine/src/platform/tier-config.ts`, `apps/web/vite.config.ts` (the transcoder copied same-origin), `packages/ui/src/pages/system.tsx`, `packages/ui/test/credits.art.spec.ts`.
- `packages/shared/src/genai/lines.ts`, `tools/ci/{guardrails.ts, test/guardrails.test.ts}`, `tools/assets/{genai-spike.ts, test/spike.test.ts}`.
- `tests/e2e/art-textures.spec.ts` (`@art-textures`, `@textures-golden`, `@textures-ledger`, `@credits-art`, `@xr @textures-ledger`). `tests/e2e/world-look.spec.ts`: M02e's no-texture clause becomes "only the tier's bound refs" (BD row).
- Data (not counted): docs, schemas, configs, generated constant, i18n, the 18 texture assets with provenance, goldens, ledger, `tools/ci/checklists/M10d0-iphone15.json`, `.gitignore`, `spec/03` and BD rows.

## Interfaces
- C07 1.1 and C13 1.2 unchanged; the register, intake, `art[]`, `genai.lines` and bridge field are internals.
- Contract change proposals: none. `ProvenanceRecord` has no snapshot field (DL-OWN-06 wording); the host-keyed register meets the rule.

## Acceptance criteria
- AC-1 Given the branch When install, typecheck, lint, unit tests and build run Then all exit 0 — proof: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm check:unit && pnpm build`
- AC-2 Given the register When the gate runs Then the four snapshots match their hashes, fixtures fail by rule id (unknown host, altered snapshot, NC licence, no vetting approval, CC-BY without `changes:`) and the repository passes — proof: `pnpm check:unit -- tools/ci/test/provenance-licensed && pnpm provenance:check`
- AC-3 Given intake fixtures When `vet` runs Then each fails by rule id (real make, `_lod0`, `vehshare`, `.ytd`, `_hi`, franchise tag, franchise uploader, no authorship evidence, editorial licence, mural, person scan), an unanswered origin or a vehicle item with `V-SIL` unanswered rejects, and the clean fixture approves — proof: `pnpm check:unit -- tools/assets/test/import.vet && pnpm assets:import -- vet tools/assets/test/fixtures/intake/clean`
- AC-4 Given the 18 texture assets When the asset gates run Then each has three KTX2 variants at the sizes and codecs of Scope in, `texGpuBytes`, a derived record rooted in an approved licensed one, and outputs that `--check` matches — proof: `pnpm assets:import -- textures --check && pnpm assets:catalog && pnpm assets:verify && pnpm check:assets && pnpm provenance:check`
- AC-5 Given `surface-textures.json` When the world tests run Then binding keys are `SURFACE_NAMES` entries covering Scope in, each tier stays within `budgets` and ≤ 5 % of `maxTextureMB` (RGBA8 drops a mip), `full`/`lite`/`min` build 3/2/1 taps and `legacy`/`xr` none, and `look.no-fetch` passes unchanged — proof: `pnpm check:unit -- packages/world`
- AC-6 Given a `synth` QA build When `@art-textures` opens `?tier=desktop`, `mobile` and `mobile-low` on both browsers Then `look().textures` reports `stochastic`/`single`/`albedo` with the bound sets minus `unsupported` and `gpuBytes` ≤ budget, only those refs are added requests, `setLookLayer('textures', false)` and `world.textures: false` report `off` with no `texture/` request, and `@world-look` passes — proof: `pnpm map:build -- --area synth && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep "@art-textures|@world-look" && DV_WORLD=synth pnpm check:e2e -- --project=webkit-webgl2 --grep "@art-textures|@world-look"`
- AC-7 Given committed goldens When `@textures-golden` captures `curb-corner`, `lot-plaza` and `noon-street` at `desktop` and `mobile-low` Then each is within M02e's tolerance, repeat captures are byte-identical, and each mean difference from textures-off is ≥ 0.02 — proof: `DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @textures-golden`
- AC-8 Given every perf scenario and the ledger When `check:perf` fails on misses and `@textures-ledger` runs flat and in `@xr` Then every tier is in budget (texture MB included), `baseline` equals the latest merged `after`, object and triangle deltas are 0 on desktop, mobile, mobile-low and legacy, `mobile-low` stays ≤ 100, and `xr` equals its baseline with no `texture/` request — proof: `DV_WORLD=synth pnpm check:perf -- --fail && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @textures-ledger && DV_WORLD=synth pnpm check:e2e:xr`
- AC-9 Given the build When `@credits-art` opens `/menu/credits` Then `art[]` shows the courtesy lines and the CC-BY fixture's five fields with working licence links, and the i18n gate passes — proof: `pnpm check:unit -- packages/ui && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @credits-art && pnpm check:i18n`
- AC-10 Given `guardrails.yaml` When the guardrail and spike tests and the offline plan run Then the lines are 4, 42, 38, 14 and 2 million micros summing to the cap, the generated constant is current, the plan, ledger and `--verify` caps equal `lineCapMicros('spike')`, and `--plan` lists the steps that fit under $4 — proof: `pnpm check:unit -- tools/ci/test/guardrails tools/assets/test/spike && pnpm genai:spike -- --plan`
- AC-11 Given the build When the IP and licence gates run Then the transcoder passes `license:scan`, and no snapshot, intake or texture name hits a denylist — proof: `pnpm build && pnpm license:scan && pnpm ip:signatures && pnpm ip:strings && pnpm names:lint`
- AC-12 Given the production build When it is verified and deployed to a Preview Then `__dvBridge` is absent and transcoder and KTX2 responses pass the isolation checks — proof: `pnpm build && pnpm --filter @dv/web verify:dist && pnpm deploy:preview`
- AC-13 Given an operator `synth` Preview on an iPhone 15 Home Screen app at `mobile-low` When `M10d0-iphone15` runs `walk-civic-center` with textures on Then `perf:verify` passes and `notes.json` records texture MB, heap and the reviewer's verdict — proof: manual: iPhone 15 (Home Screen app), Preview from `pnpm map:build -- --area synth && DV_WORLD=synth VITE_DV_QA=1 pnpm build && pnpm deploy:preview`, `pnpm perf:checklist -- tools/ci/checklists/M10d0-iphone15.json`, upload to `docs/device-runs/M10d0/iphone15/`, then `pnpm perf:verify -- docs/device-runs/M10d0/iphone15/perf.json --tier mobile-low --checklist tools/ci/checklists/M10d0-iphone15.json`

## Test plan
- **Unit:** the specs in Deliverables plus `look.no-fetch` (unchanged).
- **E2E:** `@art-textures` on Chromium and WebKit; `@textures-golden`, `@textures-ledger`, `@credits-art` on `chromium-webgl2` (`test.skip` elsewhere). All run in the `DV_WORLD=synth` half; none matches `GRAYBOX_GREP` (unchanged). `@xr @textures-ledger` runs on `xr-quest3`.
- **Perf:** AC-8. **Device:** AC-13.

## Demo script
1. `pnpm map:build -- --area synth && DV_WORLD=synth pnpm dev`, then open `/?debug=1&tier=desktop`.
2. `__dvBridge.world.shot('curb-corner')`: worn asphalt, curb, gutter, pavers.
3. `__dvBridge.world.setLookLayer('textures', false)`, then `true`; `look().textures` shows refs and bytes.
4. Reload with `?tier=mobile-low`: albedo only.
5. Open `/menu/credits`: the Art section.

## Effort
1 Builder session; ≈ 34 code files; risk **medium-high** (KTX2 on WebKit and WebGL2, golden churn). Order: packs, gate, checklist, fal lines, import, loader, tiling, credits, goldens, ledger.

## Risks & fallbacks
- **KTX2 fails on a backend:** list it in `unsupported` (`spec/03` row); it stays procedural and AC-6 subtracts it. Failing everywhere stops the session (Blocked on the Architect).
- **Over a byte budget:** 512² on desktop, then no `orm` on `lite`; never raise a budget.
- **No snapshot possible:** drop the pack; its sets stay procedural. **No `ktx`:** "Blocked on: KTX-Software".
- **Spike plan:** the 13 step estimates of `tools/assets/spike/plan.json` sum to $4.36, but V2 and V4 call the `blocked` H3 Max endpoints, which `checkCallable` refuses before the ledger reserves anything (`genai-spike.ts:213–221`), so a live run reserves at most $3.76 and fits the $4 cap. `lineCapMicros('spike')` must not change that order. If H3 Max is cleared (Q-03) before the operator runs the spike, V2 and V4 become callable and the plan passes $4 at V5: the operator then runs `--only` without V2 and V4, and their $0.60 needs an owner decision from the buffer (DL-741).

## Notes for the Builder
- Read first: `05-assets-pipeline.md` §7, §9, §11; `05-assets.md` §4.1–§4.3; `10-ui-pages.md` §2.14; M02e, M02h2, M02h7; DL-OWN-06/07.
- Verify `KTX2Loader`, the Basis transcoder (`three@0.186.1`) and KTX-Software 4.4.2 flags before use; record `spec/03` §7 rows. The transcoder needs COEP and CORP.
- Poly Haven's API needs a unique User-Agent. Never open, sample or feed the target image; no fal call.
- Secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` for AC-12 and AC-13 (SKIP locally). Branch `m10d0-art-admission`.
