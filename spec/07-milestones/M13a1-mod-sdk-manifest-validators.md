# M13a1 — mod-sdk-manifest-validators

## Goal
A mod becomes a well-defined, checkable artifact. When this milestone is done the repository has:
- the C14 and C17 contract files and their JSON Schemas;
- one pure validator in `@dv/shared` that gives the same verdict in Node, in the browser and in a Worker;
- a deterministic archive packer whose SHA-256 is the publish key;
- a per-tier `ModBudgetReport`;
- the first `@dv/mod-sdk` package (types, `defineMod`, the QuickJS environment `.d.ts`, the ModAPI contract document);
- the `dv` CLI (`@dv/cli`) with `dv mod check` and `dv mod pack`.

Nothing installs or runs a mod yet; M13a2 and M13a3 consume this.

## Requirements
- R-MOD-01: the typed, versioned mod API and the validator are the base of the agent-friendly SDK.
- R-IP-01: every mod asset carries a C07 provenance record; foreign game formats, secrets and non-original likeness fail closed through S05's gate cores.

## Depends on
- **M04a2** (C05 `SaveRecord`/`SlotId` with `mod:<ModId>`, exported `JsonValue` per DL-194; C06 1.1 types used by `ModAPI`). **M01d** (C07 `AssetKind`, `AssetRef`, `ProvenanceRecord` schema `provenance-1.0`, catalog types). **M00e** (ordering only: this milestone adds `services/edge/test/mod-check-parity.test.ts`, so it waits for M00e, `_PLAN.md` §0 rule 7, DL-622). M00b's pure gate cores in `packages/shared/src/assets/gates/` (provenance, IP signatures, extensions, strings, licence allowlist) are reused, not copied.
- Contracts: C14 1.0 (`C14_VERSION` 1.0.0, `MODAPI_VERSION` 1.0.0, manifest `dv-mod/1`), C17 1.0, C07 1.1, C05 1.1, C13 1.1 (`QualityTierId`).

## Scope in
- **Contract files, verbatim:**
  - `packages/shared/src/contracts/{c14-mod.ts, c14-modapi.ts, c14-protocol.ts, c17-experience.ts}` from `12-modding-contracts.md` B§1, B§3, B§5 (protocol, session, load and install-record types), B§6;
  - `c14-modapi.ts` imports `JsonValue` from `./c05-save` and re-exports it (DL-194);
  - `packages/shared/src/api/mods.ts` from B§7 (route DTOs, `ModCheckCode`, `ModErrorCode`, `ModFinding`, `ModCheckResult`).
- **Schemas** in `packages/shared/schemas/mod/`:
  - `manifest.v1.schema.json` (B§2 verbatim; `$ref` `provenance-1.0`);
  - `scene.v1.schema.json` (`dv-scene/1`, ≤ 512 ops), `experience.v1.schema.json` (`dv-exp/1`), `panel.v1.schema.json` (`dv-panel/1`, ≤ 40 nodes, depth ≤ 3) from B§4;
  - `experience-descriptor.v1.schema.json` from C17 (DL-199; the TypeScript wins on any difference);
  - `mod-limits.schema.json`.
  - Validators are compiled at build to standalone modules (`packages/shared/scripts/build-mod-validators.ts`, Ajv standalone code generation as a devDependency). The generated files are committed under `packages/shared/src/mod/generated/`, so no Ajv code runs at run time in a Worker (U7 avoided).
- **`config/mod-limits.json`:** B§7 with one tier row per C13 tier, using the values of `12-modding.md` §5.4.
- **Shared validator** (`packages/shared/src/mod/check/`, pure, Worker-safe). It runs these stages in order and returns `ModCheckResult`:
  1. envelope: zip-bomb ratio, entries, uncompressed bytes, paths (NFC, no `..`, no leading `/`, ≤ 120 chars), nested archives;
  2. type: magic bytes and banned formats through `assets/gates/ip.ts`;
  3. allowlist: every archive file is listed or named;
  4. schema;
  5. permissions: closed enum, the min-tier matrix of B§1, and a static scan of `entry` for `ctx.<namespace>`;
  6. assets: SHA-256 per entry, `provenance.sha256 === sha256`, `ModAssetKind` only, likeness `original` only for character-family assets;
  7. provenance through `assets/gates/provenance.ts` and the licence allowlist;
  8. secrets: pattern list moved from `tools/ci/check-secrets.ts` into `packages/shared/src/assets/gates/secrets.ts`, with that tool re-pointed;
  9. IP strings through `assets/gates/ip.ts`;
  10. caps from `config/mod-limits.json`;
  11. script lint: size ≤ 256 KiB; banned identifiers `fetch`, `Date`, `Math.random`, `performance`, `SharedArrayBuffer`, `Atomics`, `WebAssembly`, `eval`, `Function`;
  12. `compat.api` as a semver range satisfied by `MODAPI_VERSION`.
- Server-only stages (classifiers, hash banks, real-name lint, anchors) are M13c2.
- **Archive** (`packages/shared/src/mod/{archive,pack}.ts`, pinned `fflate`):
  - unzip with streaming limits;
  - deterministic pack: entries sorted by byte order of the NFC path; DOS timestamp 1980-01-01 00:00; `STORE` for `png`, `webp`, `ktx2`, `ogg`, `opus`, `glb`; deflate level 9 for text;
  - `manifest.json` is written last from the source manifest;
  - `packMod(files) → {bytes, sha256}`.
- **`ModBudgetReport`** (`packages/shared/src/mod/budget.ts`):
  - triangles from glTF/GLB accessor counts (JSON chunk only);
  - texture GPU bytes from the KTX2 header levels, or width × height × 4 × 4/3 for PNG/WebP thumbnails;
  - entities and scene ops from `dv-scene/1`;
  - render objects = distinct mod assets + 1;
  - script and UI bytes;
  - `tiersOk` = every C13 tier whose row in `config/mod-limits.json` holds all numbers.
- **`@dv/mod-sdk`** (`packages/mod-sdk`): `package.json` (MIT `license` field, `private: true` until Q-22), `src/index.ts` (`defineMod` and type re-exports from `@dv/shared` contracts), `src/quickjs-env.d.ts` (the globals a script sees: `ctx` only, no DOM), `docs/CONTRACT-modapi.md` (namespaces, limits, events, versioning rules of C§7), `README.md`.
- **`@dv/cli`** (`tools/cli`, binary `dv`):
  - one module per group, and each module's docstring is its `--help`;
  - `dv mod check [dir] [--json]` and `dv mod pack [dir] [--out f] [--json]` work on the creator workspace layout of C§1.1 (`mod/mod.json` source manifest without `assets[]`);
  - pack joins `mod/assets/**` with `mod/provenance/<sha256>.json`, defaults `compat.api` to `^<MODAPI_VERSION>`, validates, then writes the archive;
  - errors are JSON `{code, file?, line?, fix}`; exit 0 when clean, 1 on errors, 2 on usage errors.
- A Worker harness: `services/edge/test/mod-check-parity.test.ts` runs the same corpus inside the Workers runtime.

## Scope out
- Install, registry, OPFS, route 35 and 53: M13a2. Loader, `ModHost`, scene-op execution: M13a3.
- QuickJS runtime: M13a4. UI tier host: M13a5. Workspace templates, examples, mock host, `dv init|new|test|dev|kb|mcp|provenance`: M13a6.
- Server scan stages, publish: M13c2. `dv login`, `dv mod publish`: M13c3. Vehicle envelope hook: M13a7.
- npm publication of `@dv/mod-sdk` and `@dv/cli`: Q-22 (M13a6/M13c3 publish step).

## Deliverables
- `packages/shared/src/contracts/{c14-mod.ts, c14-modapi.ts, c14-protocol.ts, c17-experience.ts}`; `packages/shared/src/api/mods.ts`; exports in `packages/shared/src/contracts/index.ts`.
- `packages/shared/schemas/mod/{manifest.v1, scene.v1, experience.v1, panel.v1, experience-descriptor.v1, mod-limits}.schema.json`.
- `packages/shared/scripts/build-mod-validators.ts`, the package script `mod:validators` (`pnpm --filter @dv/shared mod:validators`) and the generated `packages/shared/src/mod/generated/*` (generated files do not count toward the file budget).
- `packages/shared/src/mod/{limits.ts, archive.ts, pack.ts, budget.ts, semver.ts, index.ts}`.
- `packages/shared/src/mod/check/{index.ts, envelope.ts, allowlist.ts, schema.ts, permissions.ts, assets.ts, secrets-scan.ts, caps.ts, script-lint.ts}`.
- `packages/shared/src/assets/gates/secrets.ts`, with `tools/ci/check-secrets.ts` re-pointed to it.
- `config/mod-limits.json`.
- Tests:
  - `packages/shared/src/mod/test/{pack-deterministic.spec.ts, check-parity.spec.ts, manifest-schema.spec.ts, permission-tier-matrix.spec.ts, budget.spec.ts, generated-drift.spec.ts}`;
  - `packages/shared/src/mod/test/corpus/{build-corpus.ts, verdicts.json}` (40 cases built in memory from one valid base by named mutations; no archive is committed);
  - `services/edge/test/mod-check-parity.test.ts`.
- `packages/mod-sdk/{package.json, tsconfig.json, README.md, src/index.ts, src/quickjs-env.d.ts, docs/CONTRACT-modapi.md}`.
- `tools/cli/{package.json, tsconfig.json, src/index.ts, src/mod/check.ts, src/mod/pack.ts, src/io.ts, test/cli.spec.ts}` and a small workspace fixture `tools/cli/test/fixtures/valid-experience/` (`mod/mod.json`, `mod/data/experience.json`, `mod/data/scene.json`, one PNG thumbnail with its provenance record). The root `package.json` adds `@dv/cli: workspace:*` as a devDependency so `pnpm exec dv` resolves.
- Root: `pnpm typecheck` gains the two new tsconfigs. Versions of `fflate` and `ajv` are not in the ledger: take what pnpm resolves, pin them exactly, record them in `spec/03`.

## Interfaces
- C14 1.0 and C17 1.0 shapes copied verbatim; `C14_VERSION`, `MODAPI_VERSION`, `C17_VERSION` exported. C07 1.1 provenance and gate cores consumed. C05 1.1 `JsonValue` imported.
- Vehicle-envelope findings are reported in M13a7 with the existing code `schema.invalid` (no new `ModCheckCode`).
- No contract change.

## Acceptance criteria
- AC-1 Given a workspace fixture When `dv mod pack` runs twice, once after touching every file's mtime and creating the files in reverse order Then both archives have the same SHA-256, entries are byte-sorted, every DOS timestamp is 1980-01-01 and `png`/`ktx2` entries are stored, not deflated — proof: `pnpm check:unit -- packages/shared/src/mod/test/pack-deterministic`
- AC-2 Given the 40-case corpus (valid bases for each kind and tier; unknown permission; permission below its min tier; missing provenance; licence outside the allowlist; a `.rpf` entry; an RPF7 magic header under a `.png` name; a `sk-ant-` secret in a JSON file; `../` path; nested zip; ratio above 100; 513 scene ops; 257 assets; `voice` asset kind; a character asset with likeness `parody`; unlisted file; asset hash mismatch; `compat.api` `^2.0.0`; script calling `Math.random`) When the validator runs in Node Then each verdict and finding code equals `verdicts.json` — proof: `pnpm check:unit -- packages/shared/src/mod/test/check-parity`
- AC-3 Given the same corpus When the validator runs inside the Workers runtime Then every verdict equals `verdicts.json`, so Node and Worker agree — proof: `pnpm check:workers -- mod-check-parity`
- AC-4 Given the 17 permissions and 3 tiers When the matrix test runs Then exactly the B§1 min-tier cells pass and the rest yield `perm.tier`; an unknown value yields `perm.unknown`; a script referencing `ctx.props` without `world.props` yields `perm.missing`; a granted but unused permission yields a `warn` — proof: `pnpm check:unit -- packages/shared/src/mod/test/permission-tier-matrix`
- AC-5 Given the B§2 schema, the B§4 schemas and the C17 descriptor schema When the valid fixtures of each type and ten invalid manifests (missing `declarations`, `multiplayer: true`, tier `data` with `entry`, kind `rules` with tier `data`, `id` with upper case, …) are validated Then the valid ones pass, each invalid one yields `schema.invalid`, and the TypeScript fixtures type-check against the contract types — proof: `pnpm check:unit -- packages/shared/src/mod/test/manifest-schema && pnpm typecheck`
- AC-6 Given a fixture mod with one GLB of 70,000 triangles and one 1024² KTX2 texture When the budget is computed Then the report holds 70,000 triangles and the texture's level bytes, and `tiersOk` excludes `mobile-low` and `xr-quest` (row limits 50 k and 60 k) — proof: `pnpm check:unit -- packages/shared/src/mod/test/budget`
- AC-7 Given the committed generated validators When `build-mod-validators.ts` runs in the test Then its output is byte-identical to the committed files — proof: `pnpm check:unit -- packages/shared/src/mod/test/generated-drift`
- AC-8 Given an invalid workspace When `dv mod check --json` runs Then it exits 1 and prints one JSON object per finding with `code`, `file` and a non-empty `fix`; on the valid workspace it exits 0; `dv --help` and `dv mod --help` exit 0 — proof: `pnpm check:unit -- tools/cli`
- AC-9 Given the new code When lint runs Then `packages/shared/src/mod/**` passes the C02 determinism bans and imports no IO module, and `check:secrets` still passes on the tree after its patterns moved to the shared core — proof: `pnpm lint && pnpm check:secrets`
- AC-10 Given the changed edge test tree and shared package When the app is built and checked Then the production bundle has no `/_test/` route and no secret pattern — proof: `pnpm build && pnpm check:prod-routes && pnpm check:secrets -- apps/web/dist`

## Test plan
- **Unit:** the six `packages/shared/src/mod/test/*` specs (`pack-deterministic`, `check-parity`, `manifest-schema`, `permission-tier-matrix`, `budget`, `generated-drift`) and `tools/cli/test/cli.spec.ts`. Command: `pnpm check:unit -- packages/shared/src/mod` and `pnpm check:unit -- tools/cli`.
- **Workers runtime:** `mod-check-parity`.
- **Static:** lint (determinism bans), typecheck, `check:secrets`.
- No e2e and no device test.

## Demo script
1. `pnpm check:unit -- packages/shared/src/mod`; green.
2. `pnpm exec dv mod check tools/cli/test/fixtures/valid-experience --json`; exit 0, budget printed.
3. Edit the fixture's `mod.json` to add permission `world.teleport`; re-run; read `perm.unknown` with its fix.
4. `pnpm exec dv mod pack … --out /tmp/a.zip` twice; compare SHA-256.

## Effort
1 session; ≈ 38 hand-written files (generated validators excluded). Risk low: the code is pure; the shapes are frozen.

## Risks & fallbacks
- Ajv standalone output is not stable across runs (key order): sort the schema keys before compiling and fix the Ajv options. If it is still unstable, drop the drift test and generate at build (keep the corpus parity tests), and log a Builder decision.
- `fflate` deflate output differs between Node and the Worker build: the parity tests catch it. Fall back to `STORE` for every entry (larger archives, same determinism) and record the choice.
- A gate core in `packages/shared/src/assets/gates/` turns out not to be Worker-safe (it uses `node:` modules): split the pure part out without changing `tools/ci` behaviour (`pnpm provenance:check` and `pnpm ip:all` must stay green).
- File budget: merge the small check stages into `check/index.ts` before dropping any test.

## Notes for the Builder
- Read first: `12-modding-contracts.md` B§1–B§4, B§6, B§7; `12-modding.md` §2.1 (principles 4, 5, 8, 9), §2.3, §5.4; `12-modding-publish.md` C§1.1, C§1.4, C§7; `05-assets-pipeline.md` (gate cores bullet); `spec/11-decision-log-2.md` DL-194, DL-199.
- Copy contract text exactly. A defect found in a shape goes into the report as a proposal; never edit the shape.
- `@dv/shared` imports nothing else and does no IO. The CLI and tests do the file IO.
- Do not name the franchise in fixtures or strings: the corpus refers to banned formats by their magic bytes and extension only.
- Order: contracts → schemas and generator → validator stages with the corpus → pack and budget → SDK → CLI → Worker parity.
- Branch `m13a1-mod-sdk-manifest-validators`.
