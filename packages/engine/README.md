# @dv/engine

The game engine: deterministic sim (`src/sim`), headless host (`src/headless`), and, from other milestones, workers, client (input, camera, animation, audio) and platform (renderer host, tiers, XR, telemetry).

## Contents (M01a1)

| Path | What |
|---|---|
| `src/sim/ecs/` | ECS facade over `bitecs@0.4.0`: `EcsWorld` (stores, queries, command buffer, snapshot), `EntityAllocator` (handles, generations), `StringTable`, `ComponentRegistry`, engine components v1 |
| `src/sim/loop/` | `SimCore` (fixed-step accumulator, ten `SimStage`s, command flush per stage), `SystemScheduler`, `computeStateHash`, `TickStats` |
| `src/sim/services.ts` | `EngineServices` (RNG streams, current `InputFrame`), `SimResource` (hashed and checkpointed state outside the ECS) |
| `src/headless/` | `createHeadlessSim(cfg, setup)`: `step`, `hash`, `snapshot`, `restore`, `stats`; runs in Node with no DOM or GPU |

## Contents (M01a2)

| Path | What |
|---|---|
| `src/sim/physics/` | `PhysicsBackend` (spec'd interface), `RapierBackend` over `rapier3d-simd-compat` or `-deterministic-compat` (one build per session, `init()` retry), floating origin, chunk statics (heightfield and prisms), `PhysicsPre/Step/Post` systems, collision groups from `config/physics.json` |
| `src/sim/transport/` | `{ v, t, seq, p }` envelopes and guards, input block (`Atomics` edge latching), SPSC command and event rings, snapshot triple buffer with a seqlock, SAB transport and the `postMessage` fallback |
| `src/sim/runtime.ts`, `src/workers/sim.worker.ts` | the loop inside the worker: boot, frame coalescing, control and debug messages, stats |
| `src/sim/sim-host.ts` | `SimHostImpl` (C02 `SimHost`): start, frame, restart, stall and error detection |
| `src/sim/scenarios/`, `src/sim/fixtures/` | `physics-drop` and the fixture world (ground and 12 boxes) |
| `src/sim/input/bot-input.ts`, `src/sim/qa/` | QA only: `BotInput`, golden vector checker and the cross-browser determinism suite (never in production builds) |
| `src/client/boot/`, `src/client/snapshot/`, `src/client/debug/` | `bootEngine()`, snapshot reader, interpolation, three object pool, `window.__dvBridge.engine` (QA) |
| `bench/physics-builds.ts` | `pnpm --filter @dv/engine bench:physics`: tick cost of both builds, writes `bench/results/physics-builds.json` |

## Contents (M01b1)

| Path | What |
|---|---|
| `src/client/input/` | `RawInputState`, `KbmBinder` (Pointer Lock with `unadjustedMovement`, release on blur), `GamepadBinder` (W3C standard mapping only), `GestureTracker`, `InputRouterImpl` (context stack, gestures, chords, hold-to-toggle, overrides, rebind capture, look), quantization, `writeInputFrame` into the input block |
| `config/input/defaults.{kbm,gamepad}.json` | default maps for `onFoot` and `menu` (schema `config/schemas/input-map.schema.json`) |
| `src/sim/control/` | `onFootSystem` (PhysicsPre: speeds, hill factor, jump, KCC move), `ownershipSystem` (Control: Ready/Waiting/Entering/Active/Leaving, teleport 700/701, ragdoll stub 300/301), state ids |
| `src/sim/camera/collision.ts` | Publish-stage sphere cast from the chest anchor for both shoulders, the `CameraDirective` the snapshot side block carries |
| `src/sim/prefabs/`, `assets/prefabs/player.default.json` | `PrefabRegistry` (`PrefabService`), prefab JSON schema, the player prefab (`Transform` is the feet) |
| `src/client/camera/rig.ts` | `CameraRigImpl`: tp/fp, lag smoothing, pull-in and 0.3 s ease-out, fp/tp toggle and its lock |
| `src/sim/fixtures/walk-course.ts`, `src/sim/scenarios/walk-drop*.ts` | the 0.35 m and 0.5 m steps, the 10 % grade, the 50 degree bank; `walk-drop` (default page scenario) and its seeded bot |

Not here yet: vehicles (M03a1), saves (M04a). M01b2 adds the gray-box block, touch, the anim graph, the audio bus skeleton, the F3 panel, the F4 free cam and the XR smoke (below).

## Debug cube view and QA

- The home page boots the engine and draws `physics-drop` in a corner canvas. QA builds (`VITE_DV_QA=1`) add `window.__dvBridge.engine`: `observe()` (tick, stats, hash, transport, physicsBuild, restarts, snapshotReuse, records), `act({ t: 'debug.crash' | 'debug.stall', ms | 'debug.rebase' })`, `step(n)`, `setPaused()`.
- Flags (QA only): `?profile=canonical` (deterministic-compat build), `?transport=pm` (force the postMessage fallback), `?debug=1` (the canvas fills the window: click it for Pointer Lock; WASD, Shift, Space, V camera, C shoulder, Esc or P pause).
- M01b1 adds to `observe()`: `player { pos, vel, control, owner, grounded }` and `camera { mode, allowedDistance, lastToggleRefused, locked }`; `act()` takes `debug.teleport { pos }`, `debug.ragdoll` and `debug.camera.lock { on }`.
- `/qa/determinism.html` (QA builds) runs the golden vectors and the 10,000-tick scenarios `physics-drop` and `walk-drop` in `sim.worker` and prints the final hashes; `pnpm check:e2e -- --project=webkit-webgl2 --grep @determinism` compares them with `test/golden/determinism.{physics-drop,walk-drop}.json`.
- `DV_E2E_PORT=<port>` moves the Playwright web server off its default 8790 (never 8788, the port of `pnpm dev`; a server already listening is never reused), which parallel Builders on one machine need.

## Gray-box block, touch, tools (M01b2)

- The home page boots the `civic-graybox` scenario: the M01f fixture (`tests/fixtures/world/civic-graybox/`, four 256 m chunks, 12 boxes, a four-way road). The page fetches the packs, `sim.worker` decodes `p0` and adds one chunk's colliders per tick, `client/graybox/mesher.ts` draws terrain, roads and buildings (at most 6 objects per chunk). The title screen sits over the live world; Start hides it; `?debug=1` skips it. `?world=walk-drop` (QA) boots the cube course the M01b1 specs use.
- Touch: `client/input/touch.ts` (floating stick, right-half look, buttons; Pointer Events, TouchEvents as a fallback) and `touch-overlay.ts` (the DOM layer from `config/input/touch/default-right.json`). It shows in play on touch devices, or with `?touch=1`.
- QA tools with `?debug=1`: F3 sim panel (median fps of 120 frames, tick p50 and p99, dropped seconds), F4 free cam (WASD, Shift, Space/Q/E; the sim keeps running), and "Enter VR (smoke)" when `immersive-vr` is supported (`?xr-emulate=quest3` installs IWER). `observe()` gains `world`, `play`, `touch`, `audio`, `debug`, `xr`, `chunksLoaded` and `camera.{opacity,near,far,pos}`; the bridge has `setPlay(on)` and `endXr()`.
- Config: `config/engine-tiers.json` (anim bands, voices, ragdolls per tier), `config/audio.json` (buses, duck, footstep), `config/input/defaults.touch.json`; schemas under `config/schemas/`.
- Device passes: `tools/ci/checklists/M01b2-iphone.json` and `M01b2-quest3.json` (`pnpm perf:checklist -- <file>`).

## Import rules

- `src/sim/**` imports only `@dv/shared`, `bitecs`, the two Rapier packages and itself: no `three`, no `src/client/**`, no DOM. `tsconfig.sim.json` (no DOM lib, no `@types/node`) compiles it, and the C02 determinism lint checks it. `src/sim/save/**` is exempt (async IO outside ticks).
- Systems read `ctx.ecs` and `ctx.services`; they change structure only through `ecs.commands`, which applies at the end of the issuing stage. Field writes are immediate.
- Persistent identity is a `StableKey`; an `EntityId` never leaves the session and `EntityHandle` is the only reference held across ticks.
- Query results are ascending entity ids (a function of the entity set, so a restored world iterates the same way).

## Scripts

```
pnpm --filter @dv/engine test              # all specs (about 15 s, mostly the determinism scenario)
pnpm --filter @dv/engine test:lint-bans    # fixtures in test/fixtures/banned/ must fail the determinism lint
pnpm --filter @dv/engine test:headless     # sim boots without window, document, navigator.xr; snapshot/restore
pnpm --filter @dv/engine test:determinism  # scenarios ecs-churn, physics-drop and walk-drop, 10,000 ticks, hashes vs test/golden/
DV_UPDATE_GOLDEN=1 pnpm --filter @dv/engine test:determinism   # rewrite the golden files (review the diff)
pnpm --filter @dv/engine bench:physics     # tick cost, init and restart time of both Rapier builds
```

`pnpm check:unit` runs all of them through the root Vitest config.

## QA harness

`src/qa` is the one way every mode proves it is deterministic (M04d; `spec/domains/13-qa.md` section 3). QA builds and Node only: a production chunk holds none of it (`pnpm check:bundle`).

- `RunSpec` = `{ suite, scenario, seed, profile: 'canonical', maxTicks, checkpointEvery, bot: { driver, params? } }`. `createCanonicalRunner(env).run(spec)` boots the scenario through the loader registered for `suite`, steps it with the bot's frames written as player 0's `InputFrame`, and returns a `StateHashTrace`: the FNV-1a-64 `stateHash` every `checkpointEvery` ticks and at the end. A bot that never finishes stops at `maxTicks` with outcome `timeout`.
- Drivers: `registerBot(id, factory)` (duplicate ids throw), `getBot(id)` (an unknown id lists the registered ones). `lines` replays a `*.line.json` (`params.line`; `params.noise` adds a seeded steer offset from the `bot` RNG stream). Mode owners register `story.autoplayer`, `racing.line`, `fighter.cpu`, `tycoon.<policy>` in their milestones.
- Loaders: suite `engine`, scenario `walk-drive` = the gray-box Civic Center block with the sedan and the player at its wheel. Its statics come from the committed bytes `tests/fixtures/world/civic-graybox/p0-64-64.pack`, hash-checked against `hashes.json`: Node reads the file (`qa/node.ts`), the determinism page gets the same bytes through a Vite `?url` import and never touches the asset catalog (so a `DV_WORLD=synth` build gives the same trace, DL-699).
- Goldens: `tests/golden/<suite>/<name>.json`, canonical JSON, `build` normalised to `golden`. Compare with `checkGolden(trace, name)` (Node, `qa/golden.ts`).

Run a spec in the browser: `/qa/determinism.html?run=<base64url RunSpec>` (QA build) runs it in `sim.worker` and publishes the trace on `__dvBridge.engine.qa.trace`; `__dvBridge.engine.qa.run(spec)` does the same for any number of specs after load. `tests/e2e/det/suites.ts` lists each det tag with its specs and goldens (or `pending: <milestone>`); `det-suites.spec.ts` compares Chromium and WebKit with the Node goldens checkpoint by checkpoint.

### Golden update procedure

```
DV_UPDATE_GOLDEN=1 pnpm check:unit -- packages/engine/test/qa     # rewrites only tests/golden/engine/*.json of those runs
tsx tools/ci/verifiers-lock.ts --write                            # refresh tools/ci/verifiers.lock.json
```

Review the diff. The pull request carries the label `golden-update` and a line `Golden-update: <one-line reason>` in its body: changing a verifier (runner, driver, det spec, econ-sim, a golden) together with the code it verifies fails `tools/ci/test/verifiers-lock.test.ts` without both. CI never runs with `DV_UPDATE_GOLDEN` set; the runner throws before it steps.
