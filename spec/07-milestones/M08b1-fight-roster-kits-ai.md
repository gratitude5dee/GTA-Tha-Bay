# M08b1 — fight-roster-kits-ai

## Goal
After this session Culture Wars has its v1 roster as data. Eight kits per `07-fighter-content.md` FX2 are authored and linted: the rap, tech, sport and creator families, each with a gimmick, three specials, an L2 super, a Showstopper, a comedic Shutdown and a taunt. The reference kit `PLAYER_FIGHTER` gets its final Showstopper, Shutdown and taunt. The remaining projectile behaviours (`sine`, `arc`, `orbit`, `summon`) work. The CPU is complete: full candidate set, named habits, four levels. A roster loader binds slots to compiled souls (C10) and reads the likeness tier from the soul, never from fighter data. The tier and fame-domain gates fail CI on a mismatch. `fighter:balance` proves every pair wins 35–65 %, and the new root gate `pnpm check:fighter` runs the whole fighter content CI. The real roster waits for the owner (Q-19, Q-25): every slot binds to an original development soul.

## Requirements
- R-MODE-03: a roster of eight fighters with distinct kits, specials, supers and finishers, plus a CPU at four levels.
- R-NPC-04: likeness tiers come from the compiled soul, and `parody` subjects are never shown in their fame domain.
- R-IP-02: CI enforces tier equality, mandatory stand-ins and fame-domain exclusion through `likeness:gate` and `check:fighter`.
- R-IP-01 (support): shipped move and kit names are original and pass `names:lint` and `ip:strings` (FX2 name-hygiene table).

## Depends on
- **M08a2** (fighter mode, two kits, CPU core and driver `fighter.cpu`, Training, `@fighter-hash`), **M06a2** (C10 types and schemas, `tools/soul` compiler, `pnpm npc:lint`, test souls `npc_test`, the `fictionalized` canary and stand-ins, consent-index export).
- Contracts: C07 1.1 (assets with the likeness block), C10 1.0 (`CompiledSoulPublic.tier`, `fameDomain`, `standIn`), C16 1.1.

## Scope in
- Kits `content/fighter/kits/{rap_hyphy_elder, rap_lyricist, rap_new_wave, tech_visionary, tech_hacker, ath_shooter, ath_power_back, influencer}.json` per FX2 (walk speeds, health 9,500–10,500, gimmick state words: `frenzy`, `string`, `pulse`, `agents`, `patch`/`glitch`, `charge`, `armor`, `poll`); `player.json` final (Showstopper 3,200 at 50 % minimum scale, Shutdown 170 frames, taunt).
- Core additions in `packages/shared/src/fight/`: projectile behaviours `sine` (via `SINE64`), `arc`, `orbit` (child defs), `summon` (Hype cost, scripted move list); gimmick hooks reading words G0–G3; poll buff order from the `fight` stream.
- Full CPU (FC10): every candidate action, habits in `content/fighter/ai/habits.json`, habit variety 3/5/8/12, block-rate offsets, reaction ×1.5 hook reserved for pose (used in M08c2), `AiProfile` per kit.
- Roster: `content/fighter/roster.json` (`RosterEntry`, schema `packages/shared/src/fight/schema/roster.v1.schema.json`) binding the eight slots to original dev souls under `content/npcs/fighters-dev/` (compiled by `tools/soul`), with `expectedTier`, `standIn`, gray-box `assets`, `homeStage` and `v1: true`; one slot bound to the `fictionalized` canary so the tier path runs; loader in `packages/modes/fighter/src/sim/roster.ts` that reads the tier from `CompiledSoulPublic`.
- `config/fame-domains.json` (domain → forbidden keywords; forbidden fighter × stage tags such as `arena_court`); `fighter:lint` fame-domain rule on `MoveDef.tags`, `nameKey` text and prop ids against the slot soul's `fameDomain`.
- `likeness:gate` extension (FX4.1): roster `expectedTier` equals the compiled soul's tier; a stand-in is present for every tier other than `original`; a `parody` soul's `fameDomain` matches no kit or stage tag.
- `fighter:balance` (FC11): CPU vs CPU for every pair and both sides, worker threads, seeded; writes `balance/<build>.json` (win matrix, mean length, KO/time-out split, Check/Clear/Shutdown rates).
- Root script `check:fighter` (FX11): kit and stage schemas, `fighter:lint`, roster completeness (model, clips, portrait and stand-in resolve for all six tiers through `VARIANT_FALLBACK`), tier and fame-domain gates, golden replays, a 28-pair × 100-bout balance smoke.
- Trash talk: authored pre- and post-fight lines per archetype pair class in `content/fighter/talk.json`, shown as subtitles.
- Golden `vs-003.dvfight` (drones, arcs, sine projectile, armor, summon).

## Scope out
- Stages 2–6, cutscene refs and composed intros, Cinematic presentation of Showstopper and Shutdown, Arcade ladder and roster unlocks, kill-switch remap, Move Gallery, accessibility pass: M08b2.
- Real-person-derived souls and their assets: Q-19 and Q-25 (M10a1–M10c). Generated models and signature clips: M10a1–M10a2 under the DL-OWN-01 characters line; art-lead clips: Q-24 (library and procedural clips until then).
- Ink and LLM trash talk through route 31: M10c. Online play: FC12, post-M12b.

## Deliverables
- The nine kit files above; `content/fighter/ai/habits.json`; `content/fighter/roster.json`; `content/fighter/talk.json`; `content/npcs/fighters-dev/<slot>/soul.md` (eight originals) and their compiled outputs.
- `packages/shared/src/fight/{projectiles.ts, gimmicks.ts}`; `packages/shared/src/fight/schema/{roster.v1,stage.v1}.schema.json`; `packages/shared/test/fight/{projectile-behaviours.spec.ts, gimmicks.spec.ts}`.
- `packages/modes/fighter/src/sim/{roster.ts, cpu/habits.ts, cpu/candidates.ts}`; `packages/modes/fighter/scripts/balance.ts`; package script **`fighter:balance`**.
- `packages/modes/fighter/test/{kits.spec.ts, fame.spec.ts, roster.spec.ts, cpu.levels.spec.ts}`; fixtures `test/fixtures/{kits/fame-*.json, roster/*.json}`.
- `config/fame-domains.json`; `config/ip-denylist.json` additions for the FX2 research names.
- `tools/ci/likeness-gate/roster.ts` (extension) and `tools/ci/test/likeness-roster.spec.ts`.
- Root script **`check:fighter`** (`tsx tools/ci/run.ts check-fighter`) and `tools/ci/check-fighter.ts`; `ci.yml` `content` job step.
- `packages/modes/fighter/golden/vs-003.dvfight`; gray-box fighter assets (models `character/graybox.<slug>`) and provenance for the eight slots.

## Interfaces
- Reads C10 1.0 `CompiledSoulPublic` (`tier`, `fameDomain`, `standIn`) and C07 1.1 likeness blocks; never stores a tier in fighter data except `expectedTier`, which CI compares. S07-owned `RosterEntry`, `StageDef` and kit shapes as in FX1, FX2, FX5. No contract change.

## Acceptance criteria
- AC-1 Given the branch When typecheck, lint and build run Then all exit 0 — proof: `pnpm typecheck && pnpm lint && pnpm build`
- AC-2 Given the eight kits When `fighter:balance` runs 1,000 bouts for each of the 28 pairs on both sides Then every pair's win rate is within 35–65 % and `balance/<build>.json` lists mean match length and the KO/time-out split — proof: `pnpm --filter @dv/mode-fighter fighter:balance -- --bouts 1000`
- AC-3 Given the committed kits and fixtures `fame-basketball.json` (an `ath_shooter` move tagged `dunk`) and `fame-rap.json` (a rap move named with `mic`) When `fighter:lint` and the fame tests run Then the committed kits pass and each fixture fails with the fame-domain rule — proof: `pnpm --filter @dv/mode-fighter fighter:lint && pnpm --filter @dv/mode-fighter test -- fame`
- AC-4 Given roster fixtures with an `expectedTier` that differs from the compiled soul, a `parody` entry without `standIn`, and a `parody` soul with `fameDomain: 'basketball'` whose `homeStage` carries tag `arena_court` When the likeness gate runs Then each fixture is reported and the committed roster passes — proof: `pnpm likeness:gate && pnpm check:unit -- tools/ci`
- AC-5 Given the repository When the fighter content gate runs Then schemas, lint, roster completeness for all six tiers, tier and fame gates, the three golden replays and the 28 × 100 smoke all pass — proof: `pnpm check:fighter`
- AC-6 Given gimmick and projectile fixtures When simulated Then Frenzy runs 360 frames once per round with walk +25 % and normals −2 startup (minimum 3), `string` allows at most 2 cancels per touch, `pulse` keeps at most 2 traps for 360 frames, `agents` keeps at most 2 drones, Arc Shot deals 600/900/1,300 by hold level, `armor` absorbs one hit on forward specials, `poll` cycles every 600 frames in stream order, and equal-power projectiles destroy each other — proof: `pnpm check:unit -- packages/shared/test/fight && pnpm --filter @dv/mode-fighter test -- kits`
- AC-7 Given 200 mirrored bouts per pair of levels When the CPU plays itself Then Hard beats Easy at least 70 % of the time, Brutal shows execution error 0 and Easy 20 % ± 3 %, habit variety per level is 3/5/8/12, and every CPU action is a `FighterInput` sequence — proof: `pnpm --filter @dv/mode-fighter test -- cpu.levels`
- AC-8 Given the dev souls When the soul tools and the roster loader run Then all eight souls lint and compile, each roster entry's tier comes from its compiled soul, and the canary slot loads as `fictionalized` with its stand-in — proof: `pnpm npc:lint && pnpm --filter @dv/mode-fighter test -- roster`
- AC-9 Given the shipped names When the IP gates run Then no move, kit or fighter name matches a denylisted term, including the replaced research names of FX2 — proof: `pnpm names:lint && pnpm ip:strings && pnpm provenance:check`
- AC-10 Given the branch When the cross-browser hash suite, the unit suite and the preview deploy run Then all pass — proof: `pnpm check:e2e -- --project=webkit-webgl2 --grep @fighter-hash && pnpm check:unit && pnpm deploy:preview`

## Test plan
- **Unit:** `fight/projectile-behaviours`, `fight/gimmicks`, `fighter/kits`, `fighter/fame`, `fighter/roster`, `fighter/cpu.levels`; `tools/ci/likeness-roster`.
- **Content gate:** `check:fighter` (in `ci.yml` `content`); balance 1,000-bout run as this milestone's gate, 100-bout smoke on every PR.
- **State hash:** `@fighter-hash` includes `vs-003`.

## Demo script
1. `pnpm check:fighter`: every step green.
2. `pnpm --filter @dv/mode-fighter fighter:balance -- --bouts 100`: the 8 × 8 win matrix prints.
3. `pnpm dev`, `/?unlockAll=1`, Versus: pick `TECH_VISIONARY` (drones) vs `ATH_POWER_BACK` (armor) at CPU Brutal.
4. Tag a scratch move `dunk` in `ath_shooter.json` and run `pnpm check:fighter`: the fame-domain rule fails.

## Effort
1 Builder session; about 38 files (eight kit JSONs as one data task); risk **medium**. Balancing eight kits to 35–65 % is the time sink.

## Risks & fallbacks
- **Balance gate misses after two tuning passes:** tune health, damage and recovery only (never frame-data conventions); if a pair still fails, report it with the matrix and keep the gate red for that pair in the PR rather than widening it.
- **Balance runtime:** the 28 × 1,000 run uses worker threads; if it exceeds 45 minutes locally, run it in the nightly job and quote the artifact.
- **Fame-domain false positives** (a keyword inside an unrelated word): match whole words after normalisation; add the case as a fixture.
- **No real roster:** dev souls are `original` or the canary; real souls arrive only through `content-private/` (Q-25).

## Notes for the Builder
- Read first: `07-fighter-content.md` FX1–FX4, FX11; `07-fighter-core.md` FC9–FC11; `04-npc-contracts.md` B1–B3 (soul tiers, `fameDomain`, `standIn`); `05-assets-pipeline.md` §10 (likeness gates).
- Order: projectile behaviours and gimmicks → kits (one family at a time, lint after each) → CPU → roster and souls → gates → balance runner → `check:fighter` → tuning.
- A kit binds to a slot, never to a person; never write a real name, alias or catchphrase anywhere (R-IP-02).
- Secrets: none besides the CI deploy pair. No paid account, no fal.
