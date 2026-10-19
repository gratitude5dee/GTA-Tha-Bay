# M10e — audio-integration

## Goal
After this session every audio set the game needs is final v1 audio or a recorded, owner-defaulted silence, and no placeholder audio can reach a release unnoticed (DL-500). It fills every row of `content/audio/needs.json` (`05-assets-pipeline.md` §8.7): the racing sets of `06-racing-content.md` C.7 (replacing M07b2's placeholders), the fighter FX audio row of `07-fighter-content.md` (hit layers, whoosh, block, Check ping, KO, announcer, crowd reactions, six stage tracks), the city sets (sirens per police unit tier, ambience beds per district) and the story music cues (`DirectorScript.music`). It integrates the commissioned music stems with their work-for-hire records (§8.1, Q-11) and extends M10d2's `assets:final` scan to audio, so M14b3's `art-final` gate covers audio without a new gate. With no stems supplied, the music rows stay silent under the Q-40 default; AI-assisted or Builder-composed music never ships (§8.2).

## Requirements
- R-MODE-02 (support): the racing audio sets (engine per class, tire, impact, nitro, shift, race UI, announcer, scanner, race music) are final.
- R-MODE-03 (support): fighter hit layers, announcer, crowd and the six stage tracks are final.
- R-MAP-04 (support): the living city has siren sets per police unit tier and day and night ambience beds per district.
- R-ENG-04 (support): every new announcer, scanner and crowd line has subtitle text.
- R-IP-01: every new audio file has a provenance record, an admitted licence or a work-for-hire record, and passes `ip:strings` and `names:lint`.

## Depends on
- **M10d2:** `assets:final` (`tools/assets/src/final.ts`, `artFinal()` rules 1–3), `config/art-placeholders.json` and its schema; through it **M10d1** and **M10d3** (stage refs on final dioramas).
- **M07b2:** racing rows of `content/audio/needs.json`, placeholder racing audio with provenance, `packages/modes/racing/src/client/audio-mixer.ts`.
- **M08b2:** six `content/fighter/stages/<id>.json` with `music`, `ambience` and `crowd`; announcer and talk subtitles (FX9).
- **M05f2:** all three acts compiled; through it **M05a1** (`missions:build` writes `content/audio-needs/story.json`) and the DirectorScripts with `music?` cues.
- **M10c:** the `npc:bake-barks --render` route (Workers AI voice render plus cues into `audio_bark` assets), reused here for original announcer, scanner and crowd lines.
- **M03c:** police unit tiers and the `siren` and `loudspeaker` tactics (audio cues); **M02b2:** world clock and weather that switch the ambience beds; through the chain **M01b2** (`AudioService`, the eight buses, voice ducking).
- Contracts: C07 1.1 (`audio_music`, `audio_sfx`, `audio_bark`, `KindExtras` audio, `ProvenanceRecord` unchanged), C04 1.1 (`AudioService`, `AudioBusId`), C09 1.0 (`DirectorScript.music`).
- Owner: Q-11 (commissioned music), Q-40 (audio sourcing), Q-20 (voice tier). The defaults apply when they stay open.

## Scope in
- **Needs ledger:** `content/audio/needs.json` lists every §8.7 set with its owner (S06, S07, S02, S01, S03): racing C.7 sets; `fight.hit.<light|medium|heavy>` (three variants each), `fight.whoosh`, `fight.block`, `fight.check`, `fight.ko`, `fight.announcer`, `fight.crowd.<sparse|dense>`, `fight.stage.<id>` (6); `city.siren.<unitTier>` for each M03c unit tier, `police.loudspeaker`, `city.amb.<district>.{day,night}` for each C08 district of the v1 area, honk and traffic bed; `story.music.<cue>` for every `DirectorScript.music` cue of Acts 1–3, plus title and credits themes. A row resolves to catalog refs, or (music rows only) carries `silent: true` with `decision: 'Q-40'`. The schema gains the two optional fields.
- **Music** (§8.1, Q-11): supplied stems enter through `tools/assets/src/import/audio.ts` with the work-for-hire agreement in `docs/legal/licenses/`, `origin: authored`, `license: LicenseRef-DeeVerse-Owned`, 48 kHz stereo, ≤ 25 MiB per file, `extras.loop` for loops, and the §8.1 loudness targets (−16 LUFS integrated, −1.5 dBTP) checked by `tools/assets/src/audio-qa.ts`. `race.music` takes its four stems (calm, race, pursuit, results), each stage its `music` ref, each story cue its ref. Radio stays off unless the owner supplies tracks for fictional stations (§8.4).
- **Q-40 default (no stems at session start):** music rows get `silent: true`; the `music` bus plays nothing for them, `DirectorScript.music` and stage `music` refs are omitted or point at the silent row as the schema allows. No `elevenlabs/music/v2.5` placeholder and no Builder-composed music. The owner adds stems later at the same AssetIds without a code change.
- **SFX** (§8.5 order): authored or recorded originals, then verified CC0 or CC-BY-4.0 per file with licence snapshot and `credits.json` lines; with nothing supplied, the Builder writes a deterministic offline synthesis recipe `tools/assets/src/recipes/sfx.ts` (seeded, `origin: authored`) at the same AssetIds, mono, 48 kHz. Every M07b2 racing placeholder is replaced. No `fal-ai/elevenlabs/sound-effects/v2` call (registry `pending`) and no genAI spend (DL-OWN-01).
- **Voiced sets** (§8.6): original scripts `content/audio/scripts/{race-announcer, police-scanner, fight-announcer, crowd}.json`, each line with subtitle text, rendered through M10c's route with a designed or synthetic voice, `likeness.tier: original`. Without the Cloudflare key pair the render prints `SKIP … CLOUDFLARE_API_TOKEN not set`, those rows stay open and the report lists them under "Blocked on".
- **Wiring:** stage `music` and `ambience` refs in `content/fighter/stages/*.json`; `config/world/ambience.json` (district to day and night bed) read by `packages/world/src/client/ambience.ts`, which crossfades beds on the `ambience` bus by district and clock; siren sets per unit tier on the M03c emitters; the racing mixer reads the final engine sets.
- **Scan extension** (`artFinal()`, M10d2): rule 4 fails, naming file and ref, an audio asset referenced from `assets/prefabs/**`, `content/**`, `config/**` or the catalog whose provenance carries the `placeholder` tag, `generator.env: previs` or a `mock` reference (the predicate `provenance:check` already uses in release mode); rule 5 fails a needs row with no resolving ref, or a `silent` row that is not `audio_music` or has no `decision`. `config/art-placeholders.json` gains `owner: 'M10e'` rows for M07b2's placeholder racing audio, filled here; the schema's owner enum gains `M10e`.
- **Story lines (last, optional):** lines of `content/audio-needs/story.json` for t1 fictional speakers rendered through the same route; a line without audio stays text-only (`03-story-missions.md` C7), which is not a scan finding.

## Scope out
- Commissioning and paying composers or sound designers: owner (Q-11, Q-40). ElevenLabs t2 hero voices: Q-20.
- Roster barks and ink audio: M10c. Cutscene clip audio: M05b2, M10b. Mode logic, mixers and buses: M01b2, M07b2, M08b2 (wired here, not rebuilt).
- Final mix calibration on devices and spatial audio in XR: the M14b3 release device pass. Art: M10d1–M10d3.

## Deliverables
- `tools/assets/src/import/audio.ts`, `tools/assets/src/audio-qa.ts`, `tools/assets/src/recipes/sfx.ts` (recipe fallback only); `tools/assets/src/final.ts` (rules 4–5); `tools/assets/test/{audio-import, audio-qa, sfx-recipe, audio-final}.spec.ts`.
- `config/schemas/art-placeholders.schema.json` (owner `M10e`), the `content/audio/needs.json` schema (`silent`, `decision`), `config/art-placeholders.json` (M10e rows), `config/world/ambience.json`.
- `content/audio/needs.json` (every row), `content/audio/scripts/*.json` (4), `content/fighter/stages/*.json` (6, `music`, `ambience`).
- `packages/world/src/client/ambience.ts`, `packages/world/test/ambience.spec.ts`; `packages/modes/fighter/test/stage-audio.spec.ts`.
- `tests/e2e/audio.spec.ts` (`@audio-final`); QA bridge `observe()` gains the list of playing audio refs.
- Generated and committed (not counted): audio files, `asset.json`, provenance records, lock entries, licence snapshots, credits lines, work-for-hire records supplied by the owner.
- ≈ 22 code files.

## Interfaces
- C07 1.1 unchanged: audio uses `KindExtras` `{ t: 'audio'; durationS; lufs; truePeakDb; sampleRate: 48000; loop?; cues? }`; placeholders are identified by the existing provenance tags and registry rows, never by a new field (DL-390). C04 1.1 `AudioService` and `AudioBusId` unchanged; C09 1.0 `DirectorScript.music` consumed as defined. `artFinal`'s `rule` union widens to `1|2|3|4|5` (internal core, M10d2). No contract change.

## Acceptance criteria
- AC-1 Given the branch When install, typecheck, lint, unit tests and build run Then all exit 0 — proof: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm check:unit && pnpm build`
- AC-2 Given fixture trees When `artFinal` runs Then an `audio_sfx` ref whose provenance carries `placeholder` is `pending` naming file and ref under rule 4, a needs row with no ref and a `silent` `audio_sfx` row are `pending` under rule 5, a `silent` `audio_music` row with `decision: 'Q-40'` passes, and the M10d2 fixtures keep their results — proof: `pnpm check:unit -- tools/assets`
- AC-3 Given the repository after this session When the placeholder scan runs Then it exits 0 with `status: 'pass'` and zero findings, and every `owner: 'M10e'` registry row has a non-empty `replacedBy` — proof: `pnpm assets:final`
- AC-4 Given the new audio When the asset gates run Then every file is 48 kHz (music stereo, SFX mono) and ≤ 25 MiB, every music file meets the §8.1 loudness targets within the tolerance `audio-qa.ts` declares and has a work-for-hire record, and every SFX has a provenance record with an allowlisted licence and, for third-party files, a licence snapshot and credits lines — proof: `pnpm assets:catalog && pnpm assets:verify && pnpm check:assets && pnpm provenance:check`
- AC-5 Given the line scripts and any station names When the IP gates run Then all pass and every scripted line has subtitle text — proof: `pnpm names:lint && pnpm ip:strings && pnpm check:unit -- tools/assets`
- AC-6 Given `config/world/ambience.json` and a fake `AudioContext` When the listener crosses a district boundary and the clock passes dusk Then the `ambience` bus crossfades to the new district's bed and then to its night bed, and every C08 district of the v1 area has both beds — proof: `pnpm check:unit -- packages/world`
- AC-7 Given the compiled missions and stages When the needs test runs Then every `DirectorScript.music` ref and every stage `music` and `ambience` ref resolves to a needs row, and `check:fighter` stays green — proof: `pnpm missions:build && pnpm check:unit -- tools/assets packages/modes/fighter && pnpm check:fighter`
- AC-8 Given a QA build with the `synth` world When `@audio-final` starts a race, raises heat to 2 and opens a Versus bout on each stage Then bridge `observe()` lists only audio refs present in `content/audio/needs.json`, none tagged `placeholder` — proof: `pnpm map:build -- --area synth && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @audio-final`
- AC-9 Given a local QA build in a desktop browser When the reviewer plays a race, a pursuit at heat 2, a Versus bout and one Act 1 mission with headphones Then no real song, artist, station or call sign is heard, nothing clips, voice ducks music and radio, and the review is recorded in `docs/device-runs/M10e/desktop/notes.json` — proof: manual: desktop browser, `DV_WORLD=synth pnpm dev`, open `/?debug=1&unlockAll=1`, play the four listed scenes, write the notes file

## Test plan
- **Unit:** `tools/assets` (`audio-import`, `audio-qa`, `sfx-recipe` determinism, `audio-final` rules 4–5, needs resolution), `packages/world` (`ambience`), `packages/modes/fighter` (`stage-audio`).
- **Gates:** `assets:final`, `assets:catalog`, `assets:verify`, `check:assets`, `provenance:check`, `names:lint`, `ip:strings`, `check:fighter`, `missions:build`.
- **E2E:** `@audio-final` on `chromium-webgl2`; racing, fighter, pursuit and `@art-*` suites stay green.
- **Manual:** AC-9 listening review.

## Demo script
1. `pnpm assets:final`: zero findings, rules 1–5.
2. `DV_WORLD=synth pnpm dev`, `/?unlockAll=1`: start a sprint (final engine and tire sets, announcer with subtitles), raise heat to 2 (siren set, scanner callouts).
3. Culture Wars, Versus on `ferry_plaza`: hit layers, crowd and the stage track (or silence under Q-40).

## Effort
1 Builder session; ≈ 22 code files plus generated audio; risk **medium** (source availability, Q-40; volume of SFX sets).

## Risks & fallbacks
- **No commissioned stems (Q-11, Q-40 open):** music rows silent with `decision: 'Q-40'`; the gate passes; stems drop in later at the same AssetIds.
- **No supplied SFX:** the synthesis recipe at the same AssetIds; the owner may replace files later without an id change.
- **A CC0 pack's terms cannot be snapshotted (U10):** drop the pack, use the recipe.
- **Cloudflare key pair absent:** voiced rows stay open, AC-3 fails for them only, listed under "Blocked on"; CI with the pair closes them.
- **Session runs long:** racing finals, then fighter, then city, then music, then story lines; an unfinished row keeps its finding, AC-3 fails, and the rest becomes a follow-up file through the Architect.

## Notes for the Builder
- Read first: `05-assets-pipeline.md` §8, §9; `06-racing-content.md` C.7; `07-fighter-content.md` FX5 and the asset table; `03-story-missions.md` C7; `03-story-cutscenes.md` §D2 (`DirectorScript`); `01-engine.md` §2.9; the M07b2, M08b2, M10c and M10d2 files.
- Facts: no new external fact. The CC0 catalogue terms (U10) and the sound-effects endpoint terms (U11) stay out of every AC; the licence snapshot is the evidence.
- Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` for voiced renders only (SKIP otherwise). No fal and no genAI music. Owner gates: Q-11, Q-40, Q-20 (defaults apply). Branch `m10e-audio-integration`.
