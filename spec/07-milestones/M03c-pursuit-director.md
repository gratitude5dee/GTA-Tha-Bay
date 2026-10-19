# M03c — pursuit-director

## Goal
After this session the open world has a wanted system. S01's `PursuitDirector` turns witnessed infractions into heat points and levels 0–5 (6 only when scripted). It dispatches police cruisers, SUVs and a helicopter on A* routes over the C08 road graph. The units run vehicular tactics: follow, siren, loudspeaker, PIT, box-in, rolling block, 2-car and heavy roadblocks on the predicted route, spike strips at choke points, the helicopter spotlight with line of sight, SUV ram, and portal seal at heat 5. The director runs the search circle, cooldown and hiding spots, applies the bust rule with fines and impound strikes, and tracks per-vehicle heat with respray. Values come from a schema-validated `config/pursuit.json`. Racing's `config/pursuit.race.json` can later replace them through `PursuitProfile.configRef`. QA builds get sandbox heat toggles. There are no firearms and no on-foot shooting (D-30).

## Requirements
- R-MODE-01: the main story's wanted system: heat, police response, escape and bust.
- R-MODE-02: the same director drives racing pursuits (M07a2) through `setProfile({kind: 'race'})`, `configRef` and `setRouteHint`. This milestone provides the API and the story defaults.
- R-ENG-01: the pursuit gates are deterministic commands (`test:pursuit` for the director; `pnpm check:unit -- packages/world/test/pursuit` for the bake-backed escape, DL-692).

## Depends on
- **M03a1** (vehicles-interaction-prefabs): vehicle system and `stepHandling`, prefabs `police.{cruiser,suv,heli}`, `prop.{barrier,spikestrip}`, the lines recorder, ragdoll-lite.
- **M03b1** (traffic-robotaxis): `world.witness` events, the ambient pull-over reaction, `TrafficControl` use by agents.
- Through those: M02c1 (`RoadGraphService.route`, `WorldQuery`), M02a2 (chunk tags `hidingSpots`, `pursuitBreakers`, `chokePoints`, portals).
- If M03b2 has already landed, its ped witnesses feed the director too; the director accepts any witness kind.
- Contracts: C06 1.1.0 (`PursuitApi`, `PursuitProfile`, `HeatState`, `PursuitConfig` in `engine-pursuit.ts`), C01 1.0.0, C02 1.1.0, C08 1.0.0.

## Scope in
- `packages/shared/src/contracts/engine-pursuit.ts`: copied verbatim from `01-engine-save-modes.md` "PursuitDirector core", including the 1.1 members `PursuitProfile.configRef?` and `PursuitApi.setRouteHint`.
- `config/pursuit.json` with the default values of that section, and its JSON Schema `packages/shared/schemas/pursuit.schema.json` (also valid for S06's later `pursuit.race.json`). The config hot-reloads in QA builds.
- Director (`packages/engine/src/sim/pursuit/`), all rules (1)–(7):
  - it runs in `SimStage.AI` at 30 Hz;
  - points to level, decay and the level cap;
  - infraction points from `infractionPoints` (evasion per 10 s);
  - witness delays (police immediate, robotaxi 2 s, ped 3–6 s from M03b1/M03b2 events);
  - LOS checks batched round-robin at `losChecksPerTick` (16).
- Search, as an implementation rule because the spec is silent; record it as a Builder decision. When LOS has been lost for `losLostSec` (2 s), a circle opens at the last known position. It grows at `growMps` (5 m/s) up to the level's `searchRadiusM`. Cooldown fills only while the player is outside the circle and unseen, over `cooldownSec`, and twice as fast in a hiding spot. A sighting returns to `pursuit`. A completed cooldown clears heat (phase `clear`).
- Dispatcher:
  - units ≤ `maxUnits` per level (`suv`, `heli` flags);
  - spawn on road lanes ≥ 120 m from the player and out of view;
  - routes by A* with a re-plan every 2.5 s;
  - ambient agents within 40 m pull over for sirens (M03b1 reaction);
  - units despawn when unseen beyond 1.25 × the search radius after a clear.
- Tactics per level from the config: follow, siren, loudspeaker (audio cue only), PIT, box-in, rolling block, `roadblock2`, `roadblockHeavy` (on the predicted route, or on `setRouteHint` edges when set), `spikes` at C08 `chokePoints` (`prop.spikestrip`; a crossed tire gets health 0, grip × 0.4 through the vehicle damage state), `heliSpotlight` (LOS from altitude), `suvRam`, `portalSeal` at heat 5 (`sealedPortals`; the director sets each portal's state through M02c1's `WorldBoundsPort.setPortalState(id, 'sealed', 'pursuit')` and releases it on clear, DL-691).
- Bust (bust block of the config): speed < 2 m/s with ≥ 2 units within 8 m for 3 s (on foot, grappled 2 s). Then:
  - the fine is `max(minCents, cashPct × cash + heat × perHeatCents)`;
  - the impound strike count rises; at 3 strikes the vehicle is impounded;
  - SimEvent `pursuit.busted {n: fineCents}`.

  Cash is read from a `WalletPort`. The fine is applied there; until M04a2 binds `EconomyApi`, the port is an in-memory test wallet.
- `vehicleHeat(key)` per vehicle instance and `respray(key)` resets vehicle heat but not player heat (rule 4). `capHeat`, `clear`, and `setHeat(6)` allowed only with `scripted: true` (rule 6).
- `spawnNamedUnit(prefabId, key)` for scripted chases (S03 uses it from M05c1).
- QA sandbox toggles (QA builds only): `__dvBridge.engine.pursuit.{setHeat, clear, state}` and debug-panel buttons "heat 0–5" and "never wanted". These are written to the `SandboxSlice.toggles` path `sandbox.player.neverWanted` once M04a1 saves exist; until then they are memory-only.
- HUD feed: heat level, phase and cooldown in the C02 snapshot side block (as `10-ui.md` §3.3 states; heat is not a patch). The visual `HeatStars` widget arrives in M04b2.

## Scope out
- Racing pursuit values (`config/pursuit.race.json`), bounty and race rules C.11: M07a2 (S06).
- Story wallet, story heat persistence (`StorySlice.heat`), and the fine actually leaving the player's cash: M04a1/M04a2 bind the ports; the story applies them in M05c1.
- `HeatStars` HUD widget and the sandbox phone menu: M04b2.
- On-foot police melee beyond the grapple bust: M05c1 with `CombatApi`.
- Multiplayer pursuit authority: M12b2.

## Deliverables
- `packages/shared/src/contracts/engine-pursuit.ts`; `packages/shared/schemas/pursuit.schema.json`; `config/pursuit.json`.
- `packages/engine/src/sim/pursuit/{director.ts, heat.ts, search.ts, dispatch.ts, tactics/{follow.ts, pit.ts, boxin.ts, roadblock.ts, spikes.ts, heli.ts}, bust.ts, vehicle-heat.ts, ports.ts, index.ts}`.
- `packages/engine/src/debug/pursuit-panel.ts` (QA only); bridge additions in the M01c `probe.ts` pattern.
- `packages/engine/test/pursuit/{config.spec.ts, heat.spec.ts, search.spec.ts, dispatch.spec.ts, tactics.spec.ts, bust.spec.ts, vehicle-heat.spec.ts}` (world-free: the director runs on a fake `WorldApi` port). The suites that need the `synth` bake live in `@dv/world`, which may import `@dv/engine` (the reverse would be a workspace cycle; DL-692): `packages/world/test/pursuit/{bot.escape.spec.ts, determinism.spec.ts, pursuit-escape.line.json}` and `packages/world/test/golden/pursuit-escape.json`, set up through `createWorldApi` and the engine sim-module hook as the worker does, skipping without a bake via M02a1's `tests/support/require-bake.ts`.
- `packages/engine/package.json` script **`test:pursuit`** (`tsx ../../tools/ci/run.ts vitest run packages/engine/test/pursuit`, as M01a1's `test:*`), also run by `pnpm check:unit`.
- `tests/e2e/engine/pursuit.spec.ts` (`@pursuit`).
- About 32 files.

## Interfaces
- C06 1.1: `engine-pursuit.ts` is created verbatim, with no shape change. `PursuitApi` becomes a `ModeContext` member when M04a2 assembles the context; until then the director is an engine service reachable from sim systems and the QA bridge.
- C08 1.0: `RoadGraph` routes, chunk tags, portals; consumed verbatim.
- Engine-internal: `WalletPort`, `VehicleDamagePort`, SimEvents `pursuit.level`, `pursuit.busted`, `pursuit.escaped`.

## Acceptance criteria
- AC-1 Given `config/pursuit.json` When the director loads it Then it validates against `pursuit.schema.json` and equals the design table (points 0/100/300/700/1,500/3,000; search radius —/150/250/400/600/900 m; cooldown —/10/20/35/50/75 s). A config with a missing level or a negative value is rejected with its JSON path — proof: `pnpm --filter @dv/engine test:pursuit`
- AC-2 Given scripted reports When a red light (police witness), a civilian hit (robotaxi witness) and a speeding second in sight occur Then the points equal the config values, the robotaxi report lands 2 s (120 ticks) after the event, the level follows the thresholds, and `setHeat(6)` without `scripted: true` is refused — proof: `pnpm --filter @dv/engine test:pursuit`
- AC-3 Given heat 3 and lost LOS When ticks advance Then the search circle opens after 2 s at the last known position and grows at 5 m/s to 400 m. Cooldown fills only while the player is outside the circle and unseen (twice as fast in a hiding spot), and a completed cooldown sets phase `clear` and level 0 — proof: `pnpm --filter @dv/engine test:pursuit`
- AC-4 Given each level When dispatch runs Then active units never exceed `maxUnits` (SUVs and the helicopter only where the level allows), every spawn is ≥ 120 m from the player and out of view, routes re-plan at most every 2.5 s, and at heat 5 every portal is in `sealedPortals` — proof: `pnpm --filter @dv/engine test:pursuit`
- AC-5 Given a roadblock level with `setRouteHint` set to an edge list When a roadblock is placed Then it lies on a hinted edge ahead of the player. Without a hint it lies on the predicted A* route. Spikes appear only at `chokePoints` tags, and a crossed tire's health becomes 0 — proof: `pnpm --filter @dv/engine test:pursuit`
- AC-6 Given a stopped player car with 2 units within 8 m When 3 s (180 ticks) pass Then phase becomes `busted`, the `WalletPort` is debited `max(25,000, 5 % cash + heat × 50,000)` cents once, the vehicle's impound strikes rise by one, and a third strike impounds it — proof: `pnpm --filter @dv/engine test:pursuit`
- AC-7 Given vehicle A with heat When the player resprays A Then `vehicleHeat(A)` is 0 while player heat is unchanged. Switching to vehicle B leaves A's heat stored — proof: `pnpm --filter @dv/engine test:pursuit`
- AC-8 Given the `synth` bake and line `pursuit-escape` When the scripted bot commits infractions to heat 3, breaks LOS and drives out of the search circle Then it escapes through cooldown to level 0 within the line's duration, and two runs give identical hashes equal to `pursuit-escape.json`, drawn only from streams `pursuit` and `police` — proof: `pnpm map:build -- --area synth && DV_REQUIRE_BAKE=1 pnpm check:unit -- packages/world/test/pursuit`
- AC-9 Given a `DV_WORLD=synth` QA build When the e2e calls `__dvBridge.engine.pursuit.setHeat(2)` Then at least one cruiser spawns out of view and follows within 60 s, the snapshot side block reports level 2, and `clear()` despawns the units once unseen — proof: `DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @pursuit`
- AC-10 Given the branch When the gates, dist verifier and preview deploy run Then all pass, and the production `dist/` has no pursuit debug panel — proof: `pnpm lint && pnpm typecheck && pnpm check:unit && pnpm build && pnpm --filter @dv/web verify:dist && pnpm deploy:preview`

## Test plan
- **Unit** (`pnpm --filter @dv/engine test:pursuit`, also under `pnpm check:unit`): `engine/pursuit.config`, `pursuit.heat`, `pursuit.search`, `pursuit.dispatch`, `pursuit.tactics`, `pursuit.bust`, `pursuit.vehicleHeat`; `world/pursuit.bot.escape` and `world/pursuit.determinism` on the `synth` bake (`pnpm check:unit -- packages/world/test/pursuit`, DL-692).
- **E2E:** `@pursuit` on `chromium-webgl2`.
- Cross-browser equality of pursuit runs is covered by M07a1/M07a2's `@racing-det` (race pursuit). This milestone adds no new det tag.

## Demo script
1. `pnpm map:build -- --area synth && DV_WORLD=synth pnpm dev`, open the debug panel, press "heat 2": sirens and a cruiser approach from out of view.
2. Drive away and break line of sight: the HUD debug line shows `search`, then `cooldown`, then `clear`.
3. Press "heat 4": spike strips appear at a choke point ahead, and the helicopter sweeps.
4. Stop next to two cruisers: busted, and the debug log shows the fine and the strike.
5. `pnpm check:unit -- packages/world/test/pursuit`: the bot escape test prints its final hash.

## Effort
1 Builder session; about 32 files; risk **medium**. Tactics behaviour is the largest part. Keep each tactic a small steering target on top of `stepHandling` inputs; police drive through the same vehicle system as the player.

## Risks & fallbacks
- **The bot cannot escape at heat 3.** The line may end in a `hidingSpots` tag of the `synth` bake (cooldown × 2). If the bake has none on the route, re-author the line rather than changing the config values, and record it.
- **A* cost with many units.** Cap re-plans at one unit per AI tick in round-robin. The 2.5 s rule is an upper bound.
- **Police physics instability in PIT and ram.** The tactic outputs are inputs to `stepHandling`, never direct impulses. If a contact explodes, reduce the target speed for that tactic and record it.

## Notes for the Builder
- Read first: `01-engine-save-modes.md` "PursuitDirector core" and its 1.1 additions; `06-racing.md` §2.6 and `06-racing-content.md` C.11 (to see what racing will override, not to implement it); `02-world-living.md` §2.4 and §3.5 (reactions, robotaxi witness); `01-engine.md` §8 (M03c row) and §9 test 13.
- Facts: none external (spec/03 §6 row M03c). Structure follows the documented NFS Most Wanted pattern only as design inspiration [research/gamedesign-decomposition.md §2.8]. Use no names, tactics labels or data from any other game.
- Order of work: contract file and schema, heat and points, witness intake, search and cooldown, dispatch, tactics (follow, roadblock, spikes first), bust, vehicle heat, bot line and golden, QA panel, e2e.
- Determinism: only streams `pursuit` and `police`; ray batches in a fixed order; the director lives under the C02 lint. `pursuit-escape.json` follows M03b1's golden rule (it stores its source `bakeId`; a changed synth `bakeId` fails with the regenerate message; regenerate only with `DV_UPDATE_GOLDEN=1` outside CI under `golden-update`; DL-657). It also runs under M03b1's residency rule: every `p0` within `R_amb` plus one ring around the line's start is preloaded and pinned before tick 0, and no tick advances while a requested `p0` is pending (DL-678).
- The director reaches the road graph and chunk tags only through the `WorldApi` that M02c1 registers through the engine sim-module hook. `@dv/engine` source and tests never import `@dv/world` (not even as a dev dependency: `@dv/world` depends on `@dv/engine`, so that would be a workspace cycle; DL-692). Engine suites use a fake `WorldApi` port; the bake-backed suites are in `packages/world/test/pursuit/`.
- The `WalletPort` and `VehicleDamagePort` keep this milestone independent of saves and the economy. M04a2 binds them.
- Secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` for `deploy:preview` (SKIP locally). No genAI spend, no owner gate.
