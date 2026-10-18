# M07a2 — racing-ai-replay-ghosts

## Goal
After this session racing is playable from the main menu and from the story, and it is the **VS-Racing** checkpoint (`_PLAN.md` §3). Rival AI drivers race on a precomputed racing-line speed profile with seeded mistakes and capped rubber-banding. Three VS races (`sf.sprint.ferry-ocean-beach`, `sf.circuit.embarcadero-vanness`, `sf.downhill.twin-peaks-mission`) and the pursuit event `sf.pursuit.bayview-escape` compile, validate against V1–V15 and hold par. A replay codec records quantized inputs plus a 20 Hz track; under the `canonical` profile a re-simulation reproduces `finishTick`, `gateTicks` and `endHash` exactly in Node, Chromium and WebKit, and best runs return as kinematic ghosts. `RacingSlice` persists purse, Rep, events and ghosts in `mode:racing`. Story mission `m.a1.03` enters the pursuit event through its C09 hook, and the racing tile becomes `available`.

## Requirements
- R-MODE-02: AI opponents, police pursuit with heat and evade, exact replays and ghosts on real SF streets.
- R-MODE-05: the first story encounter emits `unlock.racing` once; the standalone tile and the slice persist it.
- R-MAP-01 (support): all four events are snapped to the baked graph and re-validated against the pinned `worldBake`.
- R-ENG-02 (support): replay size caps and the cross-browser state-hash oracle are automated checks.

## Depends on
- **M07a1** (mode package, referee, director, cars, `map:races compile|validate`, driver `racing.line`, `@racing-det`), **M03c** (`PursuitDirector`, `config/pursuit.json`, `pnpm --filter @dv/engine test:pursuit`), **M05c1** (mission `m.a1.03` with its stub hook; transitively the menus of M04b1, `pnpm check:missions` from M05a2 and the M04a1 save service).
- Contracts: C02 1.1, C03 1.1, C05 1.1 (`mode:racing`), C06 1.1 (`PursuitApi.setProfile`, `configRef`, `setRouteHint`, `standaloneProfile`), C09 1.0 (`ModeHook` consumer), C16 1.1.

## Scope in
- AI drivers (`06-racing-content.md` C.12): speed profile by backward and forward passes over the 5 m line, pure-pursuit steering with lookahead 6 m + 0.25·v, PI speed control, skill factor, brake margin, seeded mistakes on stream `racing.ai`, overtake and invisible recovery; think at 30 Hz. M1/M2 promotion and demotion at 70/100 m (`06-racing.md` §2.2).
- Rubber-band (`06-racing.md` §2.9): ±8 % cap, gap scale 150 m, frozen in the last 15 %, off in time trials; player catch-up nitro ×1.25 on easy and normal.
- Validator rule V12 and `pnpm map:races par [-- --check]` (headless canonical bot → `parSec`, `parBotHash`, medals ×1.25/1.12/1.04); a broken fixture for every rule V1–V15.
- Content: the circuit (3 laps, closures), the downhill (jump zones) and the pursuit event (start heat 2, max heat 3, success `evade`); opponents per C.5.
- `config/pursuit.race.json` v1 with `unitSpeedOfPlayerTop`, `catchUp`, `bounty`, `evade`; `roadblock` and `spikes` blocks are absent until M07b1, so race pursuits use no race-planned blocks. Binder over `PursuitApi.setProfile({kind:'race', …})`.
- Replay (`06-racing-data.md` §4.3): `ReplayHeaderV1`, `encodeReplay`/`decodeReplay`, `REPLAY_LIMITS`, `ReplayRecorder`, viewer that re-simulates from inputs and falls back to track playback with `racing.verify_fail` on any header mismatch.
- Ghosts: `GhostEntry`, kinematic puppet entities (component 1029, no physics body), best per event.
- `RacingSlice` (schema 1, `RACING_SLICE_MAX_BYTES`, eviction order oldest ghosts, then tracks of events not played in 60 days), golden save files, purse and Rep rewards (D-S06-04).
- Story hook: `m.a1.03` hook defId `sf.pursuit.bayview-escape`, no params (DL-157); embedded runs use the parent's profile, track ghosts and no records; descriptor status `available`.
- Telemetry `racing.pursuit_end`, `racing.replay_view`, `racing.verify_fail`.
- Driver `racing.pursuit` (drive the route to a C08 `hidingSpots` tag and wait out the cooldown); `racing.line` and `racing.pursuit` serve as the child-mode bots the autoplayer uses under `hooks: 'bot'`, chosen by race kind; det suite extended to a 3-car race; two replay mutants.

## Scope out
- Roadblocks and spikes in races, the other six race kinds, ladder, quirks and hop, remaining cars: M07b1.
- Replay director and scrub, photo mode, garage and upgrades, econ-sim racing section, intro refs: M07b2.
- Perf scenarios `race-sprint`, `race-pursuit-heat4`: M11a1. Leaderboard submit and route 21 validator: M12e.

## Deliverables
- `packages/modes/racing/src/sim/{ai-driver.ts, speed-profile.ts, rubber-band.ts, lod.ts, pursuit-binder.ts, recorder.ts, ghosts.ts, results.ts}`; `src/sim/slice.ts`; `src/replay/viewer.ts`; `src/qa/pursuit-bot.ts`.
- `packages/shared/src/racing/replay.ts`; `packages/shared/schemas/racing/racing-slice.schema.json`.
- `packages/modes/racing/test/{ai.profile.spec.ts, ai.rubberband.spec.ts, replay.codec.spec.ts, replay.exact.spec.ts, ghost.track.spec.ts, bot.pursuit.spec.ts, slice.spec.ts}`.
- `content/races/{sf.circuit.embarcadero-vanness, sf.downhill.twin-peaks-mission, sf.pursuit.bayview-escape}/{source.json, race.json}`; `par` fields filled for all four races.
- `config/pursuit.race.json`, `config/schemas/pursuit-race.schema.json`.
- `tools/map/src/race/par.ts`; extra fixtures `tools/map/test/fixtures/races/V{2,4,7,12}.source.json`.
- `tests/golden/saves/racing/slice.v1.json`; `tests/golden/racing/race3.vs-circuit.json`; `tools/ci/mutants/racing/{replay-tick-skip,handling-rev-ignored}.ts`.
- `tests/e2e/racing-vs.spec.ts` (`@racing-vs`); the 3-car `RunSpec` in `tests/e2e/det/suites.ts` (`@racing-det`).
- Story hook wiring in `packages/modes/racing/src/index.ts` (status `available`); hook row for `m.a1.03` only if M05c1 left the defId unset.

## Interfaces
- Consumes C06 1.1 `PursuitApi` (`setProfile`, `configRef`, `setRouteHint`), `standaloneProfile: 'canonical'` (DL-121) and `ModeResult`; writes C05 1.1 slot `mode:racing` only through `ctx.save.request`; C09 1.0 `ModeHook` with `defId` = `RaceId` (DL-157); C16 1.1 names above.
- No contract change. `ScoreSubmit` (route 21) stays unused until M12e.

## Acceptance criteria
- AC-1 Given the branch When typecheck, lint and build run Then all exit 0 — proof: `pnpm typecheck && pnpm lint && pnpm build`
- AC-2 Given a fixture racing line with a hairpin When the speed profile is built Then no sample exceeds the grip limit √(μ·g/|κ|), braking satisfies v_i² ≤ v_{i+1}² + 2·a·ds, rubber-band never moves target speed or power by more than 8 %, is constant over the last 15 % of the route and is 1.0 in time trials — proof: `pnpm --filter @dv/mode-racing test -- ai`
- AC-3 Given the four committed races and one broken fixture per rule V1–V15 When validate runs Then the races pass and each fixture fails with exactly its rule id — proof: `pnpm map:races validate && pnpm check:unit -- tools/map`
- AC-4 Given the three VS races When the par bot runs in the canonical profile Then each finish time is within ±15 % of `parSec` and reproduces `parBotHash` — proof: `pnpm map:races par -- --check`
- AC-5 Given a 90 s recorded lap When it is encoded and decoded Then the round trip is lossless, inputs ≤ 12,288 B, track ≤ 16,384 B, and a header with another `handlingRev`, `buildId` or `worldBake` is flagged as a mismatch — proof: `pnpm --filter @dv/mode-racing test -- replay.codec`
- AC-6 Given a 3-car circuit race (line bot plus two AI rivals, seed 0xC0FFEE, at least 10,000 ticks) When it is recorded and re-simulated from inputs Then `finishTick`, every `gateTicks` entry and `endHash` are equal, and a mismatched header plays the track and emits `racing.verify_fail` — proof: `pnpm --filter @dv/mode-racing test -- replay.exact`
- AC-7 Given a saved ghost When it plays beside a live run Then its position stays within 5 cm of the recorded samples, it owns no physics body, and the live run's hash equals a run without the ghost — proof: `pnpm --filter @dv/mode-racing test -- ghost`
- AC-8 Given the 3-car `RunSpec` When it runs in Node, Chromium and WebKit Then the three `StateHashTrace`s are equal — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @racing-det && pnpm check:e2e -- --project=webkit-webgl2 --grep @racing-det`
- AC-9 Given `sf.pursuit.bayview-escape` When `bot.pursuit` runs seeds 1–3 Then each run ends in `evade` before `maxTicks`, heat never exceeds 3, no police unit exceeds 1.06 × the player's current top speed, and a fixture bot that stops at the start is busted (`race.dnf {reason:'busted'}`) with the 5 % repair fee — proof: `pnpm --filter @dv/mode-racing test -- pursuit && pnpm --filter @dv/engine test:pursuit`
- AC-10 Given the slice goldens When the slice tests run Then `slice.v1.json` validates and round-trips, a slice pushed over 1,572,864 B evicts the oldest ghost first, and a standalone session writes only `core`, `settings` and `mode:racing` — proof: `pnpm --filter @dv/mode-racing test -- slice && pnpm --filter @dv/engine test:save`
- AC-11 Given mission `m.a1.03` with hooks on `bot` When the autoplayer runs three seeds twice Then each passes inside `expectedSec` with equal end hashes, `unlock.racing` is recorded exactly once, the purse reward is not paid twice, and the same mission with hooks on `stub` still passes — proof: `pnpm check:missions -- --mission m.a1.03`
- AC-12 Given a fresh profile with `?unlockAll=1` in Chromium When the player opens Racing from the menu, starts the circuit, the bridge feeds the line bot to the finish, and the player retries Then the results view-model shows place and time, the slice stores `bestMs` and the ghost, and the retry spawns one ghost entity — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @racing-vs`
- AC-13 Given the mutants `replay-tick-skip` and `handling-rev-ignored` When the harness applies them Then the replay suite fails for each — proof: `pnpm check:unit -- tools/ci`
- AC-14 Given the branch When telemetry, the unit suite and the preview deploy run Then the three new names validate, all tests pass and the app boots — proof: `pnpm check:telemetry && pnpm check:unit && pnpm deploy:preview`

## Test plan
- **Unit:** `racing/ai.profile`, `racing/ai.rubberband`, `racing/replay.codec`, `racing/replay.exact`, `racing/ghost.track`, `racing/bot.pursuit`, `racing/slice` (`pnpm --filter @dv/mode-racing test`); `tools/map/race.validate`.
- **Bot runs:** `map:races par -- --check`; `check:missions -- --mission m.a1.03`.
- **State hash:** `@racing-det` on `chromium-webgl2` and `webkit-webgl2`; nightly runs both through `nightly.yml`.
- **E2E:** `@racing-vs` (Chromium).
- **Mutants:** `pnpm check:unit -- tools/ci`.

## Demo script
1. `pnpm map:races par -- --check`: three races within ±15 %.
2. `pnpm dev`, open `/?unlockAll=1`, pick Racing → `sf.circuit.embarcadero-vanness`.
3. Race two AI rivals for three laps; note they ease off when far ahead (rubber-band).
4. Retry: your best lap now runs as a translucent ghost.
5. Start `sf.pursuit.bayview-escape`: police reach heat 3; break line of sight and wait out the cooldown.
6. `pnpm check:missions -- --mission m.a1.03`: the story mission reaches the pursuit and returns.

## Effort
1 Builder session; about 36 files (generated `race.json` excluded); risk **medium**. Exact re-simulation across engines and the pursuit bot are the hard parts.

## Risks & fallbacks
- **Independent Rapier bodies affecting each other** (U-RAC-3): ghosts are kinematic tracks, never bodies; AC-7 asserts the hash is unchanged.
- **Exact replay differs across engines:** find the divergence with the M04d trace bisect (checkpoint every 600 ticks, then every tick); never relax AC-6 or AC-8. If Rapier is the cause, report it and keep track-only replays behind `racing.exactReplay` off until fixed.
- **Embedded story races run `local`:** they use track ghosts and no records (`06-racing.md` §2.11); only standalone menu races are `canonical`.
- **Pursuit bot flakiness:** the bot's hiding-spot choice reads only sim state and the `bot` stream; if a seed fails, change the event's authored hiding spots, not the bot timeout.

## Notes for the Builder
- Facts: F-014 (Rapier `deterministic-compat` for replays and ghosts, spec/03 §6).
- Read first: `06-racing.md` §2.6, §2.9, §2.11, §2.13; `06-racing-data.md` §4.2–§4.4; `06-racing-content.md` C.5, C.11–C.12; `03-story-missions.md` §C8–§C9; `13-qa.md` §3.1–§3.6.
- Order: AI and speed profile → rubber-band → V12 and par → content → replay codec → recorder and viewer → ghosts → slice → pursuit binder and bot → story hook → e2e → mutants.
- `endHash` is FNV-1a-64 over vehicle components at `finishTick` in C02 rule 7 order; feed f64 as two u32 words.
- Update goldens only with `DV_UPDATE_GOLDEN=1` and the `golden-update` PR label.
- Secrets: none besides the CI deploy pair. No paid account, no fal.
