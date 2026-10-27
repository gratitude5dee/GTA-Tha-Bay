# Release records

`docs/releases/<tag>/` holds the files a release run writes about itself. Today that is one file.

## `cutscenes.md`

Which Act 1 refs ship a generated clip and which stay in-engine (a DirectorScript with subtitles, R-CUT-03). `pnpm assets:gen prewarm --report` writes it; do not edit it by hand. It has no timestamps, so a rerun with the same state writes the same bytes.

```sh
# 1. build the release index and its private requests file (writes .private/releases/<tag>/cutscene-requests.json)
pnpm assets:cutscene-index -- --release <tag>

# 2. read the plan and write the report: provider gate, sheet gate, cache check, estimate against the USD 16 line (no spend)
pnpm assets:gen prewarm -- --release <tag> --env prod --report

# 3. offline plan from files only, no network call at all
pnpm assets:gen prewarm -- --release <tag> --offline

# 4. the provenance gate over the shipped clips
pnpm check:c2pa -- --env prod
```

What the report says:

| Line | Meaning |
|---|---|
| `Provider` | The registry provider that was cleared (ADR-GENAI-01), or `none cleared`. With none cleared nothing is estimated and all nine refs are in-engine. |
| `Generated clips` | Refs whose `cutscenes/<key>/manifest.json` exists on the media host when the plan ran. |
| `Plays: in-engine` | Why: `no cleared provider`, `sheet missing: <ids>` (the Lean sheet crops of M10a1 and M10a2 are not approved yet), `pending` (route 27 says a job for the key is in flight), `over line`, `stale endpoint` (rebuild the index), or `planned` (a plan exists but nothing has been generated). |

A run without `--offline` makes HEAD requests to the media host, asks route 27 about every key whose manifest is missing, and reads the programme headroom from the ledger when `SUPABASE_URL` and `SUPABASE_SECRET_KEY` are set (otherwise it prints a `SKIP` line and `headroom: unknown`). `--offline` makes no network call and counts every key as a miss. Without a cleared provider the command prints `blocked: no cleared provider (ADR-GENAI-01)` and exits 0 before any of that.

The CLI never calls fal. On Workers Free (DL-OWN-08) a live clip is made in two halves, and each half has its own command.

## Live run: `--live`, then `--finish` (M05c4)

The Worker has no transcoder on Workers Free and a step may use 10 ms of CPU. So `tha-bay-web` runs only the fal-facing steps (gate, budget, fal queue, copy of the original into `PRIVATE cutscenes-orig/<key>/orig.mp4` as a stream) and then hands the key off: `handoff.json` is written beside the original, the spend is settled in the ledger, and the key is stored as `handed_off` (route 27 answers `pending`). The watchdog, the failed-key re-arm and a quarantine round trip leave that state alone, so no key is paid for twice. Your workstation does the rest.

Prerequisites, all names only:

| Variable | Used by | Without it |
|---|---|---|
| `OPS_TOKEN` | `--live` (route 28) and `--finish` | `SKIP live: OPS_TOKEN not set` / `SKIP finish: ...`, exit 0 |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | the headroom and ledger-delta reads | `SKIP headroom` / `SKIP ledger delta` |
| `R2_PRIVATE_ACCESS_KEY_ID`, `R2_PRIVATE_SECRET_ACCESS_KEY`, `CLOUDFLARE_ACCOUNT_ID` | the hand-off check of `--live` and all of `--finish` (the pair is scoped to `tha-bay-private-{staging,prod}`, never a media key) | `--live` still works but stops polling after 30 minutes; `--finish` prints `SKIP`, exit 0 |
| `C2PA_CERT_CHAIN_PEM`, `C2PA_KEY_PEM` | `--finish` (the re-signer's chain and key, es256 PEM) | `--env prod` refuses with exit 1 before any upload; staging prints `SKIP`, exit 0 |
| `ffmpeg=7:6.1.1-3ubuntu5` (Ubuntu 24.04 apt) or Docker | `--finish` | the runner refuses any other version, or one without `libx264` and `libwebp` |

```sh
# 1. plan, review, then submit exactly the planned keys through route 28 and wait for each to be handed off
pnpm assets:gen prewarm -- --release <tag> --env prod
pnpm assets:gen prewarm -- --release <tag> --env prod --live --report

# 2. on your workstation: download each handed-off original, run the cut@1 ladder (ladder.sh, pinned ffmpeg), qa-gate, re-sign
#    with C2PA, write the subtitles, upload out/<runId>/* then finish.json, call route 28, wait for ready (or refused.json)
pnpm assets:gen prewarm -- --release <tag> --env prod --finish          # add --ffmpeg docker off Ubuntu 24.04

# 3. the second prewarm plans nothing; the provenance gate reads the signatures of what shipped
pnpm assets:gen prewarm -- --release <tag> --env prod
pnpm check:c2pa -- --env prod
```

`--live` posts the planned keys in one call, then polls route 27 until each key is `ready` or `failed`, or has a `handoff.json`. A key with a `handoff.json` is `skip: pending` at $0 in every plan, so a rerun never pays for it again. `--report` adds the ledger delta of the run (`genai_ledger`, vendor `fal`, kind `cutscene`; the ledger is exported nightly, so a delta of 0 right after the run can mean the export has not run).

`--finish` lists the `handoff.json` objects that have no `finish.json` and no ready manifest, then does all local work (download, transcode, qa-gate, re-sign, read the claim back) for every key before it uploads anything. A refusal at that stage leaves the bucket untouched: an unsupported ffmpeg, a signing credential whose claim does not read back with `orig.mp4` as the ingredient and only `signingCredential.untrusted` as validation code (the code a self-made root produces), a qa-gate failure. Uploads go to `PRIVATE cutscenes-orig/<key>/out/<runId>/`; `finish.json` is the last upload of a key, and route 28 is called for that key after it. The Worker's publish phase then re-runs the kill, consent and licence gate, copies the files to `MEDIA cutscenes/<key>/` and writes `manifest.json` last. If the gate refuses (a character was killed, the provider is no longer cleared) nothing reaches MEDIA and `refused.json` carries the gate code; a kill leaves the key `blocked`, any other refusal leaves it `handed_off`. `--finish` never holds a MEDIA key.

Things to know:

- Captions and `a.m4a` are not run off-edge: the manifest has no `audio` block (engine audio, which C09 allows).
- A key that is handed off and never finished stays `handed_off` (route 27 `pending`) and plays its DirectorScript. To redo a key from scratch, reset it through the object (`CutsceneJobDO.reset`) and delete `handoff.json`, or the next job stops at it.
- To finish a key again after a refusal, delete its `finish.json`, fix the cause, and run `--finish`.
- A first live run: read the dashboard metric "Exceeded CPU Time Limits" for `tha-bay-web` and record it in the release report; a step that exceeds 10 ms moves to `--finish`.

## Trying the ladder without R2 or the Worker

```sh
pnpm assets:gen prewarm -- --finish --local services/pipeline/fixtures/cutscene/orig.mp4 --out .genai/work/cut1-fixture
pnpm check:c2pa -- --index .genai/work/cut1-fixture/cutscene-index.json --manifests .genai/work/cut1-fixture --verify-signatures
```

`--local` needs the signing pair in the shell (a test chain is fine) and the pinned ffmpeg. It files the result under the SHA-256 of the original, writes `<out>/<key>/{v768.mp4,v540.mp4,poster.webp,last.webp,manifest.json}` and a one-entry `cutscene-index.json`, and uploads nothing. `check:c2pa --verify-signatures` reads every rendition with the pinned `@contentauth/c2pa-node` and fails on a missing active manifest, a missing `orig.mp4` ingredient or any validation code other than `signingCredential.untrusted`. An explicit `--index` that does not exist or has no entries fails; only the default index keeps its `0 shipped cutscenes` pass.
