# M03a1 — vehicles-interaction-prefabs

## Goal
After this session the player can walk up to a car, get in, drive it through the streamed city and get out. S06's shared handling model v1 lives in `packages/shared/src/vehicle/` (`stepHandling`, damage, class envelope; detmath only) with the six story presets, the garage starter `hp.ondine-pico`, the police cruiser, the ambient robotaxi and the police SUV that M03c dispatches. S01's vehicle wrapper in `sim.worker` turns it into an own ray-cast vehicle on a Rapier dynamic body (`castRay` + `applyImpulse`, the DL-104 default; the U-RAC-1 spike is M03a2), with two substeps above 100 km/h, enter/exit through the control ownership machine, vehicle cameras, interaction v1 (scored prompts), vehicle, prop and pickup prefabs, ragdoll-lite with the two-body impulse, and the input-line recorder and player. Oracle lines (0–100, braking, skidpad, crest jump, Filbert climb) run headless in the `canonical` profile as regression oracles. The entity inspector and physics wireframe join the debug tools.

## Requirements
- R-MODE-01: driving, entering and leaving vehicles and the interaction prompts the story's missions use.
- R-MODE-02: one handling model shared by story driving and racing (S06 `stepHandling`), inside measured class envelopes.
- R-PLAT-04: chase, hood and cockpit cameras in vehicles alongside the on-foot fp/tp cameras, switchable outside cutscenes.

## Depends on
- **M01b2:** on-foot controller, ownership machine, camera rig with collision, prefab registry (`PrefabDef`, `PrefabService`, `player.default`), anim and audio skeletons, debug panel and free cam, gray-box world in QA builds.
- **M02c1:** `WorldApi` (`graph.nearestEdge`, `query.groundY`, `TrafficControl.closeEdges` hook for barrier props), streamed `synth` world with slabs and hoods.
- Contracts: C06 1.1 (`PrefabDef`, `PrefabService`, `InteractKind`, `InteractionApi`, `InteractionHandler` in `01-engine-save-modes.md`), C07 1.1 (`KindExtras` vehicle anchors: `nodes.body`, `wheels`, `steer`, `lights`), C03 1.1 (`SimButton.Enter`, `Interact`, `Handbrake`; `InputContextId 'vehicle'`; `InputFrame`), C01 1.0 (component ids in the engine range, `StableKey` `veh:`), C04 1.1 (camera modes).

## Scope in
- **Handling model** (`packages/shared/src/vehicle/`, S06 types verbatim from `06-racing-data.md` §4.1):
  - `handling.ts`: all types, `VEHICLE_SCHEMA`, and `stepHandling` implementing every C.3.0 row (torque curve, auto gearbox, drive force, friction-ellipse clamp, lateral curve, load sensitivity, steer lock and rate, steer assist, brakes and ABS, aero, per-wheel spring-damper from `rideHz` and `dampingRatio`, air trim, landing damping). Nitro, drift assist, quirks and the other assists are typed and return neutral output (stubbed per `06-racing.md` §8 row M03a).
  - `damage.ts`: `applyImpact`, `powerScale`, `tireGripScale` (`durability` divisor).
  - `envelope.ts`: `CLASS_ENVELOPE` (C.2 numbers); `quirks.ts`: quirk data and pure helpers of C.3.3 (governor throttle scale, seeded dark-signal hold in [4, 9] s, auto-yield brake demand) that M03b1's robotaxi brains import; `stepHandling` applies only `speedGovernor` now; `instance.ts`: `VehicleInstance` types only.
  - Sim code under the C02 lint: `detmath` only, no `Math.sqrt`, `sin` or `pow`.
- **Presets** `content/vehicles/handling/hp.{compact,sedan,rideshare,van,truck,pickup}.json` (class D, inside the D envelope, design values chosen here), `hp.police-cruiser.json` (1,950 kg, 7.0 s, 210 kph) and `hp.police-suv.json` (2,300 kg, 7.5 s, 200 kph, durability 1.6) per C.1, `hp.robotaxi-ambient.json` (R envelope, `speedGovernor` 105 kph), and `hp.ondine-pico.json` (the C.1 garage starter: class D compact, FWD, inside the D envelope; M07a1 uses it as its class-D player car); schema `packages/shared/schemas/racing/handling.schema.json`. Every row has a meaning (the port-contract rule).
- **Vehicle wrapper** (`packages/engine/src/sim/vehicle/`): own ray-cast vehicle on a dynamic body: four suspension rays with `castRay` against heightfield, prisms, slabs and hoods; contact data → `WheelContact`; `stepHandling` → `WheelForce` applied with `applyImpulse` at contact points; `drive()` of Rapier's controller is not used; 2 substeps while a player vehicle exceeds 100 km/h; `Vehicle` component and `HandlingState` store in the engine id range; `veh:` stable keys; floating-origin aware.
- **Enter and exit** (`01-engine.md` §2.5): ownership `OnFoot → Vehicle` through `Waiting → Entering → Active`, states 200 entering, 201 driving, 203 exiting; exit to the nearest free door-side point (driver side first, then passenger, then roof-safe search ≤ 3 m), blocked reasons as LocKeys; input context switches to `'vehicle'`; `sim.Enter` begins it, `config/input/defaults.{kbm,gamepad,touch}.json` gain vehicle bindings (throttle, brake, steer, handbrake, look back, camera).
- **Interaction v1** (`01-engine-save-modes.md` "Interaction system" rules): scored candidates, `InteractionPrompt`, hold 0.5 s, `setEnabled`, the `EnterVehicle` handler; a minimal prompt overlay in `packages/engine/src/client/hud/prompt.ts` until the S10 HUD kit (M04b2).
- **Prefabs** (`assets/prefabs/`): `vehicle.{compact,sedan,rideshare,van,truck,pickup,ondine-pico}` (`vehicle.ondine-pico` uses `hp.ondine-pico` and the `compact` gray-box archetype), `police.{cruiser,suv,heli}` (the heli is a kinematic body without handling; M03c flies it), `robotaxi.default`, `prop.{cone,barrier,spikestrip,crate}`, `pickup.{cash,item}`; render assets are procedural placeholders `vehicle/graybox.<archetype>` and `prop/graybox.<name>` (no file ships, the M01b1 precedent) with wheel and body nodes named per C07 vehicle anchors, resolved by `packages/engine/src/client/vehicle/anchors.ts` (which also reads `extras.nodes` from a glTF when real art lands). `TrafficControl.closeEdges` now spawns `prop.barrier` at closed edge ends.
- **Cameras** (`01-engine.md` §2.6): three chase distances, hood and cockpit, auto-recentre after 1.5 s, the M01b1 collision cast.
- **Ragdoll-lite** (`01-engine.md` §2.4): ΔV ≥ 6 m/s, ≤ 3 s dynamic, get-up (states 300, 301), two-body impulse, caps per tier, canned fall beyond the cap.
- **Input lines** (`packages/engine/src/sim/lines/`, `01-engine.md` §2.11): `*.line.json` = `{v: 1, scenario, seed, profile, start: {pos, yaw, prefab?}, frames: [{tick, run, input}], commands?}` where `frames` is run-length encoded quantized C03 `InputFrame`s (a run of 1 equals `13-qa.md` §3.5's `{tick, input}` form) and `commands` holds `aim`, `follow`, `waitNear x y r timeout`; recorder (QA builds, debug panel) and player; any real input stops playback.
- **Oracle track** `packages/engine/test/fixtures/oracle-track.ts` (statics in code): 1.2 km straight, 100 m radius skidpad, 31.5 % ramp of 120 m after a 30 m run-up ("Filbert profile"), a crest with a 1 m drop.
- **Debug:** entity inspector (edits through the command ring, debug and sandbox only) and physics wireframe drawn from `BodyDesc` (the U-ENG-6 fallback); `__dvBridge.engine.spawn(prefab, at)` and `vehicle()` in QA builds.

## Scope out
- The wheel-force path decision (U-RAC-1), the C06 1.2 wheel-readout proposal and its ADR: M03a2. Nitro, drift assist, quirk wiring beyond the governor, racing assists, measured PI and `pi.lock.json`, the race cars: M07a1. Traffic brains and robotaxi behaviour: M03b1. Police behaviour, spike-strip effects and heli flight: M03c. Garage and `VehicleInstance` persistence: M04a1–M04a2 and M07b2. Vehicle glTF art and vehicle rows in `config/asset-budgets.json`: with the first vehicle art (M07a1).

## Deliverables
- `packages/shared/src/vehicle/{handling.ts, damage.ts, envelope.ts, quirks.ts, instance.ts, index.ts}`, `packages/shared/schemas/racing/handling.schema.json`, `packages/shared/test/{vehicle.powerCurve.spec.ts, vehicle.envelope.spec.ts, vehicle.step.spec.ts, vehicle.damage.spec.ts}`.
- `packages/engine/src/sim/vehicle/{raycast-vehicle.ts, vehicle-system.ts, enter-exit.ts, components.ts}`, `src/sim/interaction/{interaction.ts, handlers.ts}`, `src/sim/ragdoll/ragdoll-lite.ts`, `src/sim/lines/{format.ts, recorder.ts, player.ts}`, `src/sim/prefabs/registry.ts` (vehicle and interact fields), `src/sim/world/closures.ts` (barrier props).
- `packages/engine/src/client/vehicle/{vehicle-view.ts, anchors.ts, vehicle-camera.ts}`, `src/client/hud/prompt.ts`, `src/client/debug/{inspector.ts, physics-draw.ts}`.
- `packages/engine/test/{vehicle.lines.spec.ts, vehicle.enter-exit.spec.ts, interaction.spec.ts, ragdoll.spec.ts, lines.format.spec.ts}`, `test/fixtures/oracle-track.ts`; `tests/e2e/vehicle.spec.ts` (`@vehicle`, `@vehicle-world`).
- Data (not counted): 10 presets, 17 prefab JSON files, lines `packages/engine/test/lines/{accel-0-100, brake-100-0, skidpad, crest-jump, filbert, walk-drive}.line.json` (inputs only, no hashes), their golden end poses, state hashes and the 0–100 gear sequence in `packages/engine/test/golden/lines.json` (canonical JSON, read by `vehicle.lines.spec.ts`; inside M00d's `**/golden/**` guard; DL-549), input default edits.
- `packages/engine/package.json` script **`test:lines`** (`vitest run` over the line specs; `pnpm check:unit` also runs it).
- ≈ 37 code files.

## Interfaces
- C06 1.1 (`PrefabDef`, `PrefabService`, `InteractionApi`) and C03 1.1 implemented as written; S06's §4.1 vehicle types created verbatim. C07 1.1 vehicle anchors read, not changed. No contract change; any shape that does not compile is reported as a proposal (M01a1 rule).

## Acceptance criteria
- AC-1 Given the branch When install, typecheck, lint, unit tests and build run Then all exit 0, the vehicle module passes the determinism lint, and every preset and prefab file validates against its schema — proof: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm check:unit && pnpm build`
- AC-2 Given the ten presets When the shared vehicle tests run Then each declared `powerKw` is within 3 % of the peak of `T·ω` over its torque curve, mass, power and lateral μ lie inside its class envelope, the tire curve equals `x(2 − x)` up to the peak and reaches `slideRatio` at `slideAtX`, the effective steer lock follows `lockDeg / (1 + (v/ref)²)` with its floor, and a 15 m/s wall hit on `normal` reduces body by `0.23 / durability ± 0.03` — proof: `pnpm --filter @dv/shared test`
- AC-3 Given the oracle track in the `canonical` profile When the lines run headless Then the seven class-D presets reach 100 kph within 7.5–12.0 s, stop from 100 kph within 46 m ± 8 % and top out within 140–185 kph; the cruiser reaches 100 kph in 7.0 ± 0.5 s and 210 kph ± 3 %, the SUV 7.5 ± 0.5 s and 200 kph ± 3 %; the ambient robotaxi reaches 100 kph within 6.5–9.5 s, stops within 56 m ± 8 % and is held at 105 ± 2 kph; every preset holds skidpad lateral g within its μ range ± 0.08 g; the crest jump lands on four wheels, settles in ≤ 2 bounces and costs ≤ 5 % damage — proof: `pnpm --filter @dv/engine test:lines`
- AC-4 Given `filbert.line.json` (`hp.sedan`, 30 m run-up, 31.5 % ramp) When it runs three times in the `canonical` profile Then the end pose and state hash are bit-identical across the three runs and equal the golden end hash, and the gear sequence on the 0–100 line equals its golden list — proof: `pnpm --filter @dv/engine test:lines`
- AC-5 Given a player 2 m from a sedan's driver door When `sim.Enter` is pressed Then control passes through states 200 and 201 within 15 settle ticks and the input context is `vehicle`; exit lands the player on the driver side or the next free side within 3 m; entering a locked or occupied vehicle returns its LocKey reason and changes nothing — proof: `pnpm --filter @dv/engine test -- vehicle.enter-exit`
- AC-6 Given three interactables at different distances, angles and priorities When candidates are scored Then the published prompt is the highest `priority × 10 − distance − angle/45` (ties by handle), nothing outside 2.5 m or 100° is offered, a `hold` prompt begins only after 30 ticks held, and `setEnabled(kind, false)` removes that kind — proof: `pnpm --filter @dv/engine test -- interaction`
- AC-7 Given a car hitting a ped capsule When ΔV is 7 m/s Then the ped becomes dynamic for ≤ 180 ticks and gets up, the car receives the opposite impulse; at 5 m/s no ragdoll starts; with the `mobile` cap of 4 a fifth hit plays the canned fall without a body — proof: `pnpm --filter @dv/engine test -- ragdoll`
- AC-8 Given a recorded 600-tick session When it is saved as a line and replayed Then the RLE round trip is byte-identical, the replay ends with the recorded state hash, and an injected real input stops playback on that tick — proof: `pnpm --filter @dv/engine test -- lines.format`
- AC-9 Given a QA build with the gray-box world in Chromium When the bridge spawns `vehicle.sedan` at the junction, the player enters, plays `walk-drive.line.json`, cycles the five vehicle cameras and exits Then every step reports its expected state, the camera never sits inside a collider, the inspector lists the `Vehicle` component and the physics wireframe toggles — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @vehicle`
- AC-10 Given a QA build with the `synth` world When a sedan spawned on the edge nearest City Hall drives a scripted route over the overpass slab and through the tunnel Then it never falls below `groundY`, stays on the deck while on the slab, exits the tunnel under its hood, and a closed edge shows barrier props at both ends — proof: `pnpm map:build -- --area synth && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @vehicle-world`
- AC-11 Given the branch When the production build is verified and deployed to a Preview Then the inspector, wireframe and line recorder are absent from the production bundle and the Preview passes its header checks — proof: `pnpm build && pnpm --filter @dv/web verify:dist && pnpm deploy:preview`

## Test plan
- **Unit (shared):** `vehicle.powerCurve`, `vehicle.envelope`, `vehicle.step`, `vehicle.damage` (`pnpm --filter @dv/shared test`).
- **Integration (headless Rapier, canonical):** `engine/lines.*` incl. `lines.filbert` (`test:lines`); `vehicle.enter-exit`, `interaction`, `ragdoll`, `lines.format` (`pnpm --filter @dv/engine test`). All run inside `pnpm check:unit`.
- **E2E:** `@vehicle` (gray-box), `@vehicle-world` (`synth`) on `chromium-webgl2`; M01b2 `@fp-tp`, `@touch` and M02 world tags stay green.
- Golden line end hashes and the gear sequence live only in `packages/engine/test/golden/lines.json`, so M00d's `golden-guard` (`**/golden/**`) fails any change to them without the `golden-update` label; `*.line.json` files carry no expected values (DL-549).

## Demo script
1. `pnpm dev`, open `/?debug=1`; enter the parked sedan at the gray-box junction, drive around the block, cycle cameras, exit.
2. `DV_WORLD=synth pnpm dev`; teleport to `lm.lombard-crooked`; spawn a compact and drive down.

## Effort
1 Builder session; about 37 code files (presets, prefabs and lines are data); risk **medium**. Preset tuning and suspension rays against slabs are the main time sinks.

## Risks & fallbacks
- **Oracle windows missed after two tuning passes:** keep the failing preset's numbers, report the measured values per line, and leave the decision on the model (and on Jolt, D-S06-02) to M03a2; do not widen a window.
- **Canonical build slow with 8 vehicles** (U-ENG-2): record tick cost per build in the report; M07a1 sets the per-tier cap.
- **Rays tunnel through 1 m slabs at speed:** cast from the wheel hub plus suspension rest length and keep the 2-substep rule; fallback a sphere cast per wheel.

## Notes for the Builder
- Read first: `06-racing-data.md` §4.1; `06-racing-content.md` C.1–C.3; `01-engine-save-modes.md` "Interaction system", "Entity prefabs"; `01-engine.md` §2.4–§2.6, §2.11.
- Lines run in the `canonical` profile (`@dimforge/rapier3d-deterministic-compat@0.21.0`); interactive play stays `local`.
- Names: fictional makes only; prefab `nameKey`s go through the name registry; `names:lint` and `ip:strings` must stay green.
- Secrets: none. Branch `m03a1-vehicles-interaction-prefabs`.
