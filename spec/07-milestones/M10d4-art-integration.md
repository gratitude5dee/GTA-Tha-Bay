# M10d4 — art-integration

## Goal
After this session pedestrians and the creator kit are final v1 art, not mannequins. **Split boundary (DL-OWN-07 Phase 3, split 2 of 2 of the earlier one-session M10d1, DL-739):** M10d1 did vehicles, props and the registry; this session does pedestrians and creator parts; M10d3 does player cars and stages; M10d2 does surfaces.

Pedestrians become 8 realistic adult bodies × 20 original outfits on `bay_rig_v1`, from vetted CC0 bases (Quaternius, admitted by M10d0) with Universal Animation Library clips. Every realistic creator row gets a `model` and a portrait; the six Coast rows (DL-737) keep their place, and M10a2 gives them models. Ledger: +0 render objects per profile.

Evidence: capture study "Pedestrians and player" (`staging-prod-autotier-mobile-low-01-creator.png`); look study item 14; art-source study "Pedestrian bodies". On `claude/build`: `peds/mannequin.ts:5`, `peds/instances.ts:6` and `:367–368`, `tools/ci/perf-check.ts:69–72`, `packages/ui/src/creator/stage.ts:4`.

## Requirements
- R-MAP-04: pedestrians render final art.
- R-UI-01: creator cards show real parts.
- R-IP-01: every new file has provenance, a licence and a vetting record.
- R-IP-02: no real-person likeness; person assets are tier `original`.
- R-ENG-02: ledger, caps and texture budgets checked automatically.

## Depends on
- **M10d1:** `config/art-placeholders.json` (`M10d4` rows), `tools/assets/src/lod.ts`.
- **M10d0:** `quaternius` snapshot, vetting checklist, intake records, `credits.json` `art[]`.
- **M03b2:** `PedRenderer`, `PED_ASSETS`, `PED_PALETTE`, `world.peds()`.
- **M04b2:** creator catalog and schema, `CreatorStage`, `AppearanceV1` goldens.
- Run order: after M02g1 (blobs, ledger, WebKit golden).
- Contracts: C04 1.1, C07 1.1, C13 1.2, C11 1.0 (read only).

## Scope in
† = design value, tuned here.

- **Base choice:** compare Quaternius CC0 humans with MakeHuman on a turntable each (BD row). MakeHuman (AGPL, tool-only) only with an Architect ADR at session start, and only its CC0 base and official assets; else Quaternius. Mixamo rejected. No fal.
- **Intake** (`assets:import -- characters`, `import/character.ts`), per base: intake and vetting records; bones renamed to `HUMANOID_BONES`, rest pose snapped to `BONE_REST` within 1 cm (code clips of M01b2 and M10f play); ≤ 4 influences; adult check (stature 1.55–1.95 m †, head ≤ 1/6.5 †); realistic proportions, PBR skin; `derived` provenance with `changes`.
- **Recipes** (`content/art/people.json` + schema; deterministic, `authored`): `recipes/wear.ts` makes outfit shells by body region (tops, bottoms, shoes) with copied skin weights, and bone-attached accessories, with no text or marks. `recipes/head.ts` makes faces with the 24 catalog `morph_*` targets, and hair.
- **Ped kit:** `character/ped.body.{a..h}` (base + proportions + face); `character/ped.outfit.{01..20}` from the creator recipes; `prop/ped.far.{a..h}` rigid ≤ 300 triangles with baked `aSwing`/`aPivot` for the existing TSL gait; `texture/ped.atlas` per tier (`atlas.ts`) with a `PED_PALETTE` mask; `anim/ped.moves` (states 0–3, Library clips mapped by name; a state with no match keeps its placeholder clip, BD row).
- **Renderer** (`peds/kit.ts`, `config/world/ped-art.json`): a near ped merges body and outfit into **one** `SkinnedMesh` with one material; far is one `InstancedMesh` per body. Sim keys `character/ped.ambient.*` map to the kit in config; sim and hashes are unchanged. Caps (24 / 16 / 12 / 8 / 6) and `CrowdLimits` are unchanged; the mannequin remains only as the load-failure fallback; `anim/clip-source.ts` picks file clips or placeholders.
- **Creator kit:**
  - `character/pc-<slot>-<id>` and `portrait/pc-<slot>-<id>` for every Body (12), Face (24), Hair (16), top (12), bottom (8), shoes (6) and accessory (8) row except the six Coast rows, which gain `fallbackPart` (new optional field in `wardrobe-item.v1.schema.json`: a same-slot row, tinted with the Coast row's `color`).
  - `avatar/assemble.ts` (engine) builds the preview: one skeleton, three atlases (`texture/pc.{skin,cloth,hair}`), face morphs.
  - The Coast body–face pair keeps the whole figure on the mannequin path until M10a2. On a realistic body, Coast hair or clothes draw their `fallbackPart`.
  - `StageParams.parts: {slot, ref, path: 'model'|'fallback'|'mannequin'}[]`; `AppearanceV1` unchanged.
  - Portraits: `@art-portraits` with `DV_ART_WRITE=1` captures 256² cards, `assets:import -- portraits` encodes them; `derived_from` holds the part's sha256.
- **Registry:** fill `replacedBy` for the `M10d4` rows; add row `creator-coast` (`owner: 'M10a2'`, the six Coast rows) and the `M10a2` owner value to the schema.
- **Budgets** (`config/asset-budgets.json`, †):

| Row | Tag | Tris hi / mid / lo | Materials | Texture |
|---|---|---|---|---|
| `character-ped` | `class:ped` | 6,000 / 3,000 / 1,500 | 1 | atlas page 1,024² / 512² / 256² |
| `prop-ped-far` | `prop:ped-far` | 300 / 300 / 300 | 1 | none |
| `character-creator` | `class:creator` | 10,000 / 5,000 / 2,500 per part | 1 | atlas |

  The assembled `mid` preview stays ≤ 40,000 triangles and ≤ 3 textures at ≤ 1,024 px (`10-ui-pages.md` §2.8 rule 3).
- **Ledger** `docs/look/M10d4-render-ledger.json` (M02g1 shape), with the baseline measured on the default branch at session start (`downtown-rush` plus the QA crowd of 12). `DV_LOOK_WRITE=1` writes it; `@peds-ledger` checks it.

| Profile | Near cap | Far meshes | Objects added | Ped texture GPU MB † |
|---|---|---|---|---|
| `full` | 24 | 8 | 0 | ≤ 8 |
| `lite` | 12 | 8 | 0 | ≤ 3 |
| `min` | 6 | 8 | 0, total ≤ 100 | ≤ 1 |
| `legacy` (XR) | 8 / 16 | 8 | 0 | ≤ 3 |

- **Bridge (QA):** `world.peds().art` `{bodies, near, far, clips, textureBytes}`; creator `state.parts`.

## Scope out
- Coast models, the on-foot player body from creator parts, NPC and fighter models: M10a2, M10d3.
- Vehicles: M10d1. Surfaces: M10d2. XR profile: M02h8. Emotes: M10f.

## Deliverables
- Root script **`assets:retarget`** (`tsx tools/assets/src/retarget.ts`, §4 flags `--rig bay_rig_v1 --clips <glb> --to <slug>`; M10a1 extends it) and **`assets:import`** subcommands `characters [--check]`, `portraits [--check]`; `package.json`.
- `tools/assets/src/{retarget.ts, atlas.ts, import/character.ts, import/cli.ts, recipes/wear.ts, recipes/head.ts}`; `tools/assets/test/{import.character, recipes.people, retarget}.spec.ts`.
- `content/art/people.json`, `config/world/ped-art.json`, schemas `config/schemas/{art-people, ped-art}.schema.json`; edits to `config/{asset-budgets.json, art-placeholders.json, schemas/art-placeholders.schema.json}`, `docs/legal/licenses/packs.json` (`quaternius` → `use: 'import'`); `docs/legal/art-vetting/M10d4.json`.
- `packages/world/src/client/peds/kit.ts`; edits to `peds/{instances.ts, mannequin.ts}`, `world-bridge.ts`; `packages/world/test/peds.kit.spec.ts`.
- `packages/engine/src/client/{avatar/assemble.ts, anim/clip-source.ts}`; edit `creator-stage.ts`; `packages/engine/test/avatar.assemble.spec.ts`.
- `packages/ui/src/creator/stage.ts`, `content/ui/creator/catalog.json`, `packages/shared/schemas/ui/wardrobe-item.v1.schema.json`; `packages/ui/test/creator.parts.spec.ts`.
- `tests/e2e/art-peds.spec.ts` (`@art-peds`, `@peds-ledger`), `tests/e2e/ui/art-creator.spec.ts` (`@art-creator`, `@art-portraits`); the ledger.
- Generated (not counted): `.glb`, KTX2, WebP, `asset.json`, provenance, intake, lock, credits.

## Interfaces
- C04 1.1 `bay_rig_v1`, `HUMANOID_BONES`, `AnimStateId` 0–3 unchanged. C07 1.1 unchanged (existing kinds). C13 1.2 budgets and `CrowdLimits` unchanged. C11 1.0 `AppearanceV1` byte-equal.
- `fallbackPart`, `StageParams.parts` and bridge fields are internal.
- Contract change proposals: none of shape.

## Acceptance criteria
- AC-1 Given the branch When install, typecheck, lint, unit tests and build run Then all exit 0 with no GLSL — proof: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm check:unit && pnpm build`
- AC-2 Given `config/art-placeholders.json` When its test runs Then every `M10d4` row's `replacedBy` is non-empty and resolves, `creator-coast` names exactly the six Coast rows with owner `M10a2`, and a fixture with an empty `M10d4` row fails naming its id — proof: `pnpm check:unit -- tools/assets`
- AC-3 Given the new assets When the asset gates run Then:
  - each has three variants within its budget row;
  - recipe and atlas outputs are byte-identical across two runs;
  - each Quaternius-derived file has a `derived` record with `changes`, a licensed root, an intake record and an approved vetting review, and credits carry the courtesy line.
  — proof: `pnpm assets:import -- characters --check && pnpm assets:catalog && pnpm assets:verify && pnpm check:assets && pnpm provenance:check`
- AC-4 Given every person asset and file name When the IP and likeness gates run Then all pass, every record has tier `original`, no outfit holds text or a mark, and the target image's signature is absent — proof: `pnpm names:lint && pnpm ip:strings && pnpm ip:signatures && pnpm ip:extensions && pnpm likeness:gate`
- AC-5 Given each body and part When the rig and clip tests run Then:
  - it binds to the 22 bones with rest pose within 1 cm of `BONE_REST` and ≤ 4 influences, and passes the adult check;
  - `anim/ped.moves` passes A5 (idle hip drift ≤ 3 % of `heightM`, end pose ≤ 1 cm) and placeholder clips still play;
  - state hashes are unchanged.
  — proof: `pnpm check:unit -- tools/assets packages/engine && pnpm --filter @dv/engine test:determinism`
- AC-6 Given a mock asset client When `peds.kit` builds each profile Then:
  - a near ped is one `SkinnedMesh` with one material, palette and skin tone applied;
  - far is one `InstancedMesh` per body, ≤ 300 triangles, with gait attributes;
  - objects equal the ledger table, caps and `CrowdLimits` are unchanged, and a failed load falls back to the mannequin.
  — proof: `pnpm check:unit -- packages/world`
- AC-7 Given the creator catalog When the creator and assembly tests run Then:
  - every non-Coast Body, Face, Hair, top, bottom, shoes and accessory row has a resolving `model` and `portrait`;
  - Coast rows keep their indices, have no `model` and a valid `fallbackPart`; the Coast pair renders `mannequin`, Coast hair on a realistic body `fallback`;
  - faces carry all 24 morph targets; the `mid` preview is ≤ 40,000 triangles with ≤ 3 textures;
  - `AppearanceV1` golden vectors are byte-equal to M04b2's.
  — proof: `pnpm check:unit -- packages/ui packages/engine`
- AC-8 Given a `synth` QA build When `@art-peds` runs at `?tier=desktop` and `?tier=mobile-low` with the QA crowd, `@art-creator` walks every tab, and the `@xr` case runs Then `world.peds().art` reports `near: 'kit'`, `far: 'kit'` and `clips: 'anim/ped.moves'`, `observe()` lists no `ped.ambient` or mannequin ref, every non-Coast card reports `model`, and XR reports `legacy` with near ≤ 8 — proof: `pnpm map:build -- --area synth && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep "@art-peds|@art-creator" && DV_WORLD=synth pnpm check:e2e -- --project=webkit-webgl2 --grep "@art-peds|@art-creator" && DV_WORLD=synth pnpm check:e2e:xr`
- AC-9 Given the committed ledger When `@peds-ledger` and fail-mode perf run Then:
  - every profile adds 0 objects and `mobile-low` is ≤ 100;
  - ped texture bytes are within the table;
  - every scenario stays within its object, triangle and texture budgets, and `PED_FAR_DRAWS_MAX` stays 8.
  — proof: `DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @peds-ledger && DV_WORLD=synth pnpm check:e2e:xr && DV_WORLD=synth pnpm check:perf -- --fail`
- AC-10 Given goldens regenerated under the `golden-update` label When `@look-golden`, `@world-peds` and `@creator` run on both engines Then every shot is within M02e's tolerance, including M02g1's `webkit-webgl2` m.a1.01 truck shot — proof: `pnpm map:build -- --area synth && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep "@look-golden|@world-peds|@creator" && DV_WORLD=synth pnpm check:e2e -- --project=webkit-webgl2 --grep "@look-golden|@world-peds|@creator"`
- AC-11 Given a local QA build When the reviewer walks Market Street at `desktop` and `mobile-low` with the QA crowd and opens every creator tab Then no ped or part resembles a real person, no child body appears, no outfit shows text or a mark, and the base comparison is attached, recorded in `docs/device-runs/M10d4/desktop/notes.json` — proof: manual: desktop browser, `DV_WORLD=synth pnpm dev`, open `/?debug=1&tier=desktop`, `__dvBridge.world.teleport('lm.ferry-building')`, `__dvBridge.world.call('crowd', { n: 12 })`, walk up Market Street, repeat at `tier=mobile-low`, open New Game and every tab, write the notes file

## Test plan
- **Unit:** `tools/assets`, `packages/world`, `packages/engine`, `packages/ui`.
- **E2E:** `@art-peds`, `@art-creator`, `@peds-ledger`, `@art-portraits` run in the `DV_WORLD=synth` half; none matches `GRAYBOX_GREP`. `@peds-ledger` runs on `chromium-webgl2` only; `@art-portraits` writes only with `DV_ART_WRITE=1`; `xr-quest3` runs `@xr @art-peds`. M03b2, M04b2, M02g1, M10d1 tags stay green.

## Demo script
How to see it:
1. `pnpm map:build -- --area synth && DV_WORLD=synth pnpm dev`, open `/?debug=1&tier=desktop`.
2. `__dvBridge.world.teleport('lm.ferry-building')`, then `__dvBridge.world.call('crowd', { n: 12 })`; `__dvBridge.world.peds()` shows `art.near: 'kit'`.
3. Reload `/?debug=1&tier=mobile-low&gl=1`: ≤ 6 near peds.
4. New Game: Coast leads each tab as a mannequin; pick `body-athletic` for a realistic body with Coast hair via `fallbackPart`.

## Effort
1 Builder session; ≈ 34 hand-written files plus generated assets; risk **high** (skinning, 86 creator parts, realism ceiling). Order: intake, ped kit, ledger, creator parts, portraits, goldens.

## Risks & fallbacks
- **Bases read stylized:** remodel; MakeHuman only with its ADR.
- **No Library clip for a state:** keep the placeholder clip.
- **Skinning artefacts:** re-weight, or derive from another base.
- **`mobile-low` overrun:** smaller atlas, then vertex colour; never raise a budget.
- **Runs long:** unfinished creator rows keep `replacedBy: []`; AC-2 fails and the Architect writes a follow-up.

## Notes for the Builder
- Read first: `05-assets-pipeline.md` §3, §4, §7, §14; `02-world-living.md` §4.5; `10-ui-pages.md` §2.8 rules 3, 5, 6; the M10d1, M10d0, M03b2 and M04b2 files.
- Facts: licence terms only from the M10d0 snapshot; the art-source study notes the Library lists no walk or idle explicitly.
- Never use photos, scans or the target image as input; faces come from the CC0 base plus morph recipes.
- Secrets: none. No genAI spend. Branch `m10d4-art-integration`.
