# 06 — Racing, part 3: authored content tables (garage, handling presets, events, ladder, audio)

> S06, Wave 3, 2026-10-18. Part of `spec/domains/06-racing.md`. All numbers are **design starting values owned by this project** (tunable data in `content/vehicles/*.json`, `content/races/*`, `config/racing.json`); they need no external citation. Every vehicle, make and rival name is a **placeholder** that must pass `names:lint` and a trademark knock-out search before M14b (D-S06-01). Real-world referents appear only in D-S06-01 of the main file.

## C.1 Garage roster (PrefabDef `vehicle.<slug>`, C07 `vehicle/<slug>`, handling `hp.<slug>`)

| Slug | Make · model (fictional) | Class | Archetype | Drive | Price $ | Art milestone |
|---|---|---|---|---|---|---|
| `ondine-pico` | Ondine Pico | D | compact | FWD | 9,000 | M03a (traffic kit) |
| `ondine-nimbus` | Ondine Nimbus | D | hatch | FWD | 14,000 | M07b |
| `kestrel-gig` | Kestrel Gig | D | rideshare hybrid | FWD | 18,000 | M03a |
| `kestrel-quill` | Kestrel Quill | C | sports coupe | RWD | 42,000 | **M07a** |
| `kestrel-finch` | Kestrel Finch | C | hot hatch | FWD | 36,000 | M07b |
| `tidewater-neap` | Tidewater Neap | C | EV sedan | RWD | 55,000 | M07b |
| `brackenridge-rasp` | Brackenridge Rasp | B | muscle coupe | RWD | 95,000 | **M07a** |
| `brackenridge-drayman` | Brackenridge Drayman | B | muscle sedan | RWD | 120,000 | M07b |
| `tidewater-spring` | Tidewater Spring | B | performance EV | AWD | 160,000 | M07b |
| `aurelian-sorrel` | Aurelian Sorrel | A | supercar, mid-engine | AWD | 320,000 | **M07a** |
| `aurelian-meridian` | Aurelian Meridian | A | grand tourer | RWD | 380,000 | M07b |
| `aurelian-halberd` | Aurelian Halberd | A | track special | RWD | 520,000 | M07b |
| `aurelian-apogee` | Aurelian Apogee | S | hypercar | AWD | 1,200,000 | M07b |
| `solenne-skip` | Solenne Skip | S | **rocket roadster** (EV, `thrusterHop`) | AWD | 980,000 (ladder #1 reward) | **M07a** |
| `halcyon-cormorant` | Halcyon Mobility Cormorant | R | **robotaxi** (quirks) | RWD | not for sale | **M07a** |

M07a ships one car per class (bold) so the vertical slice, the hill-climb opponent and the Robotaxi Rush are playable; the other eight are art and tuning passes in M07b (M07b1), and `ondine-pico` and `kestrel-gig` come from the M03a traffic kit. Both ship gray-box bodies `vehicle/graybox.<slug>`; the final bodies to the C.8 node contract for the 14 cars with prefabs land in M10d3 (DL-460). Story/traffic prefabs from S01 map to handling ids `hp.compact`, `hp.sedan`, `hp.rideshare`, `hp.van`, `hp.truck`, `hp.pickup` (class D, M03a), `hp.police-cruiser`, `hp.police-suv`, `hp.police-interceptor`, `hp.robotaxi-ambient` (M03a/M03c). Police presets: cruiser 1,950 kg, 0–100 kph 7.0 s, top 210 kph; SUV (ram unit) 2,300 kg, 7.5 s, 200 kph, durability 1.6; interceptor (heat 5 only) 1,800 kg, 5.0 s, 260 kph. Their top speed is a ceiling; the pursuit speed rule in `config/pursuit.race.json` binds them to the player's speed.

## C.2 Class envelope and oracle targets (`CLASS_ENVELOPE`; oracle = scripted line on the flat gray-box, dry, no nitro)

| Class | Mass kg | Power kW | μ lateral | Top kph | 0–100 s | Braking 100→0 m (±8 %) | Brake g | Durability | PI band | Purse 1st $ |
|---|---|---|---|---|---|---|---|---|---|---|
| D | 850–3,200 | 50–160 | 0.75–0.95 | 140–185 | 7.5–12.0 | 46 (μ 0.85) | 0.85 | 1.30 | 100–399 | 1,200 |
| C | 1,000–2,100 | 120–260 | 0.92–1.08 | 200–245 | 5.5–7.5 | 39 | 1.00 | 1.20 | 400–549 | 3,000 |
| B | 1,100–2,200 | 220–420 | 1.00–1.15 | 245–285 | 4.2–5.6 | 38 | 1.05 | 1.15 | 550–699 | 7,000 |
| A | 1,200–1,900 | 300–520 | 1.20–1.40 | 300–335 | 3.0–3.9 | 30 | 1.30 | 1.00 | 700–849 | 15,000 |
| S | 1,200–2,000 | 380–900 | 1.40–1.65 | 340–380 | 2.2–3.2 | 26 | 1.50 | 0.90 | 850–999 | 25,000 |
| R | 1,800–2,400 | 100–200 | 0.60–0.80 | 100–200 (105 governed) | 6.5–9.5 | 56 | 0.70 | 1.50 | 250–350 fixed | 6,000 |

Braking distance = 39.4 / g m from 100 kph (v²/2μg). PI is measured, not formula-guessed: `tools/ci` runs the oracle lines headless in the `canonical` profile and writes `content/vehicles/pi.lock.json` (PI per vehicle plus ΔPI per upgrade slot and level, measured one slot at a time); runtime PI = PI₀ + ΣΔPI. CI fails if any vehicle with all slots at level 3 leaves its class band (so upgrades never change class).

## C.3 Handling presets in port-contract form

Format from [research/repos-modding.md §7.3]: name · value · units · **meaning** · source · mechanism · conversion · oracle · tolerance. An empty meaning blocks implementation. *Source* is "S06 design" for every row (no external source); *mechanism* names the code path in `stepHandling`. Rows common to all presets are written once in C.3.0.

### C.3.0 Shared rows

| Name | Units | Meaning | Mechanism | Conversion | Oracle · tolerance |
|---|---|---|---|---|---|
| `engine.torque[]` | rpm, N·m | torque at the crankshaft; linear interpolation, clamped at both ends | wheel force = T·gear·final·η / r | none | peak T·ω within 3 % of `powerKw` · CI unit |
| `drive.shiftUpPct` / `shiftDownPct` | fraction of redline | auto-box shifts up above, down below; no shift during `shiftTimeSec` | gear state in `HandlingState` | rpm = wheelOmega·gear·final·60/2π | gear sequence on the 0–200 line equals the golden list · exact |
| `tire.muLong` | – | drive traction limit as a multiple of weight on driven wheels (arcade value, below `muLat` on purpose: launches spin) | clamp of wheel long force | F ≤ μ·N·(1 − 0.6·(Fy/Fy_max)²) | 0–100 time · ±0.3 s |
| `tire.peakSlipDeg` | deg | slip angle where lateral force peaks | normalised slip x = vLat / (max(|vLong|,2)·tanPeak), tanPeak = sin/cos at load (detmath) | none | skidpad peak lateral g · ±0.08 g |
| `tire.slideRatio`, `slideAtX` | –, – | grip after the peak falls linearly to this fraction at x = `slideAtX` | piecewise curve g(x) = x(2−x) for x ≤ 1, then 1 − (1 − s)·min(1,(x − 1)/(X − 1)) | none | drift hold test: 45° slip at 25 m/s keeps ≥ 0.75 of peak force · exact |
| `steer.lockDeg`, `speedRefMps`, `minLockPct` | deg, m/s, % | lock at standstill; effective lock = lockDeg / (1 + (v/ref)²), floored at `minLockPct` | front steer angle | deg → rad (× 0.0174533) | 360° circle radius at 5 m/s vs wheelbase geometry · ±5 % |
| `steer.assist` | 0..1 | yaw-rate error correction toward the steer-implied yaw rate; multiplied by the player's `steerAssist` level (0 off … 3 full) | `yawTorque` | none | no spin-out on full-lock at 80 % top speed with assist 3 · bot |
| `drift.assist` | 0..1 | counter-steer and yaw damping while slip angle > `minAngleDeg` and throttle held | `yawTorque`, rear μ lerp | none | 10 s donut keeps radius within ±15 % · line |
| `suspension.rideHz`, `dampingRatio` | Hz, ratio | ride natural frequency and damping *ratio* (not a coefficient: avoids the 3× over-damping trap in [research/repos-modding.md §7.3]) | spring-damper per wheel: k = m_corner(2πf)², c = 2ζ√(k·m_corner) | Hz → rad/s | static sag within ±10 % of target; landing from 1 m settles in ≤ 2 bounces |
| `suspension.landingDamp`, `airPitchTrim`, `airRollTrim` | ratio, 0..1, 0..1 | extra damping on first contact after air; torque aligning pitch/roll to velocity/ground normal in the air | `airTorque` | none | Russian Hill crest at 120 kph: air 0.6–1.4 s, lands on four wheels, damage ≤ 5 % |
| `nitro.*` | units | 100 = full; boost adds `boostKw` at the wheels for `capacity/drainPerSec` s; cannot start below `minToFire`; speed ceiling = top × (1 + `maxOverTopPct`) | `HandlingState.nitro` | none | 4 s boost adds ≥ 12 kph/s at 100 kph · ±15 % |
| `durability` | divisor | larger = less damage per impact | `applyImpact` | none | 15 m/s wall hit costs class-A body 0.23 ±0.03 on normal |

### C.3.1 Supercar — `hp.aurelian-sorrel` (class A, mid-engine AWD)

| Field | Value | Notes |
|---|---|---|
| massKg · cgHeightM · wheelbaseM · trackM · frontWeightPct | 1,450 · 0.46 · 2.70 · 1.64 · 42 | rear-biased: twitchy on lift-off |
| idle / redline rpm | 900 / 8,600 | |
| torque (rpm→N·m) | 1,000→360 · 2,500→620 · 4,500→720 · 6,500→560 · 8,000→420 · 8,600→320 | peak power ≈ 381 kW at 6,500 |
| powerKw | 381 | CI asserts ±3 % |
| gears · final · reverse | 3.62 · 2.45 · 1.80 · 1.38 · 1.10 · 0.90 · 0.75 · 3.70 · 3.20 | η 0.92, wheel r 0.34 m |
| shiftUp / shiftDown / shiftTime | 0.95 / 0.45 / 0.15 s | torque cut during shift |
| AWD rear bias | 0.65 | |
| tire muLong · muLat · peakSlipDeg | 0.95 · 1.30 · 7.5 | slideRatio 0.80 at X = 2.5; loadSens 0.10; front 1.00, rear 0.96 |
| cdA · downforce | 0.78 m² · 0.55 N/(m/s)² | ≈ 4.3 kN at 320 kph |
| steer | lock 32°, ref 40 m/s, min 22 %, rate 360°/s, assist 0.25, selfAlign 0.35 | |
| brake | 1.30 g, bias 0.62, ABS on | |
| drift | assist 0.40, handbrakeRearGrip 0.45, yawDamp 0.30 | |
| suspension | rest 0.30 m, travel 0.12 m, rideHz 2.0, ζ 0.70, antiRoll 0.6, landingDamp 0.5, airPitchTrim 0.5, airRollTrim 0.5 | |
| nitro | capacity 100, boostKw 120, drain 25/s, minToFire 15, maxOver 10 %, refill drift 6/s, nearMiss 6, draft 8/s, air 10/s | |
| durability | 1.00 | |

Oracles (flat, dry, no nitro): 0–100 kph 3.4 s ±0.3; 0–200 kph 9.5 s ±0.8; top speed 320 kph ±3 % (rolling resistance 171 N is a `tire.rollResistN` row); skidpad 1.30 g ±0.08; 100→0 in 30 m ±8 %; Filbert (31.5 % grade) climb from a 30 m run-up crests at ≥ 45 kph. Starting values reproduce these to within the tolerance only after the M03a tuning pass; `tire.muLong` and the launch ramp are the knobs.

### C.3.2 Rocket roadster — `hp.solenne-skip` (class S, EV AWD, `thrusterHop`)

Differs from the supercar in: massKg 1,720; EV motor (no clutch, 2 virtual ratios 1.5 / 0.95, final 5.0, wheel r 0.35 m, η 0.90); torque 0→950 · 4,200→950 · 8,000→505 · 12,000→334 · 14,000→286 (≈ 423 kW constant power above 4,200 rpm), idle 0, redline 14,000; AWD bias 0.5; muLong 1.05, muLat 1.50, peakSlip 8.0°; cdA 0.62; brake 1.50 g; durability 0.90 (fragile). Quirks: `thrusterHop {deltaVy 7.5 m/s, charges 2, rechargeSec 6, coyoteSec 0.4}` (apex v²/2g ≈ 2.9 m, clears a 1.6 m roadblock and any spike strip; usable on the ground or ≤ 0.4 s after leaving it, once per press, adds a stabilising pitch/roll trim for 0.5 s); `regenBraking {nitroPerSec 4, minKph 60}`.
Oracles: 0–100 2.9 s ±0.3; top 350 kph ±3 %; hop apex 2.9 m ±0.3 on flat ground; recharge 6.0 s ±0.1; hop over the heat-3 roadblock fixture without contact (`racing/hop.roadblock` line).

### C.3.3 Robotaxi — `hp.halcyon-cormorant` (class R, quirks)

Mass 2,050 kg; EV motor torque 0→330 · 4,500→330 · 9,000→165 (≈ 155 kW), 2 virtual ratios 1.6 / 1.0, final 6.4, wheel r 0.36 m; muLong 0.70, muLat 0.70, peakSlip 6.5°; brake 0.70 g; steer assist 0.60; durability 1.50; nitro capacity 0 (no nitro; the jailbreak adds 50).
Quirks and behaviour (the quirk data and pure helpers live in `packages/shared/src/vehicle/quirks.ts`; ambient robotaxis in S02's traffic brains import the same helpers, assumption A-S06-5):

| Quirk | Behaviour | Jailbreak |
|---|---|---|
| `speedGovernor {kph 105, jailbreakItem 'item.jailbreak-kit'}` | throttle is scaled to zero above 105 kph; `HandlingEvent govern` drives the HUD "governed" tag | removes the governor (top 190 kph), adds nitro 50, **adds robotaxi witness weight**: infractions seen by robotaxis report 1 s sooner and +50 % points |
| `autoYield {radiusM 14}` | if throttle would close on a ped, vehicle or prop within the radius at > 4 m/s relative, brake is applied up to 0.7 g and an `autoYield` tag shows; ramming events impossible; contact damage ×0.5 | off |
| `stallOnDarkSignal {holdSec [4, 9]}` | while the C06 world state reports a blackout signal as dark within 12 m ahead, the car stops and holds for a seeded duration (`rng('racing.stall')`); the player may override after 2 s with a held Interact | off |

Grounding: robotaxis treat dead signals as four-way stops and stalled at dark intersections in the December 2025 SF blackout [research/gamedesign-decomposition.md §2.7, verified row "20 Dec 2025 SF blackout"]. Oracles: governed top 105 kph ±2; jailbroken top 190 kph ±3 %; 0–100 8.0 s ±0.8; stall holds within [4, 9] s on 20 seeded runs (`racing/quirk.stall`); autoYield prevents contact with a stationary ped dummy at 14 m/s approach.

## C.4 Upgrades (UpgradeSlot levels 1–3; price = % of base price per slot: 2 / 4 / 7)

| Slot | Effect per level 1 / 2 / 3 |
|---|---|
| engine | torque × 1.04 / 1.08 / 1.12 |
| tires | muLong and muLat × 1.03 / 1.06 / 1.09 |
| brakes | maxDecelG × 1.05 / 1.10 / 1.15 |
| suspension | dampingRatio +0.05 / +0.10 / +0.15 (cap 1.0); landing damage −10 / −20 / −30 % |
| weight | massKg × 0.97 / 0.94 / 0.91 |
| nitro | capacity × 1.15 / 1.30 / 1.45; boostKw × 1.00 / 1.05 / 1.10 |
| armor | durability × 1.12 / 1.25 / 1.40 |

Applied by multiplying the base `HandlingProfile` at spawn; the replay header records `upgrades` and `handlingRev`.

## C.5 Event catalog (v1; `content/races/<id>/`; all inside SF; street names are authoring hints resolved against the baked graph by `pnpm map:races validate`, an unresolved name fails CI)

| Id | Kind | District | Class | Shape | Time · weather | Police | Notes | Milestone |
|---|---|---|---|---|---|---|---|---|
| `sf.sprint.ferry-ocean-beach` | sprint | D5→D8 | C | Ferry Building → Ocean Beach via Market and Fell/Oak, ~11 km | day · clear | off | VS race 1 | M07a |
| `sf.circuit.embarcadero-vanness` | circuit | D5 | B | Embarcadero → Bay St → Van Ness loop, 3 laps, ~3.5 km | dusk · clear | off | VS race 2; side streets closed | M07a |
| `sf.downhill.twin-peaks-mission` | downhill | D9→D2 | C | Twin Peaks → Mission via Market and Clipper, ~5 km | day · clear | off | VS race 3; jump zones | M07a |
| `sf.pursuit.bayview-escape` | pursuit | D3→D1 | D | start heat 2, evade | day · karl-fog | on (2→3) | story hook, Premise A mission A3 | M07a |
| `sf.hillclimb.filbert-hyde` | hillclimb | D6 | C | Russian Hill, Filbert (31.5 %) and Hyde, ~1.3 km | day | off | S03 mission `m.a2.02` vs `solenne-skip` test car | M07b |
| `sf.sideshow.bayview-ring` | sideshow | D3 | D, C | ring zone at a baked intersection, 90 s score then escape | dusk | heat 2 at T+60 s | `xr: none`; owner flag Q-GD-06 | M07b |
| `sf.robotaxirush.soma-haight` | robotaxiRush | D1→D8 | R | deliver one fare without infractions, ~6 km | day | robotaxi witnesses | S03 mission `m.a2.03` | M07b |
| `sf.checkpoint.park-dusk` | checkpoint | D8 | B | Golden Gate Park drives, tollbooth gates | dusk | off | leftover time carries | M07b |
| `sf.speedtrap.great-highway-night` | speedtrap | D8 | A | 6 camera gates, sum of kph | night · karl-fog | off | S03 mission `m.a3.03` | M07b |
| `sf.drift.bayview-yard` | drift | D3 | C | 4 drift zones in the industrial blocks | dusk | off | `xr: none` | M07b |
| `sf.pursuit.embarcadero-heat3` | pursuit | D5 | A | start heat 3, evade | night | on (3→5) | spikes at piers, heli | M07b |
| `sf.pursuit.soma-viaducts` | pursuit | D1 | B | start heat 2, survive 180 s | day | on (2→4) | hiding spots under viaducts | M07b |
| `sf.sprint.bayview-shipyard` | sprint | D3 | D | shipyard roads, ~3 km | day | off | ladder 10 | M07b |
| `sf.hillclimb.nob-hill-switchbacks` | hillclimb | D6 | C | Nob Hill climbs, ~2 km | day | off | ladder 9 | M07b |
| `sf.speedtrap.market-st-dawn` | speedtrap | D4 | C | Market St, 4 cameras | dawn | off | ladder 8 | M07b |
| `sf.checkpoint.presidio-fog` | checkpoint | D7 | A | Presidio loop, fog | dusk · karl-fog | off | ladder 6 | M07b |
| `sf.circuit.mission-bay-night` | circuit | D1 | S | Mission Bay block loop, 3 laps | night | off | ladder 2 | M07b |
| `sf.sprint.bay-bridge-west` | sprint | D5→D10 | S | Embarcadero → Bay Bridge west span → Yerba Buena Island (portal stays closed) | night | on (3) | ladder 1 | M07b |
| `sf.circuit.soma-grid` | circuit | D1 | A | SoMa grid, 3 laps | day | off | free event | M07b |
| `sf.downhill.noe-glen` | downhill | D9 | B | Noe Valley → Glen Park descent | day | off | free event | M07b |

Premise B and C hooks reuse these events (B3 candlelight sideshow = `sf.sideshow.bayview-ring`; C3 = `sf.sprint.ferry-ocean-beach`; C7 = `sf.speedtrap.great-highway-night`; B9 and the dark-gate variant are S03 scripted modifiers on `checkpoint`). S03 finalizes hook ids in C09; S06 only requires `ModeEnterArgs.defId = <RaceId>` (A-S06-4).

### Race-kind rules

| Kind | Start | Scoring | Ends | Fails |
|---|---|---|---|---|
| sprint | grid, countdown | time, place | finish gate | totaled, abandon |
| circuit | grid, countdown | time, best lap, place | after `laps` | totaled |
| checkpoint | rolling, timer = first gate bonus | remaining time carries (tollbooth rule [research/gamedesign-decomposition.md Verified facts]) | finish gate | time reaches 0 |
| speedtrap | rolling | Σ speed (kph, integer) at speed cams; ties by time | last camera | totaled |
| downhill | grid | time; airtime adds Rep (+1 per 0.5 s, cap 20) | finish | totaled |
| hillclimb | grid | time; 2-lane gradient | finish | totaled |
| drift | free | score = Σ angle° × kph × 0.001 per tick × combo (×0.1 per second held, max ×5); wall hit halves the combo | timer | none |
| pursuit | start heat n | bounty; success `evade` or `surviveSec` | success or bust | bust, totaled |
| sideshow | free in ring | drift score inside ring zone; police heat 2 at T+60 s | escape (cooldown) after the score window | bust |
| robotaxiRush | rolling | fare ticks down; each infraction −5 %; robotaxi witnesses report | deliver | fare 0 %, bust |

## C.6 Tha Bay 10 ladder (rival ids `rival.<handle>`; all `original` likeness, authored silhouette portraits with no fal spend, DL-OWN-01 and DL-237; barks are text plus Aura t1 TTS)

| Rank | Handle | Specialty | Showdown event | Class | Rep level | Reward car | Unlocks |
|---|---|---|---|---|---|---|---|
| 10 | Kickstand | tuner kid | `sf.sprint.bayview-shipyard` | D | 1 | `ondine-nimbus` | D3 free events |
| 9 | Cable Car Cleo | hills | `sf.hillclimb.nob-hill-switchbacks` | C | 3 | `kestrel-quill` | D6 free events |
| 8 | Doppler | speed cameras | `sf.speedtrap.market-st-dawn` | C | 4 | `tidewater-neap` | D4 free events |
| 7 | Lowtide | drift | `sf.drift.bayview-yard` | C | 6 | `kestrel-finch` | |
| 6 | Marina Mae | fog driver | `sf.checkpoint.presidio-fog` | A | 8 | `brackenridge-rasp` | D7 free events |
| 5 | Twin Peak | downhill | `sf.downhill.twin-peaks-mission` | B | 10 | `tidewater-spring` | `unlock.racing.robotaxi` |
| 4 | Switchback | circuit | `sf.circuit.embarcadero-vanness` | A | 12 | `aurelian-meridian` | |
| 3 | Standstill | cop-baiter | `sf.pursuit.embarcadero-heat3` | A | 14 | `aurelian-halberd` | |
| 2 | Nightingale | night circuit | `sf.circuit.mission-bay-night` | S | 17 | `aurelian-apogee` | |
| 1 | Foghorn | boss | `sf.sprint.bay-bridge-west` | S | 19 | `solenne-skip` | D10 free events |

Rival driver `skill` per rank: 0.30 (10) up to 0.95 (1) in steps of ≈ 0.07 on the base; difficulty adds −0.15 / 0 / +0.10. Rivals are fictional characters: never real-person-derived, never depicted in crimes beyond the genre's street racing and evasion (D-30, constraint 7).

## C.7 Audio needs (rows for `content/audio/needs.json`, owner S06; sets checked by `check:assets`; music is commissioned originals only, S05 policy; placeholders M07b2, final sets M10e, DL-500)

| Set id | Content |
|---|---|
| `veh.engine.<class>` | idle, on-load, off-load, redline loops per class D/C/B/A/S; turbo whistle for A/S; crossfade by rpm and load |
| `veh.ev.<id>` | motor whine pitch-mapped to speed for `tidewater-*`, `solenne-skip`, `halcyon-cormorant` |
| `veh.tire` | squeal (3 intensities), gravel, wet hiss, curb |
| `veh.impact` | light, medium, heavy, glass, scrape, spike-puncture |
| `veh.nitro` | ignition, loop, cut; thruster burst for the hop |
| `veh.shift` | shift pop and BOV per class |
| `race.ui` | countdown ticks and GO, gate pass, lap, new best, finish fanfare, wrong-way |
| `race.announcer` | original scripted lines, designed/synthetic voice, `likeness.tier: original` |
| `police.scanner` | callouts per heat level, spike warning, roadblock warning, evaded, busted |
| `race.music` | high-energy commissioned tracks, ≥ 4 stems (calm, race, pursuit, results) |

## C.8 Art needs (S05 sourcing, H6 vehicle QA)

15 drivable vehicles (C.1), 3 police presets' visuals (S01/S05), 10 authored rival silhouettes, barrier and cone prop sets (CC0 or authored), gate arches and markers (instanced, one render object), skid decals, nitro flame and exhaust billboards, thruster nozzles, spark and smoke sprites. Vehicle node contract: S05's names are accepted unchanged and extended with `cockpit` (interior group, hi/mid only), `steering_wheel`, `anchor_driver`, `anchor_hood`, `exhaust_l|r`, `thruster_fl|fr|rl|rr` (roadster only), `siren_l|r` (police), and a vertex attribute `_dent` (0..1 dent weight) for the damage shader (proposal CCP-4).

## C.9 Controls per platform (amends gamedesign §6: no Ctrl/Cmd/Alt chords, because browsers do not let pages intercept shortcuts such as tab close)

| Action | Desktop KBM | Gamepad (standard) | iPhone touch | Quest controllers | Quest / Vision Pro hands |
|---|---|---|---|---|---|
| Throttle / brake | W / S, ↑ / ↓ | RT b7 / LT b6 analog | right pedals (pressure treated as 100 %) or `autoThrottle` + brake | right trigger b0 / left trigger | pedal pinch zones, `autoThrottle` default |
| Steer | A / D, ← / → | left stick axis 0 | on-screen wheel arc or left-half drag; tilt opt-in | left thumbstick axes[2] or two-hand wheel | two-hand pinch wheel (CCP-9) |
| Handbrake | Space | B b1 | button | left squeeze b1 | squeeze both hands |
| Nitro | Left Shift | A b0 | button | right squeeze b1 | – (hands: button panel) |
| Ability (hop) | H | Y b3 | button (roadster only) | right thumbstick press b3 | – |
| Look behind | C hold | L3 b10 | button | left thumbstick press b3 | – |
| Reset (hold 1 s) | R hold (`Interact`) | RB b5 hold | button hold | left grip hold | – |
| Horn | G | LB b4 | – | – | – |
| View cycle / map / pause | V / M / Esc | R3 b11 / Back b8 / Start b9 | icons | – / wrist panel / menu | wrist panel |
| Photo | P | b8 + b9 | camera icon | – (off) | – (off) |

Defaults use only `xr-standard` indices 0, 1 and 3; Quest A/B/X/Y indices are UNVERIFIED, so no required action sits only on a face button (C03 rule 6, U-ENG-5). All bindings are remappable except `client.Pause` (C03 rule 9). Gamepad API works on iOS Safari [research/gamedesign-decomposition.md Verified facts, caniuse]; iPhone has no haptics, fullscreen or orientation lock [research/stack-rendering-platform.md §3.4–3.5, F-011], so the driving layout is landscape-first with S10's "rotate for driving" overlay and feedback is visual and audio only. Tilt steering on iPhone is opt-in (permission flow UNVERIFIED, U-RAC-7).


## C.10 Visual target per tier

"Forza-grade" is defined as eight checkable properties (VR-1 … VR-8) at `desktop-ultra`, reviewed by the owner on a canned screenshot set and gated by feature flags: **VR-1** clear-coat paint material with flake normal; **VR-2** reflections from the keyframe sky dome plus `LightProbeGrid` and `SSRNode` on wet road and body; **VR-3** wheel motion blur (spoke-blur shader by angular speed) and camera `MotionBlur`; **VR-4** TRAA, bloom, half-res GTAO, tone map; **VR-5** 3-cascade 4,096² shadows; **VR-6** emissive head/tail lights with bloom; **VR-7** hi-fidelity cars (60,000 tris, 2,048² textures, ≤ 6 materials) with interiors in cockpit view; **VR-8** dent/scratch damage and rain/dirt response. Post nodes exist in r186 [research/stack-rendering-platform.md §1.4]; `motionblur`, `ssr`, `dof` and `lut` are not in C13 `PostNode`, so CCP-5 adds them; until accepted they are `optionalPost` extensions behind `config/platform-flags.json`. Cost of VR-2/VR-3 on r186 is UNVERIFIED (U-RAC-6) and is calibrated in M11a with the governor allowed to drop them.

| Tier | Car fidelity (C07) | Reflections / shadows | Post | Effects (`tierCaps`) |
|---|---|---|---|---|
| desktop-ultra | hi, 60k tris | dome + probe grid + SSR; csm3 4096² | TRAA, bloom, GTAO, motion blur | skid 512, sparks 256, cull 400 m |
| desktop | hi | dome + probe grid; csm3 2048² | SMAA, bloom, GTAO | skid 384, sparks 192, cull 350 m |
| mobile | mid, 30k, 1024² | baked probe; csm1 1024² 150 m | FXAA, tone map | skid 128, sparks 96, cull 200 m |
| mobile-low | lo, 15k, 512² | baked probe; blob shadow | tone map | skid 0, sparks 32, cull 150 m |
| xr-quest | mid (cockpit interior hi-detail only inside) | baked probe; blob | none (`DirectRenderPipeline`) | skid 0, sparks 0, cull 150 m |
| xr-visionpro | hi | baked probe; csm1 2048² | none | skid 128, sparks 64, cull 250 m |

Render objects per car: hi ≤ 6, mid ≤ 4, lo ≤ 2 (C07 material caps); wheels of all cars share one `InstancedMesh` per wheel style; gates, skid decals and flames are instanced (1 object each). A mobile race (player + 5 rivals mid, 6 police lo, markers, VFX) budgets about 55 of the 150 render objects; chunks use the rest [research/stack-rendering-platform.md Performance budgets, F-007]. Cameras: `chase-near` offset [0, 1.3, 4.2], `chase-mid` [0, 1.6, 5.5], `chase-far` [0, 2.2, 8.5], hood and cockpit on `anchor_hood`/`anchor_driver`; look-behind on hold; auto-recentre 1.5 s (C04).


## C.11 Pursuit rules in races

Rules. (1) **Evade** = cooldown completes (level 0); **survive** = timer; **bust** = S01's rule (speed < 2 m/s with ≥ 2 units within 8 m for 3 s) or a totaled car; busting ends the event with a 5 % repair fee, no fine, no impound outside an embedded story race. (2) **Roadblocks** are placed on the predicted route: the next `predictGates` (3) gates of the race route, armed 140 m ahead, re-planned every 2.5 s; authors may also fix `ScriptedBlock`s at route metres for guaranteed set pieces. (3) **Spike strips** (9 m, two lanes) deploy at C08 `chokePoints` (bridge approaches, tunnel mouths, steep one-lane blocks), telegraphed by a HUD warning and scanner call 90 m ahead, at most 2 (heat 4) or 3 (heat 5) per pursuit, 25 s apart. A hit sets that car's tire health to 0 for every tire it crossed (grip × 0.4 per wheel). (4) **Counterplay**: lane choice through the roadblock gap, nitro, the roadster hop (apex 2.9 m clears 1.6 m barriers and strips), pursuit breakers (C08 `pursuitBreakers`: scaffolding, produce stands, Russian Hill crests), hiding spots (×2 cooldown fill). (5) **Catch-up**: a unit more than 200 m behind gets ×1.15 closing speed only while out of the player's view; units spawn ≥ 120 m behind on route lanes, never in sight. No unit exceeds 1.06× the player's top speed, so evasion is skill, not speed. (6) **Bounty**: 10 points per second at the current level, +500 per wrecked unit; payout = points × 10 cents. (7) Robotaxi witnesses (S01 `Witness`) report infractions 2 s after seeing them; the jailbroken Cormorant shortens that by 1 s and adds 50 % points. (8) Heat 6 is never used (scripted story finales only).


## C.12 AI driver algorithm

**Speed profile.** At race start each rival computes, over the 5 m racing-line samples, v_max = detmath.sqrt(μ_eff·g / |κ|) from baked curvature, then a backward pass for braking (v_i² ≤ v_{i+1}² + 2·a_brake·ds) and a forward pass for the class power curve. **Control.** Pure pursuit to a lookahead of 6 m + 0.25·v on the line plus lateral offset; PI speed control toward profile × `skillFactor` where skillFactor = 0.82 + 0.16·skill; brake margin 1.25 − 0.25·skill; a seeded "mistake" (wide line) with probability (1 − skill)·0.06 per corner, stream `racing.ai`. **Overtake**: a car within 25 m and closing picks the freer side, holds it 1.5 s, re-merges. **Recover**: stuck 3 s → reverse then resume; off-route beyond 40 m → place on the nearest line point, never visibly. AI thinks at 30 Hz (`AI_DIVISOR`).

