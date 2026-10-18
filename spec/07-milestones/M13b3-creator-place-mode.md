# M13b3 — creator-place-mode

## Goal
Players without a coding agent can build a data-tier experience inside the game (flow E, DL-153). In a `sandbox` session the player opens **Create**, which anchors an experience at their position. They place, move, rotate and delete allowlisted props, ambient pedestrians, parked vehicles, markers and signs, up to 512 scene ops inside a 10–250 m radius, and see each change live through M13a3's `ModHost` preview path. Drafts survive reloads. **Pack** builds a `dv-mod/1` archive in the browser with the same shared packer and validator as `dv mod pack`/`dv mod check`. The archive installs locally and plays as a sandbox preview. **Publish** hands off in two ways: export a `dv` workspace for `dv mod publish`, or use the in-browser publish client (route 34 then route 36 with the player's P2 JWT), which goes live when M13c2's server route exists.

## Requirements
- R-MOD-02: the in-game creator is the publishing path for players with no agent and no ChatGPT plan (flow E, `12-modding-publish.md` C§2).
- R-MOD-04: what the creator makes is an `experience` mod that M13c2 can place on the map.

## Depends on
- **M13a3**: `ModHost` (load, `unloadAll`, `modsActive`), scene-op executor, `ExperienceMode`, sandbox preview of an experience mod, mod saves, `@mods-exp` e2e.
- **M04b2**: creator/phone/HUD kit, `GameModeUI` host, touch layouts, `UiSurface`.
- Contracts: C14 1.0.0 (`ModManifest`, `SceneOp`, `ModScene`, `ExperienceAuthored`, `PublishAttestation`, `ModCheckResult`), C17 1.0.0 (`ExperienceEntryRules`), C06 1.1.0 (`ModeContext`, `PrefabService`, `ModeContext.world`), C05 1.1.0 (sandbox session writes), C03 1.1.0 (input contexts), C12 1.1.0 (routes 34, 36 as client).

## Scope in
- `packages/engine/src/client/mods/creator/`:
  - `draft.ts`: the `CreatorDraft` document (`schema: 'dv-creator-draft/1'`, `id`, `modId`, `anchor {lat, lng}`, `radius`, `entry`, `start`, `title`, `summary`, `tags`, `ops: SceneOp[]`, `rev`). It is stored in IndexedDB `dv-creator` (store `drafts`; every access in try/catch with an in-memory fallback). This is a new, prefixed, device-local store and not part of C14's `dv-mods`.
  - `editor.ts` (pure core): add, move, rotate (yaw), scale (clamped 0.5–2), delete, undo and redo (≤ 50 steps). Every op must lie inside `radius` in the anchor frame (+X east, +Y up, −Z north, metres from the anchor on the ground). The 513th op is refused with `cap.ops`. Radius is clamped to 10–250. `sign` text goes into the mod's string table, with resolved text ≤ 40 characters.
  - `palette.ts`: the allowlist from `12-modding-contracts.md` B§4. It covers first-party `PrefabDef` ids of kinds `prop`, `ped` (`ped.ambient.*`), `vehicle` (`vehicle.*`, `robotaxi.default`, always `parked: true` here), `pickup` and `marker`. It never offers `police.*`, `portal.*` or `player.*`, and it adds no new assets.
  - `placement.ts`: the cursor ray hits the ground through `ModeContext.world` (C08 query) and snaps to ground height. Positions convert to the anchor frame.
  - `preview.ts`: on each change (debounced 250 ms) the draft becomes an in-memory data-tier mod, and `ModHost` reloads it in the current sandbox session under every sandbox rule.
  - `pack.ts`: draft → source workspace files (`mod/mod.json`, `mod/data/experience.json` as `dv-exp/1`, `mod/data/scene.json` as `dv-scene/1`, `strings`) → M13a1's shared packer and `check`. Permissions are the minimum the shared validator derives for the ops used. `compat.api` is the caret range of the running `MODAPI_VERSION`.
  - `handoff.ts`:
    - `exportWorkspace()` downloads a ZIP of the `dv init` layout with the mod files filled in, so `dv mod publish` works from it.
    - `BrowserPublish.publish(archive, attestation)` sends `POST /ugc/uploads {purpose: 'mod_archive'}`, PUTs to the presigned URL, then `POST /mods/:id/versions` with `Idempotency-Key`. It needs tier `linked` and bracket `18p`. Without them it shows the `/link` CTA. A `not_found` or `feature_disabled` from route 36 shows "Publishing opens soon".
  - `ui/`: creator panel on the `@dv/ui` kit. It holds the palette, a selected-entity inspector, op counter "n / 512", radius ring, start marker, Undo/Redo, Pack, Play preview, Export and Publish. It works with keyboard and mouse, gamepad and touch. In XR it shows the flat-only exit panel (DN-S10-04).
- Entry: the sandbox pause menu and the phone gain **Create**. In a `story` session or a room session the entry is disabled with a reason string, because mods never run in Story or rooms (`12-modding.md` §2.4).
- Publish attestation dialog: the human ticks the C14 `ModDeclarations` and confirms, which records `PublishAttestation {confirmedAt, declarations, liveHuman: true}`.
- Strings in `packages/ui` locale catalogs (`creator.place.*`); `check:i18n` stays clean for `en`.

## Scope out
- Server publishing (scan, moderation, routes 36/37 POST) → M13c2. `dv login` and `dv mod publish` → M13c3.
- Script and UI tiers, custom assets, thumbnails, NPC cameos and mission IR in the creator: v1 is data-tier ops only.
- Placing a published version on the map (route 37 POST) → M13c2.
- An AI assistant in the creator: a later flag (C§2 flow E).

## Deliverables
- `packages/engine/src/client/mods/creator/{draft,editor,palette,placement,preview,pack,handoff,index}.ts`, `packages/ui/src/mods/creator/{CreatorPanel,Palette,Inspector,AttestDialog}.tsx` (A-01 layout has no `packages/engine/src/client/mods/creator`; DL-220).
- Tests: `packages/engine/src/client/mods/creator/{editor,pack,handoff,palette}.test.ts`; `packages/shared/src/mod/check/scene-ops-caps.test.ts` (if M13a1 has not created it); `tests/e2e/mods-creator.spec.ts` (`@mods-creator`); fixtures under `tests/fixtures/creator/`.
- Edits: sandbox pause menu and phone app list (`packages/ui`), locale catalog `en`, QA bridge commands `creator.open`, `creator.placeAt(prefab, x, z)`, `creator.pack` (QA builds only).
- Secrets: none.

## Interfaces
- C14 1.0: the creator writes `ModManifest`, `dv-exp/1` and `dv-scene/1` exactly as typed and validates with the shared `check`. `PublishAttestation` is recorded as typed. No shape change.
- C17 1.0: `ExperienceEntryRules` fields (`entry`, `start`) come from the draft. The anchor is not in the archive (C§4).
- C06 1.1: the creator calls `ModeContext` only through M13a3's host. C05 1.1: no new slot; drafts are device-local in `dv-creator`.
- C12 1.1: client use of routes 34 and 36 as tabled (C12 1.1 lets route 36 accept a P2 browser JWT).
- Engine-internal (not contracts): `CreatorDraft`, `PublishHandoff`.

## Acceptance criteria
- AC-1 Given a draft with 512 ops When a 513th op is added in the editor core, and a 513-op scene is checked by the shared validator Then the editor refuses it with `cap.ops` and leaves the draft unchanged, and the validator reports `cap.ops` — proof: `pnpm check:unit -- packages/shared/src/mod packages/engine/src/client/mods/creator`
- AC-2 Given a 50 m radius When a prop is placed 50.5 m from the anchor and the radius is set to 300 and then to 5 Then the placement is refused, and the radius becomes 250 and then 10 — proof: `pnpm check:unit -- packages/engine/src/client/mods/creator`
- AC-3 Given the committed fixture draft When `pack.ts` builds its archive in Node and the same workspace files are packed by M13a1's CLI packer Then both archives have one SHA-256, the shared `check` returns `ok: true` with no `perm.*` finding, and the manifest's `kind` is `experience` with `tier` `data` — proof: `pnpm check:unit -- packages/engine/src/client/mods/creator`
- AC-4 Given the palette built from the fixture prefab registry When it is listed Then no entry starts with `police.`, `portal.` or `player.`, and every vehicle op it creates has `parked: true` — proof: `pnpm check:unit -- packages/engine/src/client/mods/creator`
- AC-5 Given a QA build in a sandbox session on the graybox fixture When the test opens Create, places three props and a start marker, packs, installs locally and plays the preview Then `__dvBridge` reports three prop entities within 0.05 m of their draft positions converted to world ENU, `modsActive()` is true during the preview and false after exit, and after a page reload the draft lists the same four ops — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @mods-creator`
- AC-6 Given the iPhone-sized touch viewport When a prop is placed by tapping the ground and rotated with the inspector's touch control Then the op count is 1 and the yaw changed — proof: `pnpm check:e2e -- --project=webkit-webgl2 --grep @mods-creator`
- AC-7 Given a story session When the pause menu opens Then Create is visible, disabled, and shows its reason string — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @mods-creator`
- AC-8 Given mocked fetch When `BrowserPublish.publish` runs for a `device`-tier identity, for a `linked` `18p` identity, and for a `linked` identity whose route 36 answers `feature_disabled` Then the first shows the link CTA without a request, the second sends upload (`purpose: 'mod_archive'`), PUT and route 36 with an `Idempotency-Key` and `attestation.liveHuman = true` in that order, and the third shows "Publishing opens soon" — proof: `pnpm check:unit -- packages/engine/src/client/mods/creator`
- AC-9 Given M13a3's experience fixture When its e2e runs Then it still passes — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @mods-exp`
- AC-10 Given this branch's PR When the Preview deploys Then the smoke check passes and Create opens in a sandbox session — proof: manual: desktop browser, open the Preview URL, start Sandbox, open Pause › Create; then `pnpm check:smoke -- <preview-url>`

## Test plan
- Unit: `creator/editor` (caps, radius, undo, sign length), `creator/pack` (parity with the CLI packer, minimal permissions), `creator/palette`, `creator/handoff` (mocked fetch); `shared/mod.scene-ops-caps`; `pnpm check:unit -- packages/shared/src/mod packages/engine/src/client/mods/creator`.
- E2E: `@mods-creator` on `chromium-webgl2` and `webkit-webgl2`; regression `@mods-exp`; `pnpm check:e2e -- --project=chromium-webgl2 --grep @mods-creator`.
- Static: `pnpm check:i18n`, `pnpm lint`, `pnpm typecheck`.
- Deployed: Preview smoke (AC-10).

## Demo script
1. `pnpm dev`, start Sandbox, walk to an open street.
2. Pause › Create; set radius 60 m; place two benches, a parked car and a start marker.
3. Watch the counter read 4 / 512; undo once, redo once.
4. Pack; read the archive SHA-256 and the "check passed" line.
5. Play preview: the scene appears; exit returns to Sandbox.
6. Export workspace; unzip it; `dv mod check` in that folder passes.

## Effort
1 session; ≈ 30 files; risk **medium**. Placement against `ModeContext.world` and keeping the live preview cheap are the uncertain parts.

## Risks & fallbacks
- **Live reload costs too much on `mobile-low`** (frame over 50 ms on reload): reload only the changed op through the scene-op executor's add/remove path if M13a3 exposes one. Otherwise raise the debounce to 1 s on `mobile-low`, and log a Builder decision.
- **Shared packer is Node-only** (uses `Buffer` or `fs`): move the IO edge into the CLI and keep the packer pure over `Uint8Array`. This is a fix inside M13a1's module, which must not change its output bytes (`pack-deterministic` must stay green).
- **Ground query misses on steep chunks**: snap to the nearest graph-node height within 5 m. If there is none, refuse the placement with a message.

## Notes for the Builder
- Read first: `12-modding.md` §2 (principles, tiers, where mods run), §5.3; `12-modding-contracts.md` B§1, B§4, B§7; `12-modding-publish.md` C§1.1 (workspace layout), C§2 flow E, C§3 steps 1–5; `10-ui-pages.md` §2.12.
- Nothing here talks to the network except `BrowserPublish`. The creator must work offline.
- The archive SHA-256 is the publish key, so the browser and CLI packers must agree byte for byte.
- Branch `m13b3-creator-place-mode`.
