# Domain 05 — Asset Pipeline (S05), Part B: stages, kits, audio, CI gates, kill-switch, cost, runbook

> Companion to `spec/domains/05-assets.md` (Part A: C07 types, gates, runtime). Part A section numbers appear as "A§". Endpoint ids come from `config/genai-endpoints.json` (A§4.5); prices are fal list prices checked 2026-10-18 [research/genai-pipeline-fal.md]; **(S05)** marks design values to be tuned in M00c/M10a, not vendor facts.

## 1. Character pipeline (R-NPC-02)

Tiers: **Standard** (default roster), **Lean** (cheap drafts, user NPCs later), **Premium** (heroes, optional). Rows below are Standard; Lean substitutions are in the last column. Every stage starts with `assertStageAllowed` (A§5.4). Work files live in `PRIVATE work/character/<slug>/<stage>/<jobKey>/`.

| # | Stage | Where | Registry role → endpoint | Settings | Gates | Lean |
|---|---|---|---|---|---|---|
| 0 | `tier-check` | any | — | Read compiled soul: `tier`, `soulVersion`, `visual_brief`, `heightM`, `voice.tier`, `standIn`, `moves`; build `LikenessContext` | G-ALL (A§5.4) | same |
| 1 | `style_bible` (once per art direction) | CLI | `style_bible` → `openai/gpt-image-2.5/sunburst/text-to-image` | 2560×1440, quality `high`; id `bay-cel@N` | H0 art director approves | same |
| 2 | `sheet` | CLI or Workflow | `sheet` → `openai/gpt-image-2.5/sunburst/edit` | `image_urls` = style-bible crop + ≤ 3 first-party refs (limit 16); `num_images` 3; 2560×1440; `quality: high`; opaque background. Template `character-sheet@N`: 2×2 grid of 1280×720 cells (front, left / back, right), one full-body figure per cell, T-pose with arms horizontal, flat neutral light, plain mid-grey background, no text | A1, A2 → H1 | `google/nano-banana-2.1/edit` 2K × 4 |
| 3a | `crops` | local | — | Fixed grid → four 1280×720 PNGs in order front, left, back, right (order sensitivity unverified, U2) | A1 sizes | same |
| 3b | `portrait` | CLI | `portrait` → Sunburst edit | 1024², `num_images` 2, input = front crop | A2 → H2 | skip (use crop) |
| 3c | `mouth_atlas` | CLI | `portrait` → Sunburst edit | 1024², 3×3 grid of nine mouth shapes (Rhubarb A–H, X) in the character's style on flat background; sliced to nine 341 px cells | A1 → H2 | skip (jaw only) |
| 4 | `mesh` | CLI or Workflow | `mesh` → `meshy/v7.1/multi-image-to-3d` | `pose_mode: t-pose`; `target_polycount` 30,000 (hero, fighter) / 12,000 (named NPC); `topology: triangle`; `should_remesh: true`; `enable_pbr: true`; `symmetry_mode: auto`; `enable_rigging: false`; `enable_animation: false`; `texture_prompt` ≤ 600 chars (linted). Two candidates (two requests) | A3, A2 on turntable → H3 | `tripo3d/h3.1/multiview-to-3d` standard textures × 2 |
| 5 | `rig` | CLI or Workflow | `rig` → `fal-ai/meshy/rigging/multi-animation` | `model_url` = presigned GET of the chosen GLB; `height_meters` from soul; `animation_action_ids` = [0 Idle, 30 Casual_Walk, 16 RunFast, 466 Regular_Jump, 178 Hit_Reaction] plus soul `moves` ids (e.g. 96, 206, 138, 187, 403) only when the buffer funds them ($0.12 each, DL-OWN-01) | A4 → H4 | `fal-ai/meshy/rigging` (walk/run included) |
| 6 | `retarget` | local | — | Only for foreign clips (authored fighter moves, Hunyuan Motion); §4 | A5 | n/a |
| 7 | `optimize` | local | — | §3: hi/mid/lo GLBs, animation stripped to `anim` assets, KTX2, meshopt | A6, A7 | same |
| 8 | `publish` | local | — | hashes, provenance chain, rclone upload, HEAD verify, lock PR, `credits` | A8 → H5 | same |

If the rig call returns 422 the run falls to the second mesh candidate; if both fail, H4 offers Blender repair or `fictionalized` redesign. Meshy built-in rigging is off at stage 4 so a rejected mesh never wastes the $0.20 rig fee [research/genai-pipeline-fal.md §3.1].

## 2. QA gates

**Automated** (fail = job `failed`, run stops at that stage; each writes a JSON report beside the output):

| Gate | Check |
|---|---|
| A1 layout | vision (`vision_qa`, Haiku 5.5, schema A§5.4 item 7 extended with `grid_cells`, `full_body_in_cell`, `t_pose_arms`, `bg_uniform`): four cells, one figure each with ≥ 5 % margin, arms near-horizontal; programmatic border-pixel variance for the background |
| A2 safety | `apparent_minor = none`, `nudity = none`, `gore ≠ realistic`, `logos_or_jerseys = false`, `text_in_image` passes `names:lint` (thresholds from [research/gap-trust-safety-tooling.md §2.4]; the OpenAI moderation second opinion belongs to the UGC path of S09/S12) |
| A3 mesh | glTF-Validator zero errors; triangle count ≤ 1.1 × target; bounding-box height 1.5–2.1 m; faces +Z; textures ≤ 2048²; no skin; turntable renders (front, side, back at 512²) pass A2 |
| A4 rig | bone names map onto `bay_rig_v1` required set via the alias table; every vertex weight sums to 1 ± 0.01 with ≤ 4 influences; clip count equals the request; T-pose rest |
| A5 retarget | hip drift over a looping idle ≤ 3 % of `heightM`; end pose within 1 cm of start **(S05)** |
| A6 budget | per-fidelity limits from `config/asset-budgets.json` (§3); materials, bones, texture bytes, file bytes |
| A7 visual | turntable SSIM of mid vs hi ≥ 0.93 and lo vs hi ≥ 0.88 **(S05)**; frame checked for black or empty renders |
| A8 record | every stored file has a valid provenance record; derived chain resolves to a generated root; `likeness:gate` passes |

**Human** (explicit tasks logged in `review[]`; CLI `assets:gen gate`): H0 style bible approval. H1 pick best of 3 sheets, approve tier and design (checklist below). H2 pick portrait and mouth atlas. H3 pick best of 2 meshes. H4 rig spot-check in a viewer (turntable plus four clips; hoodies, chains, long hair, sneakers, hands; set `mouthAnchor`; record `bones.jaw`, `bones.fingers`). H5 final PR review of the lock diff (three fidelities side by side). H6 vehicle QA (§7). H7 cutscene speech or audio approval and review of every hero cutscene (Disney v. MiniMax pattern, L-R09 [research/legal-ip-likeness.md]). Art-lead time per character 20–40 min is an UNVERIFIED estimate.

**H1 checklist for `parody` and `fictionalized`** (from legal L1): display name passes edit distance ≥ 0.4 from the real name and every alias; no real tattoos, jerseys, numbers, logos or catchphrases; not shown in the subject's fame domain; no firearms, gore, drugs or crime (D-30); design visibly transformed (proportion, palette or era shift); disclaimer id set; `standIn` exists. There is **no** face-similarity or face-detection step (A§2 decision 9).

## 3. Optimize, formats and tier variants

Pins: `@gltf-transform/cli@4.5.1`, KTX-Software 4.4.2 (call `ktx create`/`ktx encode`, not `toktx`), `meshoptimizer@1.3.0` for custom LOD steps, `three@0.186.1` decoders self-hosted [research/stack-rendering-platform.md §5.6]. Meshopt for geometry and animation, no Draco; every `.glb`/`.ktx2` uploaded identity-encoded; each static file ≤ 25 MiB; world packs ≤ 4 MiB (S02) [F-017, F-019]. Do not mix basis_universal v2.50 XUASTC encodes until three's transcoder supports them (U13).

Pipeline per character (`tools/assets optimize`): load GLB → dedup, prune, weld → strip animations into `anim` assets (custom `@gltf-transform/core` script) → normalise bone names to `bay_rig_v1` → per fidelity: simplify (`gltf-transform optimize --simplify --simplify-ratio r --simplify-error e --compress meshopt --texture-compress ktx2`; resize via the documented texture-size option, flag spelling checked with `--help` at 4.5.1) → merge to the material cap → write `extras.assetId` → hash. UASTC for `hi` base colour and all normal maps; ETC1S for `mid`/`lo` base colour and ORM **(S05, subject to A7)**. Texture memory assumes ASTC 4×4 (1 byte per texel) plus 1/3 for mips.

Initial per-asset budgets, `config/asset-budgets.json` (S05; S11's C13 scene totals stay authoritative and `check:assets` reads them; S02/S06 add crowd and traffic rows at M03):

| Kind | Fidelity | Tris | Max texture | Materials | GPU tex bytes | File bytes |
|---|---|---|---|---|---|---|
| Hero / fighter character | hi | 30,000 | 2048² × 3 maps | ≤ 3 | ≤ 16 MiB | ≤ 6 MiB |
| | mid | 12,000 | 1024² × 3 | ≤ 2 | ≤ 4.5 MiB | ≤ 2 MiB |
| | lo | 6,000 | 512² × 2 | 1 | ≤ 1 MiB | ≤ 0.8 MiB |
| Named NPC | hi / mid / lo | 12,000 / 6,000 / 3,000 | 1024² / 512² / 512² | 2 / 2 / 1 | ≤ 4.5 / 1.2 / 1 MiB | ≤ 2 / 0.8 / 0.6 MiB |
| Race or hero car | hi / mid / lo | 60,000 / 30,000 / 15,000 | 2048² / 1024² / 512² | ≤ 6 / 4 / 2 | ≤ 24 / 6 / 1.5 MiB | ≤ 8 / 3 / 1 MiB |

Fidelity maps to C13 tiers through `TIER_FIDELITY` (A§4.2): `hi` for `desktop`, `desktop-ultra`, `xr-visionpro`; `mid` for `mobile`, `xr-quest`; `lo` for `mobile-low`. The limits behind it are S11's budget table (`spec/domains/11-platform.md` §4.5, mirrored in `config/tier-budgets.json`): texture memory ≤ 1,000 MB desktop, ≤ 350 MB mobile (≤ 250 MB `mobile-low`), ≤ 400 MB Quest, ≤ 800 MB Vision Pro; render objects ≤ 600 / 150 (≤ 100) / 150 / 200 per pass [research/stack-rendering-platform.md Performance budgets]. A character is one skinned mesh with at most the listed materials (render-object budget, D-09).

## 4. Rig family and retarget

- **`bay_rig_v1`** is the repo's single skeleton contract: `packages/shared/src/rig/bay_rig_v1.json` = `{ family, required: string[], parents, aliases: Record<vendorName, canonicalName>, hips, heightM }`, where `required` and the canonical names are S01's 22 `HUMANOID_BONES` (`01-engine-contracts.md`) plus a hand-checked mannequin GLB (a Meshy-rigged T-pose model kept as asset `rig/bay_rig_v1`). Meshy states Mixamo-style bone names (vendor marketing, medium confidence); the real names, finger and face data are probed in M00c (U1) and the alias table is written from that probe.
- Every NPC goes through the same Meshy rigger, so clips bind by bone name in `AnimationMixer`. Hip height scales with `heightM`; foot IK for ground contact is the engine's [research/genai-pipeline-fal.md §3.3].
- **Meshy library clips** (5 per character, from the multi-animation call) are stored as `anim/<slug>.base`. **Authored fighter moves** (60–80 per fighter, frame data from S07) are keyed once on the mannequin in Blender, exported as GLB, then baked per fighter by `assets:retarget --rig bay_rig_v1 --clips <glb> --to <slug>` using `SkeletonUtils.retargetClip(target, source, clip, { names, hip: 'hips', fps: 30 })` (canonical bone names are S01's `HUMANOID_BONES`) in Node; output `anim/<slug>.moves` (animation-only meshopt GLB, clip name = move id). Never retarget at runtime on mobile. If S07 needs 60 fps clips, set `fps` and re-bake; the clip carries its frame count in `extras`.
- Deferred optimisation (post-M10b): one shared clip pack on the mannequin instead of per-character copies, only if a transfer test across ten characters passes A5.

## 5. Voice and lip-sync assets (D-23)

| Case | Generation | Provenance `voice_mode` |
|---|---|---|
| Non-consented named NPC, announcer, police radio, tycoon VCs | `voice_design` ($3 per voice) from a timbre description, then `tts_final` (`speech-2.8-hd`, $0.10 per 1k chars) for baked lines; `tts_draft` (`-turbo`, $0.06) for review drafts | `designed` |
| Crowd barks | Workers AI Aura or MeloTTS pre-render (S04 runtime tier t1); no fal call | `synthetic` |
| Heroes (≤ 3, 18+) | runtime ElevenLabs Flash designed voices (S04); baked lines via `tts_hero` | `designed` |
| `consented` clone | `fal-ai/minimax/voice-clone` ($1.50) only with scope `voice_clone` and an unexpired record; ElevenLabs talent PVC is shared by the talent, not generated here | `consented_clone` / `licensed` |

**DL-OWN-01 (v1):** the `voice_design` and `tts_final` rows above are not funded by the $100 fal cap. Named NPCs, the announcer, police radio and tycoon VCs use Workers AI Aura or MeloTTS (`synthetic`, runtime tier t1, Cloudflare billing); at most one designed voice may be bought from the buffer with owner sign-off.

The `style_prompt` and design prompt never name or describe a real person, accent imitation or cadence (Midler/Waits rule); `lintPrompt` enforces it. Baked audio is keyed `audio/barks/<sha256(voiceId|model|text)>.opus`, normalised to −16 LUFS, −1.5 dBTP, 48 kHz stereo (cutscene audio recipe, [research/gap-cutscene-delivery-playback.md §1.2]). Container choice (Ogg Opus per [research/ai-npc-runtime.md] vs AAC `.m4a`) is fixed by an iOS decode test in M00c (U14); the key rule is unchanged. Lip-sync: Rhubarb Lip Sync offline on each baked line → JSON cues stored as an `audio_bark` `cues` asset; mouth atlas decal (nine cells + JSON cell map) plus `mouthAnchor` set at H4; blend shapes for heroes are deferred (NPC-R8). Voice IDs are `voice` assets: a JSON file `{vendor, voiceId, endpointKey, mode}` with its own provenance record.

## 6. Cutscene job stages (R-CUT-01; S03 owns request, key and playback)

`kind: cutscene_shot`, executed by `GenJobWorkflow`; `CutsceneJobDO.idFromName(key)` is the single-flight lock and its ready test is `HEAD cutscenes/<key>/manifest.json`. `<key>` is A-03 computed by S03 with `canonicalize` (`packages/shared/src/json.ts`, DL-009) and `sha256Hex` (`packages/shared/src/hash.ts`); the key term is `endpointId@pinnedUpdatedAt` (A-03 v1), `seed` is mandatory, and `inputHashes` are SHA-256 of keyframe and reference files, never URLs.

1. `gate`: provider chosen by the A§4.5 selection rule and checked by `assertCallable` ([research/gap-video-model-licence-clearance.md §8]); production env needs `status: cleared`; tiers of `characters[]` from the request; presets `toon-pbr` for non-consented; prompt lint on the template filled with slots.
2. `keyframes`: per shot, Sunburst edit at 1920×1080 `high` ($0.0396), inputs = style bible, approved sheet crops of the characters (first-party only for non-consented), stage plate. Reference-to-video shots (fighter face-offs) send ≤ 4 square crops instead when the provider supports it.
3. `plan`: provider `plan()` splits or merges shots to 6–10 s and records the mapping in the manifest.
4. `submit`/`await`/`poll` (A§5.1) with `prompt_expansion_mode: disabled`, fixed seed, 768P, 16:9 for H3-family providers.
5. `copy-orig` to `PRIVATE cutscenes-orig/<key>/orig.mp4` unmodified; never public (carries the fal request id, 2–4× larger).
6. `probe+transcode` in the Transcoder Container, recipe `cut@1` (`ladder.sh`): `v768` CMAF fMP4 High L4.0 CRF 21 ≤ 5 Mbps; `v540` L3.1 ≤ 1.8 Mbps; `v1080` only when generated at 1080P; `a.m4a` AAC 48 kHz −16 LUFS; `poster.webp`; `last.webp`; BT.709 tags; 1 s GOP [research/gap-cutscene-delivery-playback.md §2.4]. Cost ≈ $0.001 per 5 s clip.
7. `captions`: Workers AI `@cf/openai/whisper-large-v3-turbo` on the audio. If speech is detected the manifest sets `audio.speechDetected` and withholds the audio URL until H7.
8. `qa-gate`: frame count within ±17 of `duration × 24`; black or frozen frames; loudness; C2PA state of `orig.mp4` recorded (valid-untrusted is expected for fal, F-043).
9. `resign` (flag `C2PA_RESIGN`, required before live calls per ADR-GENAI-01 gate G4): each rendition re-signed with our C2PA claim, `orig.mp4` as ingredient, `trainedAlgorithmicMedia`; tool and version chosen and pinned in M05b (U15). Without it `check:c2pa` fails the release.
10. `subs`: scripted VTT from S03 dialogue refs.
11. `publish`: write `cutscenes/<key>/manifest.json` last (S03's `CutsceneManifest`, `provenance.aiGenerated: true`, plus `licence.{gate,status,termsSnapshotSha256[],clearedBy,clearedAt}` and `characters[]` for purge).
12. `record`: provenance records for `orig.mp4` (generated) and each rendition (derived); `gen_job` row and ledger settle.

**On Workers Free (DL-OWN-08, DL-745, DL-748)** there is no Container. The Worker runs steps 1–5 (`copy-orig` streamed, unhashed) and a `handoff` step that leaves the key in the stored `CutsceneJobDO` state `handed_off` (route 27 `pending`; no watchdog, re-arm or unquarantine clears it). The operator's `assets:gen prewarm --finish` runs steps 6 and 8–10 off-edge with the same `ladder.sh`, the pinned `ffmpeg` and the pinned re-signer, and uploads the results with `finish.json` to PRIVATE. Route 28 then starts a publish phase in the Worker, which re-runs the `resign` gate (kill state, consent, licence) and copies the files to MEDIA, writing the manifest last (steps 11–12) (M05c3). The Container is the post-upgrade option. With a Container only: on its failure after retries, Media Transformations produces a poster and the rendition `p720` (720p progressive MP4) with `degraded: true` (C09 fixed line, DL-072); this fallback is not used on Free (its URL form needs a zone). Prewarm: `pnpm assets:gen prewarm --release <tag>` computes every key from S03's `CutsceneRef` index, HEADs, and submits only misses; a second run makes zero vendor calls; CI fails a release whose refs lack both a cleared asset and an in-engine fallback.

## 7. Vehicles, props, environment kits: sourcing

**Owner update (DL-OWN-06, 2026-10-26):** besides the defaults in the table below, licensed third-party models and textures (CC0, CC-BY 4.0, or a licence allowing modification and public commercial redistribution, each with a licence snapshot) and fal-generated 3D within the $100 cap are admitted for every non-character row. Game rips, real logos and trade dress, scans of people and reproduced public art stay excluded.

Rules: fictional makes, models and operators only, with altered silhouettes and badges; never Rockstar's fictional makes (seeded in `ip:strings`); robotaxi operator is "Halcyon Mobility"; no murals or public art reproduced [research/legal-ip-likeness.md §6]. A third-party CC0 or CC-BY pack is admitted only after (a) a licence-page snapshot in `docs/legal/licenses/<pack>.md` with its SHA-256, (b) per-file provenance records, (c) attribution lines in `credits.json`, (d) a vision and `ip:strings` pass for brands and logos. The catalogues Poly Haven, ambientCG, Kenney, Quaternius and Freesound are search starting points only; their terms are UNVERIFIED (U10).

| Category | Default source | Why | Human gate |
|---|---|---|---|
| Hero and named characters | generated (§1) | R-NPC-02 | H1–H5 |
| Crowd peds (8 bodies × 20 outfits, palette swaps) | authored base meshes, or verified CC0 bases, with outfits from code recipes (M10d4; no fal) | a modular kit needs one skeleton and swappable parts; generation cannot guarantee it; no real likeness | art lead, M03b |
| Race and hero cars (~20) | authored in Blender or built on a verified CC0 base with original livery; generated bodies within the $14 vehicles-and-props line by M10d1's route (image-edit views of a recipe blockout, then multiview-to-3D, H6 picks; DL-OWN-07, DL-740); the old Meshy buffer route is retired | AI output is one fused mesh; wheels must rotate | H6, M10d3 (gray-box `vehicle/graybox.<slug>` in M07a1/M07b1; DL-460) |
| Traffic and police (the 8 `ARCHETYPES`, DL-739) | authored low-poly or verified CC0 base with original livery; generated livery textures | instancing needs a few thousand tris | art lead, M03b |
| Props, barriers, cones, street furniture | verified CC0 or authored; no AI meshes | clean topology, cheap | licence check |
| Landmarks (≥ 25) | hand-authored over open-data massing (A-05, S02) | accuracy | S02 |
| Facade, ground, PBR sets | verified CC0 sets; generated seamless tiles only from the buffer, after a tile test | | A2 on tiles |
| Murals and signage decals | original generated or authored art, vision-checked for text and logos | constraint 15 | H6 |
| Sky, HDRI | procedural `skycycle` (S02) or CC0 HDRI | | |
| UI, icons, fonts | authored; fonts OFL-1.1 | | S10 |

**Vehicle node contract** (`KindExtras` `vehicle`, proposed to S06): +Z forward, +Y up, metres; nodes `body`, `wheel_fl|fr|rl|rr` (pivot at hub centre), `steer_fl|fr`, `light_head_l|r`, `light_brake_l|r`, `collider_hull` (convex, ≤ 64 vertices **(S05)**), `fictionalMake` string checked by `ip:strings`. H6: wheels spin about their local X, steering pivots rotate about Y, no interior geometry at `lo`, decimated hulls match body within 5 cm.

## 8. Music and SFX policy

1. **Music is commissioned originals** (Q-11). Contract: work-for-hire agreement in `docs/legal/licenses/`, stems delivered; `origin: authored`, `license: LicenseRef-DeeVerse-Owned`; human composition or human arrangement and lyrics (AI-only output is likely uncopyrightable) [research/legal-ip-likeness.md §4]. Master loudness −16 LUFS integrated, −1.5 dBTP **(S05)**; loops declared in `extras.loop`. Stems are integrated in M10e; with none supplied, music rows stay silent (Q-40 default, DL-500).
2. **AI-assisted music is placeholder only** and never in a public build: tagged `placeholder`, `generator.env: previs`; CI fails a release that references one. Allowed vendor for placeholders: `elevenlabs/music/v2.5` ($0.60/min) only while the studio is an "Indie Game" (placeholder generation is paid from the spike or buffer line, DL-OWN-01) (< $500k lifetime game revenue and < $1M entity game revenue in the last fiscal year); the record stores `plan`; S13 owns the revenue alarm. `minimax/music-3` and `google/lyria-3.5` have an UNVERIFIED licence chain and are not callable. Udio is unusable; Suno needs a fresh terms check.
3. **Prompts** are genre briefs (tempo, instrumentation, era, regional slang); "hyphy-inspired" is allowed. `lintPrompt` blocks artist, song, label and station names and "sounds like". No samples, interpolation or vocal-timbre matching; AI vocals use designed voices only. A `consented` artist's recordings need a separate sync licence.
4. **Radio** stations are fictional; real Bay Area call signs and DJ names go in `config/ip-denylist.json` (list UNVERIFIED; S05 maintains it from owner input).
5. **SFX** order: authored or recorded originals; then CC0 or CC-BY-4.0 per-file with a licence snapshot; then generated with `fal-ai/elevenlabs/sound-effects/v2`, registry status `pending` (price and terms UNVERIFIED, U11) and usable in public builds only after its terms snapshot is reviewed and the entry is `active`.
6. **Announcer, police scanner, crowd lines**: scripts original, designed or synthetic voices (§5), `likeness.tier: original`.
7. Sets required by the game (engine idle, on-load, off-load, redline per class; tire squeal; impact layers; hit layers per strength; sirens per unit tier; ambience beds per district) are tracked as a checklist in `content/audio/needs.json` owned by S06/S07/S02 and checked by `check:assets`; M10e fills every row with final audio and adds the audio rules 4–5 to `assets:final` (DL-500).
8. Delivery: 48 kHz; stereo music, mono SFX; container per the U14 outcome; each file ≤ 25 MiB.

## 9. CI gates (all exit non-zero on any finding; each script has a `check:*` alias for S13's runner)

| Gate | Script | Fails when | Lands |
|---|---|---|---|
| `provenance:check` | `tools/ci/provenance-check.ts` | A§4.3 list: ship-set file without a valid record, licence off the allowlist, missing attribution, `env ≠ production`, `previs/` or `mock` references, `placeholder` tags in a release, unrooted derivation | M00b |
| `check:assets` | `tools/ci/check-assets.ts` | C07 schema or invariant error, budget breach (§3), missing fidelity, `rev` regression, file > 25 MiB, pack > 4 MiB | M00b/M01d |
| `ip:signatures` | `tools/ci/ip-scan.ts` | RPF7 `37 46 50 52`, RSC7 `52 53 43 37`, DXBC `44 58 42 43`, GXT2 `32 54 58 47`, WASM `name` section with `rage::`, OIV packages, RenderWare and IMG headers in repo or R2 upload set | M00b |
| `ip:extensions` | same | denylisted extensions (`.rpf .ytd .ydr … .dff .txd .img .ipl .ide .col .scm .ifp`) | M00b |
| `ip:strings` | same | `config/ip-denylist.json` hit in source, i18n, missions, soul files, prompt templates, generated-content caches (outside `docs/legal/`, `docs/research/`) | M00b |
| `ip:similarity` | S13 Zone-R runner | ≥ 50-token clone against example repos; reports file and line only | S13 |
| `license:scan` | ScanCode Toolkit + `reuse lint` | GPL/AGPL/LGPL in the client bundle without an ADR; missing SPDX header; unknown licence | M00b |
| `names:lint` | `tools/ci/names-lint.ts` | real-side NameRegistry string in client code, content, provenance or prompt templates; display name distance < 0.4. Real-side list is a CI secret; forks run display-side only | M00b |
| `likeness:gate` | `tools/ci/likeness-gate.ts` | schema conditionals (A§4.3), missing `standIn`, `consented` without an unexpired scope in `config/consent-index.json` (ids, scopes, `term_end`; exported by S04), face-detector model URLs (`face_detector`, `FaceLandmarker`, `face_landmark`) anywhere | M00b |
| `check:c2pa` | `tools/ci/check-c2pa.ts` | shipped cutscene without `orig.mp4` anchor, re-signed rendition, or `aiGenerated` flag | M05b1 |
| `ip:history` | `tools/ci/ip-scan.ts --history` | any hit over full git history before the repo is public | M14b |
| `genai:liveness` | `tools/assets/genai-liveness.ts` | nightly, no key: id missing, `status ≠ active`, `license_type ≠ commercial`, `updated_at ≠ pinnedUpdatedAt` (issue, not failure of PRs) | M00b |
| `genai:price` | same, keyed | monthly: list price differs from registry by > 5 % | M00c |
| `genai:terms-watch` | `tools/ci/terms-watch.ts` | weekly: SHA-256 of any snapshot in `docs/legal/vendor-terms/` changed → provider `cleared→pending` | M14b |

Snapshots to store at M00b: fal ToS (2026-09-08), fal AUP, fal API Services Terms, MiniMax H3 LICENSE (2026-08-02) and Q&A, MiniMax Open Platform ToS (2026-03-30), Gemini API terms (2026-04-28), LTX LICENSE-2_x, ElevenLabs music terms (2026-10-09), OpenAI usage policies (2025-10-29) [research/gap-video-model-licence-clearance.md §6, research/legal-ip-likeness.md §3.4].

## 10. Kill-switch purge: procedure and drill

`KillPurgeWorkflow` input `{npcId, scope[], reason, ticketId}`, started by S09's admin kill route after the `roster_flag` write.

1. Confirm the flag row. 2. Resolve targets: `asset_index` rows tagged `char:<npcId>`; cutscene keys from S09's `cutscenes.char_ids`; bark keys from `bark_index(voice_id)`. 3. Set `status: killed` on those rows and R2 custom metadata (repo records follow through the next `assets:lock --prune` PR). 4. Copy matching objects to `PRIVATE quarantine/<ticketId>/`, then delete from `MEDIA`. 5. Prefix-purge `media.<domain>/characters/<slug>/` and each affected `cutscenes/<key>/` (≤ 100 prefixes per request). 6. Build and publish the next catalog without them (ordinary release; not on the 60 s path). 7. Probe each purged URL: expect 404 and `CF-Cache-Status ≠ HIT`; write `audit_log`. 8. Scope effects: `voice` drops baked lines and TTS for that voice; `cutscene` swaps in the in-engine director fallback; `marketing` unpublishes store and OG art (S10); `ugc` unlists experiences (S12). 9. Close the ticket with timestamps.

Targets: live removal ≤ 60 s (runtime path, A§5.5); public purge ≤ 24 h. Restore (consent renewed) copies back from quarantine and flips records to `active` only through a reviewed PR. **Drill:** quarterly in staging and the CI e2e in A§9; M10b is the first run, M14b2's `quarterly.yml` repeats it, and M14b3's `kill-drill` gate blocks a release while the last report is older than 92 days or measured removal above 60 s (DL-480).

## 11. Cost per asset and the v1 programme

List prices, 2026-10-18; (A) assumptions: three extra reference inputs per sheet at $0.01 each (U7), 15,000 characters of voice lines, 1.5× retakes, Turbo promo ignored.

| Asset | Recipe | Cost |
|---|---|---|
| Character, Lean | nano-banana 2K × 4 $0.252 + Tripo H3.1 standard × 2 $0.60 + rig $0.20 | **$1.05** |
| Character, Standard | sheets 3 × ($0.05529 + 3 × $0.01) = $0.256; portraits 2 × $0.05268 = $0.105; mouth atlas 2 × $0.05268 = $0.105; mesh 2 × $1.20 = $2.40; rig + 5 clips = $0.20 + 5 × $0.12 = $0.80 | **$3.67** (research's $3.73 priced 4-view crops by vendor; ours are programmatic) |
| Character, Premium | per [research/genai-pipeline-fal.md Cost model] | $7.06 |
| Extra signature clips | $0.12 each | |
| Voice | voice-design $3 + 15k chars at hd $1.50 | **$4.50** |
| Vehicle body (generated) | 2 concepts × $0.04116 + 2 meshes × $1.20 | **$2.48** + human Blender time |
| Keyframe | Sunburst 1920×1080 high | $0.0396 |
| 15 s cutscene (3 shots, 1.5×) | Turbo $1.06 · H3 partner $1.35 · H3 Max ref $1.80 · LTX $2.18 · Gemini $2.25 | |
| Full video set as first planned (100 story + 222 fighter clips = 3,915 s; superseded by DL-OWN-01, not a v1 plan) | H3 partner $234.9 · Turbo $156.6 · LTX (6 s minimum, 4,248 s) $382.3 · Gemini 720p $391.5 | |

**One-off fal programme (DL-OWN-01: hard cap USD 100 total; replaces the $1,000 programme of G3; DL-171; allocation of DL-OWN-01 superseded by DL-OWN-07, 2026-10-26).** Unit prices above are list prices; v1 spend is limited by these lines, not by what the pipeline could generate.

| Line | Cap | Content | Estimate |
|---|---|---|---|
| Spike (M00c) | $4 | 11 callable steps: one test character, one keyframe, three video clips; `plan.json` lists 13 ($4.36), and the two `blocked` H3 Max steps are refused before the ledger reserves (DL-286, DL-741) | $3.76 |
| Characters (M10a1, M10a2) | $42 | 8 Standard fighter models at $3.67 + 12 Lean models at $1.05 | $41.96 |
| Cutscenes (M05c3 ≤ $16, M10b the rest after Act 1) | $38 | priority list of `03-story-cutscenes.md` §D9.1: 46 clips, 398 s on `h3.partner` | ≈ $37.6 |
| Vehicles and props (M10d1, M10d3) | $14 | M10d1: ≤ 2 traffic bodies (`sedan`, `pickup`) from 4 image-edit views of its own recipe blockout plus 2 multiview-to-3D candidates each (≤ 1,704,000 micros); M10d3: player cars or props by the same route within the rest; `lineCapMicros('vehiclesProps')` (M10d0) | ≤ $14 |
| Buffer | $2 | rejects, rig 422 retries, extra Meshy clips at $0.12, Standard jobs above $3.67 (DL-172), cutscene retakes beyond 1.5×; only with owner sign-off | $0 planned |
| **Total** | **$100** | | **≈ $97 planned at most** |

Not funded by fal in v1: voice designs (v1 voices use Workers AI Aura or MeloTTS), generated textures, player-triggered NPC looks (DL-175), the 12-fighter target, Acts 2–3 and racing-intro clips. Stand-ins are authored creator-kit or crowd base bodies, not fal output (DL-180). The superseded programme (60 Standard characters, 24 voices, 36 vehicle bodies, 3,915 s of video, $897.6 on `h3.partner`) is not a plan.

The ledger enforces the cap: `config/guardrails.yaml` `genai.programCapUsdMicros` = 100,000,000, alarms at 50 / 80 / 100 % ($50 / $80 / $100), hard stop at 100 %. The fal prepaid balance is topped up in tranches that never exceed the remaining cap, with auto-recharge off; `FAL_MODE=mock` is the dev and CI default; every paid job needs `--live` and prints a dry-run estimate first. R2 storage for all generated media is about 1 GB (S05 estimate, inside the free tier, F-023); transcode ≈ $0.001 per clip.

## 12. Roster batch runbook (M10a1 canary, M10a2 full)

CLI surface (`tools/assets`; `assets:gen prewarm` at M05c3, the rest at M10a1; names are the contract):

```
pnpm genai:liveness                                     # registry vs public fal registry
pnpm genai:repin     --key <registry key>               # reviewed PR: bump pinnedUpdatedAt after checking the vendor change
pnpm assets:gen plan    --roster <S04 roster manifest> --tier standard   # jobs, $ estimate, gate verdicts; zero vendor calls
pnpm assets:gen run     --slug <slug> --until sheet|mesh|rig           # runs to the next human gate
pnpm assets:gen gate    --run <runId> --gate H1 --choose 2 --by <profile>
pnpm assets:optimize    --slug <slug>
pnpm assets:retarget    --rig bay_rig_v1 --clips <glb> --to <slug>
pnpm assets:verify      --slug <slug>                          # A3–A8
pnpm assets:publish     --slug <slug>                          # rclone, HEAD, lock, provenance PR
pnpm assets:gen prewarm --release <tag>                        # cutscene keys; second run = zero calls
pnpm assets:kill        --npc <id> --scope all --ticket <id> --stage   # staging drill only
```

Paid commands (`assets:gen run`, `assets:gen prewarm`) take `--live`; without it they print the dry-run estimate and exit, and `FAL_MODE=mock` is the default (DL-OWN-01).

Steps:

1. **Preconditions.** `genai:liveness` green; vendor snapshots current (`genai:terms-watch` green); registry prices checked within 30 days; fal prepaid balance ≥ `plan` estimate with cumulative top-ups ≤ $100 (DL-OWN-01); concurrency stays at fal's default 2 (F-047), so batches run two jobs at a time; roster tiers and `visual_brief` text exist for each slug; ADR-GENAI-01 state noted in the plan header.
2. **Plan.** `assets:gen plan` for the batch; refuse any slug whose gate verdicts are not all `ok`; review the estimate.
3. **Canary (M10a1):** two originals while Q-19 is open (`canary-mc` on a Standard fighter slot and the first Lean Act 1 cast entry; one `parody` and one `fictionalized` character once the research layer exists; DL-234); expected spend ≈ $4.7; all A and H gates; `assets:verify`; publish; confirm the provenance PR passes `provenance:check` and `likeness:gate`.
4. **Batch.** Run stages 2–5 for the remaining slugs in groups sized to the concurrency limit; stop at H1, H3, H4. Humans decide in batches; unattended runs never cross a human gate.
5. **Optimize and verify** locally (stages 6–7); failures return to H4 or stage 4 with the rejected candidate kept.
6. **Publish** per slug; merge lock PRs after H5; run `pnpm assets:catalog` (M01d) to produce the immutable catalog and pointer (DL-230).
7. **Idempotence check.** Re-run `plan`: it must list zero outstanding jobs and `run` must make zero `FalPort` calls (M10b AC).
8. **Prewarm cutscenes** for the release tag (§6) once the provider is `cleared`; the prewarm stops at the $38 cutscene line (DL-740) (`03-story-cutscenes.md` §D9.1).
9. **Close-out:** reconcile spend with the fal dashboard, record cost per slug from `genai_ledger` (`job_id` = `jobKey`), snapshot the registry.
10. **Rollback:** a rejected character is `killed` through §10 in staging, then re-run from stage 2 with a new seed; old candidates stay in `work/` for audit.

## 13. Contract change proposals, assumptions (consolidated for S13)

- **06 §4 C07 / §5:** final shape per A§4.2. `variants` stays keyed by C13 tier id (06 sketch) plus `default`; `url`→`key` (origin from config); `hash`→`sha256`; `provenance` becomes a summary pointing to a record; asset key rule `<root>/<variant>.<hash12>.<ext>` (S09's key table shows the unhashed form); public character parts are `model|rig|anim|portrait|mouth_atlas`, while sheets and other candidates are private (`PRIVATE sheets/<slug>/`), a change to 06 §5's `characters/<slug>/{sheet,model,rig}`.
- **C09 (S03):** `CutsceneManifest` gains `characters: {id, soulVersion, tier}[]` (mirrors S09's `cutscenes.char_ids`) and a `licence` block; adopt dir-per-key layout with originals in `PRIVATE cutscenes-orig/<key>/`; add a release-time `cutscene-index` mapping `CutsceneRef → key` so a deliberate endpoint re-pin (A-03 `pinnedUpdatedAt`, `genai:repin`) does not orphan shipped clips.
- **C10 (S04):** compiled soul exposes `tier`, `soulVersion`, `visual_brief` (text-only appearance), `standIn`, `moves` (Meshy ids), `heightM`, `voice.design_prompt`; `assets.*` are `AssetRef` strings (`assets.rig` = `rig/bay_rig_v1`, the family asset); add `assets.anim`; character id equals asset slug.
- **C12 (S09):** reuses routes 28 (prewarm), 29 (`/hooks/fal`, handler exported by `services/pipeline`) and 46 (kill, which must start `KillPurgeWorkflow`) and KV `ks:*`, `gov:level`, `jwks:fal` as already drafted. New, folded into S09's migration `0002_genai.sql` (M05d): `gen_run`, `gen_job(job_key unique)`, `asset_index(ref, sha256, status, tags text[])`, `bark_index(voice_id, key)`, `budget_program(vendor, cap_usd_micros, alarms)` (mirror of `config/guardrails.yaml` `genai.*`, DL-068); `genai_ledger.kind += 'asset'`; Container binding `TRANSCODER`; `FAL_MODE=mock` maps to `MockExecutor`. Roster generation needs no admin generate route (CLI executor).
- **C13 (S11):** none beyond what 11-platform.md already exports (`QualityTierId`, `VARIANT_FALLBACK`, budgets); S05 only asks that `config/tier-budgets.json` stay importable by `check:assets` and that Quest and Vision Pro keep falling back to `mobile` and `desktop`.
- **C14 (S12):** `ModManifest.assets[]` provenance uses `ProvenanceRecord`; `dv mod check` imports `tools/ci` validators.
- **A-01:** shared genAI helpers live in `packages/shared/src/genai/` (no `packages/genai-core`); the transcoder image lives in `services/pipeline/transcoder/`; legal snapshots live in `docs/legal/` (the `ip:strings` allowlist names `docs/legal/` and `docs/research/`); `config/genai-endpoints.json` also hosts the ADR-GENAI-01 video provider entries (replaces `config/genai/video-providers.json`).
- **S13:** canonical gate script names are `provenance:check`, `ip:*`, `license:scan`, `names:lint`, `likeness:gate` with `check:*` aliases.

## 14. C07 1.1 additions (Architect, second reconciliation, 2026-10-18)

Additive, accepted from Wave 2–4 return blocks (`spec/11-decision-log.md` DL-099). Shapes in `packages/shared/src/assets/c07.ts` and `provenance.ts`; nothing in 1.0 changes meaning.

```ts
// KindExtras 'vehicle' — nodes gains optional anchors (S06 CCP-4)
nodes: { body: string; wheels: [string, string, string, string]; steer?: string[]; lights?: string[]; collider?: string;
         cockpit?: string; steeringWheel?: string; anchors?: { driver?: string; hood?: string };
         exhaust?: string[]; thrusters?: string[]; sirens?: string[] }   // plus optional vertex attribute _dent (shader damage, no extra render object)
// InputFile.role (GenJob inputs) accepts 'plate' with InputFile.origin 'first_party_generated' (S03 stage plates); generator.input_refs may cite it.
// The plate's own ProvenanceRecord uses origin 'derived' (tool 'assets:plates', derived_from = the world_pack sha256s rendered), DL-161
// vision_qa schema adds weapon_present: boolean and photoreal: boolean; for cutscene clips (S03 §D8) weapon_present, photoreal or any gore value other than 'none' fails the clip
```
- **Prompt templates.** `check:assets` verifies each cutscene template's `keyframePin` against `config/genai-endpoints.json` (S03 §D3.3).
- **World data (S02).** `config/license-allowlist.json` adds `ODbL-1.0` and `PDDL-1.0` (SPDX strings UNVERIFIED, S02 register) and `LicenseRef-PublicDomain-USGov` for the Terrarium stamp (USGS 3DEP and SRTM, public domain [research/repos-world.md §4]; defined in `LICENSES/`; licence URL = the AWS Registry citation page; DL-672); every `world_pack` and `map_data` asset has one `ProvenanceRecord` with `origin: 'derived'`, `tool` = the bake tool and `derived_from` = the `sha256` of each C08 `SourceStamp` it read; each `SourceStamp` has its own `origin: 'open_data'` record (`source {url, dataset_id: stamp.id, retrieved: stamp.retrievedAt}`, `license`, `attribution`), so the chain resolves without a new field (DL-161); `world_pack` ships variant `default` only.
- **Character tiers (S04).** An asset's `likeness.tier` is C10 `assetTier(soul)`: `original` when the soul basis is original, else the soul tier; the same value enters the C09 cache key (DL-083). NPC data assets are `data/npc-roster`, `data/ink.<id>`, `data/barks.<id>`.
- **Creator kit (S10, M04b2).** S05 delivers `character/pc-<slot>-<id>`, `portrait/pc-<slot>-<id>` and `ui/menu-backdrop` as ordinary catalog assets.
- **Mod assets (S12).** Mod files never enter the catalog. `asset.worker` gets an `AssetSource` hook (C13 1.1) that resolves `<kind>/mod.<sha256[0:12]>` from OPFS `dv/mods/blobs/<sha256>`; their `ProvenanceRecord`s are unchanged (`executor: 'cli'`, `env: 'production'`).
- **Gate cores.** The provenance, IP-string and licence validators are pure and Worker-safe in `packages/shared/src/assets/gates/`; `tools/ci` and the S12 Queue consumer both wrap them, so `dv mod check` and the server run the same code.
