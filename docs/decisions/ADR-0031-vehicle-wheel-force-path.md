# ADR-0031 — Vehicle wheel-force path

**Status:** draft (decision rule written before the first matrix run) · **Date:** 2026-10-20 · **Decides:** U-RAC-1; M03a2

## Context
M03a1 ships `stepHandling` on S06's default path: an own ray-cast vehicle on a dynamic Rapier body (`castRay` per wheel, `applyImpulse` at the hub). `06-racing.md` §7 kept the alternative open as U-RAC-1: an adapter over Rapier's `DynamicRayCastVehicleController` (F-014, Rapier 0.21.0). One path must be wired into the vehicle system, because story driving (M03a1) and racing (M07a1) share it.

## Options considered
1. **`castray`**: four `castRay` calls, `suspensionForce` from S06, tyre forces and load applied as impulses at the hubs.
2. **`controller`**: the controller casts the rays and carries the suspension; its per-wheel state is read through `PhysicsBackend.vehicle.read`; tyre forces from `stepHandling` are applied as external impulses (the controller's own engine, brake and side-friction inputs are off, because they would count the grip twice).

## Decision rule (fixed before the first run)
Choose `controller` only if all hold; otherwise keep `castray`; a tie keeps `castray`:
- (a) every `WheelContact` field is readable from the controller without `NaN`;
- (b) every oracle of M03a1 AC-3/AC-4 that has a tolerance for the preset passes for `hp.sedan`, `hp.police-cruiser` and `hp.robotaxi-ambient` on both Rapier builds;
- (c) the 3 runs of every line give equal final state hashes on each build (never compared across builds, ADR-0011);
- (d) mean tick cost is at most 1.2 times that of `castray` on each build.

## Decision
Decision: PENDING

## Consequences
PENDING
