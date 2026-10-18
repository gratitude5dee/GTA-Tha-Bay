# repos-modding — universal-modder (agent-friendly modding) and SK8V (physics and state machines)

Research dimension `repos-modding` (S00), written 2026-10-18. Binding inputs read first: `research/owner-updates.md` (accurate SF first; Grand-V logic adopted), `prompt-pack/06-SHARED-CONTEXT.md` v0.9 (R-MOD-01..04, R-AUTH-03, R-IP-01..03, R-ENG-01, contracts C02/C07/C12/C14/C17), master-prompt `<constraints>` and `<decisions>`.

**Scope boundary.** `research/repos-grand-v.md` already covers the mod store UX, catalogue, manifest fields from Grand-V, save profiles and the transactional install/uninstall (back-up-once, byte-equality test). This report does not repeat them; it cites them. `research/stack-cloudflare-backend.md` already covers R2 presigned UGC upload, Queue validation and the Supabase tables for UGC/forum; cited, not repeated. `research/claude-code-deployment.md` already covers Claude Code subagents, skills frontmatter, CLAUDE.md/AGENTS.md loading and hooks; cited.

**Sources read (local clones, source inspection).** `universal-modder` at `6a8865a` (2026-10-17): every top-level file, `skills/` (12 skills), `agents/` (3), `hooks/`, `.claude/`, `.agents/`, `.codex/`, `.cursor/`, `.vscode/`, plugin manifests, `um/` (11 CLI groups, 5,133 lines Python), `tests/` (1,876 lines), `.github/workflows/test.yml`, `knowledge/README.md`, `TEMPLATE.md`, `index.json` and 8 technique notes, 3 examples. `SK8V` at `6a1a6e2` (2026-10-16): `README.md`, `BUILDING.md`, `NOTICE`, both lock files, `tools/prepare-skate-overlay.ps1`, `tools/verify-upstreams.ps1`, `host/include/skatev_runtime.h`, `host/src/lifecycle.h`, `version_guard.h`, `rust/skatev-runtime/src/{lib,worker,lifecycle,line,coords,world,dynamic,rails,curbs,reuse,crash,private_heap}.rs` (headers and key loops), 12 of 49 patches.

**IP line (constraint 3/4).** SK8V hooks GTA V (ScriptHookV) and runs a rebuilt Skate 3 engine on the player's own disc data. Nothing from it is reusable as code or data: no RAGE formats, no Skate 3 tuning values, no state IDs as data, no Rockstar/EA strings. Only architecture patterns transfer, re-expressed in our own TypeScript. universal-modder's GTA V example (`examples/minecraft-gta5-passthrough`) is likewise off limits as a source.

## 0. Checklist (seed expanded; status at end of this report)

| # | Item | Status | Section |
|---|---|---|---|
| 1 | `AGENTS.md` canonical; `CLAUDE.md` = `@AGENTS.md` + Claude specifics; `GEMINI.md` = `@AGENTS.md` | designed | §6.1 |
| 2 | Skills authored once in `skills/`, mirrored as real copies to `.claude/skills` and `.agents/skills`, equality test in CI | designed | §6.1 |
| 3 | SessionStart hook puts the repo CLI on PATH via `CLAUDE_ENV_FILE` | designed | §6.2 |
| 4 | MCP config per agent, key only by env-var reference, never literal | designed | §6.2 |
| 5 | One repo CLI, one module per group, docstring = `--help`, CI smoke-runs every `--help` | designed | §6.3 |
| 6 | Knowledge base (`knowledge/`) with front-matter schema, checker, generated `INDEX.md` + `index.json` | designed | §6.4 |
| 7 | Resumable state docs (`docs/STATUS.md`, `docs/HANDOFF.md`, per-milestone log) | designed | §6.5 |
| 8 | Oracles: agent bridge (`observe/act/step/shot`) in dev/test builds; prove-the-oracle-can-fail | designed | §5.5, §6.6 |
| 9 | Evidence levels in every report and store listing | designed | §6.6 |
| 10 | Mod tiers: data, script, UI panel | designed | §5.2 |
| 11 | Script tier in QuickJS-wasm inside a dedicated Worker, budgets enforced | designed; perf spike M13a | §5.2 |
| 12 | UI tier in a cross-origin sandboxed iframe on a separate origin | designed; COEP spike M13a, ships M13b | §5.2 |
| 13 | `ModManifest` (C14) field set incl. tier, api range, permissions, provenance, license, likeness, `multiplayer:false` | proposed (S12 owns) | §5.3 |
| 14 | `ModAPI` v1 capability list | designed | §5.4 |
| 15 | Determinism for mod scripts (no `Date`/`Math.random`; seeded RNG; sim time) | designed | §5.4 |
| 16 | `mod` CLI: new/dev/test/check/pack/publish | designed | §5.5 |
| 17 | Hot reload from local dev server into a locally run game | designed | §5.5 |
| 18 | `mod-mcp` server exposing the same verbs to any agent | designed | §5.5 |
| 19 | Sign-in-with-ChatGPT: identity (trial-gated) + plan usage in the local open-source CLI; BYO-agent fallback | designed | §5.6 |
| 20 | Publish lint: secrets, provenance, Rockstar formats, likeness, size caps | designed | §5.7 |
| 21 | Remix lineage and license gate | designed | §5.7 |
| 22 | Experiences as overlays pinned to a world version (C17 change) | proposed | §5.7 |
| 23 | Forum "field note" post type mirroring the KB template | designed | §5.8 |
| 24 | fal use in mods: local key for BYO agents; server-side proxy with quotas for hosted flows | designed | §5.7 |
| 25 | Endpoint registry + CI liveness check for fal ids (drift seen) | designed | §2.8 |
| 26 | Server-side mod code via Cloudflare Dynamic Workers | deferred to post-M14 vetting milestone | §5.2 |
| 27 | Mods in multiplayer rooms | out of scope v1 (non-goal, 06 §3) | — |
| 28 | Fixed-step sim, catch-up cap, interpolated presentation, never block render | designed | §7.1 |
| 29 | Controller ownership state machine (on-foot/vehicle/board/swim/cutscene/fighter) with settle and timeout | designed | §7.2 |
| 30 | Vehicle "port contract" table with a semantics column; log oracles | designed | §7.3 |
| 31 | Input normalised at the engine boundary; scripted input "lines" as regression oracles | designed | §7.4 |
| 32 | Collision working set around player, rails/ledges and curb classification from baked geometry | designed (S01/S02) | §7.5 |

## 1. Headline findings

1. universal-modder is the clearest public template for "any coding agent can extend this": one `AGENTS.md`, Agent-Skills-format skills mirrored into the two directories agents scan (`.claude/skills`, `.agents/skills`), per-agent MCP configs that reference `FAL_KEY` by name, a single CLI whose `--help` is its docs, a field-note knowledge base with a machine checker, and a CI that runs tests + KB check + publish lint + every `--help`. It is MIT, 8.3k stars, 263 commits (GitHub, 2026-10-18).
2. Its central methodological lesson is the **oracle**: agents fail by drifting, so every change runs a mechanical check (round trip, trace replay, scripted scene + screenshot actually looked at, synthetic host, measurement scene), with a 3-failure circuit breaker, mutation tests that prove the check can fail, and CI hashing of the verifier so the agent under test cannot weaken it (`knowledge/techniques/oracles-how-agents-know-a-mod-works.md`).
3. It is not a UGC platform: mods are PC-game patches; publishing means a lint (`um publish check`) and a post on Nexus/Workshop/etc.; the hub (`universalmodder.com`) is a "coming soon" page. Remix/publish semantics must be designed by us; Grand-V supplies install mechanics.
4. Drift is real at week scale: two of universal-modder's September 2026 fal defaults (`bytedance/seedance-2.5/image-to-video`, `fal-ai/meshy/v5/remesh`) now return catalogue entries without status metadata, and fal's MCP page now documents `https://mcp.fal.ai/mcp-relay` with OAuth (key clients: `Authorization: Key <id>:<secret>`) while the repo configures `https://mcp.fal.ai/mcp` with `Bearer`. Our spec must resolve endpoint ids from a registry with a CI liveness check.
5. Cross-agent skill discovery is now convergent on `.agents/skills` (Codex, Gemini CLI alias, OpenCode, Copilot) plus `.claude/skills` (Claude Code; also read by OpenCode and Copilot). Shipping both directories covers all six agents the brief names.
6. Sign-in-with-ChatGPT exists in two forms: identity for websites (limited trial, waitlist) and plan usage for open-source or locally hosted apps via a loopback callback. That fits "mod on your local version" exactly: the open-source local `mod` CLI can offer ChatGPT plan usage; the hosted site cannot rely on SIWC at launch, so BYO-agent is the primary flow and SIWC identity is an optional upgrade.
7. For user code in the browser there is still no language-level isolation primitive (ShadowRealm is Stage 2.7, unshipped). Use capability-only execution: QuickJS-wasm (interrupt handler + memory limit) in a dedicated Worker for logic, and an opaque-origin sandboxed iframe on a separate origin for UI. `credentialless` iframes cannot be relied on (no Safari/Firefox).
8. SK8V contributes a clean controller architecture: a versioned, size-prefixed C ABI with layouts asserted on both sides; fixed 60 Hz steps owned by the simulation with a 0.15 s catch-up cap; presentation one tick behind so the render thread never waits; state IDs grouped in families with predicates; an explicit host/guest ownership state machine (`Unprepared→Preparing→Ready→Waiting→Entering→Skating→Leaving`, plus `Delegated` for swim/climb); a collision working set rebuilt off-thread around the player; and scripted input "lines" as regression oracles.

## 2. universal-modder — what it does and how

### 2.1 Layout (root of the clone)

| Path | Role |
|---|---|
| `AGENTS.md` (70 lines) | The only real instruction file: start-here loop, tools, rules, how to work on the toolkit |
| `CLAUDE.md` (13 lines) | `@AGENTS.md` + Claude Code specifics (plugin namespacing, OAuth fallback, agent team start command) |
| `GEMINI.md` (1 line) | `@AGENTS.md` |
| `skills/<name>/SKILL.md` (+`references/`) | 12 skills, canonical copy |
| `.claude/skills/`, `.agents/skills/` | byte-identical copies (no symlinks: Windows clones turn them into text files); `tests/test_um.py::test_skill_copies_match` fails on any difference and on `.gemini/skills` or `.github/skills` existing |
| `agents/*.md` | 3 subagent definitions (orchestrator + 2 workers) |
| `hooks/hooks.json`, `hooks/add-to-path.sh` | plugin SessionStart hook; `.claude/settings.json` holds the same hook for clones |
| `.mcp.json`, `mcp.json`, `.codex/config.toml`, `.cursor/mcp.json`, `.vscode/mcp.json`, `gemini-extension.json`, `opencode.json` | fal MCP per agent |
| `.claude-plugin/{plugin,marketplace}.json`, `.codex-plugin/plugin.json`, `.cursor-plugin/*`, `.agents/plugins/marketplace.json`, `plugin.json` | plugin manifests for each agent's marketplace |
| `plugins/opencode/index.ts` | OpenCode 2 plugin: one `um_run` passthrough tool; a test asserts its group list equals `um/cli.py::GROUPS` |
| `bin/um`, `bin/um.cmd` | launcher: `uv run --project <root> python -m um`, fallback to system Python |
| `um/*.py` | one module per CLI group, each with `register(sub)` and a module docstring that is the `--help` |
| `knowledge/` | field notes: 184 game notes, 81 technique notes; `INDEX.md` + `index.json` generated |
| `examples/` | 7 worked mods with README, build scripts, `MODLOG.md`, evidence JSON |
| `tests/`, `.github/workflows/test.yml` | pytest + CI |
| `.gitattributes` | `*.sh` LF, `*.cmd/*.bat` CRLF (WSL and cmd.exe break otherwise) |

### 2.2 Distribution matrix (what each agent reads)

| Agent | Instructions | Skills dir in a clone | MCP config (key by reference) | Install path in README |
|---|---|---|---|---|
| Claude Code | `CLAUDE.md` → `@AGENTS.md` | `.claude/skills` (plugin: `skills/`, namespaced `/universal-modder:<skill>`) | `.mcp.json` `"Authorization": "Bearer ${FAL_KEY}"` | `/plugin marketplace add …` |
| Codex | `AGENTS.md` | `.agents/skills` | `.codex/config.toml` `bearer_token_env_var = "FAL_KEY"` | `codex plugin marketplace add …` |
| Gemini CLI | `gemini-extension.json` `contextFileName: AGENTS.md` | `.agents/skills` | `gemini-extension.json` + `settings[{envVar: FAL_KEY, sensitive: true}]` | `gemini extensions install <url>` |
| Copilot / VS Code | `AGENTS.md` | `.agents/skills` | `.vscode/mcp.json` `${env:FAL_KEY}` | chat plugin from source |
| Cursor | `AGENTS.md` | `.agents/skills` | `.cursor/mcp.json` `${env:FAL_KEY}` | marketplace or clone |
| OpenCode | `AGENTS.md` | `opencode.json` `skills.paths` + `.agents/skills` | `opencode.json` `{env:FAL_KEY}`, `oauth:false` | clone or `opencode plugin add` |

Verified on vendor docs (see facts table): Codex scans `$CWD/.agents/skills`, `$REPO_ROOT/.agents/skills`, `$HOME/.agents/skills`; OpenCode scans `.opencode/skills`, `.claude/skills`, `.agents/skills`; Copilot reads `.github/skills`, `.claude/skills`, `.agents/skills`; Gemini CLI treats `.agents/skills` as an alias of `.gemini/skills`; Claude Code reads `.claude/skills` and reads `AGENTS.md` directly only when no `CLAUDE.md` exists [research/claude-code-deployment.md]. The `skills.paths` key in `opencode.json` is not on OpenCode's skills page (UNVERIFIED; harmless because `.agents/skills` is scanned anyway).

### 2.3 Skills: format and the patterns inside them

All 12 use the Agent Skills format (`name`, `description` only). Descriptions are long trigger lists ("Use when … ('add a nuke to Terraria', 'can I mod this game?')"). Bodies follow one shape: a tools table (need → exact command), a numbered loop, hard rules, and `references/` for depth (engine playbooks, case studies, a safety file with reasons). Notable content patterns worth copying:

- **The loop as the spine** (`mod-any-game`): intake → recon (search KB first) → route (cheapest that reaches the idea, written to the journal before building) → lab (backups) → read the source of truth → vertical slice → assets → verify in the real program → showcase → package → field note.
- **Journal survives compaction**: "Anything not in the journal is lost at the next context compaction" (`MODLOG.md`).
- **Circuit breaker**: same failure 3 times → stop, write down what is known, change approach.
- **Ask-first list** in plain words (driving input, installing into game folders, publishing, deleting).
- **port-a-mod**: one pinned source of truth, data extracted by script not retyped, unit-by-unit port with tests, "quirk kept" vs "deviation" labels, audits by layer run as read-only parallel reviews, resumable `docs/MIGRATION_STATUS.md` + `docs/HANDOFF.md`, "never claim a test that did not run", build at the start of every session.
- **mashup-mods**: write `docs/CONTRACT.md` before bridge code (ownership table, units/axes as a shared function, channels with full/late policy, protocol magic/version/byte order, lifecycle, "not covered").

### 2.4 Agents (three-role team) and the reporting protocol

`mod-orchestrator` (main session) runs one `mod-game-worker` (the only agent that touches the running game) and one `mod-offline-worker` (studies, designs, writes generators, tests against stubs, hands over exact live probes). Rules that transfer directly to our builder sessions: workers are resumed, not restarted (context kept); "DONE is a claim" — the orchestrator checks logs, hashes, screenshots before relaying; every round ends `DONE:` or `QUESTION:`; offline work never piles up far ahead of live probes; everything new sits behind a default-off flag until its live probe passes; "built and stub-tested" never blurs into "works in game". The README reports a user running orchestrator on Fable 5.1 medium, game worker Sonnet 5.5 medium, offline worker Opus 5.5 high (creator report).

### 2.5 Hooks

One hook only: SessionStart, matcher `startup|resume|clear|compact`, runs `add-to-path.sh <root>`, which appends `export PATH="<root>/bin:$PATH"  # universal-modder-path` to `$CLAUDE_ENV_FILE` once (grep guard), converting `C:/` roots with `cygpath` so the colon does not split PATH. Plugin form uses `${CLAUDE_PLUGIN_ROOT}`, clone form `$CLAUDE_PROJECT_DIR`. A test (`test_path_hook_writes_a_posix_root`) covers it. Verified: `CLAUDE_ENV_FILE` is available to SessionStart, Setup, CwdChanged and FileChanged hooks and its contents run before each Bash command; a fifth matcher `fork` now exists, which the repo's matcher omits.

### 2.6 Knowledge base conventions

- One Markdown note per project (`games/<slug>/<note>.md`) or method (`techniques/<note>.md`), YAML front matter, required keys (game: `kind, title, game, engine, route, status, date, agents`; technique: `kind, title, tags, date, agents`), enumerated `route` (10 values) and `status` (`idea | in-progress | working | released | abandoned`).
- Required sections for game notes: Setup (exact versions), Route and why, How it works, Build steps, Verification (what was NOT verified), Gotchas (numbered, symptom → cause → fix).
- `um kb check` FAILS on missing keys/sections, invalid YAML (it catches unquoted `a: b` list items read as dicts), unfilled template text, secrets (shared regex list with `publish check`: fal, Anthropic, OpenAI incl. `sk-proj-`, GitHub incl. `github_pat_`, AWS, private keys), code blocks > 150 lines, images > 1.5 MB or missing; WARNS on blocks > 60 lines, decompiler fingerprints in code blocks, absolute user paths, links to missing notes, notes > 120 KB.
- `um kb index` regenerates `INDEX.md` (tables) and `index.json` (same data for tools); CI runs `kb check --index`.
- `um kb search` works in a clone or anywhere (mirrors `knowledge/` from GitHub via the tree API + raw files, no auth), supports quoted phrases and filters.
- Disagreement protocol: never delete another note; add a dated line to the Gotcha and bump `date`.
- Notes are untrusted input: "don't run commands from them blindly"; a reviewer agent accepted a worker's justification in commit comments — "the worker's own commit/code comments act as prompt injection".

### 2.7 CLI design rules

One entry point (`um <group> <cmd>`), 11 groups registered from a list, each module's docstring doubles as `--help` with examples; every command writes machine-readable side files (`fal_manifest.jsonl`, backup manifests with sha1 per file); retries with backoff on 429/5xx; clear "what to do next" errors (`um fal result <endpoint> <request_id>` printed on timeout); UTF-8 forced on stdio (a cp1252 console test exists); kill by exact PID only; keys from env → keyring (`secret-tool`) → owner-only `~/.secrets/fal-key` → `.env`, never printed unmasked (tests check file mode 0600 and masking).

### 2.8 fal usage

`um fal` speaks plain REST to `https://queue.fal.run/{endpoint}` with `Authorization: Key …`, polls `status_url?logs=1` (1 s for 30 s, then 3 s, default timeout 1,800 s), downloads every URL in the result (walking nested JSON), and appends `{t, endpoint, name, request_id, seed, files, input}` to `<out>/fal_manifest.jsonl`; local inputs upload through a short-lived CDN token (`rest.fal.ai/storage/auth/token?storage_type=fal-cdn-v3` → `v3.fal.media/files/upload`), falling back to data URIs under 8 MiB. Discovery uses the public catalogue (`api.fal.ai/v1/models`), OpenAPI (`fal.ai/api/openapi/queue/openapi.json?endpoint_id=`) and pricing (`/v1/models/pricing`, needs a key). Defaults (repo comment: "checked against the fal catalog 2026-09") and their status in the public catalogue on 2026-10-18:

| Recipe | Repo default | Catalogue 2026-10-18 |
|---|---|---|
| sprite (transparent) | `openai/gpt-image-2` (`background=transparent`) | active, text-to-image |
| edit / consistent variants | `fal-ai/nano-banana-2/edit` | active, image-to-image |
| image → 3D | `fal-ai/trellis-2`; alt `fal-ai/hunyuan-3d/v3.1/pro/image-to-3d`, `tripo3d/h3.1/image-to-3d`, `meshy/v7.1/image-to-3d` | all active (meshy v7.1 dated 2026-09-19) |
| auto-rig | `fal-ai/meshy/rigging` (`model_url`, `enable_animation`, `height_meters`) | active (2026-05-19); also `fal-ai/meshy/rigging/multi-animation` (2026-06-12) |
| remesh | `fal-ai/meshy/v5/remesh`, `tripo3d/tripo/remesh` | meshy v5 entry has no status metadata; tripo remesh active (2026-08-06) |
| text → motion | `fal-ai/hunyuan-motion` | active |
| PBR maps | `fal-ai/patina/material` | active |
| SFX / music / voice | `fal-ai/elevenlabs/sound-effects/v2`, `elevenlabs/music/v2.5`, `fal-ai/elevenlabs/tts/eleven-v3` | active |
| video | `bytedance/seedance-2.5/image-to-video` | entry without status metadata; active listings are `bytedance/seedance-2.5/us/{image,text,reference}-to-video` (2026-09-19) |

Model choice for our character pipeline belongs to `genai-pipeline-fal.md`; the transferable patterns are the manifest line per generation, "go 3D for many consistent angles", "derive variants from one hero image with the edit endpoint", "price before batching (>20 generations or any video)", "iterate at low quality, re-run winners with the same seed", and credit lines naming the models.

### 2.9 Packaging and publishing

`um publish check <mod> --game <install>` FAILs on files byte-identical to game files (size bucket then sha1), secrets, `.env`; WARNs on decompiler fingerprints, engine archives > 5 MB, absolute user paths, no README, fal manifest without a credit line. `publish-mod` gives per-platform package shapes (Thunderstore zip with `manifest.json` + 256×256 `icon.png`, Modrinth jar, patches-only for ROM hacks), semver + changelog, README sections (what, requirements, install/uninstall/troubleshooting, compatibility, credits incl. "Art/audio generated with fal using <models>", honest AI disclosure), and "publishing is always the user's call". Remix exists only as the hub's promise ("Publish your mods, remix other people's"); the site is a "coming soon" landing page.

### 2.10 Testing

- 90+ pytest tests: engine fingerprinting on synthetic installs, fake HTTP servers for fal/ComfyUI/Sprixen, KB schema and search, publish-check secret patterns against current key formats, backup collision/restore round trips, PATH hook, skill-copy equality, OpenCode plugin group list.
- CI (`test.yml`): pytest; `./bin/um --help` and every group's `--help`; `um kb check --index`; `um publish check .` on the repo itself. ffmpeg install is allowed to fail (8-min timeout) so one test skips instead of failing the build.
- In-game verification is per example: an **agent bridge** (`examples/terraria-tmodloader/reference/AgentBridge.cs`: JSON-lines socket on 127.0.0.1, `observe` returns menus from the UI tree or world state as text, `click <id>`, `type`, `controls`, `step` = controls + observe per 60 Hz frame, handled on the main thread after update, destructive buttons excluded); a **mock host** (`cities-skylines-city-dashboard/tools/mock_game.py` serves a synthetic city so the UI is developed without the game); an **evidence file** (`mindustry-homing/evidence/mindustry-verification.json`: build, mod version, mod sha256, platform, method, shots/hits, clean-zip re-run).
- Evidence levels (`techniques/evidence-levels-for-mashup-claims.md`): creator report · design/proposal · source inspection · derived comparison · synthetic test · real run; only the last supports `status: working`.

### 2.11 What not to adopt

Windows input driving (`um win`), reverse-engineering skills, anti-cheat guidance, and the mashup transports are PC-modding specific. Our mods are content and scripts against our own typed API, so recon, decompilation and "bring your own game files" disappear; the rules that survive are ownership of what you ship, provenance, backups, ask-before-publish, and oracles.

## 3. SK8V — physics and controller architecture (patterns only)

### 3.1 What it is
Apache-2.0 (95 stars, 37 commits on 2026-10-18). A ScriptHookV ASI (`host/`, C++) for GTA V Legacy 1.0.3889.0 Story Mode plus `SkateVRuntime.dll` (`rust/skatev-runtime`), which runs a rebuilt Skate engine fetched at a pinned commit and patched by 49 project patches. All game data is converted at install time from the player's own copies; nothing ships. Behaviour claims ("works in GTA") are creator reports; nothing was run here.

### 3.2 Patch-overlay build (`tools/prepare-skate-overlay.ps1`, `verify-upstreams.ps1`, `upstreams.lock.json`)
- Upstreams are pinned by full commit SHA with `role` and `license` per entry (`primary-skate-adoption-source`, `behavioral-oracle-donor-baseline`, `newer-behavioral-reference` with "never auto-port behavior from this"); `verify-upstreams` fails on missing or wrong HEAD.
- The overlay is rebuilt only when `sha256(upstream HEAD + each patch name + patch sha256)` changes; patches apply in name order (`0001-…` to `0049-…`) into a sibling staging directory; a failed patch never destroys the working overlay; an overlay that differs from what the patches reconstruct is refused ("capture/review these files before rebuilding") unless `-Force`, which keeps a backup.
- Release hygiene: the release build refuses binaries containing local paths (rustc path remaps in a git-ignored `.cargo/config.toml`); `tools/third-party-notices.py` generates `THIRD-PARTY-NOTICES.txt`; `.gitignore` blocks game formats (`*.rpf *.ybn *.ydr *.ydd *.yft *.ytd *.ymap *.ytyp *.xex *.iso`).

### 3.3 Versioned C ABI between host and simulation (`host/include/skatev_runtime.h`, `lib.rs`)
`SKATEV_ABI_VERSION 8`; every struct starts with `size`; `static_assert` sizes/offsets in C++ and `abi_layout_matches_header` asserts the same in Rust; status enum `LOADING → READY → ACTIVATING → ACTIVE | ERROR`; calls are `create/destroy/request_activate/deactivate/step(input{dt, pad})/get_output/get_score_state/...`; inputs with `size` too small or non-finite `dt` are rejected; every export is wrapped in `catch_unwind` with a fallback return (`panic = "unwind"` in the release profile) so a simulation panic never crosses into the host.

### 3.4 Fixed step, catch-up cap, presentation one tick behind (`worker.rs`)
The simulation owns its period (60 Hz). The worker thread accumulates host `dt` (`accumulated = (accumulated + dt.max(0)).min(0.15)`), runs `while accumulated >= period` ticks, then publishes a snapshot plus `blend = accumulated / period`. The host asks for the state "as of the step before the frame's own" (`Shared::at_step`), so the game thread never waits for a tick (the comment records up to 5 ms waits and ~30 fps lost before this) and motion is uniformly one step behind. Interpolation between previous and current snapshot is skipped when `tick - prev.tick > 3` or the root moved more than 2 m (`distance_squared >= 4.0`), so teleports and resets show immediately. Heading interpolates the short way (`((b - a + 540) mod 360) - 180`). Same pattern as Fiedler's "Fix Your Timestep" (clamp 0.25 s, `alpha = accumulator/dt`).

### 3.5 State families and the ownership state machine (`lifecycle.rs`, `host/src/lifecycle.h`)
- Simulation states are numeric IDs grouped in families of 100 (ground 1xx, air 2xx, wipeout 3xx, 4xx/6xx = grinds and plants (exact split inferred from the `on_board` comment), on-foot 5xx, teleport 7xx), and predicates read families (`on_board(s) = s/100 ∈ {1,2,4,6}`). The numbers are Skate's; the idea (stable family ranges, predicates instead of lists) is ours to reuse.
- A **monitor** reads only published state and raw buttons, never injects input, and moves through `Inactive → Riding → Dismounting → Released` with a settle window (15 ticks ≈ 0.25 s on the ground, board held) and a give-up timeout (300 ticks). A bail cancels a pending dismount.
- The **host** state machine: `Unprepared → Preparing` (session built in the background at load) `→ Ready → Waiting` (area not yet in the collision working set; host keeps control) `→ Entering → Skating → Leaving → Ready`, plus `Skating → Delegated → Entering` for actions the guest has no movement for (swimming when the chest is under water, climbing on a double-tap X within 450 ms). Forced exits: menu, death, runtime error, network. `Blocked(ped, strict)` returns a reason string when entry is not allowed (in missions, entering a vehicle with the same button).
- Limits are host-configurable with a sentinel: air-time limit (retail 300 frames → teleport to checkpoint; `None` = retail, `i32::MAX` = off, patch 0031); bail recovery eligibility after settling or 1.6 s (patch 0030); difficulty presets as data (`Easy/Normal/Hardcore/Motorized`, persisted to `settings/gameplay.json`, patch 0043); camera type enum (patch 0044).

### 3.6 Collision working set, rails and curbs (`world.rs`, `reuse.rs`, `rails.rs`, `curbs.rs`, `dynamic.rs`)
- Static collision comes from the host's loaded physics level, never per-frame raycasts; a square working set (256 m) around the player is rebuilt on a builder thread, recentred ahead of the player using velocity (`lead_centre`), and incremental rebuilds redo only cells touched by changed triangles (triangle identity = hash of vertex bits).
- Moving host entities enter as oriented boxes each frame (`SvBox{tag, center, rotation, half_extents}`) and through the guest's own contact code.
- Grind rails are derived from geometry: an edge of a walkable face where the ground falls away and nothing rises; edges merge across seams and chain into polylines at gentle turns; a convexity gate rejects valley creases.
- Curbs: ramp toe (top descends faster than ground) gets a flush fillet; shallow dishes (potholes: median 2.3 cm deep, 7.7° walls) are kept; real risers are kept because a 22° bevel turned a 7.5 cm curb into a kicker at 8.75 m/s (creator measurement).

### 3.7 Host-driven impacts, input, diagnostics
- Patch 0017 resolves a fast host body (car) against the whole rider+board assembly as a two-body rigid impact before the shared solve: `j = (1+e)·v_closing / (1/M + n·(I⁻¹(r×n))×r + 1/m + n·(I_h⁻¹(r_h×n))×r_h)`, applied only when the host body moves into the contact within the step; the opposite impulse returns to the host. Without it "a car drove into and through the rider".
- Input crosses the ABI as one raw XInput-shaped pad (PlayStation pads normalised host-side); presses are edge events; menu chords use rising edges.
- Diagnostics in-process: panic hook with backtrace, first-chance exception log with module+offset, watchdog for a stage busy > 4 s and private heap > 1 GB; per-2-s tick cost vs period. A private Win32 heap avoids sharing the host's allocator lock during 300k-triangle rebuilds; an FMA fallback in the C runtime made ticks ~5× slower on pre-Haswell CPUs (creator measurement) — the general lesson is to benchmark the tick on the weakest target.
- **Showcase lines** (`line.rs`): a text file with a start pose and per-tick controller frames plus reactive commands (`aim x y`, `follow`, `wait near x y r timeout`), fed to the simulation exactly as a pad would; any player input stops playback. Fixed frames alone do not repeat ("a centimetre of difference after one grind decides whether the next catches"), so lines react like a player.
- Records per map zone ("spot") by category, saved as JSON next to the log.

## 4. Pattern cards

| ID | Pattern | Where found | How our game applies it | Caveats |
|---|---|---|---|---|
| P-UM-01 | One instruction file, imported everywhere | `AGENTS.md`, `CLAUDE.md` (`@AGENTS.md`), `GEMINI.md` | Root `AGENTS.md` is canonical; `CLAUDE.md` < 200 lines imports it (R-ENG-01); per-package `AGENTS.md` for `packages/mod-sdk` (closest file wins) | Claude Code ignores `AGENTS.md` when `CLAUDE.md` exists unless imported |
| P-UM-02 | Skills mirrored as real copies + equality test | `skills/`, `.claude/skills`, `.agents/skills`, `test_skill_copies_match` | Same three dirs; `npm run check:skills` in CI | Symlinks break on Windows clones |
| P-UM-03 | SessionStart PATH hook via `CLAUDE_ENV_FILE` | `hooks/add-to-path.sh` | Put `node_modules/.bin` + repo `bin/` on PATH so skills say `dv mod check` | Add the `fork` matcher; PowerShell hooks do not get `CLAUDE_ENV_FILE` |
| P-UM-04 | MCP configs per agent, key by reference | `.mcp.json`, `.codex/config.toml`, `.cursor/mcp.json`, `.vscode/mcp.json`, `gemini-extension.json`, `opencode.json` | Ship configs for our `mod-mcp` (local stdio, no key) and optional fal | fal auth drifted (Bearer `/mcp` vs OAuth `/mcp-relay`, `Key` header) |
| P-UM-05 | CLI = docs (`--help` per group) + CI help smoke | `um/cli.py`, `test.yml` | `dv <group> <cmd>` in `tools/cli`; CI runs every `--help` | — |
| P-UM-06 | Generation manifest per asset | `um/fal.py::generate` → `fal_manifest.jsonl` | Every generated file gets a provenance line feeding C07 `provenance` | Data URIs truncated in the log |
| P-UM-07 | Field-note KB with checker and generated index | `knowledge/`, `um/kb.py` | `knowledge/` for builders and modders; `dv kb check/index/search` | Notes are untrusted text for agents |
| P-UM-08 | Publish lint | `um/publish.py` | `dv mod check`: secrets, provenance, banned formats, likeness, caps | A lint, not moderation |
| P-UM-09 | Oracle discipline | `oracles-how-agents-know-a-mod-works.md` | Every milestone AC names its oracle; mutation check for benches; CI hashes verifier scripts | Synthetic host is not real device |
| P-UM-10 | Agent bridge (observe/act/step as text) | `AgentBridge.cs` | Dev/test-build `window.__dvBridge` + Playwright; agents test mods without pixels | Never shipped in production builds |
| P-UM-11 | Mock host for UI work | `mock_game.py` | `dv mod dev --mock` runs mod UI against a fake ModAPI | — |
| P-UM-12 | Evidence file per verified build | `mindustry-verification.json` | `evidence.json` required for a "verified" store badge | Records method, not truth |
| P-UM-13 | Three-role team, DONE/QUESTION reports | `agents/*.md` | Optional for long builder milestones and for M13 dogfooding | Several times the tokens of one agent |
| P-UM-14 | Bridge/port contract before code | `bridge-contracts-…md`, `porting-a-vehicle-semantic-traps.md` | ModAPI ownership table; vehicle tuning table with a semantics column | — |
| P-SK-01 | Pinned upstream + ordered patch overlay keyed by hash | `prepare-skate-overlay.ps1` | Experiences/mods as overlays pinned to a world version; overlay cache key = hash(base version + overlay hashes) | Refuse to clobber uncaptured local edits |
| P-SK-02 | Versioned, size-prefixed ABI asserted on both sides | `skatev_runtime.h`, `lib.rs` | `NetMessage`, worker messages and ModAPI messages carry `v` and are schema-tested on both sides | — |
| P-SK-03 | Sim-owned fixed period, 0.15 s cap, present previous step + blend | `worker.rs` | C02 sim at 60 Hz in a physics worker; render reads latest completed snapshot | Adds one tick of latency |
| P-SK-04 | State families + predicates + read-only lifecycle monitor | `lifecycle.rs` | Controller state IDs by family; ownership monitor with settle/timeout | — |
| P-SK-05 | Ownership state machine with `Delegated` | `host/src/lifecycle.h` | Player control passes between on-foot, vehicle, board, swim, cutscene, fighter | — |
| P-SK-06 | Collision working set rebuilt off-thread with velocity lead, incremental | `world.rs`, `reuse.rs` | Physics colliders for chunks near the player built in a worker (C08) | Fast cars outrun naive radius |
| P-SK-07 | Derive rails/ledges and classify curbs from geometry | `rails.rs`, `curbs.rs` | Bake ledges/rails/curb risers into chunk metadata (S02) for parkour, skate, vehicle curb strikes | Our geometry is extruded footprints, not detailed |
| P-SK-08 | Two-body impact against an assembly | patch 0017 | Car-vs-pedestrian/ragdoll-lite impulses; return impulse to car | — |
| P-SK-09 | Reactive scripted input "lines" | `line.rs` | Deterministic regression drives for racing/fighter/skate | Must stop on any player input |
| P-SK-10 | Sentinel-configurable limits and data presets | patches 0030/0031/0043/0044 | Air-time reset, bail recovery, difficulty presets in `config/*.json` | — |

## 5. Design for our game's modding and UGC layer

### 5.1 Files the repo ships (adds to the package layout in 06 §5)

```
AGENTS.md                      # canonical; build/test/deploy commands, rules, where things are
CLAUDE.md                      # @AGENTS.md + Claude specifics (<200 lines)
GEMINI.md                      # @AGENTS.md
skills/<name>/SKILL.md         # canonical skills (Agent Skills format)
.claude/skills/ .agents/skills/  # copies; check:skills enforces equality
.claude/settings.json          # SessionStart PATH hook (matchers startup|resume|clear|compact|fork)
.mcp.json .codex/config.toml .cursor/mcp.json .vscode/mcp.json opencode.json gemini-extension.json
knowledge/{README.md,TEMPLATE.md,INDEX.md,index.json,builds/,mods/,techniques/}
packages/mod-sdk/              # @dv/mod-sdk: ModAPI types, manifest JSON Schema, test kit, AGENTS.md
packages/mod-runtime/          # host side: loader, QuickJS worker, iframe host, permission broker
tools/cli/                     # `dv` CLI: mod, kb, assets, check, perf
tools/mod-mcp/                 # MCP server (stdio + local Streamable HTTP) wrapping `dv mod *`
examples/mods/{vehicle-handling,character-skin,mission-pack,experience-race,rules-script}/
docs/{STATUS.md,HANDOFF.md,MODDING.md,CONTRACT-modapi.md}
```

Skills for modders (shipped in `skills/`): `mod-the-game` (the loop: search KB → pick tier → scaffold → vertical slice → assets → `dv mod test` → evidence → check → pack → publish draft → field note), `mod-assets` (fal recipes routed through provenance), `mod-missions` (C09 mission IR authoring), `mod-vehicles` (handling table with semantics column, §7.3), `publish-experience`, `share-field-notes`. Skills for the builder (Sonnet): `run-milestone`, `perf-check`, `add-asset`, `add-mission`, `kb-note`. Keep every SKILL.md < 500 lines with depth in `references/` (Agent Skills spec).

### 5.2 Tiers and sandbox architecture

| Tier | What a mod contains | Where it runs | Isolation | Milestone |
|---|---|---|---|---|
| D (data) | JSON validated by JSON Schema (vehicle handling, character appearance, mission IR, experience scene ≤ 512 ops, spawn tables) + assets (glTF/KTX2/Ogg) | parsed by the host | no code; schema + size caps + provenance | first-party content uses it from M03; user mods M13a |
| S (script) | one ES module compiled by `dv mod pack` to JS, ≤ 1 MiB | QuickJS-wasm (`quickjs-emscripten`) inside a dedicated Web Worker on the game origin | no `fetch`, DOM, `Date`, `Math.random` in the global; only ModAPI host functions; interrupt handler per call; memory limit; worker terminated on overrun | M13a |
| U (UI panel) | static HTML/JS/CSS bundle | cross-origin iframe on `mods-ui.<domain>` served by our Worker with `Content-Security-Policy: sandbox allow-scripts` (header, not meta) and iframe `sandbox="allow-scripts"` | opaque origin; postMessage only, schema-validated; no storage, cookies or same-origin access | M13b |
| Server | experience server logic | Cloudflare Dynamic Workers (`globalOutbound: null`, `limits.cpuMs`) | isolate per mod; only bindings we pass | deferred until a vetting milestone after M14 |

Rationale: ShadowRealm is unshipped (Stage 2.7); SES (`ses@2.3.0`) gives frozen intrinsics and Compartments but cannot pre-empt an infinite loop without terminating its worker; QuickJS-emscripten has per-eval `shouldInterrupt` deadlines and `memoryLimitBytes`, runs in Safari 11.1+, but is unaudited 0.x and interpreted (speed UNVERIFIED on iPhone; M13a spike sets the per-tick budget). The game page is cross-origin isolated (COOP/COEP from `repos-grand-v.md` rec 1), so the UI iframe origin must itself send COEP/CORP headers; `credentialless` iframes are Chrome/Edge-only and cannot be the plan. Mods never run in multiplayer rooms (06 §3); `ModManifest.multiplayer` is the literal `false`.

### 5.3 `ModManifest` (C14) — proposed fields (S12 finalises)

```ts
type ModKind = 'experience' | 'vehicle' | 'character' | 'rules' | 'mission';
type ModPermission =
  | 'world.props' | 'world.spawn' | 'world.markers' | 'mission.register' | 'vehicle.register'
  | 'character.register' | 'player.teleport' | 'player.loadout' | 'camera.cinematic'
  | 'audio.play' | 'ui.panel' | 'ui.hud' | 'storage' | 'rules.tick' | 'rules.events';
interface ModManifest {
  schema: 'dv-mod/1';
  id: string;                    // "<authorSlug>.<modSlug>", ^[a-z0-9-]{2,40}\.[a-z0-9-]{2,40}$
  name: string; version: string; // semver; integer-component compare
  author: { id: string; display: string };
  kind: ModKind; tier: 'data' | 'script';
  api: string;                   // ModAPI semver range, e.g. "^1.0"
  compat: { game: string; world?: string };   // world = baked world version, e.g. "sf@2026.11"
  entry?: string;                // tier script only
  ui?: string;                   // optional UI bundle entry
  permissions: ModPermission[];
  assets: { path: string; kind: string; sha256: string; bytes: number; provenance: number }[]; // index into provenance[]
  provenance: { source: 'own-work' | 'generated' | 'licensed'; license: string; generator?: { vendor: 'fal'; endpoint: string; requestId: string; seed?: number; promptHash: string } }[];
  license: string;               // SPDX of the mod itself
  remixOf?: { id: string; version: string; sha256: string };
  likeness: { npcId: string; tier: 'consented' | 'parody' | 'fictionalized' }[];
  contentRating: 'everyone' | 'teen' | 'mature';
  multiplayer: false;
}
```
Install-side fields (`enabled`, `installedFrom`, `installedAt`, `sourceArchive{name,sha256,size}`) and store counters come from `repos-grand-v.md` rec 6 and live in the install record, not the authored manifest. Caps: archive ≤ 128 MiB, ≤ 64 installed packages / 512 MiB combined (Grand-V); script ≤ 1 MiB; experience ≤ 512 ops (gamedesign §7.7).

### 5.4 `ModAPI` v1 surface (capabilities, not globals)

`register(ctx)` receives only the namespaces the manifest's permissions grant: `world` (`placeProp`, `spawnVehicle`, `spawnPed`, `addMarker` — all clamped to the experience radius), `mission.register(ir)` (C09 IR is data), `vehicle.register(preset)`, `character.register(appearance)`, `player` (`teleport` within radius, `giveLoadout` from registered items), `camera.playCinematic(shots)`, `audio.play(id)`, `ui` (`panel.post(msg)`, `hud.set(widget)`), `storage` (per-mod KV ≤ 1 MiB in the save's sandbox slice), `rules` (`onTick(fn)` at ≤ 10 Hz, `onEvent(type, fn)` for typed game events). Determinism: `ctx.rng` (seeded stream per mod, matching M01a's ban on `Math.random` in `sim/`) and `ctx.time` (sim time); wall clock and network are absent. Errors: a throw or budget overrun disables the mod for the session with a toast and a log line; story saves are untouched (story/sandbox namespaces, gamedesign P-8). No LLM, fal or network permission in v1: NPC dialogue goes through the official proxy (C10), assets are generated at authoring time.

### 5.5 Local dev loop for coding agents

`dv mod new <kind>` (scaffold from `examples/mods/*` + a `MODLOG.md` journal) · `dv mod dev` (watch + rebuild + hot reload over a 127.0.0.1 WebSocket with a random token, into the **locally run** game from `npm run dev`; `--mock` runs against a fake ModAPI) · `dv mod test` (Playwright drives the game in test mode through the agent bridge: `observe()` returns HUD/menu tree and nearby entities as JSON, `act(InputAction[])`, `step(n)` advances n fixed ticks deterministically, `shot({scale})`; scenario files are reactive input "lines" (P-SK-09); writes `evidence.json`) · `dv mod check` (§5.7) · `dv mod pack` (deterministic zip: sorted entries, fixed mtimes, so the sha256 is stable for `ugc/published/{sha256}.zip`) · `dv mod publish` (draft upload through the backend flow in `stack-cloudflare-backend.md` §16; user confirms). `tools/mod-mcp` exposes the same verbs (`mod_new`, `mod_test`, `mod_check`, `kb_search`, `asset_generate`) over stdio and local Streamable HTTP, binding 127.0.0.1, validating `Origin`, requiring a token (MCP spec security warning). Connecting the **hosted** game to a localhost dev server triggers Chrome's Local Network Access prompt (Chrome 142+), so the hosted "dev link" is optional, not the primary loop.

### 5.6 Sign-in-with-ChatGPT and the fallback

| Flow | Who | How | Status |
|---|---|---|---|
| A. BYO agent (primary) | anyone with Codex CLI, Claude Code, Gemini CLI, Cursor, Copilot, OpenCode | clone repo → agent reads `AGENTS.md` + skills → `dv mod *` / `mod-mcp` | works today; no OpenAI program needed |
| B. ChatGPT plan usage in the local CLI | ChatGPT Plus/Pro users without a coding agent | `dv mod assist` runs a small open-source agent loop locally; "Sign in with ChatGPT" via loopback callback; Responses API calls with `store:false`, streaming | official path for open-source/locally hosted apps; a paid or hosted variant needs OpenAI's interest form |
| C. SIWC identity on the hosted site | publishers | OIDC Authorization Code + PKCE against `auth.openai.com`, scopes `openid profile email`; links to the profile behind the identity interface (R-AUTH-02) | limited trial for selected partners; apply, do not depend on it |
| D. ChatGPT app (MCP) | later | expose `mod-mcp` verbs as a ChatGPT app | Apps SDK is MCP-based, preview (medium confidence); details owned by `auth-ugc-input-maps.md` |

Publishing needs a non-anonymous identity (anonymous users are blocked from publish/forum inserts by RLS in `stack-cloudflare-backend.md`); until Thirdweb (M14a), that identity is flow C if approved or a Supabase OAuth provider chosen by S09 (open question Q-MOD-01).

### 5.7 Publish pipeline, provenance, likeness, remix, experiences

`dv mod check` (local) and the Queue validator (server, same code) FAIL on: secrets (reuse universal-modder's pattern classes: fal, Anthropic `sk-ant-`, OpenAI `sk-proj-/svcacct/admin`, GitHub `ghp_/github_pat_`, AWS `AKIA`, PEM keys), `.env` files, schema violations, assets without a provenance entry, banned formats (RAGE/Rockstar `.rpf .ybn .ydr .ydd .yft .ytd .ymap .ytyp .oiv .gxt2`, console images `.xex .iso`), unknown permissions, likeness entries whose tier the operator has not set (default `parody`), any face/voice asset tagged to a real person unless `consented` (constraint 5), caps exceeded, `multiplayer` not `false`; WARN on missing README/credits, fal assets without a credit line, absolute paths. Server-only checks add moderation scanning and the DMCA path (legal report). Provenance mapping: each `fal_manifest.jsonl`-style line → `{source:'generated', generator:{vendor:'fal', endpoint, requestId, seed, promptHash}, license}`; own work and CC0/CC-BY assets declare `source` and SPDX `license`; the CI provenance check from M00 (gamedesign M00 AC) uses the same validator. Generation for hosted users goes through our Worker proxy with per-player quotas (R-ENG-03); BYO-agent modders use their own `FAL_KEY` locally and our validator only checks the record.

Remix: allowed only when the parent's `license` is in an allowlist (`CC0-1.0`, `CC-BY-4.0`, `CC-BY-SA-4.0`, `MIT`, `Apache-2.0`) or the parent author ticks "allow remix"; `remixOf` pins the parent sha256; SA licenses propagate; credits chain is rendered in the store (port-a-mod licence rules; evidence-levels lineage rule: record the exact base).

Experiences on the map (C17): propose adding `worldVersion` and `modSha256` to `ExperienceDescriptor`, so an experience is an overlay pinned to a baked world version; when the world rebakes, the server re-validates every overlay and marks broken ones `needs-update` instead of loading them (P-SK-01). Overlay cache key = `sha256(worldVersion | modSha256)`.

### 5.8 Forum

Add a post type `field-note` with the KB template's sections (Setup with exact game/ModAPI versions, Route/tier and why, Verification incl. what was not verified, numbered Gotchas). An accepted note can be exported into `knowledge/mods/` by PR. All forum and KB text is untrusted data when an agent reads it (`mod-mcp` returns it as quoted data with author and date).

### 5.9 Milestone mapping

M00: `AGENTS.md`/`CLAUDE.md`/`GEMINI.md`, skills mirror + check, SessionStart hook, `dv` CLI skeleton with `--help` smoke, `knowledge/` + `kb check`, provenance check. M01a: agent bridge (`observe/act/step`) in test builds. M03–M05: first-party vehicles, characters and missions authored as tier-D packs through `packages/mod-sdk` schemas (dogfooding). M13a: permission broker, script tier behind a default-off flag until the mobile-tier spike passes (Q-MOD-02), `dv mod new/dev/test/check/pack`, `mod-mcp`, install/uninstall per Grand-V. M13b: UI tier, experience overlays and markers. M13c: publish, moderation, forum field notes, SIWC flows B/C. Post-M14: server tier on Dynamic Workers after a vetting milestone.

## 6. Agent-friendly repo conventions for the builder (Goal B)

1. **Instruction topology** (P-UM-01): root `AGENTS.md` ≤ 150 lines (commands, layout, rules, "where to look"), package-level `AGENTS.md` where rules differ; `CLAUDE.md` imports and adds only Claude specifics; deep material in `docs/` and skills, loaded on demand.
2. **Tooling contract** (P-UM-03/04/05): every check is one deterministic command (`npm run check:*`), wrapped by `dv` with `--help` text that doubles as docs; a SessionStart hook makes the CLI callable by bare name; MCP configs reference keys by env-var name only.
3. **Journal and handoff** (port-a-mod §7): `docs/STATUS.md` (per milestone: done / tested / seen on device / unverified, exact next task), `docs/HANDOFF.md` (non-negotiables, commands, last real test result, open questions), one commit per verified unit; "build at the start of every session"; "never claim a run that did not happen".
4. **Knowledge base** (P-UM-07): `knowledge/builds/` notes written by the builder when a milestone teaches something (e.g. "WebGPU on iOS: …"), same schema and checker; `kb search` before starting a milestone.
5. **Oracles first** (P-UM-09): each acceptance criterion names its oracle (unit test, deterministic replay hash, Playwright scenario through the bridge, device check). Benches get a mutant set (one-defect builds must fail); CI stores a hash of each verifier script and fails if a builder edits it in the same PR as the code it checks; 3-failure circuit breaker written into `AGENTS.md`.
6. **Evidence vocabulary** (P-UM-12): reports and PR bodies use "implemented / tested / seen on device / unverified"; store listings show the mod's evidence level.
7. **Contracts before code** (P-UM-14, P-SK-02): each cross-boundary interface (worker messages, ModAPI, NetMessage) gets a `docs/CONTRACT-*.md` with ownership, units/axes as a function, channels with full/late policy, version, lifecycle, "not covered"; message schemas are tested from both sides.
8. **Pinned inputs** (P-SK-01): lock files with exact versions/SHAs and roles; verify script in CI; generated `THIRD-PARTY-NOTICES`; release refuses artefacts containing local absolute paths.
9. **Long-run hygiene** (oracles note gotcha 8): re-inject goal and hard rules on a timer in long sessions and compact early (~40% fill reported); worker comments are not evidence.

## 7. Physics and controller recommendations (Goal C)

### 7.1 Loop
Simulation at a fixed 60 Hz in the physics worker (C02), accumulator capped at 0.15–0.25 s, render reads the latest completed snapshot pair and interpolates with `alpha = acc/period`; skip interpolation on teleport (tick gap > 3 or jump > 2 m); interpolate angles the short way. The render thread never waits on the physics worker.

### 7.2 Controller ownership
One `ControllerOwner` state per player entity: `OnFoot | Vehicle | Board | Swim | Climb | Cutscene | Fighter | Ragdoll`. Transitions go through a host state machine modelled on SK8V: `Ready → Waiting` (target controller's colliders not yet built) `→ Entering → Active → Leaving → Ready`, with `Delegated` for actions the active controller lacks (swim, climb) and forced exits (pause menu, death, error, net). A read-only monitor observes published controller state and raw input, applies settle windows (≈ 0.25 s) and timeouts (≈ 5 s), and logs every transition with its reason. State IDs are grouped by family (e.g. 1xx ground, 2xx air, 3xx crash/bail, 4xx attached: grind/ledge/seat, 5xx on-foot) with family predicates; IDs are ours.

### 7.3 Vehicles
Rapier's JS API offers `createCharacterController(offset)` with autostep/snap-to-ground/slope limits and a ray-cast vehicle controller (`DynamicRayCastVehicleController.addWheel(position, suspensionDir, axle, restLength, radius)`); engine choice belongs to `stack-rendering-platform.md`. Whatever the engine, author each handling preset with the port-contract table (name | value | units | **meaning** | source | mechanism | conversion | oracle | tolerance); an empty meaning cell blocks implementation. Known traps: damping as a coefficient in s⁻¹ vs a ratio (3× over-damped), tread vs hub contact point, world-frame vs support-frame springs ("magnetic" cars). Ship a throttled log oracle (`susp lf/rf/lb/rb travel, zeta`) with each change; change one constant at a time against a baseline drive. Car impacts on pedestrians/props use the two-body impulse against the whole assembly (P-SK-08) and return the impulse to the car.

### 7.4 Input and regression drives
Normalise every device to one action/pad frame at the sim boundary (C03), with presses as edge events and documented chords/double-tap windows (450 ms in SK8V). Record reactive input scripts (start pose, per-tick frames, `aim`, `follow`, `wait near`) for racing laps, pursuit escapes and fighter combos; CI replays them and compares end-state hashes (gamedesign M01a determinism). Player input aborts playback.

### 7.5 Collision near the player
Build physics colliders for chunks inside a working square around the player (start at 256 m, velocity-led, larger for racing speeds) in a worker; rebuild incrementally by changed cells. Bake rails/ledges (walkable-edge test with convexity gate) and curb classes (ramp toe / shallow dish / riser) into chunk metadata in `tools/map`, so skate tricks, parkour and curb strikes use real SF geometry; keep real risers sharp (a bevel turned a 7.5 cm curb into a launch ramp at 8.75 m/s in SK8V). Configurable limits with sentinels: airborne reset, bail recovery, difficulty presets as JSON.

## Verified facts

| fact | source URL | date checked | confidence |
|---|---|---|---|
| universal-modder: MIT licence, ~8.3k stars, 906 forks, 263 commits | https://github.com/rehan-remade/universal-modder | 2026-10-18 | high |
| Local clone HEAD `6a8865a` dated 2026-10-17; 12 skills, 3 agents, 11 CLI groups, 265 KB notes (184 game, 81 technique); `test_skill_copies_match` enforces `.claude/skills` = `.agents/skills` = `skills/` | https://github.com/rehan-remade/universal-modder (clone read locally) | 2026-10-18 | high |
| universalmodder.com is a "coming soon" landing page (no publish/remix flow) | https://universalmodder.com | 2026-10-18 | high |
| AGENTS.md: open format stewarded by the Agentic AI Foundation (Linux Foundation); supported by Codex, Gemini CLI, Cursor, Copilot coding agent, opencode, Zed, Warp, Devin, Jules and others; nearest file wins, user prompts override | https://agents.md/ | 2026-10-18 | high |
| Agent Skills spec: `name` 1–64 chars, lowercase/digits/hyphens, matches directory; `description` 1–1024 chars; optional `license`, `compatibility` (≤500), `metadata`, `allowed-tools` (experimental); metadata ~100 tokens loaded at startup; SKILL.md < 5000 tokens and < 500 lines recommended | https://agentskills.io/specification | 2026-10-18 | high |
| Claude Code skills: `.claude/skills/<name>/SKILL.md` (project, nested), `~/.claude/skills`, plugin `skills/` namespaced `/plugin:skill`; follows the Agent Skills standard | https://code.claude.com/docs/en/skills | 2026-10-18 | high |
| Claude Code reads AGENTS.md directly only when no CLAUDE.md exists; otherwise import with `@AGENTS.md` | research/claude-code-deployment.md (https://code.claude.com/docs/en/memory.md) | 2026-10-18 | high |
| `CLAUDE_ENV_FILE` is available to SessionStart, Setup, CwdChanged, FileChanged hooks; its contents run before each Bash command; SessionStart matchers `startup, resume, clear, compact, fork` | https://code.claude.com/docs/en/hooks | 2026-10-18 | high |
| Claude Code plugin manifest at `.claude-plugin/plugin.json` (only `name` required); default dirs `skills/ agents/ hooks/hooks.json .mcp.json bin/`; a plugin-root `CLAUDE.md` is not loaded; `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}` | https://code.claude.com/docs/en/plugins-reference | 2026-10-18 | high |
| Codex skills: `$CWD/.agents/skills`, `$REPO_ROOT/.agents/skills`, `$HOME/.agents/skills`, `/etc/codex/skills`; built on the Agent Skills standard; standalone skills also in ChatGPT desktop app | https://learn.chatgpt.com/docs/build-skills (redirect from developers.openai.com/codex/skills) | 2026-10-18 | high |
| OpenCode skill dirs: `.opencode/skills`, `.claude/skills`, `.agents/skills` (+ global equivalents) | https://opencode.ai/docs/skills/ | 2026-10-18 | high |
| Copilot reads skills from `.github/skills`, `.claude/skills`, `.agents/skills` | https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/create-skills (via search) | 2026-10-18 | medium |
| Gemini CLI treats `.agents/skills` as an alias of `.gemini/skills` | https://geminicli.com/docs/cli/creating-skills/ (via search) | 2026-10-18 | medium |
| fal hosted MCP: `https://mcp.fal.ai/mcp-relay`, OAuth by default; non-OAuth clients send `Authorization: Key <key_id>:<key_secret>`; tools include `search_models, get_model_schema, get_pricing, run_model, submit_job, check_job, get_job_result, cancel_job, upload_file` | https://fal.ai/mcp ; https://fal.ai/docs/documentation/setting-up/mcp | 2026-10-18 | high |
| fal queue: `POST https://queue.fal.run/{endpoint}` with `Authorization: Key $FAL_KEY` → `request_id, status_url, response_url, cancel_url, queue_position`; statuses `IN_QUEUE, IN_PROGRESS, COMPLETED`; `?logs=1`; `fal_webhook` param, webhook status `OK/ERROR`, deduplicate by `request_id` | https://fal.ai/docs/model-apis/model-endpoints/queue | 2026-10-18 | high |
| fal catalogue (public `api.fal.ai/v1/models`): active `fal-ai/trellis-2`, `fal-ai/meshy/rigging` (2026-05-19), `fal-ai/meshy/rigging/multi-animation` (2026-06-12), `meshy/v7.1/image-to-3d` (2026-09-19), `tripo3d/h3.1/image-to-3d`, `fal-ai/hunyuan-3d/v3.1/pro/image-to-3d`, `openai/gpt-image-2`, `fal-ai/nano-banana-2/edit`, `fal-ai/hunyuan-motion`, `tripo3d/tripo/remesh`, `elevenlabs/music/v2.5` | https://api.fal.ai/v1/models?endpoint_id=fal-ai/trellis-2 (one query per id) | 2026-10-18 | high |
| `bytedance/seedance-2.5/image-to-video` and `fal-ai/meshy/v5/remesh` (universal-modder defaults) return entries without status/category; active Seedance 2.5 listings are `bytedance/seedance-2.5/us/{image,text,reference}-to-video` | https://api.fal.ai/v1/models?q=seedance&status=active | 2026-10-18 | medium |
| fal pricing endpoint requires an API key | https://api.fal.ai/v1/models/pricing?endpoint_id=fal-ai/trellis-2 | 2026-10-18 | high |
| MCP Streamable HTTP (spec 2025-11-25): servers MUST validate `Origin`; local servers SHOULD bind 127.0.0.1; SHOULD authenticate | https://modelcontextprotocol.io/specification/2025-11-25/basic/transports | 2026-10-18 | high |
| iframe `sandbox` without `allow-same-origin` gives an origin that always fails same-origin checks; `allow-scripts` + `allow-same-origin` on same-origin content lets it remove the sandbox | https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe | 2026-10-18 | high |
| CSP `sandbox` directive works only as a real response header (not `<meta>`, not Report-Only) | https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/sandbox | 2026-10-18 | high |
| `crossOriginIsolated` needs COOP `same-origin` + COEP `require-corp` or `credentialless`; COEP applies to resources in iframes and nested frames | https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy | 2026-10-18 | high |
| `credentialless` iframes: Chrome/Edge 110+; not supported in Firefox or Safari (incl. iOS) | https://caniuse.com/wf-iframe-credentialless | 2026-10-18 | medium |
| ShadowRealm is at Stage 2.7; no browser has shipped it | https://github.com/tc39/proposal-shadowrealm | 2026-10-18 | high (stage) / medium (shipping) |
| npm latest: `ses` 2.3.0 (2026-08-13), `quickjs-emscripten` 0.32.0 (2026-02-16), `three` 0.186.1, `@dimforge/rapier3d(-compat)` 0.21.0 (2026-09-25), `jolt-physics` 1.1.0 | https://registry.npmjs.org/quickjs-emscripten (and per package) | 2026-10-18 | high |
| quickjs-emscripten: `shouldInterrupt` (e.g. `shouldInterruptAfterDeadline`), `memoryLimitBytes`, `runtime.setMemoryLimit/setMaxStackSize/setInterruptHandler`; asyncify variants; Safari 11.1+; README says not audited | https://github.com/justjake/quickjs-emscripten | 2026-10-18 | high |
| SES: `lockdown()` hardens intrinsics; Compartments have own `globalThis`; `Math.random`/`Date.now` disabled inside compartments unless endowed | https://github.com/endojs/endo/blob/HEAD/packages/ses/README.md (via search) | 2026-10-18 | medium |
| Cloudflare Dynamic Workers: open beta since 2026-03-24, Workers Paid only; `globalOutbound: null` makes `fetch()`/`connect()` throw; `limits.cpuMs`; pricing 1,000 unique Dynamic Workers/month included then $0.002 per worker per day, requests/CPU at Workers Standard rates | https://developers.cloudflare.com/dynamic-workers/pricing/ ; https://developers.cloudflare.com/dynamic-workers/usage/egress-control/ | 2026-10-18 | high |
| Sign in with ChatGPT on websites: limited trial for selected commercial partners (waitlist); OIDC Authorization Code + PKCE; issuer `https://auth.openai.com`; scopes `openid profile email` | https://developers.openai.com/siwc/website | 2026-10-18 | high |
| ChatGPT plan usage is offered for open-source and locally hosted apps (loopback callback; Responses API with `store:false`); paid or remotely hosted apps go through an interest form; no access to the user's conversations | https://developers.openai.com/siwc/token-sharing-open-source | 2026-10-18 | high |
| Chrome Local Network Access prompt from Chrome 142 gates public-site requests to localhost (fetch, subresources, subframes); WebSockets were not yet gated per the June 2025 post | https://developer.chrome.com/blog/local-network-access | 2026-10-18 | medium |
| Fix Your Timestep: accumulator, frame time clamped to 0.25 s, render `alpha = accumulator / dt` | https://gafferongames.com/post/fix_your_timestep/ | 2026-10-18 | high |
| Rapier JS: `world.createCharacterController(offset)`, `computeColliderMovement`, `enableAutostep`, `enableSnapToGround`, `setMaxSlopeClimbAngle`; `DynamicRayCastVehicleController.addWheel(...)` | https://rapier.rs/docs/user_guides/javascript/character_controller/ ; https://rapier.rs/javascript3d/classes/DynamicRayCastVehicleController.html | 2026-10-18 | high |
| SK8V: Apache-2.0, 95 stars, 12 forks, 37 commits; local HEAD `6a1a6e2` 2026-10-16; targets GTA V Legacy 1.0.3889.0 + ScriptHookV v3889.0, Story Mode only; 49 patches; ABI version 8; Rust 1.98.1 | https://github.com/becaring/SK8V (+ local clone) | 2026-10-18 | high |

## Unverified

- Per-tick cost of QuickJS-wasm on iPhone/Quest for a `rules.onTick` script; the budget numbers in §5.4 (10 Hz, 1 MiB) are design values to measure in M13a.
- That a cross-origin, opaque-origin sandboxed iframe sending its own COEP/CORP headers embeds cleanly in our COOP/COEP page on iOS Safari (spike in M13a).
- Whether Chrome's LNA now gates WebSockets (the 2025 post said no).
- Whether `https://mcp.fal.ai/mcp` with `Bearer` (universal-modder's config) is still accepted.
- `opencode.json` `skills.paths` key (not on OpenCode's skills page).
- Copilot and Gemini CLI skill paths (from search summaries of official pages, not fetched directly).
- OpenAI Apps SDK status (preview, MCP-based) — secondary sources; owned by `auth-ugc-input-maps.md`.
- Whether SIWC plan usage permits a local CLI that also talks to our hosted backend under the open-source terms.
- Rapier JS `world.createVehicleController(chassis)` naming in 0.21 (guide mentions it; class docs show the controller class).
- All SK8V and universal-modder behaviour and performance numbers (5× FMA slowdown, 8.75 m/s curb launch, 30 fps loss, decompilation statistics) are creator reports; nothing was run.
- Install commands for other agents in the universal-modder README (`codex plugin marketplace add`, `gemini extensions install`, `npx skills add`) were not executed.

## Recommendations for the spec

1. Ship `AGENTS.md` as the single instruction source; make `CLAUDE.md` (< 200 lines) and `GEMINI.md` import it with `@AGENTS.md`; add package-level `AGENTS.md` in `packages/mod-sdk`.
2. Author skills only in `skills/`; copy them to `.claude/skills` and `.agents/skills` as real directories; fail CI (`check:skills`) on any difference; do not create `.gemini/skills` or `.github/skills`.
3. Add a SessionStart hook (matchers `startup|resume|clear|compact|fork`) that appends the repo `bin/` to `$CLAUDE_ENV_FILE` once.
4. Ship one `dv` CLI with one module per group, module help as docs, and a CI step that runs every `--help`.
5. Ship `knowledge/` with `README.md`, `TEMPLATE.md` (Setup / Route-or-tier / Verification incl. not-verified / numbered Gotchas), a checker (keys, sections, secrets, unfilled template, code blocks > 150 lines, media > 1.5 MB) and generated `INDEX.md` + `index.json`; run `kb check --index` in CI from M00.
6. Require every acceptance criterion to name its oracle; add mutant builds for every replay/determinism bench; store verifier-script hashes and fail a PR that changes a verifier together with the code it verifies.
7. Write `docs/STATUS.md` and `docs/HANDOFF.md` from M00 and use the evidence levels implemented / tested / seen on device / unverified in every report.
8. Expose an agent bridge (`observe`, `act`, `step(n)`, `shot`) in dev and test builds only; drive it from Playwright for e2e tests and from `dv mod test` for mods.
9. Use three mod tiers: data (default, JSON Schema + assets), script (QuickJS-wasm in a dedicated Worker, capability-only ModAPI, interrupt deadline, memory limit, terminate on overrun), UI (opaque-origin sandboxed iframe on `mods-ui.<domain>` with `CSP: sandbox allow-scripts` as a header).
10. Do not depend on ShadowRealm or `credentialless` iframes.
11. Adopt the §5.3 `ModManifest` fields (S12 finalises), including `tier`, `api` range, `compat.world`, enumerated `permissions`, per-asset `sha256` + provenance index, SPDX `license`, `remixOf`, `likeness[]`, `contentRating`, and `multiplayer: false`.
12. Keep mod scripts deterministic: no `Date`, `Math.random`, network or LLM in the sandbox; provide `ctx.rng` and `ctx.time`.
13. Author first-party vehicles, characters and missions as tier-D packs through `packages/mod-sdk` schemas from M03 so the mod format is exercised long before M13.
14. Run the same validator locally (`dv mod check`) and in the Queue consumer; fail on secrets, missing provenance, Rockstar/console formats, unknown permissions, non-`consented` real-person face/voice assets, caps, `multiplayer !== false`.
15. Make `dv mod pack` deterministic (sorted entries, fixed mtimes) so the archive sha256 is the publish key.
16. Pin experiences to a baked world version (`worldVersion`, `modSha256` added to C17); re-validate all overlays on every world rebake.
17. Make BYO agent + `mod-mcp` the primary "mod it with your agent" path; offer ChatGPT plan usage only inside the open-source local `dv mod assist`; apply for SIWC website identity but ship without it.
18. Bind `mod-mcp` and the dev hot-reload socket to 127.0.0.1 with a random token and `Origin` validation; run the dev loop against the locally run game, not the hosted site.
19. Resolve every fal endpoint id from one registry file (`config/genai-endpoints.json`) and run a nightly/CI liveness check against `api.fal.ai/v1/models`; never hard-code ids in code or skills.
20. Implement the sim loop as SK8V/Fiedler: fixed 60 Hz in the physics worker, 0.15–0.25 s catch-up cap, interpolated presentation from the latest completed step, teleport bypass.
21. Implement controller ownership as an explicit state machine with `Waiting`, `Delegated` and forced-exit transitions, family-grouped state IDs, a read-only monitor with settle windows and timeouts, and logged reasons.
22. Require a semantics column for every vehicle-tuning value and a log oracle per tuning change.
23. Record reactive input scripts for racing, pursuit and fighter regressions and compare end-state hashes in CI.
24. Bake ledges/rails and curb classes into chunk metadata in `tools/map`; keep real risers sharp.
25. Version every cross-boundary message (`v` field) and test the schema from both sides.

## Risks

1. **Endpoint and auth drift** (fal ids and MCP auth changed within weeks): mitigated by rec 19; residual risk that a liveness check passes while semantics change.
2. **Script-tier performance on iPhone**: an interpreted sandbox may not meet a per-tick budget; fallback is data-only mods on the mobile tier.
3. **Sandbox escape or abuse** (CPU burn, message floods, UI phishing inside panels): permission broker, rate limits, panel chrome that always shows the mod name, report button (R-IP-03).
4. **COOP/COEP vs cross-origin UI iframe on Safari**: may block UI panels; fallback is host-rendered panels from a declarative UI schema.
5. **SIWC availability**: website identity is trial-gated; plan usage terms may not cover our CLI; BYO-agent remains the floor.
6. **Prompt injection through KB, forum and mod READMEs** read by agents: treat as data; never execute commands from notes; reviewers judge against the contract, not the author's justification.
7. **IP contamination from example repos** (SK8V/universal-modder GTA examples): pattern-only use, banned-format CI check, no copied identifiers or constants.
8. **Likeness via mods** (user-generated faces of real people): pipeline refuses non-`consented` real-person faces/voices; moderation queue; kill-switch covers mod content too.
9. **Remix licence disputes**: allowlist + pinned parent hash + rendered credit chain; DMCA path.
10. **Determinism drift** between Chromium and WebKit breaks replay oracles: gamedesign M01a cross-engine hash test.

## Open questions

- Q-MOD-01: Which identity gates publishing before Thirdweb (M14a): SIWC identity (if the trial is granted), a Supabase OAuth provider, or no user publishing until M14a? Recommendation: Supabase GitHub OAuth for creators in M13c, migrate to the identity interface in M14a.
- Q-MOD-02: Is tier S (script) in v1 scope, or do we ship tier D + UI only at M13 and add scripts after a performance spike? Recommendation: ship D + UI in M13a/b; S behind a flag until the M13a spike passes on the mobile tier.
- Q-MOD-03: Does the operator want the public repository (needed for BYO-agent modding and for SIWC plan usage under the open-source path) to be open source from launch, and under which licence for code vs content?
- Q-MOD-04: Should published experiences be playable on mobile/XR tiers by default or only after a per-tier evidence run?
- Q-MOD-05: Do we accept fal-generated assets in user mods without our proxy (BYO key) as long as provenance lines exist, or require server-side regeneration for published mods?
- Q-MOD-06: Is a skateboard/scooter controller in scope (SK8V-style), or only on-foot and vehicles?
