# M04e0 — sandbox-rooms-guard

## Goal
After this session the sandbox's player tools refuse to run in an online session, and a unit test proves it. Today the guard is only implied: the sandbox descriptor declares `requires.network: 'none'` (`packages/engine/src/sim/modes/builtin/sandbox.ts`), and `createModeContext` always sets `net: null` (`packages/engine/src/sim/modes/context.ts`). M12b2, however, runs online sessions as `mode.start {id:'sandbox'}` with `ModeContext.net = {slot, peers()}`. Without a guard, the first room build would let one player change heat, the heat cap or their own position locally, outside the room's `validated` authority. This milestone adds an explicit, engine-side guard that does not depend on the descriptor. While any running mode's context has a non-null `net`:
- every `sandbox.*` `UiCommand` is refused with the toast `sandbox.refuse.online` and changes nothing;
- every `mode.cmd {mode:'sandbox'}` is refused the same way;
- the phone's sandbox fast travel (`mode.cmd {mode:'phone', name:'map.travel'}`) is refused the same way.

Single-player behaviour is unchanged. This is the rooms guard taken out of the proposed sandbox world-controls work (GV-01 AC-6) and given its own milestone, so it lands before M12b1 whatever happens to that UI work.

## Requirements
- R-ROLL-02 (support): online sessions keep one authority. A local sandbox tool can never fork the room's state, because each one is refused while `ModeContext.net` is set.
- R-UI-03 (support): the phone's Sandbox app reports the refusal as a translated toast instead of failing silently.

## Depends on
- **M04b2** (creator-phone-hud-kit): `applyToggle`, `SET_HEAT`, `NEVER_WANTED` and `publishToggles` in `packages/engine/src/sim/modes/builtin/sandbox.ts`; the phone Sandbox app (`packages/ui/src/phone/apps.ts`, case `'sandbox'`), which sends `sandbox.set`.
- **M02c2** (maps): the `map.travel` branch of `phoneCommand` in `packages/engine/src/sim/modes/commands.ts`.
- Through those: M04a2 (`ModeHost`, `ModeStack` entries with `ctx`, `createCommandDispatcher`, `ContextPorts`, the test rig `makeRig` in `packages/engine/test/modes/fixture.ts`) and M04b1 (`content/ui/i18n/en.json`, `tools/ci/check-i18n.ts`).
- All of these are merged on `claude/build`.
- **Must precede:** M12b1. No rooms milestone starts until this one has merged.
- Contracts: C06 1.1 (`ModeContext.net`, `GameModeDescriptor.requires.network`, `UiCommand`), read only. No contract change.

## Scope in
- **Net port** (`packages/engine/src/sim/modes/context.ts`):
  - `ContextPorts` gains an optional `net?: (() => ModeContext['net']) | null`.
  - `createModeContext` exposes `net` as a getter, `get net() { return p.net?.() ?? null; }`, the same pattern as `tick`. A room joined after the mode started is then seen at the next command.
  - Without the port, `ctx.net` stays `null`, so `packages/engine/test/modes/context.spec.ts` keeps passing unchanged.
  - The C06 field stays `readonly net: null | { slot; peers() }`. M12b2 supplies the real port; this milestone wires none in `packages/engine/src/sim/modes/index.ts`.
- **Guard** (`packages/engine/src/sim/modes/builtin/sandbox.ts`, in C02 lint scope):
  - `export const SANDBOX_REFUSE_ONLINE = 'sandbox.refuse.online'`.
  - `export function sandboxOnline(ctx: Pick<ModeContext, 'net'>): boolean` returns `ctx.net !== null`.
  - `applyToggle` returns `false` before touching `SandboxSlice.toggles`, publishing or calling `ctx.pursuit` when `sandboxOnline(ctx)`. This is defence in depth for any caller other than the dispatcher.
  - In `sandboxSim(...).enter`, toggles are still published to the view model, but the stored `NEVER_WANTED` is not re-applied while online.
  - `exit` is unchanged: `capHeat(6)` releases the cap whether or not the session is online.
- **Dispatcher** (`packages/engine/src/sim/modes/commands.ts`, `createCommandDispatcher`):
  - A local `online()` is true when any `d.host.stack.entries[i].ctx.net !== null`.
  - `sandbox.set` and `sandbox.teleport` check `online()` first. When it is true, they raise `toast('sandbox.refuse.online', 'warning', 'sandbox.refuse.online')` and return. No slice write, no `d.teleport` call, no patch.
  - `mode.cmd` with `cmd.mode === 'sandbox'` raises the same toast while online and emits no `mode.cmd` `SimEvent`.
  - `phoneCommand`'s `map.travel` raises the same toast while online. This check comes before the `sandboxContext()` check and before any `d.world()` call.
  - The order of every other branch is unchanged.
- **Text:**
  - `content/ui/i18n/en.json` gets `"sandbox.refuse.online"`, with original wording, for example "Sandbox tools are off while you are in an online session."
  - `tools/ci/check-i18n.ts` adds `'sandbox.refuse.'` to `EXTERNAL_PREFIXES`. The sim raises the key, so no `t()` literal in `packages/ui/src` refers to it.
- **Test rig** (`packages/engine/test/modes/fixture.ts`). Today `makeRig` passes no `teleport` dependency to `createCommandDispatcher`, and its `world` is a plain `() => ({})`. `RigOptions` gains:
  - `net?: () => ModeContext['net']`, passed through to the host's `ports`;
  - `teleport?: CommandDeps['teleport']`, passed to `createCommandDispatcher` (absent by default, as today);
  - `world?: () => ReturnType<CommandDeps['world']>`, replacing the fixed `() => ({})` when given.
  The spec passes `vi.fn()` spies for both, so AC-2 can prove they are never called. Existing callers pass none and see no change.
- **Builder decisions** in `spec/11-decision-log-builder.md` (section M04e0). New rows go only there, never to `-builder-2.md` or `-builder-3.md`.

## Scope out
- **The descriptor change** (`requires.network: 'none'` → `'optional'`) and a host check of `requires.network` against `net`: these belong to M12b2, through DL-719. This milestone leaves `network: 'none'` as it is and proves that the guard does not depend on it.
- **Despawning session-spawned sandbox cars on room join:** owned by M04e3 (cars leave when `net` turns non-null) and M12b2 (DL-719).
- **The `TeleportApi` policy for rooms** (`TeleportPolicy.allowed` in `packages/world/src/sim/api/teleport.ts`; `EV TeleportGrant`): M12b2 and M12c1. QA-only teleport paths (`packages/world/src/sim/api/debug.ts`) are not guarded here.
- **Greying out the Sandbox app's controls while online:** a view-model flag is the sandbox world-controls milestone's UI work.
- **Every new sandbox section** (weather, time, world speed, blackout, density): the sandbox world-controls milestone.

## Deliverables
- `packages/engine/src/sim/modes/context.ts` (`ContextPorts.net`, the `net` getter).
- `packages/engine/src/sim/modes/builtin/sandbox.ts` (`SANDBOX_REFUSE_ONLINE`, `sandboxOnline`, the guards in `applyToggle` and `enter`).
- `packages/engine/src/sim/modes/commands.ts` (`online()`, the four refusals).
- `packages/engine/test/modes/fixture.ts` (`RigOptions.net`, `teleport`, `world`); `packages/engine/test/modes/sandbox-guard.spec.ts` (new).
- `content/ui/i18n/en.json` (one key); `tools/ci/check-i18n.ts` (one prefix).
- `spec/11-decision-log-builder.md` (BD rows).
- About 8 files.

## Interfaces
- C06 1.1 `ModeContext.net`: read only. Its shape is unchanged; the engine now implements it as a getter backed by an engine-internal port.
- C06 1.1 `GameModeDescriptor.requires.network`: read only. The sandbox descriptor stays `'none'` here.
- C06 1.1 `UiCommand` (`sandbox.set`, `sandbox.teleport`, `mode.cmd`) and `UiBridge.toast`: used as they are.
- `ContextPorts.net` is engine-internal (`packages/engine/src/sim/modes/context.ts`) and not part of any contract.

## Acceptance criteria
- AC-1 Given the merged base with this milestone's changes When the repository checks run Then:
  - they pass;
  - `pnpm lint` reports no C02 finding in `packages/engine/src/sim/modes/**`;
  - `check:i18n` reports no missing key and does not list `sandbox.refuse.online` as unused

  — proof: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm check:unit && pnpm check:i18n`
- AC-2 Given a rig (`makeRig({ net })`) where the sandbox is running and the net port returns `{ slot: 1, peers: () => [] }` When each of these commands is dispatched:
  - `sandbox.set {path:'sandbox.player.heat', v:3}`
  - `sandbox.set {path:'sandbox.player.neverWanted', v:true}`
  - `sandbox.teleport {name:'home'}` (with a saved position `home` in the slice)
  - `mode.cmd {mode:'sandbox', name:'any', args:{}}`
  - `mode.cmd {mode:'phone', name:'map.travel', args:{x:0, z:0}}`

  Then:
  - each command raises exactly one toast whose `text` is `sandbox.refuse.online`;
  - `slices.sandbox` is deep-equal to its value before the commands;
  - no `mode.sandbox.toggles` patch leaves the bridge;
  - no `mode.cmd` `SimEvent` is emitted;
  - the `teleport` and `world` spies passed through `RigOptions` are never called

  — proof: `pnpm check:unit -- packages/engine/test/modes/sandbox-guard.spec.ts`
- AC-3 Given a hand-built `ModeContext` stand-in with `net` set and a `pursuit` spy When `applyToggle` is called for `SET_HEAT` and for `NEVER_WANTED`, and `sandboxSim(env).enter` runs with a stored `NEVER_WANTED: true` Then:
  - `applyToggle` returns `false`;
  - the toggles object is unchanged;
  - `setHeat`, `capHeat` and `clear` are never called;
  - `enter` still publishes `mode.sandbox.toggles` once

  — proof: `pnpm check:unit -- packages/engine/test/modes/sandbox-guard.spec.ts`
- AC-4 Given a rig where the sandbox started with the net port returning `null`, run twice: once with the shipped sandbox descriptor, and once with a copy whose `requires.network` is `'optional'` passed through `RigOptions.descriptors` (same id, so it replaces the built-in) When `sandbox.set` sets the heat, then the port switches to a fake net, then `sandbox.set` sets the heat again Then, in both runs:
  - the first command writes the toggle and raises no refusal;
  - the second is refused with `sandbox.refuse.online`;
  - `ctx.net` read from the running entry reflects the switch.

  The spec never asserts the shipped descriptor's `network` value, so M12b2's change to `'optional'` (DL-719) leaves it green

  — proof: `pnpm check:unit -- packages/engine/test/modes/sandbox-guard.spec.ts`
- AC-5 Given single-player (no net port) When the existing mode suites run Then they pass unchanged: `context.spec.ts` still sees `ctx.net === null`, and the `garage.call` and command cases in `bridge.spec.ts`, `autosave.spec.ts` and the host specs are untouched — proof: `pnpm check:unit -- packages/engine/test/modes`
- AC-6 Given `content/ui/i18n/en.json` When the guard spec reads it Then it holds a non-empty `sandbox.refuse.online` string that does not contain `DISPLAY_NAME` or `SHORT_NAME` from `config/brand.ts` — proof: `pnpm check:unit -- packages/engine/test/modes/sandbox-guard.spec.ts`

## Test plan
- **Unit:** `packages/engine/test/modes/sandbox-guard.spec.ts` (AC-2, AC-3, AC-4, AC-6), run with `pnpm check:unit -- packages/engine/test/modes/sandbox-guard.spec.ts`.
- **Regression:** the whole mode suite, `pnpm check:unit -- packages/engine/test/modes` (AC-5).
- **Repository:** `pnpm typecheck`, `pnpm lint` (C02 scope covers `packages/engine/src/sim/**`), `pnpm check:i18n`.
- **No e2e:** no room exists before M12b1. M12b2 re-runs this spec as its re-proof and adds one case with its real net port (DL-719; M12b2 AC-10).

## Demo script
1. `pnpm check:unit -- packages/engine/test/modes/sandbox-guard.spec.ts`: every case passes. The log names the five refused commands.
2. `pnpm check:unit -- packages/engine/test/modes`: the single-player suites are green.
3. `pnpm check:i18n`: `missing English keys: 0`, and `sandbox.refuse.online` is not among the `unused` lines.

## Effort
0.2 Builder session; about 8 files; risk **low**.

## Risks & fallbacks
- **M12b2 binds `net` somewhere other than `ContextPorts`.** The dispatcher's `online()` reads `ctx.net` of every stack entry, so any binding that fills the C06 field is caught. A binding that bypasses the field would be a contract deviation, which M12b2's re-proof of this spec exposes.
- **The getter changes how `ctx` is copied.** A spread or `structuredClone` of a context would freeze `net` at copy time. A Builder who finds such a copy in `packages/engine/src/sim/modes/**` reads `net` through the port there as well and records a BD row; the C06 shape does not change.
- **`check:i18n` counts the new key as unused.** If the prefix rule does not match, add the key to the tool's exact-literal list instead and record a BD row.

## Notes for the Builder
- **Read first:**
  - `packages/engine/src/sim/modes/{context.ts, commands.ts, builtin/sandbox.ts, host.ts, stack.ts, index.ts}` (the `createCommandDispatcher` call around `sandboxContext`);
  - `packages/engine/test/modes/{fixture.ts, context.spec.ts, bridge.spec.ts}`;
  - `tools/ci/check-i18n.ts` (`EXTERNAL_PREFIXES`);
  - `spec/domains/10-ui-hud-xr.md` §phone (the sandbox menu is "disabled in story missions and rooms") and `spec/domains/02-world-maps.md` §5 (sandbox teleport is disabled in rooms);
  - M12b2 "Session wiring" (`spec/07-milestones/M12b2-rooms-core-protocol-v2.md`).
- **Order of work:**
  1. the port and getter;
  2. `sandboxOnline` and the `applyToggle` guard;
  3. the dispatcher refusals;
  4. the rig option and spec;
  5. the text key.
- **Refusal comes first.** Check `online()` before `sandboxContext()` and before any `d.world()` or `d.ride()` call. The rig's `world` is an empty object, so a call that reaches it throws.
- **C02:** `sandbox.ts` and `commands.ts` sit in lint scope. No `Date`, no timers, no `for…in`; `Array.prototype.some` over the stack entries is fine.
- **IP wall:** the refusal text and all identifiers are original. Do not reuse status strings from other sandbox menus or mod tools.
- **Secrets:** none.
