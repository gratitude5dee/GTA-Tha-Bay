# M12e — mode-leaderboards

## Goal
Leaderboards stop answering `feature_disabled`. Route 21's validator registry, delivered empty by the M12c family (DL-183), gets its two v1 validators. **`racing.`** runs S06 plausibility checks; its rows stay `verified: false`. **`tycoon.`** re-simulates the run with S08's `verifyRun`; a daily seeded challenge board `tycoon.daily.<yyyymmdd>` comes with it. Inside a room, the `RoomDO` gains the racing activity referee: players join with `ACT JoinActivity`, the server runs `refereeStep` on claimed poses, decides the finishing order and broadcasts `EV Activity` with `RaceActivityData`. The client can submit, and read the top rows, for both modes. This completes the **Multiplayer** checkpoint of `_PLAN.md` §3 together with M12c2.

## Requirements
- R-MODE-02: async ghosts and leaderboards for races on real SF routes; online races where finishing order is decided on the server.
- R-MODE-04: a daily seeded founder challenge with server re-simulation, so the tycoon board is exact.
- R-ROLL-02: leaderboards and room activities run on Durable Objects plus Postgres (`leaderboard_scores`, migration 0006).

## Depends on
- **M12c2**: migration 0006 (`leaderboard_scores`), route 20, load bots. Per DL-183, M12c2 also ships route 21's transport and the empty registry (GET works; POST to an unregistered prefix → `feature_disabled`).
- **M07b1**: race catalog, compiled `RaceDef`s, `refereeStep`, replay codec and ghosts from M07a1–M07a2.
- **M09a2**: tycoon sim, `setupFromSeed`, `replay`, `verifyRun`, golden runs and balance bands.
- R-ROLL-01: this milestone runs after M05c2 is shipped and tested on staging.
- Contracts: C12 1.2 (route 21: board pattern `^(racing|fighter|tycoon)\.[a-z0-9.-]{1,96}$`, body ≤ 16 KiB, validator registry by prefix; `LeaderboardSubmit` = `ScoreSubmit` | `TycoonDailySubmit` (`09-backend-contracts-1.2.md` §2, DL-223); `ScoreRow` as S06's type in `06-racing-data.md` §4.3; `DataPort.leaderboards`; `ProgressDelta` kind `race`), C11 1.0 (`ActKind.JoinActivity`/`LeaveActivity`, `EvKind.Activity` data ≤ 768 B, `validated` authority, speed caps), C16 1.1 (`racing.verify_fail`, server-only). Mode-owned shapes: `RaceActivityData` (`06-racing-data.md` §4.7), `RunSetup`, `ChoiceRecord`, `RunResult` (`08-tycoon.md` §3.3, §4.3–§4.5).

## Scope in
- **Validator registry** (`services/edge/src/leaderboards/registry.ts`):
  - `register(prefix, validator)`, where `validator(board, body: unknown, env) → {ok: true, value, verified, verifier, replay: Uint8Array} | {ok: false, reason}`.
  - `racing.` and `tycoon.` are registered; `fighter.` stays unregistered (`feature_disabled`).
  - Accepted rows go through `DataPort.leaderboards.submit`. The replay bytes are stored in the private R2 bucket under `lb/<board>/<sha256>.bin`.
  - The 30 s `lb:<board>` cache (isolate memory since DL-746; no KV write on a timer on Workers Free) is dropped on accept in the accepting isolate; other isolates refresh within 30 s.
- **Racing plausibility** (`packages/shared/src/racing/verify/plausible.ts`, pure, for boards `racing.<raceId>.time|score`):
  - the board's `raceId` equals `body.raceId`, and `raceVersion` and `worldBake` equal the bundled race index;
  - `replaySha256` equals SHA-256 of the decoded `replayB64`, and the decoded sizes are within `REPLAY_LIMITS`;
  - the decoded header's `raceId`, `finishTick` and `gateTicks` equal the body's;
  - `gateTicks` strictly increase and their count equals the race's gate count;
  - finish time ≥ route length ÷ (class top speed × (1 + `maxOverTopPct`));
  - `vehicleDef` is allowed by the race's class gate.
  - Rows are written with `verified: false` and `verifier: 'racing.plausible/1'` (DN-S06-03). Each rejection emits `racing.verify_fail` with an enum reason.
- **Tycoon daily** (`packages/shared/src/tycoon/verify/daily.ts`, pure):
  - `dailySeed(yyyymmdd) = fnv32('tycoon.daily.' + yyyymmdd)`;
  - `dailySetup(yyyymmdd, content)` = `setupFromSeed(dailySeed, {preset: 'daily'})` with the build's `contentVersion` and `balanceVersion`;
  - `encodeDailyRun` and `decodeDailyRun` turn `{setup, choices, claimed}` into canonical JSON bytes.
  - The validator accepts a board date only if it is today or yesterday in UTC (server clock), requires `setup` to equal `dailySetup`, and calls `verifyRun`. Result `ok` → a row with `value = claimed.score`, `verified: true`, `verifier: 'tycoon.verifyRun/1'`; `mismatch` or `contentVersion` → rejected with that reason.
- **Body for `tycoon.` boards:** C12 1.2 `TycoonDailySubmit` (`09-backend-contracts-1.2.md` §2, DL-223): `board`, `value` (= claimed score), `buildId`, `runB64` (the encoded daily run) and `runSha256`. The registry rejects a body whose variant does not match its prefix with `bad_request`. Copy `TycoonDailySubmit` and `LeaderboardSubmit` verbatim if M12c2 did not.
- **Client:**
  - `packages/modes/tycoon/src/daily.ts` adds a "Daily challenge" entry (flag `tycoon.daily`) that starts `dailySetup(todayUtc)`, submits on run end and shows the top 20 through the kit list.
  - Racing's existing submit path (M07a2) now receives `accepted`/`rejected` and shows the board's top 20 on the results screen.
- **Room racing activity** (`services/rooms/src/activities/racing.ts`, flag `racing.mpRaces`):
  - Races of kind `sprint` and `circuit` only; pursuit events keep local records. 2–8 racers in a room.
  - `ACT JoinActivity` → state `grid`; countdown → `run` at server tick `t0`. Per player, `refereeStep` runs on claimed poses at 20 Hz with the class speed caps (25 % tolerance already in `validated`).
  - Finishing order is decided by the server; `EV Activity` carries `RaceActivityData` (≤ 768 B, asserted). Leave or disconnect → `dnf: 1`.
  - No AI racers, police or car-car collision. Rewards: see Risks.
- `wrangler.jsonc` of `tha-bay-web` and `tha-bay-rooms`: bundle the compiled race index used by both validators. Flags `racing.mpRaces` and `tycoon.daily` go to true on staging, false in production (flipped in M14b3).

## Scope out
- Exact racing re-simulation on a verifier job: post-v1 (DN-S06-03, Q-S06-04).
- Fighter boards and online fights: ADR-0028 (DL-204), not v1.
- Leaderboard UI pages beyond the in-mode top-20 lists: M14c (audit). Weekly or seasonal boards: not v1.

## Deliverables
- `services/edge/src/leaderboards/{registry.ts, racing.ts, tycoon.ts, store.ts}`; the route 21 handler registers both. `services/edge/test/{leaderboards.test.ts, leaderboards-racing.test.ts, leaderboards-tycoon.test.ts}` and their fixtures.
- `packages/shared/src/racing/verify/{plausible.ts, index.ts}`; `packages/shared/src/tycoon/verify/{daily.ts, index.ts}`; tests `packages/shared/src/{racing,tycoon}/verify/test/*.spec.ts`; golden `packages/shared/src/tycoon/verify/test/golden/daily-seed.v1.json`.
- `services/rooms/src/activities/{racing.ts, index.ts}` (or an entry in M12c1's activity dispatch if one exists); `services/rooms/test/rooms-race.test.ts`.
- `packages/modes/tycoon/src/daily.ts`; `packages/modes/racing/src/leaderboard-view.ts` (results-screen list); i18n keys `lb.*`.
- `packages/shared/schemas/telemetry/racing.verify_fail.schema.json` (if M07a1 did not add it).
- No new secrets or scripts. Uses the private R2 bucket binding and KV namespace already bound to the web Worker.

## Interfaces
- C12 1.1 route 21 and `DataPort.leaderboards` are used unchanged. C11 1.0 `ACT`, `EV Activity` and close codes are unchanged. `RaceActivityData` is S06's mode-owned payload.
- C12 1.2 (DL-223) already holds the per-prefix route 21 body and the `race` kind of route 20's `ProgressDelta`; no proposal remains.
- No contract change.

## Acceptance criteria
- AC-1 Given the registry When `POST /api/v1/leaderboards/fighter.arcade/submit` and a 17 KiB body to a `racing.` board are sent Then the responses are `feature_disabled` and 413 as `ApiError`; `GET` on a `racing.` board answers 200 with rows — proof: `pnpm check:workers -- leaderboards`
- AC-2 Given a valid racing fixture (replay from the M07a2 golden race) When it is submitted Then it is `accepted`, the row has `verified: false` and `verifier: 'racing.plausible/1'`, and the replay object exists in R2 under its SHA-256 — proof: `pnpm check:workers -- leaderboards-racing`
- AC-3 Given forged racing fixtures (non-monotonic `gateTicks`, one gate missing, finish faster than route length ÷ boosted top speed, `replaySha256` not matching, board `raceId` ≠ body `raceId`, stale `worldBake`) When each is submitted Then each is `rejected`, no row is written, and one `racing.verify_fail` point with the matching enum reason is emitted — proof: `pnpm check:workers -- leaderboards-racing`
- AC-4 Given a daily tycoon run recorded by the M09a2 harness for `dailySetup(20261018)` When it is submitted to `tycoon.daily.20261018` with the server clock on 2026-10-18 Then it is `accepted` with `verified: true` and `value` equal to the replayed `RunResult.score` — proof: `pnpm check:workers -- leaderboards-tycoon`
- AC-5 Given the same run with `claimed.score + 1`, with one choice removed, with a board date two days old, and with a stale `contentVersion` When each is submitted Then they are rejected as `mismatch`, `mismatch`, `bad_date` and `contentVersion` respectively — proof: `pnpm check:workers -- leaderboards-tycoon`
- AC-6 Given the pure verify modules When their unit tests run Then `dailySeed` matches the committed golden vectors for ten dates, `encodeDailyRun`/`decodeDailyRun` round-trips byte-identically, the plausibility function is deterministic over the fixture set, and the determinism lint passes on both folders — proof: `pnpm check:unit -- packages/shared/src/racing/verify packages/shared/src/tycoon/verify && pnpm lint`
- AC-7 Given a room with three fake clients joined to a sprint activity When their claimed poses cross the gates in the order B, A, C and client C skips one gate Then the server's `RaceActivityData` lists B first and A second, gives C no finish time, never exceeds 768 bytes, and a client leaving mid-race is marked `dnf` — proof: `pnpm check:workers -- rooms-race`
- AC-8 Given a fake client whose claimed speed exceeds its class cap plus tolerance during the activity When the tick runs Then it receives `EvKind.Correction` with reason `speed`, and the referee does not count gates crossed during the over-speed samples — proof: `pnpm check:workers -- rooms-race`
- AC-9 Given the tycoon mode with `tycoon.daily` true and a stubbed route 21 When a daily run ends Then the client submits exactly one envelope whose racing-only fields are empty and whose `replaySha256` matches its payload, then shows the returned rows — proof: `pnpm check:unit -- packages/modes/tycoon`
- AC-10 Given the production configuration When the app is built and checked Then flags `racing.mpRaces` and `tycoon.daily` are false in production `FLAGS_JSON`, no `/_test/` route ships and no secret pattern is present — proof: `pnpm build && pnpm check:prod-routes && pnpm check:secrets -- apps/web/dist`
- AC-11 Given staging with both flags on and two desktop browsers in one room When both join a sprint activity and finish Then both see the same finishing order, the results screen shows the plausibility-checked time in the board's top 20, and a daily tycoon run submitted from a third tab appears as verified — proof: manual: desktop browser (two Chrome windows and Safari on the Mac), staging URL, steps as written in this AC; screenshots attached to the PR

## Test plan
- **Unit:** the shared verify modules (vectors, round trips, determinism); tycoon daily client. Commands: `pnpm check:unit -- packages/shared/src/racing/verify packages/shared/src/tycoon/verify`, `pnpm check:unit -- packages/modes/tycoon`.
- **Workers runtime:**
  - `leaderboards` (registry, limits, GET cache);
  - `leaderboards-racing`, `leaderboards-tycoon` (accept and reject matrices, R2 and KV stubs from Miniflare, `InMemoryDataPort`);
  - `rooms-race` (RoomDO with fake sockets, as the M12b suites do).
- **Bots:** `pnpm check:balance` keeps passing; the daily preset uses the same bands.
- **Manual:** AC-11 on staging.

## Demo script
1. `pnpm check:workers -- leaderboards`; read the accept and reject lines.
2. `pnpm dev`; play the VS sprint; on the results screen see "Submitted (unverified)" and the top-20 list from local wrangler.
3. Tycoon → Daily challenge; play with the fast-forward debug panel; submit; the row shows verified.
4. On staging, two browsers join a sprint in one room and finish; compare the finishing orders.

## Effort
1 session; ≈ 30 hand-written files. Risk medium: route 21 transport assumptions (DL-183), Worker CPU for tycoon replays, and RoomDO activity plumbing from M12c1.

## Risks & fallbacks
- If M12c2 shipped no route 21 transport (its file and `_PLAN-3.md` row include it since DL-219/DL-183): add the GET and submit handlers here, exactly per `spec/05-api-and-realtime.md` route 21 (the 30 s `lb:<board>` cache in isolate memory, DL-746; `feature_disabled` for unregistered prefixes), and log a Builder decision.
- Tycoon `verifyRun` exceeds the Worker CPU limit for long runs: cap the daily preset at the weeks M09a2's balance file allows, and reject bodies with more `ChoiceRecord`s than the 16 KiB envelope holds. If a real run still times out in `wrangler dev`, move the check to a `JOBS` queue consumer (row pending → verified) and report the change.
- Race rewards go through route 20 with `ProgressDelta.kind = 'race'` (C12 1.2). If the purse table is not ready, record the result in `EV Activity` only and commit no reward; multiplayer purses are not needed for the Multiplayer checkpoint.
- The compiled race index is too large for the rooms bundle: bundle only sprint and circuit races, which is what the activity needs.

## Notes for the Builder
- Read first: `spec/11-decision-log-2.md` DL-183; `09-backend-contracts-1.1.md` §1 (route 21 amendment), §4; `06-racing-data.md` §4.3, §4.7; `06-racing.md` §2.14; `08-tycoon.md` §3.3 (`verifyRun`), §4.3–§4.6 (`RunSetup`, `ChoiceRecord`, `RunResult`, replay and versioning) and the M12e row of §8; `09-backend-db.md` §3.6 (0006); `spec/05-api-and-realtime.md` route 21.
- `services/*` import only `@dv/shared` and `@dv/net`. Validators are pure `@dv/shared` code; IO stays in the edge handler.
- The tycoon replay must never call a model: dialogue outcomes are recorded inputs (`08-tycoon-finance.md`).
- Order: shared verify modules and vectors → registry and racing validator → tycoon validator → rooms activity → clients → flags.
- Branch `m12e-mode-leaderboards`.
