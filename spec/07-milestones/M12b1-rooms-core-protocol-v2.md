# M12b1 — rooms-core-protocol-v2

## Goal
The multiplayer server exists and can be deployed. When this session ends, `packages/net` holds the C11 1.0 wire protocol (`PROTOCOL_VERSION` 2): constants, enums, frame layouts, a bounds-checked pure codec and the client clock. The new `tha-bay-rooms` Worker (`services/rooms`) gates every request on CORS, geo, rate limit, the M12a1 JWT, flags and the mods rule before any Durable Object is touched. `DirectoryDO` assigns rooms and records seats. `RoomDO` accepts hibernatable sockets with 30-second tickets (routes 22–24), refuses a stale build with 4002, assigns `sid` and `slot`, and runs the 20 Hz tick that sends `welcome`, `EV Joined`/`Left` and a `SNAP` of every player. The Worker has its own Preview and deploy path. Interest, validation and the client come in M12b2; resume, presence logic and drain come in M12c1.

## Requirements
- R-ROLL-02: authoritative-shaped rooms on Cloudflare Durable Objects in their own Worker, speaking the frozen C11 protocol.

## Depends on
- M12a1 (ES256 JWT, JWKS at `ID_ISSUER`, staff scopes), M05c2 (R-ROLL-01: the story slice is deployed to staging and its ACs pass there), M04a2 (`ModeHost` and its `modsActive()` hook point for the room client).
- Contracts: C11 1.0 (`09-backend-contracts.md` §1, `PROTOCOL_VERSION` 2), C12 1.1 (routes 22–24, `AssignReq/AssignRes`, `ApiError`).

## Scope in
- `packages/net/src/protocol/v2.ts`: `PROTOCOL_VERSION`, `C11_VERSION`, `NET`, `Frame`, `Close`, every header, sample, entity, event and control-frame interface of §1.2–§1.6, verbatim.
- `packages/net/src/protocol/codec.ts`: encode and decode for `IN`, `SNAP`, `EV`, `ACK`, `BYE`, `ACT`, `CHAT`, little-endian; every read bounds-checked; decode returns a result or a typed error, never throws; client frames > 2,048 B and server frames > 16,384 B rejected.
- `packages/net/src/clock.ts` per §1.8 (90-snapshot window, `offset = min(gap)`, `jitter = p90`, delay clamp 45–300 ms, start 80 ms, 2 % decay, extrapolation ≤ 250 ms).
- `services/rooms/src/index.ts` `fetch()`: CORS for the app origin only (`GET, POST, OPTIONS`; `Authorization, Content-Type, Idempotency-Key, X-Client-Build`; `Vary: Origin`), geo (`GEO_ALLOW`; REST `region_blocked`, WS close 4006), `RL_ROOMS`, JWT through a 10-minute JWKS cache with refetch on unknown `kid`, tier ≥ `device`, `ab: '18p'`, flag `mp.enabled` and `ks:rooms:new` from KV `FLAGS`. `AssignReq.modsActive: true` → `forbidden` with `details.close: 4007` (C11 rule 8).
- Route 23 `POST /rooms/assign` → `DirectoryDO.assign` (first room under cap, else mint `room:<worldVer>:sf:<n>`, `locationHint` per F-022) → `AssignRes` with ticket `rt1.<b64url{rid,pid,exp}>.<HMAC ROOM_TICKET_HMAC>` (30 s); `seats(profile_id, room_id, exp)` written at assign (DL-187).
- Route 22 `GET /rooms/:roomId` → `RoomDO.check()` (reserves nothing). Route 24 WS upgrade: ticket MAC, expiry and room match (else 401 before the DO), `build == BUILD_ID` (else accept, then close 4002 without calling the DO), then `stub.fetch` with `x-profile-id`, `x-display-name`, `x-look`.
- `RoomDO`: atomic cap check (`CAP` 16; 4003), slots allocated from 1 upward so a slot maps directly to the C01 net key `player:<slot>` (local player 0 never goes on the wire), `acceptWebSocket(ws, ['p:' + sid])`, attachment `{sid, slot, profileId, name, joinedAt, lastSeq, strikes}`, `setWebSocketAutoResponse` for `ping`, `welcome` (C11 `WelcomeV2`, `authority: 'validated'`, `resume` token signed with `ROOM_RESUME_HMAC`, `resumed: false`), `EV Joined` and `Left`, `BYE` frees the slot at once, 50 ms `setInterval` only while sockets exist; per tick: drain inputs (drop non-monotonic `seq`, ignore client-supplied ids), store the claimed pose when finite, build one `SNAP` per recipient containing every player.
- Abuse: token bucket 40 burst + 30/s per socket (1008 `rate`), 5 malformed or oversize frames per 10 s (1008 `strikes`), any text frame other than `ping` is a strike.
- `PresenceDO` class skeleton only, so migration `rooms-v1` declares all three classes (`09-backend-ops.md` §1.2) and M12c1 needs no lifecycle change.
- Deploy: `services/rooms/wrangler.jsonc` per `09-backend-ops.md` §1.2 (DO bindings `ROOM`, `DIRECTORY`, `PRESENCE`; migration `rooms-v1`; `FLAGS`; `AE`; `RL_ROOMS`; logs 0.001, no invocation logs; vars `ID_ISSUER`, `GEO_ALLOW`, `BUILD_ID`, `CAP`; `workers_dev: true` until Q-15; `env.staging`; `previews` repeating every binding); `deploy:prod -- --worker rooms` (plain `wrangler deploy`); `deploy:preview -- --worker rooms`; `deploy:bootstrap -- --worker rooms`.
- CI: `check:workers` collects `services/rooms/test`; `typecheck` appends `services/rooms/tsconfig.json`; `check:prod-routes` also bundles the rooms Worker; `preview.yml` previews rooms when `services/rooms/**` or `packages/net/**` change; `deploy.yml` job `rooms` with the same path filter.

## Scope out
- Interest management, pose validation and corrections, `ACT` resolution, client `RoomClient`, prediction and the `@mp` e2e → M12b2.
- Resume, ghosts, checkpoints, AFK hibernation, drain, presence logic, invites, kick route, in-session 4007 hook → M12c1. Chat, progress commits, load bots → M12c2. Online page → M12d.

## Deliverables
- `packages/net/src/protocol/{v2.ts, codec.ts}`, `packages/net/src/clock.ts`, `packages/net/src/index.ts`; `packages/net/test/{codec.test.ts, codec.fuzz.test.ts, clock.test.ts}`.
- `services/rooms/{package.json (@dv/rooms), README.md, tsconfig.json, wrangler.jsonc}`; `services/rooms/src/{index.ts, gate.ts, jwks.ts, ticket.ts, cors.ts}`; `services/rooms/src/room/{RoomDO.ts, tick.ts, slots.ts, bucket.ts}`; `services/rooms/src/directory/DirectoryDO.ts`; `services/rooms/src/presence/PresenceDO.ts` (skeleton).
- `services/rooms/test/{rooms-build, rooms-forged-id, rooms-cap-atomic, rooms-gate, rooms-abuse, rooms-tick, rooms-directory}.test.ts`; the Workers vitest config gains the rooms project.
- `tools/ci/deploy.ts` (`--worker rooms` for `prod`, `preview`, `bootstrap`), `tools/ci/check-prod-routes.ts` (rooms bundle), root `package.json` (`typecheck` chain), `.github/workflows/{ci,preview,deploy}.yml`.
- Secrets (Worker, both environments): `ROOM_TICKET_HMAC`, `ROOM_RESUME_HMAC`, `INTERNAL_HMAC` (declared now, used from M12c2). Absent locally: the rooms Worker answers route 23 with `feature_disabled` and `deploy:*` print their SKIP lines.

## Interfaces
- C11 1.0 created verbatim in `packages/net/src/protocol/`; C12 1.1 routes 22–24 implemented as frozen. `PresenceFrame` is not created here (DL-186, M12c1).
- No contract change.

## Acceptance criteria
- AC-1 Given every C11 frame type with boundary values When encoded and decoded Then each round-trips to an equal object; 10,000 seeded random buffers of 0–20,000 bytes never throw and never allocate more than 16 KiB per decode; a 2,049-byte client frame is rejected — proof: `pnpm check:unit -- packages/net`
- AC-2 Given recorded snapshot arrivals with 10 ms and 120 ms jitter When the clock runs Then the delay never leaves 45–300 ms, starts at 80 ms, adopts a larger target at once and decays 2 % per snapshot toward a smaller one — proof: `pnpm check:unit -- packages/net`
- AC-3 Given a valid ticket and `build` ≠ `BUILD_ID` When the client upgrades Then it receives close 4002 and the RoomDO stub records zero calls — proof: `pnpm check:workers -- rooms-build`
- AC-4 Given two joined sockets When one sends an `IN` claiming another slot and then frames with a non-monotonic `seq` Then the peer's `SNAP` carries only server-assigned slots, the stale frames are not applied, and no frame byte sequence contains either profile id — proof: `pnpm check:workers -- rooms-forged-id`
- AC-5 Given a room with `CAP` 16 When 17 sockets upgrade concurrently Then exactly 16 receive `welcome` and one is closed with 4003 — proof: `pnpm check:workers -- rooms-cap-atomic`
- AC-6 Given route 23 and route 24 When called with no JWT, a play token, `ab` not `18p`, `cf.country = 'FR'`, flag `mp.enabled` off, `modsActive: true`, an expired ticket and a ticket for another room Then the answers are `unauthorized`, `tier_required`, `age_blocked`, `region_blocked` (and close 4006 on the socket path), `feature_disabled`, `forbidden` with `details.close` 4007, and 401 before the DO for both tickets — proof: `pnpm check:workers -- rooms-gate`
- AC-7 Given a joined socket When it sends 5 malformed frames within 10 s, or 80 valid frames in one second Then it is closed 1008 with reason `strikes`, respectively `rate`; a text `ping` is answered by auto-response without invoking `webSocketMessage` — proof: `pnpm check:workers -- rooms-abuse`
- AC-8 Given two sockets in one room When 40 ticks run Then both received `welcome` with distinct slots, `authority: 'validated'` and a resume token, `SNAP.tick` increases by 1 per tick with both players present, a claimed finite pose appears in the peer's next `SNAP`, and `BYE` yields `EV Left {reason:'quit'}` and frees the slot — proof: `pnpm check:workers -- rooms-tick`
- AC-9 Given the directory When 17 profiles assign Then the first 16 get one room and the 17th a new one, each has a `seats` row, and route 22 returns `{players, capacity, build}` without changing occupancy — proof: `pnpm check:workers -- rooms-directory`
- AC-10 Given the deploy tool When the rooms plan is printed Then it is a plain `wrangler deploy` of `tha-bay-rooms-staging` with no version split, and the production bundles contain no `/_test/` route — proof: `pnpm deploy:prod -- --worker rooms --env staging --dry-run && pnpm check:prod-routes`
- AC-11 Given the branch When the web and rooms Previews deploy Then both succeed — proof: `pnpm deploy:preview && pnpm deploy:preview -- --worker rooms`
- AC-12 Given operator credentials and the secrets above When `pnpm deploy:bootstrap -- --worker rooms` runs for staging and the logic PR deploys Then `GET /api/v1/rooms/<id>` on the staging rooms host with a staging P1 JWT returns JSON with `build` equal to the deployed `BUILD_ID` — proof: manual: operator workstation, run the bootstrap, merge, then `curl` route 22 with a token minted through route 8 on staging

## Test plan
- Unit: `packages/net/test/codec.test.ts`, `codec.fuzz.test.ts`, `clock.test.ts` (`pnpm check:unit -- packages/net`).
- Workers runtime: seven `services/rooms/test` suites (`pnpm check:workers -- rooms`); sockets driven by the pool's WebSocket pairs; time by fake timers.
- Deployed: route 22 on staging (AC-12). Two-client e2e waits for M12b2.

## Demo script
1. `pnpm check:unit -- packages/net`: codec and clock pass.
2. `pnpm --filter @dv/rooms exec wrangler dev --port 8789` beside `pnpm dev`.
3. Register a P1 identity in the app (QA bridge), copy its JWT, `POST /api/v1/rooms/assign` with `curl`.
4. Open a WebSocket in the console with the ticket and watch `welcome` and 20 Hz `SNAP` frames decode through the bridge.

## Effort
1 Builder session; about 37 files; risk **high**. DO socket semantics under the Workers test pool and the two-PR lifecycle rule are the risks.

## Risks & fallbacks
- DO class rule (`check:do-migrations`): ship this milestone as two PRs. PR 1 (label `do-lifecycle`) holds only `services/rooms/wrangler.jsonc` migration `rooms-v1`, the three empty class exports and `package.json`, deployed with `wrangler deploy` through `deploy:bootstrap`; PR 2 holds everything else. Record the rollback floor.
- Cross-origin WebSocket from the isolated page (U-BE-1) is not exercised here; M12b2 records it and names the fallback.
- Rapier inside a DO is UNVERIFIED (U-ENG-3) and not used: v1 rooms validate kinematically (ADR-0004).
- File budget: if over 40, move `rooms-directory` into `rooms-tick` and keep the clock in M12b2.

## Notes for the Builder
- Precondition (R-ROLL-01, `_PLAN.md` §0 rule 4): before creating the branch, run `pnpm check:rollout -- --branch m12b1-rooms-core-protocol-v2` (M00d). It passes only when README shows M05c2 DONE and `docs/staging-runs/M05c2/report.json` records every M05c2 AC as passing on staging. CI runs the same check on this branch. If it fails, stop and report. The anchor is VS-Story (Act 1), not Acts 2–3 (`spec/01-product.md` §11; Q-37).
- Read first: `09-backend-contracts.md` §1; `09-backend.md` §3.1, §5.1–§5.2; `09-backend-ops.md` §1.1–§1.2, §2, §3; `spec/05-api-and-realtime.md` §1.1, §4.1–§4.3; ADR-0004; DL-186–DL-188.
- `services/*` import only `@dv/shared` and `@dv/net`; the rooms Worker never binds to the web Worker.
- Never `setAlarm` per tick; clear the interval when the last socket leaves. Strip query strings (tickets) from every log line.
- Branch `m12b1-rooms-core-protocol-v2`.
