# M04e5 — ip-wall-strings

## Goal
After this session no shipped string reuses the wording of the sandbox-trainer checklist in `research/repos-grand-v.md` §3. That checklist comes from GPL-3.0 trainer strings, so its rows may guide which features we build, never what we write (§5, rec 20). CI now stops that wording from coming back. Three things change:
- The teleport refusal, the control-reason English default, the HUD and phone heat labels, and the QA pursuit panel's toggle label get our own wording.
- The heat HUD drops the star row and its phase word, a presentation that belongs to another publisher's series: heat shows as five gauge bars drawn as inline SVG icons from the UI kit (lit and dim bars; DL-738), the phone's level buttons read "Heat 1" … "Heat 5", and the active phase reads "Pursued".
- Code comments that use the trainer's heat phrases get our "heat" vocabulary.
- `config/ip-denylist.json` gains three `patterns` entries (`trainer-status`, `trainer-heat`, `trainer-menu`) that the existing `ip:strings` scan applies to the tracked tree and to `apps/web/dist`. A guard test also keeps the bare heat word and star counts out of the English catalog.

This file names the patterns by id only. Their phrases live in `config/ip-denylist.json` and nowhere else in `spec/` (DL-717).

Identifiers (`sandbox.player.neverWanted`, `NEVER_WANTED`, `neverWanted()`, `engine.control.groundNotLoaded`, test ids) stay as they are. They are keys, not wording, and C05 saves and goldens depend on them.

## Requirements
- R-IP-01 (primary): original content only. No trainer-derived player-facing string ships, and `ip:strings` fails if one is added.
- R-UI-03 (support): the phone Sandbox app, the HUD heat chip and the teleport toast keep working, with new English values under the same keys.

## Depends on
- **M00b** (ip-provenance-gates): `tools/ci/ip-scan.ts` (`runIpScan`), `compileStringMatcher` and `scanText` in `packages/shared/src/assets/gates/ip.ts`, `STRING_SCAN_PATH_ALLOWLIST` in `packages/shared/src/assets/gates/types.ts`, `config/ip-denylist.json` with schema `ip-denylist/1` (`packages/shared/schemas/ip-denylist-1.schema.json`).
- **M02c1** (graph-services-teleports): `world.teleport.notLoaded` and its assertion in `tools/map/test/config.transit.spec.ts` l.29.
- **M03c** (pursuit-director): the QA pursuit panel `packages/engine/src/debug/pursuit-panel.ts` and `tests/e2e/engine/pursuit.spec.ts` (`@pursuit`).
- **M04b2** (creator-phone-hud-kit): `hud.heat.label`, `hud.heat.wanted`, `phone.sandbox.heat`, `phone.sandbox.heat1` … `heat5`, `phone.sandbox.neverOn` and `phone.sandbox.neverOff` in `content/ui/i18n/en.json`, read by `packages/ui/src/phone/apps.ts` and `packages/ui/src/hud/widgets.tsx`; `STATUS` and `heatStatus` in `packages/ui/src/hud/model.ts` (l.40-41 hold the two star icons); `HeatStars` in `packages/ui/src/hud/widgets.tsx` (l.57 comment, l.69 glyphs); `packages/ui/test/hud-status.spec.ts`.
- Through those: M01b1 (`CONTROL_REASON`, `CONTROL_REASON_EN` in `packages/engine/src/sim/control/states.ts`; `packages/engine/test/control.ownership.spec.ts` l.49), M04b1 (`content/ui/i18n/en.json`, `tools/ci/check-i18n.ts`).
- All of these are merged on `claude/build`.
- Precedent: DL-664 (b) put real brand words into the existing `words` list with no schema change. This milestone does the same with `patterns`.
- Contracts: none changed. C05 1.2 toggle paths and C06 1.1 `UiCommand` are read only.

## Scope in
- **Rewording** (exact new English values; the keys are unchanged):

  | Where | Key or symbol | New value |
  |---|---|---|
  | `content/ui/i18n/en.json` l.83 | `world.teleport.notLoaded` | `That part of the city is still on its way. Try again in a moment.` |
  | `packages/engine/src/sim/control/states.ts` l.79 | `CONTROL_REASON_EN[CONTROL_REASON.groundNotLoaded]` | the same string as `world.teleport.notLoaded` |
  | `en.json` l.682 | `hud.heat.label` | `Heat` |
  | `en.json` l.685 | `hud.heat.wanted` | `Pursued` |
  | `en.json` l.831 | `phone.sandbox.heat` | `Heat` |
  | `en.json` l.833-837 | `phone.sandbox.heat1` … `heat5` | `Heat 1` … `Heat 5` |
  | `en.json` l.838 | `phone.sandbox.neverOn` | `Heat lock: on` |
  | `en.json` l.839 | `phone.sandbox.neverOff` | `Heat lock: off` |
  | `pursuit-panel.ts` l.78 (QA build only) | checkbox label text | `heat lock` |

- **Heat glyphs** (`packages/ui/src/hud/`): `STATUS['heat.clear'].icon` and `STATUS['heat.wanted'].icon` name kit SVG icons (`shield`, `siren`; DL-738, BD-FIX-GLYPH-01), and `HeatStars` draws five SVG bars, lit or dim (`widgets.tsx`); no HUD icon is a text glyph, and its l.57 comment says "five heat bars". The component name, the class names (`dv-star`, `dv-star-on`, `dv-star-script`), the test ids, the heat phase ids and C06 `HeatState` stay as they are: they are identifiers, and `tests/e2e/ui/hud.spec.ts` counts `.dv-star-on`. The five heat icons stay distinct (`hud-status.spec.ts` l.40).

- **Tests that spell the old value:**
  - `packages/engine/test/control.ownership.spec.ts` l.49 and `tools/map/test/config.transit.spec.ts` l.29 assert the new string.
  - `tests/e2e/engine/pursuit.spec.ts` l.111 gets a new title (`… heat lock refuses it @pursuit`).
  - The same e2e case gains one assertion: the label that wraps `pursuit-never` has the text `heat lock`.
- **Comments.** Reword, using "heat" or "heat level", each comment in the scanned tree that holds a guarded phrase. These are `pursuit-panel.ts` l.3, `packages/engine/src/sim/modes/builtin/sandbox.ts` l.25, `packages/engine/src/sim/garage/garage.ts` l.101, `packages/engine/src/sim/world/index.ts` l.36, `packages/world/src/sim/api/teleport.ts` l.66 and l.70, and `packages/world/src/sim/streaming/module.ts` l.466. Only comments change, so the C02 lint and the sim hashes are untouched. In `packages/shared/src/contracts/c05-save.ts` two comments carry the study's limits (l.20 names the study as their source; l.94 repeats the trainer's per-preset op cap); they take the wording of `spec/04-data-models-saves-modes.md` and `spec/domains/01-engine-save-modes.md` (our design values, DL-732). The shape and values are unchanged.
- **Guard** (`config/ip-denylist.json`, `patterns`, all with flags `i`). These entries are denylist content: they name what must not appear, and none of them is wording for us to use. The Builder writes each regex as `\b(?:…)\b` alternatives, with `\s+` between the words of a phrase, from these sources only:
  - `trainer-status`: the English multi-word status and precondition phrases (never one-word statuses) of the last two rows of the table in `research/repos-grand-v.md` §3, and the current (old) values of `world.teleport.notLoaded` and `CONTROL_REASON_EN[CONTROL_REASON.groundNotLoaded]` as they stand on the base before this milestone;
  - `trainer-heat`: the English heat-control phrases of the §3 row whose feature column says "Police heat control", and the current values of `phone.sandbox.neverOn`/`neverOff` without their `: on`/`: off` suffix;
  - `trainer-menu`: the English multi-word menu labels of the §3 rows for player restore, vehicle spawning, vehicle list refresh, vehicle maintenance, time options and object placement, plus the object-placement tool's one-word name.

  `\s+` (not `\W+`) keeps camelCase and kebab-case identifiers (`neverWanted`, `godMode`, the button id `never-wanted` in `apps.ts` l.114, `sandbox.status.preparing`) from matching. `compileStringMatcher` adds the `g` flag itself. The schema already allows any `{id, regex, flags}`, so `ip-denylist/1` does not change. The phrase lists appear only in the config file, the Builder's BD row names the §3 rows used, and no spec, milestone or report quotes them.
- **Catalog words** (a case of the guard test, not a denylist pattern, because the heat phase id and the `hud.heat.wanted` key are identifiers that a repo-wide pattern would hit): no `en.json` value matches `/\bwanted\b/i` or `/\bstars?\b/i`, and `packages/ui/src/hud/{model.ts, widgets.tsx}` hold no U+2605 or U+2606 character.
- **Guard test** `tools/ci/test/ip-trainer-phrases.test.ts`. It follows the DL-664 tests in `ci-scripts.test.ts` and `gates.test.ts`: real config, `tempRoot()`-style copies of `config/`, and every guarded phrase built at run time from the config's alternatives (each `\s+` replaced by a space or a line break), never from literals in the test, so the file itself passes `ip:strings`. It covers AC-2, AC-3 and part of AC-6.
- **BD rows** in `spec/11-decision-log-builder.md` for the wording chosen and for using `patterns` rather than a new block.

## Scope out
- Spec and research text that quotes the old wording (`spec/` and `research/` are on the scan allowlist): the integrator edits it. The list is in the report.
- New sandbox status keys (streaming, spawn, need-vehicle): the GV sandbox-menu milestones write those in our own words under this guard.
- Renaming identifiers, class names, test ids, heat phase ids or C05 toggle paths.
- Other locales: none exists on `claude/build`, and new languages are post-v1 (M14c scope out).

## Deliverables
- `content/ui/i18n/en.json`; `packages/engine/src/sim/control/states.ts`; `packages/engine/src/debug/pursuit-panel.ts`; `packages/ui/src/hud/{model.ts, widgets.tsx}` (glyphs and one comment).
- Comment-only edits: `packages/shared/src/contracts/c05-save.ts` (l.20, l.94), `packages/engine/src/sim/modes/builtin/sandbox.ts`, `packages/engine/src/sim/garage/garage.ts`, `packages/engine/src/sim/world/index.ts`, `packages/world/src/sim/api/teleport.ts`, `packages/world/src/sim/streaming/module.ts`.
- `config/ip-denylist.json` (three `patterns`).
- Tests: `tools/ci/test/ip-trainer-phrases.test.ts` (new), `packages/engine/test/control.ownership.spec.ts`, `tools/map/test/config.transit.spec.ts`, `tests/e2e/engine/pursuit.spec.ts`.
- `spec/11-decision-log-builder.md` (BD rows).
- About 17 files.

## Interfaces
- `IpDenylistConfig.patterns` (`packages/shared/src/assets/gates/ip.ts`): three new entries; the type is unchanged.
- Other readers of the same matcher see the new patterns as well:
  - the username check in `services/edge/src/routes/auth.ts` scans `normalizeName(username)`, which strips every non-alphanumeric character, so a pattern that needs whitespace never matches a username;
  - `packages/shared/src/genai/prompt-lint.ts` and `services/pipeline/src/registry.ts` now refuse a genAI prompt that uses the trainer phrases;
  - `tools/ci/missions/build.ts` now refuses mission text that uses them.
  Both refusals are intended.
- i18n keys: unchanged; only values change.

## Acceptance criteria
- AC-1 Given the merged base with this milestone's changes When the repository checks run Then they pass. `check:assets` validates `config/ip-denylist.json` against `ip-denylist-1`, and `pnpm lint` reports no C02 finding in the edited sim files — proof: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm check:unit && pnpm check:assets`
- AC-2 Given `content/ui/i18n/en.json` and `CONTROL_REASON_EN` When the guard test reads them Then:
  - the eleven keys hold exactly the values in the Scope-in table;
  - `CONTROL_REASON_EN[CONTROL_REASON.groundNotLoaded]` equals `en['world.teleport.notLoaded']`;
  - `scanText` with the matcher compiled from the real config finds no `str-pattern:trainer-*` hit in any `en.json` value;
  - no `en.json` value matches `/\bwanted\b/i` or `/\bstars?\b/i`;
  - `STATUS['heat.clear'].icon` and `STATUS['heat.wanted'].icon` are kit SVG icon ids, and `packages/ui/src/hud/**` holds no U+2605, U+2606, U+25AE or U+25AF (DL-738)

  — proof: `pnpm check:unit -- tools/ci/test/ip-trainer-phrases.test.ts packages/ui/test/hud-status.spec.ts`
- AC-3 Given a temp root with a copy of `config/` When `runIpScan({ modes: ['strings'] })` runs Then:
  - one `packages/ui/src/*.ts` file per alternative of each pattern (built at run time from the config) is reported with rule `str-pattern:trainer-status`, `trainer-heat` or `trainer-menu`. This holds in upper case, in mixed case, and with a line break between two words;
  - files holding only `neverWanted`, `godMode`, `never-wanted`, `sandbox.status.preparing` or the new wording of AC-2 are not reported;
  - the same phrases under `spec/` and `research/` are not reported

  — proof: `pnpm check:unit -- tools/ci/test/ip-trainer-phrases.test.ts`
- AC-4 Given the built app When `ip:strings` scans the tracked tree and `apps/web/dist` Then it exits 0 with no finding — proof: `pnpm build && pnpm ip:strings`
- AC-5 Given the edited engine and map tests When they run Then the teleport-timeout case still returns the player unmoved with reason `engine.control.groundNotLoaded` and the new English default, and the transit config case finds the new catalog value — proof: `pnpm check:unit -- packages/engine/test/control.ownership.spec.ts tools/map/test/config.transit.spec.ts`
- AC-6 Given the other readers of the denylist When their suites run Then they pass unchanged. The guard test also shows that `scanText(normalizeName(<each heat phrase>), matcher)` is empty, so the username check is unaffected — proof: `pnpm check:workers -- auth && pnpm check:unit -- packages/shared/test/prompt-lint.test.ts tools/ci/test/ip-trainer-phrases.test.ts && pnpm check:missions`
- AC-7 Given a `DV_WORLD=synth` QA build (the `@pursuit` spec waits for the world to be revealed, and CI runs it only in the synth half) When the pursuit e2e runs Then the toggle with test id `pursuit-never` sits in a label whose text is `heat lock`, and checking it still refuses heat 4 — proof: `pnpm map:build -- --area synth && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @pursuit`
- AC-8 Given the catalog directory When `check:i18n` runs Then it reports no missing key and `languages: en`, with `stale translations: 0 (English is the only catalog)`. No `<lang>.hashes.json` is created or edited (the stale-hash rule: a translation made from an old English value must show as stale, never be re-hashed to hide it) — proof: `pnpm check:i18n`

## Test plan
- **Unit:** `tools/ci/test/ip-trainer-phrases.test.ts` (AC-2, AC-3, AC-6); `hud-status.spec.ts` (AC-2, unchanged); `control.ownership.spec.ts` and `config.transit.spec.ts` (AC-5); `prompt-lint.test.ts` (AC-6).
- **Workers:** `pnpm check:workers -- auth` (AC-6).
- **Gates:** `pnpm build && pnpm ip:strings` (AC-4), `pnpm check:assets`, `pnpm check:i18n` (AC-8), `pnpm check:missions` (AC-6).
- **E2E:** `@pursuit` on `chromium-webgl2`, `DV_WORLD=synth` (AC-7); CI runs it in the synth half, outside `GRAYBOX_GREP`.

## Demo script
1. `pnpm check:unit -- tools/ci/test/ip-trainer-phrases.test.ts`: every case passes, and the log names the three pattern ids.
2. Copy one alternative of `trainer-menu` from `config/ip-denylist.json` into a scratch `packages/ui/src/tmp.ts`, run `pnpm ip:strings` and see it fail with `str-pattern:trainer-menu`. Delete the file and see it pass.
3. `pnpm dev`, open the phone Sandbox app: the heading reads "Heat", the level buttons "Heat 1" … "Heat 5", and the toggle "Heat lock: off". Set heat 2 and close the phone: the HUD shows two lit bars and "Level 2 · Pursued".

## Effort
0.2 Builder session; about 17 files; risk **low**.

## Risks & fallbacks
- **A third-party library in `apps/web/dist` contains a guarded phrase** (a generic two-word status or menu phrase is the likeliest). Narrow that one alternative (for example require the surrounding phrase), and do not add an `exceptions` entry for third-party text. Record a BD row that names the pattern id, not the phrase.
- **A milestone that merges between this one's start and its rebase adds a guarded phrase.** `ip:strings` names the file. Reword it in this branch, since it is the same rule.
- **M04e0 also edits `sandbox.ts`.** It changes code and this milestone changes l.25's comment, so a rebase in either order is a one-line merge.

## Notes for the Builder
- Read first:
  - `research/repos-grand-v.md` §3 (the denylist source rows; never wording for us) and §5;
  - DL-664 in `spec/11-decision-log-7.md`;
  - `tools/ci/ip-scan.ts`, `packages/shared/src/assets/gates/{ip.ts,types.ts}`;
  - the DL-664 cases in `tools/ci/test/ci-scripts.test.ts` and `tools/ci/test/gates.test.ts`;
  - `tools/ci/check-i18n.ts`.
- Never open the Grand-V repository or the trainer's string file; the §3 rows are the only source for the denylist. Write new wording without looking up the trainer's phrasing. The new values above are final; if one reads badly in the UI, pick another original phrase and record a BD row.
- `names:lint` is the wrong tool for this: it checks real-person names through `nameRegex` and the name registry. `ip:strings` is the repo-wide wording scan.
- `pnpm ip:strings` is the binding proof that no guarded phrase remains in the tree or the build. Never paste a phrase into a commit message, a BD row or the report; name the pattern id.
- Do not touch `packages/engine/src/sim/save/__golden__/**`. In `packages/shared/src/contracts/c05-save.ts` change only the two comments named above; `godMode` there is a key, and the guard does not cover it.
- Secrets: none.
