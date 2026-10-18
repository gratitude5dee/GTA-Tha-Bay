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

Not here yet: input binders and the character (M01b1), vehicles (M03a1), saves (M04a).

## Debug cube view and QA

- The home page boots the engine and draws `physics-drop` in a corner canvas. QA builds (`VITE_DV_QA=1`) add `window.__dvBridge.engine`: `observe()` (tick, stats, hash, transport, physicsBuild, restarts, snapshotReuse, records), `act({ t: 'debug.crash' | 'debug.stall', ms | 'debug.rebase' })`, `step(n)`, `setPaused()`.
- Flags (QA only): `?profile=canonical` (deterministic-compat build), `?transport=pm` (force the postMessage fallback).
- `/qa/determinism.html` (QA builds) runs the golden vectors and the 10,000-tick scenario in `sim.worker` and prints the final hash; `pnpm check:e2e -- --project=webkit-webgl2 --grep @determinism` compares it with `test/golden/determinism.physics-drop.json`.

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
pnpm --filter @dv/engine test:determinism  # scenarios ecs-churn and physics-drop, 10,000 ticks, hashes vs test/golden/
DV_UPDATE_GOLDEN=1 pnpm --filter @dv/engine test:determinism   # rewrite the golden files (review the diff)
pnpm --filter @dv/engine bench:physics     # tick cost, init and restart time of both Rapier builds
```

`pnpm check:unit` runs all of them through the root Vitest config.
