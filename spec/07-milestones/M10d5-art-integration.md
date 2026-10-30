# M10d5 — art-integration

## Goal
After this session the player on foot and the mission actors are realistic bodies instead of the gray-box capsule (DL-OWN-09, DL-755). **Split boundary (M10d, fifth id; carved from M10d3 so the on-foot body arrives with the art track, not behind racing and fighter content):** M10d1 did vehicles, props and the placeholder registry; M10d4 did pedestrians and creator parts; this session moves `player.default` and `ped.actor` off `prop/graybox.capsule`; M10d2 does surfaces; M10d3 does player cars, stages and the fighter-model fallback.

`player.default` renders the profile's `PlayerAvatar` from M10d4's creator-kit parts, and `ped.actor` renders a ped-kit body. Coast walks the city in his own model once M10a2 has merged. Render objects per entity stay 1, so every ledger holds at +0, and state hashes are unchanged. Today `prop/graybox.capsule` draws the procedural `bay_rig_v1` mannequin (`packages/engine/src/client/snapshot/object-pool.ts:7`, `:34`).

## Requirements
- R-UI-01: the on-foot player wears the parts chosen in the creator.
- R-IP-01: every new file has provenance and passes the IP gates.
- R-IP-02: no real-person likeness; the bodies are M10d4's `original` parts.
- R-ENG-02: render objects per profile are checked by a ledger; `check:perf` green.

## Depends on
- **M10d4** (HARD): the creator-kit `character/pc-*` parts on `bay_rig_v1`, `fallbackPart`, `packages/engine/src/client/avatar/assemble.ts`, the ped kit (`character/ped.body.*`, `character/ped.outfit.*`, `peds/kit.ts`). Through it **M10d1**: `config/art-placeholders.json` with the `capsule` row (`owner: 'M10d5'`), and **M10d0** (provenance gate).
- **M10a2** (SOFT, `_PLAN.md` §4): Coast's body model `character/pc-body-coast`. Stand-in: the merged catalog's Coast rows without `model`, which draw their `fallbackPart` (M10d4 AC-7). The later of this row and M10a2 to merge re-runs AC-3 and AC-4.
- **M02h2** (DL-756; merged before this row in any order, since M10d4 holds `peds/*` until it merges): the render-only `walk` lift mask and the player-figure file its BD row names.
- Track B, fourth row (`_PLAN-3.md` Look program): no file shared with an open Track A row (M02h2's player-figure file is edited only after M02h2 has merged).
- Contracts: C05 1.1 `avatar` (S10 `PlayerAvatar`), C11 1.0 `AppearanceV1`, C04 1.1 `bay_rig_v1`, C06 1.1 prefabs, all read only.

## Scope in
- **On-foot player** (`packages/engine/src/client/avatar/player-body.ts`): `player.default` renders the profile's `PlayerAvatar` through M10d4's `avatar/assemble.ts`, merged into one `SkinnedMesh` with one material (the three part atlases picked by a vertex part id); `mid` parts on `desktop` and `mobile`, `lo` on `mobile-low` and XR. A part without `model` draws its `fallbackPart`; a failed load draws the mannequin. The body keeps M02h2's render-only `walk` lift (moved from the player-figure file its BD row names), and M10d4's `anim/clip-source.ts` drives it: the merged mesh binds the same 22 `bay_rig_v1` bones as the mannequin, so every locomotion state plays its file clip or placeholder clip, never the bind pose. `render.asset` names the body of `content/ui/creator/defaults.json` (`character/pc-body-coast` when M10a2 has modelled it, else that slot's realistic default).
- **Mission actors:** `ped.actor` (actors without their own prefab, `packages/modes/story/src/vm/runtime.ts:1064`) renders `character/ped.body.a` with `character/ped.outfit.01` through M10d4's ped kit, tinted per actor seed.
- **Pool:** `client/snapshot/object-pool.ts` builds both through `player-body.ts`; `GRAYBOX_CAPSULE` stays only as the load-failure key. Render objects per entity stay 1; the sim, the state hashes and `AppearanceV1` are unchanged.
- **Prefabs and registry:** `assets/prefabs/{player.default, ped.actor}.json` repoint `render.asset`; fill `replacedBy` for the `capsule` row.
- **Ledger:** `docs/look/M10d5-render-ledger.json` in M02g1's shape (`DV_LOOK_WRITE=1` writes it, `@player-ledger` checks it); baseline the `after` of the ledger most recently merged at rebase, named in `baselineFrom`. Plan: +0 objects on every profile, `mobile-low` ≤ 100.

## Scope out
- Player cars, fight stages and the fighter-model fallback: M10d3. Creator parts and the ped kit: M10d4. Coast models: M10a2.
- Emotes on the new bodies: M10f. The `xr` look profile: M02h8.

## Deliverables
- `packages/engine/src/client/avatar/player-body.ts` (merge and part-id material); edit `packages/engine/src/client/snapshot/object-pool.ts`; `packages/engine/test/avatar.player-body.spec.ts`.
- `tests/e2e/art-player.spec.ts` (`@art-player`, `@player-ledger`, `@xr @art-player`).
- Data (not counted): `assets/prefabs/{player.default, ped.actor}.json`, `config/art-placeholders.json` (`capsule` row), the ledger, BD rows.
- ≈ 6 code files. No new script, dependency, asset or genAI spend.

## Interfaces
- C05 1.1 `PlayerAvatar` and C11 1.0 `AppearanceV1` read only; C04 1.1 `bay_rig_v1` unchanged; C06 1.1 `render.asset` values only.
- `player-body.ts` and the bridge fields are engine internals. Contract change proposals: none.

## Acceptance criteria
- AC-1 Given the branch When install, typecheck, lint, unit tests and build run Then all exit 0 — proof: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm check:unit && pnpm build`
- AC-2 Given the registry and prefabs When the art tests and asset gates run Then the `capsule` row has a non-empty `replacedBy` whose refs exist in the catalog, and no `player.default` or `ped.actor` `render.asset` matches `^[a-z_]+/graybox\.` — proof: `pnpm check:unit -- tools/assets && pnpm assets:catalog && pnpm check:assets && pnpm provenance:check`
- AC-3 Given a mock asset client and a fixture `PlayerAvatar` When the player-body test runs Then the on-foot player is one `SkinnedMesh` with one material on every profile, uses `lo` parts on `mobile-low`, draws `fallbackPart` for a part without `model` and the mannequin on a failed load, `ped.actor` draws the ped kit, and state hashes are unchanged — proof: `pnpm check:unit -- packages/engine && pnpm --filter @dv/engine test:determinism`
- AC-4 Given a `synth` QA build When `@art-player` walks the default avatar and one realistic avatar at `?tier=desktop` and `?tier=mobile-low` on both engines and the `@xr @art-player` case runs Then `observe()` lists no `prop/graybox.capsule`, the player reports one render object, standing on a sidewalk and on the road at `curb-corner` the player's feet are within 0.05 m of the surface under them (M02h2 AC-5's bound), the player's mixer reports an active clip for idle and walk (no bind pose), and XR uses `lo` parts — proof: `pnpm map:build -- --area synth && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @art-player && DV_WORLD=synth pnpm check:e2e -- --project=webkit-webgl2 --grep @art-player && DV_WORLD=synth pnpm check:e2e:xr`
- AC-5 Given the committed ledger When `@player-ledger` and every perf scenario run in fail mode Then each profile adds 0 objects, `mobile-low` stays ≤ 100, `baseline` equals the `after` named in `baselineFrom`, and every tier is in budget — proof: `DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @player-ledger && DV_WORLD=synth pnpm check:perf -- --fail`

## Test plan
- **Unit:** `avatar.player-body`, engine determinism, the registry case in `tools/assets`.
- **E2E:** `@art-player` on `chromium-webgl2` and `webkit-webgl2`, `@player-ledger` on `chromium-webgl2` only, `@xr @art-player` on `xr-quest3`; all in the `DV_WORLD=synth` half, none matching `GRAYBOX_GREP`. M10d4 and M04b2 tags stay green.
- **Perf:** AC-5.

## Demo script
1. `pnpm map:build -- --area synth && DV_WORLD=synth pnpm dev`, open `/?debug=1&tier=desktop`.
2. New Game with Coast's defaults, then walk out: the on-foot body is the creator's, not the capsule.
3. Start m.a1.01: the mission actors wear ped-kit bodies.
4. Reload with `&tier=mobile-low`: the same bodies at `lo`.

## Effort
0.4 Builder session; ≈ 6 code files; risk **low-medium** (the part merge, skinning on `lo`). Order: player body, pool, prefabs, ledger, e2e.

## Risks & fallbacks
- **A part fails to load:** the mannequin draws for that entity; the report names the part.
- **Coast not modelled yet (M10a2 SKIP or not merged):** the realistic default body; nothing changes here when M10a2's models arrive.
- **`mobile-low` over budget:** `lo` parts only, then the mannequin on `mobile-low` (data, BD row); never raise a budget.

## Notes for the Builder
- Read first: `05-assets-pipeline.md` §3, §4; `10-ui-pages.md` §2.8 rules 3, 6; the M10d4, M10d3 and M10a2 files; `_PLAN-3.md` Look program.
- Never use photos, scans or the target image as input; no fal call.
- Secrets: none. Branch `m10d5-art-integration`.
