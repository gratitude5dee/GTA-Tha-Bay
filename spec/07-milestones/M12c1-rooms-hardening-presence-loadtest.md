# M12c1 — rooms-hardening-presence-loadtest

## Goal
Rooms survive real networks and deploys. When this session ends, a dropped socket leaves a ghost that holds its slot for 60 s. A resume within 15 s replays missed events; a later resume rebuilds; an expired one joins fresh. Resume works across a Durable Object restart because rooms checkpoint to DO SQLite. Idle rooms stop ticking and hibernate, and empty rooms are collected. Operators drain rooms before a rooms deploy (route 48, `pnpm rooms:drain`, weekday drain window). Menu sockets on `PresenceDO` carry own status and server notices (routes 54 and 26). Six-character invite codes route a friend into the same room (route 25). `ACT` requests (vehicle entry and exit, interact, pickup, activity join and leave) are resolved by the server in tick order. Staff can remove a player (route 55), and a client that turns on a mod mid-session leaves with the 4007 message. Chat, progress and the load gate are M12c2.

## Requirements
- R-ROLL-02: the realtime layer gains resume, presence, invites, server-owned interactions and safe deploys.

## Depends on
- M12b2 (interest, validation, `RoomClient`, engine net phases, `@mp` e2e).
- Contracts: C11 1.0 (`09-backend-contracts.md` §1.5–§1.7: `EV Resume`, `ActResult`, `VehicleSpawn`, `VehicleOwner`, `Notice`, close 4004/4005/4007/4008), C12 1.2 (routes 25, 26, 48; routes 54 and 55 with `PresenceTicketRes`, `KickReq`, `KickRes` of `09-backend-contracts-1.2.md` §2, DL-223; this milestone sets `C12_VERSION = '1.2.0'`).

## Scope in
- Ghosts and resume (`spec/05-api-and-realtime.md` §4.4, DL-188): on close without `BYE` the slot becomes a ghost for `RESUME_TTL_MS` (counts toward cap); `EV Resume` refreshes the token every 30 s; the client reconnects with jitter (250 ms → 4 s), refreshes its JWT when it expires within 60 s, calls route 23 (the directory returns the seat's room and a fresh ticket) and opens `…/ws?v=2&build=B&ticket=T&resume=<rs1>`; ≤ 15 s → `welcome {resumed:true}` plus events after the last acknowledged `evSeq` (≤ 256 kept 15 s); 15–60 s → `welcome {resumed:true}` without replay; token expired or slot reaped → close 4005, fresh join.
- Checkpoint row `{tick, slots[], activities[], vehicles[], world}` every 100 ticks and on empty (< 1 MB); restored on DO start so a resume survives a restart.
- AFK and lifecycle (`09-backend.md` §5.1): no `IN` for 60 s → checkpoint, `clearInterval`, hibernate; next `IN` restarts the tick; empty → alarm +10 min → `deleteAll()` and `DirectoryDO` forgets the room. Never `setAlarm` per tick.
- Drain: route 48 (`S:ops`, scope re-checked against `staff_roles`) → `DirectoryDO.broadcastDrain(now + 30 s)` → each `RoomDO.drain` sends `notice {kind:'drain', at}` and `EV Notice`; presence sockets get the notice too. `pnpm rooms:drain -- --env <env>` mints the CI staff JWT through route 8 (`CI_STAFF_DEVICE_JWK`, DL-192), posts, waits 30 s. `deploy:prod -- --worker rooms` runs the drain first and, for production, refuses outside 10:00–12:00 UTC on weekdays.
- Presence (DL-186): route 54 `POST /presence/ticket` (J1) → `{ticket, exp, wsUrl}` with `rid: 'presence'`; route 26 hibernatable socket on `PresenceDO` shard `hash(pid) % 64`; `PresenceFrame` (`status` c→s; `invite`, `notice` s→c) in `packages/net/src/protocol/presence.ts`, outside C11; `ping` auto-response; v1 shows own status and notices only (Q-29).
- Invites: route 25 → `{code, exp}` (6 characters base32, 10 min) stored in `DirectoryDO.invites`; `AssignReq.inviteCode` puts the player in that room; an expired code is `not_found`, a full invite room `conflict`.
- `ACT` (C11 §1.7 rule 4): resolved in arrival order per tick, first wins; `EV ActResult {actSeq, ok, reason?}` with `occupied`, `too_far`, `cooldown`, `invalid`; a touched vehicle becomes a server entity (`EV VehicleSpawn`, `EV VehicleOwner`) and its occupants are always in each other's interest set.
- Kick (DL-187): route 55 `POST /_ops/rooms/kick` (`S:mod:review` or `S:ops`) → seat lookup → `RoomDO.kick(sid, 'staff_action')` → `{t:'kick'}`, close 4004, no ghost, seat cleared, `EV Left {reason:'kicked'}`; an `enforcement_action` ban makes later assigns `forbidden`.
- Mods 4007 hook: the client watches the mod-activation signal (C14 `modsActive()` once M13a3 provides it, else a no-op source); turning a mod on while online sends `BYE`, leaves, and shows the 4007 message key; route 23 already refuses `modsActive: true`.
- Engine: ghost and resume handling on the client (`01-engine.md` §8 M12c row): proxies of a resumed slot keep their `player:<slot>` key; a fresh join re-keys.

## Scope out
- Moderated chat, route 20 and migration 0006, load bots and `rooms.capMax` → M12c2. Online page, invite UI, nameplates → M12d. Friend presence → deferred (Q-29). Delta snapshots → only if M12c2 measures > 10 KB/s per player.

## Deliverables
- `services/rooms/src/room/{resume.ts, checkpoint.ts, lifecycle.ts, act.ts, drain.ts}` and edits to `RoomDO.ts`, `tick.ts`, `kick.ts`.
- `services/rooms/src/directory/{seats.ts, invites.ts}`; `services/rooms/src/presence/PresenceDO.ts` (logic); `services/rooms/src/ops/{drain-route.ts, kick-route.ts, staff.ts}`.
- `packages/net/src/protocol/presence.ts`; `packages/net/src/client/{resume.ts, presence-client.ts}`; `packages/engine/src/net/{mods-guard.ts, mods-guard.test.ts, resume-keys.test.ts}`.
- `tools/ops/rooms-drain.ts`, root script **`rooms:drain`**; `tools/ci/deploy.ts` (drain step, window check with an injectable clock); `.github/workflows/deploy.yml` (rooms job runs `pnpm rooms:drain -- --env <env>` first).
- `services/rooms/test/{rooms-resume, rooms-afk-hibernate, rooms-drain, rooms-presence, rooms-invites, rooms-act, rooms-kick}.test.ts`; `packages/net/test/{resume, presence-client}.test.ts`; `tools/ci/test/deploy-window.test.ts`.
- `tests/e2e/mp-resume.spec.ts` (`@mp-resume`).
- Rooms Worker secret `SUPABASE_SECRET_KEY` (staff-role checks and ban lookups); CI secret `CI_STAFF_DEVICE_JWK` (from M12a1). Absent: `rooms:drain` prints `SKIP rooms:drain: CI_STAFF_DEVICE_JWK not set` and exits 0; staff routes answer `unauthorized`.

## Interfaces
- C11 1.0 consumed as frozen; C12 1.2 types for routes 54 and 55 (`09-backend-contracts-1.2.md`), semantics per `spec/05-api-and-realtime.md` §3 and DL-186/DL-187. `PresenceFrame` lives outside C11 per DL-186.
- No contract change.

## Acceptance criteria
- AC-1 Given a room with 16 players When one socket drops without `BYE` Then its ghost holds the slot so a new 17th join is closed 4003; a resume after 5 s gets `welcome {resumed:true}` with the same slot and the missed events after its last `evSeq` in order; a resume after 30 s gets `resumed:true` without replay; a resume after 61 s is closed 4005; after a harness reset of the DO a resume returns the same slot within 5 s — proof: `pnpm check:workers -- rooms-resume`
- AC-2 Given an active room When no `IN` arrives for 60 s Then a checkpoint row exists, no interval or alarm per tick is registered, and the next `IN` restarts ticking from the checkpoint tick; when the last socket and ghost are gone Then an alarm 10 min later deletes the room storage and the directory no longer lists it — proof: `pnpm check:workers -- rooms-afk-hibernate`
- AC-3 Given three live rooms and two presence sockets When an `ops` staff token calls route 48 Then it returns `{notified: 3}`, every room socket receives `notice {kind:'drain'}` with `at` 30 s ahead plus `EV Notice`, both presence sockets receive the notice, and a token without the scope gets `forbidden` — proof: `pnpm check:workers -- rooms-drain`
- AC-4 Given the deploy tool with an injected clock When a production rooms deploy is planned at Tuesday 10:30 UTC and at Sunday 15:00 UTC Then the first plan starts with the drain step and the second exits non-zero naming the window; without `CI_STAFF_DEVICE_JWK` the drain script prints its SKIP line and exits 0 — proof: `pnpm check:unit -- tools/ci` and `env -u CI_STAFF_DEVICE_JWK pnpm rooms:drain -- --env staging`
- AC-5 Given a P1 token When it calls route 54 and opens route 26 with the ticket Then the socket is accepted, a `status` frame updates the stored status, a forged or expired ticket is refused with 401 before the DO, and `ping` is answered by auto-response — proof: `pnpm check:workers -- rooms-presence`
- AC-6 Given two rooms with free seats When player A creates an invite and player B assigns with its code Then B lands in A's room; the code is 6 base32 characters valid 10 minutes; an expired code returns `not_found`; a full invite room returns `conflict` — proof: `pnpm check:workers -- rooms-invites`
- AC-7 Given two players next to one vehicle When both send `EnterVehicle` in the same tick Then the first in arrival order gets `ActResult {ok:true}` and `EV VehicleOwner`, the second `{ok:false, reason:'occupied'}`; a request from 40 m gets `too_far`; `ExitVehicle` clears the owner — proof: `pnpm check:workers -- rooms-act`
- AC-8 Given a seated player When a `mod:review` staff token calls route 55 with `code: 'staff_action'` Then the player receives `{t:'kick', code:'staff_action'}` and close 4004, no ghost remains, the seat is cleared, peers get `EV Left {reason:'kicked'}`, and after an `enforcement_action` ban route 23 returns `forbidden` — proof: `pnpm check:workers -- rooms-kick`
- AC-9 Given `RoomClient` and the engine guard When the socket closes 1006 with the JWT 40 s from expiry, and later a mod is activated while online Then the client refreshes the JWT before route 23, reconnects with `resume=`, keeps its slot and proxies' keys, and on mod activation sends `BYE` and surfaces the 4007 message key — proof: `pnpm check:unit -- packages/net packages/engine/src/net`
- AC-10 Given two isolated pages in one room When page A goes offline for 3 s and comes back Then A has the same slot, B's peer list never drops A, and A's state shows `resumed: true` — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @mp-resume`
- AC-11 Given the branch When both Previews deploy Then both succeed — proof: `pnpm deploy:preview && pnpm deploy:preview -- --worker rooms`
- AC-12 Given staging with a room open in a desktop browser When the operator runs `pnpm rooms:drain -- --env staging` and then deploys the rooms Worker Then the browser shows the drain notice, its socket drops at the restart, and it resumes into the same slot within the 60 s resume window — proof: manual: desktop browser, open staging and join through the QA bridge, then from the operator workstation run the drain and `pnpm deploy:prod -- --worker rooms --env staging`, and read `__dvBridge.net.state()` before and after

## Test plan
- Workers runtime: seven new rooms suites plus M12b1–M12b2 suites (`pnpm check:workers -- rooms`); fake timers for 15 s, 60 s, 10 min.
- Unit: `packages/net/test/{resume, presence-client}.test.ts`, engine mods guard, `tools/ci/test/deploy-window.test.ts`.
- E2E: `@mp-resume` (Playwright `context.setOffline`).
- Staging: drain and resume across a real rooms deploy (AC-12).

## Demo script
1. Run the web and rooms Workers locally; join one room from two browser profiles.
2. Turn the network off in one profile for 3 s; it resumes into the same slot.
3. Create an invite in profile A; join with the code in profile B.
4. Walk both to one car; press enter in both; one gets in, the other sees "occupied".
5. Call route 48 with a local staff token; both windows show the drain notice.

## Effort
1 Builder session; about 37 files; risk **medium**. Resume across a DO restart and hibernation behaviour under the test pool are the uncertain parts.

## Risks & fallbacks
- DO memory limit (U-BE-5) and send backpressure (U-BE-4) are not asserted here; the checkpoint stays under 1 MB by construction and M12c2's load test measures the rest.
- DO restarts scoped to the deployed script (U-BE-21): rooms are a separate Worker anyway; AC-12 records what happened in `docs/device-runs/M12c1/desktop/notes.json`.
- If the test pool cannot simulate a DO restart, reset by constructing a new instance over the same storage and record the method in the PR.

## Notes for the Builder
- Read first: `09-backend-contracts.md` §1.5–§1.7; `09-backend.md` §3.1, §5.1, §5.3; `09-backend-db.md` §6; `spec/05-api-and-realtime.md` §4.4–§4.7; DL-184, DL-186–DL-188, DL-192.
- Routes 48, 55 are exempt from the geo-gate (DL-184); staff scopes are re-checked against `staff_roles` on every call; staff writes append `audit_log`.
- Order: checkpoint → ghosts and resume → AFK and GC → ACT → drain and deploy window → presence → invites → kick → client resume and mods guard → e2e.
- Branch `m12c1-rooms-hardening-presence-loadtest`.
