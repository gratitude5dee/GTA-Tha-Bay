# M04e1 — sandbox-world-controls

## Goal
After this session the phone's Sandbox app has three new sections next to the existing heat controls: **Weather**, **Time** and **World**. All are `ScreenDef` widgets, so the XR panel (M11b3) draws them with no extra work.
- **Weather.** A preset the player picks stays put until they choose "Natural". Today `forceWeather` lets the schedule replace it 20–40 game minutes later, about 40–80 real seconds. The hold lives inside the engine's clock and draws nothing from the `weather` stream while it holds.
- **Time.** Set the hour, pause it, match the device clock, and four shortcuts of our own that follow San Francisco's marine-layer day. The shortcuts are read from `config/clock.json`.
- **World.** World speed 0.25×–2×, blackout, and traffic, pedestrian and parked-car density.

Today these are reachable only through QA debug envelopes (`debug.hour`, `debug.weather`, `debug.blackout`, `debug.world` in `packages/engine/src/sim/runtime.ts` and `packages/world/src/sim/api/debug.ts`). The milestone also closes the gap for sandbox actions: `UiCommand mode.cmd {mode:'sandbox'}` already becomes a `SimEvent` that `ModeHost.route` hands to the running mode's `onEvent`, but the sandbox sim has none. This milestone adds it.

## Requirements
- R-MAP-04 (primary): the player controls day and night, weather and the living city's density and signals from inside the game.
- R-UI-03 (support): the phone's Sandbox app, an implied page, gets its Weather, Time and World sections.
- R-PLAT-02 (support): the sections are `ScreenDef` trees, so the XR panel shows the same controls in the same focus order.

## Depends on
- **M04e5** (ip-wall-strings): the `trainer-*` patterns that make AC-11's `ip:strings` meaningful, and the new English values of the `phone.sandbox.*` heat keys.
- **M04e0** (sandbox-rooms-guard): `sandboxOnline`, `SANDBOX_REFUSE_ONLINE`, the refusals in `createCommandDispatcher`, and the `ContextPorts.net` getter. It edits the same files (`sandbox.ts`, `commands.ts`, `context.ts`, `test/modes/fixture.ts`), so it merges first.
- **M04b2** (creator-phone-hud-kit): `appScreen` case `'sandbox'` in `packages/ui/src/phone/apps.ts`; `usePhoneEnv` in `packages/ui/src/phone/pause.tsx`; `applyToggle`, `publishToggles` and `sandboxSim` in `packages/engine/src/sim/modes/builtin/sandbox.ts`.
- **M02b2** (weather-time): `WorldClock`, `CLOCK_CONFIG`, `WEATHER_PRESETS` and `installClock` in `packages/engine/src/sim/world/clock.ts`; `config/clock.json` and `config/schemas/clock.schema.json`; `packages/engine/test/clock.spec.ts`.
- **M03b1** (traffic-robotaxis) and **M03b2** (peds-transit): C08 `TrafficControl.setBlackout`, `setDensity` (clamped to 0–1.5, one override stack per owner in `packages/world/src/sim/traffic/control.ts`) and `release`.
- Through those: M04a2 (`ModeHost.route`, `createCommandDispatcher`, `makeRig` in `packages/engine/test/modes/fixture.ts`), M01a1 (`SimCore`, `TimeScaleError`, `ALLOWED_SCALES` in `packages/engine/src/sim/loop/sim-core.ts`), M04b1 (`tools/ci/check-i18n.ts`, `content/ui/i18n/en.json`).
- M04e5 and M04e0 are in the Architect's registration batch with this file; every other dependency is merged on `claude/build`.
- Contracts: C02 1.1, C05 1.2, C06 1.1, C08 1.0, all read only.

## Scope in
- **Weather hold, engine-internal** (`packages/engine/src/sim/world/clock.ts`). `WorldClock` gains `holdWeather(w: WeatherPreset | null)`. The method is on the class only, never on C06 `WorldClockApi`.
  - **Holding.** `holdWeather(w)` sets `current = next = w`, `blendStartT = t`, and `changeAtT = HOLD_T` (exported `Number.MAX_SAFE_INTEGER`). The hold is therefore the sentinel itself, with no new field: the resource's hash, save and load bytes keep their layout, and a session that never holds hashes exactly as before.
  - **While held:**
    - `step()` advances `t` and never enters the change loop, so it draws nothing;
    - `blend()` returns 0;
    - `moveToHour` leaves `changeAtT` at `HOLD_T`;
    - `forceWeather(w, …)` replaces the held preset and keeps the hold.
  - **Releasing.** `holdWeather(null)` calls `schedule(t)` once (one interval draw, one pick draw). It does nothing when the clock is not held.
- **World speed, engine-internal** (`packages/engine/src/sim/loop/sim-core.ts`).
  - `SimCore.setSandboxScale(s)` throws `TimeScaleError` unless `s` is in `ALLOWED_SCALES`.
  - `advance` keeps its present check on the page's `timeScale`, then runs at `sandboxScale` when that is not 1 and at the page's value otherwise.
  - `FrameSignal` is unchanged, and the page keeps sending `timeScale: 1` (`packages/engine/src/client/boot/boot-engine.ts`).
  - Scale changes only how many ticks a frame pays for. It is not hashed state, and it never changes `SIM_DT` (C02 rule 4).
- **Sandbox world port** (new `packages/engine/src/sim/modes/builtin/sandbox-world.ts`, inside the C02 lint scope):
  - `SandboxWorldPort { holdWeather(w: WeatherPreset | null): void; setTimeScale(s: 0.25 | 0.5 | 1 | 2): void }`.
  - `SandboxEnv` gains `world?(): SandboxWorldPort | null`, and `CommandDeps` gains `sandboxWorld?(): SandboxWorldPort | null`.
  - In `packages/engine/src/sim/modes/index.ts`, both are bound to `runtime.clock?.holdWeather` and `s.core.setSandboxScale`.
  - Without a port (the rig's default), values are stored and nothing else happens, as heat behaves without a pursuit director.
- **Settings: one storage place per path.** `applyToggle(ctx, s, path, v, port?)` hands the paths below to `applyWorldSetting`. A value outside its set returns `false` and writes nothing. Every other `sandbox.*` path keeps today's generic toggle behaviour.

  | path | v | stored in | effect |
  |---|---|---|---|
  | `sandbox.weather.preset` | int −1…5 | 0…5: `SandboxSlice.weather = WEATHER_PRESETS[v]` (the `WeatherPreset` string, its C05 type) and `toggles['sandbox.weather.hold'] = true`; −1: only `toggles['sandbox.weather.hold'] = false`, `weather` keeps its last string | −1 releases the hold ("Natural"); 0…5 holds `WEATHER_PRESETS[v]` |
  | `sandbox.time.hour` | 0…23.5, step 0.5 | `SandboxSlice.clock.hour` | turns sync off, then `ctx.clock.setHour(v)` |
  | `sandbox.time.paused` | boolean | `SandboxSlice.clock.paused` | `ctx.clock.pause(v)`, unless sync is on |
  | `sandbox.time.sync` | boolean | `SandboxSlice.clock.syncSystemTime` | on: `pause(true)`; off: `pause(clock.paused)` |
  | `sandbox.world.timeScale` | 0.25, 0.5, 1, 2 | toggles | `port.setTimeScale(v)` |
  | `sandbox.world.blackout` | boolean | toggles | `ctx.world.traffic.setBlackout(v, 'sandbox')` |
  | `sandbox.world.density.{traffic,ped,parked}` | 0, 0.35, 1, 1.5 | toggles | `ctx.world.traffic.setDensity(kind, v, 'sandbox')` |

  The `sandbox.time.*` and `sandbox.weather.preset` paths never land in `toggles`. `sandbox.weather.hold` is written only by the preset path.
- **Actions: the sandbox dispatcher.** `sandboxSim(env)` gains `onEvent(ctx, e)`, the same pattern as `@dv/mode-story`'s `onEvent`.
  - It parses `mode.cmd` events whose `mode` is `'sandbox'` and looks the name up in `SANDBOX_ACTIONS`.
  - The route is unchanged. `createCommandDispatcher` runs M04e0's online refusal first, then emits the `SimEvent`. `ModeEventBus.emit` reaches `ModeHost.route` synchronously, between ticks, and `route` hands the event to the top running mode.
  - Unknown names and bad arguments are ignored without throwing. Actions:
    - `time.shortcut {id}`: looks `id` up in `CLOCK_CONFIG.sandboxShortcuts`, applies its hour as `sandbox.time.hour` does, and its `weather`, when present, as a held preset.
    - `time.sync {hour}`: applies only while `syncSystemTime` is on. It calls `ctx.clock.setHour(hour)` on the paused clock and writes nothing to the slice, so it causes no autosave churn.
    - `world.reset`: weather back to Natural, scale 1, blackout off, `traffic.release('sandbox')`, sync and pause off.
- **Enter and exit** (`sandboxSim`):
  - `enter` re-applies the stored state: the hold, pause or sync, the scale, blackout and density. The hour is applied only when the clock was saved paused or synced. It skips all of this while `sandboxOnline(ctx)` (M04e0 rule) but still publishes.
  - **Going online mid-session.** `tick()` compares `sandboxOnline(ctx)` with its value at the previous tick. On false → true it releases every world effect exactly as `exit` does (`holdWeather(null)`, `setTimeScale(1)`, `traffic.release('sandbox')`, `pause(false)` when sandbox had paused the clock) and leaves the stored slice values untouched, so a room never runs with a local hold, speed, blackout, density or pause. On true → false it re-applies the stored state as `enter` does. Both transitions republish `mode.sandbox.world`.
  - `exit` releases everything: `holdWeather(null)`, `setTimeScale(1)`, `ctx.world.traffic.release('sandbox')`, and `ctx.clock.pause(false)` when sandbox had paused it. It still runs `capHeat(6)`.
  - Every clock, traffic and port call sits in the same `try/catch` as the pursuit calls (a `NotYetAvailable` stub, or no world).
- **View model.** A new patch, `mode.sandbox.world`: `{weather: WeatherPreset | null, hour, paused, sync, timeScale, blackout, density: {traffic, ped, parked}, shortcuts: string[], online}`.
  - It is sent on enter and after each applied setting or action.
  - `tick()` sends it again when `sandboxOnline(ctx)` changes (with the release above), so the controls grey out on room join.
- **SF shortcuts** in `config/clock.json`: `sandboxShortcuts`, with schema rows `{id, hour, weather?}` (at most 6, ids `[a-z-]{1,24}`, hour 0–23.5 in steps of 0.5). `ClockConfig` gains the field. Values (design values the owner may tune):
  - `fog-dawn` 6.0 with `karl-fog`;
  - `burn-off` 11.0 with `clear`;
  - `golden-hour` 18.5 with `golden`;
  - `fog-returns` 20.5 with `karl-fog`.
- **Phone UI** (`packages/ui/src/phone/apps.ts`):
  - The Sandbox app becomes a `tabs` widget, `sandbox-tabs`, with the tabs `player` (today's heat buttons and the heat-lock button, ids `heat-<n>` and `never-wanted` unchanged), `weather`, `time` and `world`.
  - Only existing widget kinds are used: buttons whose `onPress.cmd` is a `sandbox.set` or `mode.cmd`, the selected one styled `primary` as the heat buttons are, plus text rows.
  - Weather has the six presets, labelled with the existing `hud.weather.*` keys, plus `phone.sandbox.weather.natural`.
  - Time shows the hour from the view model's `hour`, formatted as the HUD clock widget does (`hud-clock` in `packages/ui/src/hud/widgets.tsx`) and labelled with the existing key `hud.clock.label`, then `−1 h` and `+1 h` (absolute values, rounded to 0.5 and wrapped), pause and resume, "match my clock", and the shortcut buttons with `phone.sandbox.time.<id>` labels.
  - World has four speed buttons, a blackout button, and Off / Light / Normal / Busy for each density kind.
  - While `online`, every new button carries `disabled: 'sandbox.refuse.online'`.
  - `PhoneEnv` gains `sandboxWorld`, which `usePhoneEnv` reads from `mode.sandbox.world`.
- **Clock sync, page side** (new `packages/ui/src/phone/sandbox-sync.ts`):
  - `createSandboxClockSync({ send, now, everyMs = 60_000 })` sends `mode.cmd {mode:'sandbox', name:'time.sync', args:{hour}}` at once and then every `everyMs` while `mode.sandbox.world.sync` is true, `mode.sandbox.world.online` is false and the running mode is sandbox. In a room the stored sync stays published but nothing is sent, so the M04e0 refusal toast never fires on a timer.
  - `hour` = local hours + minutes / 60, rounded to 1/60.
  - It is mounted once in `ShellApp` (`packages/ui/src/shell/app.tsx`).
  - The sim never reads `Date` (C02; 01-engine-save-modes.md, "Sandbox may … sync to system time").
- **Text:** `content/ui/i18n/en.json` gets the new `phone.sandbox.*` keys in original wording, e.g. "Fog at dawn", "Fog burns off", "Golden hour", "Fog rolls back in", "Natural", "Match my clock".
- **Builder decisions:** the BD rows go in `spec/11-decision-log-builder.md`, under the section M04e1.

## Scope out
- The rooms guard itself: M04e0. The descriptor's `requires.network` stays `'none'` (M12b2 changes it, DL-719).
- Teleport, waypoint, saved positions and hide HUD: the teleport and display milestone that follows this one.
- The vehicle spawner, vehicle actions and player toggles: the vehicle-spawner milestones.
- Sandbox presets (`SandboxSlice.presets`, M13) and the weather and time API for mods (C14).
- Any new widget kind or `SettingRef` scope; the XR panel's comfort layout (M11b3).
- Sending the page's `FrameSignal.timeScale` other than 1; per-tick weather re-assertion; reading wall time in sim code.

## Deliverables
- `packages/engine/src/sim/world/clock.ts`: `holdWeather`, `HOLD_T`, `ClockConfig.sandboxShortcuts`. `config/clock.json` and `config/schemas/clock.schema.json`: `sandboxShortcuts`.
- `packages/engine/src/sim/loop/sim-core.ts`: `setSandboxScale`.
- `packages/engine/src/sim/modes/builtin/sandbox-world.ts` (new); `builtin/sandbox.ts` (`onEvent`, `applyToggle` port argument, enter, exit, tick, `publishWorld`); `builtin/index.ts` (`SandboxEnv.world`, exports); `modes/commands.ts` (`CommandDeps.sandboxWorld`, passed to `applyToggle`); `modes/index.ts` (port binding).
- Tests:
  - `packages/engine/test/clock.hold.spec.ts` (new);
  - `packages/engine/test/clock.spec.ts` (extended: the `sandboxShortcuts` ids are unique and each has a `phone.sandbox.time.<id>` key in `content/ui/i18n/en.json`);
  - `packages/engine/test/sandbox-scale.spec.ts` (new);
  - `packages/engine/test/modes/sandbox-world.spec.ts` (new);
  - `packages/engine/test/modes/fixture.ts` (`RigOptions.clock`, `world`, `sandboxWorld`).
- `packages/ui/src/phone/apps.ts`, `packages/ui/src/phone/pause.tsx`, `packages/ui/src/phone/sandbox-sync.ts` (new) and `packages/ui/src/shell/app.tsx`.
- UI tests: `packages/ui/test/phone.spec.ts` and `packages/ui/test/ui-screen-parity.spec.ts` (both extended); `packages/ui/test/sandbox-sync.spec.ts` (new).
- `content/ui/i18n/en.json`. `tools/ci/check-i18n.ts`: one prefix, only if the template-built `phone.sandbox.time.` keys are reported as unused.
- `tests/e2e/ui/sandbox-world.spec.ts` (new, tag `@sandbox-world`; runs in the `DV_WORLD=synth` half, so it does not go in `GRAYBOX_GREP`).
- `spec/11-decision-log-builder.md`.
- About 24 files.

## Interfaces
- C06 1.1, read only:
  - `GameModeSim.onEvent`, `UiCommand` (`sandbox.set`, `mode.cmd`, ≤ 512 B of arguments);
  - `ModeContext.clock` (`WorldClockApi`, unchanged), `ModeContext.world`, `ModeContext.net` (through M04e0).
- C05 1.2 `SandboxSlice`: `clock`, `weather` and `toggles` are written with their existing types; the shape is unchanged.
- C02 1.1 `FrameSignal` and rule 4: unchanged; the sandbox scale is engine-internal.
- C08 1.0 `TrafficControl` (`setBlackout`, `setDensity`, `release`): used as it is.
- Engine-internal, in no contract: `WorldClock.holdWeather`, `HOLD_T`, `SimCore.setSandboxScale`, `SandboxWorldPort`, and the `mode.sandbox.world` view-model key.

## Acceptance criteria
- AC-1 Given the merged base with this milestone When the repository checks run Then:
  - they pass;
  - `pnpm lint` reports no C02 finding in `packages/engine/src/sim/**`;
  - `check:i18n` reports no missing or unused key

  — proof: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm check:unit && pnpm check:i18n && pnpm build`
- AC-2 Given a `WorldClock` on `RngStreams(7)` whose `weather` stream is wrapped to count draws When `holdWeather('rain')` is called and 72,000 steps (10 game hours) run Then:
  - `env().weather` and `env().next` are `'rain'` at every 7,200-step sample;
  - the counter reads 0;
  - `setHour(3)` and `forceWeather('golden', 0)` while held keep the hold, the second one changing the preset;
  - a save and load at step 36,000 continues to the same resource hash as the uninterrupted run;
  - `holdWeather(null)` draws exactly 2 values, and the next change arrives 20–40 game minutes later

  — proof: `pnpm check:unit -- packages/engine/test/clock.hold.spec.ts`
- AC-3 Given a clock that is never held When three game days run on seed 7 Then:
  - its resource hash equals `NEVER_HELD_HASH`, a constant the Builder records in `clock.hold.spec.ts` from the merged base before editing `clock.ts`;
  - the existing clock suite passes unchanged;
  - the synth-world hash scenario still matches

  — proof: `pnpm check:unit -- packages/engine/test/clock.spec.ts packages/engine/test/clock.hold.spec.ts && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @world-hash`
- AC-4 Given a `SimCore` with default options When the world speed is exercised Then:
  - after `setSandboxScale(2)`, 60 calls of `advance(1/60, 1, false)` run 120 ticks;
  - after `setSandboxScale(0.25)`, they run 15;
  - `setSandboxScale(3)` throws `TimeScaleError`;
  - `advance(1/60, 2, false)` still throws without `sandbox` or `debug`;
  - the state hash at tick 240 is equal for a run at scale 2 and one at scale 1

  — proof: `pnpm check:unit -- packages/engine/test/sandbox-scale.spec.ts packages/engine/test/loop.accumulator.spec.ts`
- AC-5 Given a rig (`makeRig({ clock, world, sandboxWorld })`) with spies and a running sandbox When each table path is sent through `sandbox.set` with one valid and one invalid value Then:
  - each valid value lands only in its table location and makes exactly its call;
  - each invalid value writes nothing and calls nothing;
  - `mode.sandbox.world` reflects each change;
  - `sandbox.weather.preset` 3 stores `weather: 'rain'` (a string, never an index) with the hold on, and −1 turns the hold off and keeps `weather: 'rain'`;
  - `mode.quit` calls `holdWeather(null)`, `setTimeScale(1)`, `release('sandbox')` and `pause(false)`;
  - a second `mode.start sandbox` re-applies the stored hold, scale, blackout and density

  — proof: `pnpm check:unit -- packages/engine/test/modes/sandbox-world.spec.ts`
- AC-6 Given the same rig with a stored hold (`rain`), scale 2, blackout, traffic density 0 and a sandbox pause, and the M04e0 net port returning `null` When the port switches to a fake net, one tick runs, then the port returns `null` again and one tick runs Then:
  - after the first tick `holdWeather(null)`, `setTimeScale(1)`, `release('sandbox')` and `pause(false)` have each been called once, and `mode.sandbox.world.online` is true;
  - `slices.sandbox` is deep-equal to its value before the switch;
  - after the second tick the hold, scale, blackout, density and pause are applied again, once each

  — proof: `pnpm check:unit -- packages/engine/test/modes/sandbox-world.spec.ts`
- AC-7 Given the same rig When actions are dispatched as `mode.cmd {mode:'sandbox'}` Then:
  - `time.shortcut {id:'golden-hour'}` calls `setHour(18.5)` and holds `golden`;
  - `time.sync {hour: 7.5}` is ignored with sync off and calls `setHour(7.5)` with sync on, leaving `SandboxSlice` unchanged;
  - `world.reset` releases everything;
  - an unknown name and malformed arguments change nothing and throw nothing;
  - with M04e0's fake net, every action is still refused with `sandbox.refuse.online`

  — proof: `pnpm check:unit -- packages/engine/test/modes/sandbox-world.spec.ts packages/engine/test/modes/sandbox-guard.spec.ts`
- AC-8 Given a rig running `story` When every table path and every action is dispatched Then:
  - `slices.sandbox` is deep-equal to its value before;
  - no clock, traffic or port spy is called;
  - `mode.cmd` sandbox events reach no sandbox handler

  — proof: `pnpm check:unit -- packages/engine/test/modes/sandbox-world.spec.ts`
- AC-9 Given `appScreen('sandbox', env)` When it is built with a `sandboxWorld` env Then:
  - the tabs are `player`, `weather`, `time` and `world`;
  - the heat and heat-lock button ids (`heat-<n>`, `never-wanted`) are unchanged;
  - each new button's `onPress` is the documented command;
  - the selected preset, speed and density level are `primary`;
  - with `online: true` every new button has `disabled: 'sandbox.refuse.online'`;
  - `DomScreen` and `CanvasScreen` give the same focus order for every tab

  — proof: `pnpm check:unit -- packages/ui/test/phone.spec.ts packages/ui/test/ui-screen-parity.spec.ts`
- AC-10 Given `createSandboxClockSync` with fake timers and a fixed `now` of 07:42 When sync is on in sandbox for 3 minutes, then turned off Then:
  - exactly 4 `time.sync` commands are sent, each with `hour` 7.7;
  - none is sent after it is turned off, while another mode runs, or while `online` is true with sync still on;
  - `dispose()` clears the interval

  — proof: `pnpm check:unit -- packages/ui/test/sandbox-sync.spec.ts`
- AC-11 Given `config/clock.json` When it is validated and scanned Then:
  - it matches the extended schema;
  - the shortcut ids are unique;
  - every id has a `phone.sandbox.time.<id>` key in `en.json`;
  - no new string contains a denylisted term

  — proof: `pnpm check:unit -- packages/engine/test/clock.spec.ts && pnpm build && pnpm ip:strings && pnpm names:lint`
- AC-12 Given a QA build on the synth world with sandbox running When the e2e opens Pause, then the phone, then the Sandbox app Then:
  - **weather:** with Weather → Rain tapped and the phone closed, `__dvBridge.world.sky()` reports `weather` and `next` as `'rain'` within 5 s, and again 20 s later;
  - **time:** with Time → "Golden hour" tapped, `sky().hour` is within 0.1 of 18.5 and the weather is `golden`;
  - **blackout:** with World → Blackout on, `sky().windowFactor` is below 0.5, and after `mode.quit` it returns to 1 within 5 s;
  - **clean run:** no `pageerror` and no refusal toast occur

  — proof: `DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @sandbox-world`

## Test plan
- **Unit (engine):**
  - `clock.hold.spec.ts` (AC-2, AC-3);
  - `sandbox-scale.spec.ts` (AC-4);
  - `modes/sandbox-world.spec.ts` (AC-5, AC-6, AC-7, AC-8);
  - regression: `clock.spec.ts`, `loop.accumulator.spec.ts`, `modes/sandbox-guard.spec.ts`, and the whole `packages/engine/test/modes` suite.
- **Unit (UI):** `phone.spec.ts`, `ui-screen-parity.spec.ts` (AC-9) and `sandbox-sync.spec.ts` (AC-10).
- **Config and IP:** `clock.spec.ts`, `ip:strings`, `names:lint` (AC-11).
- **e2e:** `@sandbox-world` on `chromium-webgl2`, `DV_WORLD=synth` (AC-12); `@world-hash` regression (AC-3).
- **Repository:** typecheck, lint (C02), `check:i18n`, build (AC-1).

## Demo script
1. `pnpm dev` (QA build), then New Game → Sandbox.
2. Pause → Phone → Sandbox → Weather → Rain. Close the phone; it keeps raining.
3. Time → "Fog at dawn": the marine layer sits over the city at 06:00.
4. Time → "Golden hour", then World → 2×: the light moves twice as fast.
5. World → Blackout: the signals go dark and robotaxis hold at junctions (M03b1 behaviour).
6. World → Traffic → Off: ambient cars thin out as they leave view.
7. Quit Sandbox: signals, density, speed and the weather schedule return to normal.

## Effort
0.8 Builder session; about 24 files; risk **medium** (it touches the clock and the loop).

## Risks & fallbacks
- **The `HOLD_T` sentinel breaks a checkpoint or a blend path not listed here.** Fallback: add an explicit `held` byte to the clock resource, re-record the affected goldens under a BD row, and keep AC-3's constant for the never-held path.
- **A failed sandbox exit leaves the scale at 2 for the next mode.** `ModeHost.exitEntry` runs `exit` on the error path too. If a Builder finds a path that skips it, also reset the scale in `ModeHost` when the stack empties, and record a BD row.
- **Density 1.5 strains `mobile-low`.** `activeSlots` caps instances per tier (M03b1), so 1.5 only fills slots the tier already allows. If `pnpm check:perf -- --scenario downtown-rush` regresses, cap the Busy button at 1.0 on `mobile-low` and record a BD row.
- **The phone pauses the sim**, so changes show when it closes; the e2e closes it before reading `sky()`.

## Notes for the Builder
- **Read first:**
  - `packages/engine/src/sim/world/clock.ts` and `packages/engine/test/clock.spec.ts`;
  - `packages/engine/src/sim/loop/sim-core.ts`;
  - in `packages/engine/src/sim/modes/`: `builtin/sandbox.ts`, `builtin/index.ts`, `commands.ts`, `host.ts` (`route`, `exitEntry`), `index.ts` (around `builtinDescriptors` and `createCommandDispatcher`);
  - `packages/modes/story/src/mode.ts` (`onEvent`, the pattern to follow);
  - `packages/shared/src/world/c08-api.ts` (`TrafficControl`) and `packages/world/src/sim/traffic/control.ts`;
  - `packages/ui/src/phone/{apps.ts, pause.tsx}`, `packages/ui/src/screen/types.ts`;
  - M04e0's file;
  - `spec/domains/01-engine-save-modes.md` (`SandboxSlice`, "Time-of-day and weather clock").
- **Order of work:**
  1. the hold and AC-3's constant, recorded before any edit;
  2. the scale;
  3. the port, the table and `onEvent`;
  4. the rig and specs;
  5. the UI and sync;
  6. the text and the e2e.
- **C02.** `clock.ts`, `sim-core.ts` and `sandbox-world.ts` are in lint scope: no `Date`, no timers, no `**`, no `for…in`. Wall time enters only through `time.sync`.
- **IP wall:** every label, key and identifier is original. Do not copy wording, section names or shortcut sets from other sandbox menus or trainer tools; the research checklist names features only. The tab grouping and order (player, weather, time, world) are our own phone-app layout (DL-732), not a checklist's menu tree. The shortcuts follow SF's own fog day, and no label names a real brand or the display name. M04e5 has merged first, so `ip:strings` already enforces its `trainer-*` patterns.
- **Secrets:** none.
