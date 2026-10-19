# M13a6 — mod-agent-kit

## Goal
A coding agent that has never seen this game can scaffold, test, validate and pack a mod from the kit alone. When this milestone is done the repository has:
- the modder **`AGENTS.md`** (kit file) with `CLAUDE.md`/`GEMINI.md` importers, inside the byte budget of DL-208;
- eleven **mod skills**, authored once in `skills/` and mirrored as real copies, with `check:skills`;
- a **knowledge base** template and `dv kb new|check|index|search`;
- `dv init`, `dv mod new`, `dv mod test [--mock] [--prove-oracle]` (with `MockModHost`, lockstep), `dv mod dev` (hot reload to a local game over 127.0.0.1 with a token), `dv mod provenance add|verify`, `dv doctor` and `dv mcp` (`thabay-mcp`, stdio);
- three example mods;
- `check:mods` (examples build, `--help` smoke of every `dv` group, KB check, no vacuous oracle);
- `check:agents` extended to the kit limit.

Flow A of ADR-0019 (bring your own agent; Codex signed in with ChatGPT) is documented and needs no OpenAI program. npm publication waits for Q-22.

## Requirements
- R-MOD-01: the agent-friendly SDK: `AGENTS.md`, skills, knowledge base, typed API, local dev loop.
- R-MOD-02: players with a ChatGPT plan use Codex signed in with ChatGPT (flow A); everyone else uses any agent. Publishing comes in M13c3.
- R-ENG-01: every kit action is a deterministic command with JSON output; no GUI-only step; instruction files stay within their limits.

## Depends on
- **M13a4** (script runtime, lockstep protocol, fault codes). **M13a5** (UI tier, `dv-panel/1`). Through them, M13a1–M13a3 (validator, pack, installer, `ModHost`, `ExperienceMode`).
- M00d's `check:agents` and the `check:skills`/`check:mods` pending stubs exist.
- Contracts: C14 1.0 (`ModManifest`, `ModAPI`, `ModMsg v1`, `MODAPI_VERSION`), C07 1.1 (`ProvenanceRecord`, endpoint registry), C17 1.0 (`dv-exp/1` authoring), C15 1.0 (format of this file only).
- Gate: **Q-22** covers only the npm publication step, which is not run here.

## Scope in
- **Kit instructions:**
  - `packages/mod-sdk/AGENTS.md` follows the ten sections of `12-modding-publish.md` C§1.2, scaled to fit **kit ≤ 19,456 bytes and root + kit ≤ 32,768 bytes** (DL-208 supersedes the 24,576 of C§1.2).
  - `packages/mod-sdk/templates/{CLAUDE.md, GEMINI.md}` contain `@AGENTS.md` plus agent notes; `CLAUDE.md` stays under 200 lines.
  - `packages/mod-sdk/docs/MODDING.md` covers flow A (C§2) step by step, including the Codex "Sign in with ChatGPT" path, and states that publishing needs `dv login` (M13c3).
- **Skills:**
  - `skills/<name>/SKILL.md` for `mod-the-game`, `build-experience`, `place-on-map`, `write-mission-ir`, `mod-vehicles`, `mod-characters`, `add-npc-cameo`, `mod-assets`, `validate-and-preview`, `publish-experience`, `field-note`. Each is under 500 lines; descriptions are trigger lists.
  - Mirrors are real copies, not symlinks: `.claude/skills/<name>/`, `.agents/skills/<name>/` and `packages/mod-sdk/kit/skills/<name>/`, written by `pnpm check:skills -- --write`.
  - `check:skills` fails on any byte difference or a missing mirror. Entries in `.claude/skills/` that are not in `skills/` must be listed in `tools/ci/skills-extra.allow.json` (today: `architect`).
- **`check:agents`** (`tools/ci/check-agents.ts`): adds the kit rules (kit ≤ 19,456 bytes; root `AGENTS.md` + kit ≤ 32,768; template `CLAUDE.md` < 200 lines). The M00d rules stay.
- **`dv init [dir]`** writes the C§1.1 workspace:
  - it copies the kit `AGENTS.md`, the templates and the skills with their mirrors;
  - `.claude/settings.json` has a SessionStart hook (`startup|resume|clear|compact|fork`) that appends the `dv` bin directory to `$CLAUDE_ENV_FILE` once;
  - MCP registrations for `thabay-mcp` are generated from one table in code: `.mcp.json`, `.codex/config.toml`, `.cursor/mcp.json`, `.vscode/mcp.json`, `opencode.json`, `gemini-extension.json`. Secrets appear by env-var name only.
  - It also writes `knowledge/{README.md, TEMPLATE.md, INDEX.md, index.json, mods/, techniques/}`, `docs/{CONTRACT-modapi.md, STATUS.md, HANDOFF.md}` and `mod/{mod.json, src/, data/, assets/, provenance/, MODLOG.md, evidence.json}`.
- **`dv mod new <kind> [--tier]`** scaffolds from `packages/mod-sdk/examples/mods/*` and starts `MODLOG.md`.
- **`MockModHost`** (`packages/mod-sdk/src/mock-host.ts`): a fake `ModAPI` over an anchor-frame world with a lockstep clock. It runs the same `ModMsg v1` sequence as `ModHost` (it is a host for the real QuickJS runtime from M13a4 in Node). Scenario files `mod/test/*.scenario.json` hold `{steps, act, expect}`.
- **`dv mod test [--mock] [--prove-oracle]`:**
  - runs the scenarios and writes `evidence.json` (`dv-evidence/1`: level, scenarios with SHA-256, oracle, `vacuous`, tier, and `notVerified`);
  - `--prove-oracle` re-runs each scenario against a no-op mod and against a copy with the first handler removed; an assertion that still passes is `vacuous` and fails the run;
  - without `--mock`, it uses a connected dev host.
- **`dv mod dev [--host url] [--mock]`:**
  - watches, rebuilds (M13a1 pack, in memory) and serves `ws://127.0.0.1:<port>/dev`;
  - binds 127.0.0.1 only, prints a random 128-bit token (also in `.dv/dev.json`, mode 0600), and validates `Origin` against the game origin plus the token;
  - speaks `DevMsg {v:1; t:'hello'|'bundle'|'reload'|'log'|'bye'}`.
  - Game side (`packages/engine/src/client/mods/dev-client.ts`): Settings → Developer → "Connect to a local mod server" (device-scoped `PlatformSettings.dev.mod {enabled, port}`, off by default, never a URL flag). The bundle loads as `installedFrom:'dev'` with no registry row and no journal, under every sandbox rule, and unloads on disconnect.
- **`dv mod provenance add|verify`** writes and checks C07 records through the M00b gate cores. The `mod-assets` skill and the kit never use the project's fal account or `FAL_KEY` (DL-OWN-01: no player-triggered fal in v1); creators record provenance for assets made with their own tools.
- **`dv kb new|check|index|search`:** `check` fails on missing front-matter keys or sections, secrets, unfilled template text, code blocks over 150 lines and images over 1.5 MB, and warns on absolute user paths and notes over 120 KB.
- **`dv doctor`**: versions, ports, skills mirror, `AGENTS.md` size.
- **`thabay-mcp`** (`tools/cli/src/mcp/server.ts`, stdio, on `@modelcontextprotocol/sdk`):
  - tools `mod.schema`, `mod.validate`, `mod.test`, `mod.pack`, `mod.preview` (starts the dev host and returns its URL), `mod.publish` (always returns `{needs_human: true, command: 'dv mod publish'}`), `provenance.add`, `kb.search`, `docs.api`;
  - `world.find_place` and `world.describe` return `{code:'not_available', fix:'…lands with the world export (M13b2)…'}` until the `tools/map` export exists (U10);
  - KB and forum text is returned wrapped as `{untrusted: true, author, date, text}`.
- **Examples** (`packages/mod-sdk/examples/mods/`): `cones` (data-tier experience), `night-rules` (script-tier rules mod using `rules.tick`, `hud`, `storage`), `scoreboard` (UI tier with `xrPanel`). Each has scenarios that pass `--prove-oracle`.
- **`check:mods`** (`tools/ci/check-mods.ts`), for every example: `dv mod check`, `dv mod pack`, `dv mod test --mock --prove-oracle`. It then runs `dv <group> --help` for every group and `dv kb check --index` on the template KB.
- **CI:** `ci.yml` `static` adds `pnpm check:skills`; `content` adds `pnpm check:mods`.

## Scope out
- `dv login`, `dv mod publish`, attestation, `/link`: M13c3. Flow B (`dv studio`): ADR-gated (DL-148), M13c3 or later. Flow C: route 11 behind `AUTH_OPENAI_WEB` (M13c1).
- `world.find_place`/`world.describe` data: M13b2 (`world.describe` export) and U10.
- npm publication of `@dv/mod-sdk` and `@dv/cli`: Q-22. Until the owner answers, both ship as tarballs on the release page (M14b3).
- Hosted-game developer connection under Chrome Local Network Access (U4): recorded in M14b3.

## Deliverables
- `packages/mod-sdk/{AGENTS.md, docs/MODDING.md, templates/CLAUDE.md, templates/GEMINI.md, src/mock-host.ts, src/scenario.ts, src/evidence.ts}`.
- Examples `packages/mod-sdk/examples/mods/{cones,night-rules,scoreboard}/`: about three files each (`mod/mod.json`, a data or `src` file, one scenario).
- `skills/<11 names>/SKILL.md` (hand-written); mirrors (generated, not counted).
- `tools/cli/src/{init.ts, mcp-configs.ts, kb.ts, doctor.ts}`, `tools/cli/src/mod/{new.ts, test.ts, dev.ts, provenance.ts}`, `tools/cli/src/mcp/server.ts`.
- `packages/engine/src/client/mods/dev-client.ts`.
- `tools/ci/{check-skills.ts, check-mods.ts, skills-extra.allow.json}`; changes to `tools/ci/check-agents.ts`.
- Root scripts `check:skills [-- --write]` and `check:mods`, replacing the pending stubs.
- Tests:
  - `tools/ci/test/{check-skills.test.ts, check-agents-kit.test.ts}`;
  - `tools/cli/test/{prove-oracle.spec.ts, dev-server.spec.ts, mcp.spec.ts, init.spec.ts}`;
  - `packages/mod-sdk/test/mock-host.spec.ts`;
  - `tests/e2e/mods-dev.spec.ts` (tag `@mods-dev`).
- `@modelcontextprotocol/sdk`: not in the ledger; pin what pnpm resolves, record it in `spec/03`.

## Interfaces
- C14 1.0 is used as published; `docs/CONTRACT-modapi.md` (M13a1) is linked, not changed. `DevMsg` and `dv-evidence/1` are kit-local formats (S12 design), not contracts. `PlatformSettings.dev` exists in C13 1.1 and is used unchanged.
- No contract change.
- Optional input (D-31, DL-505): `third_party/universal-modder/` when `docs/legal/third-party-reuse.json` lists files in `allowedPaths` with a `pinnedSha`. Absent by default; nothing here depends on it.

## Acceptance criteria
- AC-1 Given the canonical `skills/` tree When `check:skills -- --write` has run and one byte of one mirrored `SKILL.md` is then changed in a fixture copy Then the fixture run fails naming that file, and the repository run passes with `architect` allowed as an extra — proof: `pnpm check:unit -- tools/ci/test/check-skills && pnpm check:skills`
- AC-2 Given fixtures with a 19,457-byte kit file, and a root plus kit totalling 32,769 bytes When `check:agents` runs on them Then each fails with its rule named; on the repository it passes and prints both byte counts — proof: `pnpm check:unit -- tools/ci/test/check-agents-kit && pnpm check:agents`
- AC-3 Given the three examples When `check:mods` runs Then each passes `dv mod check` and `dv mod pack`, each scenario passes `dv mod test --mock --prove-oracle` with zero vacuous assertions, every `dv <group> --help` exits 0, and the template KB passes `dv kb check --index` — proof: `pnpm check:mods`
- AC-4 Given a scenario whose only expectation also holds for a no-op mod When `dv mod test --mock --prove-oracle` runs Then the scenario is reported `vacuous`, `evidence.json` records it, and the exit code is non-zero — proof: `pnpm check:unit -- tools/cli/test/prove-oracle`
- AC-5 Given the `night-rules` example and one seed When `MockModHost` runs its scenario twice in lockstep Then both `evidence.json` files have equal scenario hashes and equal command-stream digests — proof: `pnpm check:unit -- packages/mod-sdk`
- AC-6 Given `dv mod dev` listening When a client connects without the token, with a wrong token, or with an `Origin` that is not the game origin Then each connection is refused; the server's listening address is 127.0.0.1 only; `.dv/dev.json` has mode 0600 — proof: `pnpm check:unit -- tools/cli/test/dev-server`
- AC-7 Given `thabay-mcp` over stdio When the test client lists tools and calls `mod.publish`, `world.describe` and `kb.search` Then the list holds the C§1.6 tools, `mod.publish` returns `needs_human: true` and uploads nothing, `world.describe` returns `not_available` with a fix, and KB hits come wrapped with `untrusted: true` — proof: `pnpm check:unit -- tools/cli/test/mcp`
- AC-8 Given `dv init` in an empty directory When it completes Then the workspace matches the C§1.1 tree, the kit `AGENTS.md` is byte-equal to `packages/mod-sdk/AGENTS.md`, the skill mirrors are equal, and no generated MCP config contains a literal secret value (only env-var names) — proof: `pnpm check:unit -- tools/cli/test/init`
- AC-9 Given a QA build with the Developer toggle on and `dv mod dev` serving the `cones` example When the test edits the scene file Then the game reloads the bundle as `installedFrom: 'dev'` within one rebuild, the registry gains no row, and disconnecting unloads it — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @mods-dev`
- AC-10 Given an operator workstation with Codex signed in with ChatGPT (or Claude Code) and a fresh `dv init` workspace When the agent is asked "build a cones time-trial experience near the Ferry Building" with no other help Then it produces a mod that passes `dv mod check` and `dv mod test --mock --prove-oracle`, and its `MODLOG.md` and `evidence.json` are attached to the PR with the agent and model named — proof: manual: operator workstation, steps as written in this AC, then `pnpm exec dv mod check <workspace>/mod --json`
- AC-11 Given the changed web code When the production build is checked Then no `/_test/` route and no secret pattern ship — proof: `pnpm build && pnpm check:prod-routes && pnpm check:secrets -- apps/web/dist`

## Test plan
- **Unit:** the `tools/ci`, `tools/cli` and `packages/mod-sdk` tests above. Commands: `pnpm check:unit -- tools/ci`, `pnpm check:unit -- tools/cli`, `pnpm check:unit -- packages/mod-sdk`.
- **Content:** `pnpm check:mods`.
- **E2E:** `@mods-dev` on `chromium-webgl2`.
- **Static:** `check:skills`, `check:agents`.
- **Manual:** AC-10 (an agent run, the R-MOD-01 demonstration).

## Demo script
1. `pnpm exec dv init /tmp/my-mod && cd /tmp/my-mod && ls -a`; read `AGENTS.md`.
2. `pnpm exec dv mod new experience`, then `dv mod test --mock --prove-oracle`; read `evidence.json`.
3. In the repo, `pnpm dev`; Settings → Developer → connect with the printed port and token.
4. `pnpm exec dv mod dev`; edit a cone position; the game reloads it.

## Effort
1 session; ≈ 40 hand-written files (mirrors excluded). Risk medium (breadth).

## Risks & fallbacks
- File budget: drop `dv doctor`, which moves to M13c3 as a `dv login` precheck. Then merge `mcp-configs.ts` into `init.ts`. Never cut a skill, `check:skills`, `check:mods` or `--prove-oracle`.
- The `@modelcontextprotocol/sdk` stdio API differs from expectation: read the pinned package, record the calls used, keep the tool list.
- The kit byte budget is too small for the ten C§1.2 sections: shorten §3 to the command list and move detail into `docs/MODDING.md` and skills. The limit (DL-208) is not raised.
- The Developer toggle cannot reach `127.0.0.1` from a hosted game (U4): local `pnpm dev` is the supported path; record the hosted result in M14b3.

## Notes for the Builder
- Read first: `12-modding-publish.md` C§1 (all), C§2 (flow A); `12-modding.md` §2.1 principles 9–10; `13-qa.md` §3.8; `spec/11-decision-log-2.md` DL-208; `docs/decisions/ADR-0019-modding-agent-and-publish-login.md`; `spec/99-open-questions.md` Q-22.
- Patterns come from [research/repos-modding.md §2, §6]; never open or fetch the upstream repositories it names.
- Third-party reuse (ADR-REUSE-01, DL-505): if universal-modder files are vendored and M00f `third-party-reuse-gates` has merged (`tools/ci/third-party-licenses.ts` exists on your branch's base, `main`; otherwise ignore `third_party/`), you may reuse its secret-scan pattern classes for `dv kb check`, its knowledge-base layout and checks, its skills layout and its publish-check idea (regex pattern literals and layout or template text may be ported; never a URL, another publisher's game name or a third-party product string other than the secret-prefix tokens themselves; DL-646), keeping an `SPDX-License-Identifier: MIT` line, the upstream copyright line from `third_party/<name>/LICENSE` verbatim and a "Portions from `third_party/<name>/<path>`" header on ported files (copied, never imported from `third_party/`; `pnpm reuse:clones`, M00f item 7, fails a ported file without that header, DL-616) and the credits page renders the `third_party/NOTICE` line that `provenance:check --emit-credits` writes into `credits.json` (M00f, DL-507, DL-631). If a ported file ships in `tools/cli`, `packages/mod-sdk` or the kit that `dv init` copies, add the generated `THIRD_PARTY_LICENSES.txt` to that package's `files` set (reuse-gates item 1) and give each ported kit or template file the full MIT permission text or a pointer to that file beside it; `tools/cli` never imports `third_party/`. Nothing about modding another publisher's game enters the kit. If `third_party/` is absent, build from `12-modding-publish.md` C§1 and the research patterns; every AC is unchanged either way.
- Branch `m13a6-mod-agent-kit`.
