# M05e1 — story-act2-part1

## Goal
After this session Act 2 "Due Diligence" plays past its opener. Missions `m.a2.02` Hill Climb, `m.a2.03` Jailbreak, `m.a2.04` Karl and `m.a2.05` Tower exist as builder sources and compiled C09 IR, with lines, ink knots, DirectorScript fallbacks for four refs, and `UnlockDef`s for `d8` and `d9`. The two racing hooks start S06 races and fall back to their stubs. Story businesses run the shared event engine through `EventHost<BusinessState>` (DL-133): three can be bought, each ticks once per story-week, and its events reach the phone as non-modal items. `m.a2.01` (M09b2) is unchanged; `m.a2.06`–`08` follow in M05e2.

## Requirements
- R-MODE-01: four more story missions, each with intro, objectives, fail and success, rewards and heat policy, plus a property income loop (businesses).
- R-MODE-05: `m.a2.02` and `m.a2.03` emit S06's unlocks on pass, both through the real hook path and through the stub path.
- R-CUT-02: four story-beat refs (`roadster`, `release`, `fogbank`, `broadcast`). Each has an in-engine fallback and none is generated in v1 (DL-173).

## Depends on
- **M05c2** (Act 1 slice, sensitivity gate, `@story` e2e harness, index). **M07a2** (racing mode, story hook path, `RacingSlice`). **M07b1** (the race kinds and events behind the hooks of `m.a2.02` and `m.a2.03`; DL-219). **M08b2** (fighter story hooks). **M09b2** (`m.a2.01`, `unlock.tycoon`, flag `coop_success`).
- Also used: M05a1 (`missions:build`, VM), M05a2 (`check:missions`, autoplayer, director), M05b2 (`CutsceneRef`, index builder), M04d (`check:balance`), M06a2 (`npc:lint`), M09a2 (event engine `packages/shared/src/events`, `both`-scope catalog), M04b2 (phone Bank app).
- Contracts: C09 1.0.0, C06 1.1.0, C05 1.2.0 (`StorySlice.property.businesses[].state`, DL-225), C10 1.0.0, C08 1.0.0, C02 1.1.0 (`ctrU32`), C16 1.1.0 (mission names).

## Scope in
- **Location of sources.** Mission sources live in `content/missions/<missionId>/` (`03-story-missions.md` §C1; M09b2 put `m.a2.01` there; DL-220). Act-level data (`cast.json`, `sensitivity.json`, `businesses.json`) stays in `content/story/`.
- **Mission graph** (authored gates, `requires`): `m.a2.02` and `m.a2.03` need `m.a2.01`; `m.a2.04` needs `m.a2.03`; `m.a2.05` needs `m.a2.04`. M05e2 continues from `m.a2.05` and `m.a2.02`.
- **Missions** (`03-story-narrative.md` §B6; hook ids and defIds from DL-157; every id is a `LocKey` or `LineId`):

| id · district · giver | Stages (objective kinds) | Heat start/max | Hook / unlocks | Ref | Reward |
|---|---|---|---|---|---|
| `m.a2.02` Hill Climb · D6 Russian Hill · phone `tavi_okafor` | goto the start at Filbert & Hyde → **mode** racing hook `race.a2.hill-climb` (`defId: 'sf.hillclimb.filbert-hyde'`, no params, `passOn: ['win','lose']`). Stub: goto the summit zone within 120 s × `timerScale` | 0/1 | on pass `unlock.racing.event.sf.hillclimb.filbert-hyde` | `cut.story.m.a2.02.roadster` (beat) | $4,000 · cred 30 |
| `m.a2.03` Jailbreak · D4 · phone `patch` · tags `jailbreak`, `sensitivity-read` | goto the Hayes Valley house → protect `patch` (min health 0.4) while **mode** racing hook `race.a2.robotaxi-rush` (`defId: 'sf.robotaxirush.soma-haight'`) runs. Stub: chase 3 locked robotaxis (catch 4 m, hold 2 s each, all within 300 s) | 0/2 | on pass `unlock.racing.robotaxi` | `cut.story.m.a2.03.release` (beat) | $4,500 · clout 40 |
| `m.a2.04` Karl · D8 Golden Gate Park / Ocean Beach · phone `patch` | clock lock 22:00 with `karl-fog` → follow the mapping van (band 15–90 m, lose after 25 s) → stealth to the data trailer (detect budget 3) → photo the trailer → goto the Great Highway exit | 0/1 | on pass `unlock.district.d8` | `cut.story.m.a2.04.fogbank` (establish) | $4,000 |
| `m.a2.05` Tower · D9 Twin Peaks · phone `saint_static` | goto the Chorus antenna → protect `antenna` (health ≥ 0.4) and survive 150 s against Halcyon drones (actor tasks; `defeat` is always `nonLethal`) → broadcast beat → goto | 0/0 | on pass `unlock.district.d9` | `cut.story.m.a2.05.broadcast` (beat) | $5,500 · cred 40 |

  Rewards total $18,000 (target $16,000–$24,000 toward the Acts 2–3 band of $70k–$110k, enforced by M05e2 and M05f2). `autoplay.expectedSec` = [⌊0.6 × fastest⌋, ⌈1.8 × slowest⌉] of a first 3-seed run, within the §C4 bounds; record the times in the PR.
- **Cast.** Fictional only (`tavi_okafor`, `patch`, `saint_static`, `dana_voss` on radio, the mapping van, drones, S06's `vehicle.solenne-skip`); no roster slot. `m.a2.03` is `jailbreak` and D4, so real-derived cast is forbidden there (§C11 rules 1, 4).
- **Talk and ink.** Each `talk` objective has `TalkDef.default`. Its knot `mission_m_a2_0N_<talkId>` is added to that NPC's ink (`content/npcs/<id>/<id>.ink`), so ink alone completes every mission (§C7 item 3).
- **Cutscene refs.** Four `CutsceneRef`s use the `story.beat@1` and `story.establish@1` templates (§D4), with `prefetch: 'onTrigger'` and fictional cast only. Each has a DirectorScript fallback (`director/<beat>.ts`) with subtitles. They enter the cutscene index as refs and are not prewarmed (DL-173 keeps Acts 2–3 in-engine).
- **Unlock defs.** `unlock.district.d8` and `unlock.district.d9` go into `config/unlocks.json` (`source: 'base'`, grants `districts`). The racing unlocks are S06's (M07b1) and are not redeclared.
- **`check:missions -- --hooks stub|bot`.** Add a flag to the M05a2 runner that forces every hook to its stub (`stub`) or to the child mode's bot (`bot`). The default stays as §C9 defines it. If the mode cannot start the hook (for example an unknown `defId`), `startChild` returns false and the stub path runs (§C8 item 1).
- **Story businesses (DL-133, `08-tycoon-events.md` §7):**
  - `BusinessState` (story-local, not a contract: `id`, `level`, `week`, `tillCents`, `footfall`, `reputation`, `morale`, modifiers, `EventState`) behind `EventHost<BusinessState>` with the §7 metric mapping; `hype`, `techDebt`, `climate`, `multipleMul`, `wageMul`, staff, cap-table and `round` effects are no-ops.
  - Weekly tick every 1,209,600 game half-seconds, seed `StorySlice.world.seed ^ fnv32(businessId)`, defs with `scope` `business` or `both` only.
  - Weekly profit = footfall × ticket × `arpuMul` − base cost × `burnMul`, paid via `EconomyApi` (key `biz:<id>:<week>`), capped at $2,000 per business-week; 0 while `officeClosed`.
  - Data: `content/story/businesses.json` defines `biz.taqueria`, `biz.record_shop` and `biz.coworking` (price, footfall, ticket, base cost, a C08 POI anchor `poi.<nhood>.<name>` that `missions:build` resolves, `LocKey`); design values checked by M05e2's econ section. Buying happens in the phone Bank app's Businesses section after `m.a2.01`.
  - Events: view model `phone.businesses` (inbox with choices) plus an `info` toast; never a pause or modal. A choice returns as `mode.cmd` `{mode: 'story', name: 'biz.choose', args: {businessId, iid, choiceId}}`; past the 2-week deadline it auto-resolves.
  - **Persistence (C05 1.2, DL-225).** `property.businesses[]` keeps `{id, level, state}`; `state` is the business's canonical JSON, at most 2,048 bytes. Update `c05-save.ts` to the 1.2 shape of `01-engine-save-modes.md` "C05 1.2 addition" (`C05_VERSION = '1.2.0'`), let `story.v1.schema.json` accept the optional member, and refresh the story golden through the `golden-update` procedure. Mission predicates never read business state.

## Scope out
- `m.a2.06`–`08`, the Act 2 econ section and the act transition: M05e2. Act 3: M05f1, M05f2.
- `m.a2.01` and the tycoon hook (M09b2). LLM talk is M06a3's runtime and is not changed here.
- Generation of any Act 2 clip (DL-173), plates for Act 2 refs, and XR cutscene presentation (M11b4).
- Business upgrades beyond `level` 1–3, staff and hiring, and a world-side blackout (Premise B).
- Real-roster souls (Q-19, Q-25). Any public release of `m.a2.03` before a recorded sensitivity read (Q-21).

## Deliverables
- 4 mission folders (`mission.ts`, `lines.en.json`, `director/<beat>.ts`): 12 files.
- Ink knots added to `content/npcs/{tavi_okafor,patch,saint_static}/*.ink` (3 edits). `content/story/cast.json` and `content/story/sensitivity.json` rows (`m.a2.03` tagged, read pending). `content/story/businesses.json`. `config/unlocks.json` (2 defs).
- `packages/modes/story/src/business/{state.ts, host.ts, weekly.ts, persist.ts, vm.ts}` and the `biz.choose` command handler; `packages/shared/src/contracts/c05-save.ts` (1.2 member and version) and `packages/engine/src/sim/save/schema/story.v1.schema.json` (optional `state`). The Bank Businesses section is a small view in `packages/ui/src/phone/` on the M04b2 kit.
- `tools/ci/check-missions.ts` gains `--hooks`.
- Tests:
  - `packages/modes/story/test/{business.host.test.ts, business.persist.test.ts, act2.part1.test.ts}`;
  - `tests/e2e/story-act2.spec.ts` (`@story-act2`).
- `content/ui/i18n/en.json` keys for titles, objectives, business names and events.
- About 32 files in all.

## Interfaces
- C09 1.0.0 exactly. The missions use only §C3 ops and predicates. `ModeHook.defId` values are S06 `RaceId`s with no `params` (DL-092, DL-157).
- C06 1.1.0: `startChild`, `UnlockApi`, `EconomyApi`, `WorldClockApi`, `UiBridge.patch('phone.businesses', …)`, `UiCommand` `mode.cmd`.
- C05 1.2.0: the additive `StorySlice.property.businesses[].state?` (DL-225) is written here first; every 1.1 record still loads.
- `EventHost<S>`/`EventEngine<S>` come from `packages/shared/src/events/types.ts` (M09a2) and are imported, not copied.

## Acceptance criteria
- AC-1 Given the Act 2 sources When the mission compiler runs Then `m.a2.02`–`m.a2.05` validate with zero errors, each `BeatRef` resolves to a ref with a DirectorScript fallback (no `E_NO_FALLBACK`), and `data/mission.m.a2.0N` and `data/story.index` are emitted — proof: `pnpm missions:build`
- AC-2 Given the release index When the autoplayer runs Act 2 on its 3 seeds twice under `canonical` Then `m.a2.01`–`m.a2.05` pass inside their `expectedSec`, both runs of each seed end with the same `stateHash`, and `CoreSlice.unlocks` gains `unlock.racing.event.sf.hillclimb.filbert-hyde`, `unlock.racing.robotaxi`, `unlock.district.d8` and `unlock.district.d9` — proof: `pnpm check:missions -- --act 2`
- AC-3 Given every hook forced to its stub When Act 2 autoplays Then all five missions still pass on 3 seeds and the same four unlocks are recorded — proof: `pnpm check:missions -- --act 2 --hooks stub`
- AC-4 Given the depiction, name and ink rules When the lint fixtures and content checks run Then a fixture that adds a roster slot to `m.a2.03` fails with `E_DEPICTION`, a D4 fixture without `sensitivity-read` fails, and the shipped Act 2 text passes `names:lint` and ink compilation — proof: `pnpm check:unit -- packages/modes/story/test/act2.part1.test.ts && pnpm names:lint && pnpm npc:lint`
- AC-5 Given a fixture business host and the `both`-scope catalog When 1,000 seeded business-years run twice Then the event logs and final states are identical, no `tycoon`-scope def fires, the no-op effects leave the state unchanged, weekly payouts never exceed 200,000 cents, `officeClosed` weeks pay 0, and replaying from `(seed, choices)` equals the live run — proof: `pnpm check:unit -- packages/modes/story/test/business.host.test.ts`
- AC-6 Given a bought business with an open inbox item When the state is persisted and restored Then `StorySlice.property.businesses[i].state` is ≤ 2,048 bytes of canonical JSON, the restore round-trips byte-identically, an event emits `phone.businesses` and an `info` toast but no `pause` or `openApp` command, and an item past its 2-week deadline auto-resolves with `defaultChoiceId` — proof: `pnpm check:unit -- packages/modes/story/test/business.persist.test.ts`
- AC-7 Given a QA build at `?mission=m.a2.04&seed=1&hooks=stub&talk=scripted&beats=fallback` When the in-browser bot plays the mission Then it reaches `passed`, the `fogbank` beat reports `cutscene.state` `fallback` and then `done`, subtitles were shown, and the unlock toast for `unlock.district.d8` appears — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @story-act2`
- AC-8 Given the branch When typecheck, lint, the unit suite, the build and the preview deploy run Then all pass and the deployed app still boots to the title — proof: `pnpm typecheck && pnpm lint && pnpm check:unit && pnpm build && pnpm deploy:preview`

## Test plan
- **Unit:** `act2.part1` (gates, reward sum, lint fixtures), `business.host`, `business.persist` (`pnpm check:unit -- packages/modes/story`).
- **Bot runs:** `--act 2` with and without `--hooks stub`; `--act 1` stays green.
- **E2E:** `@story-act2` (`chromium-webgl2`); M05c2's `@story` (`webkit-webgl2`) as regression.
- **Content:** `missions:build`, `names:lint`, `npc:lint`, `likeness:gate`. No device test.

## Demo script
1. `pnpm missions:build && pnpm check:missions -- --mission m.a2.02` prints the race result and the unlock.
2. `pnpm dev`, open `/?mission=m.a2.05&hooks=stub&beats=fallback`, toggle *bot plays* in the overlay, and watch the drone defence and the broadcast fallback beat.
3. Give QA cash, buy the taqueria in Bank › Businesses, skip four weeks with the overlay clock, and see the inbox item and the payout.

## Effort
1 Builder session; about 32 files; risk **medium** (mission tuning against the autoplayer, then the business host).

## Risks & fallbacks
- **Race defs missing.** The two races are M07b1 content (run order #51, not a listed dependency). If absent, `startChild` returns false and the stub runs; AC-2 then fails only on its unlock line: report "Blocked on M07b1", keep AC-3 green.
- **Phone surface.** Feed and Messages are `comingSoon` (M04b2), so items go to Bank › Businesses (DL-238; `08-tycoon-events.md` §7 amended).
- **Flag size.** If one business exceeds 2 KiB, trim `EventState.counts` to the keys the validator needs and cap `active` at 8 effects.
- **Overrun.** Missions and AC-1–AC-4 first; business persistence and UI (AC-6) are the cut line, the host (AC-5) stays.

## Notes for the Builder
- Read first: `03-story-narrative.md` §B3, §B6–§B7; `03-story-missions.md` §C2–§C9, §C11; `03-story-cutscenes.md` §D4, §D6, §D9.1; `08-tycoon-events.md` §2–§5, §7; DL-133, DL-157, DL-173.
- **Gates.** No code secrets; `deploy:preview` needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (SKIP and exit 0 without them). Q-21: `m.a2.03` stays out of any production release until `content/story/sensitivity.json` records a read for its version (M05c2 gate). Q-19/Q-25: no roster slots here.
- **fal.** No spend. CI runs `FAL_MODE=mock`; Acts 2–3 refs are fallback-only (DL-OWN-01, DL-173). Never run `assets:gen` with `--live` for these refs.
- **Determinism.** Business rolls use `ctrU32` streams `ev:<id>` and so on. Wall time is never read, and `weekly.ts` lives under the story mode's sim path, so the C02 lint applies.
- Branch `m05e1-story-act2-part1`.
