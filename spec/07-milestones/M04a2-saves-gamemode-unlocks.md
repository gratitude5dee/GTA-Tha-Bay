# M04a2 — saves-gamemode-unlocks

## Goal
After this session the engine has its mode system. `ModeHost` (C06 1.1) runs a stack of at most two modes through the states `Idle → Loading → Entering → Running → Exiting`, with `Suspended` for a parent. It assembles the `ModeContext`, the only capability surface for a mode, from the engine services built so far: ECS, prefabs, physics queries, RNG streams, clock, pursuit, interaction, zones and scheduler stubs, camera, input, unlocks, economy, combat stub, events, UI bridge, assets, save, telemetry and `world`. The unlock registry emits first-encounter unlocks idempotently, persists them in `CoreSlice.unlocks` and raises the one-time toast. Racing, fighter and tycoon are registered as `comingSoon` stubs (A-06). A minimal free-roam `story` mode and a `sandbox` mode are playable. The story wallet runs on an idempotent `EconomyApi`. Controls remapping persists in the `settings` slice and round-trips into `InputRouter`. The autosave policy of C05 rule 4 decides when to save. The sim-side `UiBridge` and the main-side `ViewModelSource` and `UiCommand` channel exist for S10's menus (M04b1). **Split boundary:** M04a1 shipped `SaveService`; this is the C06 half of the M04a row.

## Requirements
- R-MODE-05: modes are encountered in the story and unlock as standalone menu entries on first encounter; unlock state persists in the save.
- R-MODE-01: the economy wallet (integer cents, idempotent) and autosave rules for the main story.
- R-ENG-04: control remapping is stored per profile and restored on load; `client.Pause` can never be unbound.

## Depends on
- **M04a1** (saves): `SaveService`, capabilities, the write port and `save.request`.
- Through the earlier chain:
  - M03c: `PursuitApi`, `WalletPort`;
  - M03b2: `FareSink`;
  - M03a1: interaction v1, prefabs;
  - M02c1: `WorldApi`;
  - M02b2: the S01 clock (`WorldClockApi`) and env block;
  - M01b1/M01b2: `InputRouter`, camera directives.
- Contracts: C06 1.1.0 (`c06-modes.ts`, `ui-bridge.ts`, `engine-world.ts`, `engine-pursuit.ts`), C05 1.1.0, C03 1.1.0, C16 1.1.0 (`mode.enter`, `mode.exit`, `unlock.emit`), C08 1.0.0 (`WorldApi`), C07 1.1.0 (`AssetRef` for tile art).

## Scope in
- **Contract files, verbatim and whole:**
  - `c06-modes.ts` (1.0 shape plus the 1.1 additions; M04a1 may already have created it for C05's imports, in which case diff it against the spec and fix only copy errors);
  - `ui-bridge.ts` from `10-ui.md` §3.3, including `ToastKind` (DL-196) and `cutscene.state`.
- **ModeHost** (`packages/engine/src/sim/modes/host.ts`), rules 1–8:
  - the state machine;
  - depth ≤ 2 and one top-level mode;
  - canonical-under-local embedding refused, with `startChild` returning `false` so the C09 hook falls back to its stub;
  - a top-level profile switch through `SimHost.restart` behind loading;
  - non-blocking `enter` with `assets.ready` polling;
  - first-encounter unlock (rule 5);
  - idempotent unlocks and `?unlockAll=1` in memory only in QA builds;
  - a mode never creates its own world, renderer, camera or store;
  - rewards through `EconomyApi` with key `mode:<id>:<seed>:<tick>`.

  It also handles the 1.1 rule changes: `standaloneProfile`, the Story ↔ `exp:` switch at a safe point with `story:auto` saved as `modeExit`, and `core.stats.fightsWon` on a fighter win.
- **Session capability:** entering a top-level mode sets the M04a1 `SaveCapability` (`story`, `sandbox`, `standalone:<id>`, `exp:<id>`).
- **`ModeContext` assembly** (`context.ts`) with `rng(stream)` auto-prefixed `mode:<id>:`. Services that do not exist yet are explicit stubs that throw `NotYetAvailable` with the landing milestone in the message:
  - `zones`, `scheduler`, `timeline` → M05a1;
  - `combat` → M05c1;
  - `npc` → M06a3.

  `net` is `null`.
- **UnlockRegistry** (`unlocks.ts`): `register`, `defs`, `emit` (true only if new), `has`, `list` and `onUnlocked`. It writes `CoreSlice.unlocks` (sorted, unique) and `firstEncounters`, saves with reason `unlock`, emits telemetry `unlock.emit {id}`, and sends `UiBridge.toast({kind: 'unlock'})` plus `VmPatch sys.unlocks`.
- **Built-in descriptors** (`builtin/`):
  - `story`: order 1, `unlock: null`, `available`. Its sim is a minimal free roam (spawn, wallet, autosave) that M05a1 replaces with the mission VM.
  - `sandbox`: `unlock: null`, sandbox capability; toggles write the `sandbox` slice.
  - `racing`, `fighter`, `tycoon`: `status: 'comingSoon'`, tile orders 2/3/4, unlocks `unlock.racing`, `unlock.fighter`, `unlock.tycoon`, art `ui/mode-<id>`, `standalone` and `embeddable` true.

  The mode milestones (M07a1, M08a2, M09a1) replace the stubs.
- **EconomyApi** (`economy.ts`): `balance`, `credit`, `debit` and `ledgerSince`, idempotent by key. The wallet is `StorySlice.wallet.cashCents`. The tycoon-dividend cap is $10,000 per in-game week via `weekdayOf` week windows. It binds M03c's `WalletPort` and M03b2's `FareSink`.
- **Autosave policy** (C05 rule 4): mission pass, safehouse, mode exit, unlock, every 300 s of free roam at heat 0 with no mission, and `hidden` with the same eligibility. Never during a pursuit or a mission (except its checkpoint).
- **Controls remap persistence:** `UiCommand save.settings` with `controls` → `settings` slice → on load `InputRouter.setOverrides`. `client.Pause` keeps its default binding (C03 rule 9).
- **UI bridge:**
  - sim-side `UiBridge`: patches coalesced per tick with ≤ 64 patches and ≤ 4 KiB, overflow deferred to the next tick in order;
  - `toast`, `openApp`, `closeOverlay`;
  - main-side `ViewModelSource` (`get`, `subscribe` with `prefix*`, `rev`);
  - a `UiCommand` sender over the command ring, with a dispatcher in the worker for `mode.start`, `mode.quit`, `pause`, `save.*`, `sandbox.set` and `mode.cmd`.

  `hud.wallet` and `hud.clock` are patched by their owners here.
- **Clock and interaction:** wire the M02b2 clock and the M03a1 interaction system into `ModeContext`, and add the contract tests `engine/clock` and `engine/interaction.scoring`. If a rule fails, fix the S01 engine code in place.
- Telemetry `mode.enter` and `mode.exit` with registry props only.

## Scope out
- Menus, mode tiles, toasts' DOM and the settings pages: M04b1. The `GameModeUI` mount host: M04b2.
- Mission VM, zones, scheduler, timeline: M05a1. Combat core: M05c1/M08a1. `ModeContext.npc`: M06a3.
- Real racing, fighter and tycoon modes: M07a1, M08a2, M09a1.
- Mod capability filtering of `ModeContext` (C14): M13a3.

## Deliverables
- `packages/shared/src/contracts/{c06-modes.ts, ui-bridge.ts}` (verbatim; `engine-world.ts` only if M02b2 did not create it).
- `packages/engine/src/sim/modes/{host.ts, context.ts, stack.ts, unlocks.ts, economy.ts, autosave.ts, capability-bind.ts, commands.ts, stubs.ts, builtin/{story-freeroam.ts, sandbox.ts, coming-soon.ts, index.ts}, index.ts}`.
- `packages/engine/src/sim/ui/{bridge.ts, coalesce.ts}`; `packages/engine/src/client/ui/{view-model-source.ts, command-sender.ts}`.
- `packages/engine/src/sim/input/remap-persist.ts`.
- `packages/engine/test/modes/{host.states.spec.ts, host.embed.spec.ts, unlocks.spec.ts, coming-soon.spec.ts, economy.spec.ts, autosave.spec.ts, remap.spec.ts, bridge.spec.ts, clock.spec.ts, interaction.scoring.spec.ts, context.spec.ts}`.
- `packages/engine/package.json` script **`test:modes`** (`vitest run test/modes`), also run by `pnpm check:unit`.
- `tests/e2e/engine/modes.spec.ts` (`@modes`).
- About 38 files.

## Interfaces
- C06 1.1: `GameModeDescriptor`, `GameModeSim`, `GameModeUI` (type only), `ModeContext`, `UnlockRegistry`, `EconomyApi`, `UiBridge`, `ViewModelSource`, `VmPatch`, `UiCommand`, implemented exactly. No shape change; the `NotYetAvailable` stubs satisfy the types.
- C05 1.1: writes through `SaveService` only; slots per capability.
- C16 1.1: `mode.enter`, `mode.exit`, `unlock.emit` (existing names). No new name.
- C03 1.1: `InputRouter.setOverrides` and `ControlsSettings` round trip.

## Acceptance criteria
- AC-1 Given a fixture registry When a test drives `mode.start`, `startChild`, child exit and `mode.quit` Then all of these hold:
  - the states follow rule 1, and the parent is `Suspended` while its child runs;
  - a third level or a second top-level mode is refused;
  - an embed of a `canonical` mode under a `local` parent returns `false`.
  — proof: `pnpm --filter @dv/engine test:modes`
- AC-2 Given a story parent and an embeddable child with `unlockOnFirstEncounter` When the child enters twice Then the first entry emits the unlock once, writes `core.unlocks` and `core.firstEncounters`, saves with reason `unlock`, and sends one `unlock` toast and one `sys.unlocks` patch. The second entry changes nothing, and the unlock survives a reload of the profile — proof: `pnpm --filter @dv/engine test:modes`
- AC-3 Given the built-in registry When it is listed Then `story` (order 1) and `sandbox` are `available` with `unlock: null`, and `racing`, `fighter` and `tycoon` are `comingSoon` with orders 2/3/4 and refuse `mode.start`. `?unlockAll=1` unlocks in memory only in a QA build, and is ignored and never persisted when `VITE_DV_QA` is unset — proof: `pnpm --filter @dv/engine test:modes`
- AC-4 Given `EconomyApi` When `credit(500, 'r', 'k1')` runs twice and `debit` runs above the balance Then the balance rises by 500 once, the over-debit returns `false` with no ledger entry, `ledgerSince` lists exactly the applied entries, and tycoon dividends above $10,000 in one game week are capped. The M03c bust fine and the M03b2 fare debit through the same API with their idempotency keys — proof: `pnpm --filter @dv/engine test:modes`
- AC-5 Given free roam at heat 0 When 300 s pass, the page goes `hidden`, a mode exits, and then a pursuit starts Then autosaves happen for the first three with reasons `interval`, `hidden` and `modeExit`, and none happens during the pursuit — proof: `pnpm --filter @dv/engine test:modes`
- AC-6 Given a rebind of Jump to another key and an attempt to unbind Pause When `save.settings` runs and the profile reloads Then `InputRouter` holds the Jump override and Pause still has its default binding — proof: `pnpm --filter @dv/engine test:modes`
- AC-7 Given a tick that issues 100 patches of 100 B When the bridge flushes Then ≤ 64 patches and ≤ 4 KiB leave that tick, the rest follow in order on later ticks, and a main-side `subscribe('hud.*')` receives every final value with increasing `rev` — proof: `pnpm --filter @dv/engine test:modes`
- AC-8 Given the clock and interaction services When the contract tests run Then one game day is 172,800 half-seconds (30 game s per real s at rate 1), `weekdayOf(0)` is 0, `lock` and `unlock` hold and release the hour and weather, and weather draws use only stream `weather`. The interaction score is `priority × 10 − distance − angle/45`, with ties broken by handle — proof: `pnpm --filter @dv/engine test`
- AC-9 Given a `sandbox` session When a mode tries to write `story:auto` through `ctx.save` Then the write is `NOT_ALLOWED`, and `ModeContext` members that have not landed throw `NotYetAvailable` naming their milestone — proof: `pnpm --filter @dv/engine test:modes`
- AC-10 Given the QA build When the e2e sends `UiCommand mode.start {id: 'sandbox'}` through the bridge, then `mode.quit` Then the bridge reports `Running` and then `Idle`, a `modeExit` save exists, and `mode.enter`/`mode.exit` events were queued with registry props only — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @modes`
- AC-11 Given the branch When the standard gates, the telemetry registry check and the preview deploy run Then all pass — proof: `pnpm lint && pnpm typecheck && pnpm check:unit && pnpm check:telemetry && pnpm build && pnpm deploy:preview`

## Test plan
- **Unit** (`pnpm --filter @dv/engine test:modes` and `pnpm --filter @dv/engine test`, both under `pnpm check:unit`): `engine/modes.hostStates`, `modes.embed`, `modes.unlocks`, `modes.comingSoon`, `economy.idempotent`, `modes.autosave`, `modes.remap`, `ui.bridge`, `clock`, `interaction.scoring`, `modes.context`.
- **E2E:** `@modes` on `chromium-webgl2`.
- **Static:** `pnpm check:telemetry` for the emitted names.

## Demo script
1. `pnpm dev`, then in the console `__dvBridge.engine.modes.list()`: story and sandbox available; racing, fighter and tycoon coming soon.
2. Start sandbox, toggle "never wanted", quit: a `modeExit` save appears in `__dvBridge.engine.save.list()`.
3. Run the QA unlock helper for `unlock.racing`: one toast event is logged, and repeating it logs nothing.
4. Rebind Jump in the QA console, reload: the binding persists.

## Effort
1 Builder session; about 38 files; risk **medium**. `ModeContext` assembly touches many services; keep the stubs explicit and the tests table-driven.

## Risks & fallbacks
- **A service from an earlier milestone has a different shape than C06 expects.** Adapt in `context.ts`, never in the contract. Record the mismatch in the report.
- **File count.** If it goes above 40, move the e2e QA helpers into the existing bridge file and merge `stack.ts` into `host.ts`. Do not drop a test.
- **The clock implementation from M02b2 fails a contract test.** Fix it here, because it is S01 engine code, and add a decision-log line.

## Notes for the Builder
- Read first: `01-engine-save-modes.md` §C06, "Time-of-day and weather clock", "Interaction system", "Economy and combat cores", "C05 1.1 and C06 1.1 additions"; `10-ui.md` §3.3; `01-engine.md` §2.10 and §9 tests 16–17; `docs/decisions/ADR-0006-v1-vertical-slice.md` (A-06 stubs).
- Facts: F-009, F-010 (why autosave on `hidden` matters on iPhone). No external API is called.
- Order of work: contracts, bridge and command channel, registry and host, context, unlocks, economy and port bindings, autosave, remap, clock and interaction tests, e2e.
- The `story` free roam is a placeholder sim with no missions. Keep it under 150 lines; M05a1 replaces its `sim` import.
- Telemetry stays local in this milestone (consent UI arrives in M04b1). `check:telemetry` validates names and props only.
- Secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` for `deploy:preview` (SKIP locally). No genAI spend, no owner gate.
