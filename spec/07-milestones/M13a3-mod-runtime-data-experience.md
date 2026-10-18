# M13a3 — mod-runtime-data-experience

## Goal
Installed data-tier mods run, and published experiences appear on the map and can be entered. When this milestone is done the repository has:
- `ModHost` in `sim.worker`: grants, a command broker with quotas, a scene-op executor, ECS host shims 2048–2050 and mod saves in `mod:<id>`;
- `ExperienceMode`, the `exp:<id>` top-level mode with the Story switch at a safe point and no rewards;
- a real `modsActive()`, sent as `AssignReq.modsActive` and suspended on room join, so a room refuses mods with close 4007;
- `ExperienceIndex`, which feeds experience blips to the map and spawns in-world markers from route 37 GET, plus the marker card and its **Enter** button;
- the `mod-scene-budget` perf scenario.

Script and UI tiers stay refused until M13a4 and M13a5. Vehicle mods stay refused until the M13a7 envelope check.

## Requirements
- R-MOD-04: published experiences show as map markers and load in a sandbox (`exp:<id>`) that cannot touch Story, the economy or unlocks.
- R-MOD-01: the runtime the SDK targets; permissions are enforced at run time, not only at validation.

## Depends on
- **M13a2**: registry, installer, `canLoad`, mod `AssetSource`, migration 0007.
- **M02c2**: in-engine map and minimap, C08 `MapApi.setBlip` (`BlipKind 'experience'`), phone Map app.
- **M12b1**: rooms Worker, room client, `AssignReq`, close codes. The M12c1 refusal hook is also in place (run order).
- Contracts: C14 1.0 (`ModHost`, `ModSessionInfo`, `LoadedMod`, `ModFault`, `ModErrorCode`), C17 1.0, C06 1.1 (`GameModeId` `exp:${string}`, `InteractKind.Experience`, C06 rule 3 Story↔experience switch, `PrefabService`, `ZoneService`, `MapApi` via `ModeContext.world`), C05 1.1 (`mod:<ModId>` slot; an `exp:` session writes only its own slot; reason `modeExit`), C01 1.0 (mod range 2048–4095), C11 1.0 (close 4007), C12 1.1 (route 37 GET), C08 1.0 (`chunkKeyOf`, resolver lat/lng→ENU, ground query), C16 1.1 (`mod.session`, `exp.enter`, `exp.exit`).

## Scope in
- **`ModHost`** (`packages/engine/src/sim/mods/host.ts`, sim code: C02 lint applies):
  - `load(session, mods)` refuses, in order:
    - Story or anything embedded in it → `load.story`;
    - a room session (`net !== null`) → `load.room`;
    - `mods.enabled` false → `load.flag_off`;
    - tier `script` or `ui` while M13a4/M13a5 are absent or their flag is off → `load.flag_off`;
    - kind `vehicle` until M13a7 → `load.flag_off`;
    - a tier outside `tiersOk` → `install.tier_unsupported`;
    - `canLoad` false → `install.revoked`.
  - `modsActive()`; `unloadAll(reason)` despawns every `ModOwned` entity and flushes saves; `onFault`. Sandbox loads enabled `character` mods and previews experiences. `exp:<id>` loads that experience's mod and its declared dependencies only; user-enabled rules mods are suspended.
- **Broker** (`broker.ts`): one validator for every mod command. It checks the grant against manifest `permissions` and narrows `ModContext` to granted namespaces, then:
  - clamps positions to the radius for `props`/`spawn`/`markers`;
  - applies the prefab allowlist of B§4 (never `police.*`, `portal.*`, `player.*`);
  - enforces quotas (spawns ≤ 8/s, audio ≤ 4/s, markers ≤ 16, zones ≤ 32) and the per-tier entity cap.
  - Rejected commands are counted and dropped with a coded log line. Accepted ones apply in `SimStage.Commands` of the next tick in arrival order.
- **Scene ops** (`scene.ts`): `prop`, `ped`, `vehicle` (first-party prefabs only), `marker`, `zone`, `sign` (string-table text ≤ 40 chars), `audio`, `mission`.
  - `mission` hands the IR to the M05a1 VM after validation with the C09 `mod` profile (DL-084), so economy, unlock, story-flag and mode ops are rejected.
  - Ops run through `PrefabService`/`ZoneService` with anchor-relative coordinates converted to world ENU (principle 7).
- **Host shims** (`components.ts`): 2048 `ModOwned {mod u16, serial u32, kind u8}` (`render`), 2049 `ModMarker {icon u8, label u32 str}` (`render`), 2050 `ModZoneRef {zone u32 str}` (`none`). None is `hashed`. Mod entities get `pfb:<prefabId>:<serial>` keys and are never persisted.
- **Mod saves** (`saves.ts`): `{kv, meta}` in `mod:<ModId>`. Canonical-JSON `kv` ≤ 1 MiB, ≤ 64 keys, value ≤ 64 KiB. Flush at session end and every 60 s when dirty (`modeExit` / `interval`). An over-cap write is rejected without touching any slot. `lastRunOk` is set on the registry after a fault-free session.
- **`ExperienceMode`** (`experience-mode.ts`), `GameModeSim` `exp:<experienceId>`:
  - `standalone: false`; `requires {world:'city', physics:true, xr:'seated', network:'none'}`.
  - `enter`: anchor lat/lng → ENU and ground height through C08; spawn the scene; teleport to `entryRules.start` unless already inside the radius.
  - Exit on `finish`, quit, leaving radius + 50 m for 10 s, fault, revocation, or room join. The exit flushes `mod:<id>`, despawns `ModOwned` and restores the previous mode.
  - `ModeResult` has no rewards.
  - From Story: `story:auto` is saved with `modeExit` at a safe point; the prompt is disabled with a reason during a mission or pursuit (C06 rule 3).
- **Rooms:** the room client sends `modsActive` from `ModHost`. The online page's `ModsActiveSource` (M12d) is wired to it. Joining while mods are loaded shows "Mods are off online"; on confirm it calls `unloadAll('room')` before `assign`.
- **Route 37 GET** (`services/edge/src/mods/experiences.ts`):
  - `chunk=<z/x/y>` comma list ≤ 9 keys, or `bbox`;
  - anonymous callers get only `moderation:'published' ∧ visibility:'public'`; an authenticated caller also gets their own placements with states;
  - returns `ExperienceCard`s; `ETag`; `GET /experiences/:id`.
- **`ExperienceIndex`** (`packages/engine/src/client/mods/experience-index.ts`):
  - requests the chunk keys in view, ≤ 9 per call, reusing ETags, cached 5 min per chunk;
  - publishes `MapBlip {kind:'experience'}`;
  - spawns ≤ 8 live `marker.experience` prefabs inside the streaming radius, each with `InteractKind.Experience` and prompt `prompt.exp.enter`.
- **Marker card** (`packages/ui/src/mods/ExperienceCard.tsx`): title, author, rating, content warnings, supported tiers, AI-assisted badge, `ReportButton`, and **Enter**. Enter runs the state machine of `12-modding.md` §5.3: Resolving → Gate → Installing (M13a2) → Switching → Loading → Running. In XR the card is a world-locked `XrPanel`.
- **Perf scenario** `mod-scene-budget` (`tests/perf/scenarios/mod-scene-budget.ts`, owned by S12): a fixture experience with 512 ops at each flat tier.
- **QA bridge** additions: `__dvBridge.mods.enterFixture(id)`, `modEntities()`, `session()`.
- **Flags:** `mods.enabled` is set true in staging `FLAGS_JSON` once the ACs pass; production stays false (flip in M14b3).

## Scope out
- QuickJS script runtime, `rules.*`, `storage` from scripts: M13a4. UI panels and `ui.hud`: M13a5. Vehicle registration and envelope: M13a7.
- Store and experiences pages: M13a7. Placement POST, publish, anchor validation, rebake revalidation: M13c2. Ratings after exit (route 40): M13b2.
- Mods in rooms: not v1 (06 §3).

## Deliverables
- `packages/engine/src/sim/mods/{host.ts, broker.ts, scene.ts, components.ts, saves.ts, experience-mode.ts, session.ts, index.ts}` and their tests under `packages/engine/src/sim/mods/test/` (`mods-active.spec.ts`, `loader-refusals.spec.ts`, `broker.spec.ts`, `scene-ops.spec.ts`, `mod-save-caps.spec.ts`, `experience-mode.spec.ts`).
- `packages/engine/src/client/mods/{experience-index.ts, enter-flow.ts}` and `test/experience-index.spec.ts`; room-client wiring in `packages/net` (the `modsActive` source) and a confirm dialog in `packages/ui/src/pages/online/`.
- `packages/ui/src/mods/ExperienceCard.tsx`; i18n keys `exp.*`, `prompt.exp.enter`, `mods.offline.*`.
- `services/edge/src/mods/experiences.ts`; `services/edge/test/experiences.test.ts`; `services/rooms/test/mods-4007.test.ts`.
- `tests/perf/scenarios/mod-scene-budget.ts`; `tests/e2e/mods-exp.spec.ts` (tags `@mods-exp`, `@mods-offline`); fixture experience `tests/fixtures/mods/cones/` (source workspace, packed in the test).
- `packages/shared/schemas/telemetry/{mod.session, exp.enter, exp.exit}.schema.json`.
- No new secrets or scripts.

## Interfaces
- C14 1.0 `ModHost`, broker grant narrowing per B§3 rules 1–5; C17 1.0 `ExperienceCard` read-only (server-owned moderation and visibility); C06 1.1 mode switch rule 3; C05 1.1 capability rule 3; C01 shims as B§5; C08 `MapApi`. Each is used exactly as defined.
- No contract change.

## Acceptance criteria
- AC-1 Given a sandbox session When no mod is loaded, a fixture data mod is loaded, and then `unloadAll('room')` runs Then `modsActive()` is false, true, false, and the `AssignReq` built by the room client carries the same value each time — proof: `pnpm check:unit -- packages/engine/src/sim/mods/test/mods-active`
- AC-2 Given the rooms Worker When a ticket's assign carries `modsActive: true` Then the socket closes with 4007; with `false` the join proceeds — proof: `pnpm check:workers -- mods-4007`
- AC-3 Given the refusal table (Story session, room session, `mods.enabled` false, script tier, ui tier, vehicle kind, tier not in `tiersOk`, revoked) When `load` runs for each Then it returns `load.story`, `load.room`, `load.flag_off` (×4), `install.tier_unsupported`, `install.revoked`, and spawns nothing — proof: `pnpm check:unit -- packages/engine/src/sim/mods/test/loader-refusals`
- AC-4 Given a fixture scene with a prop 400 m from a 100 m anchor, a `police.cruiser` ped op and 40 spawn ops in one tick When it runs Then the prop is placed on the radius edge, the police op is rejected with a coded log, at most 8 spawns apply per sim second, and every `ModOwned` entity lies within the radius — proof: `pnpm check:unit -- packages/engine/src/sim/mods/test/broker packages/engine/src/sim/mods/test/scene-ops`
- AC-5 Given a mod with a 1.1 MiB `kv` write When the host flushes Then the write is rejected with `cap.size`, and the bytes of `mod:<id>`, `core`, `story:auto` and `settings` are unchanged — proof: `pnpm check:unit -- packages/engine/src/sim/mods/test/mod-save-caps`
- AC-6 Given a running Story session (free roam) and the fixture experience installed When the player enters through the marker prompt, plays, and `finish('win')` fires Then `story:auto` is written with reason `modeExit` before `exp:<id>` starts, the player stands at `entryRules.start`, every mod entity is inside the radius, and after exit the Story mode resumes at the saved position with wallet cents and the `core` record byte-equal to before — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @mods-exp`
- AC-7 Given an active mission When the experience marker is in range Then the prompt is disabled with its reason key, and entering is impossible — proof: `pnpm check:unit -- packages/engine/src/sim/mods/test/experience-mode`
- AC-8 Given rows in `InMemoryDataPort` (published public, published unlisted, `needs_review`, the caller's own private) When route 37 GET is called anonymously, as the owner, and with 10 chunk keys Then anonymous sees only the published public card, the owner also sees their own placement with its state, and 10 keys answer 400 — proof: `pnpm check:workers -- experiences`
- AC-9 Given a camera view covering 14 chunk keys When `ExperienceIndex` refreshes twice within 5 min Then it sends two calls of ≤ 9 keys the first time and only `If-None-Match` revalidations or none the second time, publishes one `experience` blip per card, and keeps ≤ 8 live markers — proof: `pnpm check:unit -- packages/engine/src/client/mods/test/experience-index`
- AC-10 Given the 512-op fixture When the perf scenario runs for the four flat tiers Then each report's render objects stay within the tier budget and the mod's own count stays within its `config/mod-limits.json` row — proof: `pnpm check:perf -- --scenario mod-scene-budget --fail`
- AC-11 Given an installed fixture mod and `/api/v1/boot` failing When a sandbox session starts Then the mod still loads from the registry with the cached flags, and the store shows the offline state — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @mods-offline`
- AC-12 Given the production build When it is checked Then `mods.enabled` is false in production `FLAGS_JSON`, no `/_test/` route ships and no secret pattern is present — proof: `pnpm build && pnpm check:prod-routes && pnpm check:secrets -- apps/web/dist`

## Test plan
- **Unit:** the sim specs above plus `experience-index.spec.ts`. Commands: `pnpm check:unit -- packages/engine/src/sim/mods` and `pnpm check:unit -- packages/engine/src/client/mods`.
- **Workers:** `mods-4007` (rooms), `experiences` (edge).
- **E2E:** `@mods-exp`, `@mods-offline` on `chromium-webgl2`.
- **Perf:** `mod-scene-budget`.
- **Determinism:** `pnpm --filter @dv/engine test:determinism` stays green; mod sessions run the `local` profile and are never hashed.

## Demo script
1. `pnpm dev`; New Game; walk out of the first safehouse.
2. Console: `await __dvBridge.mods.installFixture('cones')`; open the phone Map; an experience blip appears.
3. Walk to the marker; press Interact; read the card; press Enter. The game saves, then the cones course spawns.
4. Finish the course; Story resumes where you left it; the wallet is unchanged.
5. Play online → "Mods are off online" → confirm; mods unload, then the join proceeds.

## Effort
1 session; ≈ 38 hand-written files. Risk medium: the mode switch touches ModeHost and the save path.

## Risks & fallbacks
- C08 ground height is not available for an anchor outside the resident chunks at entry: wait for the chunk through `WorldPackStore` with a 5 s timeout. On timeout, cancel the entry with a reason and keep Story untouched.
- Fixture rows on staging: no experience is published before M13c2, so the staging map shows none. CI proves the path with the in-memory port, and the demo uses the fixture.
- File budget: put the confirm dialog inside the existing online page; merge `session.ts` into `host.ts`.

## Notes for the Builder
- Read first: `12-modding.md` §2.1, §2.4, §5.3, §5.4, §5.5; `12-modding-contracts.md` B§3 (rules), B§4, B§5 (shims, save slot, session types), B§6; `12-modding-publish.md` C§4 (markers, entry); `01-engine-save-modes.md` C05/C06 1.1 rules 3; `02-world-contracts.md` (`MapApi`, `BlipKind`).
- Sim code under `packages/engine/src/sim/**` obeys the C02 bans. Mod sessions use the `local` profile.
- `_PLAN.md` names `packages/engine/src/client/mods/host` and `packages/modes/experience` as outputs. This file follows the S12 component table (`packages/engine/src/sim/mods/`), because `ModHost` runs in `sim.worker` and ADR-0001 has no `modes/experience` package.
- Branch `m13a3-mod-runtime-data-experience`.
