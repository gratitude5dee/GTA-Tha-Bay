# M00b — ip-provenance-gates

## Goal
Before any content lands, CI fails a pull request that ships a file without a provenance record, a format or string from another publisher's games, a copyleft licence in the client bundle, a real person's name, a likeness-rule violation, or the display name typed outside `config/brand.ts`. The C07 provenance types and JSON Schema, the license allowlist, IP denylist, name registry (display side), consent index and the genAI endpoint registry exist as validated config, vendor-terms snapshots are stored and hashed, and a nightly job checks every registry endpoint against fal's public registry without a key.

## Requirements
- R-IP-01: provenance manifest + CI check; denylisted formats and strings; display name only from config; the franchise name never shipped.
- R-IP-02, R-NPC-04: likeness tier rules enforced on records (`likeness:gate`) before any character exists.
- R-ENG-03: the endpoint registry with prices and pins exists before the first paid call (M00c).
- R-MOD-01 (groundwork): the same scanners will run on mod packages (M13a1) because they are pure cores in `@dv/shared`.

## Depends on
M00 (workspace, CI, icons in `apps/web/public/icons/`). M00a is not required; run either first. Contracts: C07 1.1 (`05-assets.md` §4.2, §4.3, §4.5), C13 1.1 (`QualityTierId` for `VariantId`).

## Scope in
- C07 types and the provenance record, copied verbatim; pure gate cores under `packages/shared/src/assets/gates/` (DL-132) so client, Worker and CI run the same code.
- CI gates from `05-assets-pipeline.md` §9 that land in M00b: `provenance:check`, `ip:signatures`, `ip:extensions`, `ip:strings`, `license:scan`, `names:lint` (display side; real side when the CI secret exists), `likeness:gate`, `genai:liveness` (nightly), plus `names:brand` (`research/legal-ip-likeness.md` R-NAME-1/R-NAME-2) and the M00b part of `check:assets`.
- Ship set for M00b: every file under `apps/web/dist` except JS, CSS, HTML, `sw.js`, `manifest.webmanifest`, `_headers` and source maps (code is covered by `license:scan`, not provenance); later milestones add lock-file variants and world packs (05-assets §4.3).
- Scan scope: the git-tracked tree plus `apps/web/dist`. Allowlisted paths for the string denylist only: `spec/`, `research/`, `prompt-pack/`, `docs/research/`, `docs/legal/`, `.claude/`, `config/ip-denylist.json`. Nothing is allowlisted for signatures or extensions.
- Test fixtures never contain real foreign-format bytes or denylisted strings in the repo: tests write them to a temp directory at run time from the rules in config.
- Vendor-terms snapshots for the nine texts in `05-assets-pipeline.md` §9: fal ToS, fal AUP, fal API Services Terms, MiniMax H3 LICENSE and its Q&A, MiniMax Open Platform ToS, Gemini API terms, LTX LICENSE-2_x, ElevenLabs music terms, OpenAI usage policies. Known URLs: `https://fal.ai/legal/terms-of-service`, `https://fal.ai/legal/acceptable-use-policy`, `https://fal.ai/legal/api-services`, `https://huggingface.co/MiniMaxAI/MiniMax-H3/raw/main/LICENSE`, `https://platform.minimax.io/protocol/terms-of-service`, `https://ai.google.dev/gemini-api/terms`, `https://raw.githubusercontent.com/Lightricks/LTX-2/main/LICENSE-2_x`, `https://elevenlabs.io/eleven-music-model-specific-terms`, `https://openai.com/policies/usage-policies/` [research/gap-video-model-licence-clearance.md; research/legal-ip-likeness.md §3.4]. The H3 Q&A has no URL in research: record it as `pending-manual`.
- Clean-room PR template (`research/legal-ip-likeness.md` §2.2).
- First-party licence coverage: a root `REUSE.toml` annotates first-party globs with `LicenseRef-DeeVerse-Owned` (placeholder until the owner picks the repo licence, Q-08) and `LICENSES/LicenseRef-DeeVerse-Owned.txt`.

## Scope out
- `ip:similarity` (separate Zone-R runner owned by S13), `ip:history` (M14b, before the repo goes public), `check:c2pa` (M05b), `genai:terms-watch` weekly diff (M14b), `genai:price` (M00c).
- Catalog, lock file, `resolveVariant`, `assets:publish` → M01d. Soul-file scanning content → M06a2 (the gate already scans `content/**` when it exists).
- Real-side NameRegistry content (CI secret, owner supplies, Q-19/Q-25). Prompt linting of generation requests (`lintPrompt`) → M05b with the pipeline.
- Running ScanCode Toolkit and `reuse lint` as blocking jobs: their versions are not in the ledger, so the in-house checks below are the gate; both tools run in the nightly job when installed and report only.

## Deliverables
- `packages/shared/src/assets/c07.ts`: `05-assets.md` §4.2 verbatim; implement the two pure helpers `assetRefOf` and `objectKey`; other declared functions stay type-only until M01d.
- `packages/shared/src/assets/provenance.ts`: `ProvenanceRecord` (§4.3) verbatim.
- `packages/shared/schemas/provenance-1.0.schema.json`: draft 2020-12, every field of the interface, the seven `allOf` conditionals of §4.3, `additionalProperties: false`.
- `packages/shared/src/genai/registry.ts`: `EndpointEntry`, `GenAiRegistry` (§4.5) and `VideoProviderEntry` (`research/gap-video-model-licence-clearance.md` §8 config sketch); `packages/shared/schemas/genai-endpoints-1.schema.json`.
- `packages/shared/src/assets/gates/`: `provenance.ts` (record validation, licence allowlist, `env`, `previs/`/`mock` references, `placeholder` tags in release mode, `derived_from` cycles and unrooted chains), `ip.ts` (magic bytes RPF7 `37 46 50 52`, RSC7 `52 53 43 37`, GXT2 `32 54 58 47` at offset 0; DXBC `44 58 42 43` anywhere in `.fxc`/`.bin`; WASM `name` section containing `rage::`; zip with `assembly.xml`; RenderWare clump/texdict headers in `.dff`/`.txd`; IMG `VER2`; extension denylist; string matcher), `names.ts` (normalised edit distance, alias match), `likeness.ts` (tier conditionals, consent scopes and `term_end`, face-detector strings `face_detector`, `FaceLandmarker`, `face_landmark`).
- Config: `config/license-allowlist.json` (record licences: `LicenseRef-DeeVerse-Owned`, `CC0-1.0`, `CC-BY-4.0`, `OFL-1.1`, `MIT`, `Apache-2.0`, `ODbL-1.0`, `PDDL-1.0`, `LicenseRef-Vendor-*`; dependency licences: `MIT`, `Apache-2.0`, `ISC`, `BSD-2-Clause`, `BSD-3-Clause`, `0BSD`, `CC0-1.0`, `MPL-2.0` (dev-only)), `config/ip-denylist.json` (the seed list of `research/legal-ip-likeness.md` §2.4 `ip:strings`, the R-NAME-2 regex, the extension list), `config/names.json` (`{schema:'names/1', entries: []}`, display side), `config/consent-index.json` (`{schema:'consent-index/1', entries: []}`), `config/genai-endpoints.json` (initial contents of §4.5 with `checkedAt: "2026-10-18"`: roles, prices, `pinnedUpdatedAt: null` until the first liveness run, `banned` list, `videoProviders` with `h3.partner` `pending`, `h3.maxTurbo` and `h3.max` `blocked`, `ltx25.fast` and `gemini.omniFlash11` `pending`, `defaults.videoFallbackOrder: ["ltx25.fast", "gemini.omniFlash11"]`).
- Provenance records under `assets/provenance/<sha2>/<sha256>.json` for every M00 ship-set file (`icon.svg`: `origin: authored`, `kind: ui`; generated icons: `origin: derived`, `tool: @vite-pwa/assets-generator@2.0.0`, `derived_from` = the SVG hash).
- `tools/ci/`: `provenance-check.ts` (also writes `apps/web/dist/credits.json` from attributions when given `--emit-credits`), `ip-scan.ts` (`--signatures | --extensions | --strings | --all`), `license-scan.ts` (production dependency licences of `@dv/web` from `pnpm licenses list --json --prod`, GPL/AGPL/LGPL → fail without an ADR id in `config/license-allowlist.json` `exceptions`; first-party files covered by `REUSE.toml` or an `SPDX-License-Identifier` line), `names-lint.ts` (includes `names:brand`: the display-name literal is allowed only in `config/brand.ts` across `apps/`, `packages/`, `services/`, `tools/`, `content/`, `config/`; Markdown docs are exempt; the built bundle is checked against the R-NAME-2 regex), `likeness-gate.ts`, `terms-snapshot.ts` (fetch, strip to text, write `docs/legal/vendor-terms/<vendor>-<doc>-<date>.md`, update `index.json` `{url, path, sha256, checked_at, status}`; `--verify` recomputes hashes offline), `test/gates.test.ts`.
- `tools/assets/genai-liveness.ts` (for each registry id, `GET https://api.fal.ai/v1/models?endpoint_id=<id>&expand=openapi-3.0`, no key [research/genai-pipeline-fal.md Method]; reports missing id, `status ≠ active`, `license_type ≠ commercial`, `updated_at ≠ pinnedUpdatedAt`; `--record` writes the responses as fixtures; `--update-pins` is a separate, reviewed PR) and `tools/assets/provenance-new.ts` (creates a record for a file from flags).
- `docs/legal/vendor-terms/index.json` + the snapshot files.
- `.github/pull_request_template.md`; `.github/workflows/ci.yml` job `ip` (after `build`, on the dist artifact): `provenance:check`, `ip:signatures`, `ip:extensions`, `ip:strings`, `license:scan`, `names:lint`, `likeness:gate`, `check:assets`; `.github/workflows/nightly.yml` (cron `17 10 * * *` UTC): `genai:liveness`, `legal:snapshot -- --verify`, optional ScanCode/`reuse lint` report.
- Root scripts: `provenance:check`, `provenance:new`, `ip:signatures`, `ip:extensions`, `ip:strings`, `ip:all`, `license:scan`, `names:lint`, `names:brand`, `likeness:gate`, `genai:liveness`, `legal:snapshot`; aliases `check:provenance`, `check:ip` (= `ip:all`), `check:license`, `check:names`, `check:likeness`; `check:assets` now real (schemas of every `config/*.json` above and of all provenance records; ship-set files ≤ 25 MiB; world packs ≤ 4 MiB once they exist).
- Secrets: optional CI secret `DV_NAMES_REAL_JSON` (real-side NameRegistry, never committed). Absent → `names:lint` prints `real-side: skipped (DV_NAMES_REAL_JSON not set)` and runs display-side rules. No paid account.

## Interfaces
- C07 1.1: `AssetKind`, `AssetRef`, `Origin`, `LikenessTier`, `VoiceMode`, `ProvenanceRecord`, `provenance/1.0` schema, `EndpointEntry`/`GenAiRegistry`. Copied, not changed.
- Gate result shape (internal, not a contract): `{ gate, file, rule, detail }[]`, printed one per line, non-zero exit on any finding, one-line summary last.
- No contract change.

## Acceptance criteria
- AC-1 Given the M00 build When `provenance:check` walks the ship set Then every file joins to a valid, `active`, `production` record with an allowlisted licence and exits 0 — proof: `pnpm build && pnpm provenance:check`
- AC-2 Given temp-dir fixtures (file without record; record with `GPL-3.0-only`; record with `generator.env: 'test'`; a `derived_from` cycle; an `open_data` record without attribution) When the provenance gate runs on each Then each fails with its rule name, and the good fixture passes — proof: `pnpm check:unit -- tools/ci`
- AC-3 Given temp files starting with RPF7, RSC7 and GXT2 magic, a `.bin` containing DXBC, a WASM whose name section contains `rage::`, a zip with `assembly.xml`, and files named `x.rpf` and `y.ytd` When `ip:signatures` and `ip:extensions` run on them Then every file is reported; the repository and `apps/web/dist` produce no finding — proof: `pnpm check:unit -- tools/ci && pnpm ip:signatures && pnpm ip:extensions`
- AC-4 Given a temp source file and a temp `spec/` file that both contain a denylisted term When `ip:strings` runs Then only the source file is reported; the repository and dist are clean — proof: `pnpm check:unit -- tools/ci && pnpm ip:strings`
- AC-5 Given a dependency fixture licensed `AGPL-3.0-only` and a first-party file outside `REUSE.toml` without an SPDX line When `license:scan` runs Then both are reported; the repository passes — proof: `pnpm check:unit -- tools/ci && pnpm license:scan`
- AC-6 Given the display-name literal in a temp `packages/ui/src` file, a display name at normalised distance < 0.4 from a real-side fixture name, and a real-side string in temp content When `names:lint` runs with `DV_NAMES_REAL_JSON` set to the fixture Then all three are reported; without the secret it prints the skip line and the repository passes — proof: `pnpm check:unit -- tools/ci && pnpm names:lint`
- AC-7 Given records with `tier: parody` and `face_reference_used: true`, `tier: consented` without `consent_record_id`, `consented` with an expired `term_end` in a fixture consent index, and a source file containing `FaceLandmarker` When `likeness:gate` runs Then each is reported; the repository passes — proof: `pnpm check:unit -- tools/ci && pnpm likeness:gate`
- AC-8 Given `config/genai-endpoints.json` When `check:assets` validates it Then it passes the schema, `banned` holds `minimax/h3-max/recast`, the face-swap prefix rule, `bytedance/seedance-2.5/image-to-video` and `fal-ai/veo3`, the `voice_clone` role allows only `consented`, and no `videoProviders` entry is `cleared` — proof: `pnpm check:assets`
- AC-9 Given recorded registry responses with one missing id, one `status` not `active`, one `license_type` not `commercial` and one `updated_at` change When `genai:liveness` runs on the fixtures Then exactly those four issues are reported — proof: `pnpm check:unit -- tools/assets`
- AC-10 Given `docs/legal/vendor-terms/index.json` When verified offline Then it has ten entries, each stored file's SHA-256 matches the index, and entries without a fetched file are `pending-manual` — proof: `pnpm legal:snapshot -- --verify`
- AC-11 Given a pull request When CI runs Then the `ip` job runs all eight gates on the built dist and is required for merge — proof: manual: desktop browser, open any PR's Checks tab after the operator marks `ip` as required in branch protection

## Test plan
- Unit: `tools/ci/test/gates.test.ts` (AC-2…AC-7 fixtures, generated in `os.tmpdir()`); `tools/assets` liveness fixtures; `packages/shared` schema tests (12 positive and negative provenance fixtures, per `05-assets.md` §9). `pnpm check:unit -- tools packages/shared`.
- CI: the `ip` job on every PR; nightly liveness.
- No e2e or device tests.

## Demo script
1. `pnpm build && pnpm check:ip && pnpm provenance:check`; all clean.
2. Copy `apps/web/public/icon.svg` to `apps/web/public/icon2.svg`, rebuild, run `pnpm provenance:check`; it fails naming `icon2.svg`. Delete the copy.
3. `pnpm provenance:new -- apps/web/public/icon.svg --origin authored --kind ui --license LicenseRef-DeeVerse-Owned --author studio:dee-verse --dry-run` prints a record.
4. `pnpm genai:liveness`; read the per-endpoint lines.
5. Open a PR with a deliberate display-name literal in a UI file; the `ip` job fails on `names:brand`.

## Effort
1 session; ≈ 30 hand-written files plus the snapshots and records; risk low–medium (vendor pages that render only with JavaScript; `pnpm licenses` JSON shape).

## Risks & fallbacks
- A terms page cannot be fetched or renders only with JavaScript: store `status: pending-manual` with the URL; the operator saves the text by hand later; `--verify` still passes.
- `pnpm licenses list --json` output differs from expectation: parse defensively; if unusable, read `license` fields from `node_modules/.pnpm/*/package.json` for the production closure of `@dv/web`.
- False positives of the string scan on legitimate words: add an exact-match exception with a reason to `config/ip-denylist.json` `exceptions` in a reviewed PR; never widen the path allowlist.
- fal registry unreachable at night: the job reports `unreachable` as an issue, not as a PR failure.

## Notes for the Builder
- Read first: `05-assets.md` §4.2–§4.5, `05-assets-pipeline.md` §9, `research/legal-ip-likeness.md` §1.3 and §2.2–§2.5, `research/gap-video-model-licence-clearance.md` §8.
- Never commit bytes or strings that the gates exist to stop; build them in tests.
- Records use ISO-8601 `Z` timestamps (06 §4.3 exception, DL-059); everything else uses epoch ms.
- Keep gate cores pure (no `fs`, no `Date`) so M13a1 runs them on mod packages in a Worker; CLIs in `tools/ci` do the IO.
- Branch `m00b-ip-provenance-gates`.
