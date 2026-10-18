# M05f2 — story-act3-finale

## Goal
After this session the campaign *Hella Valuation* can be finished. Missions `m.a3.04` Chorus Final, `m.a3.05` The Hearing and `m.a3.06` Exit Event exist as compiled C09 IR, with lines, ink knots and six refs, each with a DirectorScript fallback (`arena`, `vote`, `bridge`, `dawn`, `ending.coop`, `ending.yard`). The finale runs a scripted heat-6 pursuit along the Embarcadero onto the Bay Bridge west span to Yerba Buena Island. The world portal stays sealed behind the player (the M15 hook). The ending is chosen by flag `coop_success`, and a credits roll follows. After the credits the player is back in free roam with `story_complete` set. The economy harness gains an `act3` section and the combined Acts 2–3 band of $70k–$110k (`03-story-narrative.md` §B6).

## Requirements
- R-MODE-01: the finale, two endings, the end-of-story state and free roam after it; the economy band for Acts 2–3.
- R-CUT-02: six refs covering story beats and endings.
- R-CUT-03: every finale and ending beat has an in-engine fallback with subtitles, so the story completes with zero generated clips.

## Depends on
- **M05f1** (Act 3 missions 01–03, `unlock.district.d7`).
- Also used: M08b2 (`bout.a3-final` at `mission_bay_court`, story hook), M03c (`PursuitApi` heat 6 and `portalSeal`), M05e2 (`act2` econ section, `check:balance` bands), M04b1 and M00 (credits page), M05c2 (`@story` harness).
- Contracts: C09 1.0.0, C06 1.1.0 (`PursuitApi`, `UnlockApi`, `UiBridge`), C05 1.1.0, C10 1.0.0, C08 1.0.0 (portals, landmarks `lm.bay-bridge-ybi`, `lm.ferry-building`), C16 1.1.0.

## Scope in
- **Graph:** `m.a3.04` needs `m.a3.02` and `m.a3.03`; `m.a3.05` needs `m.a3.04`; `m.a3.06` needs `m.a3.05`.
- **Missions** (`03-story-narrative.md` §B6, DL-157):

| id · district · giver | Stages (objective kinds) | Heat | Hook / unlocks | Refs | Reward |
|---|---|---|---|---|---|
| `m.a3.04` Chorus Final · D1 arena · phone `saint_static` | goto the arena plaza → arena beat → **mode** fighter hook `fight.a3.final` (`defId: 'bout.a3-final'`, `params: {kind: 'story'}`, `passOn: ['win','lose']`; the `BoutDef` sets `RAP_LYRICIST`, `mission_bay_court` and CPU Hard). Stub: non-lethal exhibition against `chorus_sparrer` | 0/0 | on pass `unlock.fighter.rap_lyricist` | `cut.story.m.a3.04.arena` (beat) | $8,000 (+$2,000 win via the fighter `EconomyApi`) · cred 50 |
| `m.a3.05` The Hearing · D4 City Hall · phone `imani_hart` · `sensitivity-read` | protect `imani_hart` on foot from the Civic Center plaza to the City Hall steps (band 2–15 m, `dana_voss`'s security vehicles block two streets) → talk chain at the hearing (`res_tran`, `res_moss`, `res_kai` testify per flag `hearing_support` 0–3; then talk `imani_hart`, outcomes `testify` / `present_ledger`; `present_ledger` is gated on the `m.a2.07` photo) → vote beat → sets flag `auction_suspended` | 0/0 | — | `cut.story.m.a3.05.vote` (beat) | $7,000 · cred 60 |
| `m.a3.06` Exit Event · D5→D10 · phone `saint_static` | protect the Chorus broadcast van along the Embarcadero (band 10–80 m, min health 0.4) → heat set 5 → at the bridge approach heat set 6 (scripted; `portalSeal` active) → goto Yerba Buena Island across the west span → bridge beat → heat cleared → dawn beat → ending beat → credits roll | 0/6 (set 5, then 6) | on pass `unlock.district.d10`; flag `story_complete` | `cut.story.m.a3.06.bridge` (beat), `.dawn` (establish), `.ending.coop` and `.ending.yard` (beats) | $12,000 |

  These three missions pay $27,000, inside the M05f2 target of $25,000–$35,000.
- **No dead ends at the hearing.** If `hearing_support` < 2, `testify` still passes the mission through a weaker outcome line. `present_ledger` is always offered when the ledger photo exists. Either way the mission passes and sets `auction_suspended`.
- **Endings.** The ending beat is `ending.coop` when `flags.coop_success === true` (set in `m.a2.01` from the `mini8w` result), else `ending.yard`. Both are fictional-cast beats with fallbacks.
- **Portal.** During scripted heat 6 the `portalSeal` tactic seals the C08 portals. After the pass the VM restores `capHeat(5)` and clears heat (`clearOnPass`), and the Bay Bridge east portal remains a world boundary (R-MAP-02; expansion is M15). No new world geometry.
- **Credits roll.** After the ending, the story patches the view model `mode.story.finale` `{stage: 'credits'}`. The S10 shell shows the generated credits page in roll presentation (AI disclosure and Characters sections included); "Continue" returns to free roam at `sh.yard` with an autosave (`missionPass`). Once `story_complete` is set, the Jobs app shows "Story complete" and the side activities.
- **Depiction.** `RAP_LYRICIST` appears only as the opponent inside the fighter hook and does not perform music; slots resolve to stand-ins when the roster is absent or killed. `m.a3.05` (D4) carries `sensitivity-read`; residents are fictional.
- **Econ-sim** (`13-qa.md` §3.9): add section `act3` (band $40,000–$60,000 of mission rewards) and a combined check `acts23` (Acts 2–3 added rewards $70,000–$110,000, both in cents in `config/econ-bands.json`), with one out-of-band self-test fixture each.
- **QA bridge.** `__dvBridge.mission.setFlag(key, value)` (QA builds only) lets e2e choose the ending without replaying Act 2.

## Scope out
- New world geometry or East Bay content (M15). XR cutscene hosts (M11b4).
- Generation of any ending or finale clip (DL-173). Changes to the credits generator (it comes from `provenance:check`, `10-ui-pages.md`).
- The public release of `m.a3.05` before the sensitivity read is recorded (Q-21).

## Deliverables
- 3 mission folders (`mission.ts`, `lines.en.json`, `director/*.ts` for 6 beats): 12 files.
- Ink knots in `content/npcs/{saint_static,imani_hart,res_tran,res_moss,res_kai}/*.ink` (5 edits). `content/story/{cast.json,sensitivity.json}` rows; `config/unlocks.json` (`unlock.district.d10`); `content/ui/i18n/en.json` keys.
- `packages/modes/story/src/finale.ts` (ending choice, `mode.story.finale` patch, `story_complete`); the `setFlag` bridge member in `packages/modes/story/src/debug/`.
- `packages/ui/src/pages/credits` roll presentation (one component change).
- `tools/ci/econ-sim/sections/act3.ts`, `config/econ-bands.json` (act3, acts23), `tools/ci/econ-sim/fixtures/{act3,acts23}-*.json`.
- `packages/modes/story/test/act3.finale.test.ts`; `tests/e2e/story-finale.spec.ts` (`@story @story-finale`).
- About 30 files in all.

## Interfaces
- C09 1.0.0. The fighter hook is `{mode: 'fighter', defId: 'bout.a3-final', params: {kind: 'story'}}` (DL-092, DL-157).
- C06 1.1.0: `PursuitApi.setHeat(6, …)` (`HeatLevel` 6 = scripted finale only), `capHeat`, `clear`; `UiBridge.patch` with a `mode.story.*` key; `UnlockApi`.
- C05 1.1.0 `StorySlice.flags` and `act`, unchanged. The bridge member is QA-only and not a contract.

## Acceptance criteria
- AC-1 Given the finale sources When the mission compiler runs Then `m.a3.04`–`m.a3.06` validate with zero errors, all six beats resolve to refs with fallbacks, and `m.a3.05` carries `sensitivity-read` — proof: `pnpm missions:build`
- AC-2 Given the release index When Act 3 autoplays on 3 seeds twice Then all six Act 3 missions pass inside `expectedSec` with equal end hashes per seed; after `m.a3.06`, `story_complete` is true, `CoreSlice.unlocks` contains `unlock.fighter.rap_lyricist` and `unlock.district.d10`, heat is 0 and the heat cap is back at 5 — proof: `pnpm check:missions -- --act 3`
- AC-3 Given all hooks forced to their stubs When Act 3 autoplays Then all six missions pass on 3 seeds — proof: `pnpm check:missions -- --act 3 --hooks stub`
- AC-4 Given headless runs of `m.a3.06` from its first checkpoint, the following hold:
  - with `coop_success` true the ending beat is `cut.story.m.a3.06.ending.coop`, and with it false or absent it is `ending.yard`;
  - during heat 6 `HeatState.scripted` is true and `sealedPortals` is non-empty;
  - after the pass `sealedPortals` is empty and the heat cap is 5;
  - `m.a3.05` passes with `hearing_support` 0 and with 3;
  - a fixture that makes `RAP_LYRICIST` perform music fails with `E_DEPICTION`.
  — proof: `pnpm check:unit -- packages/modes/story/test/act3.finale.test.ts`
- AC-5 Given the economy harness When the econ suite runs Then `act3` mission rewards are within $40,000–$60,000, Acts 2–3 added rewards are within $70,000–$110,000, `act2` stays in band, and each new self-test fixture makes the suite exit non-zero — proof: `pnpm check:balance -- --suite econ`
- AC-6 Given a WebKit QA build at `?mission=m.a3.06&seed=1&hooks=stub&talk=scripted&beats=fallback` with `setFlag('coop_success', true)` When the bot finishes the mission Then the `ending.coop` fallback plays with subtitles, the credits page rolls and shows the AI disclosure and Characters sections, "Continue" lands at `sh.yard` in free roam, and after a reload the save still has `story_complete` with the Jobs app showing "Story complete" — proof: `pnpm check:e2e -- --project=webkit-webgl2 --grep @story`
- AC-7 Given the content When the IP and name gates run Then no shipped Act 3 text or ref slot contains a NameRegistry or denylist term — proof: `pnpm names:lint && pnpm likeness:gate && pnpm npc:lint`
- AC-8 Given the branch When the unit suite, Acts 1–2 autoplay, the build and the preview deploy run Then all pass (the staging smoke runs in `deploy.yml` after merge) — proof: `pnpm check:unit && pnpm check:missions -- --act 1 && pnpm check:missions -- --act 2 && pnpm build && pnpm deploy:preview`

## Test plan
- **Unit:** `act3.finale` (endings, heat 6 and portals, hearing outcomes, depiction). Command: `pnpm check:unit -- packages/modes/story`.
- **Bot runs:** `pnpm check:missions` across all acts (the full release index, 26 missions × 3 seeds).
- **Balance:** `pnpm check:balance` (econ and tycoon suites).
- **E2E:** `--grep @story` on `webkit-webgl2` runs `@story`, `@story-act2`, `@story-act3` and `@story-finale`; also run the same grep on `chromium-webgl2`.
- **Perf:** `pnpm check:perf -- --scenario story-chase` stays within budget (M05c2 scenario, regression only).

## Demo script
1. `pnpm check:missions` prints 26 missions passing on 3 seeds.
2. `pnpm dev`, open `/?mission=m.a3.06&hooks=stub&beats=fallback`, toggle *bot plays*, and watch the Embarcadero protect, the heat-6 bridge run, the dawn beat, the ending and the credits.
3. Repeat with `__dvBridge.mission.setFlag('coop_success', false)` before the ending to see `ending.yard`.

## Effort
1 Builder session; about 30 files; risk **medium**. The heat-6 bridge run under the autoplayer (pursuit pressure on a long narrow span) is the main tuning risk.

## Risks & fallbacks
- **Autoplayer fails the bridge run.** `escape` and `survive` aim for hiding spots, but this stage is a `goto` under pressure. Author an `autoplayPath` along the west span; if seeds still fail, lower traffic on the span with the mission's `ambient` multipliers. Never change `config/pursuit.json` level 6, and never cap the stage below 6.
- **Fighter hook unavailable:** the stub path runs and AC-3 stays green; report AC-2 as blocked on M08b2.
- **Band failure:** re-tune mission rewards inside the per-milestone targets (data only); band edits need the `golden-update` label (verifier lock).
- **Overrun:** the credits roll presentation is the cut line. Fallback: navigate to the static credits page; AC-6 then asserts the static page.

## Notes for the Builder
- Read first: `03-story-narrative.md` §B1, §B3, §B6–§B7; `03-story-missions.md` §C6 (ambient, heat, clock restore), §C8, §C11; `01-engine-save-modes.md` PursuitDirector core; `02-world-bake.md` portals table; `10-ui-pages.md` credits; DL-157, DL-173.
- **Gates.** Deploy and staging smoke need `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (SKIP and exit 0 when absent; list under "Blocked on"). Q-21: `m.a3.05` is excluded from any production release until `content/story/sensitivity.json` records a read for its version, and the whole Act 3 release waits with it. Q-19 and Q-25: stand-ins in CI.
- **fal.** None. Every Act 3 ref, endings included, is in-engine in v1 (DL-OWN-01, DL-173). The index lists them so a later, owner-funded prewarm could pick them up, and no command in this milestone takes `--live`.
- The display name in the credits comes only from `BRAND.displayName` (`{brand}` in catalogs).
- Branch `m05f2-story-act3-finale`.
