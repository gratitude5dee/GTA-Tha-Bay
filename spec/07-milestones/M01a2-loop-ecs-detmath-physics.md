# M01a2 — loop-ecs-detmath-physics

## Goal
After this session the M01a1 core runs inside `sim.worker` with Rapier physics, and the deployed app shows it. The home page boots the engine: it checks isolation, spawns `sim.worker`, picks the SAB transport (or the `postMessage` fallback) and loads exactly one Rapier build. The page then draws a debug cube view of 64 boxes dropping onto a fixture ground, interpolated one tick behind from the snapshot triple buffer. A QA page runs the 10,000-tick `canonical` scenario plus the shared golden vectors in Chromium and WebKit and proves that their hashes equal the Node golden. **Split boundary (`spec/domains/01-engine.md` §8, row M01a):** this session takes the Rapier wrapper with both builds and the floating origin, the `sim.worker` bootstrap, the SAB and `postMessage` transports, the debug cube view and the cross-browser determinism test. Character movement, casts and binders belong to M01b1.

## Requirements
- R-PLAT-03: WASM physics (Rapier 0.21.0) in a worker, with the WebGPU-first renderer from M00 drawing the result.
- R-ENG-02: tick p50/p99, `droppedSec` and per-build tick cost are measured and exposed to QA.
- R-ROLL-02 (support): the `canonical` profile gives identical hashes in Node, Chromium and WebKit, which validated rooms (M12b), race ghosts and autoplay rely on (D-12, D-13).
- R-PLAT-01: the app stays an installable PWA; Rapier chunks follow the shell precache rules.

## Depends on
- **M01a1** (shared core, ECS, `SimCore`, headless host, golden files).
- **M00:**
  - Playwright projects `chromium-webgpu`, `chromium-webgl2`, `webkit-webgl2`, `xr-quest3`, with a `webServer` that serves a `VITE_DV_QA=1` build with COOP/COEP;
  - the minimal `RendererHost` (WebGPURenderer, WebGL2 fallback);
  - the `QaFlags` parser and `_headers`.
  If the `webServer` serves a production build, add a QA build step to `playwright.config.ts`.
- Contracts: C01 1.0.0, C02 1.1.0 (snapshot layout, `FrameSignal`, `SimHost`, `SimControlMessage`), C03 1.1.0 (`InputFrame`, `BotInput`).

## Scope in
- **`PhysicsBackend`**, exactly as in `01-engine-contracts.md` "Engine service interfaces", backed by `@dimforge/rapier3d-simd-compat@0.21.0` (profile `local`) or `@dimforge/rapier3d-deterministic-compat@0.21.0` (profile `canonical`). Rules:
  - the build is chosen by dynamic import, one per session;
  - `init()` retries three times with jittered backoff, then rejects with `PhysicsInitError {attempts}`.
  Implemented now: `init`, `origin`, `rebase`, `step`, `add/removeChunkStatics` (heightfield and prisms from `StaticShapeSet`), `createBody`, `removeBody`, `readBody`, `setKinematicTarget`, `applyImpulse`, `snapshot`/`restore` (Rapier `takeSnapshot`/`restoreSnapshot`, F-014). `character`, `vehicle`, `castRay` and `castSphere` throw `NotImplementedError` naming M01b1 (casts, character) or M03a1 (vehicle).
- **Floating origin:**
  - ECS positions are f64 ENU and Rapier works in f32 around `origin`;
  - `rebase` shifts dynamic bodies and rebuilds statics;
  - automatic rebase when the `LocalPlayer`-tagged entity, or the entity named in config, is more than 1,000 m from the origin.
- **Physics systems:**
  - `PhysicsPre`: kinematic targets from ECS;
  - `PhysicsStep`: `step(SIM_DT, 1)`;
  - `PhysicsPost`: read back `Transform`/`Velocity`, with f32 widened to f64 deterministically.
  `BodyRef` links ECS and Rapier.
- **`config/physics.json`** (gravity, solver iterations, collision groups) with a JSON Schema.
- **Transport** (`packages/engine/src/sim/transport/`):
  - every message is `{ v: 1, t, seq, p }`, with type guards used on both sides;
  - input block: an `Int32Array` with `Atomics.or` for pressed and released edges on main, and `Atomics.exchange` per tick in the worker, so sub-tick taps reach exactly one tick (C03 rule 2);
  - command ring (SPSC, main → worker);
  - snapshot triple buffer: 3 × 8,192 × 64 B, the C02 record layout, a seqlock header, and an 8 KiB side block holding UTF-8 JSON;
  - event ring (worker → main); on overflow it drops the event and counts `dropped`, never blocking;
  - wake-ups through `Atomics.notify`/`Atomics.waitAsync`;
  - `postMessage` fallback with transferable buffers and the same message types.
- **`SimHost`** (C02) over `SimCore`: `start`, `frame`, `stepOnce`, `restart` (which terminates and respawns the worker with the other build), `stats`, `dispose`. `SimControlMessage` is handled outside ticks; `save.request` replies `{ t: 'save.result', ok: false, reason: 'not-implemented' }` until M04a.
- **`sim.worker.ts`** bootstrap and **`bootEngine()`** on the main thread:
  - isolation check and transport choice;
  - a `FrameSignal` on every rAF;
  - crash detection (worker `error` event, or no snapshot for 2 s) → a "Recovering…" banner and a worker restart.
- **Main-thread client:**
  - snapshot reader;
  - interpolation (C02 rule 2: skip if the tick gap > 3 or the move > 2 m, shortest-arc quaternion);
  - a three object pool by handle that draws boxes and ground with TSL node materials. GLSL is banned by the M00 lint.
- **`BotInput`** (C03 1.1, QA-only) and the scenario **`physics-drop`**:
  - fixture ground plus 12 static boxes;
  - 64 dynamic boxes;
  - an impulse every 30 ticks from stream `world`;
  - a kinematic platform on a `dsin` path;
  - a forced `rebase` by +1,000 m X at tick 5,000.
- **`window.__dvBridge.engine`** (QA builds only): `observe()` → `{ tick, stats, hash, transport, physicsBuild, restarts, snapshotReuse, records }`; `act(cmd)` for debug commands `debug.crash`, `debug.stall {ms}` and `debug.rebase`; `step(n)` while paused. Create `window.__dvBridge` if M00 did not.
- **QA page** `apps/web/qa/determinism.html`, built only when `VITE_DV_QA=1`. In `sim.worker` it runs the shared golden vectors (detmath, rng, ctr, fnv) and then `physics-drop` with `profile: 'canonical'`, and publishes the results on `__dvBridge.engine.qa`.
- **Bench:** the tick cost of both builds and their `init()` and restart times, written to a JSON file. This measures U-ENG-2 and Q-ENG-01 and is not asserted.

## Scope out
- `KinematicCharacterController`, `castRay`/`castSphere`, the camera, binders and the player prefab: M01b1. Vehicles and ragdoll-lite: M03a1.
- Collider working set driven by streamed C08 chunks: M02b1 (statics here come from test fixtures only).
- `asset.worker`: M01e. Full `RendererHost`, tier selection and `PerfHud`: M01c. Telemetry `app.start{coi}`: S11 (M01c).

## Deliverables
- `packages/engine/package.json`:
  - deps `@dimforge/rapier3d-simd-compat@0.21.0`, `@dimforge/rapier3d-deterministic-compat@0.21.0`, `three@0.186.1` (if M00 has not added it);
  - script **`bench:physics`** → `packages/engine/bench/physics-builds.ts`, which writes `packages/engine/bench/results/physics-builds.json`.
- `packages/engine/src/sim/physics/{backend.ts, rapier-backend.ts, load-build.ts, origin.ts, groups.ts, systems.ts}`.
- `packages/engine/src/sim/transport/{envelope.ts, input-block.ts, command-ring.ts, snapshot-buffer.ts, event-ring.ts, sab-transport.ts, pm-transport.ts, index.ts}`.
- `packages/engine/src/sim/sim-host.ts`, `packages/engine/src/sim/input/bot-input.ts`, `packages/engine/src/workers/sim.worker.ts`.
- `packages/engine/src/client/boot/boot-engine.ts`, `packages/engine/src/client/snapshot/{reader.ts, interpolate.ts, object-pool.ts}`, `packages/engine/src/client/debug/bridge.ts`.
- `packages/engine/test/{physics.backend.spec.ts, physics.rebase.spec.ts, physics.snapshot.spec.ts, physics.retry.spec.ts, transport.spec.ts, interpolate.spec.ts}`, `test/fixtures/world-boxes.ts`, `test/scenarios/physics-drop.ts`, `test/golden/determinism.physics-drop.json`; extend `determinism.node.spec.ts`.
- `config/physics.json` and `config/schemas/physics.schema.json`.
- `apps/web/src/main.ts` (boot the engine and the debug cube view, keeping the M00 shell), `apps/web/qa/determinism.html`, `apps/web/src/qa/determinism.ts`.
- `apps/web/vite.config.ts`:
  - `worker.format: 'es'`;
  - the QA input only when `VITE_DV_QA=1`;
  - PWA `injectManifest` with `maximumFileSizeToCacheInBytes: 6 * 1024 * 1024`;
  - precache the `simd-compat` chunk and exclude the `deterministic-compat` chunk, which loads on demand.
- `apps/web/scripts/verify-dist.mjs` and the `@dv/web` script **`verify:dist`**. It asserts that the production `dist/` has no `qa/` page, no `bot-input` module, no `__dvBridge` string and no `deterministic-compat` entry in the precache manifest.
- `tests/e2e/determinism.spec.ts` (tag `@determinism`), `tests/e2e/boot.spec.ts` (tag `@boot`).

## Interfaces
- `PhysicsBackend` and its types are implemented verbatim (not a numbered contract; consumed by S02, S06 and S11).
- C02 snapshot layout, `FrameSignal`, `SimHost` and `SimControlMessage` are implemented as frozen. C03 `BotInput` is implemented. No contract changes.

## Acceptance criteria
- AC-1 Given Node When each build initializes and a 1 m box drops from 10 m onto the fixture ground Then `init()` resolves for both `simd-compat` and `deterministic-compat`, the box rests at y = 0.5 ± 0.01 m within 180 ticks, and each backend instance loaded only its own package — proof: `pnpm --filter @dv/engine test -- physics.backend`
- AC-2 Given a body at x = 1,500 m When `rebase([1000, 0, 0])` runs Then the ENU position (origin + local) changes by ≤ 1e-3 m, statics are rebuilt in the new frame, and the 600 ticks that follow hash identically across two runs — proof: `pnpm --filter @dv/engine test -- physics.rebase`
- AC-3 Given `physics-drop` at tick 3,000 When the run snapshots (ECS, resources, Rapier), continues to tick 6,000 with hash H, restores and re-runs to tick 6,000 Then the hash equals H — proof: `pnpm --filter @dv/engine test -- physics.snapshot`
- AC-4 Given a loader that fails twice When `init()` runs Then it resolves on attempt 3; with four failures it rejects with `PhysicsInitError` and `attempts === 4` — proof: `pnpm --filter @dv/engine test -- physics.retry`
- AC-5 Given `physics-drop` under `canonical` When it runs 10,000 ticks twice in Node Then all 17 checkpoint hashes (every 600 ticks plus the final one) are identical and equal `determinism.physics-drop.json`; two `simd-compat` runs are identical to each other — proof: `pnpm --filter @dv/engine test:determinism`
- AC-6 Given the QA build When the determinism page runs in Chromium Then the vector mismatch count is 0 and every checkpoint hash equals the Node golden — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @determinism`
- AC-7 Given the QA build When the same page runs in WebKit Then the vector mismatch count is 0 and every checkpoint hash equals the Node golden — proof: `pnpm check:e2e -- --project=webkit-webgl2 --grep @determinism`
- AC-8 Given the SAB transport and the `postMessage` transport (Node `MessageChannel`) When both drive the same 1,200-tick scenario with the same `FrameSignal` sequence Then snapshot bytes and hashes are identical at every frame. In the same suite: a seqlock read during a write reuses the previous snapshot; an overflowing event ring counts `dropped` and never blocks; a press and release between two worker reads sets `pressed` on exactly one tick — proof: `pnpm --filter @dv/engine test -- transport`
- AC-9 Given two snapshots When interpolating Then positions lerp by `alpha`, quaternions take the shortest arc, and entities with a tick gap > 3 or a move > 2 m snap — proof: `pnpm --filter @dv/engine test -- interpolate`
- AC-10 Given the QA build in Chromium When the home page loads Then `observe()` reports `transport: 'sab'` and `physicsBuild: 'simd-compat'`, at least 64 records, and tick advancing ≥ 50 per second. During `debug.stall {ms: 500}` the page keeps rendering rAF frames and `snapshotReuse` increases. After `debug.crash`, `restarts === 1` within 5 s and ticks advance again — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @boot`
- AC-11 Given a production build When the dist verifier runs Then it passes, and CI deploys the preview — proof: `pnpm build && pnpm --filter @dv/web verify:dist && pnpm deploy:preview`

## Test plan
- **Unit/integration (Node):** `physics.*`, `transport`, `interpolate`, `determinism.node` (`pnpm --filter @dv/engine test`, `test:determinism`; all inside `pnpm check:unit`).
- **e2e:** `@determinism` on `chromium-webgl2` and `webkit-webgl2`; `@boot` on `chromium-webgl2`. `chromium-webgpu` runs `@boot` too as a non-gating smoke (SwiftShader backend, F-062).
- **Bench:** `pnpm --filter @dv/engine bench:physics` writes both builds' mean and p99 tick ms for `physics-drop`, plus `init` and restart ms.

## Demo script
1. `pnpm dev`, open the local URL with `?debug=1`: boxes fall and settle.
2. In DevTools, `__dvBridge.engine.observe()` shows tick, hash, stats and `transport: 'sab'`.
3. `__dvBridge.engine.act({ t: 'debug.crash' })`: the "Recovering…" banner appears, then the boxes respawn.
4. Open `/qa/determinism.html`: it prints "vectors 0 mismatches" and the final hash, which equals `determinism.physics-drop.json`.
5. `pnpm check:e2e -- --project=webkit-webgl2 --grep @determinism`.

## Effort
1 Builder session; about 38 files; risk **high**. WebKit and the deterministic build, worker module bundling, and seqlock correctness are the main risks. If this overruns, stop after AC-7 passes and move AC-10's crash recovery to M01b1, noting it in the PR.

## Risks & fallbacks
- **WebKit hash differs from Node.** First bisect with the vectors (detmath, fnv, rng). Then compare per-tick hashes to find the first diverging tick, and dump `Transform` for that tick. Check f32→f64 widening (always `Math.fround`, then store) and any iteration over a `Map`. If Rapier itself diverges, stop and record it in `docs/decisions/` as a proposal; do not change the profile rules.
- **Bundle size.** Each `-compat` build embeds about 3.3 MB of wasm [research/stack-rendering-platform.md §5.1] as base64 in JS. Only one build is precached. CI asserts this through `verify:dist`.
- **Not cross-origin isolated** (for example a misconfigured preview). The `postMessage` path keeps the app working; `observe().transport` shows it.
- **Rapier JS API details** beyond the ledger (the `init()` call shape, heightfield argument order) are UNVERIFIED. Read the 0.21.0 typings in `node_modules` before writing `rapier-backend.ts`.

## Notes for the Builder
- Read first: `01-engine.md` §2.1, §2.3, §2.4 (floating origin), §5 (failure table); `01-engine-contracts.md` §C02 snapshot layout and rules 1–9; `11-platform-perf.md` §9 (Playwright rules: assert state, not pixels).
- Verified facts:
  - F-014: Rapier 0.21.0 is Apache-2.0, `-deterministic` is cross-platform, `-compat` embeds the wasm, `takeSnapshot` exists.
  - F-006: `navigator.xr` is not available in workers, so rendering stays on the main thread.
  - `Atomics.waitAsync` is in Safari 16.4 and SAB needs COOP/COEP [research/repos-webport.md §6].
  - F-062: WebKit on Linux lacks `navigator.gpu`, so `webkit-webgl2` always runs WebGL2.
- Assert `transport === 'sab'` only on Chromium projects. WebKit isolation in Playwright on Linux is not in the ledger.
- The worker never imports `three`, so keep `src/workers/sim.worker.ts` importing only `src/sim/**`. The lint and `tsconfig.sim.json` from M01a1 apply to `src/sim/**`.
- Views over a `SharedArrayBuffer` survive `await`s, but rebuild them after any transport re-creation (11-platform §5.9).
- Order of work: backend in Node → physics-drop determinism in Node → transports in Node → worker + boot → client view → QA page + e2e → `verify:dist`.
- Secrets: none for code. `pnpm deploy:preview` uses `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from CI (M00). Locally without them, stop at `pnpm build && pnpm --filter @dv/web verify:dist`.
