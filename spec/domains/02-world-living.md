# 02 — World & Map, part 4: road graph, traffic, pedestrians, transit, weather and time

> S02, Wave 2, 2026-10-18. Part of `spec/domains/02-world.md`. Contract types: `02-world-contracts.md`; bake derivation: `02-world-bake.md`. Requirements: R-MAP-04 (living city), R-MAP-01 (hills, bridges, one-way streets), R-MAP-02 (backdrop motion). Sim code here runs in `sim.worker` under the C02 lint (`detmath`, seeded streams `amb:<cell>:<slot>`); presentation code runs on the main thread. Numbers are design values unless cited; † marks values to calibrate on devices (M03b, M11a).

## 1. Road graph semantics

**1.1 Classes.** Directed edges, right-hand traffic. DataSF `classcode` (1 freeway, 2 major, 3 arterial, 4 collector, 5 residential, 6 ramp [research/auth-ugc-input-maps.md §5.2]) overrides the OSM-derived class on matched segments (`cnn`), because the city file is authoritative for classification.

| `RoadClass` | OSM `highway` | DataSF | Lanes per direction (default) | Lane width | Default speed |
|---|---|---|---|---|---|
| 0 Freeway | motorway, trunk | 1 | 2 | 3.6 m | 24.6 m/s (55 mph) |
| 1 Ramp | `*_link` | 6 | 1 | 3.6 m | 15.6 m/s |
| 2 Arterial | primary, secondary | 2, 3 | 2 | 3.4 m | 13.4 m/s |
| 3 Collector | tertiary | 4 | 1 | 3.2 m | 11.2 m/s |
| 4 Local | residential, unclassified, living_street | 5 | 1 | 3.0 m | 11.2 m/s |
| 5 Service | service (not parking aisle or driveway) | 0 | 1 | 2.8 m | 4.5 m/s |

OSM `lanes`, `lanes:forward|backward` and `maxspeed` override the defaults. `config/world/roadclass.json` holds the table. Parking: Collector, Local and Arterial default to `parkingSides = 2` with a 2.3 m lane, 0 where OSM says `parking:lane:*=no` or the class is Freeway, Ramp, Service. `widthM = lanes × laneWidth × (one-way ? 1 : 2) + medianM + 2.3 × parkingSides`.

**1.2 One-way.** OSM `oneway=yes|-1|true`, roundabouts, and DataSF `oneway` F/T. The bake tests both orientations of F/T against OSM on matched segments and adopts the one with higher agreement; if neither exceeds 90 % (a design value: OSM↔DataSF agreement on `sf` has not been measured, U-W15), S5 fails (this removes the need to assume the F/T meaning). Where DataSF says one-way and OSM says two-way on a matched active `STREETS` segment, DataSF wins. Reversible lanes are not modelled.

**1.3 Layers.** `layer`, `bridge`, `tunnel` give an `i8` level per edge. Edges that cross without a shared node never connect; ramps connect levels through shared nodes whose `layer` is the lower level. Slabs (bridges, viaducts, overpasses) carry collision; tunnel corridors carry hoods (bake S7).

**1.4 Junctions.** Nodes within 25 m that belong to the same intersection (shared street names or a signal cluster) merge into one `Junction` (≤ 8 approaches). Control: `Signal` from OSM `highway=traffic_signals` (also `traffic_signals:direction`), `AllWayStop` from `stop=all` or Local × Local without tags, `MinorStop` for `highway=stop` on the minor road, `Yield`, `Roundabout`, `DeadEnd`. `type=restriction` relations (`no_left_turn`, `no_u_turn`, `only_*`) remove movements. U-turns exist only at dead ends. A `Movement` is `(inEdge → outEdge)` with a turn class (heading change: straight ≤ 30°, right/left otherwise, U-turn > 150°), a connector curve (cubic Bézier between lane ends, evaluated with exact ops) and a `conflicts` list (movements whose curves cross or merge within 2 m); ≤ 12 conflicts per movement.

**1.5 Signals.** Approaches are grouped by heading into phases: a 4-way gets 2 phases (the two opposing pairs), a 3-way 2 phases (through road, side road), 5+ approaches 3 phases (clustered by heading). Defaults: green 20 s, amber 3 s, all-red 1 s [research/gamedesign-decomposition.md §2.7]; an Arterial through phase gets 28 s with 16 s for the cross street. `cycleTicks = Σ (green + amber + clear) × 60`, `offsetTicks = hash(junctionId) mod cycleTicks`. Left turns are permissive: they enter only when the conflict set is empty. Pedestrians walk during the parallel vehicle green minus its last 5 s. `blackout` makes every program `dark`. No protected-left or actuated timing in v1.

**1.6 Stop signs and yield.** At `AllWayStop` the first agent to stop proceeds when its conflict set is free, ties broken by `StableKey` ascending. At `MinorStop` the minor road yields to every conflicting major movement. Dark signals behave as `AllWayStop` for ambient agents.

**1.7 Closures.** `TrafficControl.closeEdges` marks edges closed for ambient planning, spawns barrier props from the `prop.barrier` prefab at the edge ends and re-routes agents at their next junction. The caller releases by id (`release(by)`).

**1.8 Gates.** Largest strongly connected component ≥ 98 % of drivable edges (design value on `sf`, U-W15); no edge with `lanes = 0`; every signal junction has a program; the route City Hall → each portal exists; edges per chunk ≤ 600; max out-degree ≤ 8; hero edges (Golden Gate main span, Bay Bridge west span, Yerba Buena Island tunnel, Lombard crooked block, Filbert at Hyde) are drivable and connected. Authors resolve ids by `resolve(lat, lng)` or `pnpm map:resolve`; `osmWay` and `cnn` on each segment support re-snapping after a re-bake.

## 2. Traffic

**2.1 Model.** Ambient cars are kinematic path followers, not physics vehicles. Each agent holds `(edge, s, lane, speed, nextEdge, turn, state)` in component 256 and a private RNG stream `amb:<cell>:<slot>` (state hashed). The brain runs in `SimStage.AI` at the fixed 30 Hz (`AI_DIVISOR 2`).
1. *Car following* (IDM-style): desired speed `v0 = min(limit, curveLimit) × personality` with personality 0.92–1.08 from the stream; time headway 1.4 s; minimum gap 2.0 m; comfortable acceleration 2.5 m/s²; braking 3.5 m/s². Curve limit `v ≤ dsqrt(2.0 / κ)` with κ from the polyline. Grade above 10 % scales `v0` by `1 − (grade − 10)/40`, floor 0.6.
2. *Plan*: 40 m before the end of an edge, choose `nextEdge` among legal movements with weights straight 0.60, right 0.22, left 0.18 (renormalized), excluding the reverse twin; a dead end despawns the agent if unseen, else it stops 1 s and U-turns.
3. *Junction protocol*: stop at the stop line when the aspect for its movement is not green (amber only if it cannot stop within 3.5 m/s²); enter when the conflict set is free; claims time out after 20 s and the lowest `StableKey` proceeds (deadlock breaker).
4. *Lane*: agents keep the lane they spawned in and move to the lane matching the next turn within the last 40 m of the edge (no overtaking in v1). Parked-car obstruction does not occur because parked cars sit in the parking lane.

**2.2 Spawn and despawn.** Per tier ambient radius `R_amb`: desktop-ultra 600 m, desktop 500, xr-visionpro 400, mobile 350, mobile-low 250, xr-quest 250 (†). A slot spawns at a seeded point on a road edge of its cell, at distance 0.6–1.0 × `R_amb` from the player, never inside a ±55° forward cone closer than 0.9 × `R_amb`. It despawns beyond 1.25 × `R_amb` [research/repos-world.md §3.2] or when unseen and stuck for 30 s. Chunks inside `max(physics radius, R_amb) + 1 chunk` must have resident `p0` data; agents on unloaded edges freeze and despawn.

**2.3 Simulation levels.** *Near* (≤ 80 m of a player or camera): a kinematic Rapier body with a box collider, capped at 120 (desktop-ultra, desktop), 60 (xr-visionpro), 40 (mobile), 24 (mobile-low, xr-quest). *Far*: data only. *Promotion*: on contact with ΔV ≥ 3 m/s or when the player enters the car, the agent becomes a dynamic vehicle (prefab, S06 handling `civilian` preset) for ≤ 8 s, then becomes a stationary wreck (despawned when unseen for 10 s). Caps on simultaneous promoted agents: 8 desktop, 4 mobile, 3 mobile-low/Quest. Hit pedestrians follow S01's ragdoll-lite rule.

**2.4 Reactions.** Agents treat the player's vehicle and any entity as a leader if it intrudes into their lane within 30 m; they honk (audio cue) when braking hard for it. A police vehicle with sirens within 40 m behind causes agents to pull right and stop until it passes (pursuit units are excluded). A collision witnessed by a robotaxi or pedestrian reports an infraction through the witness hooks (§3, §4).

**2.5 Archetypes** (prefab ids; weights are shares of non-police slots; † art from S05/S06):

| Prefab | Share | Notes |
|---|---|---|
| `vehicle.compact`, `vehicle.sedan` | 32 %, 26 % | colours from a 12-colour palette by hash; where the robotaxi share is 3 %, the difference goes to `sedan` |
| `vehicle.rideshare` | 12 % | hybrid sedan with a dash light |
| `robotaxi.default` | 8 % in cbd, cbd-tech, nightlife, civic-dense, tourist-dense; 3 % elsewhere | §3 |
| `vehicle.van`, `vehicle.truck` | 8 %, 6 % | industrial profile ×3, renormalized |
| `vehicle.pickup` | 6 % | |
| `vehicle.bus` | outside the shares | set dressing on route splines (§5), not a free agent |
| `police.cruiser` | 2 % patrol | owned by the PursuitDirector once heat > 0 |

`vehicle.bus`, `vehicle.cablecar`, `vehicle.tram`, `boat.ferry` and `aircraft.airliner` are additive prefab ids owned by S02 (`assets/prefabs/*.json`); the S01 prefab list is not changed.

**2.6 Rendering.** One `InstancedMesh` per archetype (10 draws), instance attributes for colour and light state, `frustumCulled = false` with manual distance throttling, a two-box far LOD beyond 150 m [research/repos-world.md P8]. Instance totals obey C13 `CrowdLimits` (540 desktop, 800 desktop-ultra, 300 xr-visionpro, 200 mobile, 120 mobile-low and xr-quest).

**2.7 Budgets (†).** Traffic AI ≤ 1.0 ms per AI tick at 540 agents (desktop reference), ≤ 0.4 ms at 200 (mobile); 12 draws; zero allocations per tick.

## 3. Robotaxis

The operator is fictional ("Halcyon Mobility", `hp.halcyon-cormorant` handling in S06) [research/legal-ip-likeness.md §6]. Behaviour is grounded in the documented December 2025 SF blackout behaviour [research/gamedesign-decomposition.md §2.7] and shares helpers with S06 (`packages/shared/src/vehicle/quirks.ts`, A-S06-5).
1. **Speed:** `v0 = 0.95 × limit`, never above the limit, ignoring personality.
2. **autoYield:** radius 14 m; brakes up to 0.7 g for a pedestrian, vehicle or prop closing at > 4 m/s.
3. **Pedestrians:** stops when a pedestrian is within 3 m laterally of the lane ahead inside 20 m, and at every occupied crosswalk.
4. **Dark signal:** treats it as an all-way stop. With probability 0.35 per dark junction it enters `Stalled` for a seeded 4–9 s (`stallOnDarkSignal`), hazard lights on, blocking its lane; the player may push it.
5. **Witness:** an infraction within 40 m and line of sight reports to `PursuitApi` after 2 s (jailbroken robotaxis: S06 shortens it); LOS rays use the shared `losChecksPerTick` budget, ≤ 4 per tick for robotaxis.
6. **Fare:** the phone app calls `TeleportApi.request('fast-travel', …)` with `robotaxi` transport: a robotaxi spawns ≥ 120 m away and drives to the player within 90 s; the ride is a short in-engine cut and a teleport; fare 300 ¢ + 120 ¢/km (`config/world/transit.json`); refused at heat ≥ 1 or when the mission forbids it.
7. **Visual:** roof sensor dome, original livery, no real marks.
8. **Blackout test hook:** `TrafficControl.setBlackout(true, by)` is the single switch used by sandbox, the story and Tycoon events.

## 4. Pedestrians

**4.1 Graph** (bake S8). Sidewalks are offset polylines at `±(carriageway/2 + 1.6 m)` on every Collector, Local and Arterial edge (OSM `footway=sidewalk` ways replace derived ones where mapped); corner nodes sit at each junction corner; crosswalk links join corner pairs and carry `junction` and the parallel `movement` for signal timing; OSM `highway=crossing` nodes add mid-block crossings; `highway=steps|footway|path|pedestrian|track` add stairs and paths (SF has many public stairways); plazas and park lawns get a 12 m lattice clipped to the polygon minus prisms. Freeways, ramps and service roads have none.

**4.2 Agent states.** `Walk` (1.4 ± 0.2 m/s, stairs ×0.6), `Wait` at a red crossing, `Idle` (phone, talk, bench, 5–40 s at nodes flagged `Waiting`), `Dodge` (vehicle within 6 m at > 6 m/s), `Flee` (2.8 m/s, away from a threat, 10 s), `Record`/`Cheer` (within 40 m of a `crowd.attract` event, e.g. a sideshow), `Hit` (ragdoll-lite handoff), `Witness` (pending infraction report after a seeded 3–6 s). Reaction triggers and the full FSM list `walk → gawk → flee → call_cops → recover` follow [research/ai-npc-runtime.md §3.1 table row L0]. Transitions use the agent stream; filler pedestrians never call an LLM (D-21).

**4.3 Local avoidance.** Agents within 60 m of the player (≤ 48) run a deterministic pairwise repulsion step every third AI tick (10 Hz) in `StableKey` order; others follow edges on two lateral lanes. `recast-navigation-js` (suggested for this layer in the NPC research) is not used in v1: it would add a navmesh bake, a wasm module and an unproven determinism story; reconsider only if the M03b2 density test fails.

**4.4 Density and crowds.** Slots 256–511 per chunk, `activeSlots` by profile, hour and weather (§7). Event crowds add `crowd.attract` sources (S06 sideshow, S03 scenes) with a cap of 3 live. XR rule: no pedestrian enters a 0.6 m radius around the head; they path around the player.

**4.5 Bodies.** 8 adult bodies × 20 outfits × palette swaps from `ped.ambient.{a..h}` (gamedesign §2.7); no real-person likeness, no child bodies in v1. Near LOD (≤ 25 m): skinned `bay_rig_v1` through the C04 anim graph, caps 24 (desktop), 16 (xr-visionpro), 12 (mobile), 8 (xr-quest), 6 (mobile-low). Far LOD: rigid low-poly (≤ 300 triangles) in one `InstancedMesh` per body with a procedural gait in the vertex shader (phase per instance). Totals obey `CrowdLimits` (desktop 400, desktop-ultra 600, Vision Pro 200, mobile 150, mobile-low and Quest 80).

## 5. Transit as set dressing

Names in the player's view are fictional brands through `NameRegistry` (defaults: "Bay Rail" for BART, "City Metro" and "City Transit" for Muni, "Peninsula Express" for Caltrain, "Bay Ferry"); station and stop place names are factual; logos, typefaces and liveries are original [research/legal-ip-likeness.md §6]. The BART developer licence forbids BART marks in association with its data [research/auth-ugc-input-maps.md §5.2], so only positions are used.

| System | Data | Content | Count (desktop / xr-visionpro / mobile / mobile-low, xr-quest) | Behaviour |
|---|---|---|---|---|
| Bay Rail stations | 8 SF stations: Embarcadero, Montgomery, Powell, Civic Center/UN Plaza, 16th St Mission, 24th St Mission, Glen Park, Balboa Park [research/gamedesign-decomposition.md §2.4]; Market Street positions from `i28k-bkz6` | entrance prefab with `Interactable{Transit}` | 8 | fast travel between stations: fare 200 ¢ + 50 ¢ per stop, fade ≤ 2.5 s, refused at heat ≥ 1 |
| City Metro | OSM `railway=light_rail\|tram` | 2-car trains on splines on surface sections | 6 / 4 / 3 / 2 | stops at stations; not boardable in v1 |
| City Transit buses | `9exe-acju` patterns snapped to the graph; stops `i28k-bkz6` | `vehicle.bus` | 14 / 10 / 6 / 3 | dwell 8 s at stops; shares the traffic cap |
| Cable cars | `content/world/cablecars.json`: Powell–Hyde, Powell–Mason, California | `vehicle.cablecar` on fixed splines | 6 / 4 / 3 / 2 | 4.2 m/s; hop on/off at stops; cling-on stunts; fighter stage prop |
| Ferries | OSM `route=ferry` ways, else authored lines Ferry Building ↔ Treasure Island, Alcatraz | `boat.ferry` on a water graph | 4 / 3 / 2 / 1 | 7 m/s; Ferry Building is the expansion portal |
| Aircraft | 3 corridors (SFO and OAK approach), 600–1,500 m | `aircraft.airliner` | 5 / 4 / 2 / 1 | decorative, not hashed |

Cable-car lines are authored as street-name chains and snapped: Powell–Hyde = Powell (Market → Jackson), Jackson (Powell → Hyde), Hyde (Jackson → Beach); Powell–Mason = Powell (Market → Jackson), Jackson (Powell → Mason), Mason (Jackson → Columbus), Columbus (Mason → Taylor), Taylor (Columbus → Bay); California = California (Market/Drumm → Van Ness). These chains are from memory and UNVERIFIED; the bake checks that each chain exists and that every point lies within 6 m of an OSM tram or street edge, and fails otherwise. Muni Metro includes the Central Subway opened in 2022 [research/gamedesign-decomposition.md §2.4]; subway tunnels are visible only as station entrances.

## 6. Weather and time per tier

The clock and weather state are S01's (`WorldClockApi`, `WeatherState`, `EnvState`: hour, night, dark, weather, next, blend, `fogBankM`, rain). S02 renders them. Presets are exactly `clear`, `karl-fog`, `overcast`, `rain`, `smoke`, `golden` [research/repos-world.md P10]; there is no thunder, snow or lightning.

```ts
// packages/world/src/client/sky/types.ts — main thread only
export interface SkyKeysRow {                 // authored per preset × key hour in config/world/sky-keys.json
  skyTop: [number, number, number]; skyBottom: [number, number, number]; sunColor: [number, number, number]; sunSize: number;
  ambient: [number, number, number]; fogColor: [number, number, number]; fogNearM: number; fogFarM: number;
  exposure: number; cloudCover: number; windowLit: number /* 0..1 */; starAlpha: number;
}
export interface SkyKeysFile { schema: 'sky-keys/1'; hours: readonly [0, 5, 6.5, 9, 13, 17, 19.5, 21.5]; presets: Record<'clear' | 'karl-fog' | 'overcast' | 'rain' | 'smoke' | 'golden', readonly SkyKeysRow[]> }
export interface SkyUniforms {                // ~12 shared uniforms, the whole mobile-tier sky [research/repos-world.md §3.3]
  uNight: number; uDark: number; uSunDir: [number, number, number]; uSunColor: [number, number, number];
  uFogColor: [number, number, number]; uFogNear: number; uFogFar: number; uSkyTop: [number, number, number]; uSkyBottom: [number, number, number];
  uAmbient: [number, number, number]; uExposure: number; uWet: number; uRain: number; uBlackout: number; uBank: number;
}
export interface AtmosphereAdapter { init(r: unknown): Promise<void>; update(env: Readonly<SkyUniforms>): void; dispose(): void }  // takram, desktop-ultra only, removable
```

1. **Day shape.** Fixed sunrise 06:30 and sunset 19:30 (design values). Sun direction (main thread, `Math.sin` allowed): `a = π(h − 6.5)/13`, elevation `e = 52°·sin a` (equinox noon at SF latitude), `dir = (cos a·cos e, sin e, sin a·cos e)` in ENU (x east, y up, +z south); the moon is opposite at 0.4 intensity. Rows are interpolated by hour and preset blend; `night` and `dark` come from S01 so the sim and the sky agree.
2. **Fog bank** (Karl): `fogBankM` is the marine-layer top. Fog density is multiplied by `bankWeight(x) = 1` for x < −1,500 m (Richmond, Sunset, Ocean Beach, the Golden Gate) falling linearly to 0.35 at x > 2,500 m; the bank base is 60 m. Analytic height fog [research/repos-world.md P11].
3. **Rain**: `rain` (u8) scales streak count; `uWet` darkens road and roof albedo (desktop also lowers roughness).
4. **Night**: window lit fraction `smoothstep(uNight)` against a per-building threshold from `seed` (0.15–0.75); street lamps are emissive sprites with up to 32 pool-of-light decals near the player; head and tail lights on cars when `uDark > 0.4`; stars `max(0, uNight − 0.3)` [research/repos-world.md §3.3].
5. **Blackout**: windows ×0.15, lamps off, signals dark, `uBlackout = 1`.

| Feature | desktop-ultra | desktop | xr-visionpro | mobile | mobile-low | xr-quest |
|---|---|---|---|---|---|---|
| Sky | dome + takram atmosphere (`atmosphereLevel` 2) | dome | dome | dome | dome | dome |
| Clouds | volumetric, one layer, 0.6 scale, 2 shadow cascades | painted layer | painted layer | painted layer | gradient | gradient |
| Fog | height fog node + aerial perspective | height fog node | height fog node | linear fog | linear fog | linear fog + distance fade |
| Rain | 20 k GPU streaks, splashes | 6 k streaks | 600 world streaks near head | overlay + 800 streaks | overlay only | 600 world streaks near head, no overlay |
| Wetness | roughness + albedo | albedo | albedo | albedo | none | none |
| Night lights | windows, lamps, decals ≤ 32 | same | windows, lamps, decals ≤ 8 | windows, lamps, decals ≤ 16 | windows, lamps | windows, lamps |
| Sky GPU budget † | 3.0 ms | 1.0 ms | 0.6 ms | 0.6 ms | 0.3 ms | 0.3 ms |
| Governor knob | `atmosphereLevel` 2 → 0 | `atmosphereLevel` 1 → 0 | 1 → 0 | 1 → 0 | — | — |

Lighting follows C13: `probe-grid` on mobile and XR with a single sky-derived probe re-baked only when the sun moves > 0.006 rad or darkness changes > 0.04, at most every 200 ms [research/repos-world.md §1.4]; baked vertex AO replaces SSAO off desktop. takram is isolated behind `AtmosphereAdapter` and removable (its WebGPU path is work-in-progress and last released 2026-05-06 [research/repos-world.md §5]). Missions lock hour and weather through `WorldClockApi.lock`. Screenshot gates (design thresholds †): clear noon sky luminance 0.45–0.85, night < 0.12, `karl-fog` lowers city luminance variance by ≥ 25 % against `clear` at the same hour [research/repos-world.md P18 `verify-visual` pattern]; CI uses baked LUTs for the ultra adapter.

## 7. Spawn tables and density

Capacities are baked (`02-world-bake.md` §4 S9). Active count per kind: `activeSlots(capacity, tierFactor, hourFactor, weatherFactor, override)` (contract §2), where `override` is 0–1.5 from `TrafficControl.setDensity` (S06 events: off 0, light 0.35, normal 1.0). A global cap from `CrowdLimits` trims the farthest cells first.

| Tier | desktop-ultra | desktop | xr-visionpro | mobile | mobile-low | xr-quest |
|---|---|---|---|---|---|---|
| Traffic factor (÷ 800) | 1.00 | 0.675 | 0.375 | 0.25 | 0.15 | 0.15 |
| Pedestrian factor (÷ 600) | 1.00 | 0.667 | 0.333 | 0.25 | 0.133 | 0.133 |
| Parked-car factor | 1.0 | 0.7 | 0.5 | 0.3 | 0.15 | 0.15 |

The `canonical` profile (C02) always uses the `mobile-low` factors. Weather factors (traffic / pedestrians): clear 1 / 1, karl-fog 0.9 / 0.7, overcast 1 / 0.9, rain 0.85 / 0.5, smoke 0.7 / 0.4, golden 1 / 1.1. Hour curves (linear between anchors at 00, 03, 06, 08, 12, 17, 20, 22 h; traffic | pedestrians), `config/world/density.json`:

| Profile | Traffic | Pedestrians |
|---|---|---|
| cbd, cbd-tech | .15 .05 .35 1.0 .7 1.0 .5 .3 | .05 .02 .2 .8 1.0 .9 .5 .2 |
| nightlife | .2 .05 .25 .7 .7 .9 1.0 .6 | .1 .03 .15 .5 .7 .9 1.0 .7 |
| civic-dense | .2 .08 .3 .9 .8 1.0 .7 .4 | .1 .05 .2 .7 .9 1.0 .8 .4 |
| tourist-dense | .15 .05 .25 .7 .9 .9 .8 .4 | .05 .03 .2 .6 1.0 1.0 .8 .3 |
| industrial | .1 .05 .5 1.0 .9 .8 .3 .15 | .02 .01 .1 .4 .5 .4 .1 .05 |
| residential | .1 .03 .3 .8 .5 .8 .5 .2 | .05 .02 .15 .4 .5 .6 .5 .2 |
| residential-park | .1 .03 .25 .6 .6 .7 .4 .15 | .04 .02 .15 .4 .8 .8 .5 .15 |
| sparse | .05 .02 .1 .3 .3 .4 .2 .1 | .02 .01 .05 .15 .25 .3 .2 .08 |
| freeway | .3 .15 .6 1.0 .8 1.0 .6 .4 | 0 |
| beach (Great Highway, Ocean Beach) | .02 .01 .1 .3 .5 .5 .3 .05 | .02 0 .1 .3 .8 .9 .5 .1 |

SoMa and FiDi peak at the weekday rush, Mission and Haight in the evening, Bayview with industrial trucks by day [research/gamedesign-decomposition.md §2.7]. Parked cars ignore the hour curve (factor 1) and thin by tier.

## 8. Components, determinism, failure modes

| Id | Component | Fields | Hashed |
|---|---|---|---|
| 256 | `TrafficAgent` | edge u32, s f32, lane u8, speed f32, nextEdge u32, turn u8, state u8 | yes |
| 257 | `PedAgent` | node u32, next u32, t f32, state u8, timer u16 | yes |
| 258 | `RobotaxiBrain` | mode u8, holdUntil u32, fare u8 | yes |
| 259 | `ParkedCar` | seg u32, s f32, side i8, locked u8 | yes |
| 260 | `TransitVehicle` | route u16, s f32, dwell u16 | yes |
| 261 | `AmbientBoat` | route u16, s f32 | yes |
| 262 | `SignalState` | junction u16, phase u8, aspectBits u16 | no (derived from tick; satisfies A-S06-8) |
| 263 | `Witness` | target key u32, reportAtTick u32, kind u8 | yes |
| 264 | `Aircraft` | corridor u8, t f32 | no (render-only) |

Rules. (0) Rooms (M12b): ambient traffic is client-local in v1. A `(cell, slot, epoch)` triple determines an agent's plan from a seed, so the room DO can later own `worldSeed` and a 20 s epoch and let peers agree; any agent a player touches becomes a local-only perturbation. (1) All world sim uses `detmath`, integer ticks and the named streams; the cross-browser hash test (M03b) runs 10,000 canonical ticks with traffic and pedestrians on. (2) The signal aspect is a pure function of the tick. (3) Component writes happen only in `SimStage.AI` and `Rules`.

| Failure | Detection | Response |
|---|---|---|
| `p0` pack missing around the player | `chunkReady` false | `Control` stays `Waiting`; "re-downloading district"; ambient frozen |
| Agent on an unloaded edge | edge lookup null | freeze 2 s, then despawn |
| Gridlock | speed < 0.5 m/s for 30 s | despawn if unseen, else nudge to the next legal movement |
| Junction deadlock | claim held > 20 s | lowest `StableKey` proceeds |
| Graph island (bake) | SCC gate | island edges flagged `unreachable`, excluded from spawn |
| Memory pressure | `onMemoryPressure('soft')` | `crowdDensity` ×0.7, then trees and decals off; `hard`: drop streaming radius one step |
