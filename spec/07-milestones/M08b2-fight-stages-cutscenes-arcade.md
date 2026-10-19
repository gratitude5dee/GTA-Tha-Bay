# M08b2 — fight-stages-cutscenes-arcade

## Goal
After this session Culture Wars is content-complete for v1, with in-engine presentation everywhere. Five more SF stages join `powell_turntable`. Every R-CUT-02 fighter hook has an indexed `CutsceneRef` with an in-engine DirectorScript fallback: 116 refs for N = 8 fighters and S = 6 stages. Fight intros play as composed `playSequence` segments with per-item fallback. Showstopper and Shutdown can interrupt a fight through the fixed-length `Cinematic` phase. The Arcade ladder unlocks fighters, and story bouts `bout.a11` and `bout.a3-final` exist. A roster kill-switch removes a fighter within one flags refresh and remaps loadouts to stand-ins. The Move Gallery and the accessibility pass complete the mode. No clip is generated here: real clips wait for M10b and ADR-GENAI-01.

## Requirements
- R-MODE-03: six SF stages, Arcade, finishers and cutscene hooks complete the fighter.
- R-CUT-02: fight intro (per fighter × stage and per pair), special, super, finisher and ending hooks exist as index refs.
- R-CUT-03: every fighter ref has a DirectorScript fallback with subtitles; a match waits at most 1.5 s (prefetched) or 2.5 s.
- R-NPC-04: the live kill-switch removes a fighter and remaps to its stand-in, and cutscene refs of a killed fighter fall back.

## Depends on
- **M08b1** (eight kits, roster loader, stand-ins, `check:fighter`, full CPU), **M05b2** (`cutsceneKey`, `assets:cutscene-index`, templates and prompt lint, flat `CutscenePlayer` with `play` and `playSequence`, `@cutscene`; transitively `defineDirector` from M05a2).
- Contracts: C06 1.1 (`UiCommand 'cutscene.state'` with `item`), C07 1.1 (`prop` stage bundles), C09 1.0 (`CutsceneRef`, `CutsceneKeyInput`, `playSequence`, `DirectorScript`), C12 1.1 (`RosterFlags`, read only), C13 1.1 (`WorldPackStore.evictByTag`), C16 1.1 (`cutscene.play` with `path` and `trigger`, DL-193).

## Scope in
- Stages (FX5): `ferry_plaza`, `dolores_slope`, `bayview_cranes`, `alcatraz_yard` (museum state, FX4.6), `mission_bay_court` (fictional venue, tag `arena_court`); gray-box dioramas `prop/graybox.stage-<id>-{day,night}` in `StageDef.scene` with provenance (final `prop/stage-<id>-{day,night}` in M10d3, DL-460); camera coefficients; budgets at 60 % of the tier's render objects and triangles; day/night choice or seeded pick.
- `content/fighter/cutscenes.json` (FX6.1): walk-ins 48, face-offs 28, specials 8, supers 16, shutdowns 8, endings 8 with templates `fight.*@1`, cast, stage and move versions, cues, priority, and fallbacks authored with `defineDirector` (`frame: 'stage2d'`); `content/prompts/genai/fight.{walkin,faceoff,special,super,shutdown,ending}@1.md` (M05b2 leaves fight templates to this milestone); `content/cutscenes/places.json` stage rows.
- Index: `assets:cutscene-index` includes the fighter refs; option `--count <family>` (add it if M07b2 has not).
- Composed intros (FX6.4): `playSequence([walkin A, walkin B, faceoff])` with per-item fallback; `PLAYER_FIGHTER` segments always in-engine; prefetch at stage confirm (`v540` on `mobile`, `v768` elsewhere); `Load` waits ≤ 1.5 s prefetched or ≤ 2.5 s; any attack button skips.
- `Cinematic` presentation (FX6.5, DL-129): Showstopper and Shutdown only, setting `cinematics` default `first` (once per fighter via `seenReveal`), never in Training or online; eligibility is fixed when the match starts and recorded in the replay `rules`, so re-simulation never depends on clip readiness; last frame held if the clip is shorter.
- Endings after `MatchEnd` in Versus and Arcade; story bouts return straight to the mission.
- Arcade (`content/fighter/arcade.json`): ladder order as data, forbidden fighter × stage pairs skipped, `unlock.fighter.<slot>` per beaten fighter, cosmetic costumes by `fighterXp`.
- Story bouts `bout.a11` (`alcatraz_yard`, `ATH_POWER_BACK`, Hard) and `bout.a3-final` (`mission_bay_court`, `RAP_LYRICIST`, Hard) per DL-157.
- Kill-switch (FX4.7): flags read through a `RosterFlagsSource` port on app start, mode entry, select open and every 30 s while visible (DL-557); scope `fighter`/`all` removes the fighter from select and the ladder, remaps `lastLoadout` and ladder slots to `standIn`, drops its refs to the `policy` fallback and calls `evictByTag('char:<id>')`; a running match finishes first; scope `cutscene` keeps the fighter with in-engine intros.
- Move Gallery (special and L2 refs, else fallbacks); select and first-appearance cards ("Parody. Not affiliated…", "Fictional character."); no share or OG art for non-`consented` souls; photo mode off.
- Accessibility (FX9): subtitles for announcer and talk, reduced motion (no shake, dolly or super flash; a 3-frame dim instead), `timerScale` for story bouts, infinite timer in Versus and Training, auto-block in story bouts, no effect above 3 flashes per second.
- `check:assets` rule: a fighter ref without a fallback fails (FX6.6).

## Scope out
- Generating or prewarming any clip, sheets, `assets:gen prewarm`: M10b (≤ $24 of the $40 cutscene line, DN-S13-02), gated by ADR-GENAI-01 and `FAL_KEY` (Q-17).
- Real models and signature clips: M10a1–M10a2. Kill drill end to end: M10b. Backlog stages: post-M10. Fighter XR rules and panels: M11b2; XR cutscene playback (hosts, vantage, subtitle plane): M11b4 (DL-229).

## Deliverables
- `content/fighter/stages/{ferry_plaza,dolores_slope,bayview_cranes,alcatraz_yard,mission_bay_court}.json`; gray-box stage assets and provenance.
- `content/fighter/{cutscenes.json, arcade.json}`; `content/fighter/bouts/{bout.a11,bout.a3-final}.json`; prompt templates and `places.json` rows as needed.
- `packages/modes/fighter/src/sim/{cutscenes.ts, cinematic.ts, arcade.ts, killswitch.ts}`; `src/ui/{intro.ts, gallery.ts, cards.ts, a11y.ts}`; `src/directors/*.ts` (stage2d fallbacks).
- `tools/assets/cutscene-index` reads `content/fighter/cutscenes.json`; `check:assets` fallback rule.
- `packages/modes/fighter/test/{cinematic.spec.ts, arcade.spec.ts, bouts.spec.ts, a11y.spec.ts, killswitch.spec.ts}`.
- `tests/e2e/{fighter-cutscene.spec.ts (@fighter-cutscene), fighter-kill.spec.ts (@fighter-kill)}`; `config/perf/paths/fight-stage.json` extended to cycle the six stages.

## Interfaces
- Uses C09 1.0 exactly: ref ids `cut.fight.*` (owner S03), `CutsceneKeyInput` with characters sorted, `playSequence` items `{ref | null, fallback}`; C06 1.1 `cutscene.state` with `item`; C12 1.1 `RosterFlags` read-only; C13 1.1 `evictByTag`; C16 1.1 `cutscene.play {key8, cached, fallback, path, trigger}`. No contract change.

## Acceptance criteria
- AC-1 Given the branch When typecheck, lint and build run Then all exit 0 — proof: `pnpm typecheck && pnpm lint && pnpm build`
- AC-2 Given `content/fighter/cutscenes.json` When the index builder counts fighter refs twice Then it prints 116 (48 walk-ins, 28 face-offs, 8 specials, 16 supers, 8 shutdowns, 8 endings) with identical keys both times, every ref names an existing DirectorScript, and every fight template passes prompt lint — proof: `pnpm assets:cutscene-index -- --count fighter && pnpm check:assets`
- AC-3 Given status `absent` for every fighter ref When each hook fires in Chromium (intro, Showstopper with `cinematics: 'always'`, Shutdown, ending, a Move Gallery special) Then each resolves its ref and plays the fallback with subtitles within 2.5 s; with one face-off mocked `ready`, a roster-versus-roster intro plays the clip for that item and fallbacks for both walk-ins; every `PLAYER_FIGHTER` segment is in-engine; telemetry carries `path` and `trigger` — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @fighter-cutscene`
- AC-4 Given two recordings of the same match, one with Cinematic eligibility on and one off When both are re-simulated Then each reproduces its own checkpoints; `Cinematic` lasts 300 frames or ends on a skip input; it never occurs in Training; with `first` it shows once per fighter — proof: `pnpm --filter @dv/mode-fighter test -- cinematic`
- AC-5 Given mocked roster flags killing one fighter with scope `fighter` When the flags refresh during a match and again at select Then the match finishes, the fighter is absent from select and the ladder, a saved `lastLoadout` remaps to its stand-in, its refs play fallbacks with trigger `policy`, and scope `cutscene` alone keeps it selectable — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @fighter-kill`
- AC-6 Given an Arcade run won by a scripted CPU When the ladder completes Then each beaten fighter's `unlock.fighter.<slot>` is emitted once, no basketball-domain fighter is ever paired with `mission_bay_court`, and the ending plays after `MatchEnd` — proof: `pnpm --filter @dv/mode-fighter test -- arcade`
- AC-7 Given the six stages When the fighter gate and the stage scenario run Then the stages validate, `alcatraz_yard` carries tag `museum`, and every stage stays within its tier budget — proof: `pnpm check:fighter && pnpm check:perf -- --scenario fight-stage --fail`
- AC-8 Given `bout.a11` and `bout.a3-final` When each runs headless CPU versus CPU Then both validate with `exhibition: true` and return a `ModeResult` with `streetCred`, `rounds` and `durationSec` — proof: `pnpm --filter @dv/mode-fighter test -- bouts`
- AC-9 Given reduced motion When a super and a Shutdown play Then no shake, dolly or flash occurs; with it off no presentation timeline exceeds 3 flashes in any 1-second window; every announcer and talk cue has a subtitle — proof: `pnpm --filter @dv/mode-fighter test -- a11y`
- AC-10 Given the new content When the IP gates run Then all pass and stage and venue names are fictional — proof: `pnpm names:lint && pnpm ip:strings && pnpm likeness:gate && pnpm provenance:check`
- AC-11 Given the branch When the unit suite and the preview deploy run Then both pass — proof: `pnpm check:unit && pnpm deploy:preview`

## Test plan
- **Unit:** `fighter/cinematic`, `fighter/arcade`, `fighter/bouts`, `fighter/a11y`, `fighter/killswitch`.
- **Index and gates:** `assets:cutscene-index -- --count fighter`, `check:assets`, `check:fighter`.
- **E2E:** `@fighter-cutscene`, `@fighter-kill` (Chromium); `@fighter-hash`, `@fighter-touch` stay green.
- **Perf:** `fight-stage` across the six stages.

## Demo script
1. `pnpm assets:cutscene-index -- --count fighter`: 116.
2. `pnpm dev`, `/?unlockAll=1`, Arcade with `TECH_HACKER`: the intro plays in-engine walk-ins and a face-off with subtitles; skip with an attack button.
3. Win the final round and tap Hype in the window: the Shutdown plays in-engine.
4. Beat the ladder's first opponent: that fighter unlocks.
5. In the QA panel, kill that fighter: it disappears from select; your saved loadout shows the stand-in.

## Effort
1 Builder session; about 36 files (116 refs as one data file; DirectorScripts share builders); risk **medium**. The composed-intro timing and the kill-switch paths are the time sinks.

## Risks & fallbacks
- **Composed intro stalls** on one item: per-item fallback (F1–F10 of `03-story-cutscenes.md` §D6–§D7); the match never waits beyond the AC-3 limits.
- **Kill-flags source:** the real route lands with M06a1; tests use a mocked `RosterFlagsSource`, so this milestone does not need a running backend.
- **Stage budgets on gray box** pass easily; real art (M10a) re-runs AC-7.
- **Strobe rule:** if an effect breaks the 3-per-second limit, lengthen its fade; never drop the test.

## Notes for the Builder
- Read first: `07-fighter-content.md` FX4–FX6, FX8–FX9; `07-fighter-core.md` FC3, FC8; `03-story-cutscenes.md` §D2–§D4, §D6–§D7, §D9.1.
- Order: stages → refs and fallbacks → index → composed intro → Cinematic → arcade and bouts → kill-switch → gallery and cards → accessibility → e2e.
- Facts: F-039, F-040, F-043, F-063 (spec/03 §6); none is asserted, because no clip is generated here.
- Never call fal: `FAL_MODE=mock`; no player action can trigger generation (DL-OWN-01).
- Secrets: none besides the CI deploy pair. Owner gates: ADR-GENAI-01 and Q-17 apply to M10b, not here.
