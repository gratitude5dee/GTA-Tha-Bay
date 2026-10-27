# The 2026-10-26 look study

On 2026-10-26 the owner played staging on the real `sf` bake and said the game "doesn't look like how we need it to look". The Architect ran a look-gap study the same day (workflow `wf_34c68ace-179`): a capture agent drove staging and a local QA build of the `sf` bake, a render agent audited the render code, an art-source agent checked third-party licence pages, and three plan agents (draft, critique, final) turned the findings into a phased look program. The owner answered the plan's questions the same day (DL-OWN-07); the Architect wrote the look-program milestones from it (DL-739 to DL-742).

The study's scratch files were lost before they were committed. This folder and `docs/look/study/` were rebuilt on 2026-10-27 from the agents' recorded results (the workflow journal) and the capture agent's transcript, which held the capture scripts, spots, poses, clock and weather. The text keeps the recorded wording; no finding was added. `_PLAN.md` §0 rule 10 (DL-741) requires this commit before M02g1 starts.

The owner's target image and the owner's screenshot are never committed, copied or sampled here. The text names them only in words ("the owner's target image", "the owner's screenshot"); every frame in `docs/look/study/` is rendered by this project's own build.

## Files

| File | From (journal label) | Cited as |
|---|---|---|
| [`capture-study.md`](capture-study.md) | `study:capture-gap` | capture study "<section>", frame names |
| [`render-audit.md`](render-audit.md) | `study:render-audit` | render audit item N (area N, study item N) |
| [`art-sources.md`](art-sources.md) | `study:art-sources` | art-source study "<section>" |
| [`look-plan.md`](look-plan.md) | `plan:final`, with the `plan:critique` corrections | plan Phase N, "Fix session A/B" |

The draft plan (`plan:synth`) is superseded by the final plan and is not reproduced.

## Source builds

- **2026-10-26 study run:** local QA build of `origin/claude/build` at **d2fb0e67**, `sf` bake `bf9c29c4ba5369f9de50aef5b9c1845dad637837443e9c640775f794e0d1a9ae` (the bake staging serves); staging served the production build of the same code. The render audit read the code at d2fb0e67.
- **2026-10-27 re-capture (the frames in `docs/look/study/`):**
  - QA frames: local QA build of `origin/claude/build` at **235a8593** (`DV_WORLD=sf VITE_DV_QA=1 pnpm build`, served by `wrangler dev --local` on port 9180). `pnpm map:build -- --area sf` reproduced the same bake id `bf9c29c4…`. Between d2fb0e67 and 235a8593 the code changed only in the HUD (`packages/ui/src/hud`, `packages/ui/src/kit`: the DL-738 SVG icons) and the cutscene player (`apps/web/src/cutscene.ts`, `packages/engine/src/client/cutscene/player.ts`: a WebKit flake fix), plus tests; no world, look, camera, bake, platform or mission code changed. The QA frames hide the HUD chips, so the world in them is the study's.
  - Staging frames: https://tha-bay-web-staging.gratitude-8f4.workers.dev served build **`3a5eb603cacf`** (`GET /api/v1/health` and the menu footer; commit 3a5eb603, the merge of PR #9, which carries d2fb0e67). PR #10 (the HUD icon fix) had not reached staging, so the staging HUD still shows the old glyphs the capture study describes. The auto tier was again `mobile-low` under headless SwiftShader (boot record `"tier":"mobile-low"`).
  - Same spots, poses, viewport sizes, clock and weather as the study (see `capture-study.md` "Spots"). The only script changes: the QA Worker port (9180 instead of 8797); the staging script records the health build id and presses Continue a second time when the New Game page reports that saving is unavailable (memory-only play), which the 2026-10-27 run hit once.

## Frames

`docs/look/study/`, PNG, re-encoded losslessly (zlib level 9, metadata stripped; pixel-identical to the captures).

| Frame | Pixels | Bytes | Source |
|---|---|---|---|
| `desktop-01-civic-center-plaza-1300-clear.png` | 1600 × 900 | 544,231 | QA, `desktop`, `chromium-webgl2` |
| `desktop-01-civic-center-plaza-0600-fog.png` | 1600 × 900 | 408,682 | QA, `desktop`, 06:00 karl-fog |
| `desktop-02-market-4th-plaza-1300-clear.png` | 1600 × 900 | 439,557 | QA, `desktop` |
| `desktop-03-third-st-bayview-1300-clear.png` | 1600 × 900 | 470,538 | QA, `desktop` |
| `desktop-03-third-st-bayview-0600-fog.png` | 1600 × 900 | 318,616 | QA, `desktop`, 06:00 karl-fog |
| `desktop-04-lombard-russian-hill-1300-clear.png` | 1600 × 900 | 655,444 | QA, `desktop` |
| `desktop-05-embarcadero-ferry-1300-clear.png` | 1600 × 900 | 456,946 | QA, `desktop` |
| `desktop-06-golden-gate-park-1300-clear.png` | 1600 × 900 | 425,804 | QA, `desktop` |
| `mobile-low-01-civic-center-plaza-1300-clear.png` | 1688 × 780 | 250,815 | QA, `mobile-low`, 844 × 390 at DPR 2 |
| `mobile-low-03-third-st-bayview-1300-clear.png` | 1688 × 780 | 191,125 | QA, `mobile-low`, 844 × 390 at DPR 2 |
| `staging-prod-autotier-mobile-low-00-menu.png` | 1600 × 900 | 81,467 | staging `3a5eb603cacf` |
| `staging-prod-autotier-mobile-low-01-creator.png` | 1600 × 900 | 83,440 | staging |
| `staging-prod-autotier-mobile-low-02-intro.png` | 1600 × 900 | 154,525 | staging |
| `staging-prod-autotier-mobile-low-03-play-02.png` | 1600 × 900 | 181,510 | staging |
| `staging-prod-autotier-mobile-low-03-play-11.png` | 1600 × 900 | 209,878 | staging |
| `staging-prod-autotier-mobile-low-05-turn.png` | 1600 × 900 | 163,683 | staging |
| `contact-sheet.png` | 1944 × 1179 | 1,456,954 | ImageMagick `montage` of nine frames, labelled |

What each frame shows, and which finding cites it, is in `capture-study.md` "Frames". The contact sheet holds the same nine frames as the study's sheet (six desktop spots, the 06:00 fog frame at Third Street, the `mobile-low` Third Street frame and staging `03-play-11`), now with a label under each tile. Total about 6.3 MB.

### Differences from the 2026-10-26 frames

The original frames were lost, so the re-capture cannot be compared pixel by pixel; it reproduces the recorded run:

- Every QA teleport landed where the study's did (the run reports give the same positions, for example Market & 4th at x 1203.9, z −646.9), the camera kept the same east-facing heading (at Civic Center the camera stood at x 157.14, z −19.91, as in the study's report), and the look report matches the study's numbers at every desktop spot (`envMap` false with 0 env bakes, `casterKinds` `["l0:buildings"]`, post nodes `gtao-half, bloom, smaa, tonemap`, exposure 1). The second 06:00 fog teleport (Civic Center) returned no result to the script, but the player stood at the spot (x 160, z −20) when the frame was taken.
- The cited defects are visible: the gable roof floating above its wall and trees half-sunk in the slope at Lombard; near-black asphalt with no markings and no curb at Third Street; the dark mullion box at Market & 4th; the open lawn with a few small cones at Golden Gate Park; the aliasing speckle on the ground in the staging intro (in the re-capture it shows as dark dots on the light paving at the lower right, where the study described white sparkle on the asphalt); the dark slab at the top of the sky in staging `03-play-02`; the old `▯` heat-row and Clear glyphs in the staging HUD.
- A QA-only panel ("MISSION none", "start m.dev.sample") shows at the lower left of the QA frames; the recovered script does not hide it (its hide list is the study's), so the study's QA frames most likely showed it too. It never appears in a player build.
- In the staging run, `03-play-02` and `03-play-11` (about 30 s and 120 s after Start) fall inside the m.a1.01 opening cutscene (a Skip button shows); the play HUD is in `05-turn`. The study's text does not say what its `03-play-11` showed.
- The New Game page reported that saving was unavailable in the headless browser (memory-only play) and needed a second Continue; the frames are from after it. Staging was played with no account and no sign-in; no frame shows an email address or other personal data (the only names are the profile name "Coast" typed by the script and the mission NPC's line).

### Not reproduced or not kept

- The study's probe frames (two small City Hall views from `probe2.mjs`) and its run reports and console logs were working files, not in the capture result's frame list; they are not committed. The City Hall moiré the study cites is in `docs/look/M02e-before-after-sf.png` on `claude/build`.
- Staging frames `staging-prod-autotier-mobile-low-03-play-05.png` and `-04-walk.png` were captured again but are not in the study's frame list, so they are not committed.
- No frame shows the bay water clearly (as in the study).

## Re-running the capture

The recovered scripts (not committed; they live in a scratch folder): `qa.mjs <worktree> <outdir> webgl2 <tier> <spots.json> [hour] [weather] [suffix]` drives the QA build (sandbox bypass `dv-qa-play=sandbox`, `?tier=<tier>&gl=1`, `__dvBridge.world.teleport` per spot, `setHour(h, true)`, `setWeather(w, 0)`, `rain(0)`, `settle(90 s)`, 8 s wait, QA-only debug panels hidden, `world.hold(true)` around the screenshot); `staging.mjs <worktree> <outdir> webgpu desktop` plays staging as a player (Title, age gate with an adult date, Terms, New Game named "Coast", creator defaults, intro, then screenshots at about 30 s, 60 s and 120 s of play, a walk and a camera turn) with no sign-in. Desktop runs use 1600 × 900 at DPR 1; `mobile-low` QA runs 844 × 390 at DPR 2. The local `sf` bake needs `.cache/map/raw/sf` as an overlay of symlinks into the operator's raw snapshot, with `raw.lock.json` copied from `content/world/raw.lock.sf.json` (BD-REL-01).
