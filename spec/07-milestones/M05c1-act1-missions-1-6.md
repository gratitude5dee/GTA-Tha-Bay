# M05c1 — act1-missions-1-6

## Goal
After this session the first half of Act 1 "Jump Start" is playable and proven by the bot. Missions `m.a1.01`–`m.a1.06` (`03-story-narrative.md` §B4) exist as compiled IR with English lines, DirectorScripts for every beat (and fallbacks for the five generated-clip refs of these missions), the Act 1 cast table with stand-ins for real-person roster slots, unlock definitions for racing, fighter, fighter unlocks and districts, the racing and fighter hooks on their stub paths with DL-157 ids, the Yard safehouse, the three shops, open-world melee through a `CombatApi` stub, a talk-choice panel, and the Act 1 section of the economy harness. `pnpm check:missions -- --act 1` passes missions 1–6 on three seeds.

## Requirements
- R-MODE-01: original story missions with objectives, fail rules, heat, rewards, safehouse and shops.
- R-MODE-05: `unlock.racing` (m.a1.03) and `unlock.fighter` (m.a1.05) are emitted on first encounter through the stub path and persist.
- R-MAP-01: missions sit at recognizable SF places (4th & King, 24th St BART, Bayview, Powell & Market, Bernal Heights) resolved from C08.

## Depends on
- M05a2 (autoplayer, `check:missions`, director, `defineDirector`), M05b2 (cutscene refs, index builder, player, beat protocol), M03c (`PursuitApi`, heat, bust), M04b2 (story HUD, phone, creator-kit bodies), M02c2 (map blips, GPS, mission markers).
- Contracts: C09 1.0 (IR, `CutsceneRef`, `DirectorScript`), C06 1.1 (`EconomyApi`, `CombatApi`, `UnlockDef`, `ModeHook` semantics, `UiCommand 'mode.cmd'`), C10 1.0 (talk fields only: `context.missionId`, `missionStep`, `PlayerIntent`), C05 1.1 (`StorySlice`).

## Scope in
- Missions `content/missions/m.a1.0{1..6}/{mission.ts, lines.en.json, director/*.ts}` exactly as the §B4 rows: start triggers, stages and objective kinds, gates (`requires`), heat start/max, hooks, cast, beats, `autoplay.expectedSec` bands, rewards (paid once, idempotency `mis:<id>:reward`) and unlocks:
  - 01 Jump Start (D3; auto after the creator; clock locked 06:00 `karl-fog`; `deliver` with `fragile: 0.5`; grants `unlock.district.d3`, safehouse `sh.yard`, tow truck to the garage);
  - 02 Surge Pricing (D1→D2; `timeLimitSec: 240` × `timerScale`; heat set 1, checkpoint; `unlock.district.d1`, `.d2`);
  - 03 Sideshow Sunday (tag `sideshow`; marker 18:00–23:00; `score` drift 3,000 in 90 s; hook id `race.a1.sideshow-escape`, `defId` `sf.pursuit.bayview-escape`, stub = escape at heat 2 then goto the Yard in 240 s; `unlockOnFirstEncounter: 'unlock.racing'`);
  - 04 Curb Appeal (talks with `INFLUENCER` and `door_host` with the gated `charm` outcome, `bribe` $300, `refuse`; stealth budgets 3 / 2; photo of the curb-map screen; keynote beat);
  - 05 Turntable Battle (D4/D6; hook id `fight.a1.turntable`, `defId` `bout.a5`, `params {kind: 'story'}`, passes on `win` or `lose`; stub = `defeat` of `chorus_sparrer`, non-lethal; `unlockOnFirstEncounter: 'unlock.fighter'`; `unlock.fighter.rap_new_wave` on pass; reward $1,000 plus $1,000 on a win);
  - 06 Signal Boost (follow and protect the Chorus van, band 10–60 m, lose 20 s, min health 0.4; heat 2 escape).
  Missions in D3 or D4 carry `sensitivity-read` (01, 03; 05 when its district resolves to D4).
- CutsceneRefs `content/story/act1/cutscene-refs.ts` for `cut.story.m.a1.01.dawn`, `.03.raid`, `.04.keynote`, `.05.ring`, `.06.antenna` (§B5 slots, templates, `prefetch: 'onTrigger'`, `priority: 1`, `audio` per template), each with its DirectorScript fallback and the same cues; `beats.lock.json` revisions; `places.json` entries.
- Cast `content/story/cast.json`: fictional cast of missions 1–6 (`odessa_calloway`, `tavi_okafor`, `x_ramos`, `ama_osei`, `corwin_hale`, `dana_voss`, `door_host`, `saint_static`, `chorus_sparrer`) with `{id, soulVersion: 1, basis: 'original', tier: 'fictionalized', bodyPreset}` (M10c writes their `soul.md`) (creator-kit bodies, DL-180), and the slots `INFLUENCER`, `RAP_HYPHY_ELDER`, `RAP_NEW_WAVE` → roster soul id (absent until Q-19/Q-25) and an `original` stand-in id. `SoulFactsPort` (M05b2) reads these facts until M06a2 compiles souls.
- Unlock defs in `config/unlocks.json` (create it if absent; `source: 'base'`; loaded into M04a2's `UnlockRegistry`): `unlock.racing` (`menuTile: 'racing'`), `unlock.fighter` (`menuTile: 'fighter'`), `unlock.fighter.rap_new_wave` (`fighters: [<resolved soul id>]`, a stand-in when the roster is absent), `unlock.district.d1` … `d10`. Racing and fighter tiles stay `comingSoon` until their milestones (A-06).
- Safehouse and shops (`packages/modes/story/src/missions/`): `sh.yard` (save point, respawn, 4 garage slots, sleep); `sh.mission_flat` purchasable for $8,000 after m.a1.06; body shop in Dogpatch (respray $500, the C06 `Respray` interaction), a clothing shop in D2 and a car lot in D1 (compact $8,000, sedan $14,000); all money through `EconomyApi` with idempotent keys; refused when funds are short.
- Melee (`packages/engine/src/sim/combat/`, replacing M04a2's `NotYetAvailable` `combat` stub; S01 basic core until M08a1): `CombatApi` with three moves (`jab`, `shove`, `takedown`), capsule hits at 60 Hz in `SimStage.Rules`, damage into `Health`, `takedown` on a damaged target sets `Health.ko` (non-lethal), assault reports an infraction to `PursuitApi`; the autoplayer's `defeat` policy uses it.
- Talk panel (`packages/ui/src/hud/TalkChoices.tsx`, S10): renders `mode.story.talk {talkId, npc, choices[{id, label, enabled}]}`; shows the NPC's opening line from the mission lines and the outcome buttons immediately (no LLM before M06a3, no ink before M06a3/M10c); a choice sends `UiCommand {t: 'mode.cmd', mode: 'story', name: 'talk.result', args: {talkId, outcome, turns: 0, path: 'scripted'}}`; disabled outcomes show their gate hint.
- Economy harness section `tools/ci/econ-sim/sections/act1.ts` with bands in `config/econ-bands.json` (`act1`): income from the compiled rewards of missions 1–6, sinks from the shop table; exact totals and "no policy below 0" checks.
- Lines pass `names:lint`; no real name, alias, team, label or song in any line (§C11).

## Scope out
- Missions `m.a1.07`–`12`, the remaining four refs, plates, the Act 1 release index, sensitivity gate enforcement and `story-chase`: M05c2.
- Real racing and fighter hooks: M07a2/M07b1 and M08a2/M08b2. LLM talk and ink knots: M06a3, M10c. Soul files and voices for the cast: M06a2, M10c.

## Deliverables
- `content/missions/m.a1.0{1..6}/` (mission, lines, director scripts), `content/story/act1/cutscene-refs.ts`, `content/story/cast.json`, `content/cutscenes/{places.json, beats.lock.json}` (entries), `config/unlocks.json` (rows), `config/econ-bands.json` (`act1`).
- `packages/modes/story/src/missions/{safehouse.ts, shops.ts, index.ts}`, `packages/modes/story/test/{act1-hooks.test.ts, shops.test.ts, depiction-lint.test.ts}`.
- `packages/engine/src/sim/combat/{combat.ts, moves.ts}`, `packages/engine/test/combat.test.ts`.
- `packages/ui/src/hud/TalkChoices.tsx`, `packages/ui/test/talk-choices.test.tsx`, i18n keys.
- `tools/ci/econ-sim/sections/act1.ts`; generated mission and lines assets with lock entries; `tests/e2e/story-talk.spec.ts` (tag `@story`).

## Interfaces
- C09 1.0, C06 1.1, C10 1.0 and C05 1.1 consumed as defined; hook `defId`s are the mode owners' ids (06 §4.1 rule 6, DL-157). No shape change.

## Acceptance criteria
- AC-1 Given the six missions When `missions:build` and the name gate run Then all compile with zero errors (including `E_NO_FALLBACK` and depiction lint), every `LineId` resolves, D3/D4 missions carry `sensitivity-read`, and no line trips `names:lint` — proof: `pnpm missions:build && pnpm names:lint`
- AC-2 Given one fixture per §C11 rule (slot cast as a chase target, a slot in an `unlawful` stage, a `weapon.*` prefab, `defeat` without `nonLethal`, a D4 mission without the tag, an athlete slot in a sports context) When the depiction-lint test runs Then each fails with `E_DEPICTION` or `E_NAME` at its pointer — proof: `pnpm check:unit -- packages/modes/story`
- AC-3 Given a local SF bake (`pnpm map:build -- --area sf`) When `check:missions` runs Act 1 Then missions 1–6 pass on their three seeds twice, inside their `expectedSec` bands, with equal end hashes per seed, and missions 07–12 are reported as not yet in the index — proof: `pnpm check:missions -- --act 1`
- AC-4 Given headless runs of m.a1.03 and m.a1.05 on the stub path When each passes twice Then `unlock.racing` and `unlock.fighter` are emitted once each with refs `m.a1.03:race.a1.sideshow-escape` and `m.a1.05:fight.a1.turntable`, `unlock.fighter.rap_new_wave` grants the stand-in id while the roster is absent, the tiles stay `comingSoon`, and `CoreSlice.unlocks` is sorted — proof: `pnpm check:unit -- packages/modes/story`
- AC-5 Given the Act 1 economy section When the economy suite runs Then rewards of missions 1–6 total exactly 870,000 cents (970,000 with the m.a1.05 win), Street Cred 90 and Tech Clout 30, each reward is credited once across a retry, no policy ends below 0, and the self-test still rejects the out-of-band fixture — proof: `pnpm check:balance -- --suite econ`
- AC-6 Given the melee stub When `jab`, `shove` and `takedown` hit a fixture NPC Then damage applies at the frame-data ticks, `takedown` on a damaged target sets `Health.ko` without despawn, each hit reports one assault infraction, and the m.a1.05 stub `defeat` objective completes under the autoplayer in a headless run — proof: `pnpm check:unit -- packages/engine packages/modes/story`
- AC-7 Given a wallet of $600 When the player resprays ($500) twice with the same idempotency key, then buys a compact car ($8,000) Then one debit of 50,000 cents happens, the purchase is refused for insufficient funds, and `sh.yard` respawn and save point are registered after m.a1.01 — proof: `pnpm check:unit -- packages/modes/story`
- AC-8 Given a QA build at `/?mission=m.dev.sample&stage=<talk stage>&seed=1` When the talk panel appears and the player clicks the second outcome Then the panel lists the outcomes with their labels, a gated outcome is disabled with its hint, the click sends one `talk.result` with `path: 'scripted'`, and the mission jumps to that outcome's stage — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @story`
- AC-9 Given the cast table and the likeness gate When the gate runs Then every Act 1 entry has basis `original` or a slot with an `original` stand-in, and the gate passes — proof: `pnpm likeness:gate`
- AC-10 Given the branch When the asset gate, production build and preview deploy run Then they pass and the deployed build lists missions 1–6 in the phone Jobs app — proof: `pnpm check:assets && pnpm build && pnpm deploy:preview`

## Test plan
- Unit: `story/depiction-lint`, `story/act1-hooks`, `story/shops`, `engine/combat`, `ui/talk-choices`. `pnpm check:unit -- packages/modes/story packages/engine packages/ui`.
- Bot runs: `pnpm check:missions -- --act 1` (local bake; nightly on CI per M05a2), `pnpm check:balance -- --suite econ`.
- E2E: `@story` talk panel on `chromium-webgl2`. Static: `missions:build`, `names:lint`, `likeness:gate`, `check:assets`.

## Demo script
1. `pnpm missions:build && pnpm check:missions -- --act 1` (bake present): six missions × three seeds green.
2. `pnpm dev`, New Game, finish the creator: m.a1.01 starts at the Yard gate at 06:00 in fog.
3. Console `__dvBridge.mission.autoplay(true)`; watch the tow and delivery; the outro beat plays in-engine.
4. Open the phone: Jobs lists m.a1.02; Settings › Saves shows `story:auto` after the pass.

## Effort
1 session; ≈ 40 files (18 are short mission, lines and director files); risk medium (autoplayer on real SF streets; stealth and score policies).

## Risks & fallbacks
- An `expectedSec` band from §B4 cannot hold for the bot: widen the band within §C4 bounds (max ≥ min × 1.2, ≤ 3,600 s), record the change and the measured times in the report; never weaken the pass condition.
- `score` drift 3,000 in 90 s is not reachable with the M03a1 handling preset: tune `config/autoplay/score.json` first; if still short, lower the target to the bot's p10 and record it as a design change for the Architect.
- A place in §B4 snaps more than 25 m from any road: pick the nearest valid point on the same block and note the coordinates in the mission file comment.

## Notes for the Builder
- Read first: `03-story-narrative.md` §B1–§B4, §B5 (rows for 01–06), §B7–§B8; `03-story-missions.md` §C7–§C8, §C11; `03-story-cutscenes.md` §D4 (slots).
- Order: cast and unlock rows → melee stub → shops and safehouse → missions 01–06 (compile and bot each before the next) → refs and director scripts → talk panel → econ section → e2e.
- Content is original: fictional companies and venues only (§B3); no murals; screen text such as "LOT 1" is an in-engine overlay, never part of a clip.
- No secrets. `deploy:preview` SKIPs without Cloudflare secrets. Branch `m05c1-act1-missions-1-6`.
