# M07b1 — racing-content-events-ladder

## Goal
After this session racing has its full v1 content. All ten race kinds have rules: the six still missing after M07a2 (checkpoint, speedtrap, hillclimb, drift, sideshow, robotaxiRush) plus the pursuit `survive` success. The event catalog holds all 20 SF events of `06-racing-content.md` C.5. The roadster's thruster hop and the robotaxi quirks (speed governor and jailbreak, auto-yield, stall at dark signals) are live. Race pursuits plan roadblocks on the predicted route and lay spike strips at choke points, with counterplay. Standalone progression works end to end: Rep levels, class unlocks, purse and medals, and the **Tha Bay 10** ladder of original rivals, which hands out the remaining garage cars.

## Requirements
- R-MODE-02: every race kind, police roadblocks and spike strips with heat levels, robotaxis and the rocket roadster on real SF streets.
- R-MAP-01: 20 events across ten districts are snapped to the baked graph and resolved by street-name hints that fail CI when unresolved.
- R-IP-01: all makes, models and rival handles are fictional placeholders that pass `names:lint` and `ip:strings`; rivals are `original` characters.
- R-MODE-05 (support): ladder, Rep and event unlocks persist in the save through `UnlockEventId`s.

## Depends on
- **M07a2** (AI drivers, par, replays, `RacingSlice`, `config/pursuit.race.json` v1, pursuit binder), **M03b2** (pedestrians and transit; transitively M03b1 traffic, robotaxis, blackout signal state and `quirks` use by ambient robotaxis).
- Contracts: C01 1.0, C06 1.1 (`PursuitApi`, `UnlockApi`), C07 1.1 (vehicle assets, `portrait` kind), C08 1.0 (tags `chokePoints`, `pursuitBreakers`, `hidingSpots`, `jumpZones`), C16 1.1.

## Scope in
- Race-kind rules (`06-racing-content.md` C.5 "Race-kind rules"): checkpoint (rolling start, tollbooth carry of leftover time, fail at 0), speedtrap (Σ integer kph at speed-cam gates, ties by time), hillclimb (time), drift (score = Σ angle × kph × 0.001 per tick × combo, +0.1 per second held up to ×5, wall hit halves the combo; `Drift` component 1026), sideshow (ring-zone score window, heat 2 at T+60 s, escape after the window, `xr: 'none'`), robotaxiRush (fare ticks down, −5 % per infraction, robotaxi witnesses), pursuit `survive`.
- 16 more events per C.5 with `source.json` and compiled `race.json`; street-name hints resolved against the bake.
- Quirks in `packages/shared/src/vehicle/quirks.ts` (pure; extend the file if M03b1 created it, keeping its exports): `thrusterHop` (Δvy 7.5 m/s, 2 charges, 6 s recharge, 0.4 s coyote, stabilising trim), `regenBraking`, `speedGovernor` with `item.jailbreak-kit`, `autoYield` (14 m, ≤ 0.7 g, contact damage × 0.5), `stallOnDarkSignal` (seeded 4–9 s on stream `racing.stall`, override after a 2 s held Interact). Ability button wired for the hop; `VehicleQuirk` component 1028.
- Race pursuits (`06-racing-content.md` C.11): `roadblock` and `spikes` blocks in `config/pursuit.race.json`; predicted-route planner (next 3 gates, armed 140 m ahead, re-plan every 2.5 s, gap 5.5/4.5/3.2 m at heat 3/4/5); authored `ScriptedBlock`s; spikes at C08 `chokePoints` only, telegraphed 90 m ahead by HUD prompt and scanner event, ≤ 2 (heat 4) or 3 (heat 5) per pursuit, 25 s apart; bounty (10 points/s at level, +500 per wrecked unit, × 10 cents); hiding spots fill the cooldown ×2; robotaxi witnesses report after 2 s (jailbroken: 1 s, +50 % points).
- Progression (`06-racing.md` §2.13, `06-racing-data.md` §4.4): Rep thresholds (20 levels) in `config/racing.json`, class unlocks at 3/7/11/15, purse by class and place, medals at par × 1.25/1.12/1.04, first-time medal bonus once.
- Ladder (C.6): `content/racing/ladder.json` with ten rivals (`rival.<handle>`, skill 0.30 → 0.95, difficulty offset), showdown events, reward cars, district unlocks, `unlock.racing.ladder.<n>`, `unlock.racing.robotaxi`, `unlock.racing.event.<raceId>`; rival barks as text lines with subtitles; portraits are authored silhouette cards (`portrait/rival.<handle>`, `origin: authored`).
- Remaining eight cars of C.1 (`ondine-nimbus`, `kestrel-finch`, `tidewater-neap`, `brackenridge-drayman`, `tidewater-spring`, `aurelian-meridian`, `aurelian-halberd`, `aurelian-apogee`): handling JSON, prefabs, gray-box assets with provenance.
- Ladder and event-list view-models published for S10's racing screens.

## Scope out
- Garage and upgrade purchase flow, replay director, photo mode, `desktop-ultra` look, audio wiring, econ-sim racing section, intro refs: M07b2.
- Generated rival portraits and voiced barks: no fal spend here (DL-OWN-01); voiced barks follow the M06a4 TTS path when the Architect schedules them.
- XR exclusions at runtime: M11b2 (the `xr` field is only validated here). Trademark knock-out of names: Q-23(a), before launch (M14b3).

## Deliverables
- `packages/modes/racing/src/sim/kinds/{checkpoint,speedtrap,hillclimb,drift,sideshow,robotaxi-rush,survive}.ts`; `src/sim/{progression.ts, ladder.ts, witness.ts}`; `src/sim/pursuit/{roadblock-planner.ts, spikes.ts, bounty.ts}`; `src/quirks/{hop.ts, robotaxi.ts}`.
- `packages/shared/src/vehicle/quirks.ts` (create or extend); `packages/shared/schemas/racing/ladder.schema.json`.
- `packages/modes/racing/test/{kinds.spec.ts, quirk.stall.spec.ts, quirk.govern.spec.ts, quirk.autoYield.spec.ts, pursuit.profile.spec.ts, progression.spec.ts, ladder.spec.ts}`.
- Engine lines `hop.roadblock` and `hop.apex` (line files plus golden).
- `content/races/<id>/{source.json, race.json}` for the 16 events; `content/racing/ladder.json`; `content/vehicles/handling/<slug>.json` and `assets/prefabs/vehicle.<slug>.json` for the eight cars; gray-box glTFs, rival silhouette portraits and their provenance records.
- `config/pursuit.race.json` (`roadblock`, `spikes` blocks), `config/racing.json` (`progression`), new rows in `config/unlocks.json`.
- `tests/e2e/racing-ladder.spec.ts` (`@racing-ladder`).

## Interfaces
- Uses C06 1.1 `PursuitApi` and `UnlockApi`, C08 1.0 chunk tags, C07 1.1 `vehicle` and `portrait` kinds, C16 1.1 `racing.pursuit_end`. S06-owned shapes (`Quirk`, `ScriptedBlock`, `RacingSlice.ladder`) as in `06-racing-data.md`. No contract change.

## Acceptance criteria
- AC-1 Given the branch When typecheck, lint and build run Then all exit 0 — proof: `pnpm typecheck && pnpm lint && pnpm build`
- AC-2 Given fixture runs per kind When the kind rules run Then a checkpoint run carries leftover time and fails at 0; a speedtrap sums integer kph and breaks ties by time; a drift held 3 s at 30° and 72 kph scores by the C.5 formula with combo 1.3 and a wall hit halves the combo; a sideshow reaches heat 2 at T+60 s; a robotaxiRush fare loses 5 % per infraction and fails at 0 %; a survive pursuit succeeds at `surviveSec` — proof: `pnpm --filter @dv/mode-racing test -- kinds`
- AC-3 Given all 20 committed events When validate and par run Then every event passes V1–V15, every street-name hint resolves, and each event with `parSec` is within ±15 % — proof: `pnpm map:races validate && pnpm map:races par -- --check`
- AC-4 Given the robotaxi When 20 seeded dark-signal approaches run Then every stall holds 4–9 s, a 2 s held Interact overrides it, governed top speed is 105 ± 2 kph and jailbroken 190 ± 3 %, and auto-yield prevents contact with a stationary ped dummy approached at 14 m/s — proof: `pnpm --filter @dv/mode-racing test -- quirk`
- AC-5 Given the roadster on flat ground When the hop fires Then the apex is 2.9 ± 0.3 m, a charge recharges in 6.0 ± 0.1 s, and the `hop.roadblock` line clears the heat-3 roadblock fixture with no contact — proof: `pnpm --filter @dv/engine test:lines`
- AC-6 Given a heat-4 race pursuit fixture When the planner runs Then roadblocks sit on the next three gates' route, are armed ≥ 140 m ahead with a 4.5 m gap, spikes appear only at `chokePoints`, at most two per pursuit and ≥ 25 s apart, each telegraphed ≥ 90 m before it is crossed, a hit zeroes the crossed tires, and no unit exceeds 1.06 × the player's top speed — proof: `pnpm --filter @dv/mode-racing test -- pursuit.profile`
- AC-7 Given a fresh `RacingSlice` When the ladder test beats rival 10 twice and gains Rep through level 3 Then `unlock.racing.ladder.10` is emitted once, `ondine-nimbus` joins `CoreSlice.garage` once, class C unlocks at level 3, the purse pays class purse × place multiplier, the first-time medal bonus is paid once, and the story wallet is untouched — proof: `pnpm --filter @dv/mode-racing test -- progression ladder`
- AC-8 Given the eight new handling profiles When the shared vehicle tests run Then each is inside its class envelope with `powerKw` within 3 % — proof: `pnpm --filter @dv/shared test`
- AC-9 Given rival handles, car names and new assets When the IP gates run Then all pass and each asset has a provenance record — proof: `pnpm names:lint && pnpm ip:strings && pnpm provenance:check && pnpm check:assets`
- AC-10 Given Chromium with `?unlockAll=1` When the player opens the ladder, starts rival 10's showdown and the bridge drives the line bot to a win Then rival 9 becomes available, the reward car appears in the garage view-model and the slice records `ladder.current = 9` — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @racing-ladder`
- AC-11 Given the branch When the unit suite and the preview deploy run Then both pass — proof: `pnpm check:unit && pnpm deploy:preview`

## Test plan
- **Unit:** `racing/kinds`, `racing/quirk.stall`, `racing/quirk.govern`, `racing/quirk.autoYield`, `racing/pursuit.profile`, `racing/progression`, `racing/ladder`; `shared/vehicle.envelope`.
- **Lines:** `hop.roadblock`, `hop.apex` (`pnpm --filter @dv/engine test:lines`).
- **Bot runs:** `map:races par -- --check` over 20 events; the M07a2 suites stay green.
- **E2E:** `@racing-ladder`; `@racing-vs`, `@racing-det` unchanged.

## Demo script
1. `pnpm map:races validate`: 20 events green.
2. `pnpm dev`, open `/?unlockAll=1`, Racing → Tha Bay 10 → Kickstand's shipyard sprint; win it.
3. Rival 9 unlocks; the reward car shows in the garage list.
4. Start `sf.robotaxirush.soma-haight` in the Cormorant: the car holds at 105 kph and yields to pedestrians.
5. Start `sf.pursuit.embarcadero-heat3` in the roadster: hop over a heat-3 roadblock with H.
6. Start `sf.drift.bayview-yard` and watch the combo multiplier climb.

## Effort
1 Builder session; about 38 hand-written files (16 `source.json` counted as one data task; compiled `race.json` and gray-box assets excluded); risk **medium**. Authoring 16 events against the real graph is the time sink.

## Risks & fallbacks
- **A street-name hint does not resolve** on the bake: switch that waypoint to a landmark id or lat/lng and note it in the event's `source.json` comment field; never weaken V-rules.
- **Spikes at choke points that a route never crosses:** spikes then do not deploy; AC-6 uses a fixture with tagged choke points on the route.
- **Dark-signal state** comes from S02 components 256–511 (A-S06-8); if M03b1 exposed it under another name, read it through `ModeContext.world` and record the mapping in "Builder decisions".
- **Rival portrait art:** silhouettes ship now; generated portraits need an owner-approved slot in the DL-OWN-01 cap, so none is generated here.

## Notes for the Builder
- Read first: `06-racing-content.md` C.4–C.6, C.11; `06-racing.md` §2.6, §2.13; `06-racing-data.md` §4.1 (quirks), §4.4, §4.6.
- Order: kinds → quirks and hop → pursuit planner and spikes → progression → ladder → events (batch-author, then compile) → cars → e2e.
- Sideshow and drift stay in v1 with police response and `xr: 'none'` (Q-06 default, DL-124). Busts never touch the story wallet outside an embedded story race (D-S06-07).
- All names are placeholders until the counsel knock-out (Q-23(a)); never use a real maker, operator or another publisher's fictional make.
- Secrets: none besides the CI deploy pair. No paid account, no fal.
