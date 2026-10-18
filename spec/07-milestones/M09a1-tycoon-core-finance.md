# M09a1 — tycoon-core-finance

## Goal
After this session the repository has the deterministic heart of Business Tycoon. It is a pure, seeded weekly company simulation in `@dv/shared/tycoon` (setup, `stepWeek`, product, market, hiring, board, win/lose, score, commands, `replay`, `verifyRun`, `hashCompany`) with the finance core in `@dv/shared/tycoon/finance`:
- cap table with conservation;
- post-money SAFE conversion;
- priced round with option-pool shuffle;
- liquidation waterfall;
- deterministic term-sheet envelope.

The finance core passes every test vector TV-1…TV-11 and WF-1…WF-7 exactly. A thin C06 adapter `TycoonModeSim` paces weeks inside the 60 Hz sim, saves the `mode:tycoon` slice and offers a QA text panel. Events are an empty list. Negotiation is the automatic envelope midpoint. One sector (`b2b-saas`) ships. The descriptor stays `comingSoon`.

## Requirements
- R-MODE-04: founder-vs-VC simulation, cap-table math, and win/lose conditions. Investors and events come in M09a2 and M09b2.
- R-MODE-05 (support): the descriptor and `unlock.tycoon` are registered as `comingSoon`, so the story stub path can already emit the unlock.
- R-ENG-01: replay from `(setup, choices)` and golden traces make tycoon behaviour checkable in CI.

## Depends on
- **M01a1**: `detmath`, `ctrU32`, `splitmix32`, `fnv32`, `Fnv64`, `canonicalize`, the determinism lint.
- **M04a2**: `ModeHost`, `ModeContext`, the unlock registry, C06 descriptors, the save slice plumbing (C05).
- **M04d**: the det-suite registry `tests/e2e/det/suites.ts` used by AC-9 (DL-219).
- Contracts: C02 1.1 (stateless `ctrU32` allowed), C05 1.1 (slot `mode:tycoon`, migrations, golden rule), C06 1.1 (`GameModeDescriptor`, `GameModeSim`, `UnlockDef`).

## Scope in
- **Shared core, `packages/shared/src/tycoon/`.** The types of `08-tycoon.md` §4.2–§4.5 verbatim (`CompanyState`, `RunSetup`, `SectorDef`, `Command`, `ChoiceRecord`, `RunResult`), plus:
  - `setupFromSeed`, `newRun`, `applyCommand` (phase validation, the `allocation` sum, the marketing cap, pool sufficiency for `hireOffer`, `startRaise` spacing; typed `CommandError`);
  - `stepWeek`, in the §5.2 order and with the §5.3 equations;
  - valuation reference §5.4; climate §5.7; hiring, vesting, morale, attrition, founder and board (finance §13);
  - win, lose, insolvency and the bridge note (§5.10); score (§5.11);
  - `replay`, `verifyRun`, `hashCompany` (FNV-1a-64, two u32 lanes) and `policyView`.
  - Counter-RNG streams `hire:<week>:<n>` and `board:<week>:<seat>` through `ctrU32` / `ctrFloat`. `normal` = sum of 12 `ctrFloat` draws − 6.
- **Finance core, `packages/shared/src/tycoon/finance/`:**
  - `mulDivFloor`/`mulDivCeil` (BigInt);
  - `CapTable` and `assertConserved` (throws in tests, returns `CAPTABLE_INVARIANT` in production);
  - `convertSafes` (cap, discount, MFN, `capDiscount`, `SAFE_STACK_LIMIT`, ≤ 16 iterations);
  - `priceRound` (`TERMS_INFEASIBLE`, top-up, `priceMicros`, legal fee);
  - `waterfall` (pari passu, the conversion search, rounding remainder to common);
  - `termSheetEnvelope` (§8 steps 1–9, constants under `finance.*`).
- **Negotiation stub:** `startRaise`, then a `scheduleMeeting` that immediately offers `envelope.midpoint` at mood 50, then `accept` or `walk`. Closing takes 2 weeks. No mood, questions or LLM.
- **Content and config:**
  - `content/tycoon/{sectors.json (b2b-saas only), theses.json (3 cards), archetypes.json}`;
  - `config/tycoon.balance.json` with schema `tycoon.balance.v1`; `balanceVersion` = the first 12 hex characters of the SHA-256 of its canonical JSON;
  - `contentVersion` computed the same way over `content/tycoon/**`.
- **Mode adapter, `packages/modes/tycoon/`:**
  - the descriptor of `08-tycoon.md` §3.1 with `status: 'comingSoon'` and `tycoonUnlock`;
  - `TycoonModeSim` in `SimStage.Script`: 1,200 / 600 / 300 ticks per week, a command queue drained at the week boundary, auto-pause on `awaiting`, save moments per §4.6.3;
  - a QA-only text panel (QA builds): start a seeded run, issue commands, step one week, show the hash.
- **Save slice `TycoonSlice` schema 1:**
  - load path per §4.6.2: replay, hash compare, snapshot fallback that marks the run `unverifiable`;
  - migration table entry and golden `packages/engine/src/sim/save/__golden__/tycoon/v1.json`.
- **Cross-browser:** the `@tycoon-det` e2e suite registered in the M04d det registry.

## Scope out
- The event engine, the 30 events, bots, `tools/ci/tycoon-sim` and `check:balance` bands: M09a2.
- `status: 'available'` (QA builds): M09a2.
- Dashboard and all player UI, the two extra sectors, branch replay: M09b1.
- The negotiation state machine with mood and questions, VC souls, LLM dialogue, the `mini8w` preset, the story hook, dividends: M09b2.
- The route 21 `tycoon.` validator: M12e. `verifyRun` exists from here.

## Deliverables
To stay under 40 files, module responsibilities are grouped. The names in `08-tycoon.md` §3.2 describe responsibilities, not mandatory file names.
- `packages/shared/src/tycoon/`:
  - `types.ts` and `content.ts` (loader and validator);
  - `setup.ts`, `step.ts` and `company.ts` (product, market, revenue, costs, valuation, climate);
  - `people.ts` (hiring, founder, board) and `end.ts` (win, lose, score);
  - `commands.ts`, `replay.ts` (`replay`, `verifyRun`, `hashCompany`) and `index.ts`.
- `packages/shared/src/tycoon/finance/{types.ts, muldiv.ts, captable.ts (SAFE + priced round), waterfall.ts, envelope.ts, index.ts}`.
- Tests, colocated so that the plan's path filters match:
  - `packages/shared/src/tycoon/finance/{finance.vectors.spec.ts, finance.property.spec.ts, envelope.spec.ts}`;
  - `packages/shared/src/tycoon/{tycoon.step.spec.ts, tycoon.core.spec.ts, tycoon.replay.spec.ts, tycoon.nolint.spec.ts}`;
  - `packages/shared/src/tycoon/__fixtures__/{banned-math.ts.txt, step-trace.golden.json}`.
  - Make sure the vitest workspace includes `packages/*/src/**/*.spec.ts` and that the determinism lint skips `*.spec.ts`.
- `packages/shared/package.json` script **`test:tycoon-finance`** (`vitest run src/tycoon/finance`). `check:unit` also runs it.
- `packages/modes/tycoon/{package.json (@dv/mode-tycoon), src/descriptor.ts, src/sim/TycoonModeSim.ts, src/sim/slice.ts, src/qa/QaPanel.tsx, test/tycoon.mode.spec.ts, test/tycoon.save.spec.ts}`.
- `packages/engine/src/sim/save/migrations/tycoon.ts` and `packages/engine/src/sim/save/__golden__/tycoon/v1.json`.
- `packages/shared/schemas/tycoon/{slice-1.schema.json, balance-1.schema.json}`.
- `content/tycoon/{sectors.json, theses.json, archetypes.json}` and `config/tycoon.balance.json`.
- `config/unlocks.json`: add `unlock.tycoon` (`source: 'base'`, `grants.menuTile: 'tycoon'`) if absent.
- `tests/e2e/det/suites.ts` (add `@tycoon-det`), `tests/e2e/tycoon/tycoon-det.spec.ts` and `tests/e2e/tycoon/tycoon-qa.spec.ts` (`@tycoon-qa`). The Node golden lives at `tests/golden/tycoon/det-001.json`.
- About 38 files.

## Interfaces
- C06 1.1: the `GameModeDescriptor` with id `tycoon`, `saveSlot: 'mode:tycoon'`, `sliceSchema: 1`, `world: 'none'`, `simProfile: 'any'`.
- C05 1.1: one `mode:tycoon` record per profile, kept under 100 KB.
- C02 1.1: `ctrU32` for every tycoon draw. The mode uses no `ctx.rng` stream.
- New pure APIs of `@dv/shared/tycoon` are module-level APIs, not contracts. No contract shape changes. The C02 clarification proposed by `08-tycoon-events.md` §3 is already covered by C02 1.1 `ctrU32`.

## Acceptance criteria
- AC-1 Given the base table (founders 9,000,000 common; pool 1,000,000; FD0 10,000,000) When the finance vectors run Then TV-1…TV-11 give exactly the share counts, `X`, `T`, `newShares`, post-money FD, `priceMicros`, iteration counts and error codes of `08-tycoon-finance.md` §7, and WF-1…WF-7 give exactly the listed cents per class — proof: `pnpm check:unit -- packages/shared/src/tycoon/finance`
- AC-2 Given 200 seeded random cap tables and exit values When the property suite runs Then shares are conserved after every operation, `Σ payouts === E`, every class payout is non-decreasing in `E` and never above `E`, and the waterfall is invariant to class insertion order — proof: `pnpm --filter @dv/shared test:tycoon-finance`
- AC-3 Given company fixtures When `termSheetEnvelope` runs Then FOMO never exceeds 1,500 bp; an empty amount or dilution band returns `Pass`; `participating` or a multiple above 1 appears only for a `predatoryAllowed` VC with climate < −0.3 or runway < 12 weeks; walk-away triggers at reputation < 20, tech debt > 80 or mood < 10; the midpoint at mood 50 with a neutral style is the band centre — proof: `pnpm check:unit -- packages/shared/src/tycoon/finance`
- AC-4 Given the fixture `banned-math.ts.txt` copied under `packages/shared/src/tycoon/` inside the test When ESLint runs with the determinism config Then `Math.pow`, `Math.random`, `**` and `Date` each report an error; the real `packages/shared/src/tycoon/**` reports none — proof: `pnpm check:unit -- packages/shared/src/tycoon && pnpm lint`
- AC-5 Given seed 0xC0FFEE with `setupFromSeed` and a recorded 120-week choice list When the run steps Then the week-by-week `hashCompany` values equal `step-trace.golden.json`, and changing one choice at week 60 changes every later hash — proof: `pnpm check:unit -- packages/shared/src/tycoon`
- AC-6 Given illegal commands (hire in phase `idea` with no pool, an allocation summing to 99, marketing above `2 × max(cash/8, MRR/4.33)`, `startRaise` 3 weeks after a close) When `applyCommand` runs Then each returns its typed `CommandError` and the state hash is unchanged — proof: `pnpm check:unit -- packages/shared/src/tycoon`
- AC-7 Given crafted states When `stepWeek` reaches each end condition Then each `EndKind` except `miniWin`/`miniLose` results as specified: `acquisition`, `unicorn`, `ipo`, `ramen` (26 profitable weeks at ARR ≥ $1 M), `insolvent` (a declined bridge, or a second shortfall), `ousted` (the vote at 2 missed targets without control), `burnout`, `quit` — proof: `pnpm check:unit -- packages/shared/src/tycoon`
- AC-8 Given a finished run When `replay(setup, choices)` runs twice and `verifyRun` checks the claimed result Then both replays give the identical state hash and `RunResult`, `verifyRun` returns `ok`, a result with one changed field returns `mismatch`, and a different `contentVersion` returns `contentVersion` — proof: `pnpm check:unit -- packages/shared/src/tycoon`
- AC-9 Given the `@tycoon-det` RunSpec (three seeds, 150 weeks each, recorded choices) When it runs in the browser through the QA bridge Then the final hashes equal the Node golden `tests/golden/tycoon/det-001.json` in WebKit and in Chromium — proof: `pnpm check:e2e -- --project=webkit-webgl2 --grep @tycoon-det` and `pnpm check:e2e -- --project=chromium-webgl2 --grep @tycoon-det`
- AC-10 Given `TycoonModeSim` in the headless host When the same choices run at 1×, 2× and 4× Then the hash at week 20 is identical; a hidden page or a paused clock runs no week; `awaiting: 'meeting'` holds the clock until a command arrives — proof: `pnpm check:unit -- packages/modes/tycoon`
- AC-11 Given a 300-week run When the slice is saved and loaded Then it validates against `slice-1.schema.json`, is under 100 KB, equals the v1 golden for the fixture run, and with a changed `balanceVersion` loads from the snapshot marked `unverifiable` without losing the run — proof: `pnpm check:unit -- packages/modes/tycoon`
- AC-12 Given a QA build When the main menu opens Then the tycoon tile renders locked as `comingSoon`, and the QA panel can start a seeded run and step weeks — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @tycoon-qa`
- AC-13 Given the branch When typecheck and build run Then both pass and the app is otherwise unchanged — proof: `pnpm typecheck && pnpm build`

## Test plan
- **Unit and golden:** finance vectors, properties, envelope (`pnpm --filter @dv/shared test:tycoon-finance`, also inside `check:unit`); core step trace, commands, end kinds, replay and lint fixture (`pnpm check:unit -- packages/shared/src/tycoon`); mode conformance and save (`pnpm check:unit -- packages/modes/tycoon`).
- **E2E:** `@tycoon-qa` (locked tile, QA panel) on `chromium-webgl2`.
- **State-hash e2e:** `@tycoon-det` on `webkit-webgl2` and `chromium-webgl2`. Nightly runs it through the det-suite grep (`spec/08-test-and-ci.md` §5.5).
- No device or perf gate. The 0.5 ms `stepWeek` design budget is recorded in M09b1, not asserted here.

## Demo script
1. `pnpm --filter @dv/shared test:tycoon-finance`: 18 vectors and the property suite pass.
2. `VITE_DV_QA=1 pnpm dev`, then open the QA tycoon panel.
3. Start seed 1, set allocation to 60/25/15, step to launch, start a SAFE raise, accept the midpoint.
4. Step 20 weeks and read the cap table and the hash. Reload and replay the same choices to get the same hash.

## Effort
1 Builder session; about 38 files; risk **low-medium**. The finance code is exact integer work with given oracles. The volume of the company model is the time sink.

## Risks & fallbacks
- **Vector mismatch from rounding order.** Follow §4–§6 step by step: sort SAFEs by `(signedWeek, id)`, use `mulDivFloor` only where the product can pass 2⁵³, and use doubles with `+ − × ÷` only for the cap ratios. If a vector still differs, the reference values win. Record the derivation in the PR, never edit the vector.
- **The `detmath.exp` dependency** appears only in event hazards (M09a2). Nothing here needs a transcendental.
- **File count:** if more than 40 files are needed, move the QA panel to M09a2 and keep the headless mode tests.

## Notes for the Builder
- Read first: `08-tycoon.md` §3.1–§5.15; `08-tycoon-finance.md` §2–§9 and §13; `01-engine-save-modes.md` §C05 and §C06; `01-engine-contracts.md` C02 1.1.
- Order of work:
  1. finance (vectors first, test-driven);
  2. types and content;
  3. company equations;
  4. people and end;
  5. commands;
  6. replay and hash;
  7. mode adapter;
  8. slice;
  9. e2e.
- Money is integer cents everywhere, and finance works in basis points. Round cash once per week with `Math.round`. No `Math.pow`, `sqrt` or `**` anywhere under `packages/shared/src/tycoon`.
- Facts: none external (spec/03 §6 row M09a1). U-TYC-1 (Carta dilution) only centres a design constant and is never asserted.
- Secrets: none.
