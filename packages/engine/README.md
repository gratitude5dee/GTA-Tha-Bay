# @dv/engine

The game engine: deterministic sim (`src/sim`), headless host (`src/headless`), and, from other milestones, workers, client (input, camera, animation, audio) and platform (renderer host, tiers, XR, telemetry).

## Contents (M01a1)

| Path | What |
|---|---|
| `src/sim/ecs/` | ECS facade over `bitecs@0.4.0`: `EcsWorld` (stores, queries, command buffer, snapshot), `EntityAllocator` (handles, generations), `StringTable`, `ComponentRegistry`, engine components v1 |
| `src/sim/loop/` | `SimCore` (fixed-step accumulator, ten `SimStage`s, command flush per stage), `SystemScheduler`, `computeStateHash`, `TickStats` |
| `src/sim/services.ts` | `EngineServices` (RNG streams, current `InputFrame`), `SimResource` (hashed and checkpointed state outside the ECS) |
| `src/headless/` | `createHeadlessSim(cfg, setup)`: `step`, `hash`, `snapshot`, `restore`, `stats`; runs in Node with no DOM or GPU |

Not here yet: Rapier wrapper, `sim.worker` and transports (M01a2), input binders and the character (M01b1).

## Import rules

- `src/sim/**` imports only `@dv/shared`, `bitecs` and itself: no `three`, no `src/client/**`, no DOM. `tsconfig.sim.json` (no DOM lib, no `@types/node`) compiles it, and the C02 determinism lint checks it. `src/sim/save/**` is exempt (async IO outside ticks).
- Systems read `ctx.ecs` and `ctx.services`; they change structure only through `ecs.commands`, which applies at the end of the issuing stage. Field writes are immediate.
- Persistent identity is a `StableKey`; an `EntityId` never leaves the session and `EntityHandle` is the only reference held across ticks.
- Query results are ascending entity ids (a function of the entity set, so a restored world iterates the same way).

## Scripts

```
pnpm --filter @dv/engine test              # all specs (about 15 s, mostly the determinism scenario)
pnpm --filter @dv/engine test:lint-bans    # fixtures in test/fixtures/banned/ must fail the determinism lint
pnpm --filter @dv/engine test:headless     # sim boots without window, document, navigator.xr; snapshot/restore
pnpm --filter @dv/engine test:determinism  # scenario ecs-churn, 10,000 ticks, hashes vs test/golden/
DV_UPDATE_GOLDEN=1 pnpm --filter @dv/engine test:determinism   # rewrite the golden file (review the diff)
```

`pnpm check:unit` runs all of them through the root Vitest config.
