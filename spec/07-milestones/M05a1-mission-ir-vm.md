# M05a1 — mission-ir-vm

## Goal
After this session missions are data. `packages/shared` holds the complete C09 mission contract (`c09-mission.ts`) and `mission-ir-1.schema.json`; `packages/modes/story` (`@dv/mode-story`) holds the TypeScript authoring builder, the compiler behind `pnpm missions:build` (schema, bounds, depiction and name lint, references, fallbacks), the load-time resolver over C08 `WorldResolver`, and the VM that runs a mission on C06 `SimScheduler` threads with predicates, objectives, NPC tasks, stage checkpoints, fail rules, retry and unconditional restore. The `story` mode registers with `ModeHost`; the debugger overlay, QA URL flags and `__dvBridge.mission` exist in QA builds; telemetry emits `mission.*`. The sample mission `m.dev.sample` plays in the gray-box Civic Center fixture. The autoplayer, `check:missions` and the full director come in M05a2.

## Requirements
- R-MODE-01: intro → objectives → fail/success → rewards as a validated IR and a deterministic interpreter.
- R-MODE-05: mode hooks run their stub path and emit `unlockOnFirstEncounter` even while the mode is `comingSoon`.
- R-IP-02 (support): depiction and name lint run at compile time (`03-story-missions.md` §C11).

## Depends on
- M04a2 (`ModeHost`, `ModeContext`, `UnlockRegistry`, `EconomyApi`, `WorldClockApi`), M02c1 (`WorldApi`, `WorldResolver`, `PlaceIndex`, A*).
- Contracts: C09 1.0 (`03-story-missions.md` §C1–§C4), C06 1.1 (`ModeContext`, `SimScheduler`, `ZoneService`, `ThreadYield`, `UnlockApi`), C08 1.0 (`WorldResolver`, `LatLng`, `LandmarkId`), C05 1.1 (`StorySlice` storage, `SaveReason 'checkpoint'`), C16 1.1 (`mission.start|fail|complete` props).

## Scope in
- `packages/shared/src/contracts/c09-mission.ts`: complete every §C3 type verbatim (M04c created the file with `C09_VERSION`, `LineId`, `CastName`, `LatLngTuple`; keep those lines unchanged).
- `packages/shared/schemas/mission-ir-1.schema.json` (draft 2020-12) with the §C4 bounds; generate the structure with the M00a schema generator if it accepts this entry type, else hand-write; a drift test compares property sets with the TypeScript. Profiles `story` and `mod` (the `mod` profile rejects `give`, `rewards`, `unlocks`, `unlockOnFirstEncounter`, story-key `flag` ops and `mode` hooks; §C12 item 2).
- Authoring (`src/authoring/`): `defineMission`, `stage`, objective helpers (one per kind), `npc`, `vehicle`, `prop`, `pickup`, `unit`, `at`, `circle`, `poly`, `landmark`, `route`, predicate helpers, `failWhen`, `task`; returns `MissionIR` only.
- Compiler (`src/compiler/`, `compileMission`, `resolveMission` per `03-story.md` §3): schema → bounds → references (`E_REF_CAST|ZONE|LINE|LANDMARK`) → lint (§C11: depiction rules, `weapon.*` rejected, `defeat.nonLethal`, names through the M00b `names:lint` library, `sensitivity-read` tag required for D3/D4) → `E_NO_FALLBACK` (every `BeatRef` resolves to a DirectorScript id, or to a cutscene ref with a fallback) → `E_HOOK_STUB` → `E_UNREACHABLE_STAGE` → op-node count (`E_BUDGET` > 4,000). Errors carry a JSON Pointer.
- `pnpm missions:build [-- --mission <id>]` (`tools/ci/missions/build.ts`): compiles `content/missions/*/mission.ts`, writes C07 asset sources `assets/src/data/mission.<id>/{asset.json, mission.json}`, `assets/src/data/story.index/…` (`MissionIndexRow[]`), `assets/src/data/lines.<act>.<lang>/…`, and `content/audio-needs/story.json`; outputs byte-identical on rerun; IR ≤ 64 KiB; provenance `origin: 'authored'`; then the M01d `assets:lock` flow applies.
- Load-time resolution (`src/compiler/resolve.ts`, run in `sim.worker` during `starting` behind a fade): `LatLngTuple` → C08 `LatLng` → ENU; landmarks; `snap` (> 25 m fails); `route.via` → `edgeIds`; zones registered as `mis:<id>:<zone>`. A `worldBake` mismatch re-resolves; any failure disables the mission (`E_REF_*`, telemetry `mission.fail {reason: 'unresolved'}`), and a saved `activeMission` with another `version` or `worldBake` is dropped.
- VM (`src/vm/`): `MissionRuntime` per `03-story.md` §3 and §C6: explicit frame stack per thread, ops `seq/all/race/if/loop/wait/waitUntil/waitEvent/spawn/despawn/task/say/text/marker/beat/camera/fade/heat/clock/ambient/flag/trust/give/emit/pass/fail`, cost 1 per op and predicate node, 2,000 ops per thread per tick, `E_BUDGET` after 60 consecutive over-budget ticks; `race` ties to the lowest branch index; RNG stream `mission:<id>` seeded `hash32(storySeed, missionId, attempt)`; mission clock counts ticks only while `phase = 'stage'` and excludes beats.
- Predicates (all of §C3 `Pred`), objectives (every kind of `ObjectiveDef`; `stealth` counts detection events from `SimEventBus` when present; `defeat` completes on `Health.ko` of every target), `join` modes, `hud.mission` patches through `UiBridge`, markers.
- NPC tasks (`src/vm/tasks.ts`): `goto`, `driveTo` (C08 A* + the M03a1 vehicle controller inputs), `follow`, `enterVehicle`, `leaveVehicle`, `anim`, `look`, `idle`, `flee`.
- Checkpoints: `MissionCheckpointV1` written into `StorySlice.activeMission` on stage entry when `checkpoint`, then `ctx.save.request('checkpoint')`; retry restores pose, vehicle, health, cast, flags, wallet delta and RNG and restarts the stage threads; `retry: 'start'` restarts stage 0.
- Fail rules and the `finally` table: on pass, fail, quit, abort or mode kill the VM restores clock lock, ambient multipliers, `capHeat(5)` and clears heat when `clearOnPass`.
- Hooks (§C8): real path calls `startChild`; stub path when the descriptor is missing or `comingSoon`, `startChild` returns false, the opponent is killed with scope `fighter`, or `?hooks=stub`; the stub path emits `unlockOnFirstEncounter` with `{kind: 'mission', ref: '<missionId>:<hookId>'}`.
- Beats in this milestone: `beat` with a `director` ref holds one fixed shot (C04 `CameraDirective` `cinematic`) for the script's `durationSec` and applies end marks; `?beats=instant` completes in one tick; the full director and `cut.request` arrive in M05a2 and M05b2.
- `talk` objective: offers its outcomes through `mode.story.talk`; under `?talk=scripted` (and in Node) it applies `TalkDef.default` with `path: 'scripted'`; results enter as `StoryCommand` `talk.result` and are recorded.
- Story mode (`src/mode.ts`): C06 descriptor `story` (`unlock: null`, `tile.order: 1`, `saveSlot: 'story:auto'`), `GameModeSim` hosting one `MissionRuntime`, `GameModeUI` mounting the debug overlay in QA builds.
- Debug (`src/debug/`, QA only): URL flags `?mission`, `?stage`, `?seed`, `?hooks`, `?talk`, `?beats` through the S11 `QaFlags` parser; overlay (threads with op path and wait reason, objectives with live predicate values, cast, flags, clock, last 50 events; pause, step tick, skip stage, force pass/fail); `window.__dvBridge.mission` = `{state(), step(ticks), jump(stage), events(since), predicate(path)}`.
- Engine services: if M04a2 left `SimScheduler` or `ZoneService` as stubs, implement them in `packages/engine/src/sim/script/` (threads in `threadId` order, 100 m spatial hash, callbacks in ascending handle order).
- Content: `content/missions/m.dev.sample/{mission.ts, lines.en.json}` in the gray-box fixture (`tests/fixtures/world/civic-graybox`): act 0, every objective kind except `escape` and `defeat` (Act 1 covers those, `03-story-narrative.md` §B4), including `collect`, `wait`, a `talk` with two outcomes and a `mode` hook to `racing` whose stub is `wait 5`.

## Scope out
- Autoplayer, `check:missions`, timeline export and preview, director (auto, DirectorScript runner, LOS, hill rule, XR vantage): M05a2.
- `cut.request` protocol and `CutscenePlayer`: M05b2. LLM talk path: M06a3. Act 1 content: M05c1–M05c2.

## Deliverables
- `packages/shared/src/contracts/c09-mission.ts`, `packages/shared/schemas/mission-ir-1.schema.json`, `packages/shared/test/mission-ir.schema.test.ts`.
- `packages/modes/story/{package.json, tsconfig.json, README.md}`; `src/{index.ts, mode.ts}`; `src/authoring/{index.ts, helpers.ts}`; `src/compiler/{index.ts, validate.ts, lint.ts, resolve.ts}`; `src/vm/{runtime.ts, ops.ts, predicates.ts, objectives.ts, tasks.ts, checkpoint.ts, hooks.ts}`; `src/debug/{overlay.tsx, bridge.ts}`.
- `packages/modes/story/test/{compiler.test.ts, vm-ops.test.ts, predicates.test.ts, checkpoint.test.ts, hooks.test.ts, resolve.test.ts}`, `test/fixtures/bad/*.ts` (one per error code).
- `tools/ci/missions/build.ts`, root script `missions:build`; `content/missions/m.dev.sample/*`; generated `assets/src/data/{mission.m.dev.sample, story.index, lines.0.en}/*` and lock entries.
- `packages/engine/src/sim/script/{scheduler.ts, zones.ts}` only if M04a2 did not ship them.
- `tests/e2e/mission-debug.spec.ts` (tag `@mission-debug`).

## Interfaces
- C09 1.0 mission types completed verbatim; C06 1.1, C08 1.0, C05 1.1 and C16 1.1 consumed as defined. No shape change; the compiler maps `LatLngTuple` to C08 `LatLng` (DL-078).

## Acceptance criteria
- AC-1 Given `m.dev.sample` and one bad fixture per compiler code When the compiler test runs Then the sample compiles with zero errors and each fixture yields exactly its declared code (`E_SCHEMA`, `E_REF_CAST`, `E_REF_ZONE`, `E_REF_LINE`, `E_REF_LANDMARK`, `E_OUT_OF_BOUNDS`, `E_ROUTE_UNSNAPPABLE`, `E_DEPICTION`, `E_NAME`, `E_NO_FALLBACK`, `E_HOOK_STUB`, `E_UNREACHABLE_STAGE`, `E_BUDGET`) with a JSON Pointer to the offending node — proof: `pnpm check:unit -- packages/modes/story/test/compiler.test.ts`
- AC-2 Given the content tree When `missions:build` runs twice Then it writes the mission, story index, lines and audio-needs outputs, the second run changes no byte, the IR is ≤ 64 KiB, and the provenance and asset gates pass — proof: `pnpm missions:build && pnpm missions:build && pnpm provenance:check && pnpm check:assets`
- AC-3 Given hostile IR (33 cast entries, `loop.max` 10,001, `wait.sec` 601, a raw display string in `title`, a `give` op under the `mod` profile) When validated against `mission-ir-1.schema.json` Then each is rejected, and the schema's property sets equal the TypeScript types — proof: `pnpm check:unit -- packages/shared`
- AC-4 Given one test mission per op When the VM runs them headless Then each op behaves per §C6: `race` with a same-tick finish keeps branch 0, `all` joins after the last branch, `loop` stops at `max`, a thread yields after 2,000 ops, and 60 consecutive over-budget ticks end in `failed` with `fail.reason.script_error` — proof: `pnpm check:unit -- packages/modes/story`
- AC-5 Given a stage with a checkpoint, a `give` of $50 and a fail rule When the mission fails and retries Then the wallet delta, flags, cast state, player pose and RNG equal the checkpoint, `ctx.save.request` was called with `'checkpoint'`, and the mission clock did not advance during a 3 s beat — proof: `pnpm check:unit -- packages/modes/story`
- AC-6 Given a mission that locks the clock, sets ambient 0.3 and heat 2 When it passes, fails, is quit, aborted, and killed by a mode exit (five runs) Then after each the clock lock is released, ambient multipliers are 1, `capHeat(5)` was applied and heat was cleared when `clearOnPass` — proof: `pnpm check:unit -- packages/modes/story`
- AC-7 Given a `mode` hook to a `comingSoon` racing descriptor with `unlockOnFirstEncounter: 'unlock.racing'` When the objective runs twice (two attempts) Then the stub objective runs both times, `UnlockApi.emit` returns true once and false once, and the ref is `'<missionId>:<hookId>'` — proof: `pnpm check:unit -- packages/modes/story`
- AC-8 Given a compiled mission whose `worldBake` differs from the loaded bake and one zone 30 m from any road When it reaches `starting` Then it is disabled with `E_REF_ZONE`, telemetry `mission.fail` has `reason: 'unresolved'`, and a saved `activeMission` from an older `version` is dropped to `available` — proof: `pnpm check:unit -- packages/modes/story`
- AC-9 Given the same mission and seed When it runs twice headless with scripted commands (talk result at tick 300) Then both runs end with the same `stateHash` — proof: `pnpm check:unit -- packages/modes/story`
- AC-10 Given a QA build at `/?mission=m.dev.sample&stage=0&seed=1&talk=scripted&beats=instant` When the page boots Then `__dvBridge.mission.state()` reports phase `stage`, `hud.mission` holds the first objective key, `jump(3)` makes stage 3 active, and the overlay lists the live threads — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @mission-debug`
- AC-11 Given the branch When the production build, bundle check and preview deploy run Then the debug overlay and bridge are absent from production chunks and the app deploys — proof: `pnpm build && pnpm check:bundle && pnpm deploy:preview`

## Test plan
- Unit: `story/compiler`, `story/resolve`, `story/vm-ops`, `story/predicates`, `story/checkpoint`, `story/hooks`, `shared/mission-ir.schema`. `pnpm check:unit -- packages/modes/story packages/shared`.
- Build: `pnpm missions:build`, `pnpm check:assets`, `pnpm provenance:check`.
- E2E: `@mission-debug` on `chromium-webgl2`.
- Bot runs of the sample start in M05a2 (`check:missions`).

## Demo script
1. `pnpm missions:build`: prints `m.dev.sample ok` and the output asset paths.
2. Break a `LineId` in the sample, rerun: `E_REF_LINE` at `/stages/2/objectives/0/text`. Revert.
3. `pnpm dev`, open `/?mission=m.dev.sample&seed=1`: the overlay shows threads and objectives; walk to the first zone; the objective completes.
4. Console: `__dvBridge.mission.jump(5)`, then force fail and retry from the overlay.

## Effort
1 session; ≈ 38 files; risk medium (VM size; C08 snap inside the load budget, U-S03-8, resolved behind a fade by design).

## Risks & fallbacks
- File budget: move the debug overlay to M05a2 and keep `__dvBridge.mission` here; AC-10 then asserts the bridge only. Say so in the report.
- The gray-box fixture has no `WorldIndex` for `WorldResolver`: build the compile and load resolver from `decodeP0` chunks plus `config/world.bounds.json` for that bake id; landmark references in the sample are avoided.
- `driveTo` on the gray-box's single junction cannot exercise long routes: unit-test `tasks.ts` against a synthetic C08 graph; Act 1 exercises long routes in M05c1.

## Notes for the Builder
- Read first: `03-story-missions.md` §C1–§C8, §C10–§C11; `03-story.md` §3–§5; `01-engine-save-modes.md` §C06, "Mission and mode hooks"; `02-world-contracts.md` §3 (`WorldResolver`).
- Order: contract and schema → authoring → compiler and lint → VM core → predicates and objectives → checkpoints and fail → hooks → mode and debug → sample → e2e.
- `packages/modes/story/src/vm/**` is sim code: C02 lint applies (put it under `src/sim/` or extend the lint glob to `packages/modes/story/src/vm/**`; record which).
- IR strings are keys only; display text lives in `lines.en.json`. No secrets. Branch `m05a1-mission-ir-vm`.
