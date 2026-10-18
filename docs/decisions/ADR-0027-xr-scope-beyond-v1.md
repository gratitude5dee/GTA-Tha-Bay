# ADR-0027 — XR scope beyond v1

**Status:** proposed (deferred; decide after the M11b device passes) · **Date:** 2026-10-18 · **Decides:** DL-029, D-S01-06, DN-S11-06, the "revisit Quest native WebGPU XR at M11b" note in D-07

## Context
v1 XR is `immersive-vr` only on Meta Quest 3/3S and Apple Vision Pro (R-PLAT-02). Several extensions were designed out of v1 because their platform support or comfort cost is not verified: passthrough AR on visionOS (U-PLT-11), full-body avatars, Quest's native WebGPU XR path (experimental in Quest Browser, and r186's native WebGPU XR has no multiview) [F-002, F-005], and PC VR or Quest Link. The C04 `XRRigParams.session` union reserves `'immersive-ar'` for this ADR.

## Options considered
1. **Ship extensions in v1.** Adds UNVERIFIED capabilities to acceptance criteria, which C15 forbids.
2. **Remove the reserved union member.** Makes a later AR addition a breaking C04 change.
3. **Keep the reservation; decide each extension with device evidence** (proposed).

## Decision (proposed)
Each extension is decided separately, after the M11b1 and M11b2 device checklists and perf passes produce evidence:
- **`immersive-ar` on visionOS** (tycoon desk, fighter tabletop): requires a verified session type, a comfort review and a C04 minor bump that activates the reserved member.
- **Full-body IK** (D-S01-06, Q-ENG-05): default stays hands with forearm IK; full body needs its own comfort and cost study.
- **Quest native WebGPU XR**: switch only if Quest Browser ships it by default and the budgets in C13 improve against the WebGL2-with-multiview path [F-013].
- **PC VR and Quest Link**: best effort on the `xr-quest` tier, never in acceptance (DN-S11-06). PS VR2 controllers as WebXR inputs are out of scope.
- **Text entry in XR** stays flat-only ("Exit VR to continue", DL-142).

Until accepted, v1 defaults apply: `immersive-vr` only, Quest on the WebGL2 backend with multiview, Vision Pro native WebGPU XR with a WebGL2 fallback (ADR-0010).

## Consequences
- (+) v1 acceptance stays free of unverified XR claims.
- (+) The reserved union member keeps the later change additive.
- (−) No AR table-top experiences at launch.
- (−) The decision waits on hardware (Q-13) and on platform changes outside our control.

## Affected contracts and milestones
C04 (`XRRigParams.session`, `origin`), C13 (XR services), C03 (XR binders). Decision after M11b1–M11b3; any extension becomes new milestones in the register.

## Links
`spec/domains/01-engine-contracts.md` (C04); `11-platform-xr.md`; `spec/99-open-questions.md` U-PLT-10…U-PLT-12; `spec/11-decision-log.md` DL-029, DL-142; ADR-0010.
