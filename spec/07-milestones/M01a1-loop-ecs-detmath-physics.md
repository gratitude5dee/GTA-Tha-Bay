# M01a1 — loop-ecs-detmath-physics

## Goal
After this session the repository has the pure, deterministic core of the engine, and all of it runs and is tested in Node with no worker, browser or physics. `packages/shared` holds the C01, C02 and C03 contract files plus `detmath`, the seeded RNG streams, `ctrU32`, the hashes and `canonicalize`. `packages/engine` holds the bitECS facade (`EcsApi`), the engine component registry v1, the fixed-step `SimCore` (accumulator with the 0.15 s catch-up clamp, ten `SimStage`s, system scheduler, `stateHash`), the determinism lint, and the headless harness `createHeadlessSim`. **Split boundary (from `spec/domains/01-engine.md` §8, row M01a):** M01a1 takes every M01a part that is pure and runs in Node: shared contracts, detmath, RNG, hash, JSON, ECS, loop, lint bans and the headless host. M01a2 takes the Rapier wrapper, the `sim.worker` with its transports, the debug cube view and the cross-browser 10,000-tick hash test. The kbm and gamepad binders that §8 lists under M01a move to M01b1, where the character first consumes them.

## Requirements
- R-PLAT-03: provides the deterministic tick and ECS that the WASM physics in M01a2 plugs into.
- R-ENG-02: `LoopStats` (tick p50/p99, dropped seconds, overruns) is the sim half of the performance budgets.
- R-ROLL-02 (support): `stateHash`, quantized `InputFrame` and seeded streams are the hooks that M12b netcode and desync detection use.
- R-MODE-03 and R-MODE-04 (support): fighter frame data and the tycoon sim need `detmath` and `ctrU32` to agree in every engine.

## Depends on
- **M00** (bootstrap): pnpm workspaces, root `package.json` with the canonical commands, strict `tsconfig.base.json`, ESLint flat config, vitest, Playwright config, `packages/shared` package with C13 types at `packages/shared/src/platform/c13.ts`, and CI. If M00 did not create `packages/shared` or `packages/engine`, create them here with `name` `@dv/shared` and `@dv/engine`.
- Contracts: C01 1.0.0, C02 1.1.0, C03 1.1.0 (`prompt-pack/06-SHARED-CONTEXT.md` v1.1 §4.2; TypeScript in `spec/domains/01-engine-contracts.md`).

## Scope in
- `c01-ecs.ts`, `c02-loop.ts` and `c03-input.ts` copied verbatim from `01-engine-contracts.md`, including the C02 1.1 and C03 1.1 additions. C03 ships types only; binders arrive in M01b1. The `InputFrame` type is needed now because determinism rule 4 says sim input arrives only as quantized frames.
- `detmath`: `dsqrt, dsin, dcos, datan2, dexp, dlog, dpow, dhypot, lerpAngle, normalizeAngle`, plus a frozen `detmath` namespace object with the C02 rule 2 names (`sqrt`, `sin`, …). Only `+ − × ÷`, the allowed `Math.*` functions and integer bit operations.
- RNG: `splitmix32`; `xoshiro128**` (`Math.imul`); `Rng` with `nextU32`, `nextFloat` (in [0, 1), 2⁻³² resolution), `range(lo, hi)`, `getState()` and `setState()`; `streams(seed)` keyed by name and seeded with `splitmix32(seed ^ fnv32(name))`; the stateless `ctrU32(seed, stream, counter)` (C02 1.1).
- Hashes: `fnv32`; an incremental two-lane `Fnv64` (`u8`, `u32`, `f32`, `f64`, `str` feeders, `Math.imul` only) and `fnv64Hex`; a pure synchronous `sha256Hex(bytes | string)`.
- `canonicalize(value)`: sorted keys, `-0` → `0`, throws on non-finite numbers, `undefined`, functions and non-plain objects; numbers use `JSON.stringify` formatting.
- ECS facade over `bitecs@0.4.0`:
  - entity existence and queries come from bitECS;
  - SoA typed-array stores of length `MAX_ENTITIES`, with one `SharedArrayBuffer` per world when `shared: true`, else `ArrayBuffer`s;
  - `EntityHandle` = gen·2²⁰ + id, generation wrap 4,095 → 1, and id 0 never handed out;
  - `StringTable`; `byKey`/`keyOf`; `CommandBuffer` applied at the end of the issuing stage, in issue order;
  - entities spawned without a key get `pfb:<prefabId>:<serial>`;
  - registry v1 for ids 1–24 and tags 30–39 (C01 table), with checks for the id ranges and for duplicate names.
- `SimCore`:
  - `advance(dtSec, timeScale, paused)` implements C02 rules 1, 3 and 4: it accumulates, clamps at `MAX_FRAME_DT`, runs `while (acc ≥ SIM_DT)` ticks, and returns ticks run and `alpha`;
  - `stepOnce()`;
  - stage loop 0–9 and a scheduler ordered by stage, then `order`, then `id` (string compare). `rateDivisor` uses `offset = fnv32(id) % div`. `profiles` filtering is included;
  - `stateHash` per C02 rule 7;
  - `LoopStats` and a `SimServices` bag with `rng`.
- `createHeadlessSim(cfg, setup)`: `step(n, input?: (tick) => InputFrame)`, `hash()`, `snapshot(): Uint8Array`, `restore(bytes)` (ECS stores, string table, allocator and RNG states), `stats`.
- Determinism lint (C02 determinism rule 1), plus a sim-only tsconfig that has no DOM lib.
- Node determinism scenario `ecs-churn`.

## Scope out
- Rapier, floating origin, physics systems and the physics part of snapshots: M01a2.
- `sim.worker`, SAB rings, the `postMessage` fallback, `SimHost`, the snapshot triple buffer, browser vector checks and the cross-browser hash test: M01a2.
- kbm and gamepad binders, `InputRouter`, C04 types, the character controller and cameras: M01b1.
- Timeline export (A-02 recorder): M05a1. Saves (`packages/engine/src/sim/save/**`): M04a. Prediction ring: M12b.

## Deliverables
- `packages/shared/src/contracts/{c01-ecs.ts, c02-loop.ts, c03-input.ts, index.ts}`.
- `packages/shared/src/{detmath.ts, rng.ts, hash.ts, json.ts, index.ts}`. If M00a or M00b already created `hash.ts` or `json.ts`, extend them without changing existing exports.
- `packages/shared/test/{detmath.vectors.spec.ts, rng.streams.spec.ts, hash.fnv.spec.ts, hash.sha256.spec.ts, json.canonical.spec.ts}`.
- `packages/shared/test/golden/{detmath.v1.json, rng.v1.json, ctr.v1.json, fnv.v1.json}`. Doubles are stored as 16-hex-digit IEEE-754 bit strings.
- `packages/shared/scripts/write-vectors.ts` and the package script **`vectors:write`** (`pnpm --filter @dv/shared vectors:write`). It refuses to overwrite a golden file unless `--force` is passed.
- `packages/shared/package.json` script **`test`** (`vitest run`).
- `packages/engine/package.json`:
  - dependency `bitecs@0.4.0`;
  - scripts **`test`**, **`test:lint-bans`**, **`test:headless`**, **`test:determinism`**, each a `vitest run` over the matching spec files. `pnpm check:unit` must also run them; check the M00 vitest workspace globs.
- `packages/engine/tsconfig.json` and `packages/engine/tsconfig.sim.json` (`include: src/sim/**`, `lib: ["ES2023"]`, `types: []`). Append `tsc -p packages/engine/tsconfig.sim.json --noEmit` to the explicit `pnpm typecheck` chain (M00); `tsc -p` does not check project references.
- `packages/engine/src/sim/ecs/{world.ts, allocator.ts, strings.ts, commands.ts, registry.ts, components.ts}`.
- `packages/engine/src/sim/loop/{sim-core.ts, scheduler.ts, state-hash.ts, stats.ts}` and `packages/engine/src/sim/services.ts`.
- `packages/engine/src/headless/index.ts`.
- `packages/engine/test/{ecs.handles.spec.ts, ecs.commands.spec.ts, loop.accumulator.spec.ts, loop.scheduler.spec.ts, headless.noDom.spec.ts, lint.bans.spec.ts, determinism.node.spec.ts}`, `test/scenarios/ecs-churn.ts`, `test/golden/determinism.ecs-churn.json`, `test/fixtures/banned/*.ts` (one file per banned category).
- `config/eslint/determinism.mjs`, imported by the root `eslint.config.*`.
- `packages/shared/README.md` and `packages/engine/README.md` (purpose, import rules, scripts; R-ENG-01).

## Interfaces
- C01, C02 and C03 are created verbatim. Do not change any shape. If a shape cannot compile (for example `QualityTierId` imported from `../platform/c13`), fix the import path and record the problem in `docs/decisions/` as a proposal for the Architect. Never edit the contract.
- New engine-internal APIs (not contracts): `SimCore`, `createHeadlessSim`, `Fnv64`, `detmath`.

## Acceptance criteria
- AC-1 Given a clean clone after M00 When the install, typecheck, lint and build commands run Then all exit 0, and the sim tsconfig compiles with no DOM lib — proof: `pnpm install && pnpm typecheck && pnpm lint && pnpm build`
- AC-2 Given `detmath.v1.json` When the shared tests run Then every function returns the golden IEEE-754 bits for every vector (at least 2,000 inputs per function, including ±0, subnormals, ±π boundaries, 1e-300 and 1e300), and the error against `Math.*` stays within the bounds in Notes — proof: `pnpm --filter @dv/shared test`
- AC-3 Given seed 0xC0FFEE When streams `world` and `weather` are drawn 1,000 times each Then the sequences differ, a re-seeded stream repeats its sequence exactly, `setState(getState())` taken at draw 500 resumes the identical tail, and `ctrU32` and `xoshiro128**` outputs equal `ctr.v1.json` and `rng.v1.json` — proof: `pnpm --filter @dv/shared test`
- AC-4 Given 10,000 random byte strings (lengths 0–4,096, seeded) When `fnv32` and `Fnv64` run Then each equals a BigInt reference implementation inside the spec file, and `sha256Hex` equals `node:crypto` SHA-256 on 1,000 random inputs plus the empty input and a 1 MiB input — proof: `pnpm --filter @dv/shared test`
- AC-5 Given objects with shuffled keys, nested arrays and `-0` When `canonicalize` runs Then the output is byte-identical for every permutation, and `NaN`, `Infinity` and `undefined` throw `CanonicalizeError` with the JSON path — proof: `pnpm --filter @dv/shared test`
- AC-6 Given the fixture files in `packages/engine/test/fixtures/banned/` When ESLint runs on them with the determinism config Then every fixture reports at least one error, and together they cover every API in C02 determinism rule 1. Running the same rules over `packages/*/src/**` reports zero errors — proof: `pnpm --filter @dv/engine test:lint-bans && pnpm lint`
- AC-7 Given a `SimCore` at tick 0 When `advance(0.5, 1, false)` runs Then exactly 9 ticks run, `droppedSec` is 0.35 ± 1e-9 and 0 ≤ `alpha` < 1. 60 calls of `advance(1/60)` run 60 ticks in total; `paused: true` runs 0 ticks; `timeScale: 2` throws outside sandbox or debug sessions — proof: `pnpm --filter @dv/engine test`
- AC-8 Given systems registered in random order When 8 ticks run Then the execution log is sorted by stage, then order, then id, and a `rateDivisor: 2` system runs exactly on ticks where `(tick + fnv32(id) % 2) % 2 === 0` — proof: `pnpm --filter @dv/engine test`
- AC-9 Given a world When a stage issues spawn, add, despawn and remove commands Then they apply after that stage in issue order. A handle to a despawned entity resolves to `null` after the id is reused; generation 4,095 wraps to 1; id 0 is never returned; spawning the 65,535th live entity succeeds and the 65,536th throws `EntityLimitError` (id 0 reserved, store length `MAX_ENTITIES`) — proof: `pnpm --filter @dv/engine test`
- AC-10 Given Node with `window`, `document` and `navigator.xr` undefined When the headless sim boots and steps 600 ticks Then it completes, and `snapshot()` → `restore()` at tick 300 followed by a re-run gives the same hash at tick 600 — proof: `pnpm --filter @dv/engine test:headless`
- AC-11 Given scenario `ecs-churn` (seed 0xC0FFEE; each tick it spawns and despawns through commands and writes RNG-driven field values for 2,000 entities) When it runs 10,000 ticks twice Then the hashes at every 600th tick and the final hash are identical, and they equal `determinism.ecs-churn.json`. Changing one field at tick 5,000 changes every later checkpoint — proof: `pnpm --filter @dv/engine test:determinism`
- AC-12 Given the branch When CI runs the unit suite and the preview deploy Then both pass and the deployed app is unchanged from M00 — proof: `pnpm check:unit && pnpm deploy:preview`

## Test plan
- **Unit:** `shared/detmath.vectors`, `shared/rng.streams`, `shared/hash.fnv`, `shared/hash.sha256`, `shared/json.canonical` (`pnpm --filter @dv/shared test`); `engine/ecs.*`, `engine/loop.*` (`pnpm --filter @dv/engine test`).
- **Lint and integration (Node):** `engine/lint.bans` (`test:lint-bans`), `engine/headless.noDom` (`test:headless`), `engine/determinism.node` scenario `ecs-churn` (`test:determinism`).
- All of the above also run under `pnpm check:unit`. The browser and device checks start in M01a2.

## Demo script
1. `pnpm install && pnpm --filter @dv/shared test`: vectors, RNG and hashes pass.
2. `pnpm --filter @dv/engine test:determinism`: prints the final hash, which equals the golden file.
3. Put a `Math.random()` call in a scratch file under `packages/engine/src/sim/`, run `pnpm lint`, see the error, delete the file.

## Effort
1 Builder session; about 34 files; risk **medium**. Getting `detmath` accurate is the main time sink, and the bitECS 0.4 API details are the second.

## Risks & fallbacks
- **bitECS 0.4.0 entity-id behaviour.** Whether ids start at 0 and in what order they are recycled is UNVERIFIED. The facade must not depend on it: hold a sentinel entity if id 0 would be returned, and keep generations in the engine's own `Gen` store. Fallback: if bitECS queries cannot run over facade-owned stores, keep bitECS for existence and queries only.
- **`const enum` across packages under per-file transpilation** (Vite and vitest). Set `preserveConstEnums: true`, import the enums as values, and check that a built consumer resolves `SimStage.Publish` at runtime.
- **detmath accuracy.** Correctly rounded basic operations make any fixed algorithm portable; if a bound fails, raise the polynomial degree.
- **`Math.sqrt` cross-engine identity** is UNVERIFIED (U-ENG-1), so `dsqrt` uses Newton iteration and never delegates.

## Notes for the Builder
- Read first: `01-engine-contracts.md` §C01–§C03 and the 1.1 section; `01-engine.md` §2.3, §2.12, §9; `06-SHARED-CONTEXT.md` §5.
- Toolchain (F-016): Node 22 LTS per M00 `.nvmrc`, TypeScript 6.0.3, `vitest@5.0.5` and `@playwright/test@1.64.1` [research/stack-rendering-platform.md §5.5], `bitecs@0.4.0` (MPL-2.0, used unmodified [research/stack-rendering-platform.md §5.2]). The ESLint core version is whatever M00 pinned (not in the ledger, UNVERIFIED). M00b's `config/license-allowlist.json` carries an `exceptions` entry for `bitecs` (MPL-2.0, `scope: "prod"`); if it is missing, add that entry (JSON has no comments).
- Order of work: contracts, hash/json, rng, detmath, ECS, loop, headless, lint, then golden files (`vectors:write` last).
- **detmath bounds** (design values; tests compare with `Math.*` in Node): `dsqrt` ≤ 1 ulp; `dsin`/`dcos` absolute ≤ 2e-15 for |x| ≤ 1e5; `datan2` ≤ 4e-15; `dexp`/`dlog` relative ≤ 4e-15; `dpow` relative ≤ 1e-13, integer exponents by exact repeated squaring. Read exponent bits through a `Float64Array`/`Uint32Array` alias, assert little-endian at load, and range-reduce with two-part constants.
- **`stateHash` cost:** cache the `StableKey`-sorted entity order and re-sort only after a structural change. Feed every f64 as two u32 words. Map `-0` to `0` and every NaN to the canonical bits `0x7ff8000000000000`, and count NaNs in `LoopStats` as a bug signal.
- **Lint scope:** `packages/shared/src/**`, `packages/engine/src/sim/**` and `packages/modes/*/src/sim/**`, excluding `packages/engine/src/sim/save/**`. Tests and scripts are outside the scope, so the BigInt and `node:crypto` references are allowed there. Ban `.sort()` with zero arguments through `no-restricted-syntax` (C01 rule 4).
- Secrets: none for code. `pnpm deploy:preview` needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (M00, CI only). Locally without them, run `pnpm build` and leave the deploy to CI.
