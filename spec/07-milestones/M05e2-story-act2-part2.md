# M05e2 — story-act2-part2

## Goal
After this session Act 2 "Due Diligence" is complete and leads into Act 3. Missions `m.a2.06` Cable Pull, `m.a2.07` Pier Pressure and `m.a2.08` Showcase exist as builder sources and compiled C09 IR, with lines, ink knots and DirectorScript fallbacks for the three refs (`cablecar`, `ledger`, `crossing`). The Alcatraz exhibition bout starts S07's `bout.a11`. Passing `m.a2.08` sets `StorySlice.act = 3` and grants `unlock.fighter.ath_power_back`. Districts `d5` and `d6` unlock. The economy harness gains an `act2` section: Act 2 mission rewards plus story-business income and purchases, checked against bands in `config/econ-bands.json`.

## Requirements
- R-MODE-01: the second half of Act 2 (missions, the act transition, the property-income balance through econ-sim).
- R-CUT-02: three story-beat refs, each with an in-engine fallback; none is generated in v1 (DL-173).

## Depends on
- **M05e1** (Act 2 missions 02–05, story businesses, `check:missions -- --hooks`).
- Also used: M08b2 (`bout.a11` at `alcatraz_yard`, fighter story hook), M04d (`tools/ci/econ-sim`, `check:balance -- --suite econ`, `config/econ-bands.json`), M05c1 (Act 1 econ section, cast slots and stand-ins), M06a2 (`npc:lint`).
- Contracts: C09 1.0.0, C06 1.1.0 (`EconomyApi`, `UnlockApi`, `startChild`), C05 1.1.0 (`StorySlice.act`), C10 1.0.0 (talk), C16 1.1.0.

## Scope in
- **Sources** go in the same directory convention M05e1 used. Graph: `m.a2.06` needs `m.a2.05`; `m.a2.07` needs `m.a2.06` and `m.a2.02`; `m.a2.08` needs `m.a2.07`.
- **Missions** (`03-story-narrative.md` §B6, DL-157):

| id · district · giver | Stages (objective kinds) | Heat | Hook / unlocks | Ref | Reward |
|---|---|---|---|---|---|
| `m.a2.06` Cable Pull · D6 Chinatown / North Beach · phone `saint_static` | talk `RAP_LYRICIST` (slot; role `mentor`; lawful café stage; outcomes `listen` / `ask_history`) → follow a fictional courier along the Powell–Mason cable-car line (band 10–60 m, lose 20 s) → photo the hand-off at Coit Tower (`maxDistM` 40) | 0/0 | on pass `unlock.district.d6` | `cut.story.m.a2.06.cablecar` (establish) | $4,500 · cred 30 |
| `m.a2.07` Pier Pressure · D5 Embarcadero · phone `patch` | talk chain at the Ferry Building (`whitney_arlo`, then a fictional Fog Index associate; flag `ledger_location`) → stealth into the pier office (detect budget 2) → photo the ledger → escape at scripted heat 3 → goto the Yard | 0/3 (`heat set 3` on the photo) | on pass `unlock.district.d5` | `cut.story.m.a2.07.ledger` (beat) | $6,000 · clout 40 |
| `m.a2.08` Showcase · Alcatraz stage · phone `saint_static` | goto Pier 33 → boat crossing beat → **mode** fighter hook `fight.a2.showcase` (`defId: 'bout.a11'`, `params: {kind: 'story'}`, `passOn: ['win','lose']`; the `BoutDef` sets `ATH_POWER_BACK`, `alcatraz_yard` and CPU Hard). Stub: defeat `chorus_sparrer` in a non-lethal exhibition → in-engine outro: the Fog Index double play is exposed (flag `act2_complete`) | 0/0 | on pass `unlock.fighter.ath_power_back`; `StorySlice.act = 3` | `cut.story.m.a2.08.crossing` (establish) | $5,500 (+$1,000 on a win, paid through the fighter `EconomyApi` key) · cred 40 |

  These three missions pay $16,000 plus $1,000 on a win, inside the M05e2 target of $14,000–$22,000.
- **Depiction (§C11 rule 1).** `RAP_LYRICIST` appears only in the lawful café stage, never performs music (fame-domain rule) and is despawned before `follow` starts. `ATH_POWER_BACK` appears only as the opponent inside the fighter hook, never in a sports context. `alcatraz_yard` is dressed in museum state (`07-fighter-content.md` FX4.6). Slots resolve through `content/story/cast.json` to the roster soul, or to the soul's `standIn` when the roster is absent (Q-19, Q-25) or killed (§C5 item 4).
- **Ink.** Mission knots go into the stand-ins' and fictional NPCs' inks under `content/npcs/` so ink alone completes every mission. Real-derived inks in `content-private/` are M10c's and are not edited here.
- **Refs.** Three `CutsceneRef`s, `prefetch: 'onTrigger'`, fictional cast only (none of these refs puts a slot on screen). The boat crossing establish shot uses `story.establish@1`. Each ref has a DirectorScript fallback with subtitles.
- **Unlock defs** `unlock.district.d5` and `unlock.district.d6` go into `config/unlocks.json`. `unlock.fighter.ath_power_back` is S07's def (M08b2) and is only emitted here.
- **Act transition.** When `m.a2.08` passes, the VM sets `StorySlice.act = 3` and flag `act2_complete`, and `ctx.save.request('missionPass')` runs. The Jobs app lists Act 3 entries once M05f1 adds them.
- **Econ-sim Act 2 section** (`13-qa.md` §3.9):
  - Add section `act2` to `tools/ci/econ-sim`. Income: rewards of `m.a2.01`–`08` read from the compiled IR, including the win bonuses at the autoplayer's observed rates, plus weekly business profit over 26 story-weeks for each purchase pattern (none, one, all three). Sinks: business prices from `content/story/businesses.json` and the Act 2 shop and safehouse prices.
  - Bands in `config/econ-bands.json`: `act2.missionRewards` $30,000–$50,000 (cents); `act2.businessPaybackWeeks` 8–40 for each business; `act2.cashAtActEnd` p10 ≥ $0 over 2,000 runs.
  - Add one self-test fixture per band (deliberately out of band) that must exit non-zero.

## Scope out
- Act 3 (M05f1, M05f2) and the combined Acts 2–3 band of $70k–$110k (M05f2).
- Generation of any clip (DL-173), plates, and XR presentation (M11b4).
- Real-roster ink and voices (M10c, Q-20). A sensitivity read is not required: no Act 2 part 2 mission is in D3 or D4.
- Business mechanics changes (M05e1 owns them). Only their numbers may be re-tuned to meet the bands, as data edits.

## Deliverables
- 3 mission folders (`mission.ts`, `lines.en.json`, `director/<beat>.ts`): 9 files.
- Ink knots in `content/npcs/{saint_static,patch,whitney_arlo}/*.ink` and in the `RAP_LYRICIST` stand-in's ink, plus the fictional associate's soul and ink (`content/npcs/<id>/`, `original` basis): 6 files.
- `content/story/cast.json` rows; `config/unlocks.json` (2 defs); `content/ui/i18n/en.json` keys.
- `tools/ci/econ-sim/sections/act2.ts`, `config/econ-bands.json` (act2 bands), `tools/ci/econ-sim/fixtures/act2-*.json` (3 self-tests).
- `packages/modes/story/test/act2.part2.test.ts`; `tests/e2e/story-act2.spec.ts` (adds a `@story-act2-end` case).
- About 26 files in all.

## Interfaces
- C09 1.0.0 only. The fighter hook is `{mode: 'fighter', defId: 'bout.a11', params: {kind: 'story'}}` (S07 `FighterEnterParams`; DL-092, DL-157).
- C06 1.1.0 `EconomyApi`: the win bonus belongs to the child mode, and the mission never pays it twice (§C8 item 4).
- C05 1.1.0 `StorySlice.act` and `flags`, with no shape change.

## Acceptance criteria
- AC-1 Given the Act 2 sources When the mission compiler runs Then `m.a2.06`–`m.a2.08` validate with zero errors, every beat has a fallback, and the index lists all eight Act 2 missions — proof: `pnpm missions:build`
- AC-2 Given the release index When Act 2 autoplays on 3 seeds twice Then `m.a2.01`–`m.a2.08` pass inside `expectedSec` with equal end hashes per seed, and after `m.a2.08` `StorySlice.act` is 3, flag `act2_complete` is true, and `CoreSlice.unlocks` contains `unlock.district.d5`, `unlock.district.d6` and `unlock.fighter.ath_power_back` — proof: `pnpm check:missions -- --act 2`
- AC-3 Given all hooks forced to their stubs When Act 2 autoplays Then all eight missions pass on 3 seeds and `unlock.fighter.ath_power_back` is still recorded through the stub path — proof: `pnpm check:missions -- --act 2 --hooks stub`
- AC-4 Given the depiction fixtures When the story unit tests run Then a fixture keeping `RAP_LYRICIST` spawned into the `follow` stage fails with `E_DEPICTION`, a fixture that gives the athlete slot a sports-context stage fails, and the shipped missions pass. The shipped text passes the name gate and every edited ink compiles with its mission knots — proof: `pnpm check:unit -- packages/modes/story/test/act2.part2.test.ts && pnpm names:lint && pnpm npc:lint && pnpm likeness:gate`
- AC-5 Given the economy harness When the econ suite runs Then section `act2` reports mission rewards inside $30,000–$50,000, every business payback inside 8–40 weeks, and p10 cash at act end ≥ 0 over 2,000 runs, while each of the three `act2-*` self-test fixtures makes the suite exit non-zero — proof: `pnpm check:balance -- --suite econ`
- AC-6 Given a QA build at `?mission=m.a2.08&seed=2&hooks=stub&talk=scripted&beats=fallback` When the in-browser bot plays it and the page then reloads Then the story resumes from `story:auto` with act 3, the fighter unlock toast was shown once, and it is not shown again after the reload — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @story-act2-end`
- AC-7 Given the branch When the unit suite, the build and the preview deploy run Then all pass and Act 1 still autoplays green — proof: `pnpm check:unit && pnpm check:missions -- --act 1 && pnpm build && pnpm deploy:preview`

## Test plan
- **Unit:** `act2.part2` (graph, the reward sum in $14k–$22k, depiction fixtures, act transition). Command: `pnpm check:unit -- packages/modes/story`.
- **Bot runs:** `pnpm check:missions -- --act 2` (also with `--hooks stub`) and `--act 1` for regression.
- **Balance:** `pnpm check:balance -- --suite econ`. The tycoon suite (M09a2) must stay green under plain `pnpm check:balance`.
- **E2E:** `@story-act2-end` on `chromium-webgl2`; `@story-act2` and `@story` stay green.

## Demo script
1. `pnpm check:missions -- --mission m.a2.08` prints the bout result, the unlock and `act: 3`.
2. `pnpm check:balance -- --suite econ` prints the `act2` table with the bands.
3. `pnpm dev`, open `/?mission=m.a2.06&hooks=stub&beats=fallback`, and watch the café talk, the courier follow and the Coit Tower photo.

## Effort
1 Builder session; about 26 files; risk **medium**. The econ section and its band tuning are the main uncertainty; three missions is less authoring than M05e1.

## Risks & fallbacks
- **Bands fail on first run.** Re-tune data only (business prices, footfall, mission rewards inside the per-mission targets above). Never widen a band without a Builder decision that names the reason; the verifier lock (M04d) needs the `golden-update` label for band edits.
- **Fighter story hook unavailable** (M08b2 not merged, or `startChild` refused): the stub path runs. AC-3 stays green, and AC-2 is reported as blocked on M08b2.
- **Stand-in ink vs roster ink.** If `content-private/` is mounted (Q-25 resolved) and the real soul lacks the mission knot, the mission still has to complete. Fall back to the stand-in's knot for that talk and report it as a gap for M10c.
- **Overrun:** the e2e reload case (AC-6) is the cut line; the bot proofs stay.

## Notes for the Builder
- Read first: `03-story-narrative.md` §B2–§B3, §B6–§B7; `03-story-missions.md` §C5 item 4, §C7–§C9, §C11; `07-fighter-content.md` FX4.6, FX8.3; `13-qa.md` §3.9; DL-157, DL-173.
- **Gates.** Deploy secrets as in M05e1 (SKIP and exit 0 when absent). Q-19 and Q-25: CI uses stand-ins; nothing real-derived is committed outside `content-private/`. Q-21 does not apply (no D3/D4 mission here).
- **fal.** None. `FAL_MODE=mock`; Act 2 refs are in-engine only (DL-OWN-01, DL-173).
- Econ-sim money is integer cents; all section code is deterministic and seeded (`tools/ci` scripts are outside the C02 lint scope, but `canonical` runs must still match).
- Branch `m05e2-story-act2-part2`.
