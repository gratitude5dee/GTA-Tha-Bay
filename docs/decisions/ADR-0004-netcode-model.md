# ADR-0004 — Netcode model

**Status:** accepted · **Date:** 2026-10-18 · **Decides:** spec/03 A-04 (amended by DL-052) and D-06; contract C11

## Context
R-ROLL-02 asks for multiplayer rooms and presence on Cloudflare Durable Objects. R-ROLL-01 puts rooms after the hosted single-player slice. The sim runs at 60 Hz (C02); a room tick of 20 Hz carries 12-byte input samples and 28-byte entity records. A fully server-simulated world needs physics inside a Durable Object, which is untested (U-ENG-3).

## Options considered
1. **Supabase Realtime Broadcast.** One 16-slot room at 20 Hz costs about $1.44 per player-hour, and a Pro project is capped at 2,500 messages per second [F-029; research/stack-cloudflare-backend.md §5].
2. **Convex mutations.** At least $0.144 per player-hour before subscription re-runs, optimistic-concurrency retries on a hot room document, no US West region [F-033; research/stack-cloudflare-backend.md §5].
3. **Durable Object per room, client-simulated movement checked by the server** (chosen): about $0.014 per 16-player room-hour [F-021; research/stack-cloudflare-backend.md §4.7].
4. **Server-authoritative physics from day one.** Needs Rapier inside a Durable Object (U-ENG-3 UNVERIFIED) and a load test that does not exist yet; deferred to ADR-0029.

## Decision
- **Authority levels.** `validated` ships in M12b: each client simulates its own avatar and vehicle and claims a pose; the server checks bounds and per-class speed caps (`config/net.speedcaps.json`) and sends corrections. `authoritative` is reserved and is enabled only by ADR-0029 after the M12c load test. The phrase "server-authoritative" in the v0 A-04 text means this validated model.
- **Rates.** Client sim 60 Hz, `IN` samples 20 Hz (mobile batches two per frame), server tick 20 Hz (`SERVER_HZ`), `SNAP` 28 bytes per entity, protocol `PROTOCOL_VERSION` 2.
- **Topology.** `RoomDO` per instance, `DirectoryDO` (assignment), `PresenceDO` (sharded presence), all with the Hibernation API in the separate `tha-bay-rooms` Worker at `rt.<domain>` (ADR-0001). Each room runs a 50 ms `setInterval` only while sockets are connected and stops after 60 s without activity; hibernation requires no timers [F-022]; `setAlarm` is never used per tick because each alarm is a row write [F-021]. Cap 16 players, 32 behind `rooms.capMax` after the M12c test. Checkpoints every 5 s into DO SQLite; resume tokens survive deploys, which restart the script's objects [F-020].
- **Wire.** One WebSocket per player, binary frames, little-endian; the server assigns `sid` and `slot`; client-supplied ids are ignored; non-monotonic `seq` is dropped; interest management on a 64 m grid with 150 m and 300 m radii; close codes 4001–4008 (mods → 4007, ADR-0012).
- **Engine hooks (M12b, DL-052).** A 64-tick prediction ring; corrections above 0.3, 0.8 and 2.0 m blend with gains 0.05, 0.12 and 0.4, or snap on vehicle transitions; `stateHash` every 60 ticks; net slot ↔ `StableKey player:<slot>`.
- **Persistence.** Progress commits through `progress.commit` (HTTPS, `INTERNAL_HMAC`) to the Worker and Postgres, never from client saves.
- **Out of v1.** Voice chat, delta snapshots (only if downstream exceeds 10 KB/s per player in the load test), district handoff, fight rollback (ADR-0028).

## Consequences
- (+) Low per-room cost and a clear scale unit; deploys of the web Worker never drop rooms.
- (+) The client keeps one prediction path for walking and driving.
- (−) `validated` movement admits speed hacks up to the caps; leaderboards are plausibility-only (`verified: false`, DL-122) until a re-simulation verifier exists after M12c.
- (−) DO socket backpressure and per-message billing under hibernation are UNVERIFIED (U-BE-4, U-BE-14); the M12c test measures them and the cap stays 16 until it passes.

## Affected contracts and milestones
C11, C02 (`NetIn`/`NetOut` in `sim.worker`), C12 (assign, tickets, progress), C06 (net slots). M12b1–M12b2 (rooms core, prediction), M12c1–M12c2 (resume, presence, load test), M12e (route 21 validators), M11a (budgets for net decode).

## Links
`spec/domains/09-backend-contracts.md` §1; `09-backend.md` §5.1; `01-engine.md` §2.13; `spec/11-decision-log.md` DL-010, DL-052, DL-071, DL-122; ADR-0028, ADR-0029.
