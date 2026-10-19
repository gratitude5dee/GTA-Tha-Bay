# M13a4 — mod-script-sandbox

## Goal
Script-tier mods run, isolated from the game. When this milestone is done the repository has:
- a lazy `mod.worker` (DL-152) hosting `quickjs-emscripten` 0.32.0 with one runtime per script mod, each with a memory limit, a stack limit and an interrupt deadline per call;
- a `ctx` object built only from host functions for the granted namespaces, and no other global;
- the `ModMsg v1` protocol over a `MessagePort` with `ModHost`: ticks at ≤ 10 Hz carrying a `ModSnapshot`, and command lists validated by the M13a3 broker;
- the script-tier namespaces M13a3 leaves to this milestone: `ctx.player.teleport` (permission `player.teleport`), `ctx.player.giveLoadout` (permission `player.loadout`), and `ctx.camera.play`/`release` (permission `camera.cinematic`, refused in XR with a logged reason);
- the fault policy and worker-restart rules;
- per-tier budgets from `config/mod-limits.json`;
- a security suite, the `mod-hostile` perf scenario and an iPhone 15 recording of the per-tick cost.

`mods.script` stays off in staging and production until the device recording is reviewed (DL-147).

## Requirements
- R-MOD-01: personal script mods for any sandbox mode, with typed APIs and hard limits, so a coding agent's output cannot harm the game or the player's data.

## Depends on
- **M13a3**: `ModHost`, broker, grants, scene and save paths, `ExperienceMode`, refusal codes.
- Contracts: C14 1.0 (`c14-protocol.ts` `ModMsgDown`/`ModMsgUp`, `ScriptLimits`, `ModFaultReason`, `ModFault`, `ModSnapshot`, `ModEvent`, `ModContext<P>`, B§3 rules 1–7), C02 1.1 (`SimStage.Commands`, seeded streams), C04 1.1 (`CinematicShot`, `CameraDirective` modes `cinematic` and `xr`), C05 1.1 (`mod:<id>` slot), C13 1.1 (tiers), C16 1.1 (`mod.fault`).
- Gate: **Q-13**, an iPhone 15 for the device recording.

## Scope in
- **`mod.worker`** (`packages/engine/src/workers/mod.worker.ts`):
  - created on the first script-mod load and terminated when none remain;
  - one `quickjs-emscripten` module and one runtime and context per mod;
  - `memoryLimitBytes` and `setMaxStackSize` from the tier row; `setInterruptHandler` stops a call after `deadlineMs` [research/repos-modding.md Verified facts];
  - the bundled `entry` is evaluated as an ES module.
  - The context holds `ctx` (granted namespaces only, built from host functions), plus the `ctx.log` shim and a `console` shim mapped to it. `Math.random`, `Date`, `performance`, `fetch`, `WebAssembly`, `SharedArrayBuffer` and `Atomics` are deleted or never defined. A `globals` enumeration test fails on any name outside `packages/engine/src/workers/mod-globals.allow.json`.
- **Script bridge** (`packages/engine/src/sim/mods/script-bridge.ts`):
  - the main thread creates a `MessagePort` pair at session start, so `sim.worker` and `mod.worker` talk directly;
  - `init` carries source, grants, limits, `seed = hash(sessionSeed, modId)`, radius, language and storage;
  - `tick` runs at the mod's `onTick` rate (≤ 10 Hz, every 6th sim tick), with a `ModSnapshot` of the player, clock, heat and ≤ 64 nearest mod entities, all anchor-relative; events are batched;
  - the reply `cmds` (≤ 64 commands, ≤ 8 KiB) goes through the M13a3 broker and applies in `SimStage.Commands` of the next tick;
  - `kv` patches go to the `mod:<id>` save path with the M13a3 caps;
  - `log` is limited to 20 lines/s and 240 chars.
  - In play, replies arrive one script tick late (asynchronous). In `lockstep: true` (tests, and `dv mod test` in M13a6) the sim waits for each reply.
- **Script-tier namespaces** (`packages/engine/src/sim/mods/script-ns.ts`, sim code: C02 lint applies; `ctx-builder.ts` defines each method only when its permission is granted, so with only `player.loadout` `ctx.player.teleport` is `undefined`, C14 B§3 rule 2):
  - **`player.teleport`** → `ctx.player.teleport(at)`: returns `false` in the VM, and sends nothing, when `|x|` or `|z|` exceeds `radius` (B§3 rule 3: rejected, not clamped); the broker re-checks, snaps `y` to the ground through the C08 ground query and moves the player in `SimStage.Commands`.
  - **`player.loadout`** → `ctx.player.giveLoadout(setId)`: returns `false` for an id not in `config/mod-loadouts.json` (new, schema `packages/shared/schemas/mod/mod-loadouts.schema.json`: set id → first-party non-weapon item ids, D-30; the Builder seeds it from existing item ids and may ship it empty). Granted items are a session overlay held in the `mod:<id>` slot only: no `EconomyApi` call, never written to `core.inventory`, removed on `exp.exit` or unload.
  - **`camera.cinematic`** → `ctx.camera.play(shots)`: returns `false`, and sends nothing, for more than 12 shots or more than 60 s in total. The broker maps `pos`, `lookAt` and `spline` from anchor-relative to ENU and `subject` from a `ModEntityRef` the mod owns (or `0`, the player) to the handle; any other `subject` is a protocol violation. It then publishes `CameraDirective { mode: 'cinematic', reason: 'mode' }` per shot. `release()`, the end of the last shot, `exp.exit` or unload restore the previous directive.
  - **XR refusal:** while the active `CameraDirective.mode` is `xr`, the broker refuses every `camera` command, because `11-platform-xr.md` §5.3 disables scripted cameras in XR. Nothing applies, the mod's log gets one host `warn` line `camera.play refused: xr`, the refusal is recorded `{ modId, ns: 'camera', reason: 'xr' }` for `__dvBridge.mods.refusals()`, and it does not count as a protocol violation or a fault. `ModSnapshot` carries no XR field, so the VM's `play` cannot see XR and returns `true` there (DL-534).
- **Determinism:** `ctx.rng` is xoshiro128** from the session seed and modId; `ctx.time` is sim time; `after(ms)` counts sim time. The same mod, snapshots and seed give the same command stream.
- **Fault policy** (`fault-policy.ts`):
  - three consecutive deadline hits, one memory-limit hit, one stack overflow, 20 protocol violations in a session, or two uncaught handler exceptions within 10 s disable the mod for the session;
  - on disable: its entities despawn, its KV is flushed once, a toast names the mod, and `mod.fault {reason}` is emitted.
  - If `mod.worker` dies it restarts once and reloads the enabled script mods; a second death disables the script tier for the session. Story is never touched (Story never loads mods).
- **Storage migration:** a `storage.schema` bump calls `migrate(from, to, kv)` once. A throw keeps the old record and disables the mod.
- **Budgets:** deadline, memory, active script mods and entity caps per tier from `config/mod-limits.json` (S12 design values). Loading a mod beyond the tier's active-script count yields `install.tier_unsupported` for that mod.
- **Flags:** `ModHost` lifts the M13a3 `load.flag_off` refusal for tier `script` when `mods.script` is true. Staging and production `FLAGS_JSON` keep it false. The local test environment (`services/edge/.dev.vars` and the Playwright `webServer` environment) and the `previews` block of `wrangler.jsonc` (QA Preview builds only, used for the device run) set it true. Production flips only through the M14b3 checklist after the recording.
- **Perf scenario** `mod-hostile` (`tests/perf/scenarios/mod-hostile.ts`): three fixture mods (`while(true){}`, a 1 GiB array allocation, unbounded recursion) loaded with one benign mod in a sandbox session.
- **Device recording:**
  - checklist `tools/ci/checklists/M13a4-iphone15.json`: 10 min sandbox with the benign example plus a 64-command-per-tick stress mod at `mobile-low`;
  - it records per-tick `usedMs` p50 and p95, memory, `mod.worker` start time and abnormal exits (U1 recorded, not asserted);
  - results go to `docs/device-runs/M13a4/iphone15/{perf.json,notes.json}`.
- **QA bridge:** `__dvBridge.mods.workerCount()`, `faults()`, `refusals()`.

## Scope out
- UI tier and `ui.panel`/`ui.hud`: M13a5. Mock host, `dv mod test`, examples, agent kit: M13a6.
- Script mods in rooms or Story: never in v1. Server-side mod code: post-M14 vetting (06 §3).
- Quest 3 per-tick recording: optional here; required in the M14b3 release pass.

## Deliverables
- `packages/engine/src/workers/{mod.worker.ts, quickjs-host.ts, ctx-builder.ts, fault-policy.ts, mod-globals.allow.json}`.
- `packages/engine/src/sim/mods/{script-bridge.ts, snapshot.ts, migrate.ts, script-ns.ts}`; `config/mod-loadouts.json` and `packages/shared/schemas/mod/mod-loadouts.schema.json`.
- Tests in `packages/engine/src/workers/test/`:
  - `mod-sandbox-globals.spec.ts`, `mod-sandbox-deadline.spec.ts`, `mod-sandbox-memory.spec.ts`, `mod-sandbox-stack.spec.ts`;
  - `mod-perm-denied.spec.ts`, `mod-cmd-flood.spec.ts`, `mod-fault-policy.spec.ts`, `mod-lockstep-det.spec.ts`, `mod-migrate.spec.ts`;
  - `mod-player.spec.ts`, `mod-camera.spec.ts` (script-tier namespaces; a fixture `mod-loadouts` file, a fake active `CameraDirective`);
  - fixture sources inline as strings, no files.
- `tests/perf/scenarios/mod-hostile.ts`; `mod-hostile` appended to `config/perf/scenarios.json` (the `check:perf` registry, M02b1; DL-656 part 4); `tests/e2e/mods-script.spec.ts` (tag `@mods-script`).
- `tools/ci/checklists/M13a4-iphone15.json`.
- `packages/shared/schemas/telemetry/mod.fault.schema.json` (if M13a3 did not add it).
- Dependency `quickjs-emscripten@0.32.0` [research/repos-modding.md Verified facts]. Its WASM is loaded only inside `mod.worker`, so `check:bundle` sees it as a lazy chunk.

## Interfaces
- C14 1.0 protocol messages are used verbatim, each with `v: 1` and schema-tested from both sides. `ModContext<P>` narrowing follows B§3: an absent namespace is `undefined` at run time.
- C14 `ModApiPlayer` and `ModApiCamera` and C04 `CinematicShot` and `CameraDirective` are used verbatim. The XR refusal reaches the mod only through `log`; an additive C14 field that would let `play` return `false` in XR is proposed to the Architect (DL-534), not made here.
- No contract change.

## Acceptance criteria
- AC-1 Given a script mod When the VM's global object is enumerated Then every name is in `mod-globals.allow.json`, and scripts reading `fetch`, `Date`, `Math.random`, `performance`, `SharedArrayBuffer`, `Atomics` or `WebAssembly` each get `undefined` or a `ReferenceError` reported as `fault {reason:'throw'}` — proof: `pnpm check:unit -- packages/engine/src/workers/test/mod-sandbox-globals`
- AC-2 Given a handler running `while(true){}` with `deadlineMs` 4 When three ticks run Then each call returns within 3 × `deadlineMs`, and after the third the mod is disabled with reason `deadline` while a second mod keeps receiving ticks — proof: `pnpm check:unit -- packages/engine/src/workers/test/mod-sandbox-deadline`
- AC-3 Given a mod allocating a 1 GiB array under an 8 MiB limit, and a mod recursing without bound When each runs Then the first faults `memory` and the second `stack`, both are disabled, and the worker stays alive for the other mods — proof: `pnpm check:unit -- packages/engine/src/workers/test/mod-sandbox-memory packages/engine/src/workers/test/mod-sandbox-stack`
- AC-4 Given a mod granted only `rules.tick` When it reads `ctx.props` and calls `ctx.props.place(...)` Then `ctx.props` is `undefined`, the call throws inside the VM, and no command reaches the broker — proof: `pnpm check:unit -- packages/engine/src/workers/test/mod-perm-denied`
- AC-5 Given a mod returning 65 commands, then a 9 KiB command list, then 12 spawns in one second over 20 ticks When the broker processes them Then each oversize list is dropped as one protocol violation, at most 8 spawns apply per second, and the 20th violation disables the mod with reason `protocol` — proof: `pnpm check:unit -- packages/engine/src/workers/test/mod-cmd-flood`
- AC-6 Given one script mod, one seed and a recorded sequence of 600 snapshots When it runs twice in lockstep Then the SHA-256 of the canonical command stream is equal across runs — proof: `pnpm check:unit -- packages/engine/src/workers/test/mod-lockstep-det`
- AC-7 Given `mod.worker` terminated by the test When the next tick is due Then the worker restarts once and reloads the enabled mods; a second termination disables the script tier for the session; in both cases the `story:auto`, `core` and `settings` records are byte-equal to before — proof: `pnpm check:unit -- packages/engine/src/workers/test/mod-fault-policy`
- AC-8 Given a mod with `storage.schema` 2 and a stored record at schema 1 When `migrate` returns a new map, or in a second run throws Then the record is rewritten at schema 2 in the first case, and in the second it is unchanged and the mod is disabled — proof: `pnpm check:unit -- packages/engine/src/workers/test/mod-migrate`
- AC-9 Given the three hostile fixtures and one benign mod at each flat tier When the perf scenario runs Then every hostile mod is disabled with its expected reason within three deadlines or at its limit, the benign mod keeps running, the sim tick counter advances by at least 95 % of the ticks expected over the run, and each report is written — proof: `pnpm check:perf -- --scenario mod-hostile --fail`
- AC-10 Given a QA build with `mods.script` true When a sandbox starts without script mods, a script fixture loads, and then it unloads Then `__dvBridge.mods.workerCount()` reads 0, 1, 0; with `mods.script` false the same load is refused with `load.flag_off` — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @mods-script`
- AC-11 Given the iPhone 15 Home Screen app on a QA Preview URL (where `mods.script` is true) When the operator runs the `M13a4-iphone15` checklist at `?tier=mobile-low` Then `perf.json` and `notes.json` are committed under `docs/device-runs/M13a4/iphone15/` with per-tick `usedMs` p50 and p95, memory and abnormal exits recorded, and `perf:verify` passes the frame budget at `mobile-low` — proof: manual: iPhone 15, steps of `pnpm perf:checklist -- tools/ci/checklists/M13a4-iphone15.json`, then `pnpm perf:verify -- docs/device-runs/M13a4/iphone15/perf.json --tier mobile-low --checklist tools/ci/checklists/M13a4-iphone15.json`
- AC-12 Given the production build When it is checked Then `mods.script` is false in production and staging `FLAGS_JSON`, no `/_test/` route ships, no secret pattern is present, and the bundle budgets hold with QuickJS as a lazy chunk — proof: `pnpm build && pnpm check:prod-routes && pnpm check:secrets -- apps/web/dist && pnpm check:bundle`
- AC-13 Given a lockstep sandbox with radius 50 and a mod granted `player.teleport` When it calls `ctx.player.teleport([10, 0, -5])` and then `ctx.player.teleport([60, 0, 0])` Then the first returns `true` and on the next tick the player stands at the anchor ENU position plus (10, −5) in x and z with `y` on the ground; the second returns `false` and no command reaches the broker; and for a mod granted only `player.loadout`, `ctx.player.teleport` is `undefined` — proof: `pnpm check:unit -- packages/engine/src/workers/test/mod-player`
- AC-14 Given a fixture `mod-loadouts` file with one set and a mod granted `player.loadout` When it calls `giveLoadout` with that set's id and with an unknown id Then the first returns `true` and the session overlay holds the set's items, the second returns `false`; after the mod unloads the overlay is empty, no `EconomyApi` call was made, and the `core` record is byte-equal to before — proof: `pnpm check:unit -- packages/engine/src/workers/test/mod-player`
- AC-15 Given a mod granted `camera.cinematic` When it plays two shots, then 13 shots, then calls `release()` Then the two shots publish `CameraDirective` mode `cinematic` with positions mapped from anchor-relative to ENU, the 13-shot call returns `false` with no command sent, and `release()` restores the previous directive. Given the active directive mode `xr` When the same mod plays two shots Then no `cinematic` directive is published, the mod's log holds one `warn` line naming reason `xr`, the refusal list holds `{ ns: 'camera', reason: 'xr' }`, and the mod is neither faulted nor charged a protocol violation — proof: `pnpm check:unit -- packages/engine/src/workers/test/mod-camera`

## Test plan
- **Unit (Node; QuickJS runs in Node):** the eleven sandbox specs. Command: `pnpm check:unit -- packages/engine/src/workers`.
- **E2E:** `@mods-script` on `chromium-webgl2` (lazy worker lifecycle, flag gate).
- **Perf:** `mod-hostile` in fail mode (state assertions only; frame times are recorded, not asserted).
- **Device:** `M13a4-iphone15` (U1 recorded). The `device-runs` CI job runs `perf:verify` on the committed report.

## Demo script
1. `pnpm check:unit -- packages/engine/src/workers`; read the deadline and memory lines.
2. `pnpm dev` (local env with `mods.script` true); sandbox; console: `await __dvBridge.mods.installFixture('script-hello')`; a HUD log line from `ctx.log` appears.
3. `await __dvBridge.mods.installFixture('hostile-loop')`; a toast names the mod as disabled within a second; the game keeps running.
4. `__dvBridge.mods.workerCount()` → 1; unload all → 0.
5. On the iPhone, run the checklist and commit the report.

## Effort
1 session; ≈ 29 hand-written files. Risk high: WASM sandbox edge cases and mobile cost (U1).

## Risks & fallbacks
- The QuickJS interrupt handler cost raises tick time on iPhone: lower the tick rate cap for `mobile-low` in `config/mod-limits.json` (data change). If the recording still fails the frame budget, the script tier stays off on `mobile-low` (DL-147) and the report says so.
- Module evaluation (`evalCode` with module type) is not available in the pinned version: bundle mod `entry` files as an IIFE in `dv mod pack` instead (an M13a1 packer option), and record the decision.
- `MessagePort` transfer between two workers through main fails in WebKit: relay `ModMsg` through main (one extra hop). Lockstep tests are unaffected.

## Notes for the Builder
- Read first: `12-modding.md` §2.3, §5.2, §5.4, §5.5, §6 (XR); `11-platform-xr.md` §5.3 (camera effects in XR); `12-modding-contracts.md` B§3, B§5; `spec/11-decision-log.md` DL-147, DL-152; ADR-0012 and ADR-0017; `spec/08-test-and-ci.md` §3.3, §4.1.
- Facts: only the QuickJS APIs named in [research/repos-modding.md Verified facts]. Do not rely on any other API without reading the pinned package in `node_modules` and recording what you used.
- Never let a mod error reach Story or `core`: every host function validates its input before acting.
- Branch `m13a4-mod-script-sandbox`.
