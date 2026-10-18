# M00c — genai-spike

## Goal
A repeatable, budget-capped CLI spike (`pnpm genai:spike`) that drives one original test character through sheet → mesh → rig on fal.ai, renders one keyframe and three video clips from the `pending` providers, and records what the research could not verify: queue and run latency, file sizes, containers and codecs, C2PA presence, Meshy bone names, image-order behaviour, fal CDN headers, and retrievability with `X-Fal-Store-IO: 0`. Results land in `research/` as metadata only, before M05b and M10a design against them. Spend is capped at $10 (planned ≈ $3.76, asserted ≤ $6; the owner's USD 100 fal cap, DL-OWN-01). Without `FAL_KEY` the spike is skipped with a recorded reason and every offline part (plan, guards, mocked run, verifier) still passes.

## Requirements
- R-ENG-03: the spike runs through a cost ledger with a hard cap, a registry lookup and a cache-free `previs` environment; nothing is generated without an estimate first.
- R-NPC-02: probes the character pipeline stages (sheet, multi-image mesh, auto-rig) before M10a commits to them.
- R-CUT-01, R-CUT-03: compares the default and fallback video providers on our own outputs; informs ADR-GENAI-01 without clearing any provider.
- R-NPC-04, R-IP-02: only an original character (`likeness.tier: original`); no real names or photos are sent, except the optional self-photo refusal probe below.

## Depends on
M00b (`config/genai-endpoints.json`, registry types, banned list); M00a (`check:secrets` and its patterns, used by AC-8). Contracts: C07 1.1 (`EndpointEntry`, `GenJob`/`GateCode` vocabulary from `05-assets.md` §4.5–§4.6).

## Scope in
- `tools/assets/genai-spike.ts` with modes `--plan` (offline), `--run [--only <ids>] [--keep]`, `--verify` (offline); `--out <dir>` (default `research/`) sets where `genai-spike-results.md` and `genai-spike/*.json` are written and read.
- A plan file `tools/assets/spike/plan.json` (steps, endpoint registry keys, params, estimated cost in integer USD micros, the U-item each step answers).
- A thin fal queue client written against `research/genai-pipeline-fal.md` §4.1: `POST https://queue.fal.run/{endpoint_id}` with `Authorization: Key $FAL_KEY` → `{request_id, status_url, response_url}`; poll `status_url` until `COMPLETED` (read `metrics.inference_time`, `error`, `error_type`); `GET response_url`; headers on every submit: `X-Fal-Object-Lifecycle-Preference: {"expiration_duration_seconds": 86400}`; one designated step also sends `X-Fal-Store-IO: 0`. Polling only (no webhook: there is no public receiver yet). Every output is downloaded at once into `.spike/out/` (git-ignored) because fal CDN copies expire.
- Steps (prices are registry list prices, `05-assets.md` §4.5, F-039, F-040, F-044, F-045, F-046; anything not in the ledger uses a conservative estimate):
  - C1 turnaround sheet of `spike_runner` (original, written brief, 4-panel T-pose layout) — `openai/gpt-image-2.5/sunburst/text-to-image`, 2560×1440 high; estimate $0.20 (price not in the ledger).
  - C2 programmatic crops front, left, back, right (local).
  - C3 mesh — `meshy/v7.1/multi-image-to-3d`, `pose_mode: "t-pose"`, `enable_rigging: false`, crops in the order front, left, back, right; $1.20.
  - C4 rig — `fal-ai/meshy/rigging/multi-animation` with five library clips; $0.80.
  - C5 GLB probe (local): bone names and hierarchy, finger/jaw/face bones present, clip names and durations, triangle count, file size → `meshy-bones.json` plus a proposed `aliases` table for `bay_rig_v1` (the rig file itself belongs to the animation milestone).
  - K1 keyframe — `openai/gpt-image-2.5/sunburst/edit` 1920×1080 high from the C2 front crop and an authored stage brief; $0.05.
  - V1 Recipe K — `minimax/h3/image-to-video` (`h3.partner`), 5 s, `prompt_expansion_mode: "disabled"`, fixed seed; $0.30.
  - V3 fallback — `lightricks/ltx-2.5/image-to-video/fast` from K1, 6 s minimum; $0.54.
  - V5 provider clip — `google/gemini-omni-flash/v1.1/reference-to-video`, 5 s 720p; $0.50.
  - A1 TTS line — `fal-ai/minimax/speech-2.8-turbo`, 200 characters, preset designed voice; $0.02.
  - R1 refusal probe (U-AST-8), optional — Sunburst edit and `google/nano-banana-2.1/edit` on the operator's own photo, only if `DV_SPIKE_SELF_PHOTO` points to it and `DV_SPIKE_SELF_CONSENT` points to a signed one-line consent text; otherwise skipped with that reason; $0.15.
- Per call, record: endpoint id, registry key, request id, queue wait and run time, HTTP status, `error_type`, output `content_type`, `file_size`, whether the CDN response carried `Content-Length`, SHA-256 of the bytes, and for media: container, codec, resolution, fps, audio track (via `ffprobe` when installed), C2PA presence (via `c2patool` when installed, else a byte scan for JUMBF/`c2pa` box labels, labelled "heuristic").
- Ledger `research/genai-spike/ledger.json`: estimated micros per step before submit; cumulative; the run stops before any step whose estimate would pass `DV_SPIKE_CAP_MICROS` (default `10000000`).
- Results: `research/genai-spike-results.md` (tables per step and per U-item: answered, partly, unanswered, skipped + reason) and `research/genai-spike/*.json`. Metadata only: no media, no fal CDN URLs, no keys.
- Research scan in `--verify` (DL-257): `ip:strings` allowlists `research/` and `names:lint` does not scan it, so the verifier scans `<out>/genai-spike-results.md` and `<out>/genai-spike/*.json` itself with the M00b string matcher (`packages/shared/src/assets/gates/ip.ts`, `config/ip-denylist.json`) and name rules (`names.ts`, `config/names.json`), with no path allowlist. Research lists no fal CDN host names, so the URL rule is host-independent: any `http://` or `https://` URL in those files fails (results cite endpoint ids, not URLs).
- Monthly `genai:price` (keyed): `GET https://api.fal.ai/v1/models/pricing` [research/genai-pipeline-fal.md §4.2]; reports registry prices that differ by > 5 % (`05-assets-pipeline.md` §9). Response shape not in the ledger: parse defensively; unknown shape → report "unparsed", exit 0.
- U-items this spike answers or records: U-AST-1/U-ENG-7 (bone names, finger/jaw/face, clip licence text), U-AST-2 (image order), U-AST-3 (`Content-Length`, `X-Fal-Store-IO: 0` retrieval), U-AST-4 (C2PA per endpoint), U-AST-7 (extra input cost, from the invoice line if visible), U-AST-8 (refusals, only if R1 runs), U-AST-14 (records the TTS container; the iOS decode test itself is a device check in M01c), U-AST-17 (art-lead minutes, operator-entered), U-S03-1 (identity across K1/V1/V3/V5, human note), U-S03-3 (`seed` and `prompt_expansion_mode` acceptance per endpoint).

## Scope out
- Any production generation, R2 upload, Workflow, webhook receiver, `CutsceneJobDO`, cache keys and the Transcoder → M05b.
- Clearing any provider (`status: cleared`) — owner and counsel, ADR-GENAI-01 gates G1–G5. The spike changes no registry status.
- H3 Max (`h3.max`, Recipe R) and H3 Max Turbo (`h3.maxTurbo`) probes — both `blocked` (F-041: the licence bars using or displaying outputs outside the Applicable Territory, which excludes the USA); no plan step calls them in any env. A probe is a later step after ADR-GENAI-01 moves them off `blocked` (DL-286).
- Roster or real-person content → M10a/M10c. Updating `pinnedUpdatedAt` → a separate reviewed PR after `genai:liveness`.
- Editing `spec/99-open-questions.md`: list the outcomes in the report; the Architect folds them in.

## Deliverables
- `tools/assets/genai-spike.ts`, `tools/assets/lib/fal-queue.ts`, `tools/assets/lib/spike-ledger.ts`, `tools/assets/lib/media-probe.ts` (ffprobe/c2patool wrappers + heuristic scan + GLB probe with `@gltf-transform/core@4.5.1`, F-017), `tools/assets/genai-price.ts`.
- `tools/assets/spike/plan.json`, `tools/assets/spike/briefs.md` (original character and stage briefs; no names of real people, franchises, artists or "in the style of"; passes `ip:strings` and `names:lint`).
- `tools/assets/schemas/spike-results-1.schema.json`.
- `tools/assets/test/spike.test.ts` with recorded fixture responses under `tools/assets/test/fixtures/fal/` (JSON only; media fixtures are tiny generated buffers).
- `research/genai-spike-results.md` and `research/genai-spike/{ledger,results,meshy-bones}.json` (written by the run, or the skip record).
- `config/genai-endpoints.json`: add a `style_bible` entry for `openai/gpt-image-2.5/sunburst/text-to-image` (`status: pending`, price note "not in ledger"); every plan step must resolve to an `endpoints` or `videoProviders` entry.
- `.gitignore` already covers `.spike/` (M00); confirm.
- Root scripts: `genai:spike`, `genai:price`.
- Image crops: a dev-only image library resolved at install (Apache-2.0 or MIT, recorded with version in `spec/03`; must pass `license:scan` as a dev dependency).
- Secrets: `FAL_KEY` (optional; a non-production previs key with an allowed-model list per Q-17; held by the operator or art lead, never committed, never in CI for this milestone). Absent → `--run` makes zero network calls and exits 0; it writes `{status: 'skipped', reason: 'FAL_KEY not set'}` to `<out>/genai-spike/results.json` and the results page only when that `results.json` is absent or already `skipped`; otherwise it prints `SKIP genai:spike: FAL_KEY not set (existing results kept)` and leaves every file untouched, so a keyless re-run never replaces the operator's measurements (DL-257). Optional `DV_SPIKE_SELF_PHOTO`, `DV_SPIKE_SELF_CONSENT`, `DV_SPIKE_CAP_MICROS`. Paid account: fal prepaid credit of $10, the spike's tranche of the USD 100 total (DL-OWN-01); fal has no spend cap and locks below a balance threshold, F-048, so auto-recharge stays off.

## Interfaces
- C07 1.1: reads `config/genai-endpoints.json` through `GenAiRegistry`; gate vocabulary `ENDPOINT_BANNED`, `ENDPOINT_NOT_CLEARED`, `BUDGET`. Spike guards follow `05-assets.md` §4.5 and ADR-GENAI-01 (`assertCallable`): production env refuses anything not `cleared`; `blocked` endpoints are never callable, in any env; `previs` may call `pending` entries; banned ids are never callable.
- No contract change. No player-facing code path; nothing under `apps/` or `services/` changes.

## Acceptance criteria
- AC-1 Given no network and no key When `--plan` runs Then it lists the 11 steps with registry key, status and estimate, a total estimate ≤ $6 and the $10 cap, and exits 0 — proof: `pnpm genai:spike -- --plan`
- AC-2 Given `FAL_KEY` unset When `--run` executes into an empty output dir Then its results file records `skipped` with reason `FAL_KEY not set` and a fetch spy records zero calls; into a dir whose `results.json` holds a completed run, it prints the `existing results kept` line and the files are byte-identical afterwards — proof: `env -u FAL_KEY pnpm genai:spike -- --run --out .spike/dry && pnpm check:unit -- tools/assets`
- AC-3 Given a mocked fal and a ledger at 9,500,000 micros When the next step estimates 1,000,000 Then that step is refused with `BUDGET`, no submit happens, and the run ends with the refusal recorded — proof: `pnpm check:unit -- tools/assets`
- AC-4 Given a banned id in a test plan, and env `production` with a `pending` endpoint When the guards run Then they refuse with `ENDPOINT_BANNED` and `ENDPOINT_NOT_CLEARED`; env `previs` with a `blocked` endpoint is refused with `ENDPOINT_NOT_CLEARED`; env `previs` with a `pending` endpoint is allowed — proof: `pnpm check:unit -- tools/assets`
- AC-5 Given recorded queue fixtures (submit, `IN_QUEUE`, `IN_PROGRESS`, `COMPLETED`, result, one `error_type`) When a mocked run completes Then every submit carried the lifecycle header, the designated step carried `X-Fal-Store-IO: 0`, every results row has the measurement fields, and no file was written under the repo except `research/genai-spike/` and `.spike/` — proof: `pnpm check:unit -- tools/assets`
- AC-6 Given a price fixture 6 % above a registry price When `genai:price` evaluates it Then exactly that endpoint is reported — proof: `pnpm check:unit -- tools/assets`
- AC-7 Given a completed or skipped run When `--verify` runs Then `results.json` validates against the schema, the ledger total is ≤ 10,000,000 micros, and every listed U-item has an outcome or a skip reason — proof: `pnpm genai:spike -- --verify`
- AC-8 Given the written research files When `--verify` scans them itself (no path allowlist) and the secret gate runs Then no key, no `http(s)://` URL and no `ip:strings` or `names:lint` finding is present; unit fixtures holding a denylisted term, a display-side name and an output URL are each reported — proof: `pnpm genai:spike -- --verify && pnpm check:secrets && pnpm check:unit -- tools/assets`
- AC-9 Given a previs `FAL_KEY` and ≥ $10 prepaid credit When the operator runs the spike Then `research/genai-spike-results.md` has a row per step and per U-item and the ledger shows ≤ $10 — proof: manual: operator workstation, `FAL_KEY=… pnpm genai:spike -- --run`, then `pnpm genai:spike -- --verify`

## Test plan
- Unit (`tools/assets/test/spike.test.ts`): plan parsing, guards, ledger cap, mocked queue lifecycle, header assertions, results schema, verifier (including the research scan), keyless run over existing results, price diff. `pnpm check:unit -- tools/assets`.
- Live (operator, once): AC-9. Re-runnable per step with `--only`, so a failed step costs only itself.
- No e2e, no device test.

## Demo script
1. `pnpm genai:spike -- --plan`; read steps and the estimate.
2. `env -u FAL_KEY pnpm genai:spike -- --run --out .spike/dry`; open `.spike/dry/genai-spike-results.md`: "skipped: FAL_KEY not set".
3. With a key: `FAL_KEY=… pnpm genai:spike -- --run --only C1,C3,C4,C5`; inspect `research/genai-spike/meshy-bones.json`.
4. `FAL_KEY=… pnpm genai:spike -- --run --only K1,V1,V3,V5,A1`; open `.spike/out/` clips locally; add the identity note (U-S03-1).
5. `pnpm genai:spike -- --verify`; then delete `.spike/out/` (or keep with `--keep` for M05b fixtures, never committed).

## Effort
1 session (offline parts ≈ 2 h; the live run ≈ 1 h wall clock, mostly queue time); ≈ 14 files; risk medium (vendor behaviour, concurrency limit of 2 on new fal accounts).

## Risks & fallbacks
- Concurrency 2 (`429 concurrent_requests_limit`, `X-Fal-needs-retry: 1`): run steps sequentially; retry after backoff; never parallel.
- A step fails or is refused: record `error_type` and continue with independent steps; dependent steps (C3 after C1) are skipped with the reason.
- `ffprobe` or `c2patool` missing: record "tool absent" and use the heuristic scan; U-AST-4 stays partly answered.
- Video endpoints reject `seed` or `prompt_expansion_mode`: the adapter omits the field and records the rejection (U-S03-3).
- Licence posture: H3 Max and Turbo are `blocked` (F-041: the territory excludes the USA [research/gap-video-model-licence-clearance.md §0 item 3]) and are not in the plan; the guards refuse `blocked` in every env, as ADR-GENAI-01 and research §8 `assertCallable` require, so the H3 comparison rests on `h3.partner` (V1) only until the gate changes their status (DL-286). Outputs of the `pending` providers stay local, are used only for measurement, and are deleted after probing unless `--keep`; they never enter R2, the repo or any build.

## Notes for the Builder
- Read first: `research/genai-pipeline-fal.md` §2.1, §4.1 and Recommendations 15–17; `research/gap-video-model-licence-clearance.md` §6 and rec 13; `05-assets.md` §4.5–§4.7; `05-assets-pipeline.md` §1, §4, §11.
- Never send a real person's name or photo (except R1 under its consent conditions); briefs are original and pass `lintPrompt`-style checks via `ip:strings` and `names:lint`.
- Generation never runs from a browser; this CLI is the staff path (fal ToS §4(b), F-042).
- Integer USD micros everywhere; prices from the registry, never typed into code.
- Branch `m00c-genai-spike`.
