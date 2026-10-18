# ADR-0025 — CI/CD and release

**Status:** accepted · **Date:** 2026-10-18 · **Decides:** spec/03 D-27; R-ENG-01, R-ENG-02

## Context
Every milestone is one pull request built by an agent, so correctness must be provable by deterministic commands. The product ships to Cloudflare Workers, where each deploy restarts the deployed script's Durable Objects [F-020], previews use production resources for bindings they do not override [F-061], and Cloudflare has no CI OIDC, so tokens are long-lived credentials [research/gap-ci-cd-release-assets.md §1.3]. CI machines have no real GPU or headset: SwiftShader can run WebGPU headless, Playwright WebKit on Linux has no `navigator.gpu` or `navigator.xr`, and IWER 2.6.0 emulates Quest sessions for three.js [F-062].

## Options considered
1. **Manual deploys from a laptop.** No audit trail; no rollback discipline.
2. **Direct 100 % deploys.** A bad version reaches everyone and restarts rooms.
3. **GitHub Actions with versioned uploads, a smoke gate at 0 %, a gradual rollout and a rollback script** (chosen).

## Decision
- **Pipelines.** `ci.yml` (lint, typecheck, unit, workers tests, build, bundle and header checks, `chromium-webgl2` smoke, the IP job), `preview.yml` (a Workers Preview per same-repo pull request, URL commented on the PR; `check:headers` and `check:coi` run against it), `deploy.yml` (staging on every merge to `main`; production from tags by an allowlisted actor until a Team org or public repo exists, Q-15). Scripts are the `pnpm check:*` vocabulary (DL-036) so an agent and CI run the same commands.
- **Deploy.** `wrangler versions upload` → deploy at 0 % → smoke with a version-override header (`check:smoke`) → 100 % (gradual 10/50/100 with health gates on production) → automatic rollback on failure (`deploy:rollback`). Database migrations run before the code that needs them (`db:push`).
- **Durable Object lifecycle.** A change to DO classes or migrations ships alone through `wrangler deploy`; `check:do-migrations` fails a pull request that mixes it with other runtime code and labels it `do-lifecycle`. Rooms live in their own Worker with a drain notice before deploys (ADR-0004).
- **Playwright projects.** `chromium-webgpu` (SwiftShader, non-gating), `chromium-webgl2` (the guaranteed path), `webkit-webgl2`, `xr-quest3` (IWER installed before the renderer, `forceInstall: true` on Chromium). Device-only truths (real WebGPU, iOS memory, Quest and Vision Pro frame times) are recorded by device runs, not asserted in CI.
- **Perf in CI.** `check:perf` asserts CPU-side budgets (render objects, draw calls, triangles, textures, heap) on canned camera paths; it makes no frames-per-second assertions on SwiftShader. Device perf JSON is verified offline with `perf:verify`.
- **IP and provenance.** The `ip` job (provenance, signatures, extensions, strings, license scan, names, likeness gates) is required for merge from M00b.
- **Assets.** `assets:publish` uploads with rclone to R2 (S3 endpoint), verifies by `HEAD`, then writes the immutable catalog and the pointer last (ADR-0020).
- **Secrets.** Expiring account API tokens split by duty (deploy, R2, previews); repository secrets named in `CLAUDE.md`; Worker secrets ride with versions (`--secrets-file`); `check:secrets` scans the tree and `apps/web/dist`. No live fal call in CI (ADR-0015).
- **Previews.** Workers Previews have no queue consumers, crons or own Workflows, service bindings call production, and bindings are not inherited and must be repeated under `previews`; queue, cron and Workflow behaviour is tested in Workers-runtime tests and on staging.

## Consequences
- (+) Every acceptance criterion is a command; rollbacks are one command; rooms survive web releases.
- (+) The same scripts run locally, in agents and in CI.
- (−) Real-device behaviour cannot gate merges; milestones with device criteria record checklist output instead.
- (−) Long-lived tokens are a standing risk; they are scoped and rotated by the operator.
- (−) `wrangler@4.151.1` config keys for workflows, containers, analytics and previews are UNVERIFIED (U-BE-3, U-AST-6); M00 validates them against the schema.

## Affected contracts and milestones
C13 (`PerfScenario`, `QaFlags`), C15 (proof commands), C16. M00 (workflows, projects), M00a (`deploy:prod`, `check:*`), M00b (IP job), M01d (publish), M11a (nightly perf fail mode), M12c (drain), M14b (gradual rollout default).

## Links
`research/gap-ci-cd-release-assets.md`; `spec/domains/09-backend-ops.md` §2; `11-platform-perf.md`; `prompt-pack/06-SHARED-CONTEXT.md` §5; `spec/11-decision-log.md` DL-036, DL-074; ADR-0001, ADR-0020.
