# M12c2 — rooms-hardening-presence-loadtest

## Goal
Multiplayer gets its own server-side economy and passes its load gate. When this session ends: migration `0006_online.sql` holds `progress_wallet`, `progress_commits` and `leaderboard_scores`. Rooms commit progress to the web Worker through route 20 with an HMAC, an idempotency key and retries. Route 21 serves boards with an empty validator registry, ready for M12e (DL-183). Opt-in text chat is moderated before fan-out and fails closed. `RoomDO` raises its cap to 32 only behind `rooms.capMax`. The project's own WebSocket bots (`tests/load/rooms.ts`, `pnpm load:rooms`) drive 16 players for 30 minutes from two locations against staging. The gate is tick p99 ≤ 10 ms with zero overload errors, and the run records the network unknowns that only a load test can answer.

## Requirements
- R-ROLL-02: persistence of online progression on Supabase, written only by the server.
- R-ENG-02: the room tick budget (p99 ≤ 10 ms at 16 players) becomes an automated gate.

## Depends on
- M12c1 (resume, checkpoints, drain, presence, invites, `ACT`, kick, staff checks in the rooms Worker).
- Contracts: C11 1.0 (`CHAT`, `EV Chat`, `EV Feed`, `NET.CAP_MAX`, `CHAT_MAX_CHARS`), C12 1.1 (routes 20 and 21, `DataPort.progress`, `DataPort.leaderboards`, `09-backend-db.md` §3.6).

## Scope in
- Migration `0006_online.sql` exactly as `09-backend-db.md` §3.6; all three tables server-only (RLS on, no policies); pgTAP `supabase/tests/online.sql`.
- Route 20 `POST /api/v1/progress/commit` on the web Worker: header `Authorization: HMAC <ts>.<b64url(HMAC-SHA256(INTERNAL_HMAC, ts + "." + body))>`, ±300 s, `Idempotency-Key` required; `DataPort.progress.commit` → `applied` (wallet updated in one transaction with the `progress_commits` row) or `duplicate`; a delta that would make `cash` negative is `conflict`; exempt from the geo-gate (DL-184).
- Rooms side `services/rooms/src/progress/commit.ts`: `commitProgress(slot, kind, delta)` posts route 20 over HTTPS (never a binding), retries from the DO `schedule` table with the same key (1 s, 5 s, 30 s, 5 min); used by mode activities from M12e and exercised here by tests.
- Route 21 transport (DL-183): `GET /api/v1/leaderboards/:board` from KV `lb:<board>` (30 s) falling back to `DataPort.leaderboards.top`; `POST …/submit` (J1, ⓘ, body ≤ 16 KiB) through a validator registry keyed by board prefix that is empty in this milestone, so every POST is `feature_disabled`; board ids must match `^(racing|fighter|tycoon)\.[a-z0-9.-]{1,96}$`.
- Chat (C11 `CHAT`, default off): the rooms Worker reads the sender's `profiles.flags.chatOptIn` at join and passes it to the DO; frames from a sender who has not opted in are dropped with `EV Feed {key:'chat.off'}`; text over 280 characters is a strike; accepted text passes `names:lint` aliases and OpenAI `omni-moderation-latest` text before fan-out; a pass sends `EV Chat` only to opted-in recipients in the sender's interest set; a flag, an upstream error or a missing key holds the line and sends the sender `EV Feed {key:'chat.held'}`.
- `rooms.capMax`: `RoomDO` uses `NET.CAP_MAX` (32) only when the KV flag `rooms.capMax` is on, else `CAP` (16). The ops runbook sets the flag (route 47) only after a passing 16-bot report is committed (`09-backend.md` §8 M12c AC-2).
- Metrics: `room.tick` to Analytics Engine every 200 ticks (p50, p99, sockets, bytes out per player); a non-production route `GET /api/v1/_test/rooms/:roomId/stats` on the rooms Worker returns the tick histogram and overload counters; a non-production route `POST /api/v1/_test/load-identities {count}` on the web Worker mints synthetic P1 JWTs for load profiles and requires an `ops` staff JWT.
- Load bots (`13-qa.md` §3.10): Node script on `@dv/net` (the real codec); each bot gets a JWT, assigns, opens the socket with its ticket, sends `IN` at 20 Hz along random legal walking paths inside `config/world.bounds.json`, `ACK` every 250 ms, `ping` every 20 s. Options `--bots <n> --minutes <m> [--shard i/n] [--target staging|local]`; `--target local` starts both Workers like the Playwright `webServer`. Output `tests/reports/load/rooms-<yyyymmdd>-<shard>.json` with tick p50/p99, overload errors (DO `overloaded`, 1013 closes, rate or strike closes, corrections), downstream bytes per player per second, and RTT; exit non-zero when tick p99 > 10 ms or any overload error occurs.

## Scope out
- Validators for racing and tycoon boards → M12e. Chat panel, opt-in toggle and report button → M12d. Delta snapshots: only if this report shows > 10 KB/s per player; then a follow-up milestone. `authoritative` physics → ADR-0029 decision after this report. Online fighter transport → ADR-0028 after this report (DL-204).

## Deliverables
- `supabase/migrations/0006_online.sql`, `supabase/tests/online.sql`, regenerated `packages/shared/src/db.gen.ts`.
- `services/edge/src/progress/route.ts`, `services/edge/src/leaderboards/{route.ts, registry.ts}`, `services/edge/src/data/supabase/{progress.ts, leaderboards.ts}` (+ in-memory port additions), `services/edge/src/_test/load-identities.ts`.
- `services/rooms/src/progress/commit.ts`, `services/rooms/src/chat/{chat.ts, moderate.ts}`, `services/rooms/src/metrics.ts`, `services/rooms/src/_test/stats.ts`; edits to `RoomDO.ts` (cap flag, chat, metrics).
- `services/edge/test/{progress-commit, leaderboards}.test.ts`; `services/rooms/test/{rooms-progress, rooms-chat, rooms-capmax}.test.ts`.
- `tests/load/{rooms.ts, bot.ts, report.ts}`, `tests/load/test/bot.test.ts`; root script **`load:rooms`**; `tests/reports/load/` (committed reports).
- `tools/ci/check-prod-routes.ts` covers both new `_test` routes.
- Secrets: `INTERNAL_HMAC` (both Workers; declared in M12b1), `OPENAI_MODERATION_API_KEY` (rooms Worker), `CI_STAFF_DEVICE_JWK` (load runs). Absent: `load:rooms` prints `SKIP load:rooms: CI_STAFF_DEVICE_JWK not set` and exits 0 for `--target staging`; chat fails closed.

## Interfaces
- C11 1.0 and C12 1.1 consumed as frozen. `ProgressDelta` is named by C12 (`DataPort.progress.commit`, route 20) but has no published shape: if `packages/shared/src/api/v1.ts` lacks it, define `{ pid: string; roomId: string; kind: string; delta: { cash: number; rep: number } }` (the `progress_commits` columns, cash in integer cents) and list it in the PR as a proposal for the Architect.
- No other contract change.

## Acceptance criteria
- AC-1 Given migration 0006 on the local stack When pgTAP runs Then `anon` and `authenticated` read 0 rows from all three tables, `progress_wallet.cash` below 0 fails its check, and the generated types equal the committed `db.gen.ts` — proof: `pnpm check:db && pnpm check:db:types`
- AC-2 Given route 20 When a signed commit arrives, the same key arrives again, a signature is wrong or 301 s old, a delta would make cash negative, and a signed commit arrives with `cf.country = 'FR'` Then the answers are `applied` with the wallet changed once, `duplicate` with the wallet unchanged, `unauthorized`, `conflict`, and `applied` (not geo-blocked) — proof: `pnpm check:workers -- progress-commit`
- AC-3 Given a room whose commit target answers 503 twice and then 200 When a commit is issued Then the DO retries from its `schedule` table with the same idempotency key and exactly one commit is applied — proof: `pnpm check:workers -- rooms-progress`
- AC-4 Given route 21 When `GET racing.test.time` runs twice within 30 s, a POST names a prefix with no validator, a board id has an upper-case letter, and a body is 17 KiB Then the second GET is served from KV, and the others return `feature_disabled`, `bad_request` and `payload_too_large` — proof: `pnpm check:workers -- leaderboards`
- AC-5 Given three players in interest, two opted in to chat When the non-opted player sends text, an opted-in player sends clean text, text the recording flags, 281 characters, and clean text while moderation is unavailable Then the first gets `EV Feed chat.off` and no fan-out, the second reaches only the other opted-in player as `EV Chat`, the third and fifth reach nobody and their sender gets `EV Feed chat.held`, and the fourth counts a strike — proof: `pnpm check:workers -- rooms-chat`
- AC-6 Given `rooms.capMax` off When 17 sockets join Then the 17th is closed 4003; with the flag on 32 join and the 33rd is closed 4003 — proof: `pnpm check:workers -- rooms-capmax`
- AC-7 Given the bot module When a bot walks for 600 simulated ticks Then every claimed pose passes `packages/net/src/validate.ts`, `IN` frames decode with the project codec, and the report writer produces every required field — proof: `pnpm check:unit -- tests/load`
- AC-8 Given both Workers running locally When 4 bots run for one minute Then the run writes a report with tick p99 and zero overload errors and exits 0 — proof: `pnpm load:rooms -- --bots 4 --minutes 1 --target local`
- AC-9 Given no `CI_STAFF_DEVICE_JWK` When the staging load test is started Then it prints its SKIP line and exits 0 — proof: `env -u CI_STAFF_DEVICE_JWK pnpm load:rooms -- --bots 16 --minutes 30`
- AC-10 Given staging with both Workers deployed and 8 bots on a GitHub-hosted runner plus 8 on the operator machine When they run 30 minutes in one room Then both shard reports show tick p99 ≤ 10 ms and zero overload errors, and the committed reports record downstream KB/s per player and RTT (this run records U-BE-4, U-BE-14, U-QA-3, U-QA-4 and U-ADR-02) — proof: `pnpm load:rooms -- --bots 16 --minutes 30 --shard 1/2` and `pnpm load:rooms -- --bots 16 --minutes 30 --shard 2/2`
- AC-11 Given the branch When both Previews deploy and the production bundles are checked Then both deploy and neither `_test` route exists in production — proof: `pnpm check:prod-routes && pnpm deploy:preview && pnpm deploy:preview -- --worker rooms`

## Test plan
- DB: `supabase/tests/online.sql` (`pnpm check:db`).
- Workers runtime: `progress-commit`, `leaderboards` (edge); `rooms-progress`, `rooms-chat`, `rooms-capmax` (rooms); moderation and the web endpoint stubbed with recorded responses.
- Unit: `tests/load/test/bot.test.ts` (vitest globs must include `tests/load/test`).
- Load: local smoke (AC-8) in CI is optional; the staging gate (AC-10) runs on dispatch and before `rooms.capMax` changes.

## Demo script
1. `pnpm check:db`; inspect the three tables in the local studio.
2. `pnpm load:rooms -- --bots 4 --minutes 1 --target local`; open the report.
3. Join with two browser profiles; opt one in through the bridge; send chat from both; see who receives what.
4. On staging (operator): run shard 2/2 locally while the dispatch workflow runs shard 1/2; compare the two reports.

## Effort
1 Builder session; about 32 files; risk **high**. Running the 30-minute two-location test and reading DO behaviour under load are the risks; the code itself is moderate.

## Risks & fallbacks
- Node 22 global `WebSocket` is UNVERIFIED for the pinned minor: fall back to the `ws` package (record the version in `spec/03`). The bots must still use `@dv/net` for frames.
- Two GitHub runners may share a PoP (U-QA-4), so the second location is the operator machine; if only one location is available, run 16 bots from it and mark the report `locations: 1`; the gate stays unpassed until a two-location run.
- If the gate fails: keep `rooms.capMax` off, keep CAP 16, attach the report, and propose delta snapshots or a lower interest radius as a follow-up; never loosen the 10 ms budget in code.
- Chat moderation vendor down: chat holds every line (fail closed); play continues.

## Notes for the Builder
- Read first: `09-backend-db.md` §3.6, §5–§6; `09-backend.md` §5.2–§5.3, §8 (M12c ACs), §9; `13-qa.md` §3.10; `spec/05-api-and-realtime.md` §3 (routes 20, 21), §4.3, §5; DL-183, DL-184; ADR-0004, ADR-0028, ADR-0029.
- The rooms Worker reaches the web Worker only over HTTPS with `INTERNAL_HMAC`, never through a service binding (Previews would call production).
- Never put a profile id or chat text in a log line or an Analytics Engine blob; metrics carry counts and durations only.
- Branch `m12c2-rooms-hardening-presence-loadtest`.
