# M04e5 — ip-wall-strings

## Goal
After this session no shipped string reuses the wording of the sandbox-trainer checklist in `research/repos-grand-v.md` §3. That checklist comes from GPL-3.0 trainer strings, so its rows may guide which features we build, never what we write (§5, rec 20). CI now stops that wording from coming back. Three things change:
- The teleport refusal, the control-reason English default, the HUD and phone heat labels, and the QA pursuit panel's toggle label get our own wording.
- Code comments that use the trainer's heat phrases get our "heat" vocabulary.
- `config/ip-denylist.json` gains three `patterns` entries (`trainer-status`, `trainer-heat`, `trainer-menu`) that the existing `ip:strings` scan applies to the tracked tree and to `apps/web/dist`.

Identifiers (`sandbox.player.neverWanted`, `NEVER_WANTED`, `neverWanted()`, `engine.control.groundNotLoaded`, test ids) stay as they are. They are keys, not wording, and C05 saves and goldens depend on them.

## Requirements
- R-IP-01 (primary): original content only. No trainer-derived player-facing string ships, and `ip:strings` fails if one is added.
- R-UI-03 (support): the phone Sandbox app, the HUD heat chip and the teleport toast keep working, with new English values under the same keys.

## Depends on
- **M00b** (ip-provenance-gates): `tools/ci/ip-scan.ts` (`runIpScan`), `compileStringMatcher` and `scanText` in `packages/shared/src/assets/gates/ip.ts`, `STRING_SCAN_PATH_ALLOWLIST` in `packages/shared/src/assets/gates/types.ts`, `config/ip-denylist.json` with schema `ip-denylist/1` (`packages/shared/schemas/ip-denylist-1.schema.json`).
- **M02c1** (graph-services-teleports): `world.teleport.notLoaded` and its assertion in `tools/map/test/config.transit.spec.ts` l.29.
- **M03c** (pursuit-director): the QA pursuit panel `packages/engine/src/debug/pursuit-panel.ts` and `tests/e2e/engine/pursuit.spec.ts` (`@pursuit`).
- **M04b2** (creator-phone-hud-kit): `hud.heat.label`, `phone.sandbox.heat`, `phone.sandbox.neverOn` and `phone.sandbox.neverOff` in `content/ui/i18n/en.json`, read by `packages/ui/src/phone/apps.ts`.
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
  | `en.json` l.831 | `phone.sandbox.heat` | `Heat` |
  | `en.json` l.838 | `phone.sandbox.neverOn` | `Cops look away: on` |
  | `en.json` l.839 | `phone.sandbox.neverOff` | `Cops look away: off` |
  | `pursuit-panel.ts` l.78 (QA build only) | checkbox label text | `cops look away` |

- **Tests that spell the old value:**
  - `packages/engine/test/control.ownership.spec.ts` l.49 and `tools/map/test/config.transit.spec.ts` l.29 assert the new string.
  - `tests/e2e/engine/pursuit.spec.ts` l.111 gets a new title (`… cops look away refuses it @pursuit`).
  - The same e2e case gains one assertion: the label that wraps `pursuit-never` has the text `cops look away`.
- **Comments.** Reword, using "heat" or "heat level", each comment in the scanned tree that holds a guarded phrase. These are `pursuit-panel.ts` l.3, `packages/engine/src/sim/modes/builtin/sandbox.ts` l.25, `packages/engine/src/sim/garage/garage.ts` l.101, `packages/engine/src/sim/world/index.ts` l.36, `packages/world/src/sim/api/teleport.ts` l.66 and l.70, and `packages/world/src/sim/streaming/module.ts` l.466. Only comments change, so the C02 lint and the sim hashes are untouched.
- **Guard** (`config/ip-denylist.json`, `patterns`, all with flags `i`; JSON escaping doubles each backslash). These entries are denylist content: they name what must not appear, and none of them is wording for us to use.
  - `trainer-status`: `\b(?:ground\s+not\s+loaded|player\s+was\s+not\s+moved|enter\s+a\s+vehicle\s+first|loading\s+model|streaming\s+teleport\s+destination)\b`
  - `trainer-heat`: `\b(?:never\s+wanted|wanted\s+level)\b`
  - `trainer-menu`: `\b(?:spooner|spawn\s+in\s+vehicle|place\s+on\s+ground|replenish\s+player|refresh\s+vehicle\s+availability|pause\s+clock\s+time|sync\s+with\s+system\s+time)\b`

  `\s+` (not `\W+`) keeps the identifiers `neverWanted`, `godMode`, `never-wanted` (the button id in `apps.ts` l.114) and the proposed key `sandbox.status.loadingModel` from matching. `compileStringMatcher` adds the `g` flag itself. The schema already allows any `{id, regex, flags}`, so `ip-denylist/1` does not change.
- **Guard test** `tools/ci/test/ip-trainer-phrases.test.ts`. It follows the DL-664 tests in `ci-scripts.test.ts` and `gates.test.ts`: real config, `tempRoot()`-style copies of `config/`, and every guarded phrase built from parts (`['ground', 'not loaded'].join(' ')`), so the file itself passes `ip:strings`. It covers AC-2, AC-3 and part of AC-6.
- **BD rows** in `spec/11-decision-log-builder.md` for the wording chosen and for using `patterns` rather than a new block.

## Scope out
- Spec and research text that quotes the old wording (`spec/` and `research/` are on the scan allowlist): the integrator edits it. The list is in the report.
- New sandbox status keys (streaming, spawn, need-vehicle): the GV sandbox-menu milestones write those in our own words under this guard.
- Renaming identifiers or C05 toggle paths; the star glyphs and the `hud.heat.wanted` phase label (M04b2 design, not trainer text).
- Other locales: none exists on `claude/build`, and new languages are post-v1 (M14c scope out).

## Deliverables
- `content/ui/i18n/en.json`; `packages/engine/src/sim/control/states.ts`; `packages/engine/src/debug/pursuit-panel.ts`.
- Comment-only edits: `packages/engine/src/sim/modes/builtin/sandbox.ts`, `packages/engine/src/sim/garage/garage.ts`, `packages/engine/src/sim/world/index.ts`, `packages/world/src/sim/api/teleport.ts`, `packages/world/src/sim/streaming/module.ts`.
- `config/ip-denylist.json` (three `patterns`).
- Tests: `tools/ci/test/ip-trainer-phrases.test.ts` (new), `packages/engine/test/control.ownership.spec.ts`, `tools/map/test/config.transit.spec.ts`, `tests/e2e/engine/pursuit.spec.ts`.
- `spec/11-decision-log-builder.md` (BD rows).
- About 14 files.

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
  - the five keys hold exactly the values in the Scope-in table;
  - `CONTROL_REASON_EN[CONTROL_REASON.groundNotLoaded]` equals `en['world.teleport.notLoaded']`;
  - `scanText` with the matcher compiled from the real config finds no `str-pattern:trainer-*` hit in any `en.json` value

  — proof: `pnpm check:unit -- tools/ci/test/ip-trainer-phrases.test.ts`
- AC-3 Given a temp root with a copy of `config/` When `runIpScan({ modes: ['strings'] })` runs Then:
  - one `packages/ui/src/*.ts` file per guarded phrase is reported with rule `str-pattern:trainer-status`, `trainer-heat` or `trainer-menu`. This holds in upper case, in mixed case, and with a line break between two words;
  - files holding only `neverWanted`, `godMode`, `never-wanted`, `sandbox.status.loadingModel` or the new wording of AC-2 are not reported;
  - the same phrases under `spec/` and `research/` are not reported

  — proof: `pnpm check:unit -- tools/ci/test/ip-trainer-phrases.test.ts`
- AC-4 Given the built app When `ip:strings` scans the tracked tree and `apps/web/dist` Then it exits 0 with no finding — proof: `pnpm build && pnpm ip:strings`
- AC-5 Given the edited engine and map tests When they run Then the teleport-timeout case still returns the player unmoved with reason `engine.control.groundNotLoaded` and the new English default, and the transit config case finds the new catalog value — proof: `pnpm check:unit -- packages/engine/test/control.ownership.spec.ts tools/map/test/config.transit.spec.ts`
- AC-6 Given the other readers of the denylist When their suites run Then they pass unchanged. The guard test also shows that `scanText(normalizeName(<each heat phrase>), matcher)` is empty, so the username check is unaffected — proof: `pnpm check:workers -- auth && pnpm check:unit -- packages/shared/test/prompt-lint.test.ts tools/ci/test/ip-trainer-phrases.test.ts && pnpm check:missions`
- AC-7 Given a QA build When the pursuit e2e runs Then the toggle with test id `pursuit-never` sits in a label whose text is `cops look away`, and checking it still refuses heat 4 — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @pursuit`
- AC-8 Given the catalog directory When `check:i18n` runs Then it reports no missing key and `languages: en`, with `stale translations: 0 (English is the only catalog)`. No `<lang>.hashes.json` is created or edited (the stale-hash rule: a translation made from an old English value must show as stale, never be re-hashed to hide it) — proof: `pnpm check:i18n`

## Test plan
- **Unit:** `tools/ci/test/ip-trainer-phrases.test.ts` (AC-2, AC-3, AC-6); `control.ownership.spec.ts` and `config.transit.spec.ts` (AC-5); `prompt-lint.test.ts` (AC-6).
- **Workers:** `pnpm check:workers -- auth` (AC-6).
- **Gates:** `pnpm build && pnpm ip:strings` (AC-4), `pnpm check:assets`, `pnpm check:i18n` (AC-8), `pnpm check:missions` (AC-6).
- **E2E:** `@pursuit` on `chromium-webgl2` (AC-7).

## Demo script
1. `pnpm check:unit -- tools/ci/test/ip-trainer-phrases.test.ts`: every case passes, and the log names the three pattern ids.
2. Put a guarded phrase into a scratch `packages/ui/src/tmp.ts`, run `pnpm ip:strings` and see it fail with `str-pattern:trainer-…`. Delete the file and see it pass.
3. `pnpm dev`, open the phone Sandbox app: the heat row reads "Heat" and the toggle reads "Cops look away: off".

## Effort
0.2 Builder session; about 14 files; risk **low**.

## Risks & fallbacks
- **A third-party library in `apps/web/dist` contains a guarded phrase.** `loading model` and `place on ground` are the likely ones. Narrow that one alternative (for example require the surrounding phrase), and do not add an `exceptions` entry for third-party text. Record a BD row.
- **A milestone that merges between this one's start and its rebase adds a guarded phrase.** `ip:strings` names the file. Reword it in this branch, since it is the same rule.
- **M04e0 also edits `sandbox.ts`.** It changes code and this milestone changes l.25's comment, so a rebase in either order is a one-line merge.

## Notes for the Builder
- Read first:
  - `research/repos-grand-v.md` §3 (as a checklist only, never as wording) and §5;
  - DL-664 in `spec/11-decision-log-7.md`;
  - `tools/ci/ip-scan.ts`, `packages/shared/src/assets/gates/{ip.ts,types.ts}`;
  - the DL-664 cases in `tools/ci/test/ci-scripts.test.ts` and `tools/ci/test/gates.test.ts`;
  - `tools/ci/check-i18n.ts`.
- Never open the Grand-V repository or the trainer's string file. Write new wording without looking up the trainer's phrasing. The new values above are final; if one reads badly in the UI, pick another original phrase and record a BD row.
- `names:lint` is the wrong tool for this: it checks real-person names through `nameRegex` and the name registry. `ip:strings` is the repo-wide wording scan.
- Search before finishing: `git grep -n -i -E 'ground\s+not\s+loaded|never\s+wanted|wanted\s+level' -- . ':!spec' ':!research' ':!prompt-pack' ':!docs/research' ':!docs/legal' ':!docs/decisions' ':!.claude'` must print nothing. `pnpm ip:strings` is the binding proof.
- Do not touch `packages/engine/src/sim/save/__golden__/**` or `packages/shared/src/contracts/c05-save.ts`. `godMode` there is a key, and the guard does not cover it.
- Secrets: none.
