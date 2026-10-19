# M99 — good-ready

## Goal
A fixture milestone in the C15 format. After this session nothing exists that did not before; the file only feeds the lint tests.

## Requirements
- R-ENG-01: the fixture is one deterministic `pnpm` command.

## Depends on
- **M00:** `tools/ci/run.ts`.
- Contracts: C15 1.1.

## Scope in
- A lint fixture.

## Scope out
- Everything else.

## Deliverables
- `tools/ci/fixtures/milestones/good-ready.md`.
- Root script **`fixture:run`** (real).

## Interfaces
- C15 1.1 (DL-214), no shape change.

## Acceptance criteria
- AC-1 Given a clean clone When install, lint and unit tests run Then all exit 0 — proof: `pnpm install --frozen-lockfile && pnpm lint && pnpm check:unit && pnpm no-such-script`
- AC-2 Given the fixture script, the following hold — proof: `pnpm fixture:run`:
  - it prints one line;
  - it exits 0.
- AC-3 Given a headset When the operator walks the scene Then the HUD shows the tier — proof: manual: Quest 3, open the preview URL and read the HUD.

## Test plan
- Unit: `pnpm check:unit -- tools/ci`.

## Demo script
1. Run the lint over this directory.

## Effort
1 session; ≈ 3 files; risk low.

## Risks & fallbacks
- None; a fixture.

## Notes for the Builder
- Read nothing; this is a fixture.
