# ADR-0006 — v1 vertical slice and milestone order

**Status:** accepted · **Date:** 2026-10-18 · **Decides:** spec/03 A-06 and A-09; R-ROLL-01, R-MODE-05

## Context
The product has a story, three unlockable modes, NPCs, mods and multiplayer. Building them in parallel risks a large unshippable engine. R-ROLL-01 requires hosted single-player with a storyline, tested on Cloudflare, before any multiplayer. Each milestone is one Builder session (≈ 2–4 h, ≲ 40 files) and must leave the app deployable (C15).

## Options considered
1. **Horizontal layers** (all engine, then all content). Nothing playable until late; no early signal on mobile or XR budgets.
2. **Mode-first** (ship racing, then fighter). Contradicts the story-first brief and leaves unlock paths untested.
3. **Vertical slice through the story with stubbed modes** (chosen).

## Decision
- **Slice.** The v1 vertical slice is hosted single-player Act 1, **M05c2**, deployed to Cloudflare. Racing and fighter are reachable as unlocked tiles with "coming soon" states, and the tycoon tile stays locked until its Act 2 hook `m.a2.01` (M09b2; DL-391), until their milestones land; the story's stub path still emits `unlock.racing` and `unlock.fighter` (A-06, ADR-0002). Per-mode slices: VS-Racing = M07a2, VS-Fighter = M08a2, VS-Tycoon = M09a2.
- **Ordering anchors.** (1) No rooms milestone (M12b onward) starts before M05c2 is shipped and tested on Cloudflare (R-ROLL-01). (2) A cutscene-playback spike (M04c) precedes cutscene infrastructure (M05b1). (3) Supabase arrives at M05d, not earlier; single-player never depends on the network (`/boot` failure means offline mode). (4) Device and platform spikes (M01c, M01e, M04c) precede the work that depends on their numbers.
- **Register.** The milestone register in `spec/00-plan.md` is final: 96 v1 milestones plus M15a–g (Bay expansion, post-v1). Letter = scope, digit = session split (DL-037). Only M01a, M01b, M04a, M10a, M11a, M11b2, M12b, M12c and M14b are split with digit suffixes; ids are never renumbered.
- **Fast track.** M00, M00a–M00c, M01a1–M01f are READY and may already be executing; later files follow the same format (C15).
- **Release gates (owner).** Q-21 gates the M05c2 public release; Q-23 gates the M14b launch; Q-25 and Q-19 gate real-roster content (M10c); Q-22 gates the npm publish step of M13a6 and M13c3. Development runs on defaults meanwhile.

## Consequences
- (+) A playable, deployed game exists from M05c2; every later milestone adds to a running product.
- (+) Stubs prove the unlock registry and mode contract (C06) before real modes exist.
- (−) Some Act 1 beats play against stub modes, so their real hooks are re-verified when M07a, M08a and M09a land.
- (−) Staged unlock content means menu states ("coming soon") exist in public builds for weeks.

## Affected contracts and milestones
C06 (unlock registry, `GameModeDescriptor.status`), C09 (hooks with `stub`), C15 (milestone format). Milestones M04a, M05a1–M05c3, M07a2, M08a2, M09a2, M12b1 (first rooms milestone), M14b.

## Links
`spec/00-plan.md` (register, ordering anchors); `spec/domains/03-story.md` §8; `research/INDEX.md` §5; `spec/11-decision-log.md` DL-037, DL-115, DL-155; ADR-0002, ADR-0004.
