# Look study 2026-10-26: capture study

The capture and gap analysis of the 2026-10-26 look study (workflow `wf_34c68ace-179`, label `study:capture-gap`). The text below is the capture agent's recorded result, formatted into sections; the wording is kept. File names of the owner's images are replaced by words ("the owner's screenshot", "the owner's target image"): those images are never committed. Frames: `docs/look/study/` (re-captured 2026-10-27 with the recovered scripts; see `README.md`).

Milestones cite this file as "capture study" plus a section name (for example capture study "Ground, sidewalks and curbs") or a frame name.

## Method

I captured the real sf world in two ways.

### Staging

I drove https://tha-bay-web-staging.gratitude-8f4.workers.dev in Playwright as a real player would: production build, Title, age gate, Terms, New Game, Coast defaults, then the intro and the Third Street mission start. Headless SwiftShader made the auto tier pick `mobile-low` (boot record `"tier":"mobile-low"`), so these frames show the lowest tier.

### Local QA build

In a fresh worktree reset to origin/claude/build (d2fb0e67) I made a local QA build of the sf bake.

- `.cache/map/raw/sf` was an overlay of symlinks into /home/user/sf-bake-cache, with `raw.lock.json` copied from `content/world/raw.lock.sf.json`, as BD-REL-01 did.
- `pnpm map:build -- --area sf` reproduced staging's exact bake id `bf9c29c4…`.
- I built with `DV_WORLD=sf VITE_DV_QA=1 pnpm build`, ran it under `wrangler dev`, and teleported with `__dvBridge` at 13:00 clear. Desktop tier at 1600 × 900.
- Spots: Civic Center Plaza, Market & 4th, Third Street in Bayview, Lombard / Russian Hill, the Embarcadero, Golden Gate Park. There are also 06:00 karl-fog frames (the owner's start condition) and two `mobile-low` frames at 844 × 390 (DPR 2, iPhone-style landscape; same headless browser, not a device run).

## Spots

The teleport targets of the QA run (ENU metres from City Hall; yaw 0 faces north, +π/2 faces west). The camera kept its own heading after each teleport (see "Capture limits"), so a file name claims only the place.

| Frame stem | Place | x | z | yaw (rad) | Hour, weather |
|---|---|---|---|---|---|
| `desktop-01-civic-center-plaza` | Civic Center Plaza | 160 | −20 | 1.5708 | 13:00 clear; 06:00 karl-fog |
| `desktop-02-market-4th-plaza` | Market & 4th | 1197.9 | −654.9 | −0.7854 | 13:00 clear |
| `desktop-03-third-st-bayview` | Third Street, Bayview | 2510.4 | 4994.6 | 0 | 13:00 clear; 06:00 karl-fog |
| `desktop-04-lombard-russian-hill` | Lombard / Russian Hill | 4.4 | −2525.1 | −1.5708 | 13:00 clear |
| `desktop-05-embarcadero-ferry` | The Embarcadero (Ferry Building) | 2228.5 | −1720.4 | 0 | 13:00 clear |
| `desktop-06-golden-gate-park` | Golden Gate Park | −3585 | 921.2 | 1.5708 | 13:00 clear |
| `mobile-low-01-civic-center-plaza` | Civic Center Plaza | 160 | −20 | 1.5708 | 13:00 clear |
| `mobile-low-03-third-st-bayview` | Third Street, Bayview | 2510.4 | 4994.6 | 0 | 13:00 clear |

The staging frames (`staging-prod-autotier-mobile-low-*`) follow the player flow: `00-menu`, `01-creator`, `02-intro` (the New Game intro card over the running world), `03-play-02` and `03-play-11` (about 30 s and 120 s into play), `05-turn` (after a walk and a camera turn).

## Capture limits

- `chromium-webgpu` booted the desktop tier but every desktop frame timed out on SwiftShader, so all desktop shots are `chromium-webgl2` (`?gl=1`) with the full desktop post stack. I paused rendering with `world.hold` for each capture.
- QA-only debug panels were hidden. That also hid the clock, money and heat chips and the minimap in the QA shots, so the HUD findings come from the staging frames.
- The camera ignores the teleport yaw (it stayed east-facing), so the headings are whatever the camera kept. The file names only claim the place. For example, the Civic Center frames look east toward UN Plaza; City Hall is resident 158 m behind the camera.
- I did not get a clear frame of the bay water.

/home/user/sf-bake-cache was not modified (no file in it is newer than my start marker). node_modules, dist, media-local, .wrangler and .cache were removed from the worktree, and git status is clean.

## Verdict

The gap to the target has two parts. First, almost no realism layer exists between the bake geometry and the camera:

- no road markings, curbs or street furniture;
- one cone tree for every species, and nearly empty parks;
- box cars and mannequin people;
- only buildings cast shadows;
- neutral tone mapping with no colour grade.

Second, the three art milestones as written won't close it. Under the Q-39 default with no fal they produce deterministic code recipes, which turn gray-box into nicer gray-box. Road markings, signage, vegetation and street furniture are not scheduled at all: M02e names markings as an unscheduled gap (DL-704), and no milestone fills the `furniture` render object.

The cheap, high-impact wins (no owner decision needed) are:

- the colour grade and tone map;
- shadow casters for cars, trees and people;
- the vehicle chase camera;
- SVG HUD icons;
- three render bugs:
  - roofs floating above their walls;
  - trees sunk into slopes;
  - z-fighting on grass and facades.

Reaching the target's photoreal fidelity needs three owner calls:

1. Who supplies or sources the final art (Q-39).
2. Whether to fund new milestones for roads, markings, curbs, vegetation and street furniture.
3. Whether CC0 PBR texture packs are admitted. Possibly also revisiting DL-OWN-01 for generated seamless tiles from the $8 buffer.

(Q-39 was answered later the same day by DL-OWN-06, and the program by DL-OWN-07; see `look-plan.md`.)

### HUD glyphs

**The "tofu" in the HUD is not a missing font.** `packages/ui/src/hud/widgets.tsx:69` and `packages/ui/src/hud/model.ts:40` deliberately draw the heat bars and the Clear icon with U+25AF `▯`, which looks exactly like a missing-glyph box. The clock icon `◔` (`widgets.tsx:112`) renders as a dot.

### Side finding: headless Chromium classified as Safari

**Side finding (low; affects tests, not players).** `packages/shared/src/platform/classify.ts` `isChromiumEngine` uses `/\b(?:Chrome|…)\//`, which does not match `HeadlessChrome/`. Headless Chromium is therefore classified as `safari`, so `PhysicalSky` runs with `envMap: false` (0 env bakes at every spot). Every CI golden and capture runs without image-based lighting. Real Safari is env-map-free by design (WebKit bug 303203), so on Safari, likely what the owner played, all ambient light is a flat hemisphere.

The owner's target image is a fidelity reference only. The fixes below are original recipes or licensed sources, per the original-content rule.

### Contact sheet

The contact sheet, `docs/look/study/contact-sheet.png`, shows six desktop spots, one fog frame, one mobile-low frame and one staging frame. The other frames are in the same folder. (The original run also kept run reports and console logs under `shots/logs/`; those were not committed.)

## Findings

Summary; each row has its own section below with the gap and the fix.

| Area | Impact | Cost | Needs owner |
|---|---|---|---|
| [Roads and markings](#roads-and-markings) | high | about 1-1.5 Builder sessions (new milestone: bake markings plus material) | yes |
| [Props and street furniture](#props-and-street-furniture) | high | about 1.5 sessions (new milestone; prop meshes may ride on M10d1) | yes |
| [Vegetation](#vegetation) | high | about 1.5 sessions (new milestone, or an addition to M10d2) | yes |
| [Lighting and shadows](#lighting-and-shadows) | high | about 0.5 session | no |
| [Post (tone map, AO, bloom, colour grade)](#post-tone-map-ao-bloom-colour-grade) | high | about 0.5 session (tuning plus one post node) | no |
| [Buildings and facades](#buildings-and-facades) | high | about 2 sessions (new kit milestone) on top of M10d2 (1 session) | yes |
| [Buildings: roof and depth bugs](#buildings-roof-and-depth-bugs) | med | about 0.5 session (fixes plus goldens) | no |
| [Vehicles](#vehicles) | high | 2 sessions as planned (M10d1, M10d3); authored or CC0 bodies add art lead time (Q-24) | yes |
| [Pedestrians and player](#pedestrians-and-player) | high | M10d1 (1 session) plus M10a2 as planned; skinning risk on `bay_rig_v1` | yes |
| [Ground, sidewalks and curbs](#ground-sidewalks-and-curbs) | high | about 1 session (pairs with the road-markings milestone) | yes |
| [Camera and FOV](#camera-and-fov) | high | about 0.2 session | no |
| [Sky and atmosphere](#sky-and-atmosphere) | med | about 0.2 session for the start time and haze tuning | yes |
| [HUD and UI](#hud-and-ui) | med | about 0.2 session | no |
| [Distant city](#distant-city) | med | inside M10d2 (1 session) | no |
| [Water](#water) | med | about 0.5-1 session | no |
| [Plan and sourcing (cross-cutting)](#plan-and-sourcing-cross-cutting) | high | about 4-5 extra sessions plus the 3 planned M10d sessions | yes |

### Roads and markings

| Field | Finding |
|---|---|
| Gap | Asphalt renders near-black and flat at every spot (desktop-03, -05, staging). There are no lane lines, no centre double-yellow, crosswalks, stop bars, manholes or patching. These painted lines are the strongest 'real street' cue in the target. M02e Scope out says road markings, crosswalk paint and street signage are 'not scheduled' (DL-704). The staging intro on mobile-low also shows white sparkle noise across the asphalt: procedural aggregate noise aliasing with no AA. |
| Fix | New bake step after S5-S7: emit marking quads (centre line by road class, lane dividers from lane count, crosswalks and stop bars at signalised junctions) as a decal layer in the roads mesh, with a lifted asphalt albedo (about 0.12-0.18), a tiling aggregate and crack texture, and a wet variant. Make the procedural noise derivative-aware, or switch to a mipmapped texture, to kill the mobile-low sparkle. |
| Impact | high |
| Cost | about 1-1.5 Builder sessions (new milestone: bake markings plus material) |
| Needs owner | yes |

Frames: `desktop-03-third-st-bayview-1300-clear.png`, `desktop-05-embarcadero-ferry-1300-clear.png`, `staging-prod-autotier-mobile-low-02-intro.png` (sparkle).

### Props and street furniture

| Field | Finding |
|---|---|
| Gap | Streets are empty except thin bare lamp posts. No traffic signals, signs, hydrants, parking meters, benches, bus shelters, utility poles and wires, Muni overhead wires, trash cans or newspaper boxes. The mesher's `furniture` render object is 'empty until their milestones' (packages/world/src/client/chunks/mesher.ts:4), but no milestone fills it; M10d1 only replaces the existing `prop/graybox.*` prefabs. |
| Fix | Bake a furniture scatter from the road graph (signals at signalised junctions, signs by road class, poles on a fixed spacing) plus OSM nodes (traffic_signals, street_lamp, bench, bus_stop), drawn instanced per chunk. Build the prop kit as code recipes, or admit a verified CC0 kit with a licence snapshot per §7. |
| Impact | high |
| Cost | about 1.5 sessions (new milestone; prop meshes may ride on M10d1) |
| Needs owner | yes |

### Vegetation

| Field | Finding |
|---|---|
| Gap | Every tree is one dark cone on a cylinder trunk: one silhouette for all species. Trees sit half-buried on slopes (desktop-04 Lombard). Golden Gate Park is an open lawn with a dozen tiny cones, where the real park is dense forest (desktop-06). There are no shrubs, hedges, palms or ground cover. No milestone schedules vegetation art (M10d1-M10d3 do not mention trees). |
| Fix | Make species recipes, low-poly crowns with cross-billboard impostors at distance: London plane, Monterey cypress or pine, eucalyptus, Canary palm, street ficus. Ground trees by sampling the height at the trunk base. Fill parks from OSM landuse forest and wood polygons with a seeded Poisson scatter, and add a shrub layer. |
| Impact | high |
| Cost | about 1.5 sessions (new milestone, or an addition to M10d2) |
| Needs owner | yes |

Frames: `desktop-04-lombard-russian-hill-1300-clear.png`, `desktop-06-golden-gate-park-1300-clear.png`.

### Lighting and shadows

| Field | Finding |
|---|---|
| Gap | The look report shows `casterKinds: ['l0:buildings']` at every spot. Trees, cars, pedestrians and the player cast no shadows, so they float, while the target has strong car and tree shadows. Ambient light is hemisphere-only: `envMap` is false with 0 env bakes in all captures. On Safari that is by design (WebKit bug 303203). On headless Chromium it is a misclassification, so CI goldens never exercise image-based lighting. |
| Fix | Add the vegetation, vehicles, pedestrians and player to the near shadow cascade (inside the desktop render-object budget), with a cheap blob contact shadow under cars and pedestrians on mobile. Fix `isChromiumEngine` in packages/shared/src/platform/classify.ts so it matches `HeadlessChrome/`. For Safari, ship a per-sky-key irradiance (SH or small cube) baked on the CPU or in a worker instead of the PMREM path. |
| Impact | high |
| Cost | about 0.5 session |
| Needs owner | no |

### Post (tone map, AO, bloom, colour grade)

| Field | Finding |
|---|---|
| Gap | Tone mapping is `NeutralToneMapping` at exposure 1 with no colour grade, LUT or vignette (packages/engine/src/platform/post/nodes.ts:74, look.json exposureBias 1.0 everywhere). The image reads flat and grey-blue against the target's warm, contrasty grade. Bloom leaves white halos down building edges against the sky (desktop-04, desktop-05). GTAO at half resolution is barely visible. mobile-low runs tone mapping only, with no AA, so edges are jagged and the asphalt sparkles. |
| Fix | Tune the grade as data: a filmic or AgX-style curve with per-hour and per-weather exposure and white balance from sky-keys, and a small authored original 3D LUT node before `tonemap` (the racing `lut` optional post in M07b2 can share it). Add a subtle vignette, raise the bloom threshold to stop the edge halos, and strengthen AO. Allow FXAA on mobile-low when the governor has headroom (M11a1). |
| Impact | high |
| Cost | about 0.5 session (tuning plus one post node) |
| Needs owner | no |

(The plan later rejected AgX and the 3D LUT; see `look-plan.md`.)

### Buildings and facades

| Field | Finding |
|---|---|
| Gap | Buildings are extruded boxes with one procedural window grid. Side walls are blank. There are no storefront ground floors, awnings, cornices, bay windows or Victorian and Edwardian detail, which is what makes SF read as SF. The Market & 4th curtain wall is a dark mullion box (desktop-02). M10d2's KTX2 facade atlas is desktop-only by design (its AC-7: 'not requested below desktop'), so mobile keeps the flat look. |
| Fix | Add a modular facade kit by building class, generated in the mesher as geometry and not only shader: ground-floor storefront band with signage panel and awning, cornice and parapet, bay-window bumps for ResLow and ResMid. Ship the facade atlas with a compressed mobile variant. Run the M10d2 landmark art pass at the same AssetIds. |
| Impact | high |
| Cost | about 2 sessions (new kit milestone) on top of M10d2 (1 session) |
| Needs owner | yes |

Frame: `desktop-02-market-4th-plaza-1300-clear.png`.

### Buildings: roof and depth bugs

| Field | Finding |
|---|---|
| Gap | Three render bugs. Gable and hip roofs float above their walls with a visible sky gap (desktop-04 Lombard). Grass, and the City Hall facade in docs/look/M02e-before-after-sf.png, show z-fighting and moiré stripes at grazing angles (probe frame at City Hall). A dark slab hangs in the sky in the staging intro frame (staging-prod-autotier-mobile-low-03-play-02.png). |
| Fix | Snap the roof base to the wall top in the mesher. Add depth bias (polygon offset) for coplanar ground classes and the landmark proxy mask, and make the ground noise frequency derivative-aware. Find which far-LOD or backdrop object the floating slab is. |
| Impact | med |
| Cost | about 0.5 session (fixes plus goldens) |
| Needs owner | no |

Frames: `desktop-04-lombard-russian-hill-1300-clear.png` (Lombard roof gap), `staging-prod-autotier-mobile-low-03-play-02.png` (slab). `docs/look/M02e-before-after-sf.png` is the M02e image on `claude/build` (City Hall moiré); the City Hall probe frame of the original run was not kept.

### Vehicles

| Field | Finding |
|---|---|
| Gap | Traffic and parked cars are flat-coloured boxes. At distance they collapse to flat slabs (desktop-05 Embarcadero, desktop-06 GGP). The player's tow truck is a box with a yellow boom (the owner's screenshot). There is no glass, car paint, wheel detail or readable lights. M10d1 (traffic, police, robotaxi) and M10d3 (14 player cars) default to code recipes with no fal (Q-39, DL-OWN-01), which will still read as toys next to the target. |
| Fix | Run M10d1 and M10d3, but raise the bar inside the same AssetIds: bevelled bodies, a clearcoat paint material, glass that reflects the env map, separate wheels and tyres, emissive lights, a blob shadow. Better: author the bodies, or admit verified CC0 bases with original liveries per §7 (licence snapshot, provenance, credits, ip:strings). |
| Impact | high |
| Cost | 2 sessions as planned (M10d1, M10d3); authored or CC0 bodies add art lead time (Q-24) |
| Needs owner | yes |

### Pedestrians and player

| Field | Finding |
|---|---|
| Gap | The player and pedestrians are capsule and box mannequins: a blue Coast mannequin, green pedestrian mannequins. The creator's 'Coast' preset also renders as a mannequin, so the owner's stylized Coast (DL-OWN-05) is not visible anywhere yet. The target has believable people. |
| Fix | Use the M10d1 pedestrian kit (8 bodies × 20 outfits on `bay_rig_v1`) and the creator-kit parts. Bring forward the M10a2 Coast creator set so the stylized protagonist appears early. Keep pedestrians realistic per DL-OWN-05. |
| Impact | high |
| Cost | M10d1 (1 session) plus M10a2 as planned; skinning risk on `bay_rig_v1` |
| Needs owner | yes |

Frame: `staging-prod-autotier-mobile-low-01-creator.png`.

### Ground, sidewalks and curbs

| Field | Finding |
|---|---|
| Gap | Every sidewalk and plaza uses the same square-tile grid, and grass is flat green with low-frequency noise. There is no visible curb height, gutter, curb ramp or driveway cut: asphalt meets paving at a hard colour edge (desktop-03, -05). The look comes from procedural colour noise only; there are no texture assets (M02e: 'adds no texture asset'). |
| Fix | Have the mesher extrude a 15 cm bevelled curb plus a gutter strip along the carriageway edge, using the sidewalk offset polylines from 02-world-living §4.1. Give concrete sidewalk, plaza pavers and grass distinct materials. Add tiling PBR detail textures (albedo, normal, roughness) with stochastic or triplanar tiling: verified CC0 sets per §7, or code-generated tiles. |
| Impact | high |
| Cost | about 1 session (pairs with the road-markings milestone) |
| Needs owner | yes |

Frames: `desktop-03-third-st-bayview-1300-clear.png`, `desktop-05-embarcadero-ferry-1300-clear.png`.

### Camera and FOV

| Field | Finding |
|---|---|
| Gap | The vehicle chase camera sits 11 m back with lift and a 70° FOV (`VEHICLE_FAR_M = 11`, packages/engine/src/sim/camera/collision.ts). The owner's shot looks down from above the tow truck, with the truck bed and boom filling half the frame. The target is a low chase about 5-6 m back at roof height, with the horizon in the upper third. The camera also keeps its own heading after a teleport or respawn instead of turning to the player's heading. The on-foot camera (65°, 2.8 m) is fine. |
| Fix | Use a default chase distance of about 6-7 m, anchor at roof height, a slight down-pitch that puts the horizon near 35-40 % from the top, and speed-based FOV widening from 70° to 80°. Align the camera yaw to the player's yaw on teleport and respawn. |
| Impact | high |
| Cost | about 0.2 session |
| Needs owner | no |

(The plan later replaced the constant with a per-vehicle offset and deferred speed-FOV; see `look-plan.md`.)

### Sky and atmosphere

| Field | Finding |
|---|---|
| Gap | The desktop physical sky and clouds at 13:00 are acceptable. The new game, though, starts at 06:00 'Fog' (owner shot, staging HUD), which gives a flat mauve-grey sky, dark ground and no fog-bank volume: the worst first impression. At clear noon, distance haze is strong and blue and washes out the far city. |
| Fix | Start the story at a clear or golden hour, or roll the fog off during the intro. Tune the aerial perspective strength per weather. The `desktop-ultra` atmosphere adapter stays in M10d2. |
| Impact | med |
| Cost | about 0.2 session for the start time and haze tuning |
| Needs owner | yes |

Frames: `desktop-01-civic-center-plaza-0600-fog.png`, `desktop-03-third-st-bayview-0600-fog.png`.

### HUD and UI

| Field | Finding |
|---|---|
| Gap | The 'tofu squares' are deliberate glyphs. The heat row draws U+25AF `▯` for unlit bars (packages/ui/src/hud/widgets.tsx:69), and the `heat.clear` status icon is also `▯` (packages/ui/src/hud/model.ts:40), so 'Clear' carries a box that looks like a missing glyph. The clock icon `◔` (widgets.tsx:112) renders as a dot. Fonts are system stacks only. |
| Fix | Replace the status glyphs with a small inline SVG icon set: heat stars or badges, a shield for Clear, a clock and weather icons. Remove all reliance on font glyph coverage, and keep the colour-plus-shape accessibility rule (10-ui-hud-xr 2.13). |
| Impact | med |
| Cost | about 0.2 session |
| Needs owner | no |

(Owned since by DL-738; see `look-plan.md`.)

### Distant city

| Field | Finding |
|---|---|
| Gap | The skyline reads as fog-blue massing, which is acceptable, but the far cards are still the M02b1 placeholder `texture/far-bay-cards`. In the owner's shot the hillside reads as tiny lit boxes with cone trees on the horizon. |
| Fix | Run M10d2's rasterized skyline cards, and give the far-LOD trees impostors (or drop them) so cones do not line the horizon. |
| Impact | med |
| Cost | inside M10d2 (1 session) |
| Needs owner | no |

### Water

| Field | Finding |
|---|---|
| Gap | Not captured clearly (no bay frame in this run). By spec the water is simple TSL waves with no reflection of the city (M02e Scope out: no SSR or vertex displacement), and with the env map off on Safari and headless it has no sky reflection either. |
| Fix | After the env-map fix: Fresnel sky reflection everywhere, a planar or SSR city reflection on desktop, and shore foam from the water-distance field. Verify on device first. |
| Impact | med |
| Cost | about 0.5-1 session |
| Needs owner | no |

### Plan and sourcing (cross-cutting)

| Field | Finding |
|---|---|
| Gap | M10d1, M10d3 and M10d2 will replace the gray-box with deterministic code recipes when nothing is supplied (Q-39 default), and final art is never fal (DL-OWN-01). That route cannot reach the target's photoreal fidelity, and four visible layers have no milestone at all: markings and signage, curbs, vegetation, street furniture. |
| Fix | Owner decisions: (a) Answer Q-39 with an art lead or a list of approved CC0 or paid packs. (b) Admit CC0 PBR texture sets now, with licence snapshots. (c) Optionally revisit DL-OWN-01 for seamless ground and facade tiles from the $8 buffer. (d) Have the Architect schedule a 'street realism' milestone set for roads and markings, curbs, furniture and vegetation before M10d1. In parallel, a Builder can take the no-owner wins: grade and tone map, shadow casters, chase camera, HUD icons, the roof and depth bugs, and the classify.ts fix. |
| Impact | high |
| Cost | about 4-5 extra sessions plus the 3 planned M10d sessions |
| Needs owner | yes |

## Frames

All frames are in `docs/look/study/`. Desktop frames are 1600 × 900 (`chromium-webgl2`, `desktop` tier, full post stack); `mobile-low` frames are 844 × 390 at DPR 2 (1688 × 780 pixels); staging frames are 1600 × 900 (production build, auto tier `mobile-low` under headless SwiftShader).

| Frame | Shows (cited for) |
|---|---|
| `desktop-01-civic-center-plaza-1300-clear.png` | Civic Center Plaza, looking east toward UN Plaza |
| `desktop-01-civic-center-plaza-0600-fog.png` | the same spot at the owner's 06:00 karl-fog start condition |
| `desktop-02-market-4th-plaza-1300-clear.png` | Market & 4th plaza; the curtain wall as a dark mullion box ("Buildings and facades") |
| `desktop-03-third-st-bayview-1300-clear.png` | Third Street, Bayview: near-black asphalt, no markings, no curb ("Roads and markings", "Ground, sidewalks and curbs") |
| `desktop-03-third-st-bayview-0600-fog.png` | Third Street at 06:00 karl-fog ("Sky and atmosphere") |
| `desktop-04-lombard-russian-hill-1300-clear.png` | Lombard / Russian Hill: the roof gap, trees half-buried on the slope, bloom halos ("Vegetation", "Buildings: roof and depth bugs") |
| `desktop-05-embarcadero-ferry-1300-clear.png` | the Embarcadero: asphalt meeting paving at a hard edge, far cars as slabs ("Ground, sidewalks and curbs", "Vehicles") |
| `desktop-06-golden-gate-park-1300-clear.png` | Golden Gate Park: an open lawn with a dozen tiny cones ("Vegetation") |
| `mobile-low-01-civic-center-plaza-1300-clear.png` | Civic Center Plaza at `mobile-low` |
| `mobile-low-03-third-st-bayview-1300-clear.png` | Third Street at `mobile-low` |
| `staging-prod-autotier-mobile-low-00-menu.png` | the staging main menu (build id in the footer) |
| `staging-prod-autotier-mobile-low-01-creator.png` | the creator with the Coast defaults as a mannequin ("Pedestrians and player") |
| `staging-prod-autotier-mobile-low-02-intro.png` | the New Game intro over the running world: noise-aliasing sparkle on the ground at `mobile-low` (in the 2026-10-27 re-capture, dark speckle on the light paving at the lower right) ("Roads and markings") |
| `staging-prod-autotier-mobile-low-03-play-02.png` | about 30 s after Start at the m.a1.01 opening (in the 2026-10-27 re-capture inside the opening cutscene, with its Skip button); the floating dark slab at the top edge of the sky ("Buildings: roof and depth bugs"), box cars, a cone tree taller than the buildings |
| `staging-prod-autotier-mobile-low-03-play-11.png` | about 120 s after Start (in the 2026-10-27 re-capture still the opening cutscene, with its Skip button): the same view, slab, cones and box cars |
| `staging-prod-autotier-mobile-low-05-turn.png` | after a walk and a camera turn: the play HUD at 06:00 Fog with the `▯` heat-row and Clear glyphs ("HUD and UI"), the yellow tow-truck boom, a cone tree, lit windows on every floor at dawn |
| `contact-sheet.png` | grid of the desktop, fog and `mobile-low` frames plus one staging frame, labelled |
