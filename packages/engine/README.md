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

Not here yet: touch, the anim graph, free cam and the debug panel (M01b2), vehicles (M03a1), saves (M04a).

## Debug cube view and QA

- The home page boots the engine and draws `physics-drop` in a corner canvas. QA builds (`VITE_DV_QA=1`) add `window.__dvBridge.engine`: `observe()` (tick, stats, hash, transport, physicsBuild, restarts, snapshotReuse, records), `act({ t: 'debug.crash' | 'debug.stall', ms | 'debug.rebase' })`, `step(n)`, `setPaused()`.
- Flags (QA only): `?profile=canonical` (deterministic-compat build), `?transport=pm` (force the postMessage fallback), `?debug=1` (the canvas fills the window: click it for Pointer Lock; WASD, Shift, Space, V camera, C shoulder, Esc or P pause).
- M01b1 adds to `observe()`: `player { pos, vel, control, owner, grounded }` and `camera { mode, allowedDistance, lastToggleRefused, locked }`; `act()` takes `debug.teleport { pos }`, `debug.ragdoll` and `debug.camera.lock { on }`.
- `/qa/determinism.html` (QA builds) runs the golden vectors and the 10,000-tick scenarios `physics-drop` and `walk-drop` in `sim.worker` and prints the final hashes; `pnpm check:e2e -- --project=webkit-webgl2 --grep @determinism` compares them with `test/golden/determinism.{physics-drop,walk-drop}.json`.
- `DV_E2E_PORT=<port>` moves the Playwright web server off 8788, which parallel Builders on one machine need.

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
