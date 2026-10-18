# ADR-0016 — `AnimStateId` blocks 128–255

**Status:** accepted · **Date:** 2026-10-18 · **Decides:** DL-012 reserve and DL-091 assignment; contract C04 1.1 (also carried in C11 `SNAP.anim`)

## Context
The room protocol sends one `anim` byte per entity (C11 `SNAP`, 28 bytes per entity). Engine states occupy 0–22 and S01 reserves 23–127. Three modes need network-visible animation states: racing (vehicle and driver states), the fighter (state families; the move being played is `FighterView.move` plus the frame), and tycoon. Without a split, two modes would claim the same ids and remote clients would show wrong animation.

## Options considered
1. **A shared pool, first come first served.** Collisions are found only when two modes are active in one room.
2. **Per-mode registries negotiated at join.** Adds protocol state for a one-byte field.
3. **Fixed contiguous blocks per mode, assigned once** (chosen).

## Decision
| Range | Owner | Content |
|---|---|---|
| 0–22 | S01 engine | idle, walk, run, sprint, jump, fall, land, vault, enter vehicle, drive, passenger, exit vehicle, ragdoll, get up, knocked out, melee ready, attack, hitstun, blockstun, grappled, swim, emote, arrested |
| 23–127 | S01 reserve | unassigned |
| 128–159 | racing (S06) | 128 vehicle idle, 129 driving, 130 braking, 131 drifting, 132 nitro, 133 airborne, 134 hop, 135 wrecked, 136 stalled, 137 sirens on (police variant); 138–143 reserved; 144 driver celebrate, 145 dejected, 146 reset-wave, 147 repair kneel, 148 photo pose; 149–159 reserved |
| 160–207 | fighter (S07) | 160–165 idle, walks, crouch; 166–173 jumps, dashes; 174–183 blocks, hits, knockdown, wake-up; 184–195 throws, attacks (move-driven), supers, checks, taunt; 196–205 intro, round win and lose, KO, shutdown, victory, defeat, summon; 206–207 reserved |
| 208–255 | tycoon (S08) | 224–231 claimed, unused in v1 (the mode is asynchronous); the rest unassigned |

Rules:
1. Each owner assigns ids only inside its block, in its domain table (`06-racing-data.md`, `07-fighter-content.md` FX7, `08-tycoon.md`); the owner keeps this ADR's table row in step.
2. Moving a block boundary, or using an id outside the owner's block, is a contract change: it goes to the Architect and amends this ADR.
3. Ids 0–22 never change meaning.
4. The SNAP byte selects the animation state family only. Fighter move states are played by the frame-locked clip player from `FighterView.move` and `frame`, not from the byte, so the byte never encodes a move.
5. Components for the same modes live in the C01 ranges (racing 1024–1279, fighter 1280–1535, tycoon 1536–1791); animation ids and component ids are separate spaces.

The engine's one-line summary in C04 ("vehicle states 128–136") predates the sirens state; the racing table above is authoritative for 128–159 (DL-203).

## Consequences
- (+) Modes evolve their states independently with no collision risk.
- (+) The byte stays one byte; no join negotiation.
- (−) Each mode is limited to its block (32, 48 and 48 ids); the fighter block is nearly full by design, with 206–207 reserved.
- (−) Tycoon's block is mostly empty; its 224–231 claim matters only when asynchronous rooms arrive.

## Affected contracts and milestones
C04 (`AnimStateId`, `packages/shared/src/contracts/anim-states.ts`), C11 (`SNAP.anim`). M07a1 (racing states), M08a2 (fighter states, frame-locked player), M09b2 (tycoon block unused), M12b1 (wire), M12c.

## Links
`spec/domains/01-engine-contracts.md` (C04, `AnimStateId` mode blocks); `06-racing-data.md`; `07-fighter-content.md` FX7; `08-tycoon.md` §3.1; `spec/11-decision-log.md` DL-012, DL-066, DL-091, DL-130; ADR-0004.
