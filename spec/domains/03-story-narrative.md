# Domain 03 — Story, Missions & Cutscenes (S03), Part B: premise, factions, beat sheets, unlocks

> Wave 2 · v1.0 · 2026-10-18 · author S03. Continues `03-story.md` (Part A). Part B is the content design: the campaign premise, factions and cast, the depiction rules applied to them, the Act 1 beat sheet (12 missions, the v1 vertical slice, A-06), the outline of Acts 2–3, the cutscene beat lists that drive prewarm (Part D §D9) and the unlock events (R-MODE-05). Requirements: R-MODE-01, R-MODE-05, R-CUT-02, R-MAP-01, R-IP-01/02. Binding: Q-07 (*Hella Valuation*, SF-only Act 1), D-30 (no firearms, no gore, no real-person crimes), Q-06 (sideshows allowed with police response), D-29 likeness tiers. All story text ships as `LocKey`/`LineId` strings (Part C §C3); character names below are fictional working names and live in `lines.*.json`, not in code.

## B1. Premise — *Hella Valuation*

**Logline.** A robotaxi company wants to buy the right to San Francisco's curbs. A Bayview shipyard mechanic finds the company's prototype mapping pod inside a stalled car, and a neighborhood that refuses to be mapped out turns the mechanic into the most wanted driver in the city [research/gamedesign-decomposition.md §10.1].

**Refinements made here.**
- **The pod.** The prototype is an *Atlas pod*, a curb-mapping sensor salvaged from a stalled robotaxi. It is not stolen, and its evidence drives the plot: the auction's "lots" were drawn weeks before public comment, from traffic data the fleet itself inflated. The story is about **exposure, not violence**: tow, race, sneak, photograph, broadcast, testify.
- **The city process.** A fictional *Curb Allocation Board* is auctioning curb rights. Act 1 ends with the Yard's street named *Lot #1*. Act 3 ends with the auction suspended after a public broadcast and a hearing.
- **The money.** Fog Index Capital funds the robotaxi company and also offers the player seed money for a community ride co-op (the tycoon hook). Its double play is the Act 2 reveal.
- **Tone.** Warm, comic and satirical: hyphy car culture against hypergrowth. The city is the joke's straight man and is always recognizable. No firearms, gore, drug use or sexual content (D-30, Q-GD-07). Pursuits end in busts and fines, never deaths.
- **Protagonist.** The player's created character, raised at the Yard. The default name and callsign are "Coast" (`content/ui/creator/defaults.json`, DL-OWN-05), so they can be renamed, and the default look is the owner's stylized Coast design (DL-737). Motive: keep the Yard's street and its people.
- **Originality guardrails.** No Rockstar characters, places, mission names or plots. Tech-launch missions are social, stealth or exposure missions, never assassinations (the "Friend Request" beat is on the avoid list). There is no protagonist switching, no heist planning board and no territory painting [research/gamedesign-decomposition.md §10].

## B2. Factions and cast

| Faction | Base (district) | Role in the story | Fictional cast (soul ids, `original` basis, authored with S04) |
|---|---|---|---|
| **The Yard** | Bayview shipyard garage (D3) | the player's crew; tow, repair, sideshow culture | `odessa_calloway` (elder mechanic, mentor) · `tavi_okafor` (driver, sideshow captain, ally) · `x_ramos` (tow dispatcher, phone contact) |
| **Halcyon Mobility** | SoMa HQ (D1) | antagonist robotaxi company | `corwin_hale` (CEO; appears in beats, never fought) · `dana_voss` (head of "Curb Ops" security, field antagonist) |
| **The Cerebral** | Hayes Valley hacker house (D4) | frenemies who jailbreak robotaxis and decode the pod | `patch` (hacker lead, ally) |
| **Fog Index Capital** | FiDi (D5) | VC playing both sides; tycoon gatekeeper | `whitney_arlo` (partner) |
| **The Chorus** | pirate radio, later on Twin Peaks (D9) | artists' collective; runs the street-exhibition fight circuit and the broadcast | `saint_static` (DJ and founder, host) · `chorus_sparrer` (exhibition sparring partner) |
| **Curb Allocation Board** | City Hall (D4) | the process, not a villain | `imani_hart` (fictional supervisor, mentor in Act 1 §10) · residents `res_tran`, `res_moss`, `res_kai` |
| **City Patrol** | citywide | police parody; pursuit only | `sgt_bell` (named unit for scripted pursuits) |

**Roster slots** are real-person archetypes (§4.3 of gamedesign). Each resolves through `content/story/cast.json` to a roster soul, or to its mandatory stand-in when the roster is absent (Q-19) or killed. Every soul starts at the default tier (`parody`; deceased people and real-company founders `fictionalized`, D-29).

| Slot | Missions | Role and context (always lawful, never in their fame domain) |
|---|---|---|
| `INFLUENCER` | m.a1.04 | cameo: streaming in the line outside the launch party; a selfie or a pass (flavor only) |
| `RAP_HYPHY_ELDER` | m.a1.05 | host: announces the Chorus street exhibition (talks, does not perform music) |
| `RAP_NEW_WAVE` | m.a1.05 | opponent inside the fighter hook (sanctioned exhibition bout) |
| `ATH_SHOOTER` | m.a1.11 | cameo: guest of honor drawing raffle tickets at the night market (no sport) |
| `RAP_LYRICIST` | m.a2.06 (mentor, café), m.a3.04 (fighter opponent) | advice on the city's history; final opponent |
| `ATH_POWER_BACK` | m.a2.08 | fighter opponent (Alcatraz exhibition) |

`TECH_VC`, `TECH_VISIONARY`, `TECH_HACKER` and `RAP_COLLECTIVE` do not appear in the campaign. Pitching, board votes and jailbreaks are the fame domain of the first two and an unlawful context for the third, so the fictional cast carries those beats. The last one stays available to S07's roster.

## B3. Depiction rules applied (and checked by Part C §C11)

1. Real-derived characters are never criminals, victims of violence, faction leaders or antagonists. They never ride along during an unlawful stage, are never chased or fought outside a fighter bout, and are never shown in sexual, drug or gore content [research/legal-ip-likeness.md L1, constraint 8].
2. Every sideshow, jailbreak, trespass and evasion is done by the player and fictional characters only.
3. Generated story clips cast fictional characters only. Real-derived characters appear in generated video only as fighters, through S07's hooks, at `toon-pbr` presets.
4. **Neighborhoods.** Bayview–Hunters Point and the Tenderloin are depicted through their people, work and culture (the Yard, the night market, the hearing), never as poverty or crime set dressing [research/gamedesign-decomposition.md §11]. Missions in D3 and D4 carry the `sensitivity-read` tag. M05c2 cannot release Act 1 until `content/story/sensitivity.json` records a completed community read for each tagged mission's current version (decision DN-S03-05, Part A §10).
5. Companies, vehicles, venues, teams and stations are fictional. Examples: Halcyon robotaxis, the *Vanta* roadster prototype (Act 2), "the arena" in Mission Bay. Murals and public art are never reproduced [research/legal-ip-likeness.md constraint 16].

## B4. Act 1 "Jump Start" — beat sheet (12 missions, SF only: D1–D4, D6)

Order and gates: 01 → 02 → 03. From there:
- 04 and 05 open in parallel;
- 06 needs 05, and 07 needs 04;
- 08 needs 07, and 09 follows 08 automatically;
- 10 needs 06 and 09, and 11 needs 06;
- 12 needs 10 and 11.

Mode hook cells read (`ModeHook.id`, owner `defId`) (§C8 item 4, DL-157). Heat values are `heatPolicy` start/max. Seconds are the autoplay `expectedSec` band. Rewards are paid once per mission (idempotency key `mis:<id>:reward`).

| # / id | Title · district · start | Stages (objective kinds) | Heat | Mode hook / unlock | Cast | Beats | Band (s) | Reward |
|---|---|---|---|---|---|---|---|---|
| 01 `m.a1.01` | Jump Start · D3 · auto after the creator | goto Yard gate on foot → enterVehicle tow truck → goto a stalled robotaxi on 3rd St (clock locked 06:00, `karl-fog`) → deliver it to the Yard (`fragile` 0.5) | 0/0 | `unlock.district.d3`; safehouse `sh.yard`; tow truck to garage | odessa, tavi | gen `dawn` intro; in-engine outro "the pod" | 240–600 | $500 |
| 02 `m.a1.02` | Surge Pricing · D1→D2 · phone `x_ramos` | goto 4th & King pickup (stopped) → deliver the fare to the 24th St BART plaza within 240 s, racing a robotaxi's ETA → escape (heat set to 1, checkpoint) → goto Yard | 0/2 | `unlock.district.d1`, `.d2` | `ama_osei` (fictional fare) | in-engine | 300–720 | $1,200 · cred 20 |
| 03 `m.a1.03` | Sideshow Sunday · D3 · marker at the Yard, 18:00–23:00 · tags `sideshow` | follow Tavi to an industrial lot → score drift 3,000 in 90 s → raid beat → **mode** racing (`race.a1.sideshow-escape`, `sf.pursuit.bayview-escape`) (stub: escape at heat 2, then goto Yard in 240 s) | 2/3 | **`unlock.racing`** (first encounter) | tavi | gen `raid` | 300–780 | $1,500 · cred 40 |
| 04 `m.a1.04` | Curb Appeal · D1 · phone odessa | goto the launch-party line (lawful) → talk `INFLUENCER` (`selfie` / `pass`) → talk door host (`charm` gated on NPC mood, `bribe` $300, `refuse`) → stealth to the exec floor (detect budget 3 inside, 2 via the service door) → photo the curb-map screen → keynote beat → goto exit | 0/1 | — | INFLUENCER, `door_host`, corwin (beat), dana | gen `keynote` | 360–900 | $2,000 · clout 30 |
| 05 `m.a1.05` | Turntable Battle · D4/D6 Powell & Market · phone `saint_static` | goto the turntable plaza → ring beat → talk `RAP_HYPHY_ELDER` host (`sign_up`) → **mode** fighter (`fight.a1.turntable`, `bout.a5`: `RAP_NEW_WAVE` at `powell_turntable`, CPU Normal, rules from the S07 `BoutDef`), pass on win or lose (stub: defeat `chorus_sparrer`, non-lethal) → in-engine outro | 0/0 | **`unlock.fighter`** (first encounter); `unlock.fighter.rap_new_wave` on pass | saint, hyphy host, new-wave opponent | gen `ring` | 240–600 | $1,000 (+$1,000 win) · cred 30 |
| 06 `m.a1.06` | Signal Boost · D2 · phone saint | goto a Mission warehouse → follow and protect the Chorus van (band 10–60 m, lose 20 s, min health 0.4) to Bernal Heights → escape (patrol sweep, heat 2) → antenna beat | 0/3 | — | saint, Chorus crew | gen `antenna` | 360–900 | $2,500 |
| 07 `m.a1.07` | Hacker House · D4 (Hayes Valley) · phone odessa · `sensitivity-read` | goto the Victorian → talk `patch` (`trust`: hand over the pod / `doubt`: keep it, flag) → stealth across Alamo Square past Halcyon drones (budget 3) → deliver Patch to Civic Center | 0/1 | `unlock.district.d4` | patch, dana (radio) | in-engine | 300–780 | $2,000 · clout 40 |
| 08 `m.a1.08` | Dead Pixels · D3→D1 · marker at the Yard, 21:00–04:00 | wait for the mapping car → follow it (15–90 m, lose 25 s) to its SoMa depot → photo the depot gate → chase a second mapping car (catch 6 m, hold 3 s: plant Patch's dongle) → escape | 0/2 | — | patch (radio) | gen `scanner` | 360–960 | $3,000 |
| 09 `m.a1.09` | Respray · D3→D1 (Dogpatch) · auto after 08 | heat set to 3 on leaving the Yard → goto the body shop in the flagged tow truck and respray it (C06 `Respray`) → escape to heat 0 (hiding spot under the freeway viaduct) → goto Yard | 3/3 | — | odessa (phone), `sgt_bell` | in-engine | 300–900 | $2,500 |
| 10 `m.a1.10` | Public Comment · D4 Civic Center / Tenderloin · phone `imani_hart` · `sensitivity-read` | talk `res_tran`, `res_moss`, `res_kai` (each `agree`/`decline` → flag `hearing_support` 0–3) → goto the City Hall steps before 17:30 (clock starts 15:00; time limit × `timerScale`) → steps beat | 0/0 | — | imani, three residents | gen `steps` | 420–1,020 | $1,500 · cred 50 |
| 11 `m.a1.11` | Night Market · D2 (24th St) · marker at the plaza, 19:00–23:00 | talk `ATH_SHOOTER` (raffle, `thanks`; lawful stage, despawned after) → chase three Halcyon "curb compliance" tow trucks and box each in (catch 4 m, hold 2 s, all within 240 s) → escape | 0/3 | — | ATH_SHOOTER, x_ramos | in-engine | 360–900 | $3,000 · cred 60 |
| 12 `m.a1.12` | Lot Number One · D1→D3 · phone saint after 10 and 11 | goto the Mission Bay plaza by the arena → lot-one beat (the Yard's street named Lot #1 on the big screen) → survive 120 s at scripted heat 4 (helicopter, spikes) → escape → goto Yard with the pod → arrival beat → talk `whitney_arlo` (`listen`) | 4/4 | `StorySlice.act = 2`; flag `act1_complete` | odessa, saint, corwin (beat), dana, whitney | gen `lot-one`, `arrival` | 600–1,500 | $5,000 |

**Act 1 totals.** 12 missions in 5 districts. Cash $25,700 (plus $1,000 on an A1.05 win), Street Cred 200, Tech Clout 70.
- Pursuits reach heat 1, 2, 3 and 4.
- Two mode hooks are exercised (racing and fighter) with stub fallbacks.
- Objective kinds covered: every kind except `collect` and `wait`. The M05a sample mission covers those two.

## B5. Act 1 cutscene refs (prewarm priority 1)

Every ref has an in-engine DirectorScript fallback with the same cues (`content/missions/<id>/director/<beat>.ts`). Story refs use `prefetch: 'onTrigger'`.

| Ref id | Template | Cast (fictional only) | Content (slots, abbreviated) | Seconds |
|---|---|---|---|---|
| `cut.story.m.a1.01.dawn` | `story.establish@1` | — | fog rolling over shipyard cranes at dawn, a tow truck's amber light | 8 |
| `cut.story.m.a1.03.raid` | `story.beat@1` | tavi | headlights and tire smoke in an industrial lot; patrol lights flood the fog; the crowd scatters | 14 |
| `cut.story.m.a1.04.keynote` | `story.beat@1` | corwin | a launch stage; a city curb map splits into glowing numbered lots; the executive raises a hand | 14 |
| `cut.story.m.a1.05.ring` | `story.establish@1` | — | a crowd forms a ring around a cable-car turntable at dusk; bells | 8 |
| `cut.story.m.a1.06.antenna` | `story.establish@1` | — | a makeshift antenna rises on a hill above the city lights | 8 |
| `cut.story.m.a1.08.scanner` | `story.establish@1` | — | a mapping car with spinning sensors glides through night fog | 8 |
| `cut.story.m.a1.10.steps` | `story.beat@1` | imani | residents gather on City Hall's steps at golden hour; the doors open | 14 |
| `cut.story.m.a1.12.lot-one` | `story.beat@1` | corwin, dana | a giant screen labels a familiar street "LOT 1"; security vehicles roll out | 14 |
| `cut.story.m.a1.12.arrival` | `story.beat@1` | whitney | a black car stops at the Yard gate at night; a partner steps out under the floodlight | 14 |

That makes 9 refs and 102 s: 4 × 8 s + 5 × 14 s. The "LOT 1" screen text in the lot-one ref is rendered as an in-engine overlay, not in the generated clip (templates forbid text). All dialogue in these missions plays in-engine.

## B6. Acts 2–3 outline (SF only; milestones M05e, M05f)

**Act 2 "Due Diligence"** (8 missions). The player builds a counter-move and decodes the pod; the act ends with the Fog Index double play exposed.

| id | Title · district | Core (objective kinds) | Hook | Gen refs |
|---|---|---|---|---|
| `m.a2.01` | Seed Round · D5 FiDi | talk whitney; **mode** tycoon (`tycoon.a2.curbshare`, `mini8w`): the co-op's dispatch-software seed round as S08's fixed 8-week SAFE preset, pass on win or lose (stub: three-choice talk whose outcomes set the same flag); on `modeResult(tycoon.a2.curbshare, ['win'])` set flag `coop_success = true` | **`unlock.tycoon`** | `fidi` (establish) |
| `m.a2.02` | Hill Climb · D6 Russian Hill | **mode** racing (`race.a2.hill-climb`, `sf.hillclimb.filbert-hyde`) against the Solenne Skip roadster test car (`vehicle.solenne-skip`, S06) (stub: goto summit in time) | `unlock.racing.event.sf.hillclimb.filbert-hyde` (S06) | `roadster` (beat) |
| `m.a2.03` | Jailbreak · D4 · tags `jailbreak` | protect patch; **mode** racing (`race.a2.robotaxi-rush`, `sf.robotaxirush.soma-haight`) (stub: chase 3 locked robotaxis) | `unlock.racing.robotaxi` (S06) | `release` (beat) |
| `m.a2.04` | Karl · D8 Golden Gate Park / Ocean Beach | stealth in fog, follow a mapping van to a hidden data trailer | `unlock.district.d8` | `fogbank` (establish) |
| `m.a2.05` | Tower · D9 Twin Peaks | protect + survive: defend the Chorus broadcast from drones | `unlock.district.d9` | `broadcast` (beat) |
| `m.a2.06` | Cable Pull · D6 Chinatown / North Beach | talk `RAP_LYRICIST` (mentor, café); follow a courier along a cable-car line; photo at Coit Tower | `unlock.district.d6` | `cablecar` (establish) |
| `m.a2.07` | Pier Pressure · D5 Embarcadero | talk chain at the Ferry Building; photo the ledger; escape at heat 3 | `unlock.district.d5` | `ledger` (beat) |
| `m.a2.08` | Showcase · Alcatraz stage | boat crossing beat; **mode** fighter (`fight.a2.showcase`, `bout.a11`: `ATH_POWER_BACK` at `alcatraz_yard`, CPU Hard) | `unlock.fighter.ath_power_back` | `crossing` (establish) |

**Act 3 "Exit Event"** (6 missions). The board vote, the gala, the hearing and the finale on the Bay Bridge west span to Yerba Buena Island. That is the portal hook to the M15+ East Bay expansion.

| id | Title · district | Core | Hook | Gen refs |
|---|---|---|---|---|
| `m.a3.01` | Board Games · D5 | talk chain at the board vote (no mode hook: S08 defines no board-vote preset in v1, DL-157) | — | `boardroom` (beat) |
| `m.a3.02` | Glass House · D7 Pacific Heights | talk + stealth at Hale's gala; photo the server map | `unlock.district.d7` | `gala` (establish), `server` (beat) |
| `m.a3.03` | Great Highway · D8 | **mode** racing (`race.a3.great-highway`, `sf.speedtrap.great-highway-night`) night speed trap vs Curb Ops drivers | — | `speedtrap` (beat) |
| `m.a3.04` | Chorus Final · D1 arena | **mode** fighter (`fight.a3.final`, `bout.a3-final`: `RAP_LYRICIST` at `mission_bay_court`, CPU Hard) | `unlock.fighter.rap_lyricist` | `arena` (beat) |
| `m.a3.05` | The Hearing · D4 City Hall · `sensitivity-read` | protect Imani's route; talk chain; outcome uses `hearing_support` | — | `vote` (beat) |
| `m.a3.06` | Exit Event · D5→D10 | protect the broadcast; heat 5, then scripted 6 along the Embarcadero onto the Bay Bridge west span to Yerba Buena Island; portal closes behind | `unlock.district.d10` | `bridge` (beat), `dawn` (establish), `ending.coop` / `ending.yard` (beats, chosen by flag `coop_success`, set in `m.a2.01` from the `mini8w` result) |

Acts 2–3 generated refs: 18 (8 + 10), of which 6 establish × 8 s and 12 beats × 14 s = 216 s (Part D §D9, priority 4). Acts 2–3 add $70k–$110k of rewards in total (design band; balanced by the economy harness `tools/ci/econ-sim`, owner S01, with story and racing sections from S03 and S06).

## B7. Unlock events (R-MODE-05)

| Unlock id | Emitted by | Grants (C06 `UnlockDef.grants`) | Notes |
|---|---|---|---|
| `unlock.racing` | first racing hook: m.a1.03 (ModeHost on entry, or the VM on the stub path) | `menuTile: 'racing'` | standalone menu exposes free events in districts with `unlock.district.*` [research/gamedesign-decomposition.md §3.10] |
| `unlock.fighter` | first fighter hook: m.a1.05 | `menuTile: 'fighter'`, `fighters: [player fighter]` | |
| `unlock.tycoon` | first tycoon hook: m.a2.01 | `menuTile: 'tycoon'` | Act 2 opener, consistent with S08's research input [research/gamedesign-decomposition.md §5.11] |
| `unlock.fighter.rap_new_wave`, `.ath_power_back`, `.rap_lyricist` | mission pass (m.a1.05, m.a2.08, m.a3.04) | `fighters: [<resolved soul id>]` | a killed slot grants its stand-in |
| `unlock.district.d1` … `d10` | first pass of a mission in that district | `districts: ['dN']` | racing free roam and Jobs-app filters |
| `unlock.racing.event.sf.hillclimb.filbert-hyde`, `unlock.racing.robotaxi` | m.a2.02, m.a2.03 pass | S06 `UnlockDef`s (`06-racing-data.md` §4.4) | registered by S06, not in the story's `config/unlocks.json` rows |

The ids are lowercase and sorted in `CoreSlice.unlocks`. Their `UnlockDef`s are added to `config/unlocks.json` in M05c1 (racing, fighter, districts) and M05e (tycoon and the rest). Main-menu tiles, toasts and the NEW badge are S10's flow (`10-ui.md` §5, item 3). A-06 still applies: a mode whose milestone has not shipped shows `comingSoon` even when unlocked.

## B8. Safehouses, shops and the open world in Act 1

- **Safehouses** (StorySlice `property.safehouses`). `sh.yard` (Bayview shipyard garage) is granted in m.a1.01: save point, wardrobe, 4 garage slots, respawn, sleep. `sh.mission_flat` (D2) can be bought for $8,000 after m.a1.06. The SoMa loft arrives in Act 2.
- **Shops in M05c.** One body shop (Dogpatch, respray $500), one clothing shop (D2), and one car lot (D1, compact $8,000 to sedan $14,000) [research/gamedesign-decomposition.md §2.9].
- **Free roam.** All of SF is roamable from the start. Districts are unlocked for menus, not walled. Side activities (odd-job deliveries, fares) run only when no story mission is active.
