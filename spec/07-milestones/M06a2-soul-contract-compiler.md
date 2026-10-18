# M06a2 — soul-contract-compiler

## Goal
NPCs exist as data with a contract. The C10 types and JSON Schemas live in `@dv/shared`, and their validators are generated ahead of time. The pure soul compiler turns a `soul.md` into byte-stable prompt text plus a public JSON. The `tools/soul` CLIs (`npc:schemas`, `npc:lint`, `npc:compile`, `npc:build`, `npc:consent-index`) lint, compile and bundle the roster. These original characters ship: `npc_test` (the kill-drill target), `ro-batista` and `canary-mc` (originals for the M10a canary), two archetype stand-ins, their ink scaffolds and a POI stub. `data/npc-roster`, `data/ink.<id>` and `config/consent-index.json` are produced as C07 assets or config. No real-derived soul enters the public repository (Q-19, Q-25).

## Requirements
- R-NPC-01: every roster NPC is driven by a `soul.md`, validated, compiled and versioned; the roster manifest is the single list the other domains read.
- R-NPC-04: likeness tier, basis, consent scopes, disclaimer and stand-in are schema fields, enforced by lint L3 and L11 and by `likeness:gate`.
- R-IP-02: `config/consent-index.json` is exported for S05's likeness gate; prompt rails never ship publicly (PRIVATE `souls/<id>/<ver>/soul.prompt.txt`).

## Depends on
- **M00b** (ip-provenance-gates): the `names:lint` library, `likeness:gate`, `config/ip-denylist.json`, the provenance records.
- **M01d** (assets-publish): `assets/src/data/<id>/asset.json` sources, `assets:catalog`, `assets:lock`, the C07 catalog.
- Contracts: C10 1.0 (`04-npc-contracts.md` §B1–§B9), C07 1.1 (`AssetRef`, `LikenessTier`, `ProvenanceRecord`), C08 1.0 (`PoiId`, `DistrictId` imported, never redeclared).

## Scope in
- `packages/shared/src/contracts/c10-npc.ts` from §B2 and `c10-npc-builder.ts` from `04-npc-builder.md` §C3, both verbatim with `C10_VERSION = '1.0.0'`. `PoiId`, `DistrictId` and `ChunkKey` are imported from `world/c08.ts`. If M02 has not created that file yet, create the C08 id types file with exactly the C08 1.0 declarations and nothing else.
- Hand-written schemas in `packages/shared/schemas/npc/`: `soul-1.0` (§B4), `npc-roster-1.0`, `npc-turn-1.0`, `npc-intent-1.0`, `npc-summary-1.0`, `dialogue-request-1.0`, `voice-catalog-1.0`, `bark-pool-1.0`. `npc:schemas` generates `soul-1.0.llm.schema.json` (with unsupported keywords stripped and optional fields made required-nullable, `04-npc-builder.md` §C4) and Ajv standalone validators in `packages/shared/src/npc/validators.gen.ts`. It fails on drift.
- Pure functions in `packages/shared/src/npc/`: `parseSoul`, `compileSoul` (deterministic, with no clock, network or LLM; §B3), `scheduleAt`, `renderScene` (the §B7 volatile-message template), `scrubPii`, `splitSentences`, `assetTier` usage. `whereIs` lands in M06c.
- `tools/soul` CLIs:
  - `npc:lint` runs L1–L14 (§B8), schema errors first, over every `content/npcs/*/soul.md` and, when mounted, `content-private/npcs/*/soul.md`.
  - `npc:compile <id>` writes `soul.prompt.txt` and `soul.compiled.json` to `.out/souls/<id>/<ver>/`.
  - `npc:build` checks roster rules R1–R7 (§B5), writes the C07 data asset source for `data/npc-roster` (`NpcRosterBundle`, active souls only) and `data/ink.<id>`, compiles ink with inkjs, writes `souls/index.json`, and uploads the PRIVATE prompt files.
  - `npc:consent-index` writes `config/consent-index.json` from `content-private/consents/*.json` when mounted, otherwise an empty index.
  - `npc:summarize` and `npc:normalize` run against recorded fixtures only.
- L4 token bounds without the model: when `ANTHROPIC_API_KEY` is unset, use a deterministic estimate (upper bound `ceil(utf8Bytes / 3)`, lower bound `floor(utf8Bytes / 5)`). With the key, call `messages.count_tokens` on `claude-haiku-5-5` and cache the result in `content/npcs/<id>/tokens.json`, keyed by the prompt sha256. `CompiledSoul.prompt.tokens` takes the cached count, else the upper estimate. `compileSoul` stays pure: tokens are added by the CLI.
- L7 (the parody claim classifier) applies only to `tier: parody`. Without the key it fails closed (`L7: classifier unavailable`). No parody soul exists in the public repository.
- L2 resolves POIs against S02's table when `packages/world` exports it, else against `content/npcs/poi.stub.json`.
- Content in `content/npcs/`:
  - `npc_test`, `ro-batista` and `canary-mc` (§B5 rows), plus `standin_founder` and `standin_rapper` (originals, `basis: original`). If M05c1 already authored stand-ins or Act 1 cast souls, lint and fix those instead of duplicating them.
  - Each soul has an `.ink` file with `greeting`, `smalltalk`, `busy`, `deflect` and `farewell`.
  - Also: `roster.json`, `poi.stub.json`, `content/prompts/npc/rules@1.example.md` (block A structure, §B7).
- Config: `config/npc-goals.json` (closed goal catalog), `config/voice-catalog.json` (`text` and the Workers AI `t1` entries of §5.7 with `allowedTiers`; M06a4 extends it), `config/npc.json` (routing and caps skeleton, with its JSON Schema).

## Scope out
- Dialogue service, prompt assembly and model routing: M06a3. Memory, TTS and evals: M06a4. Brains, `whereIs` and barks: M06c.
- Real-derived souls, research normalization against the real layer, and the production block A: M10c, once Q-19 and Q-25 are answered. The consent index from the DB (`consent_record`): M10c.
- Character 3D assets: M10a1. Until then active souls set `assetsPending: true`, and `npc:build --release` refuses them (L10).

## Deliverables
- `packages/shared/src/contracts/{c10-npc.ts, c10-npc-builder.ts}`, `packages/shared/src/npc/{index.ts, parse.ts, compile.ts, schedule.ts, scene.ts, pii.ts, sentences.ts, validators.gen.ts}`, `packages/shared/schemas/npc/*.schema.json` (9 files).
- `packages/shared/test/npc/{schema.spec.ts, compile.spec.ts, schedule.spec.ts, scene.spec.ts, pii.spec.ts, sentences.spec.ts}`, `packages/shared/test/npc/fixtures/{good/, bad/L1…L14/}`, `packages/shared/test/npc/golden/scene.v1.txt`.
- `tools/soul/src/{cli.ts, lint.ts, compile.ts, build.ts, schemas.ts, consent-index.ts, tokens.ts, summarize.ts, normalize.ts}`, `tools/soul/test/{lint.spec.ts, build.spec.ts}`.
- `content/npcs/{npc_test,ro-batista,canary-mc,standin_founder,standin_rapper}/{soul.md,<id>.ink}`, `content/npcs/{roster.json, poi.stub.json}`, `content/prompts/npc/rules@1.example.md`.
- `config/{npc-goals.json, voice-catalog.json, npc.json, consent-index.json}`, `tools/ci/schemas/npc-config.v1.json`.
- `assets/src/data/npc-roster/asset.json`, `assets/src/data/ink.<id>/asset.json` and their provenance records (origin `authored`).
- Root scripts: **`npc:schemas`**, **`npc:lint`**, **`npc:compile`**, **`npc:build`**, **`npc:consent-index`**, **`npc:summarize`**, **`npc:normalize`**. Add `pnpm npc:lint` and `pnpm npc:schemas -- --check` to the `ci.yml` `content` job.
- Dependency `inkjs` (MIT [research/ai-npc-runtime.md Verified facts]; version as resolved, recorded in `spec/03`).
- About 38 hand-written files (fixtures counted by directory).

## Interfaces
- C10 1.0 created verbatim. Never edit a shape. If an import path breaks (for example C07 or C08 file names), fix the import and report it.
- C07 1.1: `data/npc-roster` and `data/ink.<id>` are `data`-kind assets with provenance; `char:<id>` tags.
- C08 1.0: id types imported.

## Acceptance criteria
- AC-1 Given the 14 bad-fixture directories When `npc:lint` runs on each Then each fails with exactly its rule id (schema errors reported first), and the five shipped souls pass — proof: `pnpm npc:lint && pnpm check:unit -- tools/soul`
- AC-2 Given each shipped soul When `compileSoul` runs twice in one process and once in a fresh process Then the three `soul.prompt.txt` sha256 values are identical; changing one byte of `## Voice` changes the hash, and L14 then demands a higher `soulVersion` — proof: `pnpm check:unit -- packages/shared/test/npc`
- AC-3 Given the schemas When `npc:schemas -- --check` runs Then the generated validators and the LLM schema have no diff, the LLM schema contains no numeric, length or `format` keyword, and it has ≤ 24 optional and ≤ 16 union-typed parameters — proof: `pnpm npc:schemas -- --check && pnpm check:unit -- packages/shared/test/npc`
- AC-4 Given a schedule that wraps midnight on Sunday When `scheduleAt` is evaluated at t = 0, at the last half-second of Sunday and at 7,200 × 24 × 7 Then it returns the expected blocks, and the weekday it uses equals `floor(t / 172800) % 7` (0 = Monday) — proof: `pnpm check:unit -- packages/shared/test/npc`
- AC-5 Given a fixed `NPCDialogueContext`, memory and turn When `renderScene` runs Then its bytes equal `golden/scene.v1.txt`, the player text is NFC-normalized with control and tag characters stripped, and `scrubPii` removes the e-mail, phone and street-address fixtures — proof: `pnpm check:unit -- packages/shared/test/npc`
- AC-6 Given the roster with a duplicate id, a `tier` mismatch with its soul, 9 Sonnet entries, and 9 `standard` pipelines When `npc:build` validates it Then R1, R2, R4 and R7 fail in turn; the shipped roster passes and emits an `NpcRosterBundle` without any `rails`, `visual_brief` or prompt text — proof: `pnpm check:unit -- tools/soul`
- AC-7 Given the shipped souls When `npc:build -- --out .out` runs offline Then `data/npc-roster` and `data/ink.<id>` validate against their schemas, every ink defines the five required knots, `souls/index.json` lists each active version, and PRIVATE uploads print `SKIP … R2_ACCESS_KEY_ID not set` — proof: `pnpm npc:build -- --out .out`
- AC-8 Given the new data assets and provenance records When the IP gates run Then provenance joins, no real name or alias appears, and the likeness gate passes with the exported consent index — proof: `pnpm provenance:check && pnpm names:lint && pnpm likeness:gate`
- AC-9 Given an active soul with `assetsPending: true` When `npc:build -- --release` runs Then it fails with L10 naming that soul — proof: `pnpm check:unit -- tools/soul`
- AC-10 Given the branch When CI and the preview deploy run Then unit, content and IP jobs pass, and the deployed app is unchanged for players — proof: `pnpm check:unit && pnpm deploy:preview`

## Test plan
- **Unit:** `shared/npc.schema`, `shared/npc.compile`, `shared/npc.schedule`, `shared/npc.scene` (golden), `shared/npc.pii`, `shared/npc.sentences` — `pnpm check:unit -- packages/shared/test/npc`; `soul/lint` (L1–L14 fixtures), `soul/build` (R1–R7) — `pnpm check:unit -- tools/soul`.
- **Static gates:** `pnpm npc:lint`, `pnpm npc:schemas -- --check`, `pnpm provenance:check`, `pnpm names:lint`, `pnpm likeness:gate`, `pnpm check:assets`.
- **Determinism lint:** `packages/shared/src/npc/**` is inside the C02 lint scope (no `Date`, no `Intl`); `pnpm lint`.

## Demo script
1. `pnpm npc:lint`: five souls pass. Point it at `bad/L1`: the overlap is reported.
2. `pnpm npc:compile -- npc_test`; open `.out/souls/npc_test/1/soul.prompt.txt`, then run it again: same sha256.
3. `pnpm npc:build -- --out .out`; inspect `data/npc-roster`: no rails or prompts.
4. `pnpm likeness:gate`.

## Effort
1 Builder session; about 38 files; risk **low** (pure code and data; the volume of schema work is the main time sink).

## Risks & fallbacks
- **Ajv standalone output trips the C02 lint** (`Date`, regex flags): emit validators with the format checks the lint allows, or move the generated file outside the lint scope with an ESLint override limited to `validators.gen.ts`, and log a Builder decision.
- **Token-count cost and limits are UNVERIFIED (U-NPC-12):** counting happens once per prompt sha256 and is cached. The offline estimate keeps CI keyless.
- **inkjs compiler size or API:** compile at build time only. The runtime loads compiled JSON (M06a3).
- **Name collisions with real people:** every invented name passes `names:lint` (display side). Pick another name rather than suppressing a hit.

## Notes for the Builder
- Read first: `04-npc-contracts.md` §B1–§B9 (all of it); `04-npc.md` §3 and §5.5; `04-npc-builder.md` §C4 (LLM schema rules); `05-assets.md` §5.4 (likeness gate rules).
- Original content only. Never base a soul on a real person, and never copy research text. The real roster waits for Q-19 and Q-25 (`content-private/`).
- Secrets: none required. `ANTHROPIC_API_KEY` is optional (exact token counts) and `R2_ACCESS_KEY_ID` with `R2_SECRET_ACCESS_KEY` is optional (PRIVATE upload). Each absent one prints `SKIP … <VAR> not set`.
- `packages/shared` does no IO: file reading, inkjs and network calls live in `tools/soul`.
- Branch `m06a2-soul-contract-compiler`.
