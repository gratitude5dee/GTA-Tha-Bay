# ADR-0028 — Fight-room transport and rollback

**Status:** proposed (deferred; decide after the M12c load test) · **Date:** 2026-10-18 · **Decides:** the C11 `ActKind.FightInput` deferral (DL-100, DL-104) and spec/domains/07-fighter-core.md FC12

## Context
R-MODE-03 does not require online fighting. The fighter state is one ~4 KB `Int32Array` and `step` is a pure function of `(state, inputs)`, which makes rollback feasible. C11 cannot carry the input: `EV Activity` is reliable JSON up to 1 KiB and `IN` is sampled at 20 Hz, while fight input is 60 Hz. The latency of a Durable Object relay is UNVERIFIED (U-ADR-02) and is measured by the M12c load test.

## Options considered
1. **Relay over the room WebSocket** with an additive `ActKind.FightInput` carrying the last 8 frames × 2 B per player, redundantly, each tick, to a fight instance assigned by `DirectoryDO`; the object relays and arbitrates final hashes and does not simulate.
2. **WebRTC data channels** with Cloudflare Realtime TURN; lower latency potential, larger privacy and abuse surface, TURN priced at $0.05/GB beyond 1,000 GB free [F-026].
3. **GGPO.** MIT-licensed but its build targets Windows only; the loop is written in TypeScript.
4. **No online fighter in v1.**

## Decision (proposed)
Default: option 4 until the M12c load test records the relay's input-to-input latency. If the relay meets the plan below, adopt option 1 as a C11 minor addition (`ActKind.FightInput`), written through the Architect; otherwise evaluate option 2 in a follow-up ADR.
- **Plan (FC12).** Input delay 2 frames; rollback up to 7 frames; an 8-snapshot ring; a hash exchange every 10 frames; spectators by input relay; leniency forced to 100 %; pose disabled online; both clients verify `frameDataHash` and `FIGHT_DATA_VERSION` at join, and a mismatch means no match.
- **No ranked queue in v1.** If ranked arrives, Classic and Simple queues are separate and pose never enters ranked.
- **Timing.** DL-104 said "after M12b"; S07 says the load test decides. The load test runs in M12c, so this ADR is decided after M12c.

## Consequences
- (+) No C11 change and no unverified transport in v1.
- (+) Rollback code stays isolated from the offline mode.
- (−) No online fighter at launch.
- (−) If the relay is too slow, the fallback (WebRTC) adds TURN cost and a new abuse surface.

## Affected contracts and milestones
C11 (additive `ActKind.FightInput` if adopted), C02 (hash cadence), C06 (mode ranked flags). Decision after M12c1–M12c2; a new milestone would follow M12e.

## Links
`spec/domains/07-fighter-core.md` FC12; `09-backend-contracts-1.1.md`; `research/gamedesign-decomposition.md` §4.8; `spec/99-open-questions.md` U-ADR-02; `spec/11-decision-log.md` DL-100, DL-104, DL-204; ADR-0004.
