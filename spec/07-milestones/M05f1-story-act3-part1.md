# M05f1 — story-act3-part1

## Goal
After this session Act 3 "Exit Event" opens. Missions `m.a3.01` Board Games, `m.a3.02` Glass House and `m.a3.03` Great Highway exist as builder sources and compiled C09 IR. They come with lines, ink knots, four Act 3 cutscene refs with DirectorScript fallbacks (`boardroom`, `gala`, `server`, `speedtrap`), the `unlock.district.d7` def, and the racing hook for the Great Highway speed trap. The board vote is a talk chain, because S08 defines no board-vote preset in v1 (DL-157). Act 3 progress survives a reload. A killed character resolves to its stand-in, and a killed cutscene ref plays its fallback (the M10b kill path).

## Requirements
- R-MODE-01: three Act 3 missions with objectives, fail and success, rewards and heat policy; story progress persists in `StorySlice`.
- R-CUT-02: four story-beat refs, each with an in-engine fallback; in v1 they stay in-engine (DL-173).

## Depends on
- **M05e2** (Act 2 complete, `StorySlice.act = 3`, `act2_complete`, the `act2` econ section). **M10b** (kill-switch drill, index purge, `RosterFlags` kill path exercised end to end).
- Also used: M05a1 and M05a2 (compiler, VM, autoplayer, `check:missions`), M05b2 (refs, index builder, `CutscenePlayer` fallback), M07b1 (race content `sf.speedtrap.great-highway-night`), M05e1 (`check:missions -- --hooks`).
- Contracts: C09 1.0.0, C06 1.1.0, C05 1.1.0, C10 1.0.0, C12 1.1.0 (`RosterFlags`, read only), C16 1.1.0.

## Scope in
- **Sources** follow the directory convention M05e1 used. Graph: `m.a3.01` needs `m.a2.08`; `m.a3.02` and `m.a3.03` need `m.a3.01`. M05f2 needs both `m.a3.02` and `m.a3.03`.
- **Missions** (`03-story-narrative.md` §B6, DL-157):

| id · district · giver | Stages (objective kinds) | Heat | Hook / unlocks | Refs | Reward |
|---|---|---|---|---|---|
| `m.a3.01` Board Games · D5 FiDi · phone `whitney_arlo` | goto the Fog Index tower lobby → talk `whitney_arlo` (outcomes `confront` / `bargain`; `bargain` is gated on `trust ≥ 20`) → talk a fictional board member (`original` soul; outcomes `abstain` / `oppose`; sets flag `board_split`) → boardroom beat → goto the street | 0/0 | — | `cut.story.m.a3.01.boardroom` (beat) | $5,000 · clout 50 |
| `m.a3.02` Glass House · D7 Pacific Heights · phone `patch` | clock lock 20:00, clear → goto the gala entrance → talk the door host (`charm` / `invite` / `refuse`) → stealth through the house (detect budget 3) → photo the server map (`maxDistM` 15) → escape on foot to the street | 0/1 | on pass `unlock.district.d7` | `cut.story.m.a3.02.gala` (establish), `cut.story.m.a3.02.server` (beat) | $7,000 · clout 40 |
| `m.a3.03` Great Highway · D8 · phone `tavi_okafor` | goto the Sloat start → **mode** racing hook `race.a3.great-highway` (`defId: 'sf.speedtrap.great-highway-night'`, no params, `passOn: ['win','lose']`). Stub: drive through 6 camera zones in order within 150 s × `timerScale` → speedtrap beat | 0/0 | — | `cut.story.m.a3.03.speedtrap` (beat) | $6,000 · cred 50 |

  These three missions pay $18,000, inside the M05f1 target of $15,000–$25,000; M05f2 checks the act total. `expectedSec` is set as in M05e1 (from a first 3-seed run, [⌊0.6 × fastest⌋, ⌈1.8 × slowest⌉]).
- **Cast.** Fictional only: `whitney_arlo`, `corwin_hale` (beat appearance), `dana_voss` (radio), `patch`, `tavi_okafor`, Curb Ops drivers (the race's rivals), one new board member and one gala door host (`original` souls with ink in `content/npcs/`). No roster slot appears, because pitching and board votes are excluded fame domains (`03-story-narrative.md` §B2).
- **Refs.** Four `CutsceneRef`s, `prefetch: 'onTrigger'`, fictional cast only, with templates per §D4 (`story.beat@1` and `story.establish@1`). Each has a DirectorScript with subtitles. The `server` beat's map shows no readable text (an in-engine overlay, like Act 1's "LOT 1" screen).
- **Kill path.** If `RosterFlags` kill `whitney_arlo` with scope `spawn`, the mission uses her `standIn`'s lines (§C5 item 4, §C7). If a ref's key is purged (M10b drill) or status `blocked` arrives, the fallback plays. Both are tested here against the Act 3 content.
- **Persistence.** Reloading mid-`m.a3.02` resumes from the last checkpoint, with the clock lock restored and `StorySlice.act` still 3.
- **Unlock def** `unlock.district.d7` goes into `config/unlocks.json`.

## Scope out
- `m.a3.04`–`06`, the finale, endings, credits roll and the Acts 2–3 econ band: M05f2.
- Generation of any clip, plates, and XR hosts (M11b4).
- Changes to the kill-switch itself (M10b). Real-roster content (Q-19, Q-25).

## Deliverables
- 3 mission folders (`mission.ts`, `lines.en.json`, `director/<beat>.ts` × the refs): 10 files.
- `content/npcs/{board_member_id,gala_door_host_id}/` (soul, ink): 4 files, ids chosen by the Builder per C10 `NpcId`. Ink knots added to `content/npcs/{whitney_arlo,patch,tavi_okafor}/*.ink`.
- `content/story/cast.json` rows; `config/unlocks.json`; `content/ui/i18n/en.json` keys.
- `packages/modes/story/test/act3.part1.test.ts` (graph, the reward sum, the kill-path stand-in, `bargain` gating, no slot in `m.a3.01`).
- `tests/e2e/story-act3.spec.ts` (`@story-act3`).
- About 24 files in all.

## Interfaces
- C09 1.0.0 only. The racing hook `defId` is an S06 `RaceId` (DL-092). No tycoon hook (DL-157).
- C12 1.1.0 `RosterFlags` is read as the VM already does (§C5 item 4). C06 1.1.0 `UnlockApi`, `WorldClockApi.lock`.
- No contract change.

## Acceptance criteria
- AC-1 Given the Act 3 sources When the mission compiler runs Then `m.a3.01`–`m.a3.03` validate with zero errors, every beat resolves to a ref with a fallback, and the board member and door host souls pass the soul lint with their mission knots — proof: `pnpm missions:build && pnpm npc:lint`
- AC-2 Given the release index When Act 3 autoplays on 3 seeds twice Then `m.a3.01`–`m.a3.03` pass inside `expectedSec` with equal end hashes per seed, and `unlock.district.d7` is recorded — proof: `pnpm check:missions -- --act 3`
- AC-3 Given all hooks forced to their stubs When Act 3 autoplays Then the three missions pass on 3 seeds — proof: `pnpm check:missions -- --act 3 --hooks stub`
- AC-4 Given the Act 3 part 1 content and the story unit tests, the following hold:
  - the three graph gates hold;
  - the reward sum is within $15,000–$25,000;
  - with `RosterFlags` killing `whitney_arlo` at scope `spawn`, `m.a3.01` spawns her stand-in and still passes headless on seed 1;
  - `bargain` is unavailable below trust 20;
  - a fixture that adds a roster slot to `m.a3.01` fails with `E_DEPICTION`;
  - the shipped text passes the name gate.
  — proof: `pnpm check:unit -- packages/modes/story/test/act3.part1.test.ts && pnpm names:lint`
- AC-5 Given a QA build at `?mission=m.a3.02&seed=1&talk=scripted&beats=video` with route 27 mocked to `blocked` for `gala` When the bot plays to the stealth stage, the page reloads and play resumes Then the `gala` beat plays its fallback within 2.5 s, the resume starts from the stealth checkpoint with the 20:00 clock lock, and the mission passes — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @story-act3`
- AC-6 Given the branch When the unit suite, Act 1 and Act 2 autoplay, the build and the preview deploy run Then all pass — proof: `pnpm check:unit && pnpm check:missions -- --act 1 && pnpm check:missions -- --act 2 && pnpm build && pnpm deploy:preview`

## Test plan
- **Unit:** `act3.part1` (command: `pnpm check:unit -- packages/modes/story`).
- **Bot runs:** `pnpm check:missions -- --act 3` (also with `--hooks stub`); Acts 1 and 2 for regression.
- **E2E:** `@story-act3` on `chromium-webgl2`; `@story`, `@story-act2` and M10b's `@kill-drill` stay green.
- **Content:** `pnpm missions:build`, `pnpm npc:lint`, `pnpm names:lint`, `pnpm likeness:gate`.

## Demo script
1. `pnpm check:missions -- --mission m.a3.03` shows the speed-trap result.
2. `pnpm dev`, open `/?mission=m.a3.02&hooks=stub&beats=fallback`, toggle *bot plays*, and watch the gala stealth and the server-map photo.
3. In the QA overlay, force-fail the stealth stage; *Retry* resumes at the checkpoint with the clock still locked.

## Effort
1 Builder session; about 24 files; risk **medium**. Three missions plus two new souls is lighter than M05e1. The time goes into stealth tuning on the gala map against the autoplayer's `autoplayPath`.

## Risks & fallbacks
- **Speed-trap race missing** (M07b1 content): the stub path runs, AC-3 stays green, and AC-2 is reported as blocked on M07b1.
- **Stealth in a dense interior.** If the autoplayer's `autoplayPath` cannot stay under the detect budget on all 3 seeds, widen the authored path through the service corridor. Never raise the budget above 3; it is a design value from the Act 1 table.
- **Route 27 mock in e2e:** use the M05b2 `@cutscene` mocking helper. If it cannot return `blocked`, use `absent`; both are fallback triggers (§D7).
- **Overrun:** the reload case in AC-5 is the cut line; the fallback assertion stays.

## Notes for the Builder
- Read first: `03-story-narrative.md` §B2–§B3, §B6; `03-story-missions.md` §C3, §C5–§C9, §C11; `03-story-cutscenes.md` §D4, §D7; DL-157, DL-173.
- **Gates.** Deploy secrets only (SKIP and exit 0 when absent). Q-21 does not apply here (D5, D7 and D8). Q-19 and Q-25 do not apply (no slots).
- **fal.** None. `FAL_MODE=mock`; Act 3 refs are fallback-only in v1 (DL-OWN-01).
- Names of the new fictional souls go through `names:lint` and must not echo a real investor, executive or venue.
- Branch `m05f1-story-act3-part1`.
