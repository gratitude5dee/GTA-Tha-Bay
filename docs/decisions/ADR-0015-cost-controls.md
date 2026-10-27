# ADR-0015 — Cost controls

**Status:** accepted · **Date:** 2026-10-18 · **Decides:** spec/03 D-28, gated decision G3, owner decision DL-OWN-01; R-ENG-03 · **Amended 2026-10-26:** the fal split below is superseded by DL-OWN-07 (spike $4, characters $42, cutscenes $38, vehicles and props $14, buffer $2; `_PLAN.md` §0 rule 5, DL-740, DL-741); the $100 cap and its enforcement stand

## Context
Several vendors bill per use and some cannot be capped by the vendor. fal.ai has no spend cap and locks an account below a balance threshold [F-048]. Cloudflare AI Gateway spend limits are eventually consistent [F-028]. Anthropic caps monthly spend by tier (Start $500) and rate-limits at 1,000 requests per minute on Start [F-037]. ElevenLabs keys accept a monthly `character_limit` [F-052]. List prices: Haiku 5.5 $0.10/$0.50 and Sonnet 5.5 $2/$10 per million tokens [F-034]. On 2026-10-18 the owner fixed the fal budget at **USD 100 total** (DL-OWN-01), replacing the earlier $1,000 one-off figure.

## Options considered
1. **Vendor caps only.** fal offers none, and gateway limits lag.
2. **Dashboards and alerts only.** Detects overspend after the fact.
3. **Three layers, with our ledger authoritative** (chosen): vendor caps, gateway rules, and our own reserve-then-settle ledger that refuses work before it starts.

## Decision
- **Recurring ceiling (G3).** $500 per month (≈ $16.50 per day): Anthropic $350, voice $100, moderation $25, buffer $25. Scaling guide: about $0.25 per MAU; move Anthropic to the Build tier before ≈ 2,000 MAU and Scale before ≈ 8,000 MAU. All values live in `config/guardrails.yaml`, read by the governor, the quota object and a nightly drift check.
- **fal programme cap (DL-OWN-01).** USD 100 total, in integer USD micros: genAI spike (M00c) ≤ $10, characters (M10a) ≤ $42, cutscenes ≤ $40, buffer $8 (`budget_program` and `genai.programCapUsdMicros` = 100,000,000; alarms at 50/80/100 %). Enforcement: a prepaid fal balance of at most $100 with auto-recharge off, `FAL_MODE=mock` by default in development and CI, every paid job needs `--live` and prints a dry-run estimate first, CI never runs live fal. Per DL-171 to DL-180 the baseline funds eight Standard fighters, twelve Lean characters and a priority list of cutscenes that stops at the $40 line; voices, vehicles, props and stand-ins are not fal-funded.
- **No player-triggered fal in v1.** The NPC builder uses creator-kit bodies; the `builder_job` quota is 0 for every tier. Custom 3D for user NPCs passes through an owner-approved staff queue counted against the buffer (DL-175; approver and policy: Q-26).
- **Layer 3 (ours, authoritative).** `PlayerQuotaDO` and `BudgetGovernorDO`: reserve an estimate, call, settle from the vendor's `usage`. Governor levels: L1 at 70 % (heroes drop from Sonnet to Haiku), L2 at 85 % (voice drops to Workers AI tier 1), L3 at 100 % (generative features offline). Kill switches and budget levels never block cache hits: cached cutscenes, cached TTS and baked barks are always served.
- **Per-player quotas per UTC day.** Local or device identity: 150 dialogue turns, 40 per NPC, 60 voiced lines, $0.05; linked 18+: 400 turns, 200 lines, $0.15; user cutscene generation 0.
- **Layer 2 (AI Gateway, Anthropic only).** `gw-dialogue` with caching, Guardrails and DLP off (they buffer SSE), spend rules per day and per `pid` (from the `cf-aig-metadata` header), each answering 429; the Worker re-issues a 429'd Sonnet hero turn once on Haiku (no dynamic route, DL-545 (b)).
- **Layer 1 (vendors).** Separate Anthropic workspaces (runtime, builder, CI evals, synthetic); fal per-use keys with allowed-model lists; ElevenLabs keys with `character_limit`.
- **Reconciliation.** A 5-minute cron compares the ledger with vendor usage APIs; drift above 10 % for two runs raises an alert and the vendor total becomes truth.

## Consequences
- (+) Overspend is refused before the call; the worst case is bounded at $100 of fal plus the monthly ceilings.
- (+) Caches degrade gracefully: the game plays offline paths (ink, in-engine cutscenes, baked barks) when budget closes.
- (−) $100 funds a small generated set; most cutscenes stay in-engine and most roster members use creator-kit bodies.
- (−) Gateway limits and vendor caps lag, so layer 3 must reserve conservatively and can refuse early.
- (−) The Anthropic minimum workspace limit and fal auto-recharge behaviour are UNVERIFIED (U-BE-18, U-BE-19); recharge stays off.

## Affected contracts and milestones
C12 (`PlayerQuota`, `BudgetGovernor` in `packages/shared/src/api/budget.ts`), C07 (`GenJob`, ledger), C16 (spend events). M00c (cap), M05b1 (minimal governor), M06a1 (quotas), M10a1–M10b, M14b1–M14b2 (guardrail tests T1–T9).

## Links
`spec/domains/09-backend-ops.md` §5; `05-assets-pipeline.md` §11; `spec/10-cost-model.md`; `spec/11-decision-log.md` DL-056, DL-068, DL-171–DL-180; `research/gap-observability-cost-guardrails.md`; ADR-GENAI-01, ADR-0014.
