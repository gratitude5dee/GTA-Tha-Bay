# @dv/mode-racing

The racing game mode (M07a1, M07a2): a race on real San Francisco streets, from the grid to the results card, against AI rivals and the ghost of your best run, with exact replays and a police pursuit event. The descriptor is `available` since M07a2 (the tile is locked until `unlock.racing`, which the story mission `m.a1.03` grants); a QA build also starts a race through `__dvBridge.racing`.

## Layout

| Path | Holds | Imports |
|---|---|---|
| `src/index.ts` | `racingDescriptor()` (lazy `sim` and `ui`), `racingUnlockDefs()`, the bundled races and cars | `@dv/shared` |
| `src/sim/` | `RaceSession` (director, referee, nitro, damage, HUD view model), `GameModeSim` (`mode.ts`), the engine port (`engine-port.ts`) and the sim module (`module.ts`) | `@dv/shared`; the port and the module also `@dv/engine/sim`. The C02 determinism lint applies |
| `src/ui/` | `GameModeUI`: a plain DOM HUD from the `mode.racing.hud` view model | DOM |
| `src/sim/` (M07a2) | rivals (`ai-driver`, `speed-profile`, `rubber-band`, `lod`), `recorder`, `ghosts`, `results`, `slice` (`RacingSlice`), `pursuit-binder` | as above |
| `src/replay/` | `ReplayViewer`: re-simulates a replay from its inputs, falls back to the 20 Hz track and emits `racing.verify_fail` on any header mismatch | `@dv/shared` |
| `src/leaderboard.ts` | `buildScoreSubmit` (route 21 body) and the null `LeaderboardPort`; the transport is M12c | `@dv/shared` |
| `src/qa/` | bots `racing.line`, `racing.pursuit` and the story child bot, the `racing` suite loader, the headless runner and replay re-simulation, the kinematic pursuit rig, the corridor codec, the `racing.*` QA commands | `@dv/engine/qa`; QA builds and Node only |
| `test/` | referee, damage, nitro, director, HUD, descriptor, config, the headless line run, AI, rubber band, replay codec and exact replay, ghosts, slice, pursuit bot, the 3-car det run | |

The rules (gates, wrong way, resets, nitro, damage) live in `packages/shared/src/racing/` (referee, pure) and in `src/sim/`; `RaceSession` talks to the physics world only through `RaceWorldPort`, so the mode and the headless run are the same code.

## See a race

```bash
pnpm map:build -- --area sf          # once: bake the real city into dist/world (needs the raw cache, see tools/map)
pnpm map:races compile               # content/races/<id>/{race.json, corridor.bin} from source.json
pnpm map:races validate              # V1 to V11, V13 to V15
pnpm check:unit -- packages/modes/racing
```

In a QA build (`VITE_DV_QA=1`; the PR preview `https://pr-6-tha-bay-web-staging.gratitude-8f4.workers.dev` is one, built with `DV_WORLD=synth`):

| What | URL | Then |
|---|---|---|
| The straight demo sprint on the gray-box street (the default QA scene; on the synth preview only at a tier whose physics radius reaches the grid, see below) | `/?racing=demo&debug=1` (add `&touch=1` for the touch layout) | tap Start; the grid, the 3-2-1 countdown (it starts by itself after 5 s) and the HUD show at once. W A S D drive, Left Shift is nitro, Space the handbrake, hold R for the reset |
| The same, by hand | `/?racing=1&debug=1` | `await __dvBridge.racing.demo()` |
| The real sprint on the streets of San Francisco | `/?racing=1&debug=1` on a build with the `sf` bake (`DV_WORLD` unset) | `await __dvBridge.racing.start('sf.sprint.ferry-ocean-beach', { vehicle: 'vehicle.aurelian-sorrel' })` |

```js
__dvBridge.racing.hud();            // speed, gear, nitro, place, gate, timer, and the results card from Results on
await __dvBridge.racing.bot(true);  // the line bot drives the player's car to the finish (QA); bot(false) takes it off
await __dvBridge.racing.slice();    // the racing slice: best times, medals, the ghost of each event
await __dvBridge.racing.state();    // phase, gate, s, car pose, the event log
await __dvBridge.racing.fillNitro(); // QA shortcut for a drift or a perfect start
await __dvBridge.racing.cmd('ready' | 'retry' | 'exit'); await __dvBridge.racing.quit();
```

The demo race (`qa.demo.straight`, 180 m north along the street of the gray-box block) is QA scaffolding, not content: the `sf` race needs the baked streets, which the synth build does not have. The grid is fixed at (96, 190), on the gray-box street. The synth bake has ground there but no street (its streets run every 160 m from x = 60), and the grid is 238 m from the synth spawn: the sim streams colliders only within the tier's physics radius of the player (`config/world/streaming.json`: 400 m at `desktop`, 150 m at `mobile-low`), so on a phone-sized synth session the race stays in `Loading`. The touch test `@racing-touch` therefore runs in the gray-box half of CI (`GRAYBOX_GREP`, BD-FIX-CI4-F01). The HUD in these builds is a plain DOM overlay mounted by the bridge; the shell mounts the mode UI itself from M04b2.

### M07a2: what to look at

The default QA scene (`/?racing=demo&debug=1`, or `await __dvBridge.racing.demo()`) is now a three-car race: you and the two rivals `rival.switchback` and `rival.cable-car-cleo` on the gray-box street. After the countdown the rivals drive the line (the AI is a point mass that follows the route, with seeded mistakes and a capped rubber band, drawn as body-less puppets). To watch a whole race without driving, press ready and then `await __dvBridge.racing.bot(true)`: the line bot finishes the straight, the results card shows place and time, `__dvBridge.racing.slice()` holds `events['qa.demo.straight'].bestMs` and the ghost, and `__dvBridge.racing.cmd('retry')` puts one translucent ghost car on the grid next to the rivals.

The circuit, the downhill and the pursuit need the streets of the `sf` bake (they run in Node on `content/races/<id>/corridor.bin` and in the browser's determinism page): `pnpm check:unit -- packages/modes/racing` runs the 3-car circuit race, the exact replay and the golden; `pnpm map:races par -- --check` re-runs the par bot of every race.

Replays: `ReplayHeaderV1`, the bit-packed inputs and the 20 Hz track are in `packages/shared/src/racing/replay.ts`; the exact re-simulation (`replayFrames` in `src/qa/headless.ts`) reproduces `finishTick`, every gate tick and `endHash` under the `canonical` profile (`tests/golden/racing/vs-circuit.dvreplay` is the file M12e reuses). A `local` run keeps a track ghost only.
