# ADR-0001 — Package layout

**Status:** accepted · **Date:** 2026-10-18 · **Decides:** spec/03 A-01 (with the DL-035, DL-156 and DL-165 amendments)

## Context
One Builder session per milestone must find its files without searching. The mod SDK must be publishable on its own (Q-22). Room Durable Objects must not restart when the UI deploys: every deploy restarts the deployed script's Durable Objects and drops their sockets [F-020]. Pure logic (tycoon `verifyRun`, racing replay checks, soul compiler, C08 codec, asset gates) must run identically in the client, in Workers and in CI.

## Options considered
1. **One app package.** Simplest, but the mod SDK cannot be published alone, the rooms Worker cannot deploy separately, and sim code cannot be kept free of DOM and `three` imports by structure.
2. **Polyrepo** (game, services, SDK). Cross-repo contract changes would need version juggling; the Builder works one milestone per branch, which a monorepo serves better.
3. **pnpm workspaces monorepo with a strict dependency direction** (chosen). Toolchain pins per F-016; pnpm per [research/gap-ci-cd-release-assets.md].

## Decision
A pnpm workspaces monorepo. The authoritative tree is `spec/02-architecture.md` §2 and `prompt-pack/06-SHARED-CONTEXT.md` §5; in outline:

- `apps/web` (PWA shell). `packages/{shared, engine, world, net, identity, npc, ui, mod-sdk, modes/{story,racing,fighter,tycoon}}`. `services/{edge, rooms, pipeline}`. `tools/{map, assets, ci, cli, ops, soul, fighter}`. Root `config/`, `content/`, `assets/`, `supabase/`, `tests/`, `docs/`, `spec/`, `research/`, `prompt-pack/`, plus the private `content-private/` mount (Q-25).
- **Amendments.** v1 (DL-035): `packages/identity`, `tools/ops`, `content/`, `assets/`, `supabase/`, `tests/` added; `tools/cutscenes` merged into `tools/assets`; guardrails live in `config/guardrails.yaml`. v1.1 (DL-156): `tools/soul`, `tools/fighter` (QA-only, never in production builds) and `content-private/` added. DL-165: mod examples live in `packages/mod-sdk/examples/mods/`, CI reports in `tests/reports/`, `knowledge/` is a creator-workspace path.
- **Dependency direction.** Apps import packages; packages never import apps. Every package may import `@dv/shared`; `@dv/shared` imports nothing and does no IO (DL-009), so sim code can depend on it. `services/*` import only `@dv/shared` and `@dv/net`. C11 lives in `packages/net/src/protocol/**` as the one contract outside `@dv/shared` (DL-055). Identity token types live in `packages/shared/src/identity.ts`; `@dv/identity` is client-only (DL-055).
- **Names.** `@dv/<dir>`, `@dv/mode-<id>`, `@dv/web`, `@dv/edge`, `@dv/rooms`, `@dv/pipeline`, `@dv/cli` (binary `dv`). Root gates are `pnpm check:*` (DL-036).
- **Separate rooms Worker.** `services/rooms` deploys as `tha-bay-rooms`, so UI and API releases never restart rooms (ADR-0004).
- **Real-derived content.** Souls and research for real people live only in `content-private/`; `content/` holds original data.

## Consequences
- (+) Structure enforces purity: the C02 determinism lint covers `packages/shared/**`, `packages/engine/src/sim/**` (except `sim/save/**`) and `packages/modes/*/src/sim/**`.
- (+) The SDK, CLI and rooms Worker publish or deploy alone.
- (−) Eleven packages and three services mean many `tsconfig` references; M00 must set up project references and the `check:*` aliases once.
- (−) A mistaken import direction is a lint failure, not a compile error, until the dependency-direction rule is wired in M00.
- (−) `content-private/` is empty until the owner creates the repository (Q-25); CI must pass without it.

## Affected contracts and milestones
All contracts (C01–C17 file locations follow this tree). M00 creates the tree and scripts; M00a `services/edge`; M05b `services/pipeline`; M06a2 `tools/soul`; M08a1 `tools/fighter`; M10c `content-private/` content; M12b1 `services/rooms`; M13a1 `packages/mod-sdk`.

## Links
`spec/03-decisions-and-facts.md` A-01; `spec/02-architecture.md` §2; `prompt-pack/06-SHARED-CONTEXT.md` §5; `spec/11-decision-log.md` DL-009, DL-035, DL-036, DL-055, DL-156, DL-165, DL-200 (the ADR set).
