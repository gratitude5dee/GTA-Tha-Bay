# M02h8 — xr-look-traa

## Goal
`look.json` maps both XR tiers to `legacy` (`config/world/look.json:9-10`), so VR gets none of M02e or M02g1–M02h7 (look study, render audit item 13). This session (DL-OWN-07 Phase 5) adds:
- an `xr` profile: the `min` building path, hard-step markings, `skyReflect`, fog-node grade and haze, blob shadows, opaque crowns and vertex AO; no noise, bump, alpha test or post;
- both XR tiers mapped to it, with `legacy` kept as the fallback (data);
- multiview confirmed on Quest (without it every object counts twice);
- TRAA on `desktop`: `postLevelCap` 3 under M11a1's governor, which can lower it.

$0 fal, no asset, no contract change. A Quest 3 operator pass decides the Quest default.

## Requirements
- R-PLAT-02: the XR port shows the same city as the flat tiers, not a placeholder look.
- R-PLAT-03: TSL only; profile and post level from data and the governor.
- R-PLAT-05 (s): Quest 3 holds 72 Hz within the `xr-quest` budget.
- R-ENG-02: a render-object ledger per profile, with XR counted per view pass.

## Depends on
- **M11a1:** `QualityGovernor` (`postLevel` ceiling 3), `platform.governor.state()`; the `postLevelCap` raise moved from M11a1 to this file (DL-740).
- **M02h7:** the `min` wall path, with glass via `skyReflect`, which `xr` takes.
- Also used, merged earlier: M02e (`LookProfile`, `createLookMaterials`, `PostStack`, `postNodes`, `@look-golden`), M02g1 (`grade.ts`, `sky-reflect.ts`, `blob-shadows.ts`, `layers`, ledger shape), M02g2 (vertex AO), M02h1 (`flat` markings, legacy XR roads material), M02h4 (`low` crowns), M01b2 (XR smoke, `?xr-emulate=quest3`).
- Contracts: C13 1.2 (`TierFeatures`, `RenderLimits.viewPasses`, `multiview`, `DynamicQuality.postLevel`) and C08 1.1 (DL-741), read only.

## Scope in
- **Profile type** (`look/config.ts:10`): `'full' | 'lite' | 'min' | 'xr' | 'legacy'`. The schema enum gains `xr` (`world-look.schema.json:11`). `lookErrors` adds two rules: `xr` only on the two XR tiers, and `legacy` valid on every tier.
- **Mapping** (`look.json`):
  - `xr-quest` and `xr-visionpro` map to `xr`;
  - `shadowsOff` gains `xr-visionpro`: its `csm1` map (`tier-budgets.json:473`) would draw twice (`viewPasses: 2`, `:433`); off until M11b1's Vision Pro run, blobs on;
  - `world.look: false` and `?look=0` still give `legacy`;
  - new QA-only `?look=legacy|xr` on XR tiers, parsed beside `?look=0` (`apps/web/src/main.ts:234-235`). It is not a C13 `QaFlags` field.
- **Materials** (`look/look-materials.ts`): `MaterialProfile` (`:33`) gains `xr`. No `vnoise`, bump or roughness noise anywhere.
  - Buildings: the `min` branch (`:100-104`), with M02h7 glass through `skyReflect`.
  - Ground: vertex colour × `aAO`, with M02h1 `flat` markings (hard steps, `fwidth` AA).
  - Water: flat colour plus `skyReflect` Fresnel.
  - Trees: M02h4's `low` pools.
  - On `xr-quest`, which has fade 0 (`world-view.ts:1011`), L0 materials use `alphaTest` 0 instead of 0.5 (`:62`). Coarse cover masks keep their discard (`chunks/materials.ts:104`).
- **Legacy path:** `chunks/materials.ts:107-112` builds look materials for `xr`; `legacy` keeps `chunk`/`coarse` and M02h1's roads material.
- **Mesher:** `mesher.ts:521` already writes `surf` and `facade` for any non-`legacy` profile. `xr-quest` L0 units stay within `maxChunkUploadBytes` (2 MiB).
- **Fog** (`sky/fog.ts:33-55`): M02g1's grade and haze also run in the `linear-fade` (Quest) and `height` (Vision Pro) world fog and in the backdrop fog. They apply once, because the `direct` pipeline has no `tonemap` node. Budget: ≤ 25 † added ALU per fragment on Quest (study item 13).
- **LookView** (`look-view.ts:185`): no stack on `direct`. `layers.xr` = `grade`, `haze`, `markings`, `skyReflect`, `blob`, `ao`; the rest off (data).
- **Multiview:** `RendererHost` reports `xrMultiview: boolean | null`.
  - It reads the active state from the r186 XR manager or backend if exposed (verified in the installed `three@0.186.1`, spec/03 §7 row), else infers it: draw calls ÷ render objects ≈ 1 is multiview, ≈ 2 none.
  - `__dvBridge.world.look()` adds `xrMultiview` and `viewPassesObserved`.
- **TRAA:**
  - `look.json` `postLevelCap` goes 2 → 3 here (moved from M11a1, DL-740), so `desktop` level 3 is `[gtao-half, bloom, traa, tonemap]` (`levels.ts:30-41`, `tier-budgets.json:150`), and level ≤ 2 gives `smaa`;
  - `PostStack` resets the history on a camera cut or teleport; `shot()` resets it and renders 16 † frames before presenting;
  - a failing `traa` on WebGL2 goes to `webgl2AaFallback` (spec/03 §7 row).
- **Goldens:** `noon-street`, `night-street` and `fog-west` at `xr-quest`, forced on the flat canvas, join the `@look-golden` manifest. The `desktop` shots are regenerated with TRAA under `golden-update`.
- **Ledger:** `docs/look/M02h8-render-ledger.json`, in M02g1's shape plus `xrMultiview` and `viewPassesObserved`.
  - The baseline is the newest merged ledger's `after`.
  - `xr-quest` comes from `__dvBridge.perf.live()` in the `@xr` case; `xr-visionpro` is forced flat on `chromium-webgl2`, per view pass.

| Profile (tier) | Objects added (≤) | Cap |
|---|---|---|
| `xr` (`xr-quest`) | +1 blob | 150 per pass |
| `xr` (`xr-visionpro`) | +1 blob | 200 per pass, 2 passes |
| `full` (`desktop`, TRAA) | 0 | 600 |
| `min` (`mobile-low`) | 0 | 100 |
| `legacy` (`?look=0`) | 0 | — |

- **Checklist** `tools/ci/checklists/M02h8-quest3.json`:
  - setup: a synth Preview at `/?tier=xr-quest&perf=1`, entered with Enter VR (smoke);
  - holds: 120 s at 13:00 `clear` and 120 s at 22:00 `karl-fog`, first on `xr` and then on `?look=0`;
  - `notes.json` records `xrMultiview`, both frame medians and the default decision.

## Scope out
- Furniture, parked cars, curbs and scatter on `xr`; XR UI and per-mode looks (M11b1–M11b4); Vision Pro shadow maps (M11b1).
- Shore foam (plan Phase 5; Architect to place), SSR (cut), landmark fades (M02g2), licensed art (M10d0 on), XR FOV.

## Deliverables
- World:
  - `packages/world/src/client/look/{config.ts, look-materials.ts, ground.ts, water.ts, facade.ts, look-view.ts, shots.ts, grade.ts, blob-shadows.ts}`;
  - `sky/fog.ts`, `chunks/{materials.ts, mesher.ts}`, `world-view.ts`, `world-bridge.ts`.
- Engine: `packages/engine/src/platform/{renderer-host.ts, probe.ts}`, `platform/post/stack.ts`.
- App: `apps/web/src/main.ts`.
- Tests:
  - unit: `packages/world/test/{look.xr.spec.ts, look.config.spec.ts}`, `packages/engine/test/platform/{post-levels.spec.ts, post-stack.spec.ts}`;
  - e2e: `tests/e2e/world-xr-look.spec.ts` (`@world-xr-look`, `@look-xr-ledger`), `tests/e2e/look-traa.spec.ts` (`@look-traa`);
  - `tests/e2e/world-look.spec.ts`: the XR case at `:158-167` expects the configured profile, and three goldens are added.
- Data (not counted): `look.json`, schema, `look-shots.json` (`traa-graze`), goldens, `docs/look/M02h8-*`, checklist, spec/03 and BD rows. No new script or dependency.

## Interfaces
- C13 1.2 and C08 1.1 unchanged. `xr` is an S02 `LookProfile` value; `shadowsOff`, `postLevelCap` and `?look=` are look data and app QA parsing.
- Contract change proposals: none.

## Acceptance criteria
- AC-1 Given the branch When install, typecheck, lint, unit tests and build run Then all exit 0 with no GLSL — proof: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm check:unit && pnpm build`
- AC-2 Given `look.json` and the material and level tests When they run Then:
  - the file validates with `xr` in the enum, both XR tiers map to the configured profile, and `lookErrors` rejects `xr` on a flat tier;
  - the `xr` set builds no noise or bump node, and its `xr-quest` L0 materials have `alphaTest` 0;
  - `postNodes(desktop, 3, 3)` is `[gtao-half, bloom, traa, tonemap]`, level 2 gives `smaa`, and the XR tiers give `[]`;
  - `PostStack` resets the TRAA history on a cut.
  - — proof: `pnpm check:unit -- packages/world packages/engine`
- AC-3 Given the `synth` bake When the mesher runs twice on every L0 unit for `xr-quest` Then the buffers including `surf` and `facade` are byte-identical and no unit exceeds 2,097,152 upload bytes — proof: `pnpm map:build -- --area synth && pnpm check:unit -- packages/world`
- AC-4 Given a synth QA build When `@world-xr-look` runs on `xr-quest3` and forced flat at `?tier=xr-visionpro` on `chromium-webgl2` Then:
  - `look()` reports `xr`, `direct`, `postNodes: []`, `blob` with 0 passes, the six layers, `flat` markings and `low` trees;
  - `xrMultiview` is a boolean on `xr-quest3`;
  - `?look=0` and `?look=legacy` report `legacy` with M02h1's flat markings;
  - no image or `texture/` request is made that a `?look=0` boot does not also make.
  - — proof: `pnpm map:build -- --area synth && DV_WORLD=synth pnpm check:e2e:xr && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @world-xr-look`
- AC-5 Given every perf scenario in fail mode and the ledger When `@look-xr-ledger` runs flat and in the `@xr` case Then:
  - `baseline` equals the newest merged `after`;
  - `xr-quest`: `after` ≤ baseline + 1, `after × viewPassesObserved` ≤ 150, and ≤ 750,000 triangles;
  - `xr-visionpro`: ≤ baseline + 1 and ≤ 200 per pass;
  - the deltas are 0 on `desktop`, `mobile-low` (≤ 100) and `legacy`.
  - — proof: `DV_WORLD=synth pnpm check:perf -- --fail && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @look-xr-ledger && DV_WORLD=synth pnpm check:e2e:xr`
- AC-6 Given the manifest with three `xr-quest` shots and the TRAA `desktop` shots When `@look-golden` and every other committed look golden set (`_PLAN-3.md` Look program rule 6: every committed look golden set) run Then every shot is within the M02e tolerance and two consecutive captures are byte-identical — proof: `pnpm map:build -- --area synth && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep "@look-golden|@markings-golden|@textures-golden|@facade-golden"`
- AC-7 Given `?tier=desktop` When `@look-traa` runs on `chromium-webgl2` and `webkit-webgl2` Then:
  - `postNodes` is the AC-2 level-3 list after `webgl2AaFallback`, and `governor.state().dynamic.postLevel` is 3 at reveal;
  - with `traa` on, `traa-graze` flickers on ≤ 0.2 % † of façade pixels over 8 frames (M02h1 `flicker.ts`), no more than at level 2;
  - 16 frames after a 90° cut, the frame is within golden tolerance of the settled new pose.
  - — proof: `pnpm map:build -- --area synth && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @look-traa && DV_WORLD=synth pnpm check:e2e -- --project=webkit-webgl2 --grep @look-traa`
- AC-8 Given the same build When the earlier suites run Then `@world-look`, `@world-sky`, `@world-markings`, `@world-trees`, `@look-tune`, `@look-fixes`, `@governor` and the XR smoke pass — proof: `DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep "@world-look|@world-sky|@world-markings|@world-trees|@look-tune|@look-fixes|@governor" && DV_WORLD=synth pnpm check:e2e:xr`
- AC-9 Given the branch When the asset and IP gates run Then they pass with no new asset, provenance record or licence — proof: `pnpm assets:catalog && pnpm check:assets && pnpm provenance:check && pnpm ip:strings`
- AC-10 Given the production build When verified and deployed to a Preview Then `__dvBridge` and the `?look=` parsing are absent and headers pass — proof: `pnpm build && pnpm --filter @dv/web verify:dist && pnpm deploy:preview`
- AC-11 Given a synth operator Preview on a Quest 3 in Quest Browser When the `M02h8-quest3` checklist runs both holds on `xr` Then `perf:verify` passes at `xr-quest`, and `notes.json` records `xrMultiview`, the `xr` and `legacy` frame medians and the default decision — proof: manual: Quest 3, Quest Browser, Preview from `pnpm map:build -- --area synth && DV_WORLD=synth VITE_DV_QA=1 pnpm build && pnpm deploy:preview`, `pnpm perf:checklist -- tools/ci/checklists/M02h8-quest3.json`, save to `docs/device-runs/M02h8/quest3/`, then `pnpm perf:verify -- docs/device-runs/M02h8/quest3/perf.json --tier xr-quest --checklist tools/ci/checklists/M02h8-quest3.json`

## Test plan
- **Unit:** `look.xr` (graph, `alphaTest`, layers), `look.config`, `post-levels`, `post-stack`, and the `xr-quest` mesher bytes.
- **E2E:**
  - Every new tag runs in the `DV_WORLD=synth` half, and none matches `GRAYBOX_GREP` (unchanged).
  - No tag starts with `@xr`: `xr-quest3` greps `/@xr/` and flat projects invert it (`playwright.config.ts:113-115`). XR cases add a separate `@xr` tag.
  - `@look-xr-ledger` and `@look-golden` run on `chromium-webgl2` only. `@look-traa` runs on Chromium and WebKit. `@world-xr-look` runs flat on Chromium and as `@xr` on `xr-quest3`.
- **Device:** Quest 3 (AC-11). Vision Pro is measured in M11b1.

## Demo script
How to see it:
1. `pnpm map:build -- --area synth && DV_WORLD=synth pnpm dev`, open `/?tier=xr-quest&xr-emulate=quest3&debug=1`, press Enter VR (smoke): painted lanes, blob shadows, graded haze, sky in the glass, opaque trees.
2. Add `&look=0`: the legacy look.
3. `/?tier=desktop&debug=1`: the panel lists `traa`; a slow pan past City Hall no longer crawls.
4. Open `docs/look/M02h8-render-ledger.json`.

## Effort
0.8 Builder session; ≈ 24 code files; risk medium (Quest fragment cost, multiview detection, TRAA golden convergence). Order: config, materials, fog, mesher, bridge, ledger, TRAA and goldens, checklist.

## Risks & fallbacks
- **No Quest 3 (Q-13), or AC-11 fails:** ship `xr-quest: 'legacy'` (data), `xr` behind `?look=xr`; report "Blocked on: Q-13".
- **No multiview in emulated CI:** if the doubled count exceeds 150, CI asserts per pass, AC-11 carries the doubled rule, and a DL row records it.
- **`xr-quest` unit over 2 MiB:** drop `facade` on `xr` (world-grid night mask).
- **TRAA goldens unstable:** pin the `desktop` goldens at level 2, and `@look-traa` stays the TRAA proof (DL row).
- **Ghosting at speed:** `postLevelCap` 2 (data). Never raise a budget.
- **Flat `xr-quest` capture fails:** assert bridge state only (DL row).

## Notes for the Builder
- Read `11-platform-xr.md` §1–§4, `11-platform.md` §4.4, §5.1, the study's render audit (items 9, 12, 13) and the files named in Depends on.
- Check multiview and TRAA behaviour in the installed `three@0.186.1` (F-002, S11-F4 at `11-platform-xr.md:222`). Use no export that spec/03 §7 does not list.
- Sim untouched; state hashes equal. The target image is never committed, sampled or fed to fal.
- Secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (AC-10, AC-11; SKIP locally). Device: Quest 3 (Q-13). Branch `m02h8-xr-look-traa`.
