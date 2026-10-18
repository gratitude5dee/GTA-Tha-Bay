# ADR-0011 — Physics and determinism

**Status:** accepted · **Date:** 2026-10-18 · **Decides:** spec/03 D-12 and D-13; contracts C01, C02

## Context
Reproducible simulation is needed for five consumers: mission autoplay (ADR-0002), race ghosts and replays, fighter replays and netcode desync checks, the tycoon harness, and server-side plausibility checks (ADR-0004). Free-roam play must also run fast on an iPhone. The research brief said "deterministic for everything"; that costs performance on every device for a property only some features need [research/stack-rendering-platform.md §5.1].

## Options considered
1. **Jolt 1.1.0** (MIT): richer vehicle and ragdoll controllers, `CROSS_PLATFORM_DETERMINISTIC` build; manual `Jolt.destroy` memory management, and a threaded build would need an ADR [research/stack-rendering-platform.md §5.1; research/INDEX.md §1.12]. Kept as the documented swap for racing if vehicle feel fails acceptance.
2. **cannon-es:** unmaintained since 2022 [research/stack-rendering-platform.md §5.1].
3. **Rapier 0.21.0** (Apache-2.0) with a locally deterministic `simd-compat` build and a cross-platform `deterministic-compat` build [F-014] (chosen).
4. **One deterministic build for everything.** The tick-cost difference is UNVERIFIED (U-ENG-2); decided against until M01a/M03a measure it (D-S01-02).

## Decision
- **Two sim profiles (C02).** `local`: `@dimforge/rapier3d-simd-compat`, tier-dependent ambient density; reproducible only on the same build and browser; used for story, free roam and open-world races. `canonical`: `rapier3d-deterministic-compat`, fixed `mobile-low` ambient density; identical hashes in Node, Chromium and WebKit; used for CI, autoplay, race ghosts and time trials, server checks and the M01a cross-browser test. Exactly one Rapier build loads per session; a top-level mode needing `canonical` restarts `sim.worker` behind the loading screen (D-S01-01).
- **No Rapier in the fighter.** Fight frame data runs on `detmath` integers; the tycoon sim is pure arithmetic.
- **Loop.** bitECS 0.4.0 world; fixed 60 Hz `SIM_DT`; accumulator clamp 0.15 s; at most 9 ticks per frame; render one tick behind; AI at 30 Hz and net at 20 Hz on every tier, so the sim never branches on tier inside a profile.
- **Determinism rules (C02 rule 1).** In `packages/shared/**`, `packages/engine/src/sim/**` (except `sim/save/**`) and `packages/modes/*/src/sim/**`: no `Math.random`, no transcendental `Math.*` (use `detmath`; `detmath.sqrt` never delegates, U-ENG-1), no `**`, no `Date`, `performance.now` or timers, no `crypto.getRandomValues`, no `for…in`, no `Intl`, no `three`, no DOM types. Randomness is seeded `xoshiro128**` streams; the stateless `ctrU32(seed, stream, counter)` is allowed (C02 1.1). ESLint enforces it.
- **Hashes.** FNV-1a-64 for `stateHash` and C05 checksums; SHA-256 for content and cache keys.
- **Ambient agents.** Keyed `(cellKey, slot)` with per-agent RNG streams; a lower tier runs a prefix of the slots, so tiers agree where they overlap (C01 rule 5).
- **Floating origin.** ECS positions are f64 ENU metres; Rapier works in f32 around an origin that rebases when the player is more than 1,000 m away.
- **Threads.** No wasm pthreads in v1: Rapier and MediaPipe are single-thread builds, and `SharedArrayBuffer` is used for JS-side blocks only; a threaded Jolt build would need its own ADR.
- **Proof.** Cross-browser state-hash tests (`@determinism`, Chromium and WebKit against the Node golden) run in M01a and again for each mode core.

## Consequences
- (+) Local play pays no determinism tax; every feature that needs reproducibility has a defined profile.
- (+) Replays, ghosts and autoplay can be verified in CI without a browser.
- (−) A mode that switches profiles pays a worker restart; menu racing runs `canonical` (DL-121).
- (−) Rapier inside a Durable Object is UNVERIFIED (U-ENG-3); server physics waits for ADR-0029.
- (−) Two wasm builds ship, adding size to the lazy chunks.

## Affected contracts and milestones
C01, C02 (profiles, lint, streams), C05 (checksums), C06 (profile on mode entry), C11 (hash cadence). M01a1 (detmath, rng, hash), M01a2 (Rapier builds, hash tests), M03a1–M03a2, M07a1–M07a2, M08a1, M09a1, M12b1.

## Links
`research/stack-rendering-platform.md` §5.1; `research/INDEX.md` §1.12–1.13; `spec/domains/01-engine.md` §2.3–2.4; `spec/11-decision-log.md` DL-008, DL-094, DL-121; ADR-0002, ADR-0004, ADR-0029.
