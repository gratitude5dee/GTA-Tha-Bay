# 07 — Fighter (S07), part C: roster, stages, cutscenes, assets, progression

> S07, Wave 3, 2026-10-18. Part of `spec/domains/07-fighter.md`. Core rules are in `07-fighter-core.md` (`FC#`), pose mode in `07-fighter-pose.md` (`FP#`). Honors 06 v1.0 (C05, C06, C07, C09 fixed lines, C10, C13), `spec/03` D-18, D-19, D-20, D-29, D-30, `research/legal-ip-likeness.md`. Section ids `FX1…FX11`. No real person is named in this repository file: slots are tied to subject classes by pointing at rows of `research/legal-ip-likeness.md` §3.3; real names live only in the server-side `NameRegistry` (R-IP-02, `names:lint`).

## FX1 Roster: archetype slots ↔ characters ↔ tiers

The per-character research layer (`research/characters/<slug>/…`) is not in the repository (Q-19). The roster is therefore **data**: `content/fighter/roster.json`, loaded when S04 supplies souls. Development and CI use original test characters (`npc_test`, one `fictionalized` canary) bound to the same slots. A kit (frame data) is bound to a **slot**, never to a person, so replacing a character (kill-switch, consent upgrade) changes no frame data.

```ts
// content/fighter/roster.json  (JSON Schema: packages/shared/src/fight/schema/roster.v1.schema.json)
export interface RosterEntry {
  slot: SlotId; kit: string;                                    // content/fighter/kits/<kit>.json
  fighterId: FighterId; soulVersion: number;                    // soul id = C07 slug; integer (C10 fixed)
  expectedTier: 'consented' | 'parody' | 'fictionalized' | 'original';   // CI: must equal the compiled soul's tier
  assets: { model: AssetRef; animBase: AssetRef; animMoves: AssetRef; portrait: AssetRef; voice?: AssetRef };   // C07 `<kind>/<id>` (DL-053)
  standIn: { fighterId: FighterId; assets: RosterEntry['assets'] };    // mandatory for tier ≠ original (C10 `standIn`)
  homeStage: StageId; v1: boolean;
}
```

| Slot | Family | Kit role | v1 (8) | Subject class: `research/legal-ip-likeness.md` §3.3 row | Default tier (G2, D-29) | Consent path | Fame-domain exclusion |
|---|---|---|---|---|---|---|---|
| `RAP_HYPHY_ELDER` | Rap | rushdown, short install | yes | living Bay artist rows (hyphy era). The deceased-artist row is **not** assigned: a homage would be `fictionalized` and needs estate outreach first | `parody` | management | `rap_performance` |
| `RAP_LYRICIST` | Rap | zoner, string cancels | yes | living veteran artist row | `parody` | management | `rap_performance` |
| `RAP_NEW_WAVE` | Creator | mix-up, floor traps | yes (VS opponent) | living younger-artist rows | `parody` | direct outreach is realistic: candidate for `consented` | `rap_performance` |
| `TECH_VISIONARY` | Tech | setplay, drones | yes | founders-of-real-companies row | `fictionalized` | none | none (invented character) |
| `TECH_HACKER` | Tech | feints, counters | yes | living tech-influencer rows | `parody` | best first consent target | `streaming` |
| `ATH_SHOOTER` | Sport | long-range arcs | yes | living basketball-player row | `parody` | agency deal only | `basketball` |
| `ATH_POWER_BACK` | Sport | armored grappler | yes | retired football-player row | `parody` | management | `football` |
| `INFLUENCER` | Creator | seeded buffs | yes | living tech-influencer rows | `parody` | best first consent target | `streaming` |
| `RAP_COLLECTIVE` | Rap | crew assists | reserve | original crew (no real subject) | `original` | n/a | n/a |
| `TECH_VC` | Tech | meter powerhouse | reserve | original investor character | `fictionalized` | n/a | n/a |
| `PLAYER_FIGHTER` | — | balanced, player's created character | yes | none (player avatar) | `original` | n/a | n/a |
| `USER_NPC` | — | one of four template kits | **out of v1** | user content | forced `fictionalized` if a real person is suspected | n/a | n/a |

- v1 ladder = 4 families × 2 = 8 fighters + `PLAYER_FIGHTER`. The 12-fighter target is: the 8, the two reserve slots, and two further `original` characters chosen after the M08b balance run (decision S07-D2).
- `USER_NPC` fighters are out of v1: they need the moderation queue (R-IP-03, M06b) and a template-kit adapter (≤ 0.3 session); revisit after M13c. Reason: no custom frame data in v1 and user NPCs may not embed first-party parody characters.
- Upgrading a tier needs a `consent_record` and an S04 PR; the kit does not change. Downgrading is immediate (legal §3, L1).

## FX2 Kits: signature mechanics and shipped names

Common mapping in Simple: `SP` neutral → special 1, `SP + 6` → special 2, `SP + 2` → special 3 (FC5.4). All names below are original; research names that echo a catchphrase, mark or fame-domain performance were replaced (table at the end of this section). Frame numbers per kit live in `content/fighter/kits/<slot>.json` (FX3 gives the full reference kit). Health defaults to 10,000.

| Slot | Walk f/b (u per frame) | Gimmick (state words) | Special 1 | Special 2 | Special 3 | Super L2 (2,000) / Showstopper (3,000) | Shutdown |
|---|---|---|---|---|---|---|---|
| `RAP_HYPHY_ELDER` (health 9,500) | 80 / 58 | `frenzy` (G0 timer): once per round, 360 frames: walk and dash +25 %, normals −2 startup (min 3) | **Slang Wave** `236`: sine-path projectile, speech-bubble sigil | **Skid Dash** `214`: low-profile dash into a 40-frame bounce stance with three follow-ups (low, overhead, grab) | **Frenzy** `22`: starts the install, costs 1,000 Hype | Turf Rush / Overdrive | Sigil Storm: a swarm of sigils spells a word over the victim |
| `RAP_LYRICIST` | 62 / 48 | `string` (G0): after a special connects or is blocked, one more special may be cancelled in, max 2 per touch | **Word Salvo** `236`: three-hit projectile (`multi`) | **Rewind** `214`: retreat hop that leaves an air projectile | **Hard Stop** `623`: anti-air | Wall of Words / Final Draft | Strikethrough: a giant strikethrough line crosses the victim |
| `RAP_NEW_WAVE` | 70 / 55 | `pulse` (G0 count): up to 2 floor traps (`trap`, 360 frames) | **Pulse Marker** `236`: place a marker near, mid or far by button | **Step Dash** `214`: under-cross dash, throw-invulnerable 1–8 | **Detonate** `22`: triggers placed markers | Marker Chain / Floor Takeover | Banner Drop: a heavy banner and confetti bury the victim |
| `TECH_VISIONARY` | 60 / 46 | `agents` (G0 count): up to 2 orbiting drones (`orbit`) | **Dispatch Agent** `236`: sends a drone to hover and fire | **Pivot** `214`: teleport cancel (1,800 u), once per round per 1,000 Hype | **Recall** `623`: drones return as a guard shield | Roadmap Rush / Hard Pivot | Term-Sheet Blizzard: paper rains over the victim |
| `TECH_HACKER` | 68 / 52 | `patch` (G0): counter stance absorbs one strike and answers; `glitch` feint | **Patch** `236` (stance, 24 frames) | **Glitch Step** `214`: advance 600 u with two frames skipped | **Echo** `623`: fires a copy at 60 % damage of the projectile the opponent last used this round | Hotfix Barrage / Rollback | Blue Screen: a fake system-error panel drops over the victim |
| `ATH_SHOOTER` | 58 / 50 | `charge` (G0 0–40): button held up to 40 frames sets arc level 1–3 (600 / 900 / 1,300 damage) | **Arc Shot** `236` (hold): `arc` projectile, a gumball, not a ball-sport prop | **Backstep Fade** `214`: backstep, strike-invulnerable 1–10 | **Lob Cover** `22`: steep anti-air lob | Triple Arc / Gumball Volley | Gumball Avalanche |
| `ATH_POWER_BACK` (health 10,500) | 52 / 42 | `armor` (G0): forward specials carry 1 armor hit | **Shoulder Charge** `236`: armored advance | **Collar Toss** `63214`: command grab | **Brace** `22`: 40-frame stance, 2 armor hits | Wrecking Run / Full Clearance | Cushion Collapse: cartoon cushions bury the victim |
| `INFLUENCER` | 66 / 52 | `poll` (G0 buff id, G1 timer): at round start the `fight` stream orders three buffs (Hype +50 %, walk +15 %, 1 armor tick), cycling every 600 frames, shown on the HUD | **Hot Take** `236`: short quick projectile | **Swap Places** `214`: swap sides with the opponent once per round | **Poll Pop** `22`: bursts the current buff as a damage zone | Viral Moment / Trending | Notification Flood: cartoon badges bury the victim |

Reserve kits: `RAP_COLLECTIVE` calls crew assists (`summon`, Hype cost); `TECH_VC` gains Hype from opponent whiffs and spends it faster ("dilution").

**Name hygiene.** Research names were changed where they echo marks, catchphrases or a fame domain [research/legal-ip-likeness.md §3.3, L1]:

| Research name | Shipped | Reason |
|---|---|---|
| "Go Dumb" install | Frenzy | slang tied to artists' catchphrases |
| bars as projectiles, "Freestyle" cancels | Word Salvo, string cancels | no depiction of performing; no mic, beat or lyric staging |
| beat-drop traps, dance-step dash | Pulse Marker, Step Dash | music-performance framing |
| 3-point arcing projectile | Arc Shot (gumball) | basketball is the subject's fame domain |
| "Stiff Arm" | Collar Toss | football term; no pads, helmets, numbers or jerseys |
| "Chat votes" | Poll | generic |

`fighter:lint` checks every `MoveDef.tags`, `nameKey` text and prop id against `config/fame-domains.json` (domain → forbidden keywords, e.g. `rap_performance`: mic, song, lyric, verse, beat, track, perform, concert, stage light; `basketball`: hoop, dunk, court, jersey, three-pointer; `football`: tackle, pads, helmet, endzone, jersey; `streaming`: stream, subscribe, viewer, donate). A kit tagged with a keyword of its slot's soul `fame_domain` fails the build (legal L3 `fame_domain` check).

## FX3 Reference kit: PLAYER_FIGHTER (VS-Fighter content, M08a)

`PLAYER_FIGHTER` is balanced and shoto-like; its style kit comes from the creator preset and also feeds open-world melee through `CombatApi` (a subset, FX8). Twelve moves, Classic notation; Simple uses `L`/`H` and `SP`. Advantage is derived (FC1.2).

| Move | Input | S | A | R | Hitstun | Blockstun | advHit | advBlock | Dmg | Guard | Hitstop | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 5L | LP | 4 | 2 | 8 | 13 | 10 | +4 | +1 | 300 | mid | 8 | chain, special cancel; Hype 40/20/0 |
| 5M | MP | 6 | 3 | 12 | 19 | 13 | +5 | −1 | 600 | mid | 10 | chain, special cancel |
| 5H | HP | 10 | 4 | 17 | 23 | 16 | +3 | −4 | 900 | mid | 12 | special cancel; push 300/400 |
| 2L | 2 LP | 4 | 2 | 7 | 12 | 10 | +4 | +2 | 250 | low | 8 | chain, special cancel |
| 2M | 2 MP | 7 | 3 | 13 | 19 | 13 | +4 | −2 | 550 | low | 10 | special cancel |
| 2H | 2 HP | 11 | 4 | 22 | hard KD | 16 | — | −9 | 800 | low | 12 | sweep |
| jM | air MP | 6 | 8 | land 3 | 18 | 14 | n/a | n/a | 650 | high | 10 | air normal |
| Throw | LP+LK / L+H | 5 | 2 | 19 | hard KD | — | — | — | 1,000 | throw | 14 | throw box 900 u; tech window 7 |
| Spark Toss | 236 + P | 13 (release) | 1 | 34 | 22 (proj) | 16 (proj) | proj | proj | 700 | mid | 10 | speed 50 u/f, life 90; EX 70 u/f, 2 hits |
| Uplift | 623 + P | 4 | 10 | 30 | launch, hard KD | 14 | launch | −25 | 1,000 | mid | 12 | strike-invulnerable 1–8; juggle limit 3 |
| Skid Kick | 214 + K | 11 | 9 | 16 | 26 | 19 | +2 | −5 | 700 | low | 12 | travels 1,100 u |
| Surge (L2) | 236236 + P | 6 + 45 freeze | 14 | 38 | launch | 20 | — | −31 | 2,200 | mid | freeze | all-invulnerable 1–10, three hits; min scale 40 %; chip 150 ‰ |

Showstopper, Shutdown and Taunt for the reference kit are authored in M08b (damage 3,200 at 50 % minimum scale; Shutdown 170 frames). `RAP_NEW_WAVE` (the second VS fighter) copies the normals with ±1–2 frame offsets and replaces the specials with Pulse Marker, Step Dash and Detonate.

## FX4 Likeness, depiction and kill-switch enforcement (R-IP-02, R-NPC-04, D-29, D-30)

1. **Tier source.** The tier is read from the compiled soul at load, never from fighter data. `roster.json` carries `expectedTier`; CI (`likeness:gate` extension) fails on mismatch, on a missing `standIn`, and on a `parody` soul whose `fame_domain` matches a kit tag or a stage tag.
2. **Fame-domain exclusion.** `config/fame-domains.json` also lists forbidden fighter × stage pairs: a `basketball` fighter cannot select or be assigned `mission_bay_court` (stage tag `arena_court`); selection UI hides the pair and Arcade ladder generation skips it.
3. **`parody` presentation.** Altered name, text-derived stylized model, no tattoos, jerseys, numbers or logos, no catchphrases. The character-select card and the first-appearance card show "Parody. Not affiliated with or endorsed by any real person."; `fictionalized` shows "Fictional character."; the "AI character" badge appears wherever generated speech is shown (legal L1, NPC rec 14).
4. **No marketing.** Select-screen art, portraits and cutscene posters are excluded from share/OG images (`marketing_allowed = false` for every non-`consented` soul); photo mode in the fighter is off.
5. **Depiction rules.** Bouts are framed as sport/exhibition (`BoutDef.exhibition: true` is required whenever an opponent is real-derived; CI). No blood, gore, weapons or firearms; finishers are comedic (FC8.3); no arrest, crime, drugs or sexual content; KOs are non-lethal. Trash talk stays inside the soul `rails`; no real-world references.
6. **Alcatraz.** `alcatraz_yard` is dressed as the island's museum state (open yard, signage, no cells in frame, no uniforms, no handcuffs, no guards). A real-derived fighter on this stage must not read as a prisoner (false-light risk, [research/legal-ip-likeness.md §3.2]).
7. **Kill-switch.** `RosterFlags.killed[fighterId].scope` containing `fighter` or `all` (C12 route 30). The client re-fetches the roster flags on app start, on mode entry, on opening character select and every 10 minutes, and takes the push path of the EncounterDO broadcast where connected; the target is live removal within 60 s [research/legal-ip-likeness.md L4]. Effects: removed from select and Arcade ladder; saved `lastLoadout` and ladder slots remap to `standIn` (same kit, original name and design, pre-generated clips none); the fighter's cutscene refs drop out of the manifest (`kill_switched` → fallback F8); `WorldPackStore.evictByTag('char:<id>')` removes local assets. A match in progress finishes, then returns to select; nothing is purged mid-round. Scope `cutscene` alone leaves the fighter playable with in-engine intros.
8. **Stand-in clips.** Stand-ins have no pre-generated clips; they use in-engine intros until staff run a targeted prewarm (`assets:gen prewarm --fighters <id>`).
9. **UGC.** First-party parody characters never appear in user experiences or mods [research/legal-ip-likeness.md L3, UGC row]. The frame-data pack is immutable in v1; `rules`-kind mods cannot alter it.

## FX5 Stages

```ts
// content/fighter/stages/<id>.json
export type StageId = 'powell_turntable' | 'ferry_plaza' | 'dolores_slope' | 'bayview_cranes' | 'alcatraz_yard' | 'mission_bay_court'
  | 'lombard_switchbacks' | 'coit_top' | 'ggpark_bandshell' | 'twin_peaks_night';
export interface StageDef {
  id: StageId; nameKey: string; district: string;               // display only; C08 district id
  landmarkRefs: AssetRef[];                                     // S02 landmark glTFs (A-05), `building/<id>` or `prop/<id>`
  scene: { day: AssetRef; night: AssetRef };                    // `prop/stage-<id>-day|night`: one diorama bundle, C07 tier variants
  halfWidth: U;                                                 // 6,000 default
  camera: { minD: number; maxD: number; a: number; b: number; fovDeg: number; height: number; damping: number };   // FC8.4
  tags: string[];                                               // e.g. 'arena_court', 'waterfront', 'museum'
  hazards: { id: string; defaultOn: false }[];                  // cosmetic background events only in v1
  music: AssetRef; ambience: AssetRef; crowd: 'none' | 'sparse' | 'dense';
}
```

| Stage | Landmark (open-data geometry, original art) | Notes | Milestone |
|---|---|---|---|
| `powell_turntable` | Powell & Market cable-car turntable | cable car crosses the background; story bout A5 | M08a (gray box), M08b |
| `ferry_plaza` | Ferry Building plaza and clock tower | ferries and water in depth | M08b |
| `dolores_slope` | Dolores Park slope | the stage floor is flat; the slope is backdrop | M08b |
| `bayview_cranes` | Bayview shipyard under the cranes | industrial, night default | M08b |
| `alcatraz_yard` | Alcatraz island yard | museum state (FX4.6); story bout A11 | M08b |
| `mission_bay_court` | Mission Bay arena analogue, fictional venue name | `arena_court`; basketball-domain fighters excluded | M08b |
| `lombard_switchbacks`, `coit_top`, `ggpark_bandshell`, `twin_peaks_night` | backlog | Lombard needs camera tilt | M10+ |

All stages are SF-only (owner update 2026-10-18). Stages are C07 `prop` bundles loaded through `ModeContext.assets`; the mode declares `world: 'stage'` and does not stream a C08 chunk (assumption on S02, hub §10). No landmark name or silhouette is used as a logo, no mural or public art is reproduced, venue and team names are fictional [research/legal-ip-likeness.md §6, "Landmark marks" and "Sponsored venue names"].

**Stage budgets** (fight-stage scenario; each at most 60 % of the C13 render-object and triangle budget, 50 % of texture MB, leaving room for two fighters, effects and HUD) [spec/domains/11-platform.md §4.5 values]:

| Tier | Render objects | Triangles | Fighter variant tris† |
|---|---|---|---|
| desktop-ultra / desktop | 540 / 360 | 3.6 M / 2.4 M | 30,000 |
| mobile / mobile-low | 90 / 60 | 0.6 M / 0.36 M | 18,000 / 12,000 |
| xr-quest (per pass) | 90 | 0.45 M | 12,000 |
| xr-visionpro (per pass) | 120 | 0.9 M | 24,000 |

Shadows follow the tier (`blob` on `mobile-low` and Quest). Hit sparks and projectiles are one `InstancedMesh` each, at most 16 live sparks. Day or night is a stage-select choice or a seeded pick; a `stage` mode does not use the world clock.

## FX6 Cutscene hooks, keys and prewarm counts (R-CUT-01…03)

**FX6.1 Hook table.** Templates are S07's, registered in `content/prompts/genai/` with the style bible; keys follow A-03 and are computed by the release tool, not at runtime (C09 fixed line: a release `cutscene-index` maps `CutsceneRef → key`).

| Hook (R-CUT-02) | Template | `CutsceneRef` | Subjects | Count (N=8, S=6) |
|---|---|---|---|---|
| fight intro, part 1 | `fight.walkin@1` | `fight.walkin/<fighterId>/<stageId>` | one fighter on one stage | N×S = 48 |
| fight intro, part 2 | `fight.faceoff@1` | `fight.faceoff/<idA>+<idB>` (ids sorted) | a pair, stage-neutral backdrop | N(N−1)/2 = 28 |
| special move | `fight.special@1` | `fight.special/<fighterId>/<moveId>` | signature special, victim-agnostic | N = 8 |
| super | `fight.super@1` | `fight.super/<fighterId>/<moveId>` | L2 and Showstopper | 2N = 16 |
| finisher | `fight.shutdown@1` | `fight.shutdown/<fighterId>` | victim-agnostic | N = 8 |
| fight ending | `fight.ending@1` | `fight.ending/<fighterId>` | the winner | N = 8 |
| **Total** | | | | **116** |

Scaling [research/gamedesign-decomposition.md §4.5]: N=10, S=6 → 155; N=12, S=8 → 222. A pair-by-stage intro (168 or 528 clips) is rejected. Specials, supers and shutdowns are victim-agnostic; the victim appears only in an in-engine reaction cut after the clip.

**FX6.2 Key inputs** (A-03; `canonicalize` + `sha256Hex` from `packages/shared`, computed by `tools/assets cutscene-index`): `{ templateId@ver, characters: [{id, soulVersion, likenessTier}] sorted by id, move?: moveId@ver, stage?: stageId@ver, style: 'bay-cel@2', endpointId@pinnedUpdatedAt, seed, inputHashes }`. `inputHashes` are SHA-256 of the reference crops and the stage plate, never URLs. Licence status is not in the key. A soul-version, tier, stage, move or endpoint change makes a new key; old keys are garbage-collected, never overwritten.

**FX6.3 Generation recipe.** Walk-ins and face-offs use the registry's reference-to-video entry (`minimax/h3-max/reference-to-video` by registry key, ≤ 4 square crops from the approved first-party sheet, 768P, 5 s, `prompt_expansion_mode: disabled`, fixed seed) [research/genai-pipeline-fal.md Recipe R, F-040]; specials, supers, shutdowns and endings use the keyframe-first recipe. Both are gated by `config/genai-endpoints.json`: while ADR-GENAI-01 is open the production default is the registry fallback (Q-03). Cost: N=8 is 116 clips, about $70 at the Ref2V list price with 1.5× retakes [research/genai-pipeline-fal.md Fighter clip set]. On the `ltx25.fast` fallback (6 s minimum) the whole v1 video set with 8 fighters is $296.5 including the story set, inside the G3 cap; with 12 fighters it goes over the cap, which is Q-14 [spec/domains/05-assets-pipeline.md §11]. Prompts never contain real names, franchises, artists or "in the style of"; presets are non-photoreal for every non-`consented` character.

**FX6.4 Intro playback** (R-CUT-03). After stage confirm the mode calls `CutscenePlayer.playSequence([{ref, fallback}…])` with the three segments `[walkin(A), walkin(B), faceoff(A,B)]` (assumption on S03, hub §10). `PLAYER_FIGHTER` has no clips, so its segments and every pair segment containing it use the in-engine director fallback (1.6 s side-view walk-in with a name card; 2 s face-off); clips therefore play only in roster-versus-roster bouts (Versus, Arcade as a roster fighter, exhibition attract). At stage confirm the mode prefetches all ready clips into memory (the S03 rule: `v540` on `mobile`, `v768` elsewhere, ≈ 1–3 MB and 3–8 MB per clip [research/gap-cutscene-delivery-playback.md §7.5]); the `Load` phase waits at most 1.5 s for prefetched clips, 2.5 s otherwise, then falls back per segment (F1–F10). Any attack button skips. The match never waits for generation.

**FX6.5 In-fight and result cinematics.** Only Showstopper and Shutdown clips may interrupt a fight, through `Cinematic` (FC3), and only when the setting `cinematics` is `first` (default: once per profile per fighter, tracked in `FighterSlice.settings.seenReveal`) or `always`. Never in Training, online, or when the clip is not ready. Signature-special and L2 clips play in the Move Gallery and at the fighter's unlock reveal. Endings play after `MatchEnd` in Versus and Arcade; story bouts return directly to the mission. XR plays them on the S11 panel (`XrMediaHost`). Telemetry uses the existing `cutscene.play` (`fallback`, `reason`).

**FX6.6 Prewarm and CI.** `pnpm assets:gen prewarm --release <tag>` reads `content/fighter/cutscenes.json` (all refs for the frozen v1 roster) through the shared cutscene-index step; a second run makes zero vendor calls. `check:assets` fails a release whose fighter refs lack an in-engine fallback. Whether a ready clip exists is not a release gate while the provider is `pending`.

## FX7 Animation, audio and assets

**AnimStateId block (proposal; Architect assigns by ADR).** S06 128–159, **S07 160–207**, S08 208–255. Network `anim` is the u8 state; the move being played is `FighterView.move` plus frame.

| Ids | States |
|---|---|
| 160–165 | idle, walk F, walk B, crouch, crouch-down, stand-up |
| 166–173 | pre-jump, jump N/F/B, fall, land, dash F, dash B |
| 174–183 | block stand, block crouch, hit stand, hit heavy, hit crouch, hit air, knockdown fall, knockdown lie, wakeup, quick rise |
| 184–195 | throw attempt, thrown, tech, attack (move-driven), special (move-driven), super start, super (move-driven), check, check success, clear, rattled, taunt |
| 196–205 | intro, round win, round lose, KO, slumped, shutdown (move-driven), time-out lose, victory, defeat, summon call |
| 206–207 | reserved |

**Clips.** The shipped target is 60–80 clips per fighter [research/gamedesign-decomposition.md §4.12] built from one shared base set authored once on the mannequin (about 45: all normals, throws, reactions, movement, KO) plus 12–16 signature clips per fighter, retargeted per fighter by `pnpm assets:retarget --rig bay_rig_v1 --clips <glb> --to <slug>` (output `anim/<slug>.moves`, clip name = move id, 60 fps when S07 asks, never retargeted at runtime on mobile) [spec/domains/05-assets-pipeline.md §4]. Base locomotion clips come from the Meshy library clips (`anim/<slug>.base`). The human Blender effort is the schedule risk (decision S07-D1).

**Frame-locked player.** Move states do not use the generic `AnimGraph` time. The mode UI owns `FrameLockedClipPlayer` (three `AnimationMixer`, explicit time): clip time = `FighterView.frame / 60`, so animation never drifts from frame data; non-move states use the generic graph with `anim/<slug>.base`. Presentation never feeds back into the sim (C02 determinism rule 7).

**C07 assets per roster fighter** (all with provenance and the `likeness` block; `check:assets` resolves each for all six tiers):

| Asset | Kind and id | Source |
|---|---|---|
| model | `character/<slug>` | S05 pipeline (M10a); gray-box until then |
| base clips, move clips | `anim/<slug>.base`, `anim/<slug>.moves` | Meshy library, authored + retargeted |
| portrait | `portrait/<slug>` | S05 |
| voice, barks | `voice/<slug>`, `audio_bark/<sha256>` | S04/S05 voice tiers (D-23) |
| stage | `prop/stage-<id>-day`, `prop/stage-<id>-night` | authored by S07/S02 over open-data massing |
| sparks, props | `prop/fx-spark`, `prop/gumball-arc`, …, `texture/*` | authored |
| FX audio | `audio_sfx/*`, `audio_music/*` | `content/audio/needs.json` rows: hit layers per strength (×3 variants), whoosh, block, Check ping, KO, announcer set, crowd reactions, six stage tracks (original only, Q-11) |

The announcer is an original synthetic voice, never a real person's clone. Gray-box models (M08a) are procedural capsule-and-box meshes with `origin: authored`.

## FX8 Progression, unlocks, story hooks (R-MODE-05)

1. **Descriptor** (C06): `id 'fighter'`, `unlock 'unlock.fighter'`, `standalone: true`, `embeddable: true`, `requires {simProfile:'any', world:'stage', physics:false, xr:'seated', inputContexts:['fighter','menu','cutscene'], network:'optional'}`, `saveSlot 'mode:fighter'`, `sliceSchema 1`. It registers as `comingSoon` until M08a (A-06).
2. **Unlocks.** `unlock.fighter` is emitted by the first story fight (mission A5, Premise A). Each roster fighter has `unlock.fighter.<slot lowercased>` with `grants.fighters: [fighterId]`. Initial selectable set: `PLAYER_FIGHTER` and the A5 opponent. Beating a roster fighter in the Arcade ladder, or in a story bout, emits that fighter's unlock; ladder order is data (`content/fighter/arcade.json`). Costumes unlock by `fighterXp` levels (cosmetic only; no stat changes).
3. **Story hook.** C09 `mode({mode:'fighter', defId:'bout.a5', stub})` starts a child through `ModeContext.startChild`. Premise A ships two bouts: `bout.a5` (Powell & Market, `RAP_NEW_WAVE`, level Normal) and `bout.a11` (`alcatraz_yard`, `ATH_POWER_BACK`, level Hard). Premises B and C bouts are data added when those premises ship. The stub (scripted brawl) stays as the C09 fallback.

```ts
export interface BoutDef { id: string; p1: 'player' | SlotId; p2: SlotId; stage: StageId; cpu: 0 | 1 | 2 | 3;
  rules: Partial<FightRules>; exhibition: true; reward: { cashCents: number; streetCred: number; xp: number } }
```
4. **Result.** `ModeResult {outcome:'win'|'lose', data:{streetCred, rounds, durationSec}, rewards:{cashCents}}`; ModeHost applies cash through `EconomyApi` with key `mode:fighter:<seed>:<tick>`; Story applies `streetCred` from `data` (assumption on S03). Losing a bout never fails the mission by itself; the mission script decides. `autoBlockStoryFights` (C05 accessibility) sets `FighterLoadout.autoBlock` for story bouts.
5. **Open-world melee.** `CombatApi` is implemented in the engine over `packages/shared/src/fight` with a reduced move set (3 moves at M05c via the stub, the shared core from M08a): `world.brawl` kit, 60 Hz frame data, capsule hitboxes, non-lethal KO (`Health.ko`).
6. **Telemetry** (proposals to S09, C16 closed registry): `fight.end` `{mode, scheme, cpu, rounds, winnerSlot, durationS, pose: boolean}` and `pose.session` (FP8). Existing names used: `mode.enter`, `mode.exit`, `cutscene.play`, `pose.calibrate`.

## FX9 Menus, HUD, accessibility (R-ENG-04)

- **Screens (S10 `UiSurface`/ViewModel):** mode hub (Arcade, Versus, Training, Pose Setup, Move Gallery, Controls); character select with portrait, tier line (FX4.3), locked silhouettes; stage select (six, day/night, random); loading; HUD; pause with move list per scheme (shows derived frame data); results.
- **HUD:** two health bars with names and round pips; timer; Hype as three diamonds; Composure as six squares with a hatched Rattled state; combo counter with scaling %; optional input display; Simple-scheme hints. Colour is never the only cue (colorblind palettes `deutan`, `protan`, `tritan` from C05 settings, shapes and patterns).
- **Controls:** every `SimButton` remappable (C03 rule 9); hold-to-toggle for `BL`; touch layout: stick, four buttons (L, H, Special, Assist), Hype, Dash, with the C03 layout editor; Classic is hidden on phones by default.
- **Accessibility:** subtitles for announcer and trash talk; reduced motion removes shake, dolly and super flash (replaced by a 3-frame dim); timer scaling `timerScale` applies to story bouts; infinite timer in Versus and Training; auto-block in story fights; no strobe above 3 flashes per second in any effect (super freeze and Shutdown included).

## FX10 Platform rules for XR (hand-off to M11b2; `11-platform-xr.md` §5.3)

Culture Wars in XR is a fixed arena: a **tabletop diorama** in front of the player (`arenaScale: 'tabletop'`, life-size optional), no artificial locomotion, camera dolly only, no shake or super-zoom (C04 rule 5). Sim stays 60 Hz; render is 72/90.

| Input | Mapping (Simple scheme; indices from `config/xr-input-profiles.json`, face buttons never the only route, U-ENG-5) |
|---|---|
| Controllers | trigger → L, squeeze → H, trigger + squeeze → SP, thumbstick → move (up jump, down crouch), thumbstick press → AS, Hype on a face button where the profile is known, otherwise grip + trigger chord |
| Hands (Quest hands, Vision Pro) | right-hand punch (`xr:right:gesture:punch`) → L, left-hand punch → H, both hands push → SP, both fists near face → BL, pinch-drag on a world-locked stick disc → move; Vision Pro is hands only, never gaze-only |
| Menus | `UiSurface` panels at `uiDistanceM` (C13 `XrComfortSettings`) |

Cutscenes use the S11 hosts (Quest `XRMediaBinding` quad layer with MSE, Vision Pro `VideoFrameTexture`). Webcam pose mode is not offered in XR (camera access on Quest is unconfirmed, Q-GD-08). Thresholds for punches live in `config/xr-gestures.json` (S11) and are tuned on device in M11b2.

## FX11 Content CI summary

`check:fighter` (new alias, proposal to S13) runs: kit and stage JSON Schema; `fighter:lint`; roster completeness (every slot resolves model, clips, portrait, stand-in for all six tiers); tier and fame-domain gates; replay verification of the golden `.dvfight` files; a 28-pair × 100-bout smoke of `fighter:balance` (≥ 35–65 % win rate in M08b). `names:lint` and `likeness:gate` already cover display names and tiers; `ip:strings` covers prompt templates.
