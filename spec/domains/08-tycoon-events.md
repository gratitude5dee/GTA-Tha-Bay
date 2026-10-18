# 08 — Business Tycoon, part C: random-event engine, event catalog and the Monte-Carlo balance tool

> S08, Wave 3, 2026-10-18. Part of `spec/domains/08-tycoon.md`; finance is part B (`08-tycoon-finance.md`). The engine here is **shared**: Tycoon and the story's buyable businesses (gamedesign §2.9, §5.6) run the same code. Probabilities, impacts and bands are *design* values unless a row cites the ledger; the harness (§8) is what makes them testable.

## 1. Scope and placement
R-IDs: R-MODE-04 (random-event engine with probability and impact model; business, political, natural and cultural families), R-ENG-04 (pause-on-event accessibility), R-IP-01 (fictional entities only).

| Piece | Path | Notes |
|---|---|---|
| Generic engine, types, distributions, predicates, counter RNG | `packages/shared/src/events/**` | pure; C02 lint applies; imported by `@dv/mode-tycoon`, `@dv/mode-story` (S03) and `tools/ci/tycoon-sim` |
| Tycoon host (`TycoonEventHost`) and content loader | `packages/shared/src/tycoon/events/**` | maps `MetricId` onto `CompanyState` |
| Authored content | `content/tycoon/events/{business,political,natural,cultural,market}.json` | JSON, schema-validated at build; no code in content |
| Card strings / art | `LocKey` `tycoon.ev.<id>.{title,body}`, `tycoon.ev.<id>.c.<choice>`; art `ui/ty-card-<id>` (C07 kind `ui`) | art by S05, text by S10 localization |
| Balance tool | `tools/ci/tycoon-sim/**` | CLI, bots, bands, baseline (§8) |

The engine knows nothing about cap tables or the UI. It exposes `roll`, `choose`, `tickEffects`, and a deterministic list of `ActiveEffect`s.

## 2. Types

```ts
// packages/shared/src/events/types.ts
export type EventFamily = 'business' | 'political' | 'natural' | 'cultural' | 'market' | 'system';
export type MetricId =
  | 'cash' | 'users' | 'hype' | 'reputation' | 'morale' | 'founderMorale' | 'techDebt' | 'climate'     // stocks: applied once
  | 'cacMul' | 'churnMul' | 'arpuMul' | 'payRateMul' | 'devPowerMul' | 'burnMul' | 'multipleMul' | 'wageMul';  // modifiers: applied each week while active
export type Dist =
  | { k: 'fixed'; v: number }
  | { k: 'uniform'; lo: number; hi: number }
  | { k: 'normal'; mu: number; sigma: number; clamp: [number, number] }       // Irwin-Hall(12): sum of 12 uniforms - 6; exact ops only
  | { k: 'lognormal'; mu: number; sigma: number; clamp: [number, number] };   // exp via detmath.exp
export type Predicate =
  | { m: MetricOrDerived; op: '<' | '<=' | '>' | '>=' | '=='; v: number }
  | { flag: string; eq?: number | boolean }                                    // eq omitted = flag set
  | { season: [fromWeekOfYear: number, toWeekOfYear: number] }                 // wraps year end
  | { all: Predicate[] } | { any: Predicate[] } | { not: Predicate };
export type MetricOrDerived = MetricId | 'arr' | 'runwayWeeks' | 'headcount' | 'week' | 'productQuality' | 'valuationRef' | 'founderControl' | `sector:${string}`;
export type EffectSpec =
  | { k: 'metric'; metric: MetricId; op: 'mul' | 'add'; dist: Dist; durationWeeks: number; decay: 'none' | 'linear' | 'geometric' }
  | { k: 'flag'; key: string; value: number | boolean; durationWeeks: number }
  | { k: 'staff'; op: 'poach' | 'quit' | 'inject'; role?: 'eng' | 'design' | 'growth' | 'sales' | 'ops'; count: Dist }
  | { k: 'round'; op: 'withdrawOffers' | 'cutTerms'; frac?: number };           // used by finance chains (part B §9)
export interface FollowUp { eventId: string; delayWeeks: [number, number]; p: number }
export interface EventChoice { id: string; cost?: EffectSpec[]; effects: EffectSpec[]; followUps?: FollowUp[]; tags?: ('legacy' | 'risky')[]; requires?: Predicate[] }
export interface EventDef {
  id: string; family: EventFamily; scope: 'tycoon' | 'business' | 'both';
  mtthWeeks: number;                                            // mean time to happen at factor 1
  modifiers: { when: Predicate; factor: number }[];            // multiplicative on the hazard rate
  requires: Predicate[]; minWeek?: number; cooldownWeeks: number; exclusiveGroup?: string;
  severity: 1 | 2 | 3 | 4 | 5;
  onFire?: EffectSpec[]; followUps?: FollowUp[];                // applied when it fires, before any choice
  choices?: EventChoice[]; defaultChoiceId?: string;           // present = a choice event (pauses unless auto-resolved)
  art?: string; /* C07 AssetRef `ui/ty-card-<id>` */
}
export interface EventInstance { iid: number; defId: string; firedWeek: number; chainDepth: number; origin: 'roll' | 'chain' | 'system'; deadlineWeek?: number }
export interface ActiveEffect { eid: number; iid: number; spec: EffectSpec; sampled: number; startWeek: number; endWeek: number; strength: number }
export interface EventState { nextIid: number; nextEid: number; inbox: EventInstance[]; pending: { dueWeek: number; defId: string; depth: number; fromIid: number }[]; active: ActiveEffect[]; cooldownUntil: Record<string, number>; counts: Record<string, number> }
export interface EventHost<S> {                                 // each domain adapts its state
  metric(s: S, id: MetricOrDerived): number; flag(s: S, key: string): number | boolean | undefined;
  applyStock(s: S, id: MetricId, op: 'mul' | 'add', v: number): void;
  applyStaff(s: S, e: Extract<EffectSpec, { k: 'staff' }>, sampled: number): void;
  applyRound(s: S, e: Extract<EffectSpec, { k: 'round' }>): void;
  setFlag(s: S, key: string, v: number | boolean, untilWeek: number): void;
  seed(s: S): number; week(s: S): number; startWeekOfYear(s: S): number;
}
export interface EventEngine<S> {
  roll(s: S, ev: EventState, defs: readonly EventDef[], host: EventHost<S>): EventInstance[];     // once per week
  choose(s: S, ev: EventState, iid: number, choiceId: string, defs: readonly EventDef[], host: EventHost<S>): void;
  autoResolve(s: S, ev: EventState, defs: readonly EventDef[], host: EventHost<S>): void;         // inbox items past deadline
  tickEffects(s: S, ev: EventState, host: EventHost<S>): { mul: Record<string, number>; add: Record<string, number> };  // modifier totals this week
}
```

## 3. Hazard model (the probability model)
Every week, for every def in ascending `id` order that is **eligible** (all `requires` true, `week ≥ minWeek`, `cooldownUntil[id] ≤ week`, its `exclusiveGroup` has no active instance, `chainDepth` rules in §5):
1. `factor = clamp(Π factor_j for modifiers whose predicate is true, 0.1, 8)`.
2. Rate `λ = factor / mtthWeeks` per week; fire probability `p = 1 − exp(−Δt·λ)` with `Δt = 1` week and `exp = detmath.exp`.
3. Draw `u = ctrFloat(seed, 'ev:' + id, week)`; the event fires iff `u < p`.
4. Severity-ordered cap: at most `MAX_NEW_EVENTS_PER_WEEK = 2` fire; on overflow the highest `severity` wins (ties by `id`), the rest are dropped and counted in `counts['suppressed']`. At most one event with `severity ≥ 4` per 8 weeks (`SEVERE_GAP_WEEKS`).
5. Parameters: `p` for `MTTH = 40`, factor 1 is 2.47 % per week; the chance of at least one occurrence in 150 weeks is `1 − exp(−150/40) = 97.6 %`.

**Counter-based RNG.** Event rolls do not consume a stateful generator: `ctrU32(seed, stream, counter) = splitmix32((seed ^ fnv32(stream)) + imul(counter, 0x9E3779B1))` using the C02 primitives `splitmix32` and `fnv32`; `ctrFloat = ctrU32 / 2³²`. Consequences: adding or reordering defs never shifts another def's rolls, nothing needs saving in the slice for RNG, and replay from `(seed, choices)` is exact. This extends C02 rule 3 ("no private generator") without breaking it: there is no generator, only a pure function of `(seed, stream, counter)`; a clarification is proposed in the return block. Streams: `ev:<id>` (counter = week), `evd:<iid>:<k>` (distribution draws), `evf:<iid>:<k>` (follow-up p and delay), `hire:<week>:<n>`, `qa:<meetingId>:<n>`, `board:<week>:<seat>`, `vcpick:<raiseId>:<n>`.

**Distributions.** `fixed`, `uniform`, `normal` (sum of 12 `ctrFloat` draws minus 6, scaled and clamped; no `log/sqrt/cos`), `lognormal` (`exp(mu + sigma·z)` with `detmath.exp`, clamped). A sampled effect stores its `sampled` value, so later weeks never re-draw.

## 4. Effects
- **Stocks** (`cash users hype reputation morale founderMorale techDebt climate`) apply once at choice/fire time: `mul` multiplies, `add` adds, then clamp to the metric's legal range (`hype/reputation/morale/founderMorale` 0–100, `techDebt` 0–100, `climate` −1…1, `users` 0…TAM, `cash` unbounded, integer cents). `durationWeeks` is ignored for stocks except `climate` and `hype`, which also receive a mean-reversion pull in the company model.
- **Modifiers** (`cacMul churnMul arpuMul payRateMul devPowerMul burnMul multipleMul wageMul`) are `ActiveEffect`s. Each week the strength is `1` (`none`), `1 − t/D` (`linear`, `t` weeks since start, `D` duration) or `s ← s·(1 − 2/D)` (`geometric`); a `mul` effect of sampled value `v` contributes `1 + (v − 1)·s`, an `add` contributes `v·s`. Contributions combine by product (`mul`) or sum (`add`) per metric and are clamped to [0.2, 5] for multipliers. Expiry at `endWeek`.
- `staff` effects remove or add employees through the host (a poached engineer leaves with unvested options returned to the pool).
- `flag` effects set a named flag until a week (e.g. `officeClosed`, `insured`, `ipoWindow`); flags are visible to predicates.
- `round` effects act on part B's open term sheets: `withdrawOffers` withdraws all term sheets not yet signed, `cutTerms` lowers pre-money by `frac` once during closing.
- **Choice events.** A def with `choices` becomes an inbox item with `deadlineWeek = week + 2`. Without `pauseOnTycoonEvents` (C05 `accessibility`) the mode auto-resolves with `defaultChoiceId` at the deadline; with it (default true) the clock stays paused until the player chooses. Costs apply when the choice is taken; affordability is checked by `requires`.

## 5. Chains and safety limits
1. `followUps` (on the def or on a choice) are rolled once at the source: `p` via `evf` draws, delay uniform in `delayWeeks`; the result joins `pending`. A pending event fires at `dueWeek` if its `requires` still hold (otherwise it expires silently) and ignores the MTTH roll and cooldown but respects `exclusiveGroup` and the weekly cap.
2. `chainDepth ≤ 4`; a follow-up at depth 4 is not scheduled.
3. A chain can only cost the player what its choices say: every `onFire` cash loss is bounded by `EFFECT_LIMITS` (cash loss ≤ 40 % of current cash or 12 weeks of burn, whichever is larger, per event) enforced at load by the validator and at runtime by clamping.
4. Lethality budget (checked by the harness, band B5): no root event id may be followed by a lost run within 10 weeks in more than 5 % of all runs.
5. Content validation (`pnpm check:unit`): unique ids, every `followUps.eventId` exists, no chain cycle without a cooldown, every `LocKey` present in the source locale, every `art` ref resolvable in the asset catalog (warning until M09b1), no real company, brand or official's name (`names:lint`).

## 6. Taxonomy and shipped catalog
Families: **business** (company-specific), **political** (city/state/federal policy, generic), **natural** (Bay Area hazards), **cultural** (hype, culture, community), **market** (funding climate and exit windows), **system** (engine-generated: bridge offer, board vote, round re-trade). Names are invented; no real company, regulator or official appears (D-29, R-IP-01). Counts: 30 events at M09a2 (VS-Tycoon), 60 by M09b1 (the rest are variants within the same families, with art). `MTTH` in weeks; "×" = modifier factor on the rate. The table lists the 30 shipped at M09a2.

| Id | Fam | MTTH | Modifiers | Sev | Impact (choice in brackets) | Chain / notes |
|---|---|---|---|---|---|---|
| `biz.competitor_launch` | B | 40 | users>2,000 ×1.5 | 2 | `cacMul` ×1.15 for 12 w (match: −$150 k, `devPowerMul` ×1.1 for 6 w) | → `biz.price_war` p 0.3, 4–8 w |
| `biz.price_war` | B | chain | — | 2 | `arpuMul` ×0.92, `churnMul` ×1.1, 10 w | — |
| `biz.engineer_poached` | B | 50 | morale<50 ×2 | 2 | lose 1 eng (counter-offer: salary +20 %) | — |
| `biz.outage` | B | 45 | techDebt>60 ×2.5 | 3 | users ×lognormal(−0.07, 0.03), reputation −5 (post-mortem: −1 w dev, reputation +3) | — |
| `biz.viral_launch` | B | 60 | quality>60 ×1.5; hype>50 ×1.5 | 2 | users +normal(0.22, 0.10), hype +15 | → `biz.scaling_strain` p 0.5, 2–4 w |
| `biz.scaling_strain` | B | chain | — | 2 | `techDebt` +8, `churnMul` ×1.08, 8 w | — |
| `biz.acquisition_offer` | B | 90 | arr>$2 M ×1.5 | 3 | choice: accept (exit at `valuationRef` ×0.9–1.3; may win) / decline (hype +3) | exclusive group `exit` |
| `biz.cloud_bill_spike` | B | 55 | users>5,000 ×1.5 | 1 | `burnMul` ×1.1–1.3, 6 w (optimize: −2 w infra) | — |
| `biz.enterprise_whale` | B | 70 | sales≥1 ×2 | 2 | `arpuMul` ×1.10, `payRateMul` ×1.05, 12 w | — |
| `biz.founder_burnout` | B | 100 | founderMorale<30 ×3 | 3 | `founderMorale` −20, `devPowerMul` ×0.85, 4 w (rest week: reduces) | at morale 0 the run is lost |
| `biz.security_incident` | B | 80 | techDebt>50 ×2 | 3 | reputation −10, `churnMul` ×1.15 (disclose: reputation +4) | — |
| `biz.talent_wave` | B | 60 | climate<−0.2 ×2 | 1 | `wageMul` ×0.92, 12 w | positive |
| `pol.payroll_tax` | P | 80 | headcount>10 ×1.5 | 2 | `burnMul` ×1.03–1.08, 26 w (lobby: −$40 k, halves) | — |
| `pol.ai_ordinance` | P | 120 | sector:ai-tooling ×3 | 3 | `multipleMul` ×0.9, `burnMul` ×1.05 (comply early: −$60 k, `reputation` +5) | — |
| `pol.hardware_tariff` | P | 100 | sector:hardware ×3 | 2 | `burnMul` ×1.06, 20 w | v1 sectors have no hardware; ships disabled until a hardware sector exists |
| `pol.permit_freeze` | P | 90 | sector:mobility ×3 | 3 | `cacMul` ×1.2, users growth paused 6 w | v1 gated like above |
| `pol.city_grant` | P | 110 | reputation>40 ×1.5 | 1 | cash +$50–200 k (apply: −1 w founder time) | positive |
| `nat.quake_major` | N | 1,226 | — | 5 | flag `officeClosed` 1–4 w, users ×0.95, cash −$80–250 k (halved when `insured`) | MTTH derived from the verified 72 % in 30 years (see below) |
| `nat.quake_minor` | N | 200 | — | 2 | `morale` −5, 1 w `devPowerMul` ×0.5 | — |
| `nat.atmospheric_river` | N | 70 | season weeks 44–52,1–12 ×2.5 | 2 | `officeClosed` 1 w, `morale` −3 | — |
| `nat.wildfire_smoke` | N | 90 | season weeks 31–44 ×3 | 2 | `devPowerMul` ×0.9, 2 w, `morale` −5 | — |
| `nat.fog_week` | N | 40 | — | 1 | `devPowerMul` ×0.97, `hype` +1 (flavor) | — |
| `nat.blackout` | N | 150 | — | 3 | `officeClosed` 1–2 w, users ×0.97 (generator: −$30 k, closure 0) | anchored on the Dec 2025 SF blackout (~130,000 customers) |
| `cul.ai_hype_peak` | C | 40 | sector:ai-tooling ×2 | 2 | `hype` +20…40, `multipleMul` ×1.2, 12 w | → `cul.ai_hype_crash` p 0.6, 20–40 w |
| `cul.ai_hype_crash` | C | chain | — | 3 | `hype` −30, `multipleMul` ×0.75, 16 w, `climate` −0.1 | — |
| `cul.speculation_winter` | C | 70 | — | 2 | `climate` −0.3 (geometric 26 w) | generic; no crypto brands |
| `cul.endorsement` | C | 80 | hype>30 ×1.5 | 2 | hype +25, `cacMul` ×0.7, 8 w (cost $40 k) | endorser is a fictionalized composite; no real person |
| `cul.parade_week` | C | 100 | — | 1 | `officeClosed` 1 w, users +3 %, hype +5 | fictional championship |
| `cul.meme_moment` | C | 50 | hype>20 ×1.5 | 2 | users +5…25 %, reputation ±8 (engage: risky, hype +10 or −10) | → `cul.backlash_wave` p 0.25 |
| `cul.backlash_wave` | C | 120 | reputation<40 ×2 | 3 | reputation −15, hype −10 | — |
| `mkt.rate_cut` / `mkt.rate_hike` | M | 60 / 60 | — | 2 | `climate` +0.2 / −0.2, `multipleMul` ×1.1 / ×0.9, 20 w | — |
| `mkt.ipo_window` | M | 90 | climate>0.2 ×2 | 2 | flag `ipoWindow` for 26 w | enables the IPO win |
| `mkt.down_round_wave` | M | 70 | climate<0 ×1.5 | 3 | `climate` −0.4 | → `vc.retrade` p 0.7, 1–2 w |
| `mkt.crash` | M | 140 | climate>0.3 ×1.5 | 4 | `climate` −0.7, `multipleMul` ×0.6, 26 w | → `mkt.down_round_wave` p 0.8 |
| `vc.retrade` | S | chain | requires open term sheet | 3 | `round cutTerms` 0.10–0.25 once (accept / walk) | — |
| `fin.bridge_offer` | S | system | fires when cash < 0 | 4 | accept (note, part B §9) or decline | 4 weeks of negative cash ⇒ loss |

**Calibration anchors (the only externally anchored rows).** USGS FS 2016-3020: 72 % probability of at least one M6.7+ earthquake in the SF Bay region in 2014–2043 [research/gamedesign-decomposition.md; https://www.usgs.gov/publications/earthquake-outlook-san-francisco-bay-region-2014-2043, checked 2026-10-18]. Constant-rate conversion: `λ = −ln(1 − 0.72)/30 = 0.0424` per year, mean 23.6 years = **1,226 weeks** (computed offline; `ln` is not used at runtime). Chance of at least one major quake in a 150-week run = `1 − exp(−150/1226)` = 11.5 %. This uses the whole-region rate as a design simplification for an SF office. The December 2025 SF blackout (~130,000 customers, robotaxis stalled at dark intersections) [research/gamedesign-decomposition.md; abc7news.com, 2026-10-18] supports a recurring `nat.blackout`; the 150-week MTTH is design. Carta dilution drives the funding climate only through part B's design target (U-TYC-1). All other MTTH are design values.

## 7. Reuse by story businesses
`EventDef.scope` is `tycoon`, `business` or `both`. A story business (taqueria, record shop, co-working space; gamedesign §2.9, §5.6) implements `EventHost<BusinessState>` in `@dv/mode-story` (S03). Metric mapping: `cash` ↔ till, `users` ↔ weekly footfall, `reputation` ↔ business reputation, `morale` ↔ staff morale, `arpuMul` ↔ ticket size, `burnMul` ↔ cost multiplier, `devPowerMul` ↔ output, `officeClosed` ↔ shop closed; `hype`, `techDebt`, `climate`, `multipleMul`, `wageMul`, cap-table effects and `round` effects are no-ops. Rules: a business ticks once per story-week (7 game days; 1,209,600 game half-seconds, 06 §4.3) from the world clock; the seed is `StorySlice.world.seed ^ fnv32(businessId)`; events reach the player as phone Feed/Messages items (never pausing the world, never a modal), with the same choice semantics and a 2-week deadline. The `both`-scope subset shipped at M09a2: `nat.quake_minor`, `nat.blackout`, `nat.atmospheric_river`, `nat.fog_week`, `pol.payroll_tax`, `pol.city_grant`, `cul.parade_week`, `cul.meme_moment`, `biz.cloud_bill_spike` (renamed "utilities spike" by LocKey override), `biz.engineer_poached` ("key employee poached"). The blackout event reuses Premise B's district power-state system for the world side when it exists [research/gamedesign-decomposition.md]. Wiring happens in S03's Act 2 businesses milestone (DN-S08-03); M09a2 proves the engine with a fixture host (`tests/tycoon/fixtures/story-business.host.ts`) and 1,000 seeded business-years.

## 8. Balance tool: `tools/ci/tycoon-sim` (Monte-Carlo as CI)

```
pnpm tycoon:sim -- --runs 10000 --policy median,aggressive,frugal,random --seed-base 1 \
  --content content/tycoon --balance config/tycoon.balance.json --bands config/tycoon.bands.json \
  --out tests/tycoon/report.json [--sweep finance.dilutionSeed=0.14:0.22:0.02] [--trace run=123] [--bands-only]
```
`pnpm tycoon:sim` is a root alias; the CI gate is `pnpm check:balance` (new name, proposed to S13/06 §5; until accepted it runs as `pnpm --filter @dv/ci test:tycoon-sim`). Run `i` uses `seed_i = splitmix32(seedBase + i)` and the same `RunSetup` generator as the game (`setupFromSeed(seed_i)` picks sector, thesis, founder archetype and start week of year deterministically), so the harness plays exactly what the player plays. No wall clock, no LLM, no network: negotiations take the offline path (part B §11.4). The tool uses only `@dv/shared/tycoon` public exports.

**Policies (bots, P-9 "every system has a bot").** A policy implements `decide(view: PolicyView, rng: CtrRng) → Command[]` once per sim week; `PolicyView` is the same read model the UI gets.
- `median`: balanced. Allocation 60/25/15 (features/refactor/infra); marketing 35 % of the weekly sustainable budget; hires toward a 55-week runway target in the order eng, eng, growth, sales, design, ops; starts a raise for the next stage when `arr` passes the stage trigger (SAFE at launch, seed ≥ $250 k ARR, A ≥ $1.5 M, B ≥ $8 M, C ≥ $30 M) or runway < 40 weeks; picks the highest-valuation term sheet; rests the founder when `founderMorale < 35`; takes `defaultChoiceId`-like safe choices by a fixed table.
- `aggressive`: allocation 85/5/10, marketing 2×, hires toward a 35-week runway, raises early (runway < 60), uses crunch when `devPower` is the bottleneck.
- `frugal`: bootstrapper; raises only when runway < 16 weeks, hires toward 80 weeks, allocation 55/30/15.
- `random`: uniform over legal commands with a per-week action probability of 0.25; always resolves events with a uniformly chosen choice.
- `autoFounder` (story autoplayer, M09b2): `median` with a scripted pitch and a fixed seed, must close the mini-run SAFE in 8 weeks (AC in part A).

**Bands (`config/tycoon.bands.json`, enforced as exit code ≠ 0).** All on N = 2,000 runs per policy for PRs and 10,000 nightly; with fixed seeds the result is exactly reproducible, so a band failure is a real regression, not noise.

| ID | Band | Source |
|---|---|---|
| B1 | median policy: median run length 120–200 weeks | gamedesign §5.14 (design) |
| B2 | median policy: P(closed priced Series A) 35–60 % | gamedesign §5.14 |
| B3 | median policy: P(unicorn win) 3–8 % | gamedesign §5.14 |
| B4 | for every other policy `winRate ≤ 1.5 × median.winRate` and `meanScore ≤ 1.5 × median.meanScore` (no dominant strategy) | gamedesign §5.14 |
| B5 | no root event id is followed by a lost run within 10 weeks in more than 5 % of runs | gamedesign §5.14 |
| B6 | `random` policy `winRate ≤ 0.5 × median.winRate` (skill matters) | design |
| B7 | median negotiated dilution at seed/A rounds 15–24 % (centre 18–20 %) | design, centred on Carta Q1 2025 17.9 % (U-TYC-1) |
| B8 | median policy: 20–45 events fired per run and 6–22 choice events per run | design |
| B9 | suppressed events (weekly cap) < 1 % of weeks | design |
| B10 | determinism: two executions give identical `report.json` (minus timings); for 200 runs `replay(setup, choices)` equals the live result and `stateHash` | A-04-style |
| B11 | zero bot offers outside their envelope; zero `CAPTABLE_INVARIANT`; zero payouts ≠ proceeds | part B |
| B12 | throughput: 10,000 runs of the `median` policy finish in ≤ 300 s on the CI runner (reported in the log) | design |

**Regression guard.** `tests/tycoon/baseline.json` stores the last accepted per-policy statistics. A PR fails if any statistic moves by more than ±2 percentage points (rates) or ±8 weeks (lengths) without a commit message line `balance-rebaseline: <reason>` and a regenerated baseline (`pnpm tycoon:baseline`). Event-content changes alter `contentVersion`; saved-run replays record the version and the loader falls back to the snapshot when it differs (part A §4.6).

**Harness self-tests (must fail by construction, in `check:unit`).** `fixtures/dominant-strategy.balance.json` (frugal marketing efficiency ×10) trips B4; `fixtures/chain-death.events.json` (a root event with a lethal chain) trips B5; `fixtures/easy-mode.balance.json` trips B3; `fixtures/offer-out-of-band.bot.ts` trips B11. Each asserts a non-zero exit code.

**Sweeps and reports.** `--sweep key=a:b:step` varies one balance constant and prints the band table per value (used at M09a2 to tune; not a CI gate). `report.json` (JSON Schema `tests/tycoon/report.schema.json`) holds, per policy: run-length percentiles, outcome counts, tier reach rates, dilution percentiles, event counts per id, lethality per root id, score distribution, wall time. A markdown summary is posted in the CI job summary. Schedules: PR job `balance-pr` (2,000 runs, ≈ 1 minute target), nightly `balance-nightly` (10,000 runs); `check:unit` carries a 200-run smoke on `median` for local feedback.

## 9. Tests for this part (names; `check:unit` unless noted)
`events.hazard.spec.ts` (p vs closed form at ten (factor, MTTH) pairs; frequency over 100,000 counter draws within ±3 σ), `events.ctr.spec.ts` (adding a def does not change another def's roll; golden `ctrU32` vectors in Node, Chromium and WebKit via M01a's cross-browser job), `events.dist.spec.ts` (clamps, no transcendental besides `detmath.exp`; lint fixture), `events.effects.spec.ts` (stock vs modifier, decay, expiry, clamps), `events.chain.spec.ts` (depth ≤ 4, expiry when `requires` fails, exclusive groups, weekly cap, severity gap), `events.content.spec.ts` (§5.5 validator, `names:lint` fixture), `events.story-host.spec.ts` (fixture business host, 1,000 business-years, no stock leaks), `balance.bands.spec.ts` (200-run smoke), `balance.selftest.spec.ts` (four failing fixtures), and the CI jobs `balance-pr` and `balance-nightly` (`pnpm check:balance`).
