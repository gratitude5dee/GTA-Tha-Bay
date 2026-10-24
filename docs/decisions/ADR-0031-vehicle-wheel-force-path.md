# ADR-0031 — Vehicle wheel-force path

**Status:** accepted · **Date:** 2026-10-20 · **Decides:** U-RAC-1; M03a2

## Context
M03a1 ships `stepHandling` on S06's default path: an own ray-cast vehicle on a dynamic Rapier body (`castRay` per wheel, `applyImpulse` at the hub). `06-racing.md` §7 kept the alternative open as U-RAC-1: an adapter over Rapier's `DynamicRayCastVehicleController` (F-014, Rapier 0.21.0). One path must be wired into the vehicle system, because story driving (M03a1) and racing (M07a1) share it.

## Options considered
1. **`castray`**: four `castRay` calls, `suspensionForce` from S06, tyre forces and load applied as impulses at the hubs.
2. **`controller`**: the controller casts the rays and carries the suspension; its per-wheel state comes through `PhysicsBackend.vehicle.read`; tyre forces from `stepHandling` are applied as external impulses (the controller's own engine, brake and side-friction inputs are off, because they would count the grip twice). The rest length is `restM + g / (2 pi f)^2` so the car sits at `restM`.

## Decision rule (fixed before the first run)
Choose `controller` only if all hold; otherwise keep `castray`; a tie keeps `castray`:
- (a) every `WheelContact` field is readable from the controller without `NaN`;
- (b) every oracle of M03a1 AC-3/AC-4 that has a tolerance for the preset passes for `hp.sedan`, `hp.police-cruiser` and `hp.robotaxi-ambient` on both Rapier builds;
- (c) the 3 runs of every line give equal final state hashes on each build (never compared across builds, ADR-0011);
- (d) mean tick cost is at most 1.2 times that of `castray` on each build.

## U-RAC-1 result: verified for the getters, refuted for the readout
The installed `@dimforge/rapier3d-*-compat` 0.21.0 declarations (`control/ray_cast_vehicle_controller.d.ts`) were read before any adapter code. The per-wheel getters exist: `wheelIsInContact`, `wheelContactPoint`, `wheelContactNormal`, `wheelSuspensionLength`, `wheelSuspensionForce`, `wheelForwardImpulse`, `wheelSideImpulse`, `wheelRotation`, `wheelGroundObject`. No getter gives the velocity of the wheel at the contact point.

| `vehicle.read` slot (11 floats per wheel) | Source | Readable |
|---|---|---|
| 0 inContact | `wheelIsInContact` | yes |
| 1..3 contact point | `wheelContactPoint` (local f32, plus origin) | yes |
| 4..6 normal | `wheelContactNormal` | yes |
| 7 suspLenM | `wheelSuspensionLength` | yes |
| 8 vLong, 9 vLat | none | **NaN** |
| 10 loadN | `wheelSuspensionForce` | yes |

Rule (a) fails: 8 of 44 slots are `NaN`. The adapter can derive vLong and vLat from the body velocity, as `castray` does, but that is not the controller giving them.

## Spike result
Matrix: 2 paths x 2 builds x 3 presets x 5 lines x 3 runs, `canonical` profile, `test-results/wheel-spike.json` (committed copy `packages/engine/test/golden/wheel-spike.json`). Machine: Linux, Intel Xeon 2.80 GHz x4, Node 22.22.0; tick cost is the wall-clock of one whole sim tick, informational.

| Rule | Result |
|---|---|
| (a) readout complete | **fail**, 8/44 slots NaN |
| (b) oracles | pass, with the adapter deriving vLong/vLat itself: all rows with a tolerance are inside it on both builds |
| (c) repeatability | pass, equal hashes in every row on both builds |
| (d) tick cost | pass, controller/castray 0.74 (`deterministic-compat`) and 0.99 (`simd-compat`); mean 0.087 vs 0.117 ms and 0.098 vs 0.099 ms; noise level |

`castray` rows all pass and repeat exactly. Informational rows differ: on the 31.5 % Filbert grade the police cruiser climbs 26 m with `controller` and stays at the foot with `castray`; the robotaxi crest jump costs 41 % damage with `controller` (one bounce) and none with `castray`. No tolerance covers those presets, so the rule ignores them, but the paths are not interchangeable without retuning.

Observed while building the adapter: the controller reports ground only within its rest length plus the wheel radius (setting a larger max travel did not lengthen the ray), so a wheel cannot droop below the rest length in flight, where the `castray` ray reaches rest + travel + radius. The adapter sets the rest length to `restM + g / (2 pi f)^2` to keep the ride height.

Decision: castray

## Consequences
- `SELECTED_WHEEL_PATH = 'castray'`; the vehicle system builds `CastrayWheelPath` only. The adapter moved to `packages/engine/test/wheel-path-controller.ts` and is not reachable from `src`; `wheel-spike.spec.ts` re-runs the comparison from it.
- `PhysicsBackend.vehicle.create/drive/read` are implemented over the Rapier controller and the `read` layout above is documented in `backend.ts`; `tuneVehicle` is an engine-internal widening on `VehiclePhysics`. Nothing in `src` calls them.
- Only rule (a) blocked `controller`; the spike re-runs unchanged if Rapier exposes wheel-point velocity.

## Proposed for the Architect: C06 1.2 (status: proposed)
Not coded against; `c06-modes.ts` is untouched.
- `PhysicsBackend.vehicle.read(v, out)` layout: 11 floats per wheel as in the table, wheels in `create` order, NaN for a slot the backend cannot provide.
- Additive member `applyWheelForces(v: number, forces: readonly { long: number; lat: number }[]): void`: external tyre forces at the wheel contact points, so a controller-backed vehicle does not need `applyImpulse` per wheel.
