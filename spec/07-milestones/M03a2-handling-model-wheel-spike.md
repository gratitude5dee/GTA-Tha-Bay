# M03a2 — handling-model-wheel-spike

## Goal
After this half session the wheel-force path of the shared handling model is decided on evidence, and the decision is written down. M03a1 shipped `stepHandling` with S06's default path: an own ray-cast vehicle on a dynamic Rapier body (`castRay` per wheel plus `applyImpulse` at the contact point), as `06-racing.md` §7 prescribes while U-RAC-1 is open. This milestone builds the second candidate, an adapter over Rapier's vehicle controller behind the same `PhysicsBackend.vehicle` seam, runs both paths through the M03a1 oracle lines (0–100, braking, skidpad, Filbert climb, crest jump) in the `canonical` profile, measures repeatability and tick cost, and records the result in an ADR. The ADR also carries the C06 1.2 wheel-readout proposal for the Architect (DL-104, wave-5 note 12). The selected path becomes the only one wired into the vehicle system. The contract stays at C06 1.1.

## Requirements
- R-MODE-02: racing feel depends on per-wheel contact data. This milestone fixes how that data reaches `stepHandling`, so story driving (M03a1) and racing (M07a1) share one proven path.
- R-PLAT-03: the decision keeps Rapier WASM as the physics engine behind the `PhysicsBackend` seam (D-S06-02). The deterministic builds stay in use.

## Depends on
- **M03a1** (vehicles-interaction-prefabs): `packages/shared/src/vehicle/` (`stepHandling`, presets `hp.*`, `CLASS_ENVELOPE`), `packages/engine/src/sim/vehicle/` (vehicle system, castRay path), the lines recorder and the `@dv/engine` script `test:lines` with the C.3 oracle lines.
- Through M03a1: M01a2 (Rapier wrapper, both builds `simd-compat` and `deterministic-compat`, `PhysicsBackend`).
- Contracts: C06 1.1.0 (a 1.2 change is only proposed here), C02 1.1.0, C03 1.1.0 (`prompt-pack/06-SHARED-CONTEXT.md` v1.1 §4.2).

## Scope in
- A `WheelPath` seam in the engine vehicle system: `interface WheelPath { attach(v): void; readContacts(v, out: WheelContact[4]): void; apply(v, o: HandlingOutput): void; detach(v): void }`. It has two implementations:
  - `castray` (M03a1's code moved behind the seam, behaviour unchanged);
  - `controller`, which creates the vehicle through `PhysicsBackend.vehicle.create`, drives it through `drive()`, fills S06 `WheelContact` from `vehicle.read()` and applies `HandlingOutput.wheelForce` either through the controller's own inputs or as external impulses.
- An engine-internal layout for `PhysicsBackend.vehicle.read(v, out: Float32Array)`, documented in `backend.ts`. Per wheel it holds: `inContact`, the contact point (3), the normal (3), `suspLenM`, `vLong`, `vLat` and `loadN`; 11 floats × 4 wheels. Slots the controller cannot provide are filled with `NaN` and listed as such in the spike report. The layout is not a contract. Promoting it to C06 is the ADR's proposal.
- A probe step. Read the installed Rapier package's TypeScript declarations (the version M01a2 pinned, F-014) and list which per-wheel getters exist. The adapter calls only methods present in those declarations. Never call an undocumented name found on the web.
- A spike harness `packages/engine/test/wheel-spike.spec.ts`. For each path (`castray`, `controller`), each build and each oracle line it runs the line 3 times in `canonical`. It records:
  - the oracle values and pass/fail per M03a1 AC-3/AC-4 tolerance;
  - whether the 3 final pose hashes are equal;
  - mean and p99 `PhysicsPre` + `PhysicsStep` cost per tick (Node, informational);
  - the readout completeness.

  It writes `test-results/wheel-spike.json`.
- Decision rule (written into the ADR before the run, so the result cannot steer it). Choose `controller` only if all of the following hold:
  - (a) every `WheelContact` field is readable without `NaN`;
  - (b) external forces reach the body, so every oracle that M03a1 AC-3 and AC-4 define for the preset (C.1 class targets, C.3.0 shared-row oracles; the Filbert climb with `hp.sedan`) passes within its tolerance for `hp.sedan`, `hp.police-cruiser` and `hp.robotaxi-ambient` (one preset each from the D, police and R envelopes; the C.3.1–C.3.3 race presets arrive only in M07a1, DL-249);
  - (c) all 3 runs give equal hashes on each build;
  - (d) mean tick cost is ≤ 1.2 × the castray path.

  Otherwise keep `castray`. A tie keeps `castray`.
- `packages/shared/src/vehicle/wheel-path.ts` exports `SELECTED_WHEEL_PATH: 'castray' | 'controller'`. The vehicle system reads it and the losing implementation is deleted. Its harness result stays in the ADR and the JSON.
- The ADR `docs/decisions/ADR-0031-vehicle-wheel-force-path.md` (§E format, ≤ 800 words; number reserved in `docs/decisions/README.md`, DL-242). It records U-RAC-1 as verified or refuted, the decision table and the C06 1.2 proposal (`PhysicsBackend.vehicle` readout layout plus `applyWheelForces(v, forces)` as an additive member). The proposal is marked `proposed`. Also add a row to `docs/decisions/README.md` and a `BD-NNN` row in `spec/11-decision-log-builder.md` under "Builder decisions" (DL-341).

## Scope out
- Any edit of `c06-modes.ts` or other contract files: the Architect decides the 1.2 bump.
- Tuning the presets beyond what M03a1 left: the M03a1 tuning pass owns C.3 starting values; the M07a1 feel review may retune.
- Jolt `WheeledVehicleController` (D-S06-02 fallback). It is evaluated only if both paths fail the oracles; then this milestone stops and reports.
- Nitro, quirks, assists beyond steer assist, damage tuning, replay (M07a1, M07a2, M07b1).
- U-RAC-2 tick cost with 8 M1 vehicles (M07a1) and U-RAC-3/4 (M07a2, M07b2).

## Deliverables
- `packages/engine/src/sim/vehicle/wheel-path.ts` (seam), `wheel-path-castray.ts` (moved code), `wheel-path-controller.ts` (deleted after the decision if it loses; its source stays in the PR history).
- `packages/engine/src/sim/physics/backend.ts` and its Rapier implementation: the documented `vehicle.read` layout. Doc comment only: no signature change.
- `packages/shared/src/vehicle/wheel-path.ts` (`SELECTED_WHEEL_PATH`).
- `packages/engine/test/wheel-spike.spec.ts`, `packages/engine/test/wheel-spike.adr.spec.ts` (the ADR's `Decision:` line equals `SELECTED_WHEEL_PATH` and the JSON's `selected`).
- `packages/engine/package.json` script **`test:wheel-spike`** (`vitest run test/wheel-spike`). `pnpm check:unit` includes it, so check the vitest workspace globs.
- `docs/decisions/ADR-0031-vehicle-wheel-force-path.md`, its row in `docs/decisions/README.md` (status from reserved to accepted), `spec/11-decision-log-builder.md` (Builder decision row), and a dated note in `spec/03-decisions-and-facts.md` §6 row M03a2 stating that U-RAC-1 is resolved and pointing to the ADR.
- About 10 files.

## Interfaces
- C06 1.1: unchanged. The ADR carries a **proposed** C06 1.2 member (`vehicle.read` layout, `applyWheelForces`) for the Architect; nothing is coded against an unaccepted 1.2.
- S06 types `WheelContact`, `HandlingOutput`, `WheelForce` (`06-racing-data.md` §4.1) are consumed verbatim from M03a1.
- Engine service `PhysicsBackend` (not a numbered contract): the signature is unchanged and only the `read` buffer layout is documented.

## Acceptance criteria
- AC-1 Given M03a1's vehicle system When it runs behind the new `WheelPath` seam with `castray` selected Then every M03a1 oracle line still passes and the Filbert line ends at an identical pose over 3 runs — proof: `pnpm --filter @dv/engine test:lines`
- AC-2 Given both builds When the spike harness runs each path over the five oracle lines for the three presets `hp.sedan`, `hp.police-cruiser` and `hp.robotaxi-ambient`, 3 runs each, in `canonical` Then `test-results/wheel-spike.json` lists, per path, build, preset and line: the oracle values, the pass/fail against the M03a1 AC-3/AC-4 tolerances (lines without a tolerance for that preset are recorded as informational), the hash equality across runs, the mean and p99 tick cost, and the readout completeness. It also lists `selected` computed by the decision rule. The `castray` rows all pass and repeat exactly — proof: `pnpm --filter @dv/engine test:wheel-spike`
- AC-3 Given the spike result When the ADR is written Then it records U-RAC-1 (verified or refuted, with the readout table), states the decision rule, and has a `Decision:` line equal to `SELECTED_WHEEL_PATH` and to the JSON's `selected`. The test fails if any of the three disagree — proof: `pnpm --filter @dv/engine test:wheel-spike`
- AC-4 Given the decision When the vehicle system boots Then only the selected implementation is reachable: no import of the losing file remains, and the lint and type gates pass — proof: `pnpm lint && pnpm typecheck && pnpm --filter @dv/engine test:lines`
- AC-5 Given the shared package When its tests run Then `vehicle.powerCurve` and `vehicle.envelope` still pass for every first-party profile — proof: `pnpm --filter @dv/shared test`
- AC-6 Given the branch When the unit suite, the build and the preview deploy run Then all pass and the deployed app behaves as after M03a1 — proof: `pnpm check:unit && pnpm build && pnpm deploy:preview`

## Test plan
- **Unit/line:** `engine/lines.*` (accel, brake, skidpad, filbert, crest), run with `pnpm --filter @dv/engine test:lines`.
- **Spike:** `engine/wheel-spike.matrix` and `engine/wheel-spike.adr`, run with `pnpm --filter @dv/engine test:wheel-spike`. Both run under `pnpm check:unit`.
- **Shared:** `shared/vehicle.powerCurve`, `shared/vehicle.envelope`, run with `pnpm --filter @dv/shared test`.
- No browser or device check: the decision is Node-side. Cross-browser equality of the selected path is proven again by M07a1's `@racing-det`.

## Demo script
1. `pnpm --filter @dv/engine test:wheel-spike`: the matrix prints, one row per path × build × preset × line.
2. Open `test-results/wheel-spike.json`: see `selected` and the reason codes (a)–(d).
3. Open the ADR: the U-RAC-1 result and the C06 1.2 proposal.
4. `pnpm --filter @dv/engine test:lines`: the selected path passes the oracle lines.

## Effort
1 Builder session at half load (0.5 in `_PLAN.md`); about 10 files; risk **medium**. The unknown is how much of the controller's per-wheel state the pinned Rapier build exposes.

## Risks & fallbacks
- **The controller exposes no per-wheel contact data** (the U-RAC-1 default case). (a) fails, the decision is `castray`, and the ADR records the refutation. Nothing else changes, because M03a1 already runs on `castray`.
- **External impulses fight the controller's own suspension** (double-counted forces). Apply forces only through the controller's engine and brake inputs, record the oracle misses, and let rule (b) decide.
- **The `deterministic-compat` build behaves differently from `simd-compat`.** Rule (c) is evaluated per build, never across builds (different builds may differ by design, ADR-0011). Report any cross-build difference as information.
- **Both paths fail an oracle.** Stop. Keep `castray`, record the failing lines in the ADR and the report, and propose a tuning item for M07a1. Do not loosen a C.3 tolerance.

## Notes for the Builder
- Read first: `06-racing.md` §2.2–§2.4 and §7 (U-RAC-1 row); `06-racing-content.md` C.3; `06-racing-data.md` §4.1; `01-engine-contracts.md` "Engine service interfaces"; `01-engine-save-modes.md` "C05 1.1 and C06 1.1 additions" (the engine vehicle readout rule); `docs/decisions/ADR-0011-physics-and-determinism.md`; DL-104.
- Facts: F-014 (Rapier 0.21.0, deterministic build, `DynamicRayCastVehicleController` exists). The per-wheel getters are **not** documented (`06-racing.md` §7), so take method names only from the installed package's `.d.ts`. If a getter you need is absent, that is a result to record, not a gap to fill by guessing.
- Order of work: seam and moved castray code (AC-1 green), harness, controller adapter, run, ADR, delete the loser, ADR test.
- Write the decision rule into the ADR draft before the first matrix run.
- Tick-cost numbers are Node, informational and machine-dependent. Never write them into an acceptance criterion or a budget; the ADR quotes them with the machine description.
- ADR numbering: 0031 is reserved for this ADR (DL-242). The test still finds the file by the glob `ADR-*-vehicle-wheel-force-path.md`.
- Secrets: none for code. `pnpm deploy:preview` needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Without them it prints the SKIP line and exits 0 locally; CI runs it. No genAI spend.
