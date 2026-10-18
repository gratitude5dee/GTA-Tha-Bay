# ADR-0002 — Mission scripting: TypeScript authoring, JSON IR, bounded interpreter

**Status:** accepted · **Date:** 2026-10-18 · **Decides:** spec/03 A-02 (contract C09, domain S03)

## Context
Missions must be authored by people and agents, validated before they ship, replayed deterministically in CI, and loadable from player mods without executing arbitrary code. First-party missions must survive a world rebake (references resolve against C08 places). The simulate-once timeline plus autoplayer pattern gives CI a proof for every mission [research/gamedesign-decomposition.md §2.6; research/INDEX.md §3 "Simulate-once timeline + autoplayer"].

## Options considered
1. **Ink or Yarn as the mission language.** No world predicates, and a second runtime beside the sim.
2. **First-party missions as QuickJS scripts.** Needs the sandboxed worker for core content, couples mission time to script time, and is hard to checkpoint. The IR suffices; script tier stays for mods (ADR-0012).
3. **LLM-decided outcomes.** Nondeterministic and jailbreakable; rejected (C10, DL-085).
4. **TypeScript authoring compiled to a JSON IR, run by a small interpreter** (chosen).

## Decision
- **Authoring** is TypeScript (`defineMission`, `defineDirector`, helpers in `packages/modes/story/src/authoring/`, re-exported by `@dv/mod-sdk`). `pnpm missions:build` compiles it, resolves references through the C08 `WorldResolver`, lints names with the `NameRegistry`, and emits `MissionIR` JSON validated by `mission-ir-1.schema.json` (shipped as `data/mission.<id>`).
- **IR shape.** Structured ops only: `seq`, `all`, `race`, `if`, `loop(max)` and waits. There is no `goto`, so a mission is a tree the debugger can show, every loop is bounded, and a mod cannot jump into arbitrary state.
- **Interpreter.** The mission VM runs in `sim.worker` on C06 `SimScheduler` threads with seeded streams (C02). Zone predicates and objectives read C08 and C06 services only. One active story mission; checkpoints are per stage and store mission-owned state, not thread stacks (`MissionCheckpointV1`, opaque in the C05 `StorySlice`).
- **Talk objectives.** Outcomes are player choices that NPC `effects` can unlock; the model never decides flow (DL-085). Every talk has an ink or scripted offline path.
- **Autoplayer.** `check:missions` runs every mission in the `canonical` profile with `BotInput` (C03 1.1) until it completes within its declared time; the timeline export drives the preview scrubber.
- **Mods.** The same IR is accepted from mods under the C09 `mod` validation profile: no `give`, `rewards`, `unlocks`, story flags or `mode` hooks, at most 8 missions (DL-084, C14).
- **Hooks.** A mode hook names the mode owner's def id (racing `RaceId`, fighter `bout.<id>`, tycoon `mini8w`); the `stub` path still emits its unlock (DL-092, DL-157).

## Consequences
- (+) Missions are data: diffable, schema-checked, replayable, safe to accept from mods.
- (+) CI proves completability without a browser.
- (−) Expressiveness is limited to the op set; a new behaviour needs an interpreter change and, if it alters the IR shape, an Architect-approved C09 change.
- (−) Checkpoints restart a stage's threads from their first op, so authors must keep stages idempotent.

## Affected contracts and milestones
C09 (IR, `mod` profile), C06 (`SimScheduler`, `ZoneService`, hooks), C05 (checkpoint), C08 (`WorldResolver`), C10 (talk). M05a1 (IR, VM), M05a2 (autoplayer, director), M05c1–M05c2 (Act 1), M05e1–M05f2, M13a3 and M13b3 (mod profile).

## Links
`spec/domains/03-story.md` §2 (decisions DS-03-1…10), `03-story-missions.md`; `spec/11-decision-log.md` DL-084, DL-085, DL-092, DL-157; ADR-0006, ADR-0011, ADR-0012.
