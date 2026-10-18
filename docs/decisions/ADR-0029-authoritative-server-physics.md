# ADR-0029 — Authoritative server physics

**Status:** proposed (deferred; decide after the M12c load test and cheat data) · **Date:** 2026-10-18 · **Decides:** the `authoritative` level reserved by A-04 (ADR-0004); Q-ENG-08

## Context
M12b ships `validated` movement: each client simulates its own avatar and vehicle, claims a pose, and the server checks bounds and speed caps (ADR-0004). `authoritative` would run physics on the server so no client claim is trusted. That needs Rapier inside a Durable Object, which is UNVERIFIED (U-ENG-3), plus a DO memory limit assumed at 128 MB (U-BE-5) and a tick budget that the M12c load test has not yet measured (U-BE-4). A Durable Object handles roughly 500–1,000 requests per second [F-020], so server physics must also fit beside the 20 Hz relay work.

## Options considered
1. **Stay `validated`** and add a re-simulation verifier for leaderboards (DL-122: plausibility-only until then).
2. **Kinematic server validation only** (the default today, Q-ENG-08): bounds and speed caps, with no Rapier in the Durable Object.
3. **Full server physics** in the room object with the `deterministic-compat` Rapier build (ADR-0011).

## Decision (proposed)
The default stays option 2, with option 1's verifier added after M12c. Option 3 is considered only if the load test and live cheat data show both a need (speed or teleport exploits that caps cannot stop) and headroom (tick p99 ≤ 10 ms at 16 bots with physics enabled, memory under the DO limit). If adopted, it ships behind a per-room flag, changes `NET` authority to `authoritative` through the Architect, and keeps `validated` as the fallback.

## Consequences
- (+) No unproven server physics in v1; rooms stay cheap (ADR-0004).
- (+) Leaderboards can gain exact verification without server physics through replay re-simulation (races already reproduce `finishTick`, `gateTicks` and `endHash` under the `canonical` profile).
- (−) A determined cheater can exceed the caps' blind spots until option 3 or the verifier lands.
- (−) Server physics would raise DO duration cost, which dominates at scale [research/stack-cloudflare-backend.md §4.7].

## Affected contracts and milestones
C11 (authority level), C02 (`canonical` profile), C12 (route 21 validators). Decision after M12c1–M12c2; verifier follows M12e.

## Links
`spec/domains/09-backend-contracts.md` §1.1 rule 7, §1.9; `01-engine.md` §10 (Q-ENG-08); `06-racing.md` (replay exactness); `spec/99-open-questions.md` U-ENG-3, U-BE-4, U-BE-5; `spec/11-decision-log.md` DL-052, DL-122; ADR-0004, ADR-0011.
