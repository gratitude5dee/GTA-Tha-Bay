# Look study 2026-10-26: render audit

The render-code audit of the 2026-10-26 look study (workflow `wf_34c68ace-179`, label `study:render-audit`): the agent's recorded result, formatted into sections with the wording kept. File names of the owner's images are replaced by words ("the owner's screenshot" for the staging frame the owner sent, "the target image" for the owner's fidelity reference); those images are never committed.

Milestones cite it as "render audit item N" (also "area N" or "study item N"); item N is the section "Item N" below, and a lettered part such as "item 6(b)" is the lettered step in that item's fix.

The audit read the code on origin/claude/build at d2fb0e67. Code locations are as of that commit.

## Summary

I read the three images and the render code on origin/claude/build at d2fb0e67. The current branch, claude/architect-spec, holds only the spec; I extracted a read-only copy of the code to a scratch folder. I changed no code.

Why the owner's staging screenshot looks the way it does:

1. The first story mission locks the clock at 06:00 in Karl fog (content/missions/m.a1.01/mission.ts:34). Under karl-fog, look.json keyframeWeight is 1.0, so on the desktop tiers the M02e physical sky and its environment map are fully replaced by the flat dome, and the sun runs at about 0.18 strength. The owner saw the worst lighting state we have.
2. Roads are flat, single-colour ribbons with no texture coordinates (mesher.ts addRibbon). They have no lane lines, no crosswalks and no fill at junctions, so overlapping ribbons z-fight there.
3. Sidewalks, plazas and lots all come from the 4 m ground-class grid. That is why one grey slab-joint plain covers most of the ground in the shot.
4. Every tree is one 20-triangle cone (chunk-renderer.ts treeGeometry). The species byte is ignored.
5. Cars are three boxes: traffic/instances.ts carGeometry and engine client/vehicle/vehicle-view.ts.
6. Only buildings cast shadows. Cars, trees and pedestrians cast none, and the `blob` shadow mode is not built ("no dynamic actor needs a blob yet").
7. Tone mapping is NeutralToneMapping with no colour grade.
8. Mobile and XR get no reflections: there is no environment map on WebKit, and XR uses the legacy materials.

The target image is a sunny midday street with blue sky. What makes it read as real: road markings, curbs and sidewalks, broadleaf and palm trees, cars with contact shadows and glossy paint, warm filmic grading and haze in the distance.

All 14 upgrades below are code-only: TSL nodes, mesher geometry and procedural meshes, with no new art files. None needs a change to C01–C17:

- C08 already carries `lanes`, `laneWidthM`, `medianM`, `parkingSides`, the OneWay, Divided and BusLane flags, `PedEdgeKind` Sidewalk and Crosswalk with `widthM`, `Junction.stopApproaches`, the tree species byte and an empty `RenderChunk.furniture`.
- C13 already has `blob`. Grading goes inside the existing `tonemap` slot instead of adding a new post node.
- MeshBuffers, the surface ids and look.json are internal S02 types, not numbered contracts.

(The plan later noted that re-purposing the C08 species byte and filling `RenderChunk.furniture` from the bake need the Architect's confirmation; see `look-plan.md`.)

Every API I name exists in the installed three@0.186.1: AgXToneMapping, PCFSoftShadowMap, VSMShadowMap, MeshPhysicalNodeMaterial, Data3DTexture, TSL `bumpMap`, and the addons Lut3DNode, SSSNode (screen-space shadows), SSRNode and TRAANode.

All millisecond figures are my estimates, not measurements. `check:perf` only measures CPU-side budgets, so GPU cost still needs a device pass on iPhone 15 and Quest 3 (M11a1/M14b3).

The plan has no owner for most of this work. It sits between M02e (merged) and M10d1/M10d3/M10d2, which only swap in assets: the M10d2 facade atlas, procedural cars and pedestrians in M10d1/M10d3, and the takram sky on desktop-ultra. I suggest the Architect add a "look pass 2" milestone for items 1–6, 8–10 and 12–13. Items 7, 11 and 14 should be pulled forward from the M10d1/M10d3 code-recipe fallback, which is the Q-39 default.

The best return per frame-time cost is items 0 to 5. Together they cost about 1 ms on desktop, about 0.5 ms on mobile-low and about 0.4 ms on Quest.

## Items

| Item | Area | Needs owner |
|---|---|---|
| [0](#item-0-lighting-state-at-story-start) | Lighting state at story start (content and config, no engine code) | yes |
| [1](#item-1-road-markings-crosswalks-stop-bars-and-junction-fill) | Road markings, crosswalks, stop bars and junction fill | no |
| [2](#item-2-filmic-tone-mapping-and-colour-grading) | Filmic tone mapping and colour grading | no |
| [3](#item-3-aerial-perspective-sun-coloured-haze-and-better-height-fog) | Aerial perspective, sun-coloured haze and better height fog | no |
| [4](#item-4-sidewalks-curbs-and-verges-as-geometry-drop-the-4-m-paved-grid) | Sidewalks, curbs and verges as geometry; drop the 4 m paved grid | no |
| [5](#item-5-grounding-shadows-blob-and-contact-shadows-dynamic-casters-softer-cascades) | Grounding shadows: blob and contact shadows, dynamic casters, softer cascades | no |
| [6](#item-6-procedural-tree-species-and-impostors) | Procedural tree species and impostors | no |
| [7](#item-7-procedural-car-bodies-with-clearcoat-paint-and-glass) | Procedural car bodies with clearcoat paint and glass | yes |
| [8](#item-8-facades-interior-mapping-recessed-windows-storefronts-roof-clutter) | Facades: interior mapping, recessed windows, storefronts, roof clutter | no |
| [9](#item-9-analytic-sky-reflection-where-there-is-no-environment-map) | Analytic sky reflection where there is no environment map | no |
| [10](#item-10-ground-detail-bump-normals-macro-variation-puddles) | Ground detail: bump normals, macro variation, puddles | no |
| [11](#item-11-procedural-street-furniture) | Procedural street furniture | no |
| [12](#item-12-temporal-aa-and-shimmer-control) | Temporal AA and shimmer control | no |
| [13](#item-13-a-cheap-xr-look-profile-instead-of-legacy) | A cheap XR look profile instead of legacy | no |
| [14](#item-14-procedural-pedestrian-bodies-lower-priority) | Procedural pedestrian bodies (lower priority) | yes |

## Item 0. Lighting state at story start

Area: 0. Lighting state at story start (content and config, no engine code).

**Gap.** The first story mission, m.a1.01, locks the clock at 06:00 in karl-fog. Because look.json keyframeWeight is 1.0 for karl-fog and overcast, the physical SkyMesh and its environment map are completely hidden behind the flat dome in those presets. The sun is cut to about 0.18 strength, so glass loses its reflections and the whole frame turns grey-pink. The owner judged the look in this state.

**Fix.**
- (a) Start the opening mission in clear daylight, for example the 'burn-off' shortcut at 11:00, or at least start the fog burning off.
- (b) In config/world/look.json, lower sky.keyframeWeight to about 0.35 for karl-fog and 0.6 for overcast, so the physical sky and environment map stay partly visible and the fog reads as a height fog instead of a painted dome.
- (c) In config/clock.json, consider dropping the karl-fog hourBias multiplier for 4–10 h from 3 to 2.

Files: content/missions/m.a1.01/mission.ts:34, config/world/look.json (sky), config/clock.json (hourBias). Contracts: none.

**Impact.** Very high. This decides what every first session sees: daylight, blue sky, sun shadows and reflective glass, which are the core of the target image.

**Cost.** 0 ms on every tier, since these are data edits. On desktop the environment-map re-bake may run slightly more often while blending out of fog; that is already bounded by the 200 ms probe rule. No effect on mobile-low or Quest, which have no physical sky.

**Needs owner.** Yes.

## Item 1. Road markings, crosswalks, stop bars and junction fill

Area: 1. Road markings, crosswalks, stop bars and junction fill.

**Gap.** Roads are one flat ribbon per segment, lifted 0.12 m, with only a per-class surface id. There are no road-space coordinates, so markings cannot be drawn. Junctions are overlapping ribbons that z-fight. Crosswalk ped edges and junction stop approaches are in the bake but never drawn.

**Fix.** Mesher, in packages/world/src/client/chunks/mesher.ts:
- (a) give addRibbon a per-vertex `road` attribute (Int16x4: metres along the segment, metres across from the centreline, a lane code, a flag byte), packed from the RoadEdge values that already exist (lanes, laneWidthM, medianM, parkingSides, and the OneWay, Divided and BusLane flags).
- (b) Add a junction patch, a convex polygon over the clipped ribbon ends, as its own surface with no markings.
- (c) Add crosswalk quads from PedEdge kind Crosswalk at its widthM.
- (d) Add stop-bar quads on Junction.stopApproaches.

Shading, in look/ground.ts and look/surfaces.ts (new ids: Junction 35, Crosswalk 36, StopBar 37): draw dashed white lane lines, a solid double yellow centre line on two-way roads, white edge lines, parking T marks, a bus-lane tint, zebra bars and worn paint (noise), all antialiased with the existing pixelFootprint and edgeLineAA helpers. Also: the attribute upload in chunk-renderer.ts and mesh-types.ts, and the same ids in the legacy material (chunks/materials.ts) so XR gets them. Contracts: none (C08 is read-only, and MeshBuffers and the surface ids are internal).

**Impact.** Very high. Yellow and white lines and crosswalks are the strongest single cue in the target image that this is a real modern street, and they cover a large share of the ground pixels in a driving view.

**Cost.** Desktop: about 15–25 extra ALU per road fragment, about 0.1–0.2 ms at 2.5 MP. Mobile-low: draw the markings in the 'min' profile too (step functions only, no noise), about 0.1–0.2 ms at 0.8 MP; road triangles +5–10 %; +8 bytes per road vertex against the 2 MiB upload cap. Quest: about 0.1 ms per eye at 4x MSAA; keep the markings to hard steps.

**Needs owner.** No.

## Item 2. Filmic tone mapping and colour grading

Area: 2. Filmic tone mapping and colour grading.

**Gap.** renderer-host.ts sets NeutralToneMapping, and there is no grade at all. Midtones are flat and highlights grey; there is no warm sun / cool shade split and no contrast curve. The target image is warm with clear contrast.

**Fix.**
- (a) In packages/engine/src/platform/renderer-host.ts, switch to AgXToneMapping (or ACESFilmicToneMapping) with an AgX 'punchy'-style contrast and saturation curve.
- (b) In post/nodes.ts, make createTonemap return grade(renderOutput(color)), so the grade lives inside the existing `tonemap` node: lift/gamma/gain, saturation, a shadow/highlight split tone, and optionally Lut3DNode on a 32³ Data3DTexture built in code from look.json parameters, one per weather preset and blended with the sky blend.
- (c) Mobile-low runs 'direct' with no pipeline, and XR has no post stack. For those tiers, apply the same grade per fragment through the existing scene fog node (sky/fog.ts createWorldFog output) and the backdrop fog, so no pass is added.
- (d) Add `grade` per preset to config/world/look.json and its schema.

Contracts: none (no new C13 PostNode).

**Impact.** High. It moves the whole frame from grey towards filmic, as in the target, at almost no cost.

**Cost.** Desktop and mobile: about 0.05–0.15 ms (the LUT lookup sits in an existing pass). Mobile-low and Quest: about 5–10 ALU per fragment through the fog node, about 0.05 ms, with no added pass or render target.

**Needs owner.** No.

(The plan kept Neutral, rejected AgX and dropped the 3D LUT; see `look-plan.md`.)

## Item 3. Aerial perspective, sun-coloured haze and better height fog

Area: 3. Aerial perspective, sun-coloured haze and better height fog.

**Gap.** sky/fog.ts uses a single uFogColor with linear distance and an exponential height falloff. The haze does not brighten towards the sun or turn bluer with distance, so the far city is just greyed out instead of reading as atmospheric depth.

**Fix.** In createWorldFog and createBackdropFog:
- (a) mix uFogColor towards the sun colour with a Henyey-Greenstein-like lobe pow(max(dot(viewDir, sunDir), 0), 6–12) for in-scattering;
- (b) tint distant geometry towards uSkyBottom (Rayleigh blue) on clear days, using exponential instead of linear extinction;
- (c) keep the Karl bank weighting.

On the full profile, take the fog colour from the physical sky's horizon colour so the two match. Files: packages/world/src/client/sky/fog.ts, sky/nodes.ts (add uSunDir and uSunColor if missing), look/look-view.ts. Contracts: none.

**Impact.** High. It gives the depth and warm backlit haze of the target image and hides the coarse L1/L2 massing and the chunk edge.

**Cost.** About 5–10 ALU per fragment on every tier, which is negligible (under 0.05 ms). It is safe on mobile-low and Quest because it is part of the existing fog node.

**Needs owner.** No.

## Item 4. Sidewalks, curbs and verges as geometry; drop the 4 m paved grid

Area: 4. Sidewalks, curbs and verges as geometry; drop the 4 m paved grid.

**Gap.** Sidewalks and plazas are the 4 m ground-class grid, with vertex colours pulled to class albedo and a 1.5 m slab grid. In the SF bake most cells are Paved or Sidewalk, so one grey tiled plain covers everything, with blocky, stair-stepped class edges. Nothing separates road from sidewalk: no curb and no gutter.

**Fix.** In mesher.ts, emit a sidewalk ribbon on each side of each road ribbon (from PedEdge kind Sidewalk widthM, or the edge's parkingSides plus a class default). Each ribbon gets a 0.15 m curb face, a 0.3 m concrete curb top, a gutter strip with a darker wet-looking line, and a 1 m tree-pit or verge strip where trees exist. Driveway cuts are optional. In look/ground.ts, shade Paved cells that no ribbon covers as lots and plazas (brick or stone pattern, oil stains), not as sidewalk slabs. Use the 'low' profile on mobile-low: a flat strip with a painted curb edge and no curb faces. Files: chunks/mesher.ts, look/ground.ts, look/surfaces.ts (Curb 38, Gutter 39), and chunks/lod-mesher.ts (keep L1 flat). Contracts: none. Collision is still the C08 heightfield, so the visual curb is 15 cm above the physics surface; keep curbs at 0.10–0.12 m or lift pedestrian render poses on sidewalk edges, and say this in the BD row.

**Impact.** High. It turns 'grey plain with boxes' into city blocks; curbs and sidewalks frame every street in the target image.

**Cost.** About +8–20k triangles per L0 chunk (inside the roads object, so 0 extra draws). Mobile-low: flat strips only, about +3k triangles per chunk against the 600k budget. Quest: the same flat strips. Almost no extra fragment cost.

**Needs owner.** No.

## Item 5. Grounding shadows: blob and contact shadows, dynamic casters, softer cascades

Area: 5. Grounding shadows: blob and contact shadows, dynamic casters, softer cascades.

**Gap.** Only L0 buildings cast shadows (shadows.ts). Cars, trees and pedestrians float, which is very visible in the owner's screenshot. The C13 'blob' mode on mobile-low and Quest draws nothing. Shadows use PCFShadowMap, which gives hard, aliased edges at a low sun.

**Fix.**
- (a) Implement blob shadows on every tier: one instanced ground quad per car and pedestrian, with a radial-falloff TSL alpha and multiply blending, sized from the archetype half-extents and fed from the traffic and pedestrian pose loops. That is one draw for all of them.
- (b) On csm3 and csm1, let the player car, the nearest N traffic cars and the trees within 60–80 m cast.
- (c) Use PCFSoftShadowMap (or VSM) in renderer-host.ts.
- (d) On desktop-ultra, add SSSNode screen-space contact shadows inside the existing gtao step of post/stack.ts, with no new PostNode.

Files: look/shadows.ts, traffic/instances.ts, peds/instances.ts, chunks/chunk-renderer.ts (caster flags), engine renderer-host.ts, post/stack.ts. Contracts: none ('blob' is already a C13 ShadowMode).

**Impact.** High. Contact shadows under cars are a big part of why the target reads as photographic; this is the cheapest way to fix the floating look.

**Cost.** Blobs: 1 render object and about 0.1 ms on every tier, including mobile-low and Quest (count the extra object against the budget of 100 and 150). Dynamic casters: +1 draw per cascade for each caster mesh on desktop, about +0.3–0.6 ms. PCFSoft: about +0.2 ms on desktop. SSS on desktop-ultra: about 0.5 ms. Mobile csm1: allow the player car only.

**Needs owner.** No.

## Item 6. Procedural tree species and impostors

Area: 6. Procedural tree species and impostors.

**Gap.** Every tree is one 20-triangle cone with a trunk, whatever its species. The species byte is fnv32(DataSF species name) % 8 (tools/map s3-water.ts treeRecord), so it does not encode tree form. SF street trees are broadleaf (plane, ficus, brisbane box), palms and cypress or pine, not cones.

**Fix.**
- (a) In chunks/chunk-renderer.ts (or a new chunks/trees.ts), generate 4–5 tree forms in code: broadleaf with a clustered noisy crown (about 250 triangles), Canary or Mexican fan palm (a tapered trunk with radial frond cards and a TSL alpha mask, about 150 triangles), Monterey cypress or pine, and a small ornamental. Add a vertex wind-sway node, a backlit translucency tint and per-instance hue.
- (b) Beyond about 120 m (desktop) or 60 m (mobile), draw a two-crossed-quad impostor, or an octahedral impostor atlas rendered once at boot.
- (c) Keep one global InstancedMesh per form across all chunks, rebuilt on chunk add and remove, instead of one per chunk, to stay under maxRenderObjectsPerChunk 6.
- (d) Change the bake (tools/map/src/stages/s3-water.ts treeRecord) so the species byte is a form class (a palm, broadleaf or conifer table keyed on the DataSF species name). The u8 field stays the same, so C08 is unchanged, but it needs an sf re-bake and a staging publish.

Contracts: none.

**Impact.** High. Palms and broadleaf trees are a dominant element of the target image, and the cones are the most obviously placeholder object in the owner's screenshot.

**Cost.** Desktop: 4–5 objects in total, about +0.3–0.6 ms (alpha-tested fronds reduce early-z rejection). Mobile: solid low-poly crowns, no alpha cards, about 0.2 ms. Mobile-low and Quest: solid crowns of 40–60 triangles, impostors beyond 40 m, no alpha test (alpha test is costly on tile GPUs and with MSAA on Quest); about 0.2 ms.

**Needs owner.** No.

(The plan replaced (c) with per-chunk instance ranges or CPU distance culling; see `look-plan.md`.)

## Item 7. Procedural car bodies with clearcoat paint and glass

Area: 7. Procedural car bodies with clearcoat paint and glass.

**Gap.** Traffic cars are one InstancedMesh of three boxes (traffic/instances.ts carGeometry). The player vehicle view is boxes, cylinders and cones (engine client/vehicle/vehicle-view.ts). The material is plain MeshStandard at roughness 0.6, with no glass, chrome or tyre separation, so the owner's screenshot shows coloured blocks.

**Fix.** Pull forward the M10d1 code-recipe fallback (tools/assets/src/recipes/vehicle.ts, the M02d1 kit route). Loft each body from 3–4 cross-section profiles (hood, A-pillar, roof, trunk), with bevelled edges, wheel arches, a separate glass group, a tyre-and-rim wheel, and light geometry on the C07 node names. Keep the traffic renderer at one InstancedMesh: either a few body families (sedan, SUV or van, truck) scaled per archetype, or a merged 'universal' body with per-instance blend, because one mesh per archetype would add about 10 objects. Materials: car paint as MeshPhysicalNodeMaterial with clearcoat 1, a hue-based flake noise and a Fresnel term (MeshStandard with roughness 0.3 on mobile); glass dark with environment reflection, or the analytic sky reflection from item 9 where there is no environment map. Files: tools/assets/src/recipes/vehicle.ts, packages/world/src/client/traffic/{instances.ts, archetype-mesh.ts}, packages/engine/src/client/vehicle/vehicle-view.ts. Contracts: none (C07 vehicle node contract and C06 prefab refs as planned).

**Impact.** High. Cars sit in the middle of every driving shot, and the target is mostly cars and road. It is real but secondary to items 1–6, because traffic is a small share of pixels.

**Cost.** Desktop: traffic triangles go from about 50 to 1.5–5k per car (12k at the hi variant), at 540 instances still within the 4M budget; clearcoat adds about +0.2 ms. Mobile-low: the 'lo' variant at 1.5k triangles × 120 is 180k of the 600k budget, which is tight with buildings; use a 500–800 triangle body there and no clearcoat. Quest: lo variant, 120 cars, MeshStandard only.

**Needs owner.** Yes.

## Item 8. Facades: interior mapping, recessed windows, storefronts, roof clutter

Area: 8. Facades: interior mapping, recessed windows, storefronts, roof clutter.

**Gap.** look/facade.ts draws a flat window grid with frames, trim and weathering, but glass is a dark flat colour (or environment-mapped on full). There is no depth, no visible rooms, ground floors are plain bands without awnings or sign panels, and there is no rooftop clutter except on commercial towers. Close up, buildings still read as boxes with a printed pattern.

**Fix.**
- (a) Full profile: interior mapping per window cell. Ray-intersect a virtual room box from positionViewDirection, using the existing u, v and bay or floor indices; hash the back wall, floor, ceiling and furniture tones; lit rooms at night replace the current flat emissive.
- (b) Lite profile: single-plane parallax offset of a dark room colour.
- (c) A recessed-window normal using TSL bumpMap on the analytic recess height, so the sun casts shading into the reveals.
- (d) Storefront bands on SHOP classes: an awning colour strip with a slope normal, an emissive sign panel at night (no text), and a kick plate.
- (e) Cornice and belt-course normals.
- (f) In mesher.ts addBuilding, add rooftop clutter from the seed: water tanks, HVAC boxes, stair bulkheads (8–24 triangles each, ResMid, Commercial and Industrial, desktop and mobile profiles).

Files: packages/world/src/client/look/facade.ts, look/look-materials.ts, chunks/mesher.ts. Contracts: none (the facade attribute already carries u, v, top and seed). This is compatible with the M10d2 atlas hook (FacadeAtlasHook).

**Impact.** Medium–high. Buildings fill half of the owner's screenshot, and interior mapping is the main trick open-world games use to make glass read as real.

**Cost.** Desktop: about +40–60 ALU on glass fragments, about +0.4–0.9 ms at 2.5 MP, so gate it behind the existing farK fade so only near walls pay. Mobile (lite): parallax only, about +0.2 ms. Mobile-low (min): none, keep the vertex colour and the night mask. Quest: none. Roof clutter adds about +2–4k triangles per chunk on desktop.

**Needs owner.** No.

(The plan deferred interior mapping and rooftop clutter; see `look-plan.md`.)

## Item 9. Analytic sky reflection where there is no environment map

Area: 9. Analytic sky reflection where there is no environment map.

**Gap.** Only the full profile gets an environment map, and never on WebKit (bug 303203). On lite, glass gets a Fresnel tint towards uSkyBottom. On min, legacy and XR, glass, water and wet asphalt reflect nothing, so iPhone and Quest look matte and grey.

**Fix.** Add a shared TSL helper: skyReflect(R) = mix(uSkyBottom, uSkyTop, smoothstep(-0.05, 0.6, R.y)) + sunColor × pow(max(dot(R, sunDir), 0), shininess) × Fresnel. Use it as the specular or emissive term for glass (facade.ts lite and min), water (look/water.ts), wet road puddles (look/ground.ts), car glass and paint on the mobile tiers, and the legacy and XR chunk material. Files: packages/world/src/client/look/common.ts (helper), facade.ts, water.ts, ground.ts, chunks/materials.ts, traffic/instances.ts. Contracts: none.

**Impact.** Medium–high on mobile and Quest. Glass towers and wet streets start catching the sky, the cheapest route to a 'realistic' read without any probe render.

**Cost.** About 10–15 ALU on the fragments that use it, no textures and no render-target bakes, so it is WebKit-safe. Mobile-low about 0.05–0.1 ms, Quest about 0.1 ms.

**Needs owner.** No.

## Item 10. Ground detail: bump normals, macro variation, puddles

Area: 10. Ground detail: bump normals, macro variation, puddles.

**Gap.** Ground and asphalt change colour only; normals stay flat, so the sun gives no grazing-light texture. Repetition and the 4 m class grid show over large areas. Puddles only darken the colour and lower roughness, with nothing to reflect except on the full profile.

**Fix.**
- (a) In look/ground.ts, feed the existing aggregate, slab and crack noise heights into TSL bumpMap, giving detail normals on asphalt, concrete, rock and grass (no textures).
- (b) Add a world-space macro fbm at 50–200 m for tone and wear, so the class grid stops reading.
- (c) Add tyre-track darkening along lane centres using the `road` attribute from item 1.
- (d) On desktop-ultra, add SSRNode limited to wet, low-roughness pixels while it rains, inside the existing pipeline.

Files: look/ground.ts, look/noise.ts, engine post/stack.ts (desktop-ultra SSR only). Contracts: none (desktop-ultra SSR runs inside the existing pipeline, not as a new C13 PostNode).

**Impact.** Medium. Asphalt and concrete gain physical texture under a low sun, and rainy-night streets gain reflections.

**Cost.** Bump adds about 3 extra noise evaluations per fragment (finite differences): desktop about +0.2–0.3 ms, mobile (fbm2) about +0.15 ms, skipped on min and Quest. SSR on desktop-ultra about 1–1.5 ms, rain only.

**Needs owner.** No.

## Item 11. Procedural street furniture

Area: 11. Procedural street furniture.

**Gap.** RenderChunk.furniture is an existing C08 field, but the bake always writes it empty (tools/map s13-pack.ts). Apart from M02b2's lamp poles, streets have no hydrants, signal heads on poles, sign posts, parking meters, bus shelters, benches or overhead trolley wires. The target image is full of poles and signs.

**Fix.** Derive furniture at mesh time with a deterministic placement along the sidewalk ribbons from item 4: hydrants every about 90 m, meters along parking sides, signal poles and mast arms at Junction nodes with control Signal (reusing traffic/lights.ts aspect emissives), stop signs at AllWayStop and MinorStop nodes, shelters at transit nodes, and Muni trolley wires on arterials (thin lines). Build the meshes in code, one InstancedMesh per type in a global pool. Alternatively fill RenderChunk.furniture in the bake (no shape change). Files: packages/world/src/client/chunks/mesher.ts (placement), a new chunks/furniture.ts (geometry and instancing), traffic/lights.ts. Contracts: none.

**Impact.** Medium. Vertical clutter is what makes a street read as lived-in. Signals and stop signs also help gameplay readability.

**Cost.** About 4–6 render objects in total (global pools) and about 50–150 triangles per item. Desktop about 0.2 ms. Mobile-low: hydrants and signals only, about 2 objects, and keep the 100-object budget in check. Quest: signals only.

**Needs owner.** No.

## Item 12. Temporal AA and shimmer control

Area: 12. Temporal AA and shimmer control.

**Gap.** Desktop runs SMAA, and TRAA is only an optional node behind look.json postLevelCap 2, so it never runs. The procedural facade, slab and line patterns and the M02d1 landmark recipes shimmer and show moire: the M02e before/after SF image (docs/look/M02e-before-after-sf.png) has heavy aliasing on the City Hall wings. Thin road markings from item 1 will crawl without temporal AA.

**Fix.**
- (a) Raise postLevelCap to 3 in config/world/look.json once M11a1's governor can lower it, which enables the existing TRAA optionalPost on desktop. Alternatively make TRAA default on desktop through the governor's level (no C13 table change).
- (b) Give the landmark materials the same pixelFootprint fade to their average as facade.ts.
- (c) Fade marking contrast with the footprint (bandFade).

Files: config/world/look.json, packages/world/src/client/chunks/landmark-layer.ts (materials), look/ground.ts. Contracts: none (changing the C13 desktop `post` list itself would need the Architect, so it is avoided).

**Impact.** Medium. It removes the 'gamey' crawl that undermines realism in motion; it is a prerequisite for fine markings and facade detail.

**Cost.** TRAA about 0.4–0.7 ms on desktop plus the velocity MRT target; watch for ghosting on fast driving. The footprint fade is about 0. No change on mobile, mobile-low or Quest, which keep FXAA, tonemap only or MSAA.

**Needs owner.** No.

## Item 13. A cheap XR look profile instead of legacy

Area: 13. A cheap XR look profile instead of legacy.

**Gap.** look.json maps xr-quest and xr-visionpro to 'legacy', the M02b1/M02b2 vertex-colour materials. VR players get none of the M02e work, and none of items 1–4 or 9 unless they are added to the legacy material too.

**Fix.** Add an 'xr' material profile in look/look-materials.ts and config.ts: the 'min' building path (vertex colour, class roughness, night window mask), road markings and crosswalks (item 1) with hard steps, the analytic sky reflection (item 9), the fog-node grade and haze (items 2–3) and blob shadows (item 5). No noise, bump, alpha test or post. Map xr-quest to 'xr' and xr-visionpro to 'xr' (or 'lite' after device measurement). Files: packages/world/src/client/look/{config.ts, look-materials.ts}, config/world/look.json, config/schemas/world-look.schema.json (LookProfile enum), look-view.ts (XR has no post stack, so skip the stack). Contracts: none (LookProfile is an S02 domain type).

**Impact.** Medium for XR players, who currently get the oldest look of all.

**Cost.** Quest at 72 Hz, 4x MSAA, 13.9 ms: keep the total added per-fragment ALU under about 25; estimated +0.3–0.5 ms per frame. It must be measured on a Quest 3 before it becomes the default; keep 'legacy' as the fallback switch.

**Needs owner.** No.

## Item 14. Procedural pedestrian bodies (lower priority)

Area: 14. Procedural pedestrian bodies (lower priority).

**Gap.** Far pedestrians are instanced boxes and the near ones are a box-and-capsule mannequin (peds/instances.ts, peds/mannequin.ts). That matters less in the driving view of the target image, but it is obvious on foot.

**Fix.** Pull forward the M10d1 recipe fallback (tools/assets/src/recipes/ped.ts): lathed torso and tapered limbs on bay_rig_v1, outfit colour regions from the ped.ambient palettes, and a far rigid body of at most 300 triangles keeping the existing TSL gait. Files: tools/assets/src/recipes/ped.ts, packages/world/src/client/peds/{kit.ts, instances.ts, mannequin.ts}. Contracts: none (C04 bay_rig_v1 and C07 unchanged).

**Impact.** Low–medium for driving shots, medium on foot and in missions.

**Cost.** Far body at 300 triangles × 400 pedestrians on desktop is 120k triangles; × 80 on mobile-low is 24k. One draw unchanged. Near skinned mannequins are already budgeted per tier.

**Needs owner.** Yes.

## Files read

The audit read these files on `claude/build` at d2fb0e67 (paths in the repository): `packages/world/src/client/look/{look-materials.ts, facade.ts, ground.ts, shadows.ts, look-view.ts, sky-physical.ts}`, `packages/world/src/client/sky/fog.ts`, `packages/world/src/client/chunks/{mesher.ts, chunk-renderer.ts}`, `packages/world/src/client/traffic/instances.ts`, `packages/engine/src/platform/renderer-host.ts`, `packages/engine/src/platform/post/{stack.ts, nodes.ts}`, `packages/engine/src/client/vehicle/vehicle-view.ts`, `config/world/look.json`, `config/tier-budgets.json`, `config/clock.json`, `docs/look/M02e-before-after-sf.png`.
