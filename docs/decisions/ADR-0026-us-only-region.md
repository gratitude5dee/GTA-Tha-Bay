# ADR-0026 — US-only region and geo-gate

**Status:** accepted · **Date:** 2026-10-18 · **Decides:** spec/03 A-10; research constraint 23

## Context
EU AI Act Article 50 transparency duties (deepfake disclosure, machine-readable marking) have applied since 2026-08-02, and the EU Digital Services Act and UK Online Safety Act add moderation and reporting processes [research/legal-ip-likeness.md §P7, L-R20]. The H3 video model licence excludes the EU, the UK and South Korea as well as the USA [F-041]. California AB 1043 age signals are a US rule (ADR-0014). The team has no compliance pass for EU or UK users, and the game ships AI-generated cutscenes and AI characters.

## Options considered
1. **Global launch.** Needs AI-label and C2PA export features, DSA and OSA processes and an EU/UK privacy review before day one.
2. **Block everything outside the US at the CDN.** Also blocks takedown requesters, which would make DMCA and NCII intake non-compliant.
3. **Gate play-time online features by country at the Worker, keep legal intake open, keep single-player offline-capable** (chosen).

## Decision
- **Gate.** `request.cf.country ∉ GEO_ALLOW` (Worker variable, default `"US"`) returns `451 region_blocked` on every `/api/v1/*` route except `/api/v1/health`, `/api/v1/boot` (answers `200` with `region: 'blocked'`), `/api/v1/legal/*` and `/.well-known/*`. Routes whose credential is a vendor signature, a shared-secret HMAC or a staff scope are exempt too, because they carry no player geography (DL-184). A missing country (local dev) counts as allowed. The gate lands in M00a.
- **Client.** `BootConfig.region === 'blocked'` hides online pages and shows the `region-blocked` error only there; offline single-player from the PWA cache still starts, because single-player never depends on the network (ADR-0006). Telemetry from blocked regions is refused (`/t` → 451).
- **Legal intake stays open worldwide** so takedown and NCII requesters anywhere can file (DMCA agent path, TAKE IT DOWN 48-hour removal [F-066]).
- **Lifting the gate** is a later milestone: AI-label and machine-readable marking on exported media, DSA and OSA processes, telemetry consent rework (DL-140 says "revisit before EU/UK"), counsel review (Q-23), and a video provider whose licence covers the territory (ADR-GENAI-01).
- **Test.** `pnpm check:workers -- geo-gate` runs the Workers test with `cf.country = 'FR'` (`/boot` blocked, legal route not 451) and `'US'`; `/api/v1/_test/echo-country` exists only on non-production builds for preview checks.

## Consequences
- (+) Defers EU/UK compliance without blocking legal intake; the gate is one Worker rule and one config value.
- (+) The video licence question narrows to a US-only use.
- (−) Country is a CDN estimate; VPN users can reach online features; this is a residual v1 risk for counsel to weigh (Q-23).
- (−) Players abroad get an offline-only game, and cloud saves and rooms are unavailable to them.
- (−) Static asset requests are not geo-gated, so the shell loads everywhere.

## Affected contracts and milestones
C12 (`BootConfig.region`, `region_blocked` error, geo column in the route table), C16 (blocked telemetry). M00a (gate), M04b1 (error page, gating of online pages), M13d1 (legal routes exempt), M14b (counsel review).

## Links
`research/legal-ip-likeness.md` §P7; `research/INDEX.md` §4 rule 23; `spec/domains/09-backend.md` row 5, §5.3; `spec/07-milestones/M00a-edge-api-skeleton.md`; `spec/11-decision-log.md` DL-140; ADR-0014, ADR-GENAI-01.
