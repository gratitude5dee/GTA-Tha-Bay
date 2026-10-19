# 08 — Business Tycoon, part B: cap table, SAFE and priced-round math, waterfall, term sheets, VC negotiation

> S08, Wave 3, 2026-10-18. Part of `spec/domains/08-tycoon.md` (part A: scope, sim loop, company model; part C: `08-tycoon-events.md`). Consumes 06 v1.1 C05, C06 (1.1.0) and C10 (1.0.0). Numbers marked *design* are our own starting values, tuned at M09a2 against the balance bands (part C §8); numbers marked *verified* cite the ledger. Nothing here is legal or investment advice: this is a game ruleset (D-30, 06 §3 "no real-money or token economy").

## 1. Scope
This part owns: money and share arithmetic, `CapTable` and its operations, post-money SAFE conversion, priced rounds with option-pool shuffle, the liquidation waterfall, the deterministic term-sheet envelope, the negotiation state machine, the VC roster, and the dialogue integration with C10 (clamp, fallback, quotas). R-IDs: R-MODE-04 (cap-table math, AI-NPC investors), R-NPC-04 and R-NPC-05 (likeness tiers, proxy dialogue), R-ENG-03 (turn cost control), R-IP-01 (fictional companies).

Placement: all pure code lives in `packages/shared/src/tycoon/finance/**` so the harness, the Worker leaderboard validator (M12c) and the mode all import one implementation (`@dv/shared` is pure, C02 lint applies; BigInt is allowed, transcendentals are not).

## 2. Numeric rules (testable)
1. Money is integer cents (`Cents`), matching C06 `EconomyApi`. Share counts are non-negative integers. Percentages inside finance are basis points (`bp`, 10,000 = 100 %).
2. `mulDivFloor(a, b, c)` and `mulDivCeil` use `BigInt` and throw on `c <= 0`. They are the only way to compute `a·b/c` when the product can exceed 2⁵³ (a $50 M round times 10⁸ shares does).
3. Ratios that only feed a floor (`inv / cap`) use IEEE doubles with `+ − × ÷` only. These are exactly reproducible across engines (C02 rule 2), so every vector below is bit-stable. Sums run in a fixed order: SAFEs sorted by `(signedWeek, id)`.
4. No `Math.pow/exp/log/sqrt` or `**` anywhere in finance. Display percentages are derived in the UI, never fed back.
5. Every operation conserves shares: after any operation `Σ holders + pool.available + pool.granted === totalFd`, checked by `assertConserved(table)` (throws in tests, returns a `CAPTABLE_INVARIANT` error in production and aborts the round, never corrupting state).

## 3. Cap-table data

```ts
// packages/shared/src/tycoon/finance/types.ts
export type Cents = number;                       // integer
export type ShareClass = 'common' | `pref-${string}`;       // pref-safe-<id>, pref-seed, pref-a, pref-b, pref-c
export type RoundKind = 'safe' | 'seed' | 'a' | 'b' | 'c';
export interface Holder { id: string; kind: 'founder' | 'employee' | 'investor' | 'advisor'; shares: Record<ShareClass, number> }
export interface PoolState { authorized: number; granted: number; /* available = authorized - granted */ }
export interface Safe {
  id: string; investorId: string; amount: Cents; signedWeek: number;
  type: 'cap' | 'discount' | 'mfn' | 'capDiscount';     // cap, discount, mfn = YC forms; capDiscount is a game extension
  postMoneyCap?: Cents; discountBp?: number;            // discountBp 8000 = converts at 80 % of the round price
  sideLetterProRata?: false;                            // pro rata is out of scope (A-checklist 34)
}
export interface LiqPref { multiple: 1 | 1.5 | 2; participating: boolean }
export interface PricedRound {
  id: string; kind: Exclude<RoundKind, 'safe'>; week: number; closedWeek: number | null;
  preMoney: Cents; amount: Cents; poolTargetBp: number;           // available pool as bp of post-money FD
  newShares: number; topUpShares: number; priceMicros: number;    // informational: pre / X in 1e-6 dollars
  liq: LiqPref; boardSeats: number; leadInvestorId: string; invested: Record<string, Cents>;   // by investor
}
export interface CapTable {
  holders: Holder[]; pool: PoolState; safes: Safe[]; rounds: PricedRound[];
  totalFd: number;                                                // cached; recomputed by assertConserved
}
export interface Terms { amount: Cents; preMoney: Cents; poolTargetBp: number; boardSeat: boolean; liq: LiqPref }
```

Initial table: founder `f1` 9,000,000 common; pool authorized 1,000,000, granted 0; `totalFd` 10,000,000 (a fixed game convention). A co-founder archetype splits the 9 M 5.4 M / 3.6 M.

## 4. Post-money SAFE conversion
Facts [research/gamedesign-decomposition.md; https://www.ycombinator.com/safe/ fetched 2026-10-18 by S08]: on a post-money-cap SAFE the ownership sold equals investment ÷ cap ($500 k at $6.7 M ≈ 7.5 %); the cap is "post" the options and the pool existing before the equity financing, but **not** "post" the new or increased pool adopted in that financing; the YC forms are cap-no-discount, discount-no-cap and uncapped MFN, and a pro-rata side letter is a separate document. `capDiscount` is a game extension, not a YC form. The conversion algorithm below is our game convention built on those two facts.

`convertSafes(table, round) → { sharesBySafe, iterations }`, run when a priced round closes:
1. `FD0 = issued + granted + poolAvailable` (the table before the round, SAFEs excluded). `issuedGranted = FD0 − poolAvailable`.
2. **MFN resolution.** An `mfn` SAFE takes the lowest `postMoneyCap` and the highest `discountBp` among SAFEs signed *after* it and before conversion; with none, it converts at the round price.
3. **Cap shares.** For SAFEs with a cap: `f_i = amount_i / cap_i`, `F = Σ f_i`. Signing a SAFE that would push `F` to 0.5 or more is rejected (`SAFE_STACK_LIMIT`). `capShares_i = floor(FD0 · f_i / (1 − F))`. This is the ownership `f_i` of `FD0 + Σ capShares` (the pool top-up of this round is excluded, as YC states).
4. **Price shares.** Discount and uncapped SAFEs price off the round: with pre-money `pre`, `X` (step 5 of §5) and `discountBp` (10,000 for uncapped), `priceShares_i = floor(amount_i · X · 10,000 / (discountBp · pre))`.
5. `shares_i = max(capShares_i, priceShares_i)` (the better price for the investor). Because `X` depends on the total, iterate: start with `capShares`, compute `X`, recompute, stop when no SAFE changes or after 16 iterations (monotone non-decreasing and bounded, so it converges; tests assert ≤ 16 and typically ≤ 9).
6. Each SAFE becomes a shadow preferred class `pref-safe-<id>` with liquidation preference = `amount` (1×, non-participating): the YC convention that SAFE preferred has a preference equal to its purchase amount is simplified to this single rule.

## 5. Priced round with option-pool shuffle
Inputs `pre`, `amount`, `q` (= `poolTargetBp`, available pool as a share of post-money FD), table, SAFE shares `N_safe`. All integer arithmetic:
1. `B = issuedGranted + N_safe`.
2. `den = pre·10,000 − q·(pre + amount)`. If `den ≤ 0` the term sheet is invalid (`TERMS_INFEASIBLE`); the envelope never produces one.
3. `X = ceil(B · pre · 10,000 / den)` is the pre-money fully diluted count that includes the top-up (derivation: pool available after the round equals `q·postFD`, `postFD = X·(pre+amount)/pre`).
4. `T = X − FD0 − N_safe` (top-up shares). If `T < 0` the pool already exceeds the target: `T = 0`, `X = FD0 + N_safe`.
5. Price per share = `pre / X` (stored as `priceMicros = floor(pre·10,000 / X)`, informational). `newShares = floor(amount · X / pre)`. Post-money FD = `X + newShares`.
6. The pool top-up dilutes only holders existing before the round (founders, employees and converted SAFEs), which is the pool-shuffle effect.
7. Fees: legal cost `max(1,500,000 cents, 2 % of amount)` is debited from cash at close (design).
8. Board: `boardSeats` as in `Terms` (§13.3).

## 6. Liquidation waterfall at exit
`waterfall(E, table, exitKind) → Payouts` where `E` is net proceeds in cents. Common = founders + granted options (all treated as vested and exercised at zero strike: game convention) ; the unissued pool receives nothing.
1. Preferred classes: `L_k = multiple_k · invested_k`, per-share preference `l_k = L_k / shares_k`. Pari passu among preferred (v1 default; no seniority stack).
2. Non-participating classes sorted by `l_k` ascending (ties by class id). For `t = m … 0` (m = number of non-participating classes) assume the `t` lowest-`l` classes convert. Preferences owed = `Σ L` of classes that do not convert (participating classes always take theirs and also join the residual); `paid = min(E, owed)`, distributed pro rata to `L` with `mulDivFloor`.
3. Residual `R = E − paid`, shares in the residual = common + converting + participating classes; value per share `v = R / residualShares`. Accept the largest `t` for which the `t`-th class satisfies `R · shares ≥ l_t · residualShares · shares` (it prefers converting). `t = 0` always passes.
4. Payout of a class = floor of its pref share + floor of `R · shares / residualShares` where it participates in the residual. Rounding remainder cents go to common (the founder holder first). `Σ payouts === E` is asserted.
5. The UI exit slider calls `waterfall` live for any `E`; "predatory" outcomes (participating, 1.5× or 2×) appear only through events or tourist-VC terms (§10).
6. Founder net worth at exit = the founder holder's share of common payout (plus any founder preferred, none in v1).

## 7. Test vectors (cents; reference implementation checked in a throwaway script on 2026-10-18; the expected values below are the unit-test oracles, run by `pnpm --filter @dv/shared test:tycoon-finance`, part of `check:unit`)
Base table: founders 9,000,000 common; pool 1,000,000 available; `FD0 = 10,000,000`.

| ID | Scenario | Expected |
|---|---|---|
| TV-1 | SAFE $500,000 (50,000,000) at post cap $6,700,000 (670,000,000), no round | `capShares` 806,451; 806,451 / 10,806,451 = 7.4627 % (±1e-6); equals investment ÷ cap = 7.4627 % |
| TV-2 | two caps: $500 k at $5.5 M and $500 k at $8.3 M | shares 1,070,967 and 709,677 (total 1,780,644); combined 15.115 % of 11,780,644 |
| TV-3 | TV-1 SAFE, then priced round pre $12,000,000, amount $3,000,000, `q` = 1,000 bp | `X` 11,207,373; `T` 400,922; `newShares` 2,801,843; post FD 14,009,216; `priceMicros` 1,070,723; founders 9,000,000 (64.2434 %); SAFE 806,451 (5.7566 %); new money 19.99999857 % (≥ 19.9999 %); pool available 1,400,922 (10.0000 %); Σ = 14,009,216 |
| TV-4 | no SAFE, pre $8 M, amount $2 M, `q` 1,000 bp (pool shuffle) | `X` 10,285,715; `T` 285,715; `newShares` 2,571,428; post FD 12,857,143; `priceMicros` 777,777; pool available 1,285,715 |
| TV-5 | pool already above target: issued 9,000,000, pool available 3,000,000; pre $8 M, amount $2 M, `q` 1,000 bp | `T` 0; `X` 12,000,000; `newShares` 3,000,000; post FD 15,000,000; pool 20 % (no top-up) |
| TV-6 | SAFE $500 k, cap $6.7 M, `discountBp` 8000 (`capDiscount`); round pre $8 M, amount $2 M, `q` 1,000 bp | discount binds: SAFE shares 882,352 (> cap shares 806,451); `X` 11,294,117; `T` 411,765; `newShares` 2,823,529; post FD 14,117,646; `priceMicros` 708,333; iterations 5 |
| TV-7 | same SAFE as TV-6 in TV-3's round (pre $12 M, amount $3 M) | cap binds: 806,451 shares, iterations 0 |
| TV-8 | discount-only SAFE $500 k, 8000, same round as TV-6 | 882,352 shares (cap-less result equals TV-6) |
| TV-9 | MFN $1,000,000 signed first, then cap SAFE $500 k at $6.7 M; round pre $12 M, amount $3 M, `q` 1,000 bp | MFN inherits the $6.7 M cap: shares 1,923,076 and 961,538; `X` 13,582,416; `T` 697,802; `newShares` 3,395,604; post FD 16,978,020 |
| TV-10 | SAFE stack `F ≥ 0.5` (e.g. five $1 M SAFEs at $2 M cap) | `SAFE_STACK_LIMIT`, no state change |
| TV-11 | infeasible terms: `q` 9,000 bp, amount ≥ 10 % of post | `TERMS_INFEASIBLE` |

Waterfall oracles use the TV-3 table after the round: classes `pref-safe-1` (806,451 shares, invested 50,000,000, 1×) and `pref-a` (2,801,843 shares, invested 300,000,000, 1×), common 9,000,000.

| ID | Exit proceeds `E` | SAFE class | Series A | Common |
|---|---|---|---|---|
| WF-1 | $2,000,000 (below preferences) | 28,571,428 | 171,428,571 | 1 |
| WF-2 | $3,500,000 (exactly the stack) | 50,000,000 | 300,000,000 | 0 |
| WF-3 | $10,000,000 (SAFE converts, A holds preference) | 57,565,749 | 300,000,000 | 642,434,251 |
| WF-4 | $13,000,000 | 82,236,784 | 300,000,000 | 917,763,216 |
| WF-5 | $14,000,000 (both convert; A crossover is just above $13.5 M) | 89,546,722 | 311,111,098 | 999,342,180 |
| WF-6 | $20,000,000 | 127,923,888 | 444,444,426 | 1,427,631,686 |
| WF-7 | $10,000,000 with Series A at 2× participating | 50,000,000 | 683,092,534 | 266,907,466 |

Property tests (200 seeded random tables each): conservation of shares; `Σ payouts === E`; payouts monotone non-decreasing in `E` for every class; no payout above `E`; waterfall result invariant to class insertion order.

## 8. Term-sheet envelope (deterministic range)
`termSheetEnvelope(company, vc, climate, competition, mood) → TermSheetEnvelope | Pass`. It is a pure function of sim state; the LLM never sees a number outside it and the sim never accepts one.

```ts
export interface TermSheetEnvelope {
  vcId: string; round: Exclude<RoundKind, 'safe'> | 'safe'; validUntilWeek: number;
  amount: [Cents, Cents]; preMoney: [Cents, Cents]; poolTargetBp: [number, number];
  boardSeat: boolean | 'negotiable'; liq: LiqPref; safeCap?: [Cents, Cents];
  fomoBonusBp: number;            // ≤ 1,500 (15 %)
  midpoint: Terms;                // offline-fallback offer at mood position t
  walkAway: { reason: 'ask_too_high' | 'ask_too_low' | 'red_flag' | 'mood_floor'; ok: false } | null;
}
```

Computation (all steps exact or double ops, no transcendentals):
1. `V = valuationRef(company)` (part A §5.4), `b = vc.valuationBias ∈ [−1, 1]`, `c = climate ∈ [−1, 1]`.
2. Valuation band `lo = V·(0.80 + 0.10b + 0.10c)`, `hi = V·(1.10 + 0.10b + 0.10c)`; for a SAFE, the cap band is the same `×1.0` on the post-money side. FOMO: with `n` live competing term sheets, `fomo = min(0.15, 0.06·n)`; `hi ×= (1 + fomo)`; `fomoBonusBp = round(10,000·fomo)` (the 15 % cap is gamedesign §5.5).
3. Amount band from the player's target `W`: `[0.6W, 1.25W]` clipped to the VC's cheque range `[checkMin, checkMax]`. Empty ⇒ `Pass(ask_too_high)` or `ask_too_low`.
4. Dilution band: target dilution `d*` by round (seed 18 %, A 20 %, B 15 %, C 12 %; design, anchored to Carta Q1 2025 median Series A dilution 17.9 % [research/gamedesign-decomposition.md; figure from a search excerpt, page returned 403, so it only centres a design target, U-TYC-1]); allowed `a/(pre+a) ∈ [0.75d*, 1.35d*]`, giving `pre ∈ [a(1/(1.35d*) − 1), a(1/(0.75d*) − 1)]`. Intersect with the valuation band; empty ⇒ pass.
5. Pool band by round: seed 8–12 %, A 10–12 %, B 5–8 %, C 3–5 %. Board: seed observer only, A one seat `negotiable`, B two seats, C two.
6. Liquidation preference defaults to 1× non-participating. `participating` or multiple > 1 is offered only when the VC archetype has `predatoryAllowed`, **and** (climate < −0.3 or company runway < 12 weeks), and then with `preMoney` band raised 10 % as the lure.
7. Position inside the band, `t = clamp01(0.5 + (mood − 50)/100 + styleShift)`; `styleShift`: hardball −0.15, founder_friendly +0.15, herd +0.10 with a competing term sheet else −0.10, contrarian +0.10 when company hype < 30 else 0. `midpoint` = band positions at `t`. At mood 50 and a neutral style the median Series A dilution is 19–21 % (checked by the harness, part C §8 band B7).
8. `walkAway`: reputation < 20, `techDebt` > 80, any `red_flags` predicate of the VC true (e.g. `founderControl` false for a founder-friendly fund), or `mood < 10`.
9. Validity: a term sheet stays open `2` sim weeks (`validUntilWeek`). It is withdrawn early by the chain event `vc.retrade` (part C) when climate falls by 0.4 or more.

Constants live in `config/tycoon.balance.json` (`finance.*`), schema-validated; the harness may sweep them.

## 9. Negotiation state machine
States: `idle → scheduled → intro → qa(≤3) → offer → counter(≤2) → decision → closing(2 wk) → closed | withdrawn | passed`. At most `MAX_MEETINGS_PER_RAISE = 4` meetings per process and one meeting per sim week; a process occupies the founder (`focus = fundraise`, product output ×0.2) for `3 + meetings − 1` weeks.

Player actions (sim `Command`s, part A §4.4): `scheduleMeeting{vcId}`, `answerQuestion{questionId, optionId}`, `askMore{field}`, `counter{terms}`, `bringCompetitor{termSheetId}`, `accept`, `walk`, `sleepOnIt` (advance one week, term sheet clock runs).

Mood `m ∈ [0, 100]`, start `40 + reputation/5 + styleBase` (hardball −5, friendly +8). Deterministic deltas (design):

| Action | Mood |
|---|---|
| Answer strong / adequate / weak / evasive | +8 / +3 / −5 / −10 (judged by the question's predicate on company state) |
| `askMore` within the band | −4 each, max 2; beyond the band: −12 and the offer is repeated unchanged |
| `counter` inside the envelope (pool, board) | 0; outside: −6 |
| `bringCompetitor` with a real live sheet | +6 and FOMO as in §8.2 (a sheet from a withdrawn or expired meeting does not count) |
| LLM mood tag (see §11) | `happy +4, amused +3, proud +3, neutral 0, suspicious −3, annoyed −4, sad −2, scared −3, angry −8`, one tag per turn |

`mood < 10` ends the meeting with `passed(mood_floor)`. The VC question for `qa` is drawn from `content/tycoon/questions.json` (24 entries, each keyed to a metric weakness id) with the counter RNG stream `qa:<meetingId>:<n>` using the company's weakest normalized metric first. Free-text answers are optional: they only affect mood through the capped LLM tag; the three button options always work offline.

Closing: `accept` creates `PricedRound`/`Safe` in state `closedWeek = week + 2`; cash arrives and the cap table updates at `closedWeek`. A `vc.retrade` or `market.crash` event inside the closing window may cut `preMoney` by 10–25 % once (player may accept or walk). Founder control after the close: `founderControl = founderSeats > investorSeats` (§13.3).

**Bridge note** (insolvency rescue, part A §5.10): a convertible note of 8 weeks of burn, converting like a `discount` SAFE at 70 % with no cap; accepted in the `bridge` choice event.

## 10. VC roster (12 fictional investors, D-29)
All 12 ship as original characters at likeness tier `fictionalized` (no photo references, voices `designed`, tier t1 or t2 [spec/domains/05-assets-pipeline.md: tycoon VCs use `voice_design`]). Names are placeholders resolved by S04 through `NameRegistry`; the slug is the C07 asset id, the soul uses the C10 field names (owner S04): `tycoon {roles, thesis, negotiationStyle, redFlags, pitchHooks}` and `stats.tycoon {riskAppetite, valuationBias, checkUsd {min, max}}` (the research layer's snake_case names map onto them [research/ai-npc-runtime.md §1.5]).

| Slug | Archetype / style | Stage focus | Check range (USD) | Bias | `predatoryAllowed` | Hero |
|---|---|---|---|---|---|---|
| `vc-fogindex-hardball` | Fog Index Capital managing partner; hardball | A, B | 3 M–25 M | −0.3 | no | yes (Sonnet) |
| `vc-seedling-angel` | SoMa angel; founder_friendly | SAFE, seed | 50 k–500 k | +0.2 | no | no |
| `vc-herd-crossover` | crossover fund; herd | B, C | 15 M–80 M | +0.4 | no | no |
| `vc-contrarian-deep` | deep-tech; contrarian | seed, A | 1 M–10 M | −0.1 | no | no |
| `vc-accelerator-batch` | accelerator director; standard SAFE | SAFE | 100 k–250 k | 0 | no | no |
| `vc-halcyon-corp` | corporate VC arm of the fictional robotaxi firm; herd | A, B | 5 M–30 M | +0.1 | no | no |
| `vc-microgrid-impact` | impact fund; founder_friendly | seed, A | 1 M–8 M | −0.2 | no | no |
| `vc-family-office` | family office; hardball | seed, A | 500 k–5 M | −0.4 | no | no |
| `vc-tourist-hedge` | "tourist" hedge fund; herd, high headline valuation | A, B, C | 10 M–60 M | +0.6 | **yes** | no |
| `vc-scout-solo` | solo scout; founder_friendly | SAFE | 25 k–150 k | +0.1 | no | no |
| `vc-sovereign-slow` | slow sovereign-style fund; contrarian | B, C | 30 M–120 M | −0.3 | no | yes (Sonnet) |
| `vc-operator-angel` | ex-operator angel and mentor; founder_friendly | SAFE, seed | 100 k–1 M | +0.1 | no | no |

Rules: (a) up to four slots may be re-skinned by S04 to a `parody` caricature of a living investor, never a `consented` one without a consent record, only after `names:lint`; (b) a real-person-derived VC never has `predatoryAllowed` and never appears as a villain, criminal or event antagonist (gamedesign §11 depiction rules; antagonist executives are always fictional); (c) founder NPCs in tycoon (rival founders, mentors in events) are `fictionalized` composites; founders of real companies are `fictionalized` by D-29 and appear only as mentor/cameo with no negative event attached; (d) company and product names in events and sectors are invented; (e) kill-switch: a killed VC (`RosterFlags`/`KillScope`, C12 route 30) is replaced by its stand-in and the negotiation continues with the same deterministic envelope; an in-flight meeting re-enters `qa` with the stand-in line source.

## 11. AI-NPC dialogue integration (C10)
Layering: the sim decides terms; the proxy voices them and may propose an offer inside the envelope. Everything stochastic from the LLM becomes a recorded input before it touches state, so replay and the leaderboard validator never call a model.

```mermaid
sequenceDiagram
  participant P as Player/UI (main)
  participant S as sim.worker (TycoonSim)
  participant N as @dv/npc client
  participant W as Worker /api/v1/npc/:id/talk (C12 #31)
  P->>S: Command scheduleMeeting / answerQuestion / counter
  S-->>P: MeetingView {envelope summary, mood, deterministic offer}
  P->>N: talk(npcId, soulVersion, turn{intent,text?}, context=C10 NPCDialogueContext{mode:'tycoon', tycoon}, maxTokens)
  N->>W: SSE request (no history; EncounterDO holds it)
  W-->>N: line.delta* , effects{action:'offer_deal',arg}, line.done | fallback
  N-->>P: line text, effects
  P->>S: Command vcSpoke{meetingId, turnIx, emotionTag, proposal?, lineKey}
  S->>S: clampTerms(proposal, envelope) ; applyMood(tag) ; record ChoiceRecord
  S-->>P: MeetingView (offer on the table)
```

1. **Request** (C10 owner wins, DL-087). `context` is the C10 `NPCDialogueContext` with `mode: 'tycoon'` and `context.tycoon = {roundId, stance, week, mood, sector, arrBand, growthBand, runwayBand, weakestMetric, deals}`, built by `TycoonPitchController` (banded values, no free text from earlier turns). `deals` holds ≤ 3 offers the sim computed inside the §8 envelope (the `midpoint` at mood position `t` and up to two neighbours at `t ± 0.15`), with ids `deal.<meetingId>.<k>` repeated in `context.offers.dealIds`. `turn.intent` is one of the C10 tycoon intents `pitch|answer|ask_more|counter|close`. `maxTokens` ≤ 220. The soul's `tycoon` block and rails are in the cached prefix (S04); the prefix never contains numbers from the envelope [research/ai-npc-runtime.md §2.6].
2. **Response mapping.** C10 `effects` is used as is: `effects.mood` is one of the C10 `Emotion` tags mapped by the §9 table; `effects.action = {kind: 'offer_deal', arg}` with `arg` ∈ `context.offers.dealIds` selects that sim-computed deal (S04's executor already rejects any other arg; the model never writes numbers). Anything else (`refuse`, `leave`) maps to `pass`. `memoryWrite` is accepted but ignored by the sim (no memory for under-18 profiles per D-22 is S04's rule).
3. **Authoritative clamp** (kept as defence in depth; a selected deal is already inside the envelope). `clampTerms(proposal, envelope)` clamps each field into its band (`amount`, `preMoney`, `poolTargetBp`), forces `liq` to the envelope's, and sets `boardSeat` to `false` when the envelope says `false`. A clamped field is recorded as `clamped: ['preMoney', …]` in the `ChoiceRecord` and emitted as telemetry `tycoon.negotiation{clamped:n}`. The clamp runs in the sim at apply time, so a forged or replayed `ChoiceRecord` with an out-of-range proposal yields the same clamped result everywhere. The Worker may additionally clamp when the client supplies the envelope, but its result is advisory: the sim never trusts it.
4. **Offline fallback.** No `proposal`, a `fallback` SSE event, `quota_exhausted`, `budget_offline`, `kill_switched`, `upstream_unavailable` (C12 `ApiError`), or no first token within 4 s [06 §4.4 C10 fixed line] ⇒ the UI sends `vcSpoke` without `proposal` and the sim uses `envelope.midpoint` at mood position `t`. The line text is a templated `LocKey` from `content/tycoon/vc-lines.json` (≥ 6 lines per intent per negotiation style, with `{amount}`, `{pre}`, `{pool}` placeholders). The bots and the harness always use this path.
5. **Models and cost.** Default named VCs use `claude-haiku-5-5` (thinking disabled, effort low), hero VCs `claude-sonnet-5-5` (`between_tools`) per D-21 [research/INDEX.md §1.21]. `research/ai-npc-runtime.md` §2.2 lists tycoon turns on Sonnet with adaptive thinking; D-21 and gamedesign §5.5 win (the deterministic engine decides, the model voices), see DN-S08-01. Turn limits: `MAX_TURNS_PER_MEETING = 8`; a meeting costs ≈ $0.0022 on Haiku and ≈ $0.04 on Sonnet at list prices (8 turns × $0.00028 / $0.0050, [research/INDEX.md §6]); a full run worst case is ≈ $0.04 on Haiku. The anonymous per-day budget of $0.05 [research/INDEX.md §7] means a Sonnet meeting can exhaust it; the governor degrades heroes to Haiku at 70 % and the game falls back offline, so no path blocks play.
6. **Safety.** The VC soul carries the global rails (no real-money or investment advice, no real-person claims) [research/ai-npc-runtime.md §2.5]. The pitch room shows the permanent label "AI investor · fictional game" and the legend "In-game terms are a simulation, not financial or legal advice". Player free text goes through the standard S04 input classifier; a blocked message is treated as an `evasive` answer.
7. **Prompt injection.** Instructions in the player's text cannot change numbers: they only reach the model, whose output is clamped (point 3) and whose mood effect is capped (±8 per turn, §9).
8. **Latency.** While waiting, the UI shows "thinking" and the deterministic offer card is already visible; the pitch never blocks on the model. Haiku TTFT through the gateway is UNVERIFIED (U-NPC-01, M06a measures it).

## 12. Tests for this part (names; all in `check:unit`)
`finance.vectors.spec.ts` (TV-1…TV-11, WF-1…WF-7), `finance.property.spec.ts` (conservation, monotonicity, order invariance), `finance.nolint.spec.ts` (lint fixture: `Math.pow` in finance fails), `envelope.spec.ts` (bands, FOMO ≤ 15 %, empty band ⇒ pass, mood positions, predatory gate), `negotiation.fsm.spec.ts` (illegal transitions rejected, mood floor), `dialogue.clamp.spec.ts` (out-of-envelope fixture proposal is clamped and logged, every field), `dialogue.parse.spec.ts` (an `offer_deal` arg outside `offers.dealIds` ⇒ pass), `dialogue.fallback.spec.ts` (each `ApiError` code and a 4 s timeout fixture ⇒ midpoint offer), `roster.tier.spec.ts` (all 12 are `fictionalized`; `predatoryAllowed` only where `subject_id` is null).

## 13. People and board (hiring, options, founder, board control)
Specified here because they consume the option pool and the cap table. Tests: `tycoon.hiring.spec.ts` and `tycoon.board.spec.ts` (part A §9). All draws are counter-RNG draws (part C §3).

### 13.1 Hiring
1. **Market.** Each week up to 3 new `Candidate`s appear per role (pool <= 12 per role, expiry 6 weeks). Skill = `clamp(round(normal(5, 2) + reputation/50), 1, 10)` from draws `hire:<week>:<n>`; `askYr = roleBase*(0.6 + 0.12*skill)*wageMul*(1 + 0.1*climate)`; role bases: eng $140,000, design $120,000, growth $110,000, sales $130,000, ops $100,000 (design; a fictional market, not a benchmark).
2. **Offer.** `hireOffer{salary, optionBp}` resolves in 1-3 weeks (counter draw). `acceptP = clamp(0.35 + 1.6*(salary/ask - 1) + min(0.25, optionBp/200) + reputation/400, 0.05, 0.95)`. Options come from `pool.available`; an offer larger than the pool is rejected with `POOL_EXHAUSTED` (top up at the next priced round).
3. **Vesting.** Four years (208 weeks), 52-week cliff, weekly after; unvested options of a leaver return to the pool, vested ones stay with the leaver as common.
4. **Morale.** Individual morale reverts 5 % per week toward 70; crunch -1.5, layoffs -10 to everyone (-5 for a single fire), down round -15, positive events per part C. Attrition per employee and week: 0 if morale >= 40, else `(40 - morale)/40*0.02`.
5. **Fire.** Severance four weeks of salary; firing over 20 % of headcount within 8 weeks adds `reputation -5`.

### 13.2 Founder
`founderMorale` 0-100: -2 per crunch week, +8 per `rest` week, +4 on a round close, -20 on `biz.founder_burnout`; at 0 the run ends `burnout`. Archetype and co-founder modify dev power and fundraising mood (part A §4.3); a co-founder splits the founder common 60/40. A `biz.cofounder_dispute` event is a stretch item for M09b1.

### 13.3 Board and control
1. Seats start `['founder']` (two with a co-founder). A round's `boardSeats` adds `vc:<id>` seats; a priced Series A can add one `independent` seat through `counter` field `board`.
2. `founderControl = founderSeats > investorSeats` (independents swing the vote, point 4).
3. Board meetings every 13 weeks once any priced round has closed. The board sets a quarterly ARR-growth target (seed 10 %, A 15 %, B 12 %, C 10 %; design). The player picks `approveBudget` or `ignore` (ignoring after a missed target costs reputation 3).
4. Two consecutive missed targets with `founderControl` false trigger an ousting vote: each non-founder seat votes to oust with `p = clamp(0.15*missedStreak + 0.25*(1 - reputation/100) + 0.2*[last round was a down round], 0, 0.95)` drawn from `board:<week>:<seat>`; ousted if the votes exceed half of all seats. Founder seats never vote to oust. Outcome `ousted` (a loss with the score from the payout at that moment).
5. Down round: a priced round with post-money below the previous post-money gives morale -15 and hype -10; the seat renegotiation event is part C content at M09b1.
