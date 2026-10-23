# M10f — emote-wheel

## Goal
After this session the player can express themselves in free roam. Holding the existing `SimButton.Emote` (bit 17) opens an emote wheel of eight original, code-built clips: wave, clap, two-step, check phone, sit down, shrug, stretch, nod along. The move stick or keys choose a slot, and letting go plays it as `AnimStateId` 21 (`ANIM_STATE.emote`). Moving, jumping, entering a car, a mission start or leaving free roam ends it. The phone's Sandbox app gets an **Emotes** list that plays the same clips, so touch, one-handed and XR-panel players have a path that needs no two-thumb gesture. Slot choice and every start, cancel and end is decided in the sim from the `InputFrame`, so replays and state hashes stay deterministic. The clips use the `bay_rig_v1` bone names, so they play on the mannequin and on the M10d1 bodies. This takes over the *Emotes* section of the sandbox menu, which `spec/domains/10-ui-hud-xr.md` l.64 gives to M06a, although none of M06a1–M06a5 builds it.

## Requirements
- R-UI-03 (support): the Sandbox app, an implied page, gets its Emotes section, and the story and sandbox HUD gets the wheel.
- R-ENG-04 (support): `sim.Emote` is bound on keyboard, gamepad and touch and appears on the Controls page, so it can be remapped. The wheel has no motion beyond the 150 ms rule.
- R-IP-01 (support): every clip, name and icon is original. There is no motion capture, no likeness, and no choreography or emote name taken from a game, an artist or a video.

## Depends on
- **M10d1** (art-integration): final bodies on `bay_rig_v1`, which are the creator parts and the ped kit. The clips are authored and checked against them.
- **M04b2** (creator-phone-hud-kit):
  - in `packages/ui/src/phone/apps.ts`, the `'sandbox'` case of `appScreen` and `visibleApps`;
  - the `call` switch in `packages/ui/src/phone/pause.tsx`, which already sends `mode.cmd` with the reserved owner `phone`;
  - `StoryHud` and `useVm` (`packages/ui/src/hud/`);
  - the touch layouts and `validateLayout` (`packages/ui/src/hud/touch.ts`, `config/input/touch/*.json`);
  - `actionsOf` (`packages/ui/src/pages/settings/controls.tsx`);
  - the `hud.*` mirror in `packages/engine/src/client/boot/boot-engine.ts`.
- Through those, on `claude/build`:
  - in `packages/engine/src/sim/control/`: `onFootSystem`, `registerControlSystems`, and `CONTROL_STATE` and `animStateOf` in `states.ts`;
  - `AnimGraph`, `PLAYER_GRAPH`, `buildPlaceholderClips` and `MannequinAnimator` (`packages/engine/src/client/anim/`);
  - `createCommandDispatcher` and `phoneCommand` in `packages/engine/src/sim/modes/commands.ts`, and `playerSide` in `publish.ts`;
  - `createWalkSim` (`packages/engine/test/walk-sim.ts`).
- Not a dependency: M04e1. If its `sandbox-tabs` widget is on the base, the Emotes list becomes a tab of it. If not, the list is appended to the Sandbox app.
- Contracts: C03 1.1, C04 1.1, C01 1.0, C06 1.1. No contract change.

## Scope in
- **Config.** `config/emotes.json` with the schema `config/schemas/emotes.schema.json` (`emotes/1`):
  - `deadZone` is an integer, 32 to 120, on the i8 stick scale. The default is 64.
  - `slots` holds exactly 8 entries, `{ slot 0..7, id, nameKey, loop, ticks?, enabled }`. `id` matches `^[a-z][a-z0-9-]{1,23}$` and is unique. `ticks` is an integer, 30 to 600, and is required when `loop` is false.
  - The seed slots, clockwise from up (60 ticks per second):

    | slot | id | type |
    |---|---|---|
    | 0 | `wave` | one-shot, 120 ticks |
    | 1 | `clap` | loop |
    | 2 | `two-step` | loop |
    | 3 | `phone` | loop |
    | 4 | `sit` | loop |
    | 5 | `shrug` | one-shot, 90 ticks |
    | 6 | `stretch` | one-shot, 180 ticks |
    | 7 | `nod` | loop |

  - The sim imports the file the way `packages/engine/src/sim/world/clock.ts` imports `config/clock.json`.
- **Sim** (`packages/engine/src/sim/control/emote.ts`, new; C02 lint applies):
  - **`emoteSector(moveX, moveY, deadZone)`.** Returns −1 when `moveX² + moveY² < deadZone²`. Otherwise it returns sector 0 to 7, with 0 being stick up (`moveY < 0`) and the rest clockwise. It uses integer arithmetic only, with no `datan2`. With `ax = |moveX|` and `ay = |moveY|`, the result is vertical when `ay·1000 ≥ ax·2414`, horizontal when `ay·1000 ≤ ax·414`, and diagonal otherwise. The eight WASD combinations map to sectors 0 to 7 exactly.
  - **Control states** (`states.ts`, all in the on-foot family 100–199):
    - `emoteWheel: 130`;
    - `emotePlay: 140` plus the slot, 140 to 147, while the stick has not been centred since the start;
    - `emoteArmed: 150` plus the slot, 150 to 157;
    - `animStateOf` maps 130 to 0 (idle) and 140 to 157 to 21;
    - `emoteSlotOf(state)` returns the slot, or −1.
  - **`emoteSystem`**, registered by `registerControlSystems` before `onFootSystem` (stage `PhysicsPre`, order −25). It acts only on the local player while `Control.owner` is `OnFoot`, `frame.context` is `onFoot` and `services.emoteGate?.()` is true. A null gate counts as closed. It runs these rules:
    - **Open:** a rising edge of `Emote` while the player is grounded and in idle, walk, run or sprint sets 130.
    - **Choose:** while the state is 130 and `Emote` is held, the sector is published. The player stands still.
    - **Release:** a falling edge of `Emote` while the state is 130 starts slot = sector (state 140 + slot), if that slot is `enabled`. Otherwise it returns to idle.
    - **Arm:** from a 14x state, one tick with the stick inside the dead zone moves the state to 15x.
    - **Cancel:** in a 15x state, a stick outside the dead zone returns the state to idle, and `onFootSystem` moves the player in the same tick. In any 13x, 14x or 15x state, a `Jump` or `Enter` press, a new `Emote` press, a closed gate or an owner change returns the state to idle, and the jump or entry then runs as usual.
    - **End:** a one-shot returns to idle at `sinceTick + ticks`.
    - **Phone request:** `services.emoteRequest` (a slot, or null) starts that slot on the next tick if the player is grounded in idle or walk with the gate open. The request is cleared on that tick either way.
  - **`onFootSystem`.** In states 130 to 157 it uses neutral movement (gravity and ground snap still run). It keeps `next` at the emote state, writes `an.state = animStateOf(state)`, and sets `an.p0` to the slot (0 while the wheel is open).
  - **Services** (`packages/engine/src/sim/services.ts`): `emoteGate: (() => boolean) | null` and `emoteRequest: number | null`. Neither is hashed or saved. `Control.state` and `sinceTick` are hashed and carry all of the emote state, so no new resource exists, and a run without an `Emote` press hashes exactly as before.
  - **Gate** (`packages/engine/src/sim/modes/index.ts`, next to `sandboxContext`). It is true only when all three hold:
    - the top `Running` stack entry is `story` or `sandbox` (so a racing, fighter, tycoon or `exp:` child closes it);
    - `live.story.activeMission === null`;
    - that entry's `ctx.net === null`, so rooms stay closed.
  - **Phone command** (`commands.ts`, `phoneCommand`): `emote.play` with `args.slot` (an integer from 0 to 7 naming an `enabled` slot; anything else is ignored). It calls `CommandDeps.emote(slot)`, which sets `emoteRequest`. When the gate is closed, it raises the warning toast `emote.refuse.notHere` instead.
  - **Snapshot** (`publish.ts`): `PlayerSide` gains `anim` (the `Anim.state`) and `emote: { open, sector, slot } | null`.
- **Client:**
  - **Clips** (`packages/engine/src/client/anim/emote-clips.ts`, new): eight clips built in code from pose functions, the same way `buildPlaceholderClips` builds the existing ones. Each is named `emote.<id>` under `ClipRef.asset` `anim/bay_rig_v1.proc`. Tracks are `<bone>.quaternion` for each of the 22 `HUMANOID_BONES` plus `hips.position`, so `sit` lowers the hips for display only and the capsule does not change. Each one-shot's duration equals `ticks / 60` s.
  - **Graph:** `PLAYER_GRAPH` gains state 21, `emote`, with `blend1d` on `p0` over `[slot, clip]` for the enabled slots. An integer `p0` gives one clip weight 1.
  - **Animator:** `MannequinAnimator` binds every clip in the rig's map. When state 21 is entered or `p0` changes, it resets the selected emote action to time 0.
  - **Wheel mirror:** `boot-engine.ts` mirrors `hud.emote` as `{ sector }` while `pl.emote.open` is true, and as null otherwise.
  - **Touch icon:** the `ICONS` map of `packages/engine/src/client/input/touch-overlay.ts` gains `emote`, an original inline SVG.
- **Bindings:**
  - kbm `onFoot`: `"sim.Emote": [{ "control": "key:KeyG" }]`;
  - gamepad `onFoot`: `pad:b5`;
  - touch `onFoot`: `touch:btn:emote`;
  - an `emote` button widget in `default-right`, `default-left` (mirrored, `bl` corner) and `compact`: 56 px, `icon: "emote"`, `label: "touch.emote"`, placed where `validateLayout` passes;
  - `one-handed` gets no button, because one thumb cannot hold the button and steer at once; those players use the phone list.
- **UI:**
  - **Wheel** (`packages/ui/src/hud/emote-wheel.tsx`, new), rendered inside `StoryHud`. It reads `hud.emote` and renders nothing when the key is null. Otherwise it shows eight sectors with `data-testid` `hud-emote-wheel` and `hud-emote-<slot>`, the localized names, a disabled look for a slot that is not enabled, `aria-selected` on the sector under the stick, and the hint `hud.emote.hint`. It has no transition above 150 ms and none under reduced motion.
  - **Sandbox app** (`apps.ts`): a heading `phone.sandbox.emotes` and a `list` widget `sandbox-emotes` with one row per enabled slot (row id is the slot), `onPress: { call: 'phone.emote' }`.
  - **Phone call** (`pause.tsx`): `case 'phone.emote'` sends `{ t: 'mode.cmd', mode: 'phone' as never, name: 'emote.play', args: { slot } }`, then resumes play the way `btn-pause-resume` does.
- **Strings** (`content/ui/i18n/en.json`, our own wording): `action.sim.Emote`, `touch.emote`, `hud.emote.hint` ("Pick with the stick, let go to play"), `hud.emote.<id>` × 8, `phone.sandbox.emotes`, `emote.refuse.notHere` ("Emotes are off right now").

## Scope out
- **Emotes in rooms.** Bit 17 never travels in C11 `IN`, and the slot (`Anim.p0`) is render-only, so emotes stay closed in rooms in v1 (DL-719). The gate stays closed while `ctx.net` is set.
- **The wheel drawn in XR.** XR players use the Sandbox app list on the M11b3 panel.
- **NPC or ped emotes**, and story missions scripting the player's emotes (C09 `anim` actions already exist).
- **Asset-file clips (`anim/` glTF):** a later art pass (M10a2 animation route, Q-24) may replace the code clips under the same clip names with no graph change.
- **Spec-text edits:** done by the Architect (DL-716, DL-718): `10-ui-hud-xr.md` §2.10 names M10f as the *Emotes* owner, and the `_PLAN` and README rows exist.

## Deliverables
- Sim:
  - `packages/engine/src/sim/control/{emote.ts (new), states.ts, onfoot.ts, index.ts}`;
  - `packages/engine/src/sim/{services.ts, publish.ts}`;
  - `packages/engine/src/sim/modes/{index.ts, commands.ts}`.
- Client: `packages/engine/src/client/anim/{emote-clips.ts (new), graph.ts, placeholder-rig.ts}`, `packages/engine/src/client/boot/boot-engine.ts`, `packages/engine/src/client/input/touch-overlay.ts`.
- Config: `config/emotes.json`, `config/schemas/emotes.schema.json`, `config/input/defaults.{kbm,gamepad,touch}.json`, `config/input/touch/{default-right,default-left,compact}.json`.
- UI: `packages/ui/src/hud/{emote-wheel.tsx (new), story-hud.tsx}`, `packages/ui/src/phone/{apps.ts, pause.tsx}`, `packages/ui/src/kit/m10f-emote.css` (new), `content/ui/i18n/en.json`.
- Tests:
  - `packages/engine/test/control.emote.spec.ts` (new);
  - `packages/engine/test/anim.graph.spec.ts` and `packages/engine/test/walk-sim.ts` (a gate option);
  - `packages/ui/test/emote-wheel.spec.ts` (new), and `packages/ui/test/phone.spec.ts` (extended);
  - `tests/e2e/ui/emote.spec.ts` (new, `@emote`).
- BD rows in `spec/11-decision-log-builder.md`, plus `docs/device-runs/M10f/iphone/notes.json` (AC-10).
- About 34 files.

## Interfaces
- **C03 1.1:** `SimButton.Emote = 17` is read, with no change. The default `InputMap` files gain bindings.
- **C04 1.1:** `AnimStateId` 21 `emote` is used as defined. `AnimStateDef` and `AnimGraphDef` are unchanged.
- **C01 1.0:** the `Control` shape is unchanged. The new `state` values sit inside the on-foot family.
- **C06 1.1:**
  - `UiCommand` `mode.cmd` with the reserved owner `phone` is an existing practice;
  - `VmKey` `hud.emote` fits `hud.${string}`;
  - `ModeContext.net` is read only.
- **Internal:** `EngineServices.emoteGate` and `emoteRequest`, and `PlayerSide.anim` and `emote` (`publish.ts`).

## Acceptance criteria
- AC-1 Given the merged base When the repository checks run Then they all exit 0 — proof: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm check:unit && pnpm build`
- AC-2 Given `emoteSector` and `config/emotes.json` When the unit cases run Then:
  - W, W+D, D, S+D, S, S+A, A and W+A (±127 axes) give sectors 0 to 7;
  - (0, 0) and (40, 40) give −1 at `deadZone` 64;
  - (127, −52) gives 2 and (127, −53) gives 1, the 22.5° boundary (negative `moveY` is up);
  - the config validates against `emotes.schema.json` with 8 slots and unique ids, and a fixture missing `ticks` on a one-shot fails naming the slot

  — proof: `pnpm check:unit -- packages/engine/test/control.emote.spec.ts`
- AC-3 Given `createWalkSim` with the gate open and the player idle and grounded When `Emote` is held for 10 ticks with `moveX = 127` and then released Then:
  - the state is 130 during the hold, and the feet move less than 0.01 m;
  - after the release the state is 142 and `Anim.state` is 21 with `p0` 2;
  - with the stick still at 127 the state stays 142, and one centred tick makes it 152;
  - `moveY = −127` then returns the state to a locomotion state within 1 tick and the player moves;
  - a `Jump` press in 152 jumps on that tick;
  - `wave` (slot 0) returns to idle exactly 120 ticks after its start;
  - a release with the stick centred, or on a slot set `enabled: false` in a fixture, returns to idle

  — proof: `pnpm check:unit -- packages/engine/test/control.emote.spec.ts`
- AC-4 Given the same rig When the gate is null, when a modes fixture has `activeMission` set, when a `racing` child mode runs, when `ctx.net` is non-null, and when the owner is `Vehicle` Then `Emote` never sets 130. When a mission starts during state 144, the state returns to idle on the next tick. In a modes fixture, `mode.cmd {mode:'phone', name:'emote.play', args:{slot:4}}` starts 144 on the next tick with the gate open, and raises the toast `emote.refuse.notHere` with it closed. A slot of 9 changes nothing — proof: `pnpm check:unit -- packages/engine/test/control.emote.spec.ts packages/engine/test/modes`
- AC-5 Given the existing state-hash goldens When the engine suites run Then every golden passes unedited, and two runs of one scripted emote sequence give equal state hashes — proof: `pnpm check:unit -- packages/engine && git diff --exit-code "$(git merge-base HEAD origin/main 2>/dev/null || git merge-base HEAD origin/claude/build)" -- packages/engine/test/golden`
- AC-6 Given `PLAYER_GRAPH` and the emote clips When the graph tests run Then:
  - state 21 with `p0 = k` gives weight 1 to `emote.<id of slot k>` alone after the 0.2 s fade;
  - entering state 21 resets that action's time to 0;
  - every emote track targets a `HUMANOID_BONES` name or `hips.position`;
  - each one-shot clip lasts `ticks / 60` s

  — proof: `pnpm check:unit -- packages/engine/test/anim.graph.spec.ts`
- AC-7 Given the bindings and layouts When the UI unit tests run Then:
  - the shipped layouts pass `validateLayout` (safe area, at least 44 px, 8 px spacing, known actions, one-handed reach);
  - `touch:btn:emote` is bound in `defaults.touch.json`;
  - `default-right`, `default-left` and `compact` hold an `emote` button and `one-handed` holds none;
  - `actionsOf('kbm','onFoot')` and `actionsOf('gamepad','onFoot')` contain `sim.Emote`

  — proof: `pnpm check:unit -- packages/ui/test/touch-layout.spec.ts packages/ui/test/emote-wheel.spec.ts`
- AC-8 Given `EmoteWheel` and the phone When the UI unit tests run Then:
  - **wheel:**
    - with `hud.emote` null it renders no node;
    - with `{ sector: 3 }` it renders 8 sectors, and only `hud-emote-3` has `aria-selected="true"`;
    - a disabled slot renders its disabled look;
  - **Sandbox app:** `appScreen('sandbox', …)` holds the list `sandbox-emotes` with one row per enabled slot (in the `sandbox-tabs` tab when that widget exists);
  - **phone call:** pressing row 4 sends `{ t: 'mode.cmd', mode: 'phone', name: 'emote.play', args: { slot: 4 } }`;
  - **parity:** the `ScreenDef` parity test still passes

  — proof: `pnpm check:unit -- packages/ui/test/emote-wheel.spec.ts packages/ui/test/phone.spec.ts packages/ui/test/ui-screen-parity.spec.ts`
- AC-9 Given the new strings, ids and icon When the language and IP gates run Then every new key has its English value and no new string, id or file name matches the denylist or a registry name — proof: `pnpm check:i18n && pnpm ip:strings && pnpm names:lint`
- AC-10 Given a QA build on the gray-box block (`/?debug=1`, the sandbox runs) When `@emote` runs Then:
  - **hold:** with `KeyG` held and `KeyD` pressed, `hud-emote-wheel` is visible with `hud-emote-2` selected, and its computed transition is at most 150 ms;
  - **release:** after `KeyG` is released, `observe().player.anim` is 21 and `player.emote.slot` is 2, and the wheel is gone;
  - **cancel:** releasing `KeyD` and then holding `KeyW` makes `anim` leave 21 and the player move more than 1 m;
  - **phone path:** `__dvBridge.engine.modes.send({t:'mode.cmd', mode:'phone', name:'emote.play', args:{slot:4}})` makes `anim` 21 with `slot` 4;
  - **regressions:** `@ui-hud`, `@ui-motion` and `@determinism` stay green

  — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep "@emote|@ui-hud|@ui-motion|@determinism" && pnpm check:e2e -- --project=webkit-webgl2 --grep @emote`
- AC-11 Given an iPhone 15 at `?tier=mobile-low` on a QA preview When the tester holds the emote button, drags the move stick right, lets go, then plays `sit` from Pause, then the phone's Sandbox app Then each clip plays, moving the stick ends it, and the F3 panel shows no frame-time change beyond the tier's budget over 60 s — proof: manual: iPhone 15 (Safari, installed PWA), `pnpm deploy:preview`, open the preview URL with `?debug=1&tier=mobile-low`, run the steps, record the results in `docs/device-runs/M10f/iphone/notes.json`; without a device, list AC-11 under "Blocked on".

## Test plan
- **Unit:**
  - `control.emote.spec.ts` (sector table, config schema, state machine, gate, phone request, hash equality);
  - `anim.graph.spec.ts`; `packages/engine/test/modes`;
  - `touch-layout.spec.ts`, `emote-wheel.spec.ts`, `phone.spec.ts`, `ui-screen-parity.spec.ts`.
- **Gates:** `check:i18n`, `ip:strings`, `names:lint`.
- **E2E:** `@emote` on Chromium and WebKit; `@ui-hud`, `@ui-motion` and `@determinism` as regressions.
- **Device:** AC-11.

## Demo script
1. `pnpm dev` and open `/?debug=1`. The gray-box sandbox starts.
2. Hold G. The wheel appears. Press D: "Two-step" lights up. Let go of G: the mannequin dances.
3. Press W: the dance stops and the player walks.
4. Hold G, press W+A and let go: "Nod along" loops. Press Space: the player jumps out of it.
5. Press Escape, open the phone, then Sandbox, then Emotes, and pick "Sit down". The game resumes with the player sitting.

## Effort
0.6 Builder session; about 34 files; risk **low** to **medium**: clip quality from pose functions, and the one-shot timing between the sim and the mixer.

## Risks & fallbacks
- **Code-built clips look stiff on the M10d1 bodies:** ship the four core slots (`wave`, `two-step`, `phone`, `sit`, the gamedesign §7.7 set) and set the other four `enabled: false`. The wheel greys them out and AC-3 covers a disabled slot. Record a BD row.
- **`pad:b5` collides with a later default binding:** the action is remappable (AC-7). Change the default in `defaults.gamepad.json` only, with a BD row.
- **A phone-started emote does not replay from recorded input,** because commands are not input frames. The wheel path replays exactly. Phone starts are presentation only and change no hashed state except `Control.state`, which a replay re-derives. Document this in the BD row.
- **The mixer and the sim disagree on a one-shot's end:** the sim's `ticks` is authoritative. The animator clamps the clip at its last frame until the state leaves 21.

## Notes for the Builder
- **Read first:**
  - in `packages/engine/src/sim/control/`: `states.ts`, `onfoot.ts` and `index.ts`;
  - in `packages/engine/src/sim/modes/`: `commands.ts` and `index.ts` (`sandboxContext`, the `game()` binding with `activeMission`);
  - in `packages/engine/src/client/anim/`: `graph.ts` and `placeholder-rig.ts`;
  - `boot-engine.ts` (`mirrorHud`);
  - `packages/ui/src/hud/{story-hud.tsx, touch.ts}`, `packages/ui/src/phone/{apps.ts, pause.tsx}`;
  - `tests/e2e/ui/hud.spec.ts` (bridge typing);
  - M04b2, and M04e1 if it has merged.
- **Order:** sector and states first, then the system and gate, then the graph and clips, then bindings and layouts, then UI, then e2e.
- **Determinism:** no `Math.atan2` or `Math.sin` in `src/sim/**` (C02). The clip pose functions live under `src/client/`, where `Math` is allowed, as in `placeholder-rig.ts`.
- **IP wall:** the clips are original poses written for this repo. Do not imitate a recognisable dance, game emote or performer, and name nothing after one. This milestone was planned from an outside study of ideas only. No string, label, section name or menu structure from any studied tool enters code or `en.json`.
- No secrets, no genAI spend, no Worker change. Branch `m10f-emote-wheel`.
