# gap-ci-cd-release-assets: CI/CD, release engineering, asset publishing and headless GPU/XR testing

Dimension owner: S00 (gap fill). Checked 2026-10-18. Feeds S13 (CI jobs, device matrix, `spec/08-test-and-ci.md`), S11 (WebGPU/WebGL2/XR test hooks), S09 (Workers/DO deploys, Supabase migrations, auth config), S05 (R2 asset publishing). Serves R-ENG-01 (deterministic scripts, no GUI-only steps), R-ENG-02 (budgets as automated checks), R-PLAT-01/02/03, and the M00 exit gate "CI green + deploy:preview with COOP/COEP".

This report does not repeat facts that other reports already hold. These are cross-referenced instead:
- R2 pricing and limits, presigned URLs, `_headers` rules, compression and Range: stack-cloudflare-backend §1.2 and §1.4.
- Static-asset limits (25 MiB per file, 20k/100k files) and tool pins (wrangler 4.151.1, Vite 8.3.4, Playwright 1.64.1, KTX 4.4.2, gltf-transform 4.5.1): taken as given.
- Browser and device support matrix: stack-rendering-platform §2.
- IP, provenance and licence CI gates: legal-ip-likeness §2.4.
- Skills and knowledge-base checks: repos-modding §6.

---

## 0. Headline findings

1. **Use Workers Previews for per-PR previews, not Version URLs.** Cloudflare shipped Workers Previews in September 2026 (`wrangler preview`; open beta in wrangler 4.151.1). Each Preview has its own vars, secrets and bindings, and gets a new Durable Object namespace automatically. Each Preview has two URLs: a stable `<preview>-<worker>.<sub>.workers.dev` and an immutable per-deployment URL. Cloudflare now says Version URLs (`versions upload --preview-alias`) use production resources and should not be used for PR testing. `cloudflare/wrangler-action@v4.1.3` exposes `preview-url` and related outputs, and needs wrangler ≥ 4.136.3. Limits: 100 Previews per Worker (Free) or 500 (Paid), and 100 deployments per Preview. Inside a Preview, Queue consumers, Cron Triggers and production routes do not run, Workflow bindings point at an existing Workflow, and service bindings call production.
2. **Cloudflare has no OIDC for CI.** No GitHub OIDC/workload-identity federation is documented. CI uses an account-owned API token (`cfat_…` scannable format, leak-revoked through GitHub secret scanning) with a TTL, plus the account ID. Minimum Workers role for `versions upload`, `versions deploy`, `rollback` and `secret put` is `Editor` on that Worker. Creating a Worker requires product-level `Admin`. Changing routes or custom domains also needs Zone › Workers Routes › Write.
3. **Gradual deployments are fully scriptable without prompts.** `wrangler versions upload --tag --message [--secrets-file]` creates a version; its ND-JSON output (`WRANGLER_OUTPUT_FILE_PATH`) carries `version_id`. Then run `wrangler versions deploy <new>@0% <old>@100% -y` and smoke-test the new version with the `Cloudflare-Workers-Version-Overrides` header before moving through 10, 50 and 100%. `wrangler rollback <id> --message` rolls back. Limits: two versions per deployment, deploys and rollbacks only within the last 100 versions. **Durable Object class lifecycle changes (new/rename/delete/transfer) cannot go through `versions upload`.** They must use `wrangler deploy`, and rollback can never cross them. Static assets need version affinity (`Cloudflare-Workers-Version-Key` set by a Transform Rule), or hashed JS returns 404 during a split.
4. **Secrets and versions interact.** `wrangler secret put|bulk` creates a new version and deploys it immediately. The wrangler-action `secrets:` input calls `wrangler secret bulk`. In a gradual pipeline, use `versions upload --secrets-file` or `versions secret put|bulk` instead. Declaring `secrets.required` in the Wrangler config makes `deploy` and `versions upload` fail when a required secret is missing.
5. **R2 bulk publishing goes through the S3 API (rclone), not wrangler.** `wrangler r2 object put` and the hidden, experimental `r2 object bulk put` use the Cloudflare REST API. That API is rate-limited to 1,200 requests per 5 minutes per account and capped at 300 MiB per object in wrangler. rclone 1.75.2 (`provider = Cloudflare`, `no_check_bucket = true`) can set per-extension `--header-upload "Content-Type: …"` and `"Cache-Control: …"`, use `--ignore-existing --fast-list` for content-hashed keys, and run 32 transfers in parallel. Multipart starts above 200 MiB (rclone default) or 8 MB (aws-cli default), so ≤ 4 MB world packs are single PUTs. Default CDN caching skips `.glb`, `.ktx2`, `.json` and custom `.pack`, so `media.<domain>` needs a Cache Rule. Purge works on every plan: by URL, prefix, tag, host or everything. Free plan limits are 800 URLs/s for single-file purge and 5 req/min (bucket 25) for prefix, tag or host purge, with ≤ 100 operations per request. KV is eventually consistent (≥ 60 s), so it cannot switch a manifest atomically.
6. **Headless WebGPU works on a GPU-less Ubuntu 24.04 x64 box (measured).** Playwright 1.64.1 bundles Chromium 156.0.8078.4. With no flags, `navigator.gpu` exists but `requestAdapter()` returns `null`, and three r186 `WebGPURenderer` falls back to WebGL2 on its own. That is a free WebGL2-fallback test. With `--enable-unsafe-webgpu --enable-features=Vulkan --use-angle=swiftshader --use-vulkan=swiftshader`, a SwiftShader fallback adapter appears (`isFallbackAdapter: true`, 21 features, `maxTextureDimension2D` 8192), compute and canvas rendering work, and Playwright screenshots show the frame. With `--enable-unsafe-webgpu` alone, the adapter appears but canvas presentation fails ("A valid external Instance reference no longer exists"). **Playwright WebKit 27.2 on Linux has no `navigator.gpu` and no `navigator.xr`.** It does render WebGL2, and `crossOriginIsolated` is true under COOP/COEP. All of this was measured in a container with the same OS and spec as a public-repo `ubuntu-latest` runner, not on a GitHub runner.
7. **WebXR can be emulated in CI with IWER 2.6.0 (MIT, 2026-10-13), and it works with three r186 (measured).** An `immersive-vr` session with `metaQuest3` started and rendered 10 XR frames in Chromium (with and without SwiftShader) and in WebKit, through the WebGL path. Two rules: on Chromium, call `installRuntime({ forceInstall: true })`, because Chromium already exposes a native `navigator.xr`; and install IWER **before** the renderer is constructed. Otherwise three throws `createProjectionLayer is not a function`. IWER has no `XRGPUBinding`, so XR CI only covers three's `setupWebGLXRFallback` path. Native WebGPU XR stays a manual device check.
8. **GitHub-hosted GPU options are thin and plan-gated.** Standard runners have no GPU. GPU larger runners (4 vCPU, Tesla T4 16 GB) cost $0.052/min on Linux and $0.102/min on Windows. Larger runners need a Team or Enterprise Cloud org, are never free, and cannot use included minutes. macOS M1 standard costs $0.062/min. The macOS M2 "xlarge" larger runner ($0.102/min) is the only macOS label documented with GPU acceleration. Whether Metal is available on standard macOS runners varies by image; probe it before relying on it.
9. **GitHub plan gates matter for prod safety.** On Free, Pro and Team plans, required reviewers, wait timers and admin-bypass control work only in **public** repos. On GitHub Free, environment secrets are public-repo-only. If GTA-Tha-Bay is private on a personal Free or Pro account, "prod requires approval" has to come from branch protection plus a `workflow_dispatch`/tag trigger, not from environment reviewers.
10. **Supabase.** `supabase/setup-cli@v3.0.1` reads the CLI version from the lockfile. The current CLI is `supabase@2.121.0`. `supabase db push [--dry-run] [--include-all]` needs `link`. Scoped PATs (`sbp_fc…`) need Project Settings, API Keys and API Key Secrets (all Read) for `link`. `supabase db lint` defaults to `--fail-on none`, so CI must pass `--fail-on error`. Use `supabase test db` (pgTAP) and `supabase gen types typescript --local`, with a diff check. Branching requires Pro, is billed per use from $0.01344/h (Micro), and is not covered by the spend cap or compute credits. Branching runs every migration in a single transaction, so `create index concurrently` fails there but works with `db push`. The CLI `config.toml` has no generic Custom OIDC third-party provider (only firebase, auth0, aws_cognito, clerk and workos). The Management API does: `POST /v1/projects/{ref}/config/auth/third-party-auth` with `{ oidc_issuer_url | jwks_url | custom_jwks }`, which needs the "Auth Config" read-write PAT permission.

---

## 1. GitHub Actions and Cloudflare Workers

### 1.1 Action versions (git tags read 2026-10-18; commit dates from the tag commit)

| Action | Latest tag | Commit SHA (pin this) | Tag commit date | Runtime / notes |
|---|---|---|---|---|
| `cloudflare/wrangler-action` | v4.1.3 | `953926a2e2182532811c01a25e53647d93bf07c0` | 2026-09-24 | node24. v4 defaults to Wrangler 4. Previews need wrangler ≥ 4.136.3 |
| `actions/checkout` | v7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` | 2026-07-17 | node24 (runner ≥ v2.327.1). v7 refuses fork checkout under `pull_request_target`/`workflow_run` unless `allow-unsafe-pr-checkout: true` |
| `actions/setup-node` | v7.1.0 | `949feb2413d6458794dcd2491c4babbbce0c15c1` | 2026-10-08 | node24. pnpm caching must be enabled with `cache: pnpm`. The v7 breaking change removed the dummy `NODE_AUTH_TOKEN` fallback |
| `actions/cache` | v6.1.0 | `55cc8345863c7cc4c66a329aec7e433d2d1c52a9` | 2026-06-23 | node24 |
| `actions/upload-artifact` | v7.0.2 | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` | 2026-10-07 | node24 |
| `actions/download-artifact` | v8.0.2 | `9000827ccba6bdab643e8b6fd33ac0654aef8333` | 2026-10-07 | |
| `pnpm/action-setup` | v6.1.0 | `ea17c68df8912ef543352723c149a84f56e3d413` | 2026-09-05 | inputs `version`, `package_json_file`, `cache`, `run_install`, `standalone` |
| `supabase/setup-cli` | v3.0.1 | `45a513f8c64c0bc8e0e3dfe572b5c95be85f6359` | 2026-09-24 | composite. With `version` omitted it reads `pnpm-lock.yaml`/`package-lock.json`/`bun.lock` and verifies integrity |
| `actions/github-script` | v9.0.0 | `3a2844b7e9c422d3c10d287c895573f7108da1b3` | 2026-04-09 | optional |

Cloudflare's docs and the wrangler-action README still show `actions/checkout@v6` and `@v4` in their examples. Those versions work but are older. Pin the SHAs above and refresh them with a nightly `check:pins` job.

### 1.2 wrangler-action v4.1.3 inputs and outputs (from `action.yml` at the tag)

- **Inputs:**
  - `apiToken` and `accountId`.
  - `quiet` (default `false`).
  - `environment` and `workingDirectory`.
  - `wranglerVersion` (exact, range, major or `latest`; omitted means an existing install, else a default v4).
  - `secrets` (newline-separated env names, uploaded with `wrangler secret bulk`, which **deploys immediately**).
  - `preCommands` and `postCommands`.
  - `command` (default `deploy`; multiline allowed).
  - `vars`.
  - `packageManager` (`npm|pnpm|yarn|bun`, otherwise inferred from the lockfile).
  - `gitHubToken` (creates GitHub Deployments and job summaries).
- **Outputs:**
  - `command-output` and `command-stderr`.
  - `deployment-url`.
  - `preview-url`, `preview-deployment-url`, `preview-name`, `preview-id` and `preview-deployment-id` (Workers Previews, wrangler ≥ 4.136.3).
  - Pages-only outputs.
- **Recommendation:** run wrangler directly with `pnpm exec wrangler …`, pinned through the lockfile, in most steps. Use the action only for `preview`, where its outputs and GitHub Deployment record are useful. Either way, wrangler stays at 4.151.1 through the lockfile.

### 1.3 Auth for CI

- There is no OIDC. Create an **Account API token** (Manage account › Account API tokens). These act as service principals, are not tied to a person, use the `cfat_` prefix, and are auto-revoked by Cloudflare when GitHub secret scanning finds them in a public repo.
- Give each token an **expiry (TTL)**. IP filtering is impractical, because GitHub-hosted runner IPs vary.
- Token split (least privilege):

| Secret name | Used by | Permissions |
|---|---|---|
| `CF_API_TOKEN_DEPLOY` | preview.yml, deploy.yml | Workers `Editor` on the named Workers (`tha-bay-web`, `tha-bay-api`). Add Zone › Workers Routes › Write only if routes or custom domains change in CI. First-ever creation of each Worker is a one-time bootstrap with an `Admin` token, or a first `wrangler deploy` by the operator |
| `CF_API_TOKEN_ASSETS` | assets.yml | Account › Workers R2 Storage Write (bucket ops). Use it to mint R2 **temporary credentials** scoped to one bucket and prefix; or use a separate R2 S3 token (`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`, "Object Read & Write", bucket-scoped) |
| `CF_API_TOKEN_CACHE` | assets.yml, kill-switch runbook | Zone › Cache Purge (media zone only) |
| `CLOUDFLARE_ACCOUNT_ID` | all | not secret, but keep it as a variable |

- Wrangler reads `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from the environment. Map the split secrets onto those names per step.

### 1.4 Versions, gradual deployments and rollback (commands verified against the wrangler command reference, 2026-10-18)

```bash
# upload (no traffic change); --tag/--message for traceability; secrets ride along additively
WRANGLER_OUTPUT_FILE_PATH=$RUNNER_TEMP/wr.ndjson \
  pnpm exec wrangler versions upload --tag "${GITHUB_SHA::12}" --message "$PR_TITLE" --secrets-file "$RUNNER_TEMP/secrets.json"
NEW=$(jq -r 'select(.type=="version-upload").version_id' "$RUNNER_TEMP/wr.ndjson")
OLD=$(pnpm exec wrangler deployments status --json | jq -r '…current version id…')   # field path UNVERIFIED, see Unverified
pnpm exec wrangler versions deploy "$NEW@0%" "$OLD@100%" -y --message "smoke $NEW"
curl -fsS https://<host>/api/v1/health -H "Cloudflare-Workers-Version-Overrides: tha-bay-web=\"$NEW\""
pnpm exec wrangler versions deploy "$NEW@10%" "$OLD@90%" -y   # then 50/50, then "$NEW@100%"
pnpm exec wrangler rollback "$OLD" --message "auto-rollback: health gate failed"   # replaces any split with OLD@100%
```

- `versions deploy` flags:
  - `--version-id` and `--percentage`, or the positional `<id>@<pct>` shorthand (omitted percentages share what is left).
  - `--version-tag` (tag shorthand).
  - `--message`, `-y` and `--dry-run`.
  - `--durable-objects-code-update-mode immediate | "deferred <max-delay>"`.
- **Limits:**
  - At most two versions per deployment.
  - Deploys and rollbacks only within the last 100 uploaded versions.
  - `wrangler versions upload` cannot be the first upload of a new Worker.
  - Service-worker syntax is not supported; use ES modules.
- **Durable Objects:**
  - In a split, each DO instance is pinned to one version for the life of that deployment. Raising a version's percentage never moves its DOs back.
  - A DO is reset only when its version changes.
  - **Lifecycle changes, through the declarative `exports` field or legacy `migrations`, cannot be uploaded as versions.** They must go through `wrangler deploy`. Wrangler before 4.131.0 reports error `10211`.
  - Rollback is blocked across a lifecycle change, and when a bound R2 bucket, KV namespace or queue has since been deleted.
  - Cloudflare advises shipping DO lifecycle changes alone, separate from other code.
- **Version skew:**
  - Each request is routed to a version independently.
  - With hashed static assets, HTML from version A can request `index-<hashA>.js` from version B and get a 404.
  - Fix: a zone Transform Rule that sets `Cloudflare-Workers-Version-Key`, from a cookie the Worker sets (anonymous players), or `ip.src` as a fallback.
  - Transform Rules work only on a zone route, not on `*.workers.dev`.
- **Observability:** use the version metadata binding (`versionID`, `versionTag`) in telemetry events (C16), and the Logpush `ScriptVersion` field.

### 1.5 Workers Previews (per-PR and per-branch environments)

- **Commands:**
  - `wrangler preview [--name <n>] [--tag] [--message] [--json] [--ignore-base-config] [--worker-name]`. The name defaults to the git branch.
  - `wrangler preview delete --name <n> --skip-confirmation`.
  - `wrangler preview secret put|delete|list|bulk --name <n>`.
  - `wrangler preview base-config secret put|delete|list|bulk`. Base secrets apply only to Previews created afterwards.
- **Config:**
  - A `previews` block is required, even if empty.
  - `assets`, `compatibility_date` and flags stay at the top level. Preview assets are uploaded from the branch.
  - `vars`, `define`, storage bindings, queue producers and `tail_consumers` must be redeclared under `previews`. They are **not inherited**.
  - DO classes and migrations stay at the top level, and each Preview gets its own DO namespace and storage automatically.
  - If code reads `env.ROOM`, the binding must be repeated under `previews.durable_objects.bindings`. Otherwise the Preview returns error 1101.
  - `ctx.exports` is the recommended DO access pattern and needs no Preview binding (compatibility date ≥ 2025-11-17).
- **Not supported in a Preview:**
  - Queue consumers (only one consumer per queue, and it is never a Preview).
  - Cron Triggers.
  - Production routes.
  - Workflows: a binding points at an existing Workflow.
  - Service bindings: they call the production Worker.
- **Consequences for us:**
  - Previews bind `JOBS` to a staging queue (producer only), `CUTSCENE_WF` to a staging Workflow, `MEDIA` to a staging bucket, and `HYPERDRIVE` to a staging config.
  - Every queue- or cron-driven feature needs a test-only HTTP route, so the Preview can exercise it.
- **URLs:**
  - `workers.dev` Preview URLs send `X-Robots-Tag: noindex`.
  - Custom-domain Previews use `<preview>.app.example.com`, after setting `previews_enabled: true` on a `custom_domain` route. Cloudflare provisions a wildcard DNS record and certificate. Use a dedicated host such as `preview.<domain>`.
  - Preview URLs are public by default. Cloudflare Access can protect `preview_worker` or `all_preview_workers`. CI then sends `CF-Access-Client-Id` and `CF-Access-Client-Secret` service-token headers.
- **Forks:** repository secrets are not available to fork PRs. Gate the job with `github.event.pull_request.head.repo.full_name == github.repository`.
- **Monorepo:** Preview names are scoped per Worker, so `pr-123` can exist for both the web and API Workers. The web Preview's service binding to the API still calls **production** API, so cross-Worker changes need `ctx.exports` within one Worker or a staging env.
- **Vite plugin:** `@cloudflare/vite-plugin@1.64.0` validates a `previews` block (source inspection), and `wrangler preview` honours the build-output config redirect (`useConfigRedirectIfAvailable: true` in wrangler 4.151.1 source). Running `vite build && wrangler preview` end to end on our repo is still an M00 spike (see Unverified).
- **Workers Builds alternative:** 3,000 build minutes on Free and 6,000 on Paid (+$0.005/min), a 20-minute timeout, and 1 or 6 concurrent builds. It can comment Preview URLs on PRs. **Do not connect Workers Builds as well as GitHub Actions**, or every push deploys twice.

### 1.6 Environments

- Keep the 06 §7 plan from stack-cloudflare-backend: Wrangler env `staging` is a separate Worker (`tha-bay-web-staging`); production is the top level.
- Previews hang off production (`wrangler preview`) or off staging (`wrangler preview --env staging`). Every preview command must repeat the same `--env`.
- Recommendation: Previews under the **staging** Worker. Staging has Supabase staging, a staging bucket and a staging Workflow, and production Workers never host PR code.

---

## 2. Assets to R2 from CI

### 2.1 Upload tool choice

| Path | Limit | Throughput | Verdict |
|---|---|---|---|
| `wrangler r2 object put <bucket>/<key> --file … --content-type --cache-control --remote` | 300 MiB per object (wrangler source `MAX_UPLOAD_SIZE_BYTES = 300*1024*1024`); calls the Cloudflare REST API `/accounts/:id/r2/buckets/:b/objects/:k` | REST API: 1,200 requests per 5 min **per account** across all R2 REST operations | Fine for a handful of objects (pointer and manifest), wrong for thousands |
| `wrangler r2 object bulk put <bucket> --filename list.json --concurrency 20` | Hidden, `status: "experimental"`; one Content-Type/Cache-Control for the whole batch; same REST limit | same | Do not use |
| **rclone 1.75.2** (`type=s3`, `provider=Cloudflare`, endpoint `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`) | 5 GiB single PUT; multipart above `--s3-upload-cutoff` (default **200 Mi**), chunk 5 Mi, 4 parts in parallel per file | S3 API, no account REST cap documented; R2 limits writes to the same key to 1/s | **Use this.** Cloudflare's docs call rclone the bulk tool |
| aws-cli v2 (`--endpoint-url`, region `auto`) | multipart threshold and chunk default **8 MB**, 10 concurrent requests | S3 API | Fallback; `--cache-control`/`--content-type` per call |

- **rclone details:**
  - Set `no_check_bucket = true` for object-scoped tokens.
  - Configure the remote entirely from the environment (`RCLONE_CONFIG_R2_TYPE=s3`, `RCLONE_CONFIG_R2_PROVIDER=Cloudflare`, …), so no config file is written.
  - `--header-upload "Cache-Control: …"`, `--metadata-set`, `--ignore-existing`, `--immutable`, `--fast-list`, `--transfers`, `--checkers`, `--s3-no-check-bucket` and `--s3-no-head` all exist (rclone flags page).
  - **Cloudflare decompresses objects uploaded with `Content-Encoding: gzip`.** Never upload pre-gzipped packs. This matches the identity-encoded rule in stack-cloudflare-backend §1.2.
- **Cost:** every PUT and every multipart part is Class A ($4.50/M). Publishing 5,000 objects costs about $0.02. `--ignore-existing` keeps re-runs nearly free (the list calls are also Class A), and `--fast-list` cuts list calls.
- **Per-object headers:** rclone sets one header set per invocation, so run one invocation per content class with `--include` filters:

| Class | Pattern | Content-Type | Cache-Control |
|---|---|---|---|
| world packs | `world/packs/**/*.pack` | `application/octet-stream` | `public, max-age=31536000, immutable` |
| glTF | `**/*.glb` | `model/gltf-binary` | same |
| textures | `**/*.ktx2` | `image/ktx2` | same |
| manifests (immutable) | `manifests/*.json` | `application/json` | same |
| cutscenes | `cutscenes/*.mp4` | `video/mp4` | same |

### 2.2 Atomic switch of what clients load

- **KV:** a pointer in KV is eventually consistent. Remote locations can see the old value for 60 s or more, and KV "is not ideal for … atomic operations". Read-your-write needs all writes to go through a Durable Object.
- **Recommendation:**
  - Every manifest is immutable and content-addressed: `manifests/world-<sha256>.json` on R2.
  - The pointer `world-manifest.json` is **built into the web Worker's static assets**, so it ships with the Worker version.
  - Flipping the pointer is then a normal versioned deploy: atomic per version, covered by gradual percentages and version affinity, and reversible with `wrangler rollback`.
  - KV stays for kill-switch and roster flags, where 60 s convergence is acceptable (the legal target is ≤ 60 s live removal through a DO broadcast, legal-ip-likeness §L4).
- **Order of operations, enforced by `assets.yml`:**
  1. Upload all new objects.
  2. Verify each with HEAD (size, content-type).
  3. Upload the immutable manifest.
  4. Open a PR that bumps the pointer, or deploy it.
  5. Garbage-collect old prefixes only after N releases, using a lifecycle rule or a script.

### 2.3 CDN caching and purge on `media.<domain>` (R2 custom domain)

- A custom domain is required for caching. `r2.dev` has no cache or WAF and is rate-limited.
- Turn on Smart Tiered Cache to cut R2 reads.
- Cacheable size limit: 512 MB per file on Free, Pro and Business.
- **Default cached extensions** do not include `.glb`, `.ktx2`, `.json` or custom `.pack` (MP4, BIN, ZST, etc. are included). Add one Cache Rule on hostname `media.<domain>`: Eligible for cache, Edge TTL "respect origin". Objects then carry `immutable` headers from §2.1.
- Cloudflare does not cache responses with `Cache-Control: private | no-store | no-cache | max-age=0`. Keep mutable things (the pointer) off R2, as in §2.2.
- **Purge (all plans):**
  - Options: URL, hostname, tag, prefix, everything.
  - Free plan: 800 URLs/s for single-file purge, with ≤ 100 URLs per request.
  - Hostname, tag, prefix and everything: 5 requests/min (bucket 25) on Free, 5 req/s on Pro, with ≤ 100 operations per request.
  - Prefix purge accepts ≤ 100 prefixes per request.
  - API token permission: Zone › Cache Purge.
  - A 200 means the purge request was received, not that anything was evicted. Verify by checking that `CF-Cache-Status` ≠ `HIT`.
- **Cache-Tag is a response-header feature.** R2 object metadata is limited to standard HTTP fields plus custom metadata, so tag-based purge of R2 objects is UNVERIFIED. Use **prefix purge** for kill-switch takedowns, for example `https://media.<domain>/characters/<slug>/` (legal-ip-likeness §L4: public purge ≤ 24 h).

---

## 3. Supabase in CI

- **Install:** `supabase/setup-cli@v3.0.1`. Add `supabase@2.121.0` (npm, 2026-10-14) to root `devDependencies` so the action picks the version from the lockfile. `3.0.0-next.16` exists as a prerelease; do not use it.
- **Local stack on runners:**
  - `supabase db start` (Postgres only) is enough for migrations, lint, pgTAP and types.
  - Full `supabase start` "recommends at least 7 GB of RAM". The private-repo `ubuntu-latest` has 8 GB and 2 vCPU, so exclude unused services: `-x studio,imgproxy,edge-runtime,logflare,vector,mailpit,supavisor` (names from `supabase start --help`).
  - Docker is on GitHub Ubuntu images.
- **Checks:**
  - `supabase db lint --level error --fail-on error`. The default `--fail-on` is `none`, which never fails.
  - `supabase test db` (pgTAP, `supabase/tests/*.sql`).
  - `supabase gen types typescript --local > packages/shared/src/db.gen.ts && git diff --exit-code`.
  - `supabase db diff --strict-coverage` only on the `pg-delta` engine (`[experimental.pgdelta] enabled = true`); the flag does nothing on `migra`.
- **Deploy:**
  - Run `supabase link --project-ref $SUPABASE_PROJECT_ID`, then `supabase db push --dry-run`, then `supabase db push`.
  - Environment: `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD`.
  - `--include-all` applies migrations missing from remote history. Use it only in a repair runbook.
  - `migration repair` mutates history.
  - Use a separate staging project; it must be a fresh project, per Supabase's docs.
- **Tokens:** create **scoped PATs** (`sbp_fc…`) per environment. `link` needs Project Settings, API Keys and API Key Secrets, all Read. `db push` with the DB password is not limited by token scopes.
- **Branching:**
  - Requires Pro.
  - GitHub-integration branches build the schema from repo migrations and seed from `seed.sql`.
  - Each migration runs in one transaction, so `create index concurrently` fails in branching but works with `db push`.
  - Preview branches are deleted on PR merge or close.
  - Billing: no fixed fee, from $0.01344/h on Micro. Compute credits and the spend cap do not apply.
  - Per-branch Postgres changes from the GitHub integration conflict with our "CI is the only deployer" rule, unless "Deploy to production" stays **off**.
  - Recommendation: no branching until multiplayer (M12+). Use CI's local `db start` for PR checks and a staging project for Previews.
- **Free-project pause:** a staging project on Free pauses after 7 days idle (stack-cloudflare-backend risk 9). `nightly.yml` runs a cheap authenticated query against staging.
- **Third-Party Auth, Custom OIDC (CLI gap):**
  - CLI 2.121.0's `config.toml` `[auth.third_party.*]` supports only firebase, auth0, aws_cognito, clerk and workos (source `apps/cli-go/pkg/config/auth.go`).
  - The Management API supports it. `POST https://api.supabase.com/v1/projects/{ref}/config/auth/third-party-auth` with body `{ "oidc_issuer_url": "https://api.<domain>/auth" }` (or `jwks_url`, or `custom_jwks`) returns `{ id, type, oidc_issuer_url, jwks_url, custom_jwks, resolved_jwks, inserted_at, updated_at, resolved_at }`.
  - Also available: `GET` (list), `GET /{tpa_id}` and `DELETE /{tpa_id}`. Endpoints carry the OAuth scope `auth:write`/`auth:read`, and a PAT needs **Auth Config: Read-write**.
  - Wrap it in an idempotent `tools/ci/supabase-tpa.ts`: list, then create only if the issuer is absent.
  - Supabase docs say key rotation pickup takes up to 30 minutes (auth-ugc-input-maps §1.2).
  - **Types from CI without Docker:** `GET /v1/projects/{ref}/types/typescript` (PAT Database: Read).

---

## 4. Headless GPU, WebKit and XR testing

### 4.1 Measured matrix (local run, 2026-10-18)

- **Environment:**
  - Ubuntu 24.04.5 x64 container, no GPU, 4 vCPU and 15 GB. Same OS as `ubuntu-latest`; close to the public-repo runner spec of 4 vCPU and 16 GB.
  - `playwright@1.64.1`: Chromium 156.0.8078.4 (Chrome for Testing and headless shell), WebKit 27.2 (macOS 14 is pinned to an older WebKit revision, 2251, in `browsers.json`), Firefox 157.
  - `three@0.186.1`, `iwer@2.6.0`.
  - Served from `http://localhost` (a secure context) with COOP `same-origin` and COEP `require-corp`.

| Config | `navigator.gpu` | adapter | WebGPU compute | WebGPU canvas + screenshot | three r186 backend | WebGL2 renderer string | `crossOriginIsolated` | `navigator.xr` |
|---|---|---|---|---|---|---|---|---|
| Chromium headless, no flags | yes | **null** ("No available adapters.") | — | — | WebGL2 (automatic fallback) | ANGLE Vulkan 1.3 SwiftShader | true | yes, `immersive-vr` false |
| Chromium + `--enable-unsafe-webgpu` | yes | SwiftShader fallback | ok | **fails** (OperationError on present) | — | same | true | same |
| Chromium + `--enable-unsafe-webgpu --enable-features=Vulkan --use-angle=swiftshader --use-vulkan=swiftshader` | yes | SwiftShader fallback (`isFallbackAdapter: true`, 21 features, `maxTextureDimension2D` 8192) | ok | **ok** (red frame, pixel read back) | **WebGPU** | same | true | same |
| same + `--use-webgpu-adapter=swiftshader`, `--ignore-gpu-blocklist` | — | — | — | not needed (ablation) | — | — | — | — |
| WebKit 27.2 Linux | **no** | — | — | — | WebGL2 | "Apple GPU" (string spoofed by the build) | true | **no** |

- The same results held in Playwright's new headless mode (`channel: 'chromium'`) and in the headless shell.
- **WebKit screenshot quirk:** after a single `render()`, the WebGL canvas screenshot was blank. With a running `setAnimationLoop`, which the game always has, the frame captured correctly.
- **What SwiftShader proves:** WGSL compiles, pipelines and bind groups validate, TSL node materials build, the render graph runs, and deterministic screenshots work at small sizes.
- **What it does not prove:** frame time, GPU memory, tile-based mobile GPU behaviour, Apple Metal-backed WebGPU, or limits above the fallback adapter's. The engine must request **only the limits it needs** and degrade otherwise, or CI fails on `requestDevice`.

### 4.2 WebXR emulation with IWER

- **Package:** `iwer@2.6.0` (MIT, `meta-quest/immersive-web-emulation-runtime`, published 2026-10-13). Dependencies: `gl-matrix` and `webxr-layers-polyfill`.
- **Exports:** `XRDevice` and the configs `metaQuest3`, `metaQuest2`, `metaQuestPro`, `metaVRGlasses`, `oculusQuest1`. Controller configs: `oculusTouchV3`, `metaQuestTouchPlus`. It also exports `ActionRecorder`/`ActionPlayer` (record and replay input) and `RemoteControlInterface`.
- **Companions:** `@iwer/devui@2.6.0` and `@iwer/sem@2.6.0` depend on `three ^0.184.0`, which would install a second three next to r186. Keep them out of test builds, or alias them.
- **Measured with three r186 `WebGPURenderer`** (10 XR frames each):
  - Chromium plus SwiftShader: the WebGPU backend switches to WebGL through `setupWebGLXRFallback`.
  - Chromium without flags: WebGL2.
  - WebKit: WebGL2.
- **Required:**
  - `installRuntime({ forceInstall: true })` on Chromium. Without it, IWER warns and skips, because a native `navigator.xr` exists.
  - Install IWER **before** constructing the renderer. If the order is reversed, `XRManager.setSession` throws `this._glBinding.createProjectionLayer is not a function`.
  - Without the fallback helper, `setSession` on the WebGPU backend throws: "WebGPU XR sessions require the "webgpu" session feature … or use a WebGL backend". IWER provides no `XRGPUBinding`.
- **Spec hook:** dev and test builds accept `?xr-emulate=quest3`. Playwright injects IWER with `page.addInitScript` before app scripts run. A test-only "Enter VR" bridge command calls `navigator.xr.requestSession('immersive-vr', …)` (no user gesture is needed under IWER) and asserts these:
  - `renderer.xr.isPresenting`;
  - N frames rendered;
  - controller and hand input mapped to C03 actions, through `ActionPlayer` recordings;
  - the comfort vignette toggles.

### 4.3 Runners

- **Standard runners** have no GPU. Public repos get 4 vCPU and 16 GB on Linux and Windows. Private repos get 2 vCPU and 8 GB. macOS M1 (`macos-14`, `-15`, `-26`, `-latest`) has 3 cores and 7 GB.
- **GPU larger runners:** 4 vCPU, 1× Tesla T4 with 16 GB VRAM, 28 GB RAM, Ubuntu or Windows. Concurrency is capped at 100 GPU jobs.
- **Larger runners in general:** Team or Enterprise Cloud org only, never free (even for public repos), and included minutes do not apply.
- **macOS xlarge (M2, `macos-15-xlarge` etc.)** is the only macOS label documented with "GPU hardware acceleration". Standard macOS Metal availability has mixed community reports (see Unverified).
- **Real-device clouds:**
  - BrowserStack Automate runs **Playwright on real iOS Safari** (announced June 2025; its docs list Node.js, Java, C# and Python). WebGPU, WebXR and Home Screen web apps are not documented (UNVERIFIED).
  - AWS Device Farm: $0.17 per device-minute, a $250/month unmetered slot, a 1,000-minute one-time trial, and desktop browser testing at $0.005 per instance-minute.
  - Quest Browser: no cloud found. A USB-attached headset on a self-hosted runner over `adb` + CDP is UNVERIFIED.

---

## 5. Costs and caching

- **GitHub-hosted per-minute rates** (billing reference, 2026-10-18):
  - Linux 2-core $0.006, Linux 1-core `ubuntu-slim` $0.002, Linux arm64 $0.005.
  - Windows $0.010.
  - **macOS M1/Intel $0.062.**
  - macOS 12-core Intel $0.077, macOS 5-core M2 $0.102.
  - Linux GPU $0.052, Windows GPU $0.102.
  - Minutes round up per job.
- **Free minutes and storage:** public repos are free on standard runners. Private: Free 2,000 min/month and 500 MB artifacts; Pro 3,000 min and 1 GB; Team 3,000 min and 2 GB. Cache is 10 GB per repo, with usage above that billed by hourly peak.
- **Example:** a 6-minute macOS probe job each night is about $11/month on a private repo, using spend-based billing.
- **Concurrency:** 20 jobs (Free), 40 (Pro), 60 (Team). Max 5 concurrent macOS jobs on non-Enterprise plans.
- **Job limit:** 6 h per job on hosted runners.
- **Cache rate limits:** 200 uploads and 1,500 downloads per minute per repo.
- **Playwright browsers:** Playwright's CI guide says caching is "not recommended", because restoring takes about as long as downloading and OS deps can't be cached. Run `pnpm exec playwright install --with-deps chromium webkit`. The image `mcr.microsoft.com/playwright:v1.64.1-noble` exists (MCR tag list) for container jobs.
- **KTX-Software 4.4.2:**
  - `KTX-Software-4.4.2-Linux-x86_64.deb` (7.03 MB, SHA-1 `b7d4a0833a5aff570f01f56413e40ea8db291212` per its `.sha1` asset, recomputed locally) installs `/usr/bin/ktx`, `toktx`, `ktxinfo`, `ktx2check`, `ktx2ktx2` and `ktxsc`.
  - `@gltf-transform/cli@4.5.1` requires `ktx` (KTX-Software ≥ 4.4.0) on PATH.
  - Cache the `.deb` with `actions/cache` (key `ktx-4.4.2-linux-x64`). This is optional, because the download is small.
- **pnpm store:** `actions/setup-node` with `cache: pnpm` (v6+ no longer auto-caches pnpm).

---

## 6. Secrets hygiene

- **GitHub environments:**
  - `preview`: Preview secrets only.
  - `staging`.
  - `production`: deploy tokens, Supabase prod DB password, R2 prod creds.
  - **Required reviewers, wait timers and "disallow admin bypass" work only in public repos on Free, Pro and Team.**
  - Environment secrets on GitHub Free are public-repo-only.
  - Deployment branch/tag rules work in private repos on Pro and Team.
  - Fallback while the repo is private on a personal plan: prod deploy runs only on a pushed `v*` tag from a protected branch, through `workflow_dispatch` by an allowlisted actor (`github.actor` check), with secrets in the `production` environment where the plan allows.
- **Worker secrets:**
  - CI writes a secrets JSON from GitHub secrets into `$RUNNER_TEMP` (never the workspace) and passes `--secrets-file` to `versions upload`. Secrets ride with the version, so a gradual deploy shifts code and secrets together and rollback restores both.
  - `wrangler secret bulk` handles ≤ 100 secrets per call. JSON `null` deletes a key (wrangler ≥ 4.97.0); `.env` files cannot delete.
  - Preview secrets: `wrangler preview base-config secret bulk` once; per-PR overrides with `wrangler preview secret put --name pr-N`.
  - Declare `secrets.required` in `wrangler.jsonc` so a missing key fails `deploy` and `versions upload`.
  - Local dev uses `.dev.vars` or `.env`, never both. Both are git-ignored.
- **Supply chain:**
  - Pin actions by SHA (§1.1).
  - Set `permissions:` per job (default `contents: read`; `pull-requests: write` only for the comment step; `deployments: write` only for wrangler-action).
  - Never use `pull_request_target` with checkout of PR code; checkout v7 refuses it by default.
  - `persist-credentials: false` on checkout in jobs that do not push.
- **Leak detection:** Cloudflare `cfat_`/`cfut_` tokens and Supabase scoped PATs have distinctive prefixes. Extend the repos-modding secret-pattern list with `cfat_`, `cfut_`, `cfk_`, `sbp_` and `sb_secret_` for `check:secrets`.

---

## Verified facts

| fact | source URL | date checked | confidence |
|---|---|---|---|
| `cloudflare/wrangler-action` latest tag v4.1.3 (commit 953926a…, 2026-09-24); runs on node24; v4 defaults to Wrangler 4 | https://github.com/cloudflare/wrangler-action (git tags + `action.yml`, CHANGELOG at tag) | 2026-10-18 | high |
| wrangler-action inputs: apiToken, accountId, quiet, environment, workingDirectory, wranglerVersion, secrets, preCommands, postCommands, command, vars, packageManager, gitHubToken; outputs incl. preview-url, preview-deployment-url, preview-name, preview-id, preview-deployment-id (wrangler ≥ 4.136.3) | https://github.com/cloudflare/wrangler-action/blob/v4.1.3/action.yml | 2026-10-18 | high |
| wrangler-action `secrets` input runs `wrangler secret bulk` (or `secret put`) | https://github.com/cloudflare/wrangler-action/blob/v4.1.3/src/wranglerAction.ts | 2026-10-18 | high |
| Latest tags: checkout v7.0.1, setup-node v7.1.0, cache v6.1.0, upload-artifact v7.0.2, download-artifact v8.0.2, pnpm/action-setup v6.1.0, supabase/setup-cli v3.0.1, github-script v9.0.0, rclone v1.75.2, sticky-pull-request-comment v3.0.5 (SHAs §1.1) | `git ls-remote --tags` on each github.com repo | 2026-10-18 | high |
| checkout v7 refuses fork checkout under `pull_request_target`/`workflow_run` unless `allow-unsafe-pr-checkout: true`; node24 needs runner ≥ v2.327.1 | https://github.com/actions/checkout/blob/v7.0.1/README.md | 2026-10-18 | high |
| setup-node v6+: pnpm caching off by default, enable with `cache`; v7 removed dummy `NODE_AUTH_TOKEN` | https://github.com/actions/setup-node/blob/v7.1.0/README.md | 2026-10-18 | high |
| Workers CI auth: API token ("Edit Cloudflare Workers" template) + account ID as CI secrets; example uses wrangler-action@v4 | https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/ (updated Oct 18, 2026) | 2026-10-18 | high |
| No OIDC/workload-identity federation for the Cloudflare API is documented; a community feature request exists | https://community.cloudflare.com/t/openid-connect-authentication-for-cloudflare-api/492897 ; https://developers.cloudflare.com/fundamentals/llms.txt | 2026-10-18 | medium (absence) |
| Account API tokens are service principals for CI; new ones use `cfat_` prefix; Workers, R2, KV, DO, Queues, Workflows, Cache, Zone supported | https://developers.cloudflare.com/fundamentals/api/get-started/account-owned-tokens/ | 2026-10-18 | high |
| Token formats `cfk_`/`cfut_`/`cfat_` + 40 chars + checksum; GitHub Secret Scanning partner: public-repo leaks auto-revoked, private-repo leaks notified | https://developers.cloudflare.com/fundamentals/api/get-started/token-formats/ | 2026-10-18 | high |
| Tokens can be restricted by client IP and TTL (notBefore/notAfter) | https://developers.cloudflare.com/fundamentals/api/how-to/restrict-tokens/ | 2026-10-18 | high |
| Workers roles: Editor can upload/deploy versions, rollback, manage secrets; creating a Worker needs product-level Admin; routes/custom domains also need Zone › Workers Routes › Write; deploying with bindings needs no permission on the bound resources | https://developers.cloudflare.com/workers/authorization/workers/ | 2026-10-18 | high |
| Workers Previews: `wrangler preview` (requires wrangler ≥ 4.135.0); own vars/secrets/bindings per Preview; Preview URL + immutable Deployment URL; limits 100 (Free) / 500 (Paid) Previews per Worker, 100 deployments per Preview; oldest auto-deleted | https://developers.cloudflare.com/workers/previews/ (updated Sep 24, 2026) | 2026-10-18 | high |
| `wrangler preview` status "open beta" in wrangler 4.151.1; honours config redirect (`useConfigRedirectIfAvailable: true`) | https://registry.npmjs.org/wrangler/4.151.1 (tarball `wrangler-dist/cli.js`) | 2026-10-18 | high |
| Version URLs use production resources; Cloudflare says not to use them (or `--preview-alias`) for PR testing; use Previews | https://developers.cloudflare.com/workers/previews/compare-workflows/ | 2026-10-18 | high |
| Previews config: `previews` block required (can be empty); assets/compat at top level; vars/define/storage bindings/queue producers/tail consumers must be redeclared (not inherited); D1 migration recipe | https://developers.cloudflare.com/workers/previews/configuration/ | 2026-10-18 | high |
| Previews: new DO namespace + storage per Preview automatically; `env` DO binding must be repeated under `previews.durable_objects.bindings` (else error 1101); `ctx.exports` recommended (compat ≥ 2025-11-17) | https://developers.cloudflare.com/workers/previews/resources/ | 2026-10-18 | high |
| Previews limitations: no Queue consumers, no Cron Triggers, no production routes; Workflow binding uses an existing Workflow; service bindings call production | https://developers.cloudflare.com/workers/previews/resources/#limitations | 2026-10-18 | high |
| Preview secrets: `preview base-config secret put/bulk` (applies to new Previews only), `preview secret put --name`; `--name` defaults to git branch | https://developers.cloudflare.com/workers/previews/configuration/#secrets ; https://developers.cloudflare.com/workers/wrangler/commands/workers/ | 2026-10-18 | high |
| GitHub Actions Preview example: `npx wrangler preview --name "pr-N" --json`, `jq '.preview.urls[0]'`, `gh pr comment`; cleanup `wrangler preview delete --name … --skip-confirmation`; fork PRs lack secrets | https://developers.cloudflare.com/workers/previews/examples/ (updated Oct 1, 2026) | 2026-10-18 | high |
| Custom-domain Preview URLs via route `{custom_domain: true, previews_enabled: true, enabled: false}`; wildcard DNS/cert; `workers.dev` Preview URLs send `X-Robots-Tag: noindex` | https://developers.cloudflare.com/workers/previews/custom-domains/ | 2026-10-18 | high |
| Cloudflare Access can protect preview deployments for one Worker or all (`preview_worker`, `all_preview_workers`); service tokens use `CF-Access-Client-Id`/`CF-Access-Client-Secret` | https://developers.cloudflare.com/workers/configuration/cloudflare-access/ ; https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/ | 2026-10-18 | high |
| `wrangler versions upload` flags incl. `--tag`, `--message`, `--secrets-file` (additive), `--strict`, `--preview-alias`, `--dry-run` | https://developers.cloudflare.com/workers/wrangler/commands/workers/#versions-upload | 2026-10-18 | high |
| `wrangler versions deploy` flags `--version-id`, `--percentage`, `<id>@<pct>` shorthand, `--version-tag`, `--durable-objects-code-update-mode`, `--message`, `-y`, `--dry-run` | https://developers.cloudflare.com/workers/wrangler/commands/workers/#versions-deploy | 2026-10-18 | high |
| `wrangler rollback [VERSION_ID] [--message]` creates a new deployment immediately; from a split it puts the chosen version at 100%; only the 100 most recent versions; blocked across DO class lifecycle changes or deleted R2/KV/queue bindings | https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/ | 2026-10-18 | high |
| Gradual deploys only from the last 100 uploaded versions; first upload must be `wrangler deploy`; ES modules only | https://developers.cloudflare.com/workers/versions-and-deployments/deployment-management/ | 2026-10-18 | high |
| DO lifecycle changes (`exports` or legacy `migrations`) cannot be uploaded as versions; apply via `wrangler deploy`; wrangler < 4.131.0 may return error 10211; each DO pinned to one version per deployment | https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/with-durable-objects/ (updated Oct 18, 2026) | 2026-10-18 | high |
| Version overrides: header `Cloudflare-Workers-Version-Overrides: <worker>="<version-id>"`; version must be in current deployment; max two versions per deployment; 0% + override smoke-test pattern | https://developers.cloudflare.com/workers/versions-and-deployments/version-overrides/ | 2026-10-18 | high |
| Version affinity: `Cloudflare-Workers-Version-Key` header (Transform Rule, zone routes only, not workers.dev) prevents hashed-asset 404s during splits | https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/version-affinity/ | 2026-10-18 | high |
| Wrangler writes ND-JSON entries (`type: "version-upload"`, `version_id`, `preview_url`…) to `WRANGLER_OUTPUT_FILE_PATH`/`_DIRECTORY` | wrangler 4.151.1 tarball `wrangler-dist/cli.js` | 2026-10-18 | high |
| `wrangler secret put` creates and deploys a new version immediately; for gradual deploys use `wrangler versions secret put`; `--secrets-file` on deploy/versions upload; `secrets.required` validates before deploy | https://developers.cloudflare.com/workers/configuration/secrets/ (updated Oct 15, 2026) | 2026-10-18 | high |
| `wrangler secret bulk`: ≤ 100 secrets per command; JSON or .env; JSON `null` deletes (wrangler ≥ 4.97.0) | https://developers.cloudflare.com/workers/wrangler/commands/workers/#secret-bulk | 2026-10-18 | high |
| Workers Builds limits: 3,000 / 6,000 build min (then $0.005/min), 1 / 6 concurrent, 20-min timeout, 8 GB RAM | https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/ | 2026-10-18 | high |
| `@cloudflare/vite-plugin@1.64.0` validates `previews` config and `previews_enabled` routes | https://registry.npmjs.org/@cloudflare/vite-plugin/1.64.0 (tarball `dist/index.mjs`) | 2026-10-18 | medium (source read, not run) |
| R2 limits: single-part upload 4.995 GiB, multipart 4.995 TiB, 10,000 parts; 1 write/s per key; REST API 1,200 req per 5 min per account | https://developers.cloudflare.com/r2/platform/limits/ | 2026-10-18 | high |
| Multipart parts 5 MiB–5 GiB; SDKs/rclone choose multipart automatically | https://developers.cloudflare.com/r2/objects/upload-objects/ | 2026-10-18 | high |
| `wrangler r2 object put` flags `--content-type`, `--cache-control`, `--content-encoding`, `--remote/--local`, `--storage-class`; wrangler caps uploads at 300 MiB; uses REST `/accounts/:id/r2/buckets/:b/objects/:k`; `r2 object bulk put` hidden + experimental, concurrency 20 | https://developers.cloudflare.com/r2/reference/wrangler-commands/ ; wrangler 4.151.1 tarball | 2026-10-18 | high |
| rclone R2 config (`provider = Cloudflare`, endpoint `<acct>.r2.cloudflarestorage.com`, `no_check_bucket = true` for object-scoped tokens), rclone ≥ 1.59 | https://developers.cloudflare.com/r2/examples/rclone/ ; https://rclone.org/s3/ | 2026-10-18 | high |
| rclone defaults: `upload_cutoff` 200 Mi, `chunk_size` 5 Mi, `upload_concurrency` 4; Cloudflare decompresses `Content-Encoding: gzip` uploads | https://rclone.org/s3/ | 2026-10-18 | high |
| rclone flags exist: `--header-upload`, `--metadata-set`, `--ignore-existing`, `--immutable`, `--fast-list`, `--transfers` (default 4), `--checkers` (default 8), `--s3-no-check-bucket`, `--s3-no-head`; env-var remotes `RCLONE_CONFIG_<NAME>_<OPT>` | https://rclone.org/flags/ ; https://rclone.org/docs/ | 2026-10-18 | high |
| rclone v1.75.2 linux-amd64 zip SHA-256 `349ac8fba6ff65d6247043f1750cdcb518ec5d500ef91463a10d37c0ccdf3702` | https://downloads.rclone.org/v1.75.2/SHA256SUMS | 2026-10-18 | high |
| aws-cli s3 defaults: `multipart_threshold` 8 MB, `multipart_chunksize` 8 MB (min 5 MB), `max_concurrent_requests` 10 (CLI 2.38.1 docs) | https://docs.aws.amazon.com/cli/latest/topic/s3-config.html | 2026-10-18 | high |
| R2 temporary credentials: short-lived S3 creds bound to one bucket, a permission scope or action list, optional path prefixes; via API or local JWT signing | https://developers.cloudflare.com/r2/api/s3/temporary-credentials/ (updated Oct 16, 2026) | 2026-10-18 | high |
| KV eventually consistent; remote locations may lag ≥ 60 s; "not ideal" for atomic operations | https://developers.cloudflare.com/kv/concepts/how-kv-works/ | 2026-10-18 | high |
| R2 caching needs a custom domain; r2.dev has no caching/WAF; Smart Tiered Cache recommended; cacheable size 512 MB (Free/Pro/Business) | https://developers.cloudflare.com/cache/interaction-cloudflare-products/r2/ | 2026-10-18 | high |
| Default cached extensions exclude HTML and JSON (and .glb/.ktx2 are not listed); Cache Rule needed | https://developers.cloudflare.com/cache/concepts/default-cache-behavior/ | 2026-10-18 | high |
| Purge on all plans: URL, hostname, tag, prefix, everything; Free 5 req/min (bucket 25) for host/tag/prefix/all, single-file 800 URLs/s; ≤ 100 ops per request; 200 ≠ evicted | https://developers.cloudflare.com/cache/how-to/purge-cache/ (updated Sep 29, 2026) | 2026-10-18 | high |
| Prefix purge ≤ 100 prefixes per request; tag header ≤ 16 KB, API tag ≤ 1,024 chars | https://developers.cloudflare.com/cache/how-to/purge-cache/purge_by_prefix/ ; https://developers.cloudflare.com/cache/how-to/purge-cache/purge-by-tags/ | 2026-10-18 | high |
| API token permissions include "Cache Purge", "Workers R2 Storage Write/Edit", "Workers Scripts Write/Edit" | https://developers.cloudflare.com/fundamentals/api/reference/permissions/ | 2026-10-18 | high |
| `supabase` CLI npm latest 2.121.0 (2026-10-14); beta 2.122.0-beta.1; next 3.0.0-next.16 | https://registry.npmjs.org/supabase | 2026-10-18 | high |
| setup-cli v3: `version` optional, resolved from root lockfile (integrity-verified) else latest; Node ≥ 20 | https://github.com/supabase/setup-cli/blob/v3.0.1/README.md | 2026-10-18 | high |
| Supabase CI pattern: `db start`, `gen types typescript --local` + `git diff --exit-code`, `link` + `db push`; env `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_ID`; staging must be a new project | https://supabase.com/docs/guides/deployment/managing-environments | 2026-10-18 | high |
| `db push` flags `--db-url`, `--dry-run`, `--include-all`, `--include-roles`, `--include-seed`, `--linked`, `--local`, `-p`; `db lint` `--level`, `--fail-on none(default)/warning/error`; `test db` runs pgTAP from `supabase/tests`; `start -x` excludes services; ≥ 7 GB RAM recommended | https://supabase.com/docs/reference/cli/supabase-start (CLI reference page) | 2026-10-18 | high |
| Scoped PATs (`sbp_fc…`); `link` needs Project Settings + API Keys + API Key Secrets (Read); `db push` with DB password not token-limited; "Create project TPA integration" needs Auth Config read-write | https://supabase.com/docs/guides/platform/personal-access-tokens | 2026-10-18 | high |
| Management API: POST/GET `/v1/projects/{ref}/config/auth/third-party-auth`, GET/DELETE `/{tpa_id}`; body `oidc_issuer_url`, `jwks_url`, `custom_jwks`; `GET /v1/projects/{ref}/types/typescript`; branch endpoints | https://api.supabase.com/api/v1-json | 2026-10-18 | high |
| CLI 2.121.0 `[auth.third_party]` supports only firebase, auth0, aws_cognito, clerk, workos | https://github.com/supabase/cli/blob/v2.121.0/apps/cli-go/pkg/config/auth.go | 2026-10-18 | high |
| Branching requires Pro; GitHub/CLI deploys work on all plans | https://supabase.com/docs/guides/deployment | 2026-10-18 | high |
| Branching billing: no fixed fee; Micro from $0.01344/h; not covered by spend cap or compute credits | https://supabase.com/docs/guides/platform/manage-your-usage/branching | 2026-10-18 | high |
| Branching: schema from repo migrations; each migration in one transaction (no `create index concurrently`); preview branches deleted on PR merge/close; required check recommended | https://supabase.com/docs/guides/deployment/branching/github-integration ; https://supabase.com/docs/guides/deployment/branching | 2026-10-18 | high |
| Playwright 1.64.1 bundles Chromium 156.0.8078.4, WebKit 27.2 (mac14 pinned to rev 2251), Firefox 157 | https://registry.npmjs.org/playwright-core/1.64.1 (`browsers.json`) | 2026-10-18 | high |
| Headless Chromium 156 on GPU-less Ubuntu 24.04 x64: no adapter by default; SwiftShader WebGPU with `--enable-unsafe-webgpu --enable-features=Vulkan --use-angle=swiftshader --use-vulkan=swiftshader` (compute + canvas + screenshot OK); `--enable-unsafe-webgpu` alone fails canvas present | local experiment (Playwright 1.64.1, §4.1; scripts in session scratchpad `pwscripts/`) | 2026-10-18 | high (local), medium (for GitHub runners) |
| three r186 `WebGPURenderer` auto-falls back to WebGL2 when no adapter ("No available adapters.") and renders correctly | local experiment, three@0.186.1 | 2026-10-18 | high |
| Playwright WebKit 27.2 on Linux: no `navigator.gpu`, no `navigator.xr`; WebGL2 works; `crossOriginIsolated` true under COOP/COEP; screenshots need an active render loop | local experiment | 2026-10-18 | high |
| `iwer@2.6.0` (MIT, 2026-10-13), exports `XRDevice`, `metaQuest3`, …, `ActionRecorder/Player`; `installRuntime` skips if native `navigator.xr` exists unless `forceInstall: true`; `@iwer/devui`/`@iwer/sem` depend on three ^0.184.0 | https://registry.npmjs.org/iwer ; package `lib/device/XRDevice.d.ts` | 2026-10-18 | high |
| IWER + three r186: `immersive-vr` session renders frames on Chromium (± SwiftShader) and WebKit through WebGL; requires IWER installed before renderer construction; WebGPU backend needs `setupWebGLXRFallback` | local experiment | 2026-10-18 | high (local) |
| GitHub-hosted runner specs (public: Linux/Windows 4 vCPU/16 GB; private: 2 vCPU/8 GB; macOS M1 3 core/7 GB; labels incl. ubuntu-24.04/26.04, macos-14/15/26, xcode-27); arm64 macOS no nested virtualization | https://docs.github.com/en/actions/reference/runners/github-hosted-runners | 2026-10-18 | high |
| GPU larger runners: 4 vCPU, Tesla T4 16 GB VRAM, 28 GB RAM, Ubuntu/Windows; macOS xlarge M2 "5 (+8 GPU hardware acceleration)" | https://docs.github.com/en/actions/reference/runners/larger-runners | 2026-10-18 | high |
| Per-minute prices: Linux 2-core $0.006, Windows $0.010, macOS $0.062, macOS 12-core $0.077, macOS M2 xl $0.102, Linux GPU $0.052, Windows GPU $0.102; larger runners Team/Enterprise only, never free, no included minutes | https://docs.github.com/en/billing/reference/actions-runner-pricing | 2026-10-18 | high |
| Included minutes/storage: Free 2,000 min / 500 MB, Pro 3,000 / 1 GB, Team 3,000 / 2 GB; cache 10 GB per repo (overage billed hourly peak); public repos free on standard runners | https://docs.github.com/en/billing/concepts/product-billing/github-actions | 2026-10-18 | high |
| Concurrency 20/40/60 jobs (Free/Pro/Team), max 5 concurrent macOS; job time 6 h; cache uploads 200/min, downloads 1,500/min | https://docs.github.com/en/actions/reference/limits | 2026-10-18 | high |
| Required reviewers, wait timers, admin-bypass control: public repos only on Free/Pro/Team; environment secrets public-only on GitHub Free; deployment branch rules private on Pro/Team; ≤ 6 reviewers; prevent self-review option | https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments | 2026-10-18 | high |
| Playwright CI guide: browser caching "not recommended"; Xvfb preinstalled for headed runs | https://playwright.dev/docs/ci | 2026-10-18 | high |
| Docker image tags `mcr.microsoft.com/playwright:v1.64.1-noble` (+ jammy, resolute, amd64/arm64) exist | https://mcr.microsoft.com/v2/playwright/tags/list | 2026-10-18 | high |
| KTX-Software v4.4.2 assets incl. `KTX-Software-4.4.2-Linux-x86_64.deb` (7.03 MB) + `.sha1` (`b7d4a083…291212`, recomputed); installs `/usr/bin/ktx`, `toktx`, … | https://github.com/KhronosGroup/KTX-Software/releases/tag/v4.4.2 | 2026-10-18 | high |
| `@gltf-transform/cli@4.5.1` requires `ktx` from KTX-Software ≥ 4.4.0 | https://registry.npmjs.org/@gltf-transform/cli/4.5.1 (tarball `dist/cli.mjs`) | 2026-10-18 | high |
| `pnpm` npm latest 12.14.0 (2026-10-15) | https://registry.npmjs.org/pnpm | 2026-10-18 | high |
| BrowserStack Automate supports Playwright on real iOS devices/Safari (Node.js, Java, C#, Python) | https://www.browserstack.com/docs/automate/playwright/playwright-ios ; https://www.browserstack.com/blog/browserstack-launches-industry-first-playwright-testing-on-real-ios-devices-with-safari/ | 2026-10-18 | medium (vendor marketing + index page) |
| AWS Device Farm: $0.17/device-min, $250/slot/month, 1,000-min trial, desktop browser testing $0.005/instance-min | https://aws.amazon.com/device-farm/pricing/ | 2026-10-18 | high |

---

## Unverified

- **The SwiftShader WebGPU recipe on an actual GitHub `ubuntu-latest` runner.** It was measured in an identical-OS container, not on a runner. M00 must include an AC that runs the probe on the runner and stores the JSON as an artifact.
- **WebGPU in Playwright WebKit on macOS runners, and Chrome WebGPU on macOS or Windows runners.** Community reports are mixed. One says `MTLCreateSystemDefaultDevice` returns nil on macos-14 (M1). Others report a paravirtual Metal device on macos-15/latest ([actions/runner-images#1779](https://github.com/actions/runner-images/issues/1779), [ahrefs/ocannl#942](https://github.com/ahrefs/ocannl/issues/942), [sdcb/HyMT2Sharp PR #21](https://github.com/sdcb/HyMT2Sharp/pull/21)). Treat it as a nightly informational probe.
- **Windows runners using WARP for Chrome WebGPU.** Not tested; do not plan on it.
- **`wrangler deployments status --json` field names**, used to read the currently deployed version id. Check them with `--help` in M00. Alternative: keep the previous version id from the last `versions upload` ND-JSON in a GitHub deployment record.
- **`vite build` with `@cloudflare/vite-plugin@1.64.0`, then `wrangler preview`, end to end.** Specifically, whether the generated `dist/*/wrangler.json` keeps the `previews` block. Source evidence suggests yes; not run.
- **Whether `_headers` (COOP/COEP/CORP) apply to static assets served on Preview URLs and in `vite preview`/`wrangler dev`.** Expected, because they are the same asset pipeline, but no doc states it. preview.yml asserts it with `curl -I`.
- **Cache-Tag purge for R2 custom-domain objects.** No way to emit `Cache-Tag` from R2 metadata was found; use prefix purge.
- **BrowserStack real-iOS Playwright: WebGPU, WebXR, Home Screen web app mode, and COOP/COEP behaviour.** Not documented.
- **LambdaTest/TestMu real-device Playwright for iOS.** Not researched.
- **Automating Quest Browser.** `adb forward tcp:9222 localabstract:chrome_devtools_remote` + `chromium.connectOverCDP` is documented for Android Chrome only. The Quest Browser socket name is unconfirmed.
- **Local dev for Custom OIDC by abusing `[auth.third_party.workos] issuer_url` with our own issuer.** Untested hack; do not spec it.
- **macOS minutes multiplier against included minutes.** GitHub now bills in dollars ("spend"); the old 10× multiplier is not stated on current pages.
- **Exact rate limits of the Supabase Management API.** Not checked; keep calls idempotent and rare.
- **Playwright Docker image Node.js version.** Not checked; the spec uses `setup-node` on the host instead of the container.

---

## Recommendations for the spec

### R1. Repository scripts (`package.json` at root, pnpm workspaces; every CI step calls one of these)

The prompt pack uses pnpm (04-SONNET-KICKOFF). Pin `"packageManager": "pnpm@12.14.0"` (current latest; S13 confirms) so `pnpm/action-setup` reads it. Each `check:*` script runs alone, exits non-zero on failure, and prints a one-line summary. `npm run <name>` works the same for agents that call npm.

| Script | Does | Used by |
|---|---|---|
| `check:types` | `tsc -b` across the workspace | ci |
| `check:lint` / `check:format` | linter / formatter in check mode | ci |
| `check:unit` | vitest for packages | ci |
| `check:workers` | Workers runtime tests (Cloudflare Vitest integration) for `services/edge` | ci |
| `check:build` | `vite build` + `wrangler deploy --dry-run --outdir dist/worker` (bundle size printed) | ci |
| `check:bundle` | size budgets on JS/wasm and static-asset counts (≤ 20k files, every file ≤ 25 MiB) | ci |
| `check:e2e` | Playwright projects `chromium-webgpu`, `chromium-webgl2`, `webkit-webgl2` against a local server with COOP/COEP | ci |
| `check:e2e:xr` | Playwright project `xr-quest3` (IWER injected) on chromium-webgl2 and webkit | ci |
| `check:coi` | asserts `crossOriginIsolated === true` after first load and after a service-worker-served reload | ci, preview |
| `check:headers -- <url>` | `curl -I` assertions: COOP `same-origin`, COEP `require-corp`, CORP, `Cache-Control` on hashed assets | preview, deploy |
| `check:smoke -- <url>` | the e2e subset against a deployed URL (Preview or a version-override host) | preview, deploy |
| `check:perf` | CPU-side budgets from `renderer.info` (draw calls, triangles, textures) and JS heap on canned camera paths in SwiftShader; **no fps assertions** | ci (warn), nightly (fail) |
| `check:assets` | manifest JSON Schema (C07), pack ≤ 4 MB, content-hash names, content-type map, provenance join | ci, assets |
| `check:provenance`, `check:ip`, `check:license`, `check:names` | legal-ip-likeness §2.4 jobs | ci |
| `check:skills`, `check:kb` | repos-modding §6 | ci |
| `check:secrets` | pattern scan incl. `cfat_`, `cfut_`, `cfk_`, `sbp_`, `sb_secret_`, plus the repos-modding list | ci |
| `check:db` | `supabase db start` → `db lint --level error --fail-on error` → `test db` | ci (when `supabase/**` changed) |
| `check:db:types` | `gen types typescript --local` + `git diff --exit-code packages/shared/src/db.gen.ts` | ci |
| `check:do-migrations` | fails if a DO class lifecycle change (`exports`/`migrations`) sits in the same PR as other runtime code; labels the PR `do-lifecycle` so deploy.yml takes the `wrangler deploy` path | ci |
| `check:pins` | compares action SHAs, `wrangler`/`playwright`/`three` pins, KTX/rclone versions against a lock table; warns on drift | nightly |
| `check:all` | runs everything ci runs, in the same order | local, agents |
| `deploy:preview` | `wrangler preview --name pr-$PR --json` (or branch name) and prints the URL | preview |
| `deploy:prod` | `tools/ci/deploy.ts`: versions upload → 0% + override smoke → 10 → 50 → 100, with health gates and auto-rollback | deploy |
| `deploy:rollback -- <versionId>` | `wrangler rollback <id> --message` | runbook |
| `assets:build` / `assets:verify` / `assets:publish` | KTX + gltf-transform build / checks / rclone upload + HEAD verify + immutable manifest | assets |
| `db:push` | `supabase link` + `db push --dry-run` + `db push` | deploy |
| `auth:tpa` | idempotent Management API Custom OIDC registration | runbook (milestone M13) |

Aliases required by 03-SPEC-TEMPLATE/04-SONNET-KICKOFF: `test → check:unit`, `typecheck → check:types`, `lint → check:lint`, `e2e → check:e2e`, `perf → check:perf`.

### R2. Playwright projects (single `playwright.config.ts`)

```ts
// UNVERIFIED on a GitHub runner until M00 AC-3 passes; measured locally on Ubuntu 24.04 x64 (§4.1)
const SWIFTSHADER_WEBGPU = ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--use-vulkan=swiftshader'];
projects: [
  { name: 'chromium-webgpu', use: { browserName: 'chromium', launchOptions: { args: SWIFTSHADER_WEBGPU } } },          // asserts backend === 'webgpu'
  { name: 'chromium-webgl2', use: { browserName: 'chromium' } },                                                       // no flags → asserts automatic WebGL2 fallback
  { name: 'webkit-webgl2',   use: { browserName: 'webkit' } },                                                         // Safari-engine proxy; asserts !navigator.gpu path
  { name: 'xr-quest3',       use: { browserName: 'chromium' }, grep: /@xr/ },                                          // IWER injected via addInitScript before app boot
]
```

- Serve the build from `vite preview` (Workers runtime through the Vite plugin), or from `wrangler dev`, at `http://localhost`.
- Test-only query flags (dev and test builds only): `?gl=1`, `?tier=`, `?xr-emulate=quest3`, `?perf=1`.
- The agent bridge `window.__dvBridge` (repos-modding P-UM-10) exposes `renderer.backend`, `renderer.info` and frame counters.
- Assert on **state**: backend, frames rendered, objectives, hashes. Pixel goldens only at 128–256 px with tolerance, because SwiftShader differs from real GPUs.
- WebKit screenshots only while the render loop is running.

### R3. `.github/workflows/` layout

All jobs:
- `runs-on: ubuntu-24.04` (pin the label, not `-latest`).
- `permissions: contents: read` unless stated otherwise.
- A `concurrency:` group per ref, with `cancel-in-progress: true` on PR workflows.
- `timeout-minutes` set on every job.
- Actions pinned by SHA (§1.1). Shown below with tag comments for readability.

**ci.yml**: on `pull_request`, `push: main`.
1. `setup`: checkout v7.0.1 (`persist-credentials: false`) → pnpm/action-setup v6.1.0 → setup-node v7.1.0 (`node-version-file: .nvmrc`, `cache: pnpm`) → `pnpm install --frozen-lockfile`.
2. `static` (needs setup): `check:types`, `check:lint`, `check:format`, `check:secrets`, `check:ip`, `check:license`, `check:names`, `check:provenance`, `check:skills`, `check:kb`, `check:do-migrations`.
3. `unit`: `check:unit`, `check:workers`.
4. `build`: `check:build`, `check:bundle`, `check:assets` (manifest-only mode); upload `dist/` with upload-artifact v7.0.2 (retention 3 days).
5. `e2e` (needs build; matrix `project: [chromium-webgpu, chromium-webgl2, webkit-webgl2, xr-quest3]`): download-artifact v8.0.2 → `pnpm exec playwright install --with-deps chromium webkit` (not cached, per Playwright guidance) → `pnpm check:e2e --project ${{ matrix.project }}` + `check:coi`. Upload the HTML report and the probe JSON (`gpu-probe.json`: adapter info, features, limits) on failure **and** on main.
6. `db` (only when `supabase/**` or `packages/shared/src/db*` changed; detect with `git diff --name-only origin/main...HEAD`): setup-cli v3.0.1 → `check:db` → `check:db:types`.
7. `perf` (warn-only on PRs): `check:perf --report`.

**preview.yml**: on `pull_request: [opened, synchronize, reopened, closed]`; `if: github.event.pull_request.head.repo.full_name == github.repository`; `environment: preview`.
1. `preview` (`if: action != 'closed'`; `permissions: contents: read, pull-requests: write, deployments: write`): setup → `pnpm build` (`CLOUDFLARE_ENV=staging`) → `cloudflare/wrangler-action@v4.1.3` with `command: preview --env staging --name pr-${{ github.event.pull_request.number }} --json`, `wranglerVersion: "4.151.1"`, `packageManager: pnpm`, `gitHubToken`.
2. `check:headers -- ${{ steps.preview.outputs.preview-url }}`.
3. `check:smoke -- <url>` on `chromium-webgpu` and `webkit-webgl2`, adding Access service-token headers if Access protects Previews.
4. `gh pr comment --edit-last --create-if-none` with Preview URL, deployment URL and probe summary.
5. `cleanup` (`if: action == 'closed'`): `pnpm exec wrangler preview delete --env staging --name pr-N --skip-confirmation`. When a Supabase branch exists (later), the integration deletes it.

**deploy.yml**: on `push: main` → staging; on `push: tags: ['v*']` or `workflow_dispatch` → production (`environment: production`).
1. `migrate`: setup-cli v3.0.1 → `db:push` (dry run printed to the job summary first). Staging, then prod in the prod run.
2. `upload`: build with `CLOUDFLARE_ENV=<env>` → write `$RUNNER_TEMP/secrets.json` from env secrets → `wrangler versions upload --tag <sha12> --message … --secrets-file …` with `WRANGLER_OUTPUT_FILE_PATH` → parse `version_id`.
   - **If the PR carried `do-lifecycle`:** run `wrangler deploy --secrets-file …` instead, at 100%, with no gradual rollout, and record "rollback floor = this version".
3. `canary`: `wrangler versions deploy NEW@0% OLD@100% -y` → `check:smoke` with `Cloudflare-Workers-Version-Overrides` → `NEW@10% OLD@90%` → wait 10 min while polling a health endpoint and the 5xx rate (Workers analytics GraphQL or Analytics Engine; S09 picks) → `NEW@50%` → `NEW@100%`.
4. `rollback` (`if: failure()`): `wrangler rollback OLD --message "auto"`.
5. Production in v1 single-player can collapse step 3 to 0% smoke and then 100%. Keep the gradual path behind an input `gradual: true`.
6. Required: the version-affinity Transform Rule exists on the zone before the first split (M00 bootstrap runbook, scripted with the Rulesets API).

**assets.yml**: on `push: main` with `paths: [assets/**, tools/asset*/**, world/**]`, plus `workflow_dispatch` (input `env`).
1. `build`: cache the KTX `.deb` (cache v6.1.0, key `ktx-4.4.2-linux-x64`) → `curl -fsSLO …/v4.4.2/KTX-Software-4.4.2-Linux-x86_64.deb` → `sha1sum -c` against `b7d4a0833a5aff570f01f56413e40ea8db291212` → `sudo apt-get install -y ./KTX-…deb` → `ktx --version` → `assets:build` (gltf-transform 4.5.1, meshopt, KTX2) → `assets:verify`.
2. `publish` (`environment: <env>`): install rclone 1.75.2 from `downloads.rclone.org` with the SHA-256 check → remote from `RCLONE_CONFIG_R2_*` env (temporary credentials minted per job, scoped to bucket `tha-bay-media-<env>` and prefix, or the bucket-scoped R2 token) → one `rclone copy --ignore-existing --fast-list --transfers 32 --checkers 32 --s3-no-check-bucket --header-upload "Content-Type: …" --header-upload "Cache-Control: public, max-age=31536000, immutable" --include "<pattern>"` per content class (§2.1) → HEAD-verify a sample → upload `manifests/world-<sha>.json`.
3. `pointer`: open a PR, or commit to an `assets/pointer` branch, that updates `apps/web/public/world-manifest.json`. The next deploy.yml run ships it as part of the Worker version.
4. `purge` (only on overwrite or kill): prefix or URL purge via `POST /zones/:zone/purge_cache` with `CF_API_TOKEN_CACHE`.

**nightly.yml**: `schedule` (cron e.g. `17 10 * * *` UTC) + `workflow_dispatch`.
1. Full e2e matrix including long autoplay missions (gamedesign/repos-world P14).
2. `check:perf` in fail mode.
3. `check:pins` (action SHAs, npm pins, KTX, rclone, Playwright browsers).
4. `macos-probe` (`runs-on: macos-15`, informational, `continue-on-error: true`): Playwright WebKit and Chrome stable `navigator.gpu`/adapter probe → artifact. Optional `macos-15-xlarge` if an org plan exists.
5. Staging keep-alive: one authenticated query to Supabase staging.
6. Stale Preview sweep: list Previews and delete any whose PR is closed.
7. fal endpoint registry liveness (repos-modding rec 19).
8. Cache-header audit on a sample of `media.<domain>` URLs (`CF-Cache-Status`, `Cache-Control`, `Content-Type`, no `Content-Encoding`).

### R4. M00 acceptance criteria (proposal for S13)

1. `pnpm check:all` passes locally and in ci.yml on `ubuntu-24.04`.
2. preview.yml posts a Preview URL. `check:headers` against it shows COOP `same-origin` and COEP `require-corp`, and `check:smoke` reports `crossOriginIsolated === true` in `chromium-webgpu` and `webkit-webgl2`.
3. The e2e artifact `gpu-probe.json` from `chromium-webgpu` on the GitHub runner shows `adapter: true`, `architecture: "swiftshader"`, and a three backend of `webgpu`. `chromium-webgl2` shows backend `webgl2`. This removes the main UNVERIFIED item.
4. `xr-quest3` reports `isPresenting === true` and ≥ 10 XR frames.
5. The one-time bootstrap (`pnpm deploy:bootstrap`: first `wrangler deploy` of each Worker, with an Admin-scoped token held by the operator) runs. After it, `deploy.yml` on main runs `versions upload` → 0% smoke → 100%, and the job summary shows the version id. `versions upload` cannot create a Worker. `deploy:rollback` to the previous id is exercised once (manually triggered) and recorded.
6. No secret values appear in the repo or logs (`check:secrets`). All actions are pinned by SHA.

### R5. Test-device matrix (for `spec/08-test-and-ci.md`; extends stack-rendering-platform rec 18)

| Check | CI (ubuntu, every PR) | Nightly | Pre-release device pass (manual, scripted checklist) |
|---|---|---|---|
| Boot, menus, save/load, missions (state assertions) | Chromium WebGPU (SwiftShader), Chromium WebGL2, WebKit WebGL2 | + long autoplay | — |
| WebGPU backend selected, WGSL/TSL compile, render graph | Chromium + SwiftShader | macOS WebKit/Chrome probe (informational) | Chrome desktop on a real GPU; Safari 26/27 macOS |
| WebGL2 fallback (automatic + `?gl=1`) | Chromium (no flags), WebKit | — | Quest Browser WebGL path |
| `crossOriginIsolated`, SAB workers, SW reload keeps COI | Chromium, WebKit (local + Preview URL) | — | iPhone Safari tab + Home Screen app |
| COOP/COEP/CORP/Cache-Control headers | Preview URL (`curl -I`) | media domain audit | — |
| XR session start/end, input mapping, comfort toggles | IWER `metaQuest3` (WebGL path) | same, longer | **Quest 3/3S** (incl. `XRGPUBinding` flag path), **Vision Pro** |
| CPU-side budgets (draw calls, tris, textures, heap) | warn | fail | — |
| fps / frame time / thermals / memory ceiling | not automatable | — | iPhone 15 and 16/17, Quest 3/3S, Vision Pro, using the `?perf=1` HUD + bridge export |
| iOS Home Screen install, storage persist/eviction, audio session, orientation | not automatable | — | iPhone (manual). BrowserStack real-iOS Playwright optional for Safari-tab regression (WebGPU on it UNVERIFIED) |
| Pose camera (MediaPipe) | video-fixture mode (auth-ugc-input-maps §4.2) | — | real camera on iPhone + desktop |
| Gamepad / touch | synthetic input via bridge | — | real controllers |

Pre-release device runs are scripted: a checklist file per milestone with URLs and expected values. The bridge exports `perf.json`, which an operator uploads as a GitHub release asset. No GUI-only deploy step exists anywhere, so R-ENG-01 holds; only observation on devices is manual.

### R6. Wrangler config rules the spec should state (S09)

- A `previews` block with staging bindings: `MEDIA` → `tha-bay-media-staging`, `FLAGS` → staging KV id, `JOBS` producer → staging queue, `CUTSCENE_WF` → a deployed staging Workflow, `HYPERDRIVE` → staging config, `vars.ENVIRONMENT = "preview"`.
- DO bindings repeated under `previews.durable_objects.bindings`. Alternatively, move DO access to `ctx.exports`.
- `secrets.required: ["SUPABASE_SECRET_KEY", "FAL_KEY", "ANTHROPIC_API_KEY", "PLAY_TOKEN_HMAC", …]`.
- `preview_urls: true` on the staging Worker only. `workers_dev: false` on production once the custom domain is live.
- A test-only route `/api/v1/_test/run-scheduled` and a queue-drain route, both compiled out of production builds, so Previews can exercise cron and queue logic.

### R7. Supabase rules (S09)

- Migrations must run inside a transaction unless explicitly marked. CI lints for `concurrently`, so branching stays an option later.
- Generate types from the local DB in CI; never hand-edit `db.gen.ts`.
- Register Custom OIDC with `pnpm auth:tpa --env <env>` (Management API, PAT with Auth Config RW) at the auth milestone. Never set it through the dashboard, which would be a GUI-only step.

---

## Risks

| ID | Risk | L | I | Mitigation |
|---|---|---|---|---|
| CI-R01 | Workers Previews are open beta (Sep 2026). Commands, JSON shape or limits change | M | M | Pin wrangler 4.151.1; parse `--json` defensively; nightly `check:pins`; fallback `wrangler deploy --env staging` per branch |
| CI-R02 | Preview gaps (no queue consumer, cron, own Workflow; service bindings hit prod) give false confidence | H | M | Staging bindings in `previews`; test-only routes for cron/queue; label results "preview" vs "staging" |
| CI-R03 | A DO lifecycle change ships through a gradual deploy, or a rollback across it is attempted | M | H | `check:do-migrations` + `do-lifecycle` label routes to `wrangler deploy`; record a rollback floor; ship DO class changes alone |
| CI-R04 | Version skew during splits causes 404s on hashed assets and mixed client/API versions | M | M | Version-affinity Transform Rule before the first split; API stays backward compatible for one version; monitor asset 404 rate |
| CI-R05 | The SwiftShader recipe breaks on runners or with a Chromium roll (flags are unstable switches) | M | M | M00 AC-3 probe artifact; nightly probe; WebGL2 project stays green either way; pin Playwright |
| CI-R06 | SwiftShader passes while real GPUs fail (limits, precision, tile memory, Apple Metal) | H | H | Request only needed limits; device pass per milestone; never treat CI perf as fps truth |
| CI-R07 | XR CI covers only the WebGL fallback path; native WebGPU XR (Quest flag, visionOS 26.2) is untested | H | M | Manual Quest/Vision Pro checks; keep `setupWebGLXRFallback` default-on |
| CI-R08 | Long-lived Cloudflare tokens (no OIDC) leak | L | H | Account tokens with TTL; split scopes; environment-scoped secrets; `cfat_` auto-revoke on public leaks; quarterly rotation runbook |
| CI-R09 | The private repo on a personal Free/Pro plan cannot enforce prod reviewers or environment secrets | M | M | Tag-only prod trigger + actor allowlist + branch protection; move to a Team org or public repo (see Q-CI-01) |
| CI-R10 | Bulk uploads through wrangler hit the REST limit (1,200/5 min) or the 300 MiB cap | M | L | rclone S3 path only; wrangler for ≤ 10 objects |
| CI-R11 | KV pointer lag serves a manifest for packs not yet visible, or mixed manifests | M | M | Pointer ships in Worker static assets; objects uploaded and verified before the pointer PR |
| CI-R12 | Gzip-encoded uploads get decompressed and break Range or the expected size | L | M | `check:assets` rejects `Content-Encoding`; packs use in-format compression |
| CI-R13 | macOS/GPU runner costs creep (private repo) | L | L | macOS only in nightly informational jobs; no larger runners without an ADR |
| CI-R14 | Supabase staging on Free pauses; branching cost is outside the spend cap | M | L | Nightly keep-alive; no branching until M12 ADR |
| CI-R15 | Supply-chain compromise of a third-party action | L | H | SHA pins; minimal third-party actions (prefer `gh` and plain `run:` steps); `permissions:` per job |
| CI-R16 | Workers Builds connected by accident leads to double deploys | L | M | M00 runbook asserts Builds is disconnected; deploys only from Actions |

---

## Open questions

- **Q-CI-01:** Is `gratitude5dee/GTA-Tha-Bay` public or private, and on which GitHub plan (personal Free or Pro, or a Team org)? This decides required reviewers, environment secrets, larger or GPU runners, and minute costs.
- **Q-CI-02:** Which zone or custom domain hosts production (`<domain>`), Previews (`preview.<domain>`) and media (`media.<domain>`)? Is the Cloudflare plan Free or Pro? Purge limits and Transform Rules depend on it.
- **Q-CI-03:** Should Preview URLs be public or behind Cloudflare Access? If behind Access, CI needs a service token and a stored secret.
- **Q-CI-04:** pnpm 12.14.0 vs another pinned pnpm major, and Node 24 in `.nvmrc`. S13 should confirm that the toolchain (Vite 8.3.4, wrangler, vitest 5) supports pnpm 12.
- **Q-CI-05:** Should v1 production use gradual percentages (multi-step deploy job), or 0% smoke and then 100% until multiplayer (M12)?
- **Q-CI-06:** Who are the prod approvers, and what does the kill-switch purge runbook need: who holds `CF_API_TOKEN_CACHE`?
- **Q-CI-07:** Is a BrowserStack (or AWS Device Farm) budget approved for a pre-release real-iOS Safari pass, and should a self-hosted runner with a USB Quest 3 be attempted later?
- **Q-CI-08:** A separate Supabase staging project (Free, pauses) or Pro persistent branch for staging? This interacts with S09's region pin `us-west-1`.
- **Q-CI-09:** Is a GPU larger runner (T4, $0.052/min) for real-GPU perf smoke worth an org upgrade, or do device passes cover R-ENG-02?
