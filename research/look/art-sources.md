# Look study 2026-10-26: art sources

The art-source research of the 2026-10-26 look study (workflow `wf_34c68ace-179`, label `study:art-sources`): the agent's recorded result, formatted into sections with the wording kept. **All licence pages were checked on 2026-10-26** (WebFetch and the public APIs) and were not re-fetched for this file; quotes and URLs are as recorded that day. A Builder takes licence terms only from the dated snapshots M10d0 writes (`docs/legal/licenses/<pack>.md`), never from this summary. File names of the owner's images are replaced by words ("the owner's screenshot", "the target image"); those images are never committed.

Milestones cite it as "art-source study" plus a section name (for example art-source study "Ground" or "Licence gate setup"). Each section below starts with the area as the study wrote it.

## Summary

ART-SOURCE research, 2026-10-26. I looked at all three images. The owner's screenshot of the real sf bake is still placeholder art: flat-shaded cone trees, box cars and the tow-truck boom drawn as a yellow box, untextured ground, flat facades with emissive window squares, and no road markings, street furniture or reflections. The target image gets its look from real car bodies with clearcoat reflections, dense broadleaf trees and palms, poles, signals and signs, worn asphalt with painted lines, and an HDR sky.

## Licence pages checked 2026-10-26

Licence pages checked today with WebFetch and the public APIs:

| Source | URL | Recorded quote (2026-10-26) | Note |
|---|---|---|---|
| Poly Haven | https://polyhaven.com/license | "Our assets are all licensed as CC0" … "You can redistribute them … or even in a product you sell" … "You do not need to give credit" | Its API (https://polyhaven.com/our-api) is "free for everyone - including commercial use" but needs a unique User-Agent. The API reports 521 models, 997 HDRIs and 869 textures. |
| ambientCG | https://docs.ambientcg.com/license/ | "All ambientCG assets are provided under the Creative Commons CC0 1.0 Universal License" … "You can include the raw files in your project, for example a video game." | |
| Kenney | https://kenney.nl/support | "all game assets on the asset pages are public domain licensed (CC0)" | Its logo is reserved. |
| Quaternius | https://quaternius.com/faq.html | "All models are under the CC0 License." | |
| MakeHuman | FAQ and LICENSE.md on GitHub (no URL recorded) | "The exported models end up being licensed CC0" | The program is AGPL, but it runs as a separate desktop program. Bundled assets are CC0. |
| Mixamo | Adobe helpx FAQ (returned 403) | community copy of the FAQ (2022): "the only thing you can't do is distribute the raw character and animation files" | A web build serves those files as raw GLBs, so I reject Mixamo for anything shipped. |
| Sketchfab | the API's /v3/licenses list | CC0 "Credit is not mandatory. Commercial use is allowed"; CC-BY "Author must be credited. Commercial use is allowed" | NC, ND, SA and Editorial are excluded. See "Sketchfab search results" below. |
| Khronos glTF samples | per-model licences | for example CarConcept "© 2024, Darmstadt Graphics Group GmbH. Creative Commons Attribution 4.0" | Useful only as test fixtures for clearcoat and other material features. |
| NASA | svs.gsfc.nasa.gov/4720 (CGI Moon Kit) | content "generally [is] not subject to copyright in the United States" | The Insignia is not public domain. The CGI Moon Kit asks for the credit "NASA's Scientific Visualization Studio". |
| Fab EULA | fab.com/eula | returned 403 | Not checked. |
| TurboSquid, CGTrader | — | not checked | Paid marketplace terms for files a browser can extract are unverified. |

### Sketchfab search results

CC0 search results are mostly museum scans. CC-BY vehicle results visibly include game rips ("Tow Truck - Construction Sim 2", "tow truck (burnout 1)", "Poppy Playtime … Cable Car", "Crown Victoria Taxi Game") and real makes (Oldsmobile, Volvo, Isuzu). That confirms the rip risk: only vetted single models with a clear author can be used.

### Others found

- EZ-Tree (MIT, a procedural Three.js tree generator).
- The rgsdev "Free Low Poly Vehicles Pack" on OpenGameArt ("Licence is CC0").
- Quaternius Universal Base Characters and Universal Animation Library (CC0, glTF).
- MUTCD sign designs. The public-domain status of MUTCD signs comes from a secondary source, Wikimedia Commons citing MUTCD page I-1, with the Interstate Shield excepted. It still needs checking against the primary source.

## Bottom line

- **Covered with verified CC0 sources:** textures, HDRIs, street props and peds. Poly Haven, ambientCG, MakeHuman and Quaternius UAL meet §7 with a licence snapshot. Each can close U-AST-10 for its own pack.
- **Vehicles are the gap.** No verified CC0 source has realistic sedans, SUVs, police cars, tow trucks, buses or cable cars. CC0 vehicle packs are stylized low-poly, and realistic CC-BY ones carry rip and trade-dress risk. Realistic cars need one of: an art lead authoring them (Q-39), a paid kit after the owner and counsel review its terms, or an owner exception to DL-OWN-01 for generated bodies.
- **fal option (not spent):** prices from research/genai-pipeline-fal.md, F-045 and §11. A generated car body costs $0.76 (Hunyuan 3.1 Pro multi-view) to $2.48 (the §7 Meshy route) plus Blender work to separate the wheels. A prop costs about $0.34 (Trellis-2). The $8 buffer covers only a few of these.
- **Repo gaps:** `config/license-allowlist.json`, `credits.json` and `docs/legal/licenses/` do not exist in this checkout yet. M10d1 must create them before any pack is imported.

(Q-39 was answered later the same day by DL-OWN-06, and the fal split by DL-OWN-07; the plan withdrew the $2.48 Meshy pricing in favour of the §11 Tripo route. See `look-plan.md`.)

## Findings

| Section | Needs owner |
|---|---|
| [Ambient traffic](#ambient-traffic) | yes |
| [Taxi, police and tow truck](#taxi-police-and-tow-truck) | yes |
| [Bus, streetcar and cable car](#bus-streetcar-and-cable-car) | no |
| [Player and hero cars](#player-and-hero-cars) | yes |
| [Pedestrian bodies](#pedestrian-bodies) | no |
| [Ped and crowd animation clips](#ped-and-crowd-animation-clips) | no |
| [Street trees and foliage](#street-trees-and-foliage) | no |
| [Street furniture](#street-furniture) | no |
| [Traffic signals and road signs](#traffic-signals-and-road-signs) | no |
| [Facade atlas and building PBR](#facade-atlas-and-building-pbr) | no |
| [Ground](#ground) | no |
| [HDRI skies and environment reflections](#hdri-skies-and-environment-reflections) | no |
| [Moon and night sky](#moon-and-night-sky) | no |
| [Low-poly CC0 catalogues](#low-poly-cc0-catalogues) | no |
| [Khronos glTF Sample Assets](#khronos-gltf-sample-assets) | no |
| [Generated 3D via fal](#generated-3d-via-fal) | yes |
| [Licence gate setup](#licence-gate-setup) | no |

### Ambient traffic

Area: Ambient traffic: sedans, SUVs, hatchbacks, vans, pickups (M10d1, 10 archetypes).

- **Gap.** Today's cars are box cars (the owner's screenshot). No verified CC0 source has realistic cars: Kenney Car Kit, Quaternius LowPoly Cars (FBX/OBJ/Blend, no glTF) and the rgsdev pack are stylized low-poly. Sketchfab CC0 car results are museum scans. Sketchfab CC-BY results are mostly real makes (trade dress, against §7's fictional-make rule) or game rips.
- **Fix.** Primary: an art lead authors the bodies in Blender on the §7 node contract (Q-39). Fallback: start from the rgsdev 'Free Low Poly Vehicles Pack' (OpenGameArt, 'Licence is CC0'; wheels already separate from bodies, colours split into materials) and remodel to realistic proportions. Also needed: KHR_materials_clearcoat car paint, a CC0 HDRI environment for reflections, and Poly Haven/ambientCG metal and rubber PBR maps. Do not ship the raw low-poly meshes as the final look. Sketchfab CC-BY only as a vetted single model with a clear author, a generic design, no game origin, and attribution in credits.json.
- **Impact.** Cars are the most visible object in the target shot; without reflective realistic bodies the owner's 'doesn't look how we need' stays true.
- **Cost.** $0 licence. Art-lead time for 10 bodies × 3 LODs (Q-24), or about 1 Builder session for recipe and remodel work.
- **Needs owner.** Yes.

### Taxi, police and tow truck

Area: Taxi, police cruiser and SUV, tow truck (M10d1; the mission in the owner's screenshot uses a tow truck).

- **Gap.** No CC0 source with realistic models. Real police and taxi liveries and real makes are excluded by §7. Sketchfab CC-BY tow trucks found include 'Construction Sim 2' and 'Burnout 1' rips.
- **Fix.** Authored, or derived from the rgsdev CC0 bases (4 police cars including an SUV, a taxi, a truck), with original fictional liveries and a tow boom built as separate nodes. Reject every Sketchfab model whose title or description names a game.
- **Impact.** The mission vehicle and the pursuit units become believable; removes the yellow-box tow boom.
- **Cost.** $0 licence; authoring time.
- **Needs owner.** Yes.

### Bus, streetcar and cable car

Area: Bus, Muni-style streetcar, cable car.

- **Gap.** No CC0 realistic transit models. Sketchfab CC-BY cable-car results include 'Poppy Playtime' rips. Real Muni liveries and marks are excluded.
- **Fix.** Authored, or a deterministic recipe: bus and streetcar are simple extrusions with a window band. Base on the Quaternius 'LowPoly Public Transport' (CC0, bus/taxi/ambulance) or the rgsdev bus as a starting shape only. Original operator names and liveries, and an ip:strings pass.
- **Impact.** SF identity (cable cars, streetcars) without IP risk.
- **Cost.** $0 licence; about 0.3 session for a recipe.
- **Needs owner.** No.

### Player and hero cars

Area: Player and hero cars (M10d3, 14 bodies).

- **Gap.** Same as traffic, at a higher budget and with cockpit and anchor nodes. No CC0 realistic source.
- **Fix.** Art lead authors them (Q-39), or a paid kit after owner and counsel review. The Fab EULA (fab.com/eula) returned 403 today. TurboSquid and CGTrader terms on files a browser can extract are unverified. Since a GLB can be extracted from a web build, any 'no standalone redistribution' clause needs legal review first. Recipe fallback otherwise.
- **Impact.** Hero-car quality decides how the game feels close up.
- **Cost.** $0 (authored) or a marketplace price per model (not researched; no price is invented here).
- **Needs owner.** Yes.

### Pedestrian bodies

Area: Pedestrian bodies (8 bodies × 20 outfits on bay_rig_v1, 22 HUMANOID_BONES).

- **Gap.** Peds are mannequins. Mixamo characters cannot ship: the FAQ copy (community.adobe.com, 2022) says 'the only thing you can't do is distribute the raw character and animation files', and a web build serves raw GLBs. The Adobe helpx FAQ returned 403 today.
- **Fix.** MakeHuman exports: FAQ says 'The exported models end up being licensed CC0'; LICENSE.md says code is AGPL and bundled assets are 'released under CC0 1.0 Universal'. Treat MakeHuman like Blender: a separate desktop program that ships nothing of its own (DL-614/629); record a BD row. Export with the game-engine skeleton, map it to the 22 bones in the S05 alias table, and decimate to the ped budgets. Check each community clothing asset's own licence; use CC0 ones only. Alternative: Quaternius Universal Base Characters (CC0, glTF, 'Humanoid Rig compatible with retargeting in any engine', 'Average 13k triangle count', 6 bodies), which are less realistic. The MakeHuman skeleton bone count is unverified.
- **Impact.** Realistic adult crowd with no real likeness.
- **Cost.** $0 licence; about 0.5 session for import and retarget.
- **Needs owner.** No.

(The plan's critique added: MakeHuman needs an ADR and the CC0 rule covers only the base mesh and official assets; compare with Quaternius first. See `look-plan.md`.)

### Ped and crowd animation clips

Area: Ped and crowd animation clips.

- **Gap.** Mixamo clips are under the same raw-file restriction. Meshy library clip licence is UNVERIFIED (research/genai-pipeline-fal.md).
- **Fix.** Quaternius Universal Animation Library: 'CC0 License', '120+ Animations', glTF, 'universal humanoid rig … ready for retargeting'. Retarget at build time to bay_rig_v1 with assets:retarget (§4). The page does not list walk or idle explicitly; it does list 8-direction movement, jog, sprint and sitting.
- **Impact.** Natural crowd motion instead of the TSL gait on mannequins.
- **Cost.** $0.
- **Needs owner.** No.

### Street trees and foliage

Area: Street trees and foliage.

- **Gap.** Cone trees (the owner's screenshot). The target has broadleaf trees and palms. Poly Haven trees are scan-grade: jacaranda_tree 312k tris, island_tree_01 3.7M, tree_small_02 4.65M, fir_tree_01 7.9M.
- **Fix.** Poly Haven CC0 trees and shrubs (jacaranda_tree, island_tree_01-03, shrub_01-04, grass_medium_01/02), baked offline to octahedral impostors plus 1-2k-tri near LODs. Or EZ-Tree (MIT; JS/Three.js; its web app exports GLB) as a code recipe with Poly Haven's 24 CC0 bark textures. EZ-Tree's bundled texture licence is unverified, so don't use its textures. Palms: authored recipe (no CC0 palm found).
- **Impact.** Biggest single change from 'gray-box' to 'city' after cars.
- **Cost.** $0; about 0.5 session for impostor baking.
- **Needs owner.** No.

### Street furniture

Area: Street furniture: lamps, hydrant, bins, benches, barriers, poles, fences, fire escapes.

- **Gap.** None visible in the owner's screenshot.
- **Fix.** Poly Haven 'hidden_alley' collection, CC0: street_lamp_01 (30.6k tris), street_lamp_02 (20.3k), fire_hydrant (86.3k), metal_trash_can (14k), modular_street_seating (25.2k), concrete_road_barrier/_02, modular_chainlink_fence, modular_electricity_poles (200k), modular_fire_escape (11.3k), trashbag, planter_box_01-03, covered_car, WetFloorSign. Decimate with gltf-transform simplify plus KTX2 (F-017). The hydrant needs heavy decimation. Fire escapes fit SF facades.
- **Impact.** Fills sidewalks and gives scale cues the target image has.
- **Cost.** $0; part of an M10d1 import session.
- **Needs owner.** No.

### Traffic signals and road signs

Area: Traffic signals and road signs.

- **Gap.** No CC0 US signal or sign models found on Poly Haven, and Sketchfab CC0 has none game-ready.
- **Fix.** Code recipes for signal heads and mast arms (the M02d1 kit route). Sign faces drawn from MUTCD designs: secondary sources (Wikimedia Commons citing MUTCD p. I-1) call them public domain, with the Interstate Shield excepted. Confirm on mutcd.fhwa.dot.gov before use; record in spec/03. Road markings stay procedural in TSL.
- **Impact.** US-street read: signals, stop signs, painted lanes.
- **Cost.** $0; about 0.3 session.
- **Needs owner.** No.

### Facade atlas and building PBR

Area: Facade atlas and building PBR (M10d2; M02e facade node).

- **Gap.** Facades are flat colour with emissive squares.
- **Fix.** ambientCG CC0 'Facade' materials (API: 27 results, e.g. Facade001, Facade005, Facade006, Facade009, Facade017, Facade018A, Facade019A) plus Poly Haven CC0 (concrete_tile_facade, rectangular_facade_tiles/_02, 91 brick, 39 plaster incl. white_stucco, weathered_plank_siding for Victorians, 23 roofing). Pack them into texture/facade-atlas KTX2. Run the vision pass for signage and logos.
- **Impact.** Buildings read as real SF stucco, brick and glass.
- **Cost.** $0.
- **Needs owner.** No.

### Ground

Area: Ground: asphalt, sidewalk, concrete, brick.

- **Gap.** Untextured grey ground with visible seams.
- **Fix.** ambientCG CC0 (78 Asphalt/Road incl. Road007, Road012A; 66 Concrete; 146 Bricks; TactilePaving001-003 for curb ramps) and Poly Haven CC0 (asphalt_01-07, road_damaged, concrete_pavement/_02/_03, brick_pavement, cobblestone_embedded_asphalt for the cable-car tracks). Detail-tile them in the M02e ground node.
- **Impact.** Worn asphalt and sidewalks like the target.
- **Cost.** $0.
- **Needs owner.** No.

### HDRI skies and environment reflections

Area: HDRI skies and environment reflections.

- **Gap.** Flat foggy sky. Cars and glass need an environment map to look real.
- **Fix.** Poly Haven CC0 HDRIs (997 total; 499 'urban', 59 'pure skies', 61 'night', 225 'sunrise-sunset'). Keep M02e's SkyMesh for the time-of-day sky, and use 2k HDR or KTX2 HDRIs as the PMREM environment on desktop tiers only. ambientCG HDRIs are an alternative. Mobile stays procedural.
- **Impact.** Reflections on paint and glass: the main realism cue in the target image.
- **Cost.** $0; check the download size against the tier budgets.
- **Needs owner.** No.

### Moon and night sky

Area: Moon and night sky.

- **Gap.** Not asked for, but useful for the night look.
- **Fix.** NASA SVS CGI Moon Kit (svs.gsfc.nasa.gov/4720; lroc_color_2k.jpg 2048x1024). NASA content 'generally [is] not subject to copyright in the United States'; credit 'NASA's Scientific Visualization Studio'; no NASA insignia.
- **Impact.** Small polish for the night shots.
- **Cost.** $0.
- **Needs owner.** No.

### Low-poly CC0 catalogues

Area: Low-poly CC0 catalogues: Kenney, Quaternius cars.

- **Gap.** CC0 confirmed (Kenney: 'public domain licensed (CC0)', logo reserved; Quaternius: 'All models are under the CC0 License') but stylized. They don't match the target, and stylized peds or cars would conflict with 'everything except Coast realistic' (DL-OWN-05).
- **Fix.** Use only as blockout or far-LOD shapes, or as bases for remodelling. Do not use as final art.
- **Impact.** Avoids a second 'toy' look.
- **Cost.** $0.
- **Needs owner.** No.

### Khronos glTF Sample Assets

Area: Khronos glTF Sample Assets.

- **Gap.** Per-model licences (e.g. CarConcept CC-BY-4.0 © Darmstadt Graphics Group; Khronos logos are trademarks). No city content.
- **Fix.** Use only as unit or e2e fixtures to prove KHR_materials_clearcoat and emissive strength work through gltf-transform and WebGPU/WebGL2. Never ship.
- **Impact.** Confirms the car-paint path works before any real cars arrive.
- **Cost.** $0.
- **Needs owner.** No.

### Generated 3D via fal

Area: Generated 3D for cars and props via fal (owner option only; DL-OWN-01 forbids it for final art today).

- **Gap.** The cap is $100 total ($42 characters, $8 buffer). §11 says generated vehicle bodies and props are 'not funded'. AI output is one fused mesh, so wheels must be separated by hand.
- **Fix.** Prices from research/genai-pipeline-fal.md and §11 (2026-10-18 list prices):
  - Car via the §7 route (2 Sunburst concepts at $0.04116 + 2 Meshy 7.1 meshes at $1.20): $2.48.
  - Car via Hunyuan 3D 3.1 Pro (front plus side views): $0.375 + $0.15 PBR + $0.15 multi-view = $0.675, plus about $0.08 for concepts ≈ $0.76. Its 40k-face minimum needs decimation.
  - Prop via Trellis-2 at 1024: $0.30, plus a concept at $0.04116 ≈ $0.34.
  - Tripo H3.1 multiview standard: $0.30.

  The $8 buffer funds at most three bodies under §11. A realistic set of about 30 traffic, police and transit bodies costs about $23 (Hunyuan) to $74 (Meshy), which needs an owner cap change. Licence: the Tencent licence on HunyuanVideo excludes the EU, UK and South Korea. Whether Hunyuan-3D carries the same exclusion is unverified, and the fal 'commercial' flag ignores territory (research/gap-video-model-licence-clearance.md). AI-only output is likely uncopyrightable (§8). Recommend no generated final art. If the owner relaxes DL-OWN-01, limit it to prop bodies with human retopology.
- **Impact.** Could lift car and prop realism fast, but it spends the cap and needs Blender cleanup.
- **Cost.** $0.34–$2.48 per asset at list price. No spend made.
- **Needs owner.** Yes.

(Superseded by DL-OWN-06 and DL-OWN-07: the plan re-priced bodies from the §11 Tripo route and withdrew the cap-breaking claim; see `look-plan.md`.)

### Licence gate setup

Area: Licence gate setup (all art milestones).

- **Gap.** The admission rules exist (§7: licence snapshot with SHA-256, per-file provenance, credits.json lines, vision and ip:strings pass), but config/license-allowlist.json, credits.json and docs/legal/licenses/ are absent from this checkout. U-AST-10 is still open.
- **Fix.** M10d1 (or an earlier slice) creates the allowlist (CC0-1.0, CC-BY-4.0; never BY-NC, BY-ND, BY-SA or Editorial) and snapshots docs/legal/licenses/{polyhaven,ambientcg,makehuman,quaternius,rgsdev-vehicles}.md from the URLs quoted here. That closes U-AST-10 per pack. Poly Haven API calls need a unique User-Agent ('All requests to the API require a unique User-Agent header').
- **Impact.** Without this no third-party file can ship.
- **Cost.** About 0.2 session.
- **Needs owner.** No.

## Working files

The study kept three Poly Haven API listings (models, HDRIs, textures) in a scratch folder; they were not committed and were lost with the scratch folder. The counts above are as recorded on 2026-10-26.
