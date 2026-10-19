# M09b1 — tycoon-ui

## Goal
After this session Business Tycoon has a full player UI on the S10 shell. These views run over the C06 1.1 `UiBridge`:
- Dashboard;
- Cap table, with a live exit-value waterfall slider and a term-sheet diff;
- Hiring board;
- Roadmap and marketing;
- Event inbox;
- Board meeting;
- the pitch card (a flat card with the deterministic offer);
- Run summary, with branch replay from a chosen week.

The views are accessible (every chart has a table view, keyboard, gamepad and touch, reduced motion, non-colour cues), use a single-column mobile layout with a bottom tab bar, and never rely on hover. The content grows to three sectors (`consumer-app` and `ai-tooling` join `b2b-saas`) and 60 events. The balance gate stays green, and a run killed at week 40 resumes with an identical hash.

## Requirements
- R-MODE-04: the founder-vs-VC loop is playable end to end through a real UI (hiring, rounds, events, board, win/lose summary).
- R-ENG-04: remappable focus navigation, colourblind-safe cues, reduced motion, text scale, a table view for every chart.
- R-UI-03: the mode's pages exist inside the shell's navigation and settings (the mode options panel).

## Depends on
- **M09a2**: the event engine, the 30 events, the bots, the `check:balance` tycoon suite, QA availability.
- **M04b2**: `UiSurface`, HUD kit, touch layouts, phone frame; M04b1 shell, kit, focus navigation, i18n and the `@ui-a11y` axe harness.
- Contracts: C06 1.1 (`UiBridge`, `ViewModelSource`, `VmKey`, `VmPatch`, `UiCommand`, `GameModeUI.summary`, `settingsPanel`), C05 1.1 (`accessibility.pauseOnTycoonEvents`, `hudPalette`), C03 1.1 (`tycoon` and `menu` input contexts).

## Scope in
- **View models.** `TycoonVm`, published by `TycoonModeSim` through `ViewModelSource`:
  - patches at week boundaries and on commands only;
  - numbers as cents or basis points;
  - the sim never formats text (§5.12).
  - UI commands map 1:1 onto sim `Command`s.
- **Views** (`08-tycoon.md` §5.12):
  - **Dashboard:** runway gauge, MRR, users and burn charts, speed buttons 1×/2×/4×, pause.
  - **Cap table:** pie and table, plus an exit slider that calls `waterfall()` live and a term-sheet diff.
  - **Hiring:** candidates, salary and option sliders, team morale.
  - **Roadmap:** allocation, marketing, price, office.
  - **Inbox:** a fictional workplace chat with choice cards and `aria-live="polite"`.
  - **Board meeting:** `approveBudget`/`ignore`.
  - **Pitch card:** envelope summary and the midpoint offer with accept or walk. Free text and VC portraits come in M09b2.
  - **Run summary:** score, timeline, and "replay from week N" branch replay.
  - **New-run setup:** sector, thesis from 3 dealt cards, founder archetype, co-founder, hardcore greyed until the first ramen win.
- **Accessibility:**
  - every chart has a `<table>` view;
  - roving tabindex; number keys 1–3 for answer options; gamepad `UiUp/Down/Left/Right/Accept/Back`;
  - touch targets ≥ 44 px;
  - `hudPalette` patterns and icons as non-colour cues;
  - reduced motion removes count-up and chart animation; text scale follows settings;
  - the "Game ruleset, not financial or legal advice" strip on the cap-table and pitch views.
- **Layouts:**
  - desktop multi-column;
  - mobile single column with a bottom tab bar and sparklines that expand on tap;
  - safe-area insets.
  - Charts redraw at most once per second; `mobile-low` animates one chart.
- **Panel descriptors.** Each view is registered as a `UiSurface` screen definition, so the S10 XR panel host (M11b3) can place it later. The XR desk scene, comfort and `@tycoon-xr` are M11b4.
- **Content:**
  - sector rows `consumer-app` and `ai-tooling` (`08-tycoon.md` §4.3);
  - unlock rule in `config/tycoon.balance.json` `sectors.unlock`. Default: `consumer-app` after the first finished run, `ai-tooling` after the first win. Record it under Builder decisions.
  - 30 more events (variants inside the five families, total 60), with LocKeys and `ui/ty-card-<id>` art refs (authored placeholder cards, provenance `authored`);
  - re-tune `config/tycoon.balance.json` so bands B1–B11 still pass with three sectors.
- **Mode options panel** via `GameModeUI.settingsPanel()`: default speed and the `pauseOnTycoonEvents` mirror. The menu-tile summary comes from `GameModeUI.summary(slice)` (best tier, last run).
- **Perf record:** the `stepWeek` cost on the desktop QA build is logged to the console report (design budget 0.5 ms on `mobile-low`; the device value is recorded in M11a).

## Scope out
- VC souls, LLM dialogue, the negotiation FSM with mood and questions, the 3D pitch room, the `mini8w` preset, the story hook and dividends: M09b2.
- The XR desk scene, world-locked panel placement and `@tycoon-xr`: M11b4 (after the M11b1 port and the M11b3 panel host).
- `biz.cofounder_dispute` stretch event: optional; skip if the session runs long.
- The `tycoon.daily` board: M12e.

## Deliverables
- `packages/modes/tycoon/src/ui/`:
  - `TycoonUI.tsx`, `vm.ts` and `commands.ts`;
  - `views/{Dashboard.tsx, CapTable.tsx, Hiring.tsx, Roadmap.tsx, Inbox.tsx, Board.tsx, PitchCard.tsx, Summary.tsx, NewRun.tsx}`;
  - `kit/{Chart.tsx, DataTable.tsx, TabBar.tsx}`, `settingsPanel.tsx` and `summary.ts`.
- `packages/modes/tycoon/src/sim/`: edit `TycoonModeSim.ts` (VM publishing, branch replay entry).
- `packages/shared/src/tycoon/replay.ts`: add `replayUntil(setup, choices, week)` for branch replay, a pure helper.
- `content/tycoon/sectors.json` and `content/tycoon/events/*.json` (30 added); `content/ui/i18n/en.json` keys `tycoon.*` and `tycoon.events.*` (DL-222, DL-247); `assets/src/ui/ty-card-*/asset.json`, as one shared authored card family with per-event tint (provenance `authored`).
- `config/tycoon.balance.json`, re-tuned. Regenerate `tests/tycoon/baseline.json` with a `balance-rebaseline:` commit line.
- Tests:
  - `packages/modes/tycoon/test/{ui.vm.spec.ts, ui.waterfall.spec.ts, ui.redraw.spec.ts, branch.spec.ts}`;
  - `tests/e2e/tycoon/{tycoon-a11y.spec.ts, tycoon-save.spec.ts, tycoon-touch.spec.ts, tycoon-keys.spec.ts}`.
- About 36 files.

## Interfaces
- C06 1.1 `UiBridge`: `VmKey` `tycoon.*`. `UiCommand`s are mapped onto sim `Command`s, and the UI never mutates state.
- C05 1.1: reads `accessibility.pauseOnTycoonEvents`, `hudPalette` and `reducedMotion`; writes only `mode:tycoon` through the sim.
- C03 1.1: `tycoon` and `menu` contexts.
- No contract shape changes. `replayUntil` is a module API.
- Optional input (D-31, DL-504): `third_party/sf-bay-area-ai-atlas/` company dataset (CC BY 4.0) when `docs/legal/third-party-reuse.json` lists it in `allowedPaths` with a `pinnedSha`. Absent by default; nothing here depends on it.

## Acceptance criteria
- AC-1 Given each of the nine views open in a QA run When axe runs Then there are zero critical or serious violations, every chart has a reachable table view with the same numbers, and the advice strip is present on the cap-table and pitch views — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @tycoon-a11y`
- AC-2 Given a run at week 40 with two queued commands When the tab is killed after the save moment and the app is reloaded Then the run resumes at week 40 with the same `hashCompany` and both commands applied once — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @tycoon-save`
- AC-3 Given keyboard only When the player starts a run, sets allocation, makes a hire offer, answers an inbox event with key 2 and accepts the pitch-card offer Then each action reaches the sim and focus order follows reading order; the same flow passes with gamepad navigation actions — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @tycoon-keys`
- AC-4 Given the WebKit project at the iPhone viewport 844 × 390 with touch When the dashboard, cap table, hiring and inbox open Then the layout is one column with a bottom tab bar, every interactive target is at least 44 × 44 px, and every control works by tap with no hover state required — proof: `pnpm check:e2e -- --project=webkit-webgl2 --grep @tycoon-touch`
- AC-5 Given the TV-3 cap table after its round When the exit slider is set to $10 M, $14 M and $20 M Then the displayed class payouts equal WF-3, WF-5 and WF-6 exactly — proof: `pnpm check:unit -- packages/modes/tycoon`
- AC-6 Given a finished run When branch replay starts from week 30 Then the state hash at week 30 equals the original, a different choice at week 30 changes later hashes, and the original run in the slice history is unchanged — proof: `pnpm check:unit -- packages/modes/tycoon`
- AC-7 Given reduced motion on, or the `mobile-low` tier When the dashboard updates for 10 weeks Then no chart animates under reduced motion, at most one chart animates on `mobile-low`, and no chart redraws more than once per second — proof: `pnpm check:unit -- packages/modes/tycoon`
- AC-8 Given three sectors and 60 events When the balance gate runs at 2,000 runs per policy Then B1–B11 pass, and all 60 events validate (unique ids, existing follow-ups, LocKeys present) — proof: `pnpm check:balance -- --suite tycoon && pnpm check:unit -- packages/shared/src/events`
- AC-9 Given a fresh profile When runs end Then `consumer-app` unlocks after the first finished run and `ai-tooling` after the first win, hardcore becomes selectable after the first `ramen` win, and `unlockedSectors` persists in the slice — proof: `pnpm check:unit -- packages/modes/tycoon`
- AC-10 Given the cross-browser det suite When `@tycoon-det` runs after the UI lands Then the hashes still equal the Node golden in WebKit — proof: `pnpm check:e2e -- --project=webkit-webgl2 --grep @tycoon-det`
- AC-11 Given the event text, sector names and card art When the IP gates run Then no real company, brand or official's name appears, and every new card asset has a provenance record — proof: `pnpm names:lint && pnpm ip:strings && pnpm provenance:check`

## Test plan
- **Unit:** VM mapping, waterfall slider, redraw scheduler, branch replay, sector unlocks (`pnpm check:unit -- packages/modes/tycoon`).
- **E2E:** `@tycoon-a11y`, `@tycoon-save`, `@tycoon-keys` (`chromium-webgl2`); `@tycoon-touch` (`webkit-webgl2`); `@tycoon-det` regression; `@tycoon-smoke` from M09a2 stays green.
- **Bot-run:** `check:balance -- --suite tycoon` with three sectors.
- **IP gates:** `names:lint`, `ip:strings`, `provenance:check`.

## Demo script
1. `VITE_DV_QA=1 pnpm dev`, then open `/?unlockAll=1` and the Tycoon tile.
2. New run: pick `b2b-saas`, a thesis, the engineer founder.
3. Set allocation to 60/25/15 and marketing, then play at 4× until launch.
4. Hire an engineer with options, answer an inbox event, start a SAFE and accept the pitch-card offer.
5. Open the cap table and drag the exit slider to watch the waterfall.
6. Open the iPhone viewport in DevTools: one column with a tab bar.
7. Finish or quit, then open the summary and replay from week 30.

## Effort
1 Builder session; about 36 files; risk **medium**. The view volume is high. The 30 extra events and the re-tune compete for time. Order the work so that the balance gate is green before the polish.

## Risks & fallbacks
- **Re-tune fails with three sectors.** Gate new sectors behind their unlocks and tune per sector through `sectors.*` multipliers. If time runs out, ship `ai-tooling` disabled in content (`enabled: false`) and report.
- **Axe findings in charts.** The table view is the accessible path, so mark the SVG `aria-hidden` and give the table the label.
- **Event art volume.** One authored card family with tints and icons, no per-event illustration.

## Notes for the Builder
- Read first: `08-tycoon.md` §4.6, §5.1, §5.11–§5.12, §6; `10-ui.md` §3.3 (UiBridge shapes); `10-ui-pages.md` (mode select, settings accessibility rows); `10-ui-hud-xr.md` §2 (HUD and touch kit).
- Order of work:
  1. VM and commands;
  2. Dashboard and Roadmap;
  3. Inbox and Hiring;
  4. Cap table;
  5. Board, Pitch card and Summary;
  6. mobile layout;
  7. content and re-tune;
  8. e2e.
- Format numbers in the UI only, with `Intl` (UI code is outside the determinism lint scope). Display percentages derive from basis points and never flow back to the sim.
- Facts: F-013 (XR desk-panel budget) is consumed only when M11b4 places these panels. Nothing external is asserted here.
- Secrets: none.
- Third-party reuse (ADR-REUSE-01, DL-504): if the Atlas company dataset is vendored and M00f `third-party-reuse-gates` has merged (`tools/ci/third-party-licenses.ts` exists on your branch's base, `main`; otherwise ignore `third_party/`), you may use the categorical fields of its subset file (`*.subset.json`, DL-502) as seed data for the `ai-tooling` sector's flavour (category mix) and for invented company and event names. Its location, coordinate and building-link fields are OSM-derived (ODbL-1.0) and are not vendored; derive any district mix from the project's own OSM/DataSF bake: any OSM-derived table you commit records `derived_from` the world pack and is covered by the derived-database offer at the OSM entry's `offerUrl` in `config/attribution.world.json` (ADR-0021; M14b3 `odbl-offer`), or is computed at runtime from the shipped pack. Read vendored data only from a `tools/{map,assets,ci,soul}` script that writes the derived `content/` file; never import `third_party/` from `apps/`, `packages/` or `services/`. Every shipped name is invented and passes `names:lint` and `ip:strings` (AC-11; it counts as proven only from the CI run with `DV_NAMES_REAL_JSON` present, which holds the dataset's company names, never from a local SKIP); a real company name never enters `content/`, `config/` or the client (real-side NameRegistry only, tiers per D-29); logos are never used. A content file derived from the dataset gets a provenance record (`origin: open_data`, `CC-BY-4.0`, the NOTICE attribution, `derived_from` the vendored file's SHA-256), and the credits page renders the `third_party/NOTICE` line that `provenance:check --emit-credits` writes into `credits.json` (M00f, DL-507, DL-631). If `third_party/` is absent, author the sector from `08-tycoon.md` §4.3 alone. Never open or fetch the upstream repository.
