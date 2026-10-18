# M08a1 — fight-core-sim-data

## Goal
After this session the Culture Wars fighter has a pure, deterministic core that runs and is tested in Node with no renderer, worker or engine mode. `packages/shared/src/fight/` implements FC1–FC9 of `07-fighter-core.md`: frame-data types and JSON Schemas, the `Int32Array` fight buffer, the C03 → `FighterInput` mapping, the 32-entry input ring and motion parser, fighter states and cancels, capsule hit resolution, meters, rounds and phases, the projectile pool, the FNV-1a-64 match hash, snapshot and restore, and the `.dvfight` replay. The reference kit `PLAYER_FIGHTER` (FX3) and `config/fighter.tuning.json` are data. `@dv/mode-fighter` gains the tools `fighter:lint` and `fighter:replay`, golden replays and the QA input driver `fighter.script`. **Split boundary (`07-fighter.md` §8):** the mode, ECS mirror, camera, HUD, training, CPU, schemes on devices and stage are M08a2; kits 2–8, CPU AI and the roster are M08b1.

## Requirements
- R-MODE-03: rounds, meters, specials, EX, supers, throws, Check and Clear, combo scaling and derived frame data as an integer simulation.
- R-ENG-01 (support): every check is a deterministic `pnpm` command (`fighter:lint`, `fighter:replay`, golden vectors).

## Depends on
- **M01a1** (`@dv/shared` with C01–C03 contract files, `canonicalize`, `sha256Hex`, `Fnv64`, `splitmix32`, `xoshiro128**`, `fnv32`, determinism lint, vitest).
- **M05a1** (mission-ir-vm): the complete `c09-mission.ts` that holds `RosterSlot` (DL-163; DL-219).
- Contracts: C02 1.1 (determinism rules, 60 Hz), C03 1.1 (`InputFrame`, fighter alias table, `BotInput`, `DeviceKind 'bot'`), C09 1.0 (type import of `RosterSlot` only).

## Scope in
- `types.ts` (FC2 verbatim: `HitDef`, `BoxTrack`, `MoveDef`, `ProjectileDef`, `FighterDef`, `AiProfile`, `InputPattern`, `FrameDataPack`, `FIGHT_DATA_VERSION = 1`), `input.ts` (`FB` bits, `fromInputFrame` per FC5.1 with ±48 thresholds and SOCD rules), `buffer.ts` (`FF`, `FM`, layout, `FightSim`, `FightRules`, `FighterLoadout`, `FightEventSink`).
- Motion parser (FC5.3): `236`, `214`, `623`, `41236`, `63214`, `22`, `66`, `44`, `360`, charge `[4]6` and `[2]8`, `MOTION_WINDOW`, `BUTTON_LEEWAY`, buffers, priority, EX, `leniencyX100` scaling; Classic and Simple input interpretation (FC5.4) inside the core.
- States and cancels (FC4), hit resolution (FC6 items 1–12), meters (FC7), rounds and phases (FC3 table, FC8 items 1–3; the camera directive is M08a2), projectile pool of 16 with the `linear` behaviour and clash (FC9; other behaviours in M08b1).
- Hash over every buffer word except presentation counters, `snapshot`/`restore`, two RNG states in the buffer (`fight`, `cpu`).
- `FrameDataPack` builder: `hash = sha256Hex(canonicalize(pack without hash))`.
- `.dvfight` v1 (FC2 "Replay"): encode, decode, verify every 60-tick checkpoint; mismatched `frameDataHash` or `FIGHT_DATA_VERSION` refuses with `REPLAY_MISMATCH`.
- Reference kit `content/fighter/kits/player.json` with the twelve FX3 moves; schema-valid placeholder `shutdown`, `taunt` and Showstopper entries (final values in M08b1).
- `fighter:lint`: schema; recomputes `advHit`/`advBlock`; rejects `startup < 3`, `recovery < 1`, boxes outside ±4,000 u, a hit with no hurtbox overlap on any frame of its move, unreachable inputs, name collisions; loop search over cancel graphs (> 40 hits or > 70 % health on one touch). The fame-domain rule arrives in M08b1.
- QA driver `fighter.script`: implements C03 `BotInput` (`device: 'bot'`) from a seeded script of `InputFrame`s; used to record the goldens.
- Golden replays `vs-001.dvfight` (normals, chains, specials, EX, super, KO) and `vs-002.dvfight` (projectiles, throws, throw tech, Check, Clear, Rattled, time-out); hash vectors.

## Scope out
- `FighterMode`, ECS mirror (ids 1280–1283), camera directive, presenter, HUD, Training, CPU levels, device bindings, stage, slice, unlock, story hook, `fighter:bench`, registration of `fighter.script` in the M04d registry, `@fighter-hash`: M08a2.
- Projectile behaviour `trap` (needed by the second VS kit): M08a2. Kits 2–8, behaviours `sine`, `arc`, `orbit`, `summon`, full CPU, roster, fame-domain lint, `fighter:balance`, `check:fighter`: M08b1.
- Cutscene hooks and the Cinematic presentation: M08b2. Pose: M08c1. Rollback netcode: post-M12b (FC12).

## Deliverables
- `packages/shared/src/fight/{types.ts, input.ts, buffer.ts, motion.ts, states.ts, step.ts, hit.ts, meters.ts, rounds.ts, projectiles.ts, hash.ts, pack.ts, replay.ts, index.ts}`.
- `packages/shared/src/fight/schema/{kit.v1,tuning.v1,replay.v1}.schema.json`.
- `packages/shared/test/fight/{motion-parser.spec.ts, frame-data-derive.spec.ts, hit-resolution.spec.ts, combo-scaling.spec.ts, meters.spec.ts, rounds.spec.ts, projectiles.spec.ts, hash-vectors.spec.ts, replay-roundtrip.spec.ts, input-map.spec.ts}`, `packages/shared/test/fight/no-alloc.spec.ts` (run with `--expose-gc` in its own vitest project), `packages/shared/test/golden/fight/hash.v1.json`.
- `config/fighter.tuning.json` (FC2 constants table); `content/fighter/kits/player.json`.
- `packages/modes/fighter/package.json` (`@dv/mode-fighter`, created if M04a2 left none), with scripts **`test`** (vitest through `tools/ci/run.ts`, folded into `pnpm check:unit`), **`fighter:lint`**, **`fighter:replay`**; `packages/modes/fighter/{tsconfig.json, README.md}`.
- `packages/modes/fighter/scripts/{lint.ts, replay.ts}`; `packages/modes/fighter/src/qa/script-driver.ts`.
- `packages/modes/fighter/golden/{vs-001,vs-002}.dvfight`, `packages/modes/fighter/test/{lint.spec.ts, replay.spec.ts, script-driver.spec.ts}`, `packages/modes/fighter/test/fixtures/kits/bad-*.json` (one per lint rule).

## Interfaces
- Consumes C03 1.1 (`InputFrame`, fighter aliases, `BotInput`) and C02 1.1 rules; imports C09 1.0 `RosterSlot` from `packages/shared/src/contracts/c09-mission.ts` for `FighterSlotId` (DL-163; never redeclared). That file is created earlier in the run order (`_PLAN.md` §1 row 34).
- S07-owned, not numbered contracts: every FC2 type exactly as written. No contract change; a shape that cannot compile goes to the Architect as a proposal in `docs/decisions/`.

## Acceptance criteria
- AC-1 Given the branch When typecheck, lint and build run Then all exit 0, and `packages/shared/src/fight/**` passes the C02 determinism lint with no `detmath` transcendental, no `**` and only the FC1.4 `Math` functions — proof: `pnpm typecheck && pnpm lint && pnpm build`
- AC-2 Given the golden replays When they are re-simulated in Node Then every 60-tick checkpoint hash and the final winner and rounds match — proof: `pnpm --filter @dv/mode-fighter fighter:replay -- golden/vs-001.dvfight && pnpm --filter @dv/mode-fighter fighter:replay -- golden/vs-002.dvfight`
- AC-3 Given motion fixtures for `236`, `214`, `623` (including 6-3-2-3 and the dash-implied 6), `41236`, `[4]6` held 45 frames with a 3-frame gap, `66` within the tap window, edge leniency at `BUTTON_LEEWAY` ± 1 and `leniencyX100` 150 When the parser runs Then each fixture triggers or rejects exactly as specified, super beats special on overlap, and `LP+LK` on one frame is a throw — proof: `pnpm check:unit -- packages/shared/test/fight`
- AC-4 Given the reference kit When `fighter:lint` runs Then the derived values equal FX3 (5L +4/+1, 5M +5/−1, 5H +3/−4, 2L +4/+2, 2M +4/−2, 2H −9 on block, Skid Kick +2/−5, Uplift −25, Surge −31), and each `bad-*.json` fixture fails with its rule — proof: `pnpm --filter @dv/mode-fighter fighter:lint && pnpm --filter @dv/mode-fighter test -- lint`
- AC-5 Given hit fixtures When resolved Then a same-tick trade hits both with equal hitstop, a strike beats a throw, two throws 7 frames apart tech with no damage, a counter adds 2 hitstun and 110 % damage, scaling follows `[100,100,80,70,60,50,40,30]` floored at 30 (Surge at 40), normals chip 0 unless Rattled, the 41st hit forces a hard knockdown with no damage, and armor takes 50 % without stun — proof: `pnpm check:unit -- packages/shared/test/fight`
- AC-6 Given round fixtures When played Then a time-out with equal health scores both and starts a 1,800-frame sudden round at 1,000 health, a double KO scores both, the KO phase steps every third tick for 30 frames, Shutdown opens for 90 frames only after a final non-chip KO with `shutdowns` on, `Cinematic` lasts exactly 300 frames unless an attack input skips it, Check costs 600 and refunds 300 on success, and Clear works once per round — proof: `pnpm check:unit -- packages/shared/test/fight`
- AC-7 Given `hash.v1.json` When the hash tests run Then hashes of the golden buffers match, a snapshot at tick 1,000 restored and re-run gives the same hash at tick 3,000, and changing one word changes the hash — proof: `pnpm check:unit -- packages/shared/test/fight`
- AC-8 Given a scripted-versus-scripted 99-second match after a 600-tick warm-up When heap use is sampled after forced GC Then it grows by less than 64 KiB over 5,940 ticks — proof: `pnpm check:unit -- packages/shared/test/fight/no-alloc`
- AC-9 Given `vs-001.dvfight` When its `frameDataHash` is altered, or the kit's 5L startup is changed from 4 to 5 before verifying Then verification fails with `REPLAY_MISMATCH` or a named checkpoint mismatch, and an encode–decode round trip is byte-identical — proof: `pnpm --filter @dv/mode-fighter test -- replay`
- AC-10 Given seed 7 When `fighter.script` produces 600 frames twice Then the `InputFrame` streams are identical with `device: 'bot'`, and `fromInputFrame` maps `moveX` ±47/±48, left+right (neutral) and up+down (up) per FC5.1 — proof: `pnpm --filter @dv/mode-fighter test -- script-driver && pnpm check:unit -- packages/shared/test/fight/input-map`
- AC-11 Given the branch When the unit suite and the preview deploy run Then both pass and the deployed app is unchanged — proof: `pnpm check:unit && pnpm deploy:preview`

## Test plan
- **Unit (shared):** `fight/motion-parser`, `fight/frame-data-derive`, `fight/hit-resolution`, `fight/combo-scaling`, `fight/meters`, `fight/rounds`, `fight/projectiles`, `fight/hash-vectors`, `fight/replay-roundtrip`, `fight/input-map`, `fight/no-alloc`.
- **Tools:** `fighter:lint` on the reference kit and bad fixtures; `fighter:replay` on both goldens; self-mutant in `replay.spec.ts` (AC-9) until M08a2 registers mutants with the M04d harness.
- Browser hashes start in M08a2 (`@fighter-hash`).

## Demo script
1. `pnpm --filter @dv/mode-fighter fighter:lint`: the reference kit table prints with derived advantage.
2. `pnpm --filter @dv/mode-fighter fighter:replay -- golden/vs-001.dvfight`: every checkpoint matches.
3. Edit 5L startup in a scratch copy of the kit, rerun the replay: the first mismatching checkpoint is named.

## Effort
1 Builder session; about 36 files; risk **medium**. Hit resolution order and the motion parser's adjacency rules are the main time sinks.

## Risks & fallbacks
- **Int overflow:** keep every intermediate below 2^53 (FC1.4) and use `trunc(value × pct / 100)`; add a test with maximum health, damage and scaling.
- **Allocation test noise:** if V8 heap sampling is unstable, run three repetitions and assert on the median; never weaken the per-tick rule in code review.
- **Missing C09 file** (run-order break): do not redeclare `RosterSlot`; stop and report.
- **Golden churn:** regenerate goldens only with `DV_UPDATE_GOLDEN=1` and the `golden-update` label, after a deliberate data change.

## Notes for the Builder
- Read first: `07-fighter-core.md` FC1–FC9, FC11; `07-fighter-content.md` FX3; `07-fighter.md` §2; `01-engine-contracts.md` C03 1.1 section.
- Order: types and schema → buffer and hash → input map and ring → motion parser → states → hit → meters → rounds → projectiles → pack and replay → reference kit → lint → driver → goldens.
- `packages/shared/src/fight/**` is sim code: integers only, `SINE64` table for sine paths, squared-distance capsule tests, no allocation inside `step`.
- `onHit`/`onBlock` are derived, never authored.
- Secrets: none besides the CI deploy pair. No paid account.
