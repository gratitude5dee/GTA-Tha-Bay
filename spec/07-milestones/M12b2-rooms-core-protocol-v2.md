# M12b2 — rooms-core-protocol-v2

## Goal
Two players can see each other move in San Francisco. When this session ends, `RoomDO` sends each player only what is near them (64 m grid, radius 150 m on foot and 300 m in a vehicle, 70 m hysteresis, 20/10/5 Hz bands). It validates every claimed pose against world bounds and the per-class caps in `config/net.speedcaps.json`, corrects or kicks cheaters, and slows or drops lagging receivers. On the client, `packages/net/src/client` holds `RoomClient` (assign, connect, `IN` cadence, `ACK`, close-code reactions). `packages/engine/src/net` runs the C02 `NetIn`/`NetOut` phases in `sim.worker` with a 64-tick prediction ring, correction blending, net slots as `player:<slot>` and a `stateHash` every 60 ticks. An online session is the sandbox mode with `ModeContext.net` set. Two isolated Playwright pages pass the `@mp` test, and two browsers are checked on staging.

## Requirements
- R-ROLL-02: an open-world multiplayer session on the rooms Worker with `validated` authority, interest management and client prediction.

## Depends on
- M12b1 (rooms Worker, codec, clock, tick loop, tickets, gates).
- Contracts: C11 1.0 (`09-backend-contracts.md` §1.3–§1.8; `config/net.speedcaps.json` rows of `09-backend-contracts-1.1.md` §3, C11 shape unchanged), C02 1.1 (`FramePhase.NetIn`/`NetOut`, `NET_DIVISOR`, `stateHash`), C01 1.0 (`player:<slot>` keys), C06 1.1 (`ModeContext.net`).

## Scope in
- Interest (`services/rooms/src/room/interest.ts`): uniform 64 m spatial hash; set = players within 150 m on foot or 300 m in a vehicle; leave only beyond radius + 70 m; bands: ≤ 50 m every tick, 50 m to radius every 2nd tick, hysteresis zone every 4th; own vehicle occupants and the same activity instance always included; `EV Joined`/`Left` go only to sockets whose interest set contains the slot, plus everyone on join for the roster list (C11 §1.5).
- Validation (`packages/net/src/validate.ts`, pure, shared with client tests): finite pose, inside `config/world.bounds.json` (C08), speed since the last accepted pose ≤ `SPEED_CAPS[class]` × 1.25, class from the occupied vehicle prefab or `foot`. Rejection keeps the last accepted pose, sets `SnapHeader.flags.CORRECTION`, sends `EV Correction {reason}`; 10 rejections in 10 s → `RoomDO.kick(sid, 'cheat_speed')`: `{t:'kick', code}`, close 4004 with that reason, slot freed with no ghost, `EV Left {reason:'kicked'}`. Positions change otherwise only through `EV TeleportGrant` (spawn).
- `config/net.speedcaps.json` with the per-class m/s rows (foot 12, D 58, C 77, B 89, A 105, S 119, R 63, police 73, default 95) and a JSON Schema.
- Slow receivers: lag = `tick − lastSnapTick` from `ACK`; > 10 → every other tick with `DEGRADED`; > 40 → close 1013 `too_slow`.
- `RoomClient` (`packages/net/src/client/room-client.ts`): route 23 then route 24; `IN` at 20 Hz with one sample (desktop, XR) or 10 Hz with two samples (mobile tiers, `MOBILE_SEND_HZ`); `ACK` every 250 ms; `ping` every 20 s; close reactions per C11 §1.3 (1000, 4004, 4006, 4007 stop; 4001 refresh then one retry; 4002 PWA update flow; 4003 re-assign; 4005 fresh join; 1001, 1006, 1013, 4008 reconnect with jitter 250 ms → 4 s; resume itself lands in M12c1). `modsActive` is false until the mod runtime exists (M13a3 wires C14 `modsActive()`).
- Engine (`packages/engine/src/net/`): socket in `sim.worker` (Q-ENG-03 default) with a main-thread `MessagePort` relay chosen by feature detection when the worker has no `WebSocket`; `NetIn` drains decoded frames into the command ring before the Commands stage; `NetOut` encodes the C03 `InputFrame` into the `IN` sample (buttons bits 0–15, brake 0..127) after ticks where `tick % NET_DIVISOR === 0`; prediction ring of 64 `(InputFrame, Transform, Control)`; on `CORRECTION` snap to the server pose and replay inputs after `ackSeq`; otherwise errors above 0.3/0.8/2.0 m blend with gains 0.05/0.12/0.4, and vehicle transitions snap (`01-engine.md` §2.13); remote players are kinematic proxies keyed `player:<slot>`, positioned from the clock's render time (interpolation, shortest-arc yaw, no interpolation across enter/exit, extrapolation ≤ 250 ms); `stateHash` every 60 ticks kept in a ring for desync diagnosis.
- Session wiring: `mode.start {id:'sandbox'}` with `ModeContext.net = {slot, peers()}`; single-player keeps `net: null` and is unchanged.
- QA bridge (QA builds only): `__dvBridge.net` with `join()`, `state()`, `peers()` (slot → pose and the server tick that produced it), `hashes()`, `transport()` (`'worker' | 'relay'`, `hosts.rt`, cross-origin or not).
- Playwright: a second `webServer` runs the rooms Worker on port 8789; the web Worker's dev `RT_ORIGIN` points at it; rooms CORS allows `http://localhost:8788` in dev only.

## Scope out
- `ACT` interactions, resume and ghosts, checkpoints, AFK hibernation, drain, presence, invites, staff kick route, in-session 4007 → M12c1. Chat, progress, load test, `rooms.capMax` → M12c2.
- Online page and nameplates → M12d. Ambient-traffic seeding beyond the `EV World.trafficSeed` already in `welcome`: clients keep simulating ambient traffic locally from that seed; server vehicle entities arrive with `ACT` in M12c1.

## Deliverables
- `services/rooms/src/room/{interest.ts, validate-apply.ts, lag.ts, kick.ts}`; edits to `RoomDO.ts`, `tick.ts`.
- `packages/net/src/validate.ts`; `packages/net/src/client/{room-client.ts, reconnect.ts}`; `packages/net/test/{validate.test.ts, room-client.test.ts}`.
- `config/net.speedcaps.json`, `config/schemas/net.speedcaps.schema.json` (validated by `check:assets`).
- `packages/engine/src/net/{net-in.ts, net-out.ts, prediction.ts, correction.ts, proxies.ts, socket-host.ts, relay.ts}`; `packages/engine/src/net/{prediction,correction,relay}.test.ts` (colocated so `check:unit -- packages/engine/src/net` selects them).
- Sandbox wiring for `ModeContext.net` (edit in `packages/engine/src/sim/modes`), `packages/engine/src/client/debug/` bridge additions.
- `services/rooms/test/{rooms-interest, rooms-speed, rooms-ack-lag}.test.ts`.
- `tests/e2e/mp-two-clients.spec.ts` (`@mp`), `playwright.config.ts` (second `webServer`).
- `docs/device-runs/M12b2/desktop/notes.json` (from the staging run).

## Interfaces
- C11 1.0, C02 1.1, C01 1.0, C06 1.1 consumed as frozen. `config/net.speedcaps.json` is data under C11 §1.7 rule 3, not a shape change.
- No contract change.

## Acceptance criteria
- AC-1 Given a recipient on foot with players at 40 m, 120 m and 200 m When 8 ticks run Then the 40 m player is in all 8 snapshots, the 120 m player in 4 and the 200 m player in none; with the recipient in a vehicle a player at 250 m is in 4 of 8; and a player walking away from an on-foot recipient appears every 4th tick between 150 m and 220 m and leaves the set once past 220 m — proof: `pnpm check:workers -- rooms-interest`
- AC-2 Given a socket on foot When it claims a pose implying 16 m/s, a non-finite coordinate, and a point outside `config/world.bounds.json` Then each is rejected, the last accepted pose is kept, the next `SNAP` carries `CORRECTION` and `EV Correction` gives reasons `speed`, `bounds`, `bounds`; at 14 m/s (within 1.25 × 12) it is accepted; the 10th rejection inside 10 s sends `{t:'kick', code:'cheat_speed'}` and close 4004 — proof: `pnpm check:workers -- rooms-speed`
- AC-3 Given a socket whose `ACK` lags When the lag passes 10 ticks Then it receives snapshots every other tick with `DEGRADED`; past 40 ticks it is closed 1013 `too_slow` — proof: `pnpm check:workers -- rooms-ack-lag`
- AC-4 Given `RoomClient` against a fake socket When each close code of C11 §1.3 arrives Then it stops, refreshes once, starts the update flow, re-assigns, joins fresh or reconnects exactly as the table says with delays between 250 ms and 4 s; a desktop tier sends 20 `IN` frames per second with one sample and a `mobile-low` tier 10 frames with two samples; `ACK` is sent every 250 ms — proof: `pnpm check:unit -- packages/net`
- AC-5 Given a recorded input stream and a server correction at tick 300 When prediction replays Then the replayed pose after `ackSeq` equals a fresh simulation from the corrected pose, errors of 0.2, 0.5, 1.0 and 3.0 m use gains 0, 0.05, 0.12 and 0.4, a vehicle enter snaps, and with no `WebSocket` in the worker the relay transport carries byte-identical frames — proof: `pnpm check:unit -- packages/engine/src/net`
- AC-6 Given single-player with `net: null` When the engine determinism scenarios run Then every golden hash is unchanged — proof: `pnpm --filter @dv/engine test:determinism`
- AC-7 Given two isolated pages (separate contexts) on the local web and rooms servers, each registered as P1 through the QA bridge, When both join one room and page A walks 10 m Then `crossOriginIsolated` is true on both, B's `peers()` shows A at the new position, the time between the server tick that produced the move and B's render of it is at most 150 ms, and `test-results/mp-transport.json` records `hosts.rt` and the transport used — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @mp`
- AC-8 Given the branch When both Previews deploy and the rooms bundle is checked Then both succeed and no `/_test/` route exists in production bundles — proof: `pnpm deploy:preview && pnpm deploy:preview -- --worker rooms && pnpm check:prod-routes`
- AC-9 Given staging with both Workers deployed When two desktop browsers (Chrome and Safari on the Mac) register, join one room and walk Then each sees the other move, both report `crossOriginIsolated === true`, and `docs/device-runs/M12b2/desktop/notes.json` records the `transport()` output of each (this records U-BE-1) — proof: manual: desktop browser, Apple Silicon Mac, open staging in Chrome and Safari, register both, join through the QA bridge on the staging Preview build, walk, copy `__dvBridge.net.transport()` into `notes.json`

## Test plan
- Workers runtime: `rooms-interest`, `rooms-speed`, `rooms-ack-lag` plus M12b1's suites (`pnpm check:workers -- rooms`).
- Unit: `packages/net/test/{validate, room-client}.test.ts`; `packages/engine/src/net/*.test.ts`; determinism goldens unchanged.
- E2E: `tests/e2e/mp-two-clients.spec.ts` (`@mp`, `chromium-webgl2`, two browser contexts, assertions on bridge state, not pixels).
- Staging: manual two-browser run (AC-9).

## Demo script
1. `pnpm dev` and the rooms Worker on 8789 (`playwright.config.ts` shows the command).
2. Open two browser profiles; register each (QA bridge); `__dvBridge.net.join()` in both.
3. Walk in one window; watch the other; drive a car away past 300 m and watch it disappear, then return.
4. `pnpm check:e2e -- --project=chromium-webgl2 --grep @mp`.

## Effort
1 Builder session; about 34 files; risk **high**. Prediction replay against the canonical character controller and two Workers under Playwright are the risks.

## Risks & fallbacks
- Cross-origin WebSocket from the isolated page to `hosts.rt` is UNVERIFIED (U-BE-1). If it is refused, use the domain fallback Q-BE-02: `hosts.rt` becomes the same-origin path `/rt` (staging: zone route once Q-15 names the domain; locally: a small Node proxy on port 8790 that forwards `/rt/*`, HTTP and WebSocket, to 8789 and everything else to 8788, with the e2e base URL on 8790). AC-7 keeps its command; record the switch as a Builder decision.
- WebSocket inside a dedicated worker on iOS is UNVERIFIED (U-ENG-4): the relay is chosen by feature detection, so no AC depends on it; the M14b3 iPhone pass records it.
- Prediction drift with the `local` physics profile: if replay mismatches exceed 2 m in the e2e, snap instead of blend and log the count in `__dvBridge.net.state()`; report it.

## Notes for the Builder
- Read first: `09-backend-contracts.md` §1.3–§1.8; `09-backend-contracts-1.1.md` §3; `01-engine.md` §2.13; `01-engine-contracts.md` C02 rules 6–7; `spec/05-api-and-realtime.md` §4.1–§4.3, §4.6; ADR-0004.
- Order: validate.ts and speed caps → interest → lag → `RoomClient` → engine NetIn/NetOut and prediction → sandbox wiring and bridge → e2e → staging run.
- Keep `packages/net/src/validate.ts` free of IO so the DO and client tests share it. Never send a profile id on the wire.
- Branch `m12b2-rooms-core-protocol-v2`.
