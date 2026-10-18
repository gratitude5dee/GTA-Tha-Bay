# M09a2 — tycoon-events-balance

## Goal
After this session Business Tycoon reaches **VS-Tycoon**. The repository gains:
- the shared random-event engine in `@dv/shared/events` (types, the hazard model on counter RNG, distributions, predicates, effects, chains, safety limits), used by Tycoon now and by story businesses later;
- the Tycoon event host and the 30-event catalog in five families;
- the 8-card trend deck;
- four bot policies;
- the Monte-Carlo balance tool `tools/ci/tycoon-sim`, with bands B1–B12, a regression baseline and four self-test fixtures that must fail.

`pnpm check:balance` now runs the tycoon suite next to M04d's econ suite. A tuned `b2b-saas` run with SAFE, seed and Series A rounds, hiring, events and win/lose is playable in QA builds behind `?unlockAll=1`. Production still shows the tile as `comingSoon`.

## Requirements
- R-MODE-04: random-event engine with a probability and impact model across the business, political, natural, cultural and market families; win/lose tuned by bands.
- R-MODE-05 (support): the mode is reachable through the unlock registry in QA builds. The story unlock lands in M09b2.
- R-ENG-01: Monte-Carlo balance as a deterministic CI gate with failing self-tests (P-9: every system has a bot).

## Depends on
- **M09a1**: the tycoon core, finance, `replay`, `TycoonModeSim`, `TycoonSlice`.
- **M04d**: the `check:balance` runner with `--suite`, the `BotDriver` registry, mutants and the verifier lock, the det-suite registry.
- Contracts: C02 1.1 (`ctrU32`, `detmath.exp`), C06 1.1 (descriptor `status`, `UnlockRegistry`).

## Scope in
- **`packages/shared/src/events/`:** the types of `08-tycoon-events.md` §2 verbatim, plus:
  - `ctrFloat`;
  - distributions `fixed`, `uniform`, `normal` (Irwin–Hall, 12 draws), `lognormal` (`detmath.exp`, clamped);
  - the predicate evaluator (metrics, flags, `season` wrapping the year end, `all`/`any`/`not`);
  - the hazard roll per §3: eligible defs in ascending `id` order; factor clamp 0.1–8; `p = 1 − detmath.exp(−λ)`; streams `ev:<id>`, `evd:<iid>:<k>` and `evf:<iid>:<k>`; at most 2 new events per week; `SEVERE_GAP_WEEKS` 8;
  - effects per §4 (stocks once; modifiers with `none`/`linear`/`geometric` decay; multipliers clamped to 0.2–5);
  - chains per §5 (depth ≤ 4; follow-ups expire when `requires` fail; exclusive groups; `EFFECT_LIMITS` cash bound enforced at load and at runtime);
  - the content validator (§5.5).
- **`packages/shared/src/tycoon/events/`:** `TycoonEventHost` (maps `MetricOrDerived` onto `CompanyState`, applies `staff` and `round` effects to the cap table and term sheets) and the catalog loader. `stepWeek` step 2 now rolls events. Choice events enter the inbox with `deadlineWeek = week + 2` and auto-resolve with `defaultChoiceId` unless `pauseOnTycoonEvents` is set.
- **Content:**
  - `content/tycoon/events/{business,political,natural,cultural,market}.json`: the 30 events of §6, with the system events `vc.retrade` and `fin.bridge_offer`. `pol.hardware_tariff` and `pol.permit_freeze` ship disabled (no hardware or mobility sector exists, Q-S08-01).
  - `content/tycoon/theses.json` grows to 8 cards.
  - LocKeys for every event title, body and choice go into `packages/ui/src/i18n/en-US/tycoon-events.json`.
  - `art` refs are `ui/ty-card-<id>`; an unresolved ref is a warning until M09b1.
- **Story reuse proof (§7):** the fixture host `tests/tycoon/fixtures/story-business.host.ts` runs the 10 `both`-scope events over 1,000 seeded business-years. Unmapped metrics are no-ops. The real wiring is M05e1.
- **`tools/ci/tycoon-sim/`:**
  - the CLI of §8 (`--runs`, `--policy`, `--seed-base`, `--content`, `--balance`, `--bands`, `--out`, `--sweep`, `--trace`, `--bands-only`);
  - policies `median`, `aggressive`, `frugal`, `random`, each with `decide(view, rng) → Command[]` on `PolicyView`;
  - bands B1–B12 in `config/tycoon.bands.json`;
  - the report with schema `tests/tycoon/report.schema.json` and a markdown summary written to the job summary;
  - the baseline guard in `tests/tycoon/baseline.json` (fails on moves above ±2 points for rates or ±8 weeks for lengths unless a commit line `balance-rebaseline: <reason>` is present);
  - self-test fixtures `dominant-strategy.balance.json` (trips B4), `chain-death.events.json` (B5), `easy-mode.balance.json` (B3) and `offer-out-of-band.bot.ts` (B11).
  - Negotiations use the offline midpoint path.
  - Each policy is also registered as a `BotDriver` with id `tycoon.<policy>`.
- **`check:balance` wiring:**
  - `--suite tycoon` runs 2,000 runs per policy; no `--suite` runs econ and tycoon;
  - the env `DV_BALANCE_RUNS=10000` (set only in `nightly.yml`) raises the run count;
  - `check:unit` carries a 200-run smoke of `median`.
- **Tuning:** use `--sweep` on `config/tycoon.balance.json` until B1–B12 pass, and record the chosen values in the PR.
- **Mode availability:** the descriptor `status` is `'available'` when `import.meta.env.VITE_DV_QA === '1'` and `'comingSoon'` otherwise. The QA panel gains an event inbox list and a "resolve" control. Story stays the only unlock path in production (M09b2).

## Scope out
- The player UI (dashboard, inbox cards with art, cap-table views), the two extra sectors and 30 more events: M09b1.
- The negotiation FSM with mood, questions, VC souls and dialogue; the `autoFounder` policy for the story mini-run: M09b2.
- Story businesses on `EventHost<BusinessState>`: M05e1 (DL-133).
- The `tycoon.daily` board: M12e.

## Deliverables
- `packages/shared/src/events/{types.ts, rng.ts, dist.ts, predicate.ts, engine.ts, effects.ts, validate.ts, index.ts}`.
- `packages/shared/src/tycoon/events/{host.ts, catalog.ts}`. Edit `step.ts` and `content.ts` (M09a1).
- Tests, colocated:
  - `packages/shared/src/events/{events.hazard.spec.ts, events.ctr.spec.ts, events.dist.spec.ts, events.effects.spec.ts, events.chain.spec.ts, events.content.spec.ts}`;
  - `packages/shared/src/tycoon/events/{events.story-host.spec.ts, tycoon.replay200.spec.ts}`.
- `content/tycoon/events/{business,political,natural,cultural,market}.json`; edit `content/tycoon/theses.json`; `packages/ui/src/i18n/en-US/tycoon-events.json`.
- `tools/ci/tycoon-sim/{cli.ts, run.ts, policies.ts, bands.ts, report.ts, baseline.ts}`, `tools/ci/tycoon-sim/test/{balance.bands.spec.ts, balance.selftest.spec.ts, determinism.spec.ts}` and `tools/ci/tycoon-sim/fixtures/{dominant-strategy.balance.json, chain-death.events.json, easy-mode.balance.json, offer-out-of-band.bot.ts}`.
- `config/tycoon.bands.json`, `tests/tycoon/{report.schema.json, baseline.json}`, `tests/tycoon/fixtures/story-business.host.ts`.
- `tools/ci/check-balance.ts` (M04d): register the `tycoon` suite.
- Root scripts **`tycoon:sim`** (`tsx tools/ci/run.ts tycoon-sim`) and **`tycoon:baseline`** (rewrites `tests/tycoon/baseline.json`).
- `.github/workflows/nightly.yml`: set `DV_BALANCE_RUNS: 10000` on the existing `check:balance` step.
- `packages/modes/tycoon/src/descriptor.ts` and `src/qa/QaPanel.tsx`; `tests/e2e/tycoon/tycoon-smoke.spec.ts` (`@tycoon-smoke`).
- About 38 files.

## Interfaces
- C02 1.1: `ctrU32` and `detmath.exp` are the only randomness and transcendental used. The counter RNG keeps rolls independent of content order.
- C06 1.1: the descriptor `status` changes by build flavour only. `UnlockApi` behaviour is unchanged (`?unlockAll=1` unlocks in memory, never persists).
- `EventEngine<S>` and `EventHost<S>` are module APIs of `@dv/shared` (S08-owned), not C## contracts. No contract shape changes.

## Acceptance criteria
- AC-1 Given ten (factor, MTTH) pairs When the hazard function runs Then `p` equals `1 − detmath.exp(−factor/MTTH)` to 1e-12 (MTTH 40 at factor 1 gives 0.0247 ± 1e-4), and the frequency over 100,000 counter draws per pair lies within ±3σ of `p` — proof: `pnpm check:unit -- packages/shared/src/events`
- AC-2 Given a catalog and a seed When one extra def is inserted at any position Then every other def's per-week roll is unchanged, and the `ctrU32` vectors equal the M01a1 golden file — proof: `pnpm check:unit -- packages/shared/src/events`
- AC-3 Given effect fixtures When a run steps through them Then stocks apply once and clamp to their legal ranges, modifiers decay as `none`/`linear`/`geometric` and expire at `endWeek`, multipliers clamp to 0.2–5, chains stop at depth 4, a follow-up whose `requires` fails expires silently, at most 2 events fire per week, and no two severity-4+ events fire within 8 weeks — proof: `pnpm check:unit -- packages/shared/src/events`
- AC-4 Given the shipped catalog and bad fixtures (unknown follow-up id, a chain cycle without cooldown, a missing LocKey, an `onFire` cash loss above `EFFECT_LIMITS`) When the validator runs Then the 30 shipped events load and each bad fixture fails with its rule id — proof: `pnpm check:unit -- packages/shared/src/events`
- AC-5 Given the fixture story-business host and the 10 `both`-scope events When 1,000 seeded business-years run Then no unmapped metric changes state, `officeClosed` maps to "shop closed", and two executions give identical traces — proof: `pnpm check:unit -- packages/shared/src/tycoon/events`
- AC-6 Given 200 random seeded runs with events When each is replayed from `(setup, choices)` Then every `RunResult` and final `hashCompany` equals the live value — proof: `pnpm check:unit -- packages/shared/src/tycoon/events`
- AC-7 Given 2,000 runs per policy (`median`, `aggressive`, `frugal`, `random`) When the tycoon balance suite runs Then bands B1–B11 pass and the run exits 0; B12 throughput is printed in the log and not asserted — proof: `pnpm check:balance -- --suite tycoon`
- AC-8 Given the four self-test fixtures When each runs through the harness Then `dominant-strategy` trips B4, `chain-death` trips B5, `easy-mode` trips B3 and `offer-out-of-band` trips B11, each with a non-zero exit code — proof: `pnpm check:unit -- tools/ci/tycoon-sim`
- AC-9 Given seed base 1 When the harness runs 200 `median` runs twice Then the two `report.json` files are byte-identical once `wallTimeMs` is removed — proof: `pnpm check:unit -- tools/ci/tycoon-sim`
- AC-10 Given a balance change that moves the median run length by 9 weeks When the baseline guard runs without a `balance-rebaseline:` line Then it fails; with the line and a baseline regenerated by `pnpm tycoon:baseline` it passes — proof: `pnpm check:unit -- tools/ci/tycoon-sim`
- AC-11 Given no `--suite` When the balance gate runs Then both the econ suite (M04d) and the tycoon suite run and the exit code is 0 — proof: `pnpm check:balance`
- AC-12 Given a QA build with `?unlockAll=1` When the tycoon tile is opened, a seeded run is started and the QA panel steps 20 weeks, resolving one choice event Then the run reaches week 20 with the event's effect visible in the panel; without the flag the tile is locked; a production build shows `comingSoon` — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @tycoon-smoke`
- AC-13 Given 10,000 runs When the harness runs on a developer machine Then it writes `tests/tycoon/report.json` that validates against `report.schema.json` and includes per-policy outcomes, dilution percentiles, event counts and lethality per root event — proof: `pnpm tycoon:sim -- --runs 10000 --policy median,aggressive,frugal,random --seed-base 1 --out tests/tycoon/report.json`

## Test plan
- **Unit and golden:** events (hazard, ctr, dist, effects, chain, content), story host, 200-replay (`pnpm check:unit -- packages/shared/src/events packages/shared/src/tycoon/events`).
- **Bot-run gate:** `pnpm check:balance -- --suite tycoon` on PRs (the `ci.yml` `content` job), 10,000 runs nightly.
- **Harness self-tests:** `pnpm check:unit -- tools/ci/tycoon-sim`. The four fixtures are also registered as mutants in `tools/ci/verifiers.lock.json` (M04d).
- **E2E:** `@tycoon-smoke` on `chromium-webgl2`. `@tycoon-det` from M09a1 stays green with events on; regenerate its golden through the M04d golden-update procedure.

## Demo script
1. `pnpm check:balance -- --suite tycoon`: the band table prints with every band green.
2. `pnpm tycoon:sim -- --runs 2000 --policy median --seed-base 1 --sweep finance.dilutionSeed=0.14:0.22:0.02 --out /tmp/sweep.json`: one band table per value.
3. `VITE_DV_QA=1 pnpm dev`, open `/?unlockAll=1`, start a tycoon run and step weeks until an event fires. Resolve it.
4. Set `pauseOnTycoonEvents` off and see the default choice taken at the deadline.

## Effort
1 Builder session; about 38 files; risk **medium**. Tuning to the bands is the uncertain part: the prototype showed knife-edge sensitivity in ARPU, k and CAC (RISK-S08-1).

## Risks & fallbacks
- **Bands cannot all pass in one session.** Tune within `config/tycoon.balance.json` only; never widen a band. If B1–B3 still fail, ship with the failing band ids listed in `config/tycoon.bands.json` `pendingTune` (CI fails visibly) and report. Do not mark VS-Tycoon reached.
- **Throughput.** B12 is logged only. If 2,000 runs per policy exceed about 2 minutes on the runner, profile `stepWeek` before cutting runs.
- **Nightly flake.** Fixed seeds make every result exact, so a nightly band failure is a regression, never noise.

## Notes for the Builder
- Read first: `08-tycoon-events.md` §1–§9; `08-tycoon.md` §5.2 and §5.10; `13-qa.md` §3.2 (BotDriver) and §3.6 (mutants); the M04d `check:balance` runner code.
- MTTH values come from the §6 table. Only `nat.quake_major` (1,226 weeks, derived from USGS FS 2016-3020's 72 % over 30 years) and `nat.blackout` cite external anchors, and no AC asserts them.
- Names: every company, regulator, official and endorser is invented, and the event text must pass `pnpm names:lint` and `pnpm ip:strings` (both in the `ip` CI job).
- Policies read only `PolicyView` and emit only `Command`s, so a bot run exercises the same validation as the UI.
- Secrets: none.
