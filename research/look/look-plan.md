# Look study 2026-10-26: look plan

The final look plan of the 2026-10-26 look study (workflow `wf_34c68ace-179`, label `plan:final`), and the review corrections it applied (label `plan:critique`). The text is the agents' recorded results, formatted into sections with the wording kept. File names of the owner's images are replaced by words ("the owner's frame" or "the owner's screenshot" for the staging frame the owner sent, "the target image" for the owner's fidelity reference); those images are never committed. One brand tag in the critique is written as "franchise tags", as the final plan already wrote it.

The owner answered the plan's three questions the same day (DL-OWN-07): scope yes, "Fog burns off to morning sun", and the fal split as proposed. The Architect integrated it as DL-739 (ids, run order, totals) and DL-740 (amendments). **The draft milestone ids below were renumbered by DL-739** to fit C15 `MILESTONE_ID_RE`:

| Draft id in this plan | Milestone file |
|---|---|
| M02g1 `look-tune`, M02g2 `look-fixes` | M02g1, M02g2 (unchanged) |
| M02h1a `street-markings` | M02h1 |
| M02h1b `curbs-sidewalks` | M02h2 |
| M02h2 `ground-cover` | M02h3 |
| M02h3a/b `vegetation` | M02h4 `vegetation-forms`, M02h5 `vegetation-scatter` |
| M02h4 `street-furniture-parking` | M02h6 |
| M02h5 `facade-detail` | M02h7 |
| M02h6 (XR profile and TRAA) | M02h8 `xr-look-traa` |
| M10d0 `art-admission` | M10d0 (unchanged) |
| M10d1a (vehicles and props), M10d1b (peds and creator parts) | M10d1, M10d4 |

The session totals in DL-739 (Phase 0 1.7 sessions; 126.0 v1 sessions) supersede the estimates below.

## Verdict

The owner's frame shows the game's worst lighting state with placeholder geometry on top: box cars, cone trees, mannequins and grey paving over most of the ground. Lighting and street dressing in code will help. The frame only reads as a real street once cars, people and ground cover change, and DL-OWN-06 (commit 8102fcb9, today) now allows the sources for those.

Causes, in order of how much of the frame each one covers:

1. **Ground.** One grey 4 m paved grid covers hillsides, yards, lots and sidewalks. This is the largest area of the image. Terrain shows large flat facets.
2. **Placeholder objects.** Cars and the truck are three boxes (traffic/instances.ts, vehicle-view.ts). Every tree is the same 20-triangle cone, taller than 3-storey buildings, because the bake writes species = fnv32(name)%8, which carries no form. People and Coast are mannequins. There are no parked cars, although C08 parkingSides exists.
3. **Lighting.** Mission m.a1.01 locks 06:00 Karl fog. look.json karl-fog keyframeWeight 1.0 fully replaces the M02e physical sky and env map. Every window is lit on every floor. The tone map is Neutral at exposure 1 with no grade.
4. **Roads.** Flat one-colour ribbons with no UVs, so no markings, crosswalks or curbs. Overlapping ribbons z-fight at junctions. Asphalt is near-black, below the study's 0.12-0.18 albedo.
5. **Grounding.** Only L0 buildings cast shadows, and the C13 blob mode is not built. Low tiers have no contact darkening (no AO).
6. **Camera.** One constant (VEHICLE_FAR_M=11) for every vehicle, so the tow-truck boom fills the frame.

What changes in this revision:

- Q-39 is answered by DL-OWN-06. Admitted: licensed CC0, CC-BY 4.0 or equivalent models (Sketchfab and SF-specific included), plus fal 3D for non-character rows inside the unchanged $100 cap.
- The spike ledger shows $0 spent: M00c skipped because FAL_KEY was not set (commit 5c583501, totalMicros 0). The full $100 is unspent, and a split is proposed below.
- HUD icons are owned by DL-738 (kit SVGs, task #71 / M04e5) and are dropped from this plan.

Before tuning anything:

- Confirm the owner's browser and tier. In classify.ts, macOS Safari is class desktop, so it boots provisionally at `desktop` and autotier may lower it. WebKit has no env map either way.
- Read the owner's C13 1.2 boot record (DL-725).
- Make a `webkit-webgl2` golden of the story-start frame the owner-representative check.

Realistic scope:

- About 10-11 added sessions, not 6.7. v1 goes from 115 to about 126.
- About $14 of fal moves to vehicles.
- Two Architect confirmations: re-purposing the C08 species byte, and filling RenderChunk.furniture.

## Quick wins

### Step 0

Step 0, before any tuning (operator plus 0.1 session):

- Pull the owner's boot record or telemetry: browser, device class, provisional and final tier.
- Add a `webkit-webgl2` golden of the m.a1.01 truck stage at that tier as the owner-representative check, beside the Chromium goldens.
- If the owner's Safari lands on `lite` or `mobile-low`, put that tier first in every acceptance check below.

### Fix session A

Fix session A, proposed M02g1 `look-tune` (1 session, $0):

1. **Grade.** Analytic lift/gamma/gain, saturation and warm-sun/cool-shade split tone inside the existing `tonemap` node (post/nodes.ts). Per-weather values in look.json and its schema. No 3D LUT. On mobile-low and XR the same grade runs in the fog node (sky/fog.ts) at a few ALU operations. Keep Neutral; switch to ACES Filmic only if an A/B against Neutral wins with the explicit grade. Reject AgX by default because it desaturates and flattens.
2. **Haze.** Aerial perspective in sky/fog.ts: sun in-scatter lobe, exponential extinction, Rayleigh tint.
3. **look.json.** karl-fog keyframeWeight 1.0 to about 0.35, overcast to about 0.6. Raise the bloom threshold.
4. **Shadows.** Build the C13 `blob` mode: 1 instanced quad for cars, peds and the player on every tier. On desktop csm, casters for the player car, nearest traffic and trees within 60-80 m, with PCFSoftShadowMap.
5. **Reflections.** An analytic skyReflect(R) helper (sky gradient + sun lobe x Fresnel) for glass, water and paint wherever there is no env map. That covers every WebKit tier, so it reaches the owner.
6. **Camera.** Chase offset derived from each vehicle's bounds, not one constant. Exclude or fade the player's own boom and attachments in camera collision. Pitch puts the horizon 35-40% from the top. Align yaw on teleport and respawn. No FOV change in XR; speed-FOV deferred.
7. **Windows.** Lit-window ratio driven by time of day (seeded per window cell), so dawn shows a few lit windows, not all.
8. **Asphalt.** Albedo lift to 0.12-0.18.

Every new layer is gated per look profile so `legacy` (Quest) does not pick up cost silently. The ms figures are unmeasured: check:perf is CPU only.

### Fix session B

Fix session B, proposed M02g2 `look-fixes` (about 0.7 session, $0):

1. **Vertex AO.** Baked in the mesher: wall bases, the ground ring around buildings, curb edges, eave undersides. About 0 ms, and the main win on mobile-low and Quest, which have no GTAO.
2. **Terrain.** Smooth normals, plus a finer terrain grid near the camera.
3. **Roofs and trees.** Snap gable and hip roof bases to the wall top. Ground each tree at its trunk base. Give trees a height distribution capped below typical eave height.
4. **Z-fight.** Polygon offset or depth bias for coplanar ground classes, the landmark proxy mask and overlapping junction ribbons.
5. **Footprint fades.** On asphalt noise (mobile-low sparkle) and landmark materials (City Hall moiré).
6. **Floating slab.** Find and fix the floating dark slab in staging-prod-autotier-mobile-low-03-play-02.png.
7. **Far trees.** Drop or shrink far-LOD trees on the horizon.
8. **Classifier.** Fix the HeadlessChrome match in classify.ts so Chromium CI tests IBL. This needs a golden-update label. It moves the Chromium goldens away from what a Safari owner sees, so it only lands together with the step-0 WebKit golden.

HUD glyphs are out of scope: DL-738 and task #71 cover them.

### After A and B

Republish staging after A and B, and send the owner the WebKit and Chromium before/after frames.

Say plainly that the opening frame stays a dawn fog frame until the owner answers the story-start question. At a locked 06:00 with a late-October sun, the sun may still be below the horizon (sunrise is about 07:20), so session A alone cannot make that shot sunlit.

## Phases

| Phase | Sessions | Dollars | Owner decision |
|---|---|---|---|
| [Phase 0](#phase-0-look-tune-and-look-fixes) | 1.8 | $0 | None for the engine work. The opening frame depends on owner question 2 (story-start lighting). |
| [Phase 1](#phase-1-street-realism-code-only) | 6.5 | $0 | Approve about 10-11 added sessions overall, which moves v1 from 115 to about 126 (owner question 1). The Architect confirms the species and furniture field use and writes the files, DL rows and the _PLAN, README and kickoff rows. |
| [Phase 2](#phase-2-art-admission-and-pbr-detail) | 1.0 | $0 (CC0 and CC-BY) | None: DL-OWN-06 already admits these sources. |
| [Phase 3](#phase-3-m10d1-moved-forward-vehicles-and-props-then-peds) | 2.0 | Inside the fal split in owner question 3. Licensed models $0. Art-lead time is unpriced (Q-24). | Owner question 3 (fal line split). |
| [Phase 4](#phase-4-m10d3-and-m10d2-in-their-current-slots-amended) | 2 (as planned) | From the vehicles line (owner question 3) | Owner question 3. |
| [Phase 5](#phase-5-xr-look-profile-and-traa) | 0.8 | $0 | None. Needs a Quest 3 device pass (operator). |

### Phase 0: look-tune and look-fixes

Phase 0: look-tune and look-fixes (proposed M02g1, M02g2).

Step 0 plus fix sessions A and B as listed under quick wins. These are M02e follow-ups. Each needs an Architect milestone file and a DL row closing part of the DL-704 gap.

Run order:

- insert after build loop 9's in-flight milestone;
- start after M02f2 merges, because both touch world-view.ts and boot-world.ts;
- then republish staging.

AC added to both:

- a render-object ledger per profile (desktop, mobile, mobile-low, legacy) against the measured baseline;
- mobile-low stays at or under 100 render objects;
- `legacy` adds 0.

### Phase 1: street realism, code-only

Phase 1: street realism, code-only (proposed M02h1-M02h5).

Mobile-low render-object plan, to check against the measured baseline before work starts:

- blob shadows +1;
- markings and curbs 0 (in the road mesh and shader);
- ground cover 0 (in the ground mesh);
- trees +2 (opaque crowns, two merged forms);
- furniture +2;
- parked cars +1 (sharing traffic's instanced bodies).

Total: about +6.

**M02h1a `street-markings` (1 session).**

- per-vertex `road` attribute on addRibbon;
- shader markings: dashes, double-yellow, edge lines, parking Ts, bus-lane tint;
- crosswalk and stop-bar quads, a junction patch surface;
- AC: markings antialiased with fwidth and faded with distance; no sparkle in a mobile-low and Quest-profile golden;
- flat painted-edge profile on mobile-low and XR.

**M02h1b `curbs-sidewalks` (1 session).**

- 0.10-0.12 m curbs with a gutter;
- sidewalk ribbons from PedEdges;
- lots and plazas shaded apart;
- bump normals from the existing noise heights;
- 50-200 m macro variation.

**M02h2 `ground-cover` (1 session, new).**

- land-cover classes: yard grass, dirt, mixed, driveway, vacant lot, hillside scrub, park;
- source: OSM landuse in the bake, plus a default rule (non-road, non-building, inside a residential block = yard);
- needs a bake-stage addition, an sf re-bake and a staging publish.

**M02h3a/b `vegetation` (1.5 sessions).**

- species byte becomes a form class: needs the Architect's confirmation, a bake-id bump and a re-bake;
- 4-5 procedural forms with height distributions;
- per-chunk instance ranges or CPU distance culling, not one global InstancedMesh per form;
- opaque low-poly crowns on mobile-low and `xr` (no alpha test);
- alpha-to-coverage only on Quest with MSAA, if ever;
- wind sway desktop only;
- park scatter.

EZ-Tree: the MIT code only after license:scan, and its bundled bark and leaf textures need their own licence check or replacement.

**M02h4 `street-furniture-parking` (1 session).**

- signal masts reusing traffic/lights.ts, stop signs, hydrants about every 90 m, meters, shelters, benches, poles;
- parked cars along parkingSides: render-only instances from the traffic body pool, seeded per curb segment, no sim entities;
- original sign faces;
- Muni wires desktop only;
- filling RenderChunk.furniture from the bake needs the Architect's confirmation, otherwise place at mesh time.

**M02h5 `facade-detail` (1 session).**

- storefront bands with awning and sign panel, cornices, recessed-window bump, bay windows for ResLow and ResMid, glass via skyReflect;
- interior mapping and rooftop clutter deferred;
- compatible with M10d2 setFacadeAtlas.

Run order: after Phase 0 and before M10d1.

### Phase 2: art admission and PBR detail

Phase 2: art admission and PBR detail (proposed M10d0 `art-admission`).

**Admission.**

- licence snapshots `docs/legal/licenses/<pack>.md` with SHA-256, plus spec/03 facts dated 2026-10-26, for Poly Haven, ambientCG, Quaternius (Universal Animation Library included) and Kenney;
- closes U-AST-10 (§7 U10) per pack; no Builder imports before that;
- create credits.json plus an in-game credits screen: CC-BY 4.0 needs attribution reachable in the shipped game and a note of the changes made.

**Written vetting checklist for licensed models (DL-OWN-06).** Default: reject when origin is unclear. Reject on:

- real make or model names, badges, grilles or silhouettes;
- game-style file or texture names (`_lod0`, `vehshare`, `.yft`, `.ytd`, `_hi`, franchise tags);
- uploaders with many cars from one franchise;
- no evidence of original authorship (no wireframe, WIP shots or portfolio).

Other rules:

- OpenGameArt is treated like Sketchfab, with the page snapshotted;
- SF scans and landmark models (Golden Gate, Transamerica) go through research/legal-ip-likeness.md: no storefront logos, people, murals or public art;
- the target image is never committed (ip:signatures); since DL-OWN-10 (2026-10-30) the owner's look references may be used as look inputs (fal reference inputs, side-by-side comparisons, palettes), read from outside the repository; photos of real cars are still never inputs;
- SKETCHFAB_API_TOKEN access is UNVERIFIED, so the fallback is owner hand-download to content-incoming/.

**Textures.**

- KTX2 PBR sets: asphalt with cracks and patching, concrete, pavers, grass and dirt, brick, stucco;
- mobile variants at tight byte budgets;
- a triplanar or stochastic tiling node, wired into the Phase 1 surfaces;
- texture memory tracked against the iPhone ~2 GB WebContent limit.

The Architect also amends M10d2 AC-7 to add a mobile facade-atlas variant.

### Phase 3: M10d1 moved forward, vehicles and props, then peds

Phase 3: M10d1 moved forward, vehicles and props, then peds (M10d1a, M10d1b).

M10d1's dependencies are merged, so it moves to right after Phase 2, and M10f moves with it. It is split to stay inside C15 L7.

**M10d1a vehicles and props.**

- traffic, police and robotaxi bodies from fal Tripo H3.1 (spec §11 recipe) and/or vetted CC0 or CC-BY bases, remodelled with fictional makes and altered silhouettes;
- separate glass, tyres, rims and emissive light nodes;
- clearcoat paint on desktop, MeshStandard at roughness 0.3 on mobile;
- every import gets a meshopt LOD chain and per-tier triangle caps (sources arrive at 50k-500k triangles);
- vehicles pass H6 and the optimize, verify and vision gates;
- a few body families at a handful of InstancedMeshes.

**M10d1b peds and creator parts.**

- first compare Quaternius CC0 humans with MakeHuman before committing;
- MakeHuman needs an ADR (the program is AGPL, MPFB2 is GPL, tool-only), and only the base mesh and official assets are CC0, so community clothes and hair are out;
- clips: Quaternius Universal Animation Library, retargeted to bay_rig_v1;
- Mixamo stays rejected;
- crowds: skinned peds are one draw call each, so mobile-low and Quest need vertex-animation textures or impostor crowds, with a per-tier visible-ped cap set as an AC.

### Phase 4: M10d3 and M10d2 in their current slots, amended

**M10d3** (14 player cars, six stages) stays: it waits on M07b2, M08b2 and M10a2. It uses the Phase 3 car route; the 14 player bodies come from the proposed fal vehicles line.

**M10d2** stays last: facade atlas plus mobile variant, skyline cards, the landmark pass, the desktop-ultra adapter, assets:final.

**Spec contradictions for the Architect.** §11 still says 'Not funded by fal in v1: generated vehicle bodies, generated props', and M10d3 Scope in forbids the generated route. Both contradict DL-OWN-06, and §7's three buffer-funded Meshy bodies disagree with M10d3 too. Rewrite §11 with the approved split.

**Coast.** The stylized model stays a mannequin until M10a2. It depends on M10a1, M08b1 and the characters line. Tell the owner.

### Phase 5: XR look profile and TRAA

Phase 5: XR look profile and TRAA (proposed M02h6).

**XR profile.**

- add an `xr` look profile: look-materials.ts, config.ts, and the LookProfile enum in world-look.schema.json;
- contents: the min building path, hard-step markings, skyReflect, grade and haze in the fog node, blob shadows, opaque tree crowns, vertex AO;
- map xr-quest and xr-visionpro to it, keeping `legacy` as the fallback;
- confirm multiview, otherwise every render object counts twice.

**TRAA.** Raise postLevelCap to 3 on desktop once M11a1's governor can lower it.

**Water.** Fresnel sky reflection on all tiers; shore foam. SSR is cut.

**Run order.** After M11a1 and before M11b1. Measure on a Quest 3 before making `xr` the default.

## Owner questions

The owner answered all three on 2026-10-26 (DL-OWN-07); question 4 needs no answer unless the boot record is wrong.

1. **Scope.** May we add a street-realism set before M10d1, about 10-11 sessions at $0 fal? v1 would go from 115 to about 126.
   - Phase 0 fixes: 1.8 sessions.
   - Markings, curbs, ground cover, vegetation, furniture with parked cars, and facade detail: 6.5 sessions.
   - Art admission: 1 session.
   - The M10d1 split: +1 session.
   - XR profile: 0.8 session.

   Recommended: YES. Ground cover, markings and parked cars have no milestone today, and they cover most of the frame.
2. **Story-start lighting.** The first mission locks 06:00 Karl fog, which is possibly before sunrise. It is the worst first impression we have, and grading cannot make it sunlit.
   Recommended: keep the dawn intro cutscene, then release the clock lock from the `truck` stage so the fog burns off into morning sun for the first drive. First check whether the dawn clip's cutscene key includes the weather. If it does, it is re-keyed under the M05c3 budget.
   Alternative: start at 11:00 after burn-off.
3. **fal cap split (DL-OWN-06 asks the look plan to propose one).** The spike ledger shows $0 spent: M00c skipped because FAL_KEY was not set, so all $100 remains.

   Proposed lines:
   - Spike: $10 down to $4 (its est. $3.76 still runs before the M10a1 canary).
   - Characters: $42, unchanged (est. $41.96).
   - Cutscenes: $40 down to $38 (est. ≈ $37.6).
   - Vehicles and props (new): $14.
   - Buffer: $8 down to $2.

   What $14 buys: vehicle bodies on the §11 Lean recipe without the rig, 4 concept views ($0.25) plus 2 Tripo H3.1 standard candidates ($0.60), about $0.85 a body. That is 14 player cars ($11.90) plus 2 traffic hero families ($1.70), $13.60 in fal fees. The remaining traffic, police, robotaxi and all props come from vetted CC0 or CC-BY models or code recipes. All 28 bodies by fal would cost about $24, still inside the cap if the owner prefers. Blender wheel separation and gate time are extra and unpriced. The earlier $2.48 Meshy route and the '$21-69 breaks the cap' claim are withdrawn.

   Recommended: YES to this split. Alternative: keep cutscenes at $40 and the buffer at $0, which risks having nothing left for rejects.
4. **Browser and device.** Which browser and device did you use for the owner's frame? It looks like Safari on a Mac. Will you mostly judge the look on that machine, an iPhone, or a Quest? Recommended: we read your boot record ourselves. Confirm only if it is wrong, because it decides which tier we tune and check first.

## Honest ceiling

The target image reads as a frame from an AAA offline-quality game: photogrammetry density, hand-built cars and people, per-leaf foliage and global illumination. No tier of this browser game will match it. It is a fidelity reference only: never committed, never sampled for a palette, never fed to fal.

What is realistic after Phases 0-4, per tier:

- **desktop and desktop-ultra (WebGPU).** A recognisably real SF street with painted lanes, curbs, yards and parked cars, PBR ground, trees and palms, signals, cascaded shadows with AO, haze and a grade. It reaches a solid mid-budget realistic game only with sourced or fal cars and people (Phase 3). With recipe cars it stays stylized-clean. No ray-traced GI or reflections, no photogrammetry density, no per-leaf foliage.
- **Safari on macOS (likely the owner).** Desktop-class layout, but there is never an env map. Reflections are the analytic skyReflect, so glass and paint look flatter than on Chromium.
- **mobile.** The same layout with fewer layers: textured surfaces, the grade, one cascade plus blob shadows, opaque low-poly trees.
- **mobile-low (iPhone 15 at 30 fps, 100 render objects).** Grade and haze in the fog node, hard-step antialiased markings, painted curbs, opaque 40-60-triangle tree crowns, vertex AO, impostor or capped crowds. A tidy, lit, realistic-leaning low-poly city, the furthest of all tiers from the target image.
- **Quest 3 and Vision Pro.** Stay on `legacy` until Phase 5 (after M11a1). After that they come close to mobile-low.

Every ms and render-object figure is an estimate until device passes run (M11a1, M14b3 on iPhone 15 and Quest 3), because check:perf measures CPU only. The opening frame stays dawn-grey unless the story-start question is answered. Coast stays a mannequin until M10a2.

## Bugs found

1. **Fog replaces the sky.** config/world/look.json: karl-fog keyframeWeight 1.0 makes the flat dome fully replace the physical sky and env map. Overcast is too strong as well.
2. **Tree species byte is meaningless.** The bake writes species = fnv32(name)%8, which carries no tree form, and the mesher ignores it. Every tree is the same cone, taller than nearby 3-storey buildings.
3. **Furniture never filled.** RenderChunk.furniture is always empty (tools/map s13-pack.ts).
4. **Blob shadows missing.** The C13 `blob` shadow mode is not built. Only L0 buildings cast shadows, so cars, trees and people float.
5. **Headless Chromium misclassified.** packages/shared/src/platform/classify.ts isChromiumEngine does not match `HeadlessChrome/`, so headless Chromium is classified as Safari. CI goldens therefore run without IBL.
6. **Chase camera.** VEHICLE_FAR_M=11 is one constant for all vehicles (sim/camera/collision.ts). A flat 6.5 can put the camera inside the tow-truck boom, and the player's own attachments are not excluded from camera collision.
7. **Window lighting.** Every window on every floor is lit, whatever the time of day.
8. **Asphalt too dark.** Albedo is below the 0.12-0.18 study value, so markings would sit on near-black roads.
9. **Mesher defects.**
   - gable and hip roof bases float above the wall top (sky gaps);
   - trees are not grounded at the trunk;
   - coplanar ground classes and overlapping junction ribbons z-fight;
   - terrain normals are faceted.
10. **Shimmer.** Asphalt noise sparkles on mobile-low, and landmark materials show moiré at City Hall (docs/look/M02e-before-after-sf.png).
11. **Unexplained slab.** A floating dark slab appears in the staging intro (staging-prod-autotier-mobile-low-03-play-02.png).
12. **Horizon cones.** Far-LOD tree cones line the horizon.
13. **Spec contradictions (Architect).**
    - 05-assets-pipeline.md §11 still lists generated vehicle bodies and props as 'Not funded by fal in v1', against DL-OWN-06;
    - M10d3 Scope in forbids the generated route that §7 and DL-OWN-06 allow;
    - §11 lines must be rewritten once the owner approves a split.
14. **Spike ledger never run live.** research/genai-spike/ledger.json shows totalMicros 0 (spike skipped, FAL_KEY not set). The spike's live checks are still outstanding before any fal vehicle or character batch.

## Critique corrections applied

The art-direction and tech-lead review of the first plan draft (label `plan:critique`). The final plan above applied these corrections.

### A. The plan's premises are out of date. Fix these first.

1. Q-39 was answered today by DL-OWN-06 (commit 8102fcb9). The owner admits CC0, CC-BY 4.0 and similar licensed models, including Sketchfab and SF-specific models, plus fal-generated 3D for non-character rows inside the unchanged $100 cap. The plan still treats fal as banned for final art and asks the owner Q-39 again. Drop owner questions 1 and 4 in their current form.
2. DL-OWN-06 says "the look plan proposes the split" of the fal cap. The plan doesn't propose one. Add a split showing:
   - the remaining cap after the spike's actual spend (from `research/genai-spike/ledger.json`);
   - what the characters ($42) and cutscenes ($40) lines must keep;
   - the proposed vehicle and prop line.
3. The plan's car-cost claim is wrong under its own spec. It says 28 bodies would cost about $21–69 and "break the $100 cap". `05-assets-pipeline.md` already prices Tripo H3.1 standard at $0.60 for two candidates, so 28 bodies with retries cost roughly $10–20 in mesh fees, before Blender work to split the wheels. Re-price from the spec table, not from the $2.48 Meshy route.
4. HUD icons are already decided by DL-738 (inline SVG from `packages/ui/src/kit/icons.tsx`). Remove them from fix session B instead of re-planning them.
5. Find out what tier and browser the owner actually ran before tuning anything. The window chrome in the owner's screenshot suggests Safari on macOS. Read the owner's boot record or telemetry for the tier. If Safari auto-picks `mobile-low` or `lite`, most of the desktop work never reaches the owner. Make a WebKit golden (`webkit-webgl2`) the owner-representative check. Fixing HeadlessChrome in `classify.ts` moves the Chromium goldens *further* from what the owner sees.

### B. Big visual gaps the plan misses

(From the owner's screenshot against the target image.)

1. **Ground cover.** Grey 4 m paving covers the hillsides, back yards and lots in the owner's frame. That is the biggest area of the image. Phase 1 only separates plazas and lots from sidewalks. It needs a land-cover pass: residential yards as grass, dirt or mixed; driveways; vacant lots; hillside scrub. Use OSM landuse plus a default rule of "non-road, non-building, inside a residential block = yard".
2. **Contact darkening on tiers with no AO.** Mobile-low and Quest have no GTAO, so walls meet the ground with no darkening and objects look pasted on. Baked vertex AO in the mesher costs about 0 ms and is a big win on low tiers: wall bases, the ground ring around buildings, curb edges, the underside of eaves.
3. **Scale and silhouette.** The cone trees are taller than the 3-storey buildings, and buildings are plain boxes with lit windows on every floor at 06:00. Add a tree height distribution per form, and a lit-window ratio driven by time of day, so not every window glows.
4. **Parked cars along the curb.** The `parkingSides` data exists, and a solid line of parked cars is one of the strongest street cues in the target. The plan places meters on parking sides but no parked cars.
5. **Terrain faceting.** The hills show large flat triangles. Add normal smoothing or a higher-resolution terrain near the camera.
6. **Asphalt albedo lift.** The study's 0.12–0.18 asphalt albedo is missing from M02h1's list. Without it, markings sit on near-black roads.
7. **Chase camera per vehicle, not one constant.** Moving VEHICLE_FAR_M from 11 to 6.5 for the tow truck can put the camera inside the boom. Derive the camera offset from each vehicle's bounds, and exclude or fade the player's own boom in camera collision. Turn off the speed-based FOV change in XR.

### C. Items that won't move the look much for their cost (cut or defer)

- Interior mapping (M02h4). Seen from a fast low chase camera it barely reads. Storefront bands, awnings, cornices and glass reflection do more for less. Defer it.
- Rooftop clutter. It is invisible from street-level and chase cameras.
- Muni overhead wires. Thin lines shimmer without TRAA. Desktop only, or defer.
- A per-weather 32³ 3D LUT built in code. Analytic lift/gamma/gain, saturation and split-tone parameters are enough, and the LUT costs a 3D texture fetch per fragment on tiers without post.
- SSR on desktop-ultra in rain, and speed-based FOV widening. Both are polish.
- AgXToneMapping. three's AgX desaturates and flattens by default, which is the opposite of "warm, contrasty". A/B Neutral and ACES Filmic with the explicit grade before switching.
- The MakeHuman ped pipeline. AGPL tool, an ADR, decimation and bone mapping onto `bay_rig_v1` is a lot of work for 8 × 20 outfits. Compare it with Quaternius CC0 humans before committing.

### D. Licence risks

1. **Sketchfab realistic cars.** These are mostly replicas of real makes, which is trade dress and excluded by DL-OWN-06 whatever the licence says. Many "CC-BY" cars are also rips converted from Forza, a certain open-world crime series, or NFS. The plan needs a written vetting checklist that rejects:
   - real make or model names, badges, grilles or silhouettes;
   - game-style file or texture names (`_lod0`, `vehshare`, `.yft`, `.ytd`, `_hi`, franchise tags);
   - uploaders with many cars from one franchise;
   - any model without evidence of original authorship (wireframe or work-in-progress shots, a portfolio).

   Default: reject when origin is unclear.
2. **SF-specific Sketchfab scans.** Photogrammetry of streets bakes in real storefront logos and signage, people, and murals or public art, all excluded. Landmark models (the Golden Gate Bridge, the Transamerica Pyramid) carry trademark claims. Route them through `research/legal-ip-likeness.md` and do not import them blind.
3. **The target image.** It looks like a frame from another publisher's game. Keep it out of the repo (`ip:signatures`). Don't derive a LUT or palette from it, and never feed it, or photos of real cars, to fal image-to-3D.
4. **OpenGameArt (rgsdev pack).** The licence is attested only by the uploader, and the site has hosted rips. Snapshot the page and check originality like a Sketchfab asset.
5. **MakeHuman.** The CC0 export rule covers the base mesh and the official bundled assets only. Community-library clothes and hair carry their own, mixed licences. MPFB2 is GPL and may only run as a tool. Each needs its DL or ADR under DL-614 and DL-629.
6. **EZ-Tree.** The code is MIT, but the bark and leaf textures it ships need their own licence check.
7. **Admission rules.** Poly Haven, ambientCG, Quaternius and Kenney (including the Quaternius Universal Animation Library) are still UNVERIFIED in §7 (U10). Each needs a snapshot and a `spec/03` fact before any Builder imports it. CC-BY 4.0 also requires attribution reachable in the shipped game (a credits screen, not only `credits.json`) and a note of the changes made.
8. **Mixamo rejection is correct.** Keep it.

### E. Performance risks on mobile-low and Quest

1. **No render-object budget table.** Phases 0–1 add blob shadows (1), furniture pools (2), 4–5 tree forms plus impostors, and curbs, and the plan never adds them up against mobile-low's 100 render objects. Quest doubles the cost per eye unless multiview is confirmed.
2. **Global InstancedMesh per tree form.** It defeats per-chunk frustum culling: every instance in the loaded radius is vertex-shaded, plus wind sway. Use per-chunk instance ranges or CPU distance culling.
3. **Alpha-tested impostors and foliage.** Discard breaks early-Z on iPhone and Quest tile GPUs and causes overdraw. Quest with MSAA needs alpha-to-coverage. Use opaque low-poly crowns on mobile-low and `xr`.
4. **Fine markings and dashes.** With no AA on mobile-low and post-free Quest they will sparkle, as the asphalt noise already does. Antialias them in the shader (fwidth) and fade them with distance. Make that an AC.
5. **Grade and haze in the fog node.** Without post, the grade runs per fragment, multiplied by overdraw. Keep it to a few ALU operations and no LUT on mobile-low and XR.
6. **Imported cars and peds.** Sketchfab and fal meshes come in at 50k–500k triangles, so each needs a meshopt LOD chain and per-tier caps. Skinned peds cannot be instanced in three, so each one is a draw call; 8 × 20 realistic peds will blow mobile-low's budget without vertex-animation textures or impostor crowds. Texture memory also has to stay under the iPhone WebContent limit of about 2 GB.
7. **Quest stays on `legacy` through Phases 0–4 (Phase 5 comes after M11a1).** Gate every new layer per profile so `legacy` doesn't silently pick up its cost.

### F. Overpromising

1. **"Warm, sunlit" after fix session A.** At the locked 06:00 start the plan itself says the sun drops to about 0.18, and late-October sunrise in SF is around 07:20, so the sun may still be below the horizon. Fix session A cannot make the owner's opening frame sunlit unless owner question 3 (story-start lighting) is answered. Say so.
2. **"Most of the gap closed in code at $0."** The dominant objects in the owner's screenshot are box cars, a box truck, cones, mannequins and grey paving. Lighting and street dressing help, but the frame reads as "real" only once cars, people and ground cover change.
3. **Session estimates are low and risk the C15 L7 limit.** M02h1 (markings, curbs, sidewalk ribbons, junction patches, bump, macro variation, mobile profile) is about 1.5–2 sessions. M02h2 (re-bake, park scatter, impostors, wind) is about 1.5. M02h4 is about 2 with interior mapping, or 1 without. The realistic total is about 9–10 added sessions, not 6.7.
4. **"No contract change."** Turning the C08 species byte into a form class, and filling `RenderChunk.furniture` from the bake, changes the meaning of contract fields and the bake id. Both need the Architect's confirmation, a re-bake and a staging republish, not a Builder-only call.
5. **"Mid-budget realistic game" on desktop.** That holds only with sourced or fal cars and people, which DL-OWN-06 now allows. With recipe cars it stays stylized-clean. All millisecond figures are unmeasured, since `check:perf` measures CPU only.

(The critique's milestone ids, such as M02h1, M02h2 and M02h4, are the first draft's ids, not the files' ids.)
