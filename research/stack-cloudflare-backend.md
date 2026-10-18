# Backend stack: Cloudflare primitives + Supabase vs Convex decision

S00 research report, dimension `stack-cloudflare-backend`. Checked 2026-10-18 against official documentation (Cloudflare Docs MCP + developers.cloudflare.com, supabase.com/docs via the Supabase docs search tool, docs.convex.dev), plus the npm registry for current package versions. Builds on `research/repos-grand-v.md` (relay pattern card (b)), `research/repos-webport.md` (muguet UDP protocol, P4/P5/P16, COOP/COEP facts) and `research/owner-updates.md` (SF-accurate first; Grand-V logic adopted). Facts already verified in `repos-webport.md` (Workers static-asset 25 MiB/file, `_headers` 100 rules, 512 MB CDN object cache, range behaviour) are re-checked here only where they changed or matter for the backend. Every external fact has a row in **Verified facts**; anything not confirmed is in **Unverified**.

---

## 0. Headline

1. **Rooms belong on Cloudflare Durable Objects, not on Supabase Realtime or Convex.** A DO bills incoming WebSocket messages at 20:1, outgoing messages free, and 128 MB × wall time while the tick runs. That puts a full 16-player 20 Hz room at roughly **$0.014 per room-hour** (≈ $0.0009 per player-hour). The same traffic on Supabase Broadcast costs about **$1.44 per player-hour** (each broadcast = 1 send + 1 per receiver at $2.50/M), and it hits the 2,500 msg/s project cap at about two 8-player rooms. On Convex it costs at least **$0.144 per player-hour** in mutation calls alone, and its nearest region is US East (no US West). That rules both out for movement.
2. **The Grand-V relay protocol maps directly onto one DO per room.** The vocabulary `check/join/welcome/joined/pose/left`, server-assigned ids, build/world agreement, monotonic `seq`, latest-wins coalescing, a token bucket and slow-receiver closes all carry over. The changes are an in-memory `setInterval` 20 Hz tick that runs only while players are connected (never `setAlarm` per tick: each `setAlarm` is a billed SQLite row write), hibernation for idle/AFK rooms and lobby sockets, socket attachments of ≤16 KiB for state that must survive hibernation, SQLite checkpoints every 5 s, and auto-response ping/pong.
3. **Room size is bounded by single-thread throughput, not by sockets.** The docs allow 32,768 hibernatable sockets per DO but quote a soft limit of about 500–1,000 simple requests/s. At 20 Hz in plus 20 Hz out, that means **16 players per room by default, 24–32 only after a load test**, with district/instance sharding and grid interest management inside each room.
4. **Persistence: choose Supabase (default stays), with Convex as the documented alternative.** Reasons: a `us-west-1` (N. California) region next to SF players (Convex has none in the West), Postgres + RLS + pgvector in one store, anonymous sign-in that can be upgraded later via `linkIdentity`/`updateUser`, built-in Web3 (EIP-4361) sign-in for the late Thirdweb milestone, custom OIDC providers on hosted projects (a path for "Sign in with ChatGPT" if OpenAI exposes OIDC), and Hyperdrive from Workers. Persistence costs are similar for both at 1k–100k MAU (≈ $25–$130/month), so cost does not decide it.
5. **Switch cost is about 5–7 builder sessions if (and only if)** the client never talks to the database directly. Every data access must go through a typed `DataPort` behind the Worker API (`/api/v1/*`), with JWT verification in the Worker. If supabase-js calls are allowed to spread through the client, the cost roughly doubles.

---

## 1. Cloudflare primitives (verified 2026-10-18)

### 1.1 Workers + static assets (hosting the SPA/PWA)

- **Pages vs Workers.** Pages is not deprecated, but the Pages landing page carries a banner: "Workers supports most Pages use cases and offers a broader feature set… Start new projects with Workers." `_headers` and `_redirects` are supported natively on Workers static assets. Preview URLs and custom branch aliases exist on both. Branch Deploy Controls are partial on Workers. Custom domains outside Cloudflare zones are Pages-only. **Decision: Workers + static assets, no Pages.** The domain's DNS must be on Cloudflare.
- **SPA config:** `assets.directory = "./dist/"` with `assets.not_found_handling = "single-page-application"`. Unmatched paths return `/index.html` with 200. With a `main` Worker and compatibility date ≥ 2025-04-01, **navigation requests (`Sec-Fetch-Mode: navigate`) skip the Worker** and are served as assets. That cuts billable invocations but means navigating to `/api/x` returns HTML. `run_worker_first: ["/api/*", "!/api/docs/*"]` (Wrangler ≥ 4.20.0 or Vite plugin ≥ 1.7.0) forces the Worker for API paths. OAuth-style callbacks should be a static HTML page that forwards the query string to `/api/...` with `fetch`. That fits the late Thirdweb / ChatGPT sign-in callbacks.
- **Limits (Free / Paid):** CPU per HTTP request 10 ms / 30 s default, configurable to 5 min. Memory 128 MB per isolate on both. Subrequests 50 / 10,000. Request body 100 MB (by zone plan). Worker bundle 64 MiB uncompressed. **Static asset files 20,000 / 100,000 per version, 25 MiB per file.** Cron Triggers 5 / 250 per account. Free has 100,000 requests/day (Error 1027 beyond that). Startup time 1 s. Source page updated 2026-10-12.
- **Pricing:** Paid is $5/month minimum. It includes 10M requests (+$0.30/M) and 30M CPU-ms (+$0.02/M CPU-ms). **Static asset requests are free and unlimited. No egress charges. WebSocket upgrade = 1 request; messages to a plain Worker are not billed.** Source page updated 2026-10-02. Workers Logs: 20M events/month included (+$0.60/M), moving to "Cloudflare Observability pricing" from 2026-12-01.
- **Current tooling versions (npm, 2026-10-18):** `wrangler@4.151.1`, `@cloudflare/vite-plugin@1.64.0`, `@cloudflare/workers-types@5.20261018.1`. Pin exact versions in the spec. A compatibility date of `2026-10-18` or later enables `web_socket_auto_reply_to_close` (≥ 2026-04-07).

### 1.2 Headers, cross-origin isolation, compression, ranges

- `_headers` (in the assets dir): up to 100 rules, 2,000 chars per line, `! Header` removes a header. **It does not apply to Worker-generated responses** (API, SSR, `run_worker_first`), so set the headers in code there too. Default static-asset `Cache-Control: public, max-age=0, must-revalidate` with a file-hash ETag. Fingerprinted paths should be overridden to `public, max-age=31556952, immutable`.
- COOP/COEP is just headers. Ship `/* Cross-Origin-Opener-Policy: same-origin / Cross-Origin-Embedder-Policy: require-corp / Cross-Origin-Resource-Policy: same-origin`, matching the Grand-V/playgta5 set in `repos-grand-v.md` §2(a). **Under `require-corp`, requests made in `cors` mode are not blocked by COEP** (they still need CORS). So R2/fal media on another origin works without CORP headers if the R2 bucket has a CORS policy and the page fetches in CORS mode (`fetch()` default; `<img|video crossorigin>`). `credentialless` support in Safari is not confirmed (see Unverified), so do not rely on it.
- **Compression:** Cloudflare's default-compressed content types include `application/wasm`, `application/javascript`, `application/json`, `text/*`, fonts and `image/svg+xml`. **`model/gltf-binary` and `image/ktx2` are not in that list.** Zstandard can be enabled with a Compression Rule (order zstd → brotli → gzip). **If Cloudflare must decompress an encoded response, it ignores `Range` and returns a full 200.** Rule for the spec: large binary world packs (`.glb`, `.ktx2`, `.pack`) rely on in-format compression (meshopt/Draco, Basis/UASTC with zstd supercompression) and are served `identity`-encoded, so range requests keep working.
- **Ranges:** a single valid range gives 206; 2–300 ascending ranges give a multipart 206 only when Origin Range Requests applies. Workers Caching strips `Range`, caches the full 200 and slices it itself. **A 206 produced by a Worker is never cached.** This repeats `repos-webport.md` P4/P5, re-checked against the cache docs updated 2026-09-14.

### 1.3 Durable Objects (authoritative multiplayer rooms)

**API surface (Hibernation WebSocket API, docs updated 2026-09-30):**
- `ctx.acceptWebSocket(ws, tags?)`: accepts the server socket so the DO can hibernate. Up to 10 tags per socket, 256 chars each. **Maximum 32,768 hibernatable sockets per DO**, though "CPU and memory usage… may further limit" the practical number.
- Handlers: `webSocketMessage(ws, msg: string|ArrayBuffer)`, `webSocketClose(ws, code, reason, wasClean)`, `webSocketError(ws, err)`. Close frames are auto-replied with compat date ≥ 2026-04-07.
- `ws.serializeAttachment(v)` / `deserializeAttachment()`: per-socket structured-clone state that **survives hibernation, max 16,384 bytes**. It is lost on close. Call again after mutating.
- `ctx.getWebSockets(tag?)`, `ctx.getTags(ws)`.
- `ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping","pong"))`: request and response ≤ 2,048 chars each. It answers **without waking the DO and without duration charge**. `ctx.getWebSocketAutoResponseTimestamp(ws)` gives the last auto-response time (use it as a liveness check).
- `ctx.setHibernatableWebSocketEventTimeout(ms)`: max 7 days.
- `ctx.blockConcurrencyWhile(cb)`: 30 s timeout; exceeding it or throwing resets the object.
- `ctx.waitUntil(p)`: keeps the DO alive up to 15 min.
- `ctx.abort(msg, {retryAlarm})`.
- Protocol ping/pong frames are handled automatically and do not interrupt hibernation.
- Docs advice: **batch logical messages into one frame every 50–100 ms or 50–100 messages**, because each frame costs a kernel/JS context switch.
- **Deploying a new version restarts every DO and disconnects all WebSockets.**

**Lifecycle:** the states are active → idle-hibernatable → hibernated, or idle-non-hibernatable → evicted after 70–140 s.
- **Hibernation happens after 10 s idle only if** there are no `setTimeout`/`setInterval` callbacks, no pending I/O or `waitUntil`, no open outbound connection, no standard WebSocket API use, and no in-flight request.
- Alarms, incoming requests and scheduled callbacks prevent hibernation.
- After hibernation the **constructor re-runs** on the next event, so keep it minimal.
- Duration is billed only while active or idle-non-hibernatable.
- Since 2026-06-19, open outbound connections (TCP `connect()`, outbound WS) also prevent eviction.

**Alarms:**
- One alarm per object; `setAlarm(ms)` replaces any existing one.
- `alarm({retryCount, isRetry})` runs at-least-once. On throw it retries with exponential backoff from 2 s, up to 6 retries.
- Multiplex many timers by storing a schedule in SQLite and arming the earliest.
- Wall time per alarm handler: 15 min.
- Do not `setAlarm` in the constructor without checking `getAlarm()`.
- **Each `setAlarm()` counts as one row written.**

**Storage:** SQLite-backed objects are the default and the only option on Free.
- 10 GB per DO (the FAQ says 1 GB on Free; the table says 10 GB; treat Free as 1 GB).
- Unlimited per account on Paid, 5 GB on Free.
- 2 MB max row/string/BLOB; key+value ≤ 2 MB.
- 100 columns per table; 100 KB statement; 100 bound params.
- Full storage gives `SQLITE_FULL` on writes, while reads and deletes keep working.

**Throughput and limits:**
- Each object is single-threaded with a soft limit of "about 1,000 requests per second", described in Rules of DOs as "approximately 500–1,000 requests per second for simple operations".
- Overload errors carry `.overloaded` and say "Too many requests queued / Too much data queued / queued for too long".
- CPU per request/event: 30 s default, up to 5 min.
- Received WS message size: 32 MiB (raised from 1 MiB on 2025-10-31).
- 6 simultaneous outgoing connections.
- Classes: 500 on Paid, 100 on Free.

**Location:**
- A DO is created near its first `get()` request and **does not move afterwards** ("dynamic relocation planned").
- `get(id, { locationHint })` with `wnam | enam | sam | weur | eeur | apac | apac-ne | apac-se | oc | afr | me` is best-effort and only the first `get()` honours it. Cloudflare recommends no hint unless needed.
- Jurisdictions `eu | us | fedramp` are strict; `us` was added 2026-06-26.
- For SF-first rooms created by Bay Area players the default placement is already right. Use `wnam` only when a server-side process (directory, matchmaker) pre-creates rooms.

**Pricing (Paid, monthly):**
- Requests: 1M included, +$0.15/M.
- Duration: 400,000 GB-s included, +$12.50/M GB-s, **billed at 128 MB per object regardless of use**.
- **Incoming WS messages bill 20:1 as requests**, and the connection itself = 1 request. **Outgoing messages and incoming protocol pings are free.** Auto-responses incur no duration.
- SQLite storage: 25B rows read included (+$0.001/M); 50M rows written included (+$1.00/M); 5 GB-month (+$0.20/GB-month). Storage billing started January 2026.
- Free plan: 100,000 requests/day, 13,000 GB-s/day, 5M rows read and 100,000 rows written/day, 5 GB total.
- Cloudflare's own Example 4 (100 DOs × 100 hibernatable sockets, 100 msgs/min/DO, 10 ms handlers) comes to **$20.65/month**.

**Libraries:** `partyserver@0.5.10` (Cloudflare's PartyKit successor) gives room routing and lifecycle hooks over hibernating DOs with `static options = { hibernate: true }`. `partysocket@1.3.0` is a reconnecting client. The repo calls itself a work in progress. **Recommendation: write the room DO directly against `cloudflare:workers`** (about 400 lines) so the protocol is ours and testable. `partysocket` is acceptable on the client.

### 1.4 R2 (assets, cutscenes, UGC archives)

- **Pricing (updated 2026-10-01):**
  - Standard storage $0.015/GB-month; Infrequent Access $0.01/GB-month with $0.01/GB retrieval and a 30-day minimum.
  - Class A $4.50/M (IA $9.00); Class B $0.36/M (IA $0.90).
  - **Egress free.**
  - Free tier (Standard only): 10 GB-month, 1M Class A, 10M Class B.
  - Deletes are free.
  - Class A = Put/Copy/List/multipart ops; Class B = Get/Head.
- **Limits:**
  - Object size 4.995 TiB; **single PUT 5 GiB**; 10,000 multipart parts.
  - 1,000,000 buckets/account; 100 custom domains per bucket.
  - **Concurrent writes to the same key: 1/s (else 429).**
  - Key length 1,024 bytes; metadata 8,192 bytes.
  - `r2.dev` is rate-limited and meant for development only.
- **Presigned URLs:** GET/HEAD/PUT/DELETE (no POST forms). Expiry 1 s – 7 days. **They only work on the S3 endpoint `<ACCOUNT_ID>.r2.cloudflarestorage.com`, not on custom domains.** `ContentType` is part of the signature (a mismatch gives 403). Browser use needs a bucket CORS policy.
- Pattern: UGC upload = Worker issues a 15-min presigned PUT to `ugc/incoming/{uuid}.zip` with a fixed Content-Type and a size limit checked on HEAD after upload. A Queue consumer validates the archive, moves it to `ugc/published/{sha256}.zip` and writes metadata. Public reads come from a custom domain `media.<domain>` with Cache Everything and a CORS policy.

### 1.5 D1, KV, Queues, Workflows, Cron

- **D1** (limits page updated 2026-04-21):
  - DB size 500 MB Free / **10 GB Paid**.
  - 10 / 50,000 DBs per account; 5 GB / 1 TB per account.
  - 50 / 1,000 queries per Worker invocation.
  - 100 KB statements; 2 MB rows; 30 s query time.
  - Pricing: rows read 5M/day Free, 25B/month included Paid (+$0.001/M); rows written 100k/day Free, 50M/month Paid (+$1.00/M); storage 5 GB then $0.75/GB-month.
  - Role here: optional edge-local read models only (e.g. room directory snapshot, feature flags). It is not the system of record.
- **KV:**
  - Free: 100k reads/day, 1k writes/day. Paid: reads 10M included (+$0.50/M), writes 1M (+$5.00/M), storage 1 GB (+$0.50/GB-month).
  - **1 write/s per key**; values ≤ 25 MiB; keys ≤ 512 B; minimum `cacheTtl` 30 s.
  - Role: build manifest pointer (`manifest:current → sha`), cached leaderboards top-N, feature flags.
- **Queues:**
  - 128 KB messages; `sendBatch` ≤ 100 msgs / 256 KB; consumer batch ≤ 100.
  - **5,000 msgs/s per queue**; 100 retries; `delaySeconds` ≤ 24 h; retention ≤ 14 days (24 h on Free); 250 concurrent push consumers.
  - Pricing: Free 10k ops/day; Paid 1M ops/month included then $0.40/M ops (each 64 KB; one delivered message ≈ 3 ops).
  - Role: telemetry fan-in, UGC validation, moderation scans, embedding jobs.
- **Workflows:**
  - Free: 1,024 steps, 10 ms CPU per step. Paid: 10,000 steps (configurable to 25,000), 30 s CPU per step (to 5 min).
  - `step.sleep` ≤ 365 days; step result ≤ 1 MiB; state 100 MB / 1 GB per instance.
  - Concurrency 100 / 50,000 per account; waiting instances don't count.
  - Creation 100/s Free, 300/s per account and 100/s per workflow on Paid.
  - Pricing: 500,000 steps/month included, +$0.80 per 100k.
  - Role: **fal.ai cutscene/asset jobs** (submit → wait for webhook event → copy to R2 → record → notify).
- **Cron Triggers:** 5 (Free) / 250 (Paid) per account; 15 min wall time. Role: nightly anonymous-user cleanup, leaderboard snapshots, R2 orphan sweep.

### 1.6 Workers AI (what it can and cannot do for us)

- Catalog on 2026-10-18:
  - LLMs: `gpt-oss-120b`, `kimi-k2.6`, `glm-5.3`, `deepseek-v4-flash-0731`, `llama-3.3-70b-instruct-fp8-fast`, `qwen3-30b-a3b-fp8`, `llama-3.1-8b-instruct-fp8`, `gemma-4-26b-a4b-it` and others.
  - Safety: `llama-guard-3-8b`.
  - **Text-to-image:** `flux-2-dev`, `flux-2-klein-4b/9b`, `flux-1-schnell`, `lucid-origin`, `phoenix-1.0`, SDXL variants.
  - **TTS:** `aura-2-en/es`, `aura-1`, `melotts`.
  - **ASR:** `nova-3`, `flux` (conversational), `whisper-large-v3-turbo`.
  - **Embeddings:** `bge-m3`, `bge-*-en-v1.5`, `embeddinggemma-300m`, `qwen3-embedding-0.6b`.
  - Vision: `moondream3.1-9B-A2B`, `llava-1.5-7b-hf`.
  - Turn detection: `smart-turn-v2`.
  - **No text-to-video and no 3D models.** Cutscenes and 3D stay on fal.
- Pricing (updated 2026-10-15): $0.011 per 1,000 Neurons; 10,000 Neurons/day free. `llama-3.1-8b-instruct` $0.282/M in, $0.827/M out. `gpt-oss-120b` $0.350/M in, $0.750/M out. `melotts` $0.0002/audio-minute. `aura-2-en` $0.030 per 1k chars. `whisper-large-v3-turbo` $0.0005/audio-minute. `flux-1-schnell` $0.0000528 per 512² tile + $0.0001056 per step.
- Roles: cheap filler-NPC barks (8B model), embeddings for NPC memory (`bge-m3` or `qwen3-embedding-0.6b`), moderation pre-filter (`llama-guard-3-8b`), optional cheap TTS for crowd lines. Hero NPC dialogue stays on Anthropic (dimension `ai-npc-runtime`).

### 1.7 Cloudflare Realtime (voice chat)

- Products: **Realtime SFU** (bring your own signaling; audio, video and DataChannels), **TURN** (anycast; `turn.cloudflare.com` on 3478/udp, 443/udp, 3478/tcp, 80/tcp, 5349/tls, 443/tls), **RealtimeKit** (prebuilt UI/SDKs, recording/transcription), and a **WebSocket adapter** (PCM audio between SFU and a WebSocket service).
- **Pricing (updated 2026-09-22): $0.05/GB egress from Cloudflare; first 1,000 GB/month free, shared by SFU and TURN.** TURN is free when used with the SFU. STUN at `stun.cloudflare.com` is free and unlimited. Ingress is free.
- Role: proximity/party voice in multiplayer rooms. The room DO does signaling (it relays SFU session/track ids over the existing WebSocket). The DO cannot terminate WebRTC itself, so **unreliable DataChannel transport for game state to the DO is not available**; game state stays on the WebSocket (see Risks).

### 1.8 Containers

- Paid only. Instance types (vCPU / memory / disk): lite 1/16 / 256 MiB / 2 GB; basic 1/4 / 1 GiB / 4 GB; standard-1 1/2 / 4 GiB / 8 GB; standard-2 1 / 6 GiB / 12 GB; standard-3 2 / 8 GiB / 16 GB; standard-4 4 / 12 GiB / 20 GB. Custom types allow 1–4 vCPU, ≥ 3 GiB per vCPU, ≤ 20 GB disk (no disk:memory ratio since 2026-09-29).
- Billing every 10 ms of activity. Included: 25 GiB-hours memory, 375 vCPU-minutes, 200 GB-hours disk. Overage: memory $0.0000025/GiB-s, CPU $0.000020/vCPU-s (**active usage only**), disk $0.00000007/GB-s. Egress $0.025/GB in NA/EU (1 TB included). Account concurrency 6 TiB memory / 1,500 vCPU.
- Role: **not needed in v1**. Candidate uses later: headless Blender/gltf-transform asset processing for user-uploaded NPC meshes, or a Node build sandbox for "publish an experience" validation. Not for game servers, because DOs suffice.

### 1.9 Hyperdrive (Workers → Supabase Postgres)

- Pooled, cached connections from Workers to any Postgres. Transaction-mode pooling, so `SET` lasts only for a query/transaction. Named prepared statements are supported for `postgres.js` and `node-postgres`.
- Origin connections per config: about 20 (Free) / about 100 (Paid), soft limit, minimum 5. Free plan has 100,000 queries/day; Paid is unlimited.
- Docs pattern: `postgres(env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false, prepare: true })` per request.
- Keep Hyperdrive `max_size` well under the Supabase compute's direct-connection budget (Micro/Nano 60, Small 90, Medium 120).

### 1.10 Analytics Engine, rate limiting, observability

- **Workers Analytics Engine:** Paid includes 10M data points written/month (+$0.25/M) and 1M read queries (+$1.00/M). Free has 100k points and 10k queries per day. **"Currently, you will not be billed."** Use it for gameplay telemetry (fps, tier, load timings, room tick p99, crash beacons).
- **Rate Limiting binding:** `simple { limit, period: 10|60 }`, `env.RL.limit({ key }) → { success }`. Counters are **per Cloudflare location and eventually consistent**, so they suit abuse throttling but not exact accounting. Requires Wrangler ≥ 4.36.0. Exact per-socket limits inside rooms stay in the DO (token bucket).

### 1.11 Free vs Paid at a glance (what the single-player launch can run on)

| Primitive | Free | Paid ($5/mo base) |
|---|---|---|
| Workers | 100k req/day, 10 ms CPU | 10M req + 30M CPU-ms/mo; 30 s–5 min CPU |
| Static assets | free, 20k files, 25 MiB/file | free, 100k files |
| Durable Objects | SQLite only; 100k req/day; 13k GB-s/day; 5 GB | 1M req, 400k GB-s, 5 GB-mo included |
| R2 | 10 GB-mo, 1M A, 10M B | same free tier, then usage |
| D1 | 500 MB/DB, 5M reads/100k writes per day | 10 GB/DB, 25B reads/50M writes/mo |
| KV | 100k reads/1k writes per day | 10M reads/1M writes/mo |
| Queues | 10k ops/day, 24 h retention | 1M ops/mo, 14 d retention |
| Workflows | 1,024 steps, 10 ms CPU/step | 500k steps/mo, 30 s CPU/step |
| Workers AI | 10k Neurons/day | $0.011/1k Neurons |
| Realtime SFU/TURN | 1,000 GB/mo | $0.05/GB after |
| Containers | n/a | 25 GiB-h, 375 vCPU-min included |

**Recommendation:** start on Workers Paid from M00. Free-plan CPU of 10 ms per request and 1,024 Workflow steps would distort test results, and the base fee is $5.

---

## 2. Supabase (verified 2026-10-18)

- **Plans** (pricing page): Free $0, Pro from $25, Team from $599.
  - **MAU:** 50,000 (Free) / 100,000 (Pro, Team), then $0.00325/MAU. Third-party MAU same quota and price. Anonymous sign-ins included.
  - **DB size:** 500 MB Free; 8 GB per project on Pro, then $0.125/GB.
  - **Egress:** 5 GB Free; 250 GB on Pro, then $0.09/GB (cached $0.03/GB).
  - **File storage:** 1 GB Free; 100 GB on Pro, then $0.0213/GB.
  - **Realtime:** peak connections 200 / 500, then **$10 per 1,000**; messages 2M / 5M, then **$2.50 per million**.
  - **Edge Function invocations:** 500k / 2M, then $2/M.
  - Pro includes **$10/month compute credit (one Micro)**.
  - **Free projects pause after 1 week of inactivity**; max 2 active free projects.
  - Log retention 1 / 7 / 28 days; daily backups none (Free) / 7 d (Pro) / 14 d (Team).
- **Compute** (direct / pooler connections): Nano $0 (shared, ≤ 0.5 GB, 60/200; Free plan); Micro ≈ $10/mo (1 GB, 60/200); Small ≈ $15 (2 GB, 90/400); Medium ≈ $60 (4 GB, 120/600); Large ≈ $110 (2 dedicated vCPU, 8 GB, 160/800); XL ≈ $210; 2XL ≈ $410.
- **Regions:** 17 AWS regions including **`us-west-1` West US (North California)** and `us-west-2` Oregon. "General" regions do not guarantee West US, so pin `us-west-1` explicitly.
- **Realtime limits** (Free / Pro / Pro without spend cap and Team):
  - Concurrent connections 200 / 500 / 10,000.
  - **Messages per second 100 / 500 / 2,500.**
  - Channel joins/s 100 / 500 / 2,500; 100 channels per connection.
  - Presence: 10 keys per object; presence msgs/s 20 / 50 / 1,000; 5 presence calls per client per 30 s.
  - Broadcast payload 256 KB (Free) / 3,000 KB (paid); Postgres Changes payload 1,024 KB.
  - Broadcast replay retention 72 h, 25 messages per request.
- **Realtime billing rule:** "Each broadcast message counts as one message sent plus one message per subscribed client that receives it." Each DB change counts once per listening client. Packages are rounded up to the next million.
- **Realtime performance** (vendor benchmarks, undated): Broadcast at 32,000 users / 224,000 msgs/s gave median 6 ms, p95 28 ms, p99 213 ms. With RLS-authorized channels at 50,000 users: median 19 ms, p95 49 ms. Postgres Changes with RLS is far slower (about 3,000 msgs/s, p95 228–920 ms), so **Broadcast or `realtime.broadcast_changes` triggers are preferred over Postgres Changes.**
- **Realtime Authorization:** private channels (`config: { private: true }`) authorised by RLS policies on `realtime.messages`, using `realtime.topic()` and `extension in ('broadcast','presence')`. Policies are cached per connection and refreshed on a new JWT; the client is disconnected when the JWT expires. Topic naming convention: `scope:id:entity` (e.g. `forum:thread:123`).
- **Edge Functions (Deno):** 256 MB memory; wall clock **150 s Free / 400 s paid**; **2 s CPU per request**; 150 s idle timeout; bundle 20 MB (CLI) or 5 MB (server-side); 100 / 1,000 / 2,000 functions per project; 100 secrets ≤ 48 KiB; ports 25/587 blocked. **We do not need Edge Functions.** Workers do this job with better limits and sit next to the DOs.
- **Auth:**
  - **Anonymous sign-ins** (`signInAnonymously()`) give a real user with the `authenticated` role and an `is_anonymous` JWT claim. Convert to a permanent user via `updateUser({ email })` or `linkIdentity({ provider })` (manual linking must be enabled).
  - IP rate limit **30 anonymous sign-ins/hour by default**. CAPTCHA/Turnstile is strongly recommended. There is **no automatic cleanup**, so a cron SQL deletes old anonymous users.
  - **Web3 sign-in** (Ethereum and Solana via EIP-4361): `signInWithWeb3({ chain: 'ethereum', statement })` or `{ message, signature }`. Signatures must be fresh (≤ 10 min) and redirect URLs registered.
  - **Third-party auth** has first-class support for Clerk, Firebase Auth, Auth0, AWS Cognito and WorkOS only (asymmetric JWTs with `kid`). Thirdweb is not listed.
  - **Custom OAuth/OIDC providers** on hosted projects: `custom:<id>`; Free up to 3, Pro unlimited. OIDC needs only an issuer URL (discovery + JWKS).
  - **New projects use asymmetric JWT signing keys by default**; `getClaims()` verifies locally against `/.well-known/jwks.json`. A Worker can therefore verify Supabase access tokens with WebCrypto/`jose` and no network call.
- **Keys:** legacy `anon`/`service_role` keys "will work until the end of 2026". Use **`sb_publishable_…` and `sb_secret_…`** from day one.
- **Storage:** max file 50 MB on Free, up to **500 GB on Pro/Team**. We store binaries in R2 anyway (free egress, same CDN), so Supabase Storage is unused.
- **pgvector** is available (enable from Dashboard → Extensions); HNSW and IVFFlat are mentioned. Use it for NPC memory.
- **SDK:** `@supabase/supabase-js@2.118.0` (npm, 2026-10-15).

---

## 3. Convex (verified 2026-10-18)

- **Execution limits:** queries/mutations 1 s of user code (DB time excluded). Convex-runtime actions 30 min; Node actions 10 min. Args/returns 16 MiB (Node actions 5 MiB). HTTP action responses 100 MiB. Scheduled-function args 4 MiB each and 16 MiB total per mutation.
- **Per-transaction limits:** 16 MiB read, 16 MiB written, 32,000 documents scanned, 16,000 written, 4,096 index ranges.
- **Concurrency by deployment class (S16 / S256 / D1024 / D2048):** queries 16 / 256 / 1,024 / 2,048; mutations 16 / 256 / 512 / 1,024; actions 64 / 512 / 1,024 / 2,048; scheduled jobs 8 / 256 / 512 / 1,024; mutation write throughput 4 / 8 / 32 / 64 MiB.
- **Scheduling:** 1,000 functions scheduled per mutation; 1,000,000 outstanding.
- **Database:** 10,000 tables; 32 indexes per table; 1 MiB documents; 8,192-element arrays; dataset up to 1–8 TB by class.
- **Vector search:** 4 vector indexes per table, 2–4,096 dims, ≤ 256 results (default 10).
- **Concurrency is OCC:** a mutation's read set must be unchanged at commit, otherwise Convex retries automatically (serializable).
- **Usage pricing (limits page):**
  - **Free:** 1M function calls hard cap; 20 GB-h action compute; 0.5 GB DB; 1 GB DB I/O; 1 GB files / 1 GB egress; **1,000 concurrent sessions (S16)**.
  - **Starter:** same allowances, but usage-based beyond them ($2.20 per extra 1M calls, $0.22/GB I/O, …).
  - **Professional:** 25M calls included (+$2/M); 250 GB-h actions (+$0.30/GB-h); 50 GB DB (+$0.20/GB-mo); 50 GB I/O (+$0.20/GB); 100 GB files (+$0.03/GB-mo); 50 GB egress (+$0.12/GB); 1 GB search storage; **10,000 concurrent sessions (S256)**.
  - Business/Enterprise: dedicated classes up to 200,000 sessions.
  - Non-US regions cost **1.3×**.
- **Seat pricing:** Professional is **$25 per developer per month**, 1–20 developers. Business/Enterprise has a $2,500/month minimum. Both figures come from secondary sources only (official page not machine-readable), so confidence is medium.
- **Regions:** `aws-us-east-1` (standard), `aws-eu-west-1`, `aws-ap-southeast-2`, `aws-ca-central-1` (+30% each). **No US West region.** A deployment's region cannot change; moving requires export/import.
- **Auth:** `customJwt` provider (`issuer`, `jwks`, `applicationID` = `aud`, **RS256 or ES256 only**). Tokens need `kid/alg/typ` and `sub/iss/exp`. Clerk-style integrations exist.
- **Self-hosting:** FSL-Apache-2.0 ("fair source"; each release becomes Apache-2.0 after 2 years; no competing hosted service). Docker Compose backend on port 3210 (HTTP actions 3211) plus dashboard on 6791. SQLite by default, Postgres/MySQL optional, S3 storage optional. Guides exist for Fly.io and Railway.
- **Presence and realtime:**
  - `@convex-dev/presence@0.4.0` sends room updates only on join/leave, with a heartbeat hook.
  - A community "multiplayer cursors" component batches position writes to at most one per 200 ms and renders about 260 ms behind for interpolation.
  - An informal Convex staff measurement put cursor propagation from SF to us-east at about 117 ms p50 / 133 ms p99 (medium-low confidence).
  - **No documented fixed-tick game-loop pattern.**
- **SDK:** `convex@1.47.0` (npm, 2026-10-15).

---

## 4. Mapping the 20 Hz relay-room protocol onto one Durable Object per room

### 4.1 Source protocols (from local research)

**Grand-V relay** (`repos-grand-v.md` §2(b), `src/relay.rs`):
- WebSocket text JSON frames of ≤ 2,048 bytes.
- First message within 5 s: `{type:"check"|"join", protocol:1, key, room, build, map}`.
- Validation: room `[A-Za-z0-9_-]{1,32}`; build ≤ 96 chars; map in an allowlist; an existing room must match build/map; capacity 2.
- `check` → `{type:"checked", players, capacity}`, then close 1000. **A pre-check does not reserve a slot.**
- `join` → server-assigned 16-hex id, `{type:"welcome", protocol:1, id, peers, hz:20}`. Others receive `joined` / `left`.
- `pose {seq ≤ 2^31-1, model u32, position[3] |v| ≤ 20000, rotation[3] |v| ≤ 360}`. The **server overwrites `id`** and **drops non-monotonic `seq`**.
- **Token bucket 30 burst / 25 per s**, closing with 1008 on violation.
- **Coalesce latest pose per sender.**
- Bounded queue (32): overflow closes with 1013 "Receiver too slow"; a 2 s send timeout closes with 1013 "Receiver stalled".
- Ping every 20 s; a missing pong closes with 1008.
- 64 sessions per host. No authority, persistence or chat.

**muguet UDP** (`repos-webport.md` §3.7):
- 105-byte fixed `STATE` snapshot at 30 Hz.
- `REL` seq/ack reliable layer: resend every 150 ms for up to 4 s, 256-entry dedupe window.
- Per-peer clock offset (min gap over 90 packets) with p90-jitter adaptive delay, clamped 45–300 ms. Extrapolate ≤ 250 ms.
- Lowest-id ownership of shared traffic within `SHARE_NEAR` 150 m / `SHARE_FAR` 220 m hysteresis.
- 5 s timeout, 2 s keepalive.

### 4.2 Message and behaviour mapping (protocol v2)

| Relay concept | DO-per-room implementation | Notes |
|---|---|---|
| `check` (no slot reserved) | `GET /api/v1/rooms/:roomId` → Worker → `stub.check()` RPC returns `{players, capacity, world, build}` | RPC = 1 request; no socket; keeps "pre-check doesn't reserve" |
| shared access `key` | Worker verifies a **session JWT** (Supabase anon/permanent access token via JWKS, or our own HMAC "play token" before Supabase is wired) **before** forwarding the upgrade | Docs: validate upgrades in the Worker to avoid billing the DO for junk |
| `room`, `build`, `map` agreement | Room name `room:{worldVersion}:{instance}`; Worker rejects with **4002 build mismatch** if client `build` ≠ the room's `build` (stored in DO SQLite on first join) | Also forces the PWA update flow after deploys |
| capacity 2 | `CAP = 16` default (configurable 8–32), checked synchronously in `fetch()` before `acceptWebSocket`; 409 / close **4003 room full** | Single-threaded DO makes check+accept atomic |
| server-assigned 16-hex id | `crypto.getRandomValues` → 16-hex `pid`, plus a room-local `u16 slot` for binary frames; stored in `serializeAttachment` | Attachments survive hibernation (≤ 16 KiB) |
| `welcome {protocol, id, peers, hz:20}` | `welcome {protocol:2, id, slot, peers[], hz:20, tick, serverTimeMs, cellSize, interestR}` | Adds clock seed for muguet-style offset estimation |
| `joined` / `left` | Same, sent as reliable events (`ev`) to sockets whose interest set contains the player | `left` from `webSocketClose`/`webSocketError` |
| `pose` (client-authoritative) | **Phase M12a "relay":** `in` frame carries the input bits **and** a claimed pose; server bounds-checks (finite, speed ≤ class cap, inside SF bounds), drops non-monotonic `seq`, overwrites ids. **Phase M12b "authoritative":** server integrates inputs with shared kinematic code and returns `ackSeq` for client reconciliation | Same wire frame; the authority flag flips per room |
| coalesce latest per sender | `latest: Map<slot, PlayerState>`; the tick builds each recipient's snapshot from `latest`, so stale poses can never queue | Coalescing comes from the tick model |
| bounded queue → 1013 "too slow" | Workers `ws.send` exposes no backpressure (Unverified). Clients **ack the last snapshot tick** every 250 ms; if `tick − lastAck > 40` (2 s) close **1013**; if `> 10`, drop to every-other-tick for that client | Replaces the mpsc(32) bound |
| 2 s send timeout | Same 2 s threshold via ack lag | |
| token bucket 30 / 25 per s | Per-socket bucket in memory: **40 burst / 30 per s** (20 Hz input + events); violation closes **1008** | Rebuild buckets lazily after hibernation |
| ≤ 2,048-byte frames | App caps: client frames ≤ 2 KiB (drop and count), server snapshots ≤ 16 KiB | Platform allows 32 MiB received |
| ping every 20 s | `setWebSocketAutoResponse("ping"→"pong")` (no wake, no duration); liveness = `getWebSocketAutoResponseTimestamp(ws)` checked in the tick; > 30 s → close 1001 | Protocol pings are also automatic |
| muguet `REL`/`ACK` | WebSocket is already reliable and ordered, so `ev` frames carry `evSeq` only for **resume after reconnect** (server keeps the last 256 events per player for 15 s) | No resend timers needed |
| muguet clock offset + adaptive delay | Client keeps the muguet algorithm unchanged (min gap over 90 snapshots, p90 jitter, clamp 45–300 ms, extrapolate ≤ 250 ms, snap on vehicle enter/exit) | Pure TS, re-implemented (muguet is GPL) |
| muguet lowest-id traffic ownership | Not needed inside a DO room: **the DO owns shared ambient traffic** (spawns seeded by `tick` + cell), clients simulate it locally from seed and the DO only syncs "interacted" vehicles | Removes host-migration bugs |
| 64 sessions per host | Many DOs; a `DirectoryDO` per `{world}:{district}` lists rooms and occupancy and assigns players | Rooms report occupancy on join/leave only |

### 4.3 Lifecycle

1. **Matchmake:** `POST /api/v1/rooms/assign {district}`. The Worker calls `DirectoryDO(world:district).assign()`, which returns the first room with `players < CAP` or mints `room:{world}:{district}:{n+1}`. Pre-created rooms are created with `locationHint: "wnam"` (SF-first). Rooms created by a player's own join need no hint.
2. **Join:** WebSocket upgrade to `/api/v1/rooms/:roomId/ws?build=…&token=…`. The Worker verifies the token, build and rate limit (`RL.limit({key: pid})`), then `stub.fetch(req)`.
   - The DO runs `acceptWebSocket(server, ["p:"+pid])`, then `serializeAttachment({pid, slot, name, model, joinedAt, lastSeq:-1})`.
   - It sends `welcome`, emits `joined` to interested peers, calls `startTick()` and notifies the directory.
3. **Active:** `setInterval(step, 50)` runs while `getWebSockets().length > 0`. This deliberately prevents hibernation, and duration is billed at 128 MB × wall time (≈ 450 GB-s per room-hour ≈ $0.0056).
4. **AFK:** if no input arrives from any socket for 60 s (all players paused or in menus), `clearInterval`. With no timers the DO becomes hibernatable and **hibernates after 10 s**. Sockets stay connected, auto-ping keeps them alive at no cost, and the next `in` frame wakes the DO: the constructor rebuilds `slot → ws` from `getWebSockets()` + `deserializeAttachment()`, restores the world checkpoint from SQLite in `blockConcurrencyWhile`, and restarts the tick.
5. **Leave:** `webSocketClose` removes the player and emits `left`. When the last player leaves: `clearInterval`, write the final checkpoint, `setAlarm(now + 10 min)`, and notify the directory.
6. **GC:** `alarm()` deletes room storage (`deleteAll()`) if the room is still empty, then tells the directory to forget the room. Otherwise it processes due world events from the SQLite `schedule` table and re-arms for the next one.
7. **Deploy:** "Deploying a new version restarts every DO and disconnects all WebSockets."
   - Clients reconnect with jittered backoff (250 ms → 4 s) and a **resume token** (HMAC over `{roomId, pid, slot, exp: +60 s}`, issued in `welcome` and refreshed every 30 s). Resuming restores the same `pid/slot`.
   - World state comes back from the latest 5 s checkpoint.
   - If the build changed, the Worker answers 4002 and the client runs the PWA update flow.

### 4.4 Tick: why `setInterval`, not alarms

- An alarm-driven 20 Hz tick would cost 72,000 `setAlarm` row writes per room-hour, about $0.072 per room-hour at $1/M rows. That is about 13× the duration cost of an in-memory interval. Alarms also block hibernation, so they buy nothing, and the docs give no sub-second granularity guarantee.
- **Use alarms only for low-frequency work:** empty-room GC, scheduled world events (police sweeps, timed races) multiplexed through one alarm, and a 60 s safety checkpoint while players are present. That last one is redundant with the tick, but it protects against a stuck interval.
- `step()` budget: **≤ 10 ms p99 per tick at 16 players**, measured and exported to Analytics Engine as `room_tick_ms`. Order of work:
  1. Drain buffered inputs.
  2. Integrate or validate.
  3. Resolve interactions (hits, pickups, vehicle entry) authoritatively.
  4. Run interest management.
  5. Encode one binary snapshot per recipient.
  6. `ws.send`.

### 4.5 Wire format and snapshot

- **Binary `ArrayBuffer` frames, little-endian.** JSON is allowed only for `welcome` and admin frames. The Grand-V caveat applies: 20 Hz JSON is fine for 2–8 players, not for a city.
- **Client → server `IN` (type 1, ~32 B at 20 Hz):**
  - Header: `u8 type, u8 flags, u16 seq, u32 clientTimeMs`.
  - Input: `i8 moveX, i8 moveY, u16 yaw, i16 pitch, u16 buttons, i8 throttle, i8 steer, i8 brake, u8 pad`.
  - M12a only: claimed pose `f32 x, f32 y, f32 z`.
  - Mobile may send at 10 Hz with two input samples per frame. Batching reduces DO context switches, as the docs advise.
- **Server → client `SNAP` (type 2):**
  - Header (12 B): `u8 type, u8 flags, u16 count, u32 tick, u32 serverTimeMs`.
  - Then `u16 ackSeq` for the recipient.
  - Then `count ×` entity record (28 B): `u16 slot, u8 kind (ped|vehicle|npc), u8 flags (IN_VEHICLE|DEAD|AIMING|RAGDOLL|ENTERING – muguet set), f32 x, f32 y, f32 z (ENU metres, SF origin), u16 yaw, i16 vx, vy, vz (cm/s), u8 anim, u8 seat, u16 vehicleSlot`.
  - 16 entities ≈ 12 + 2 + 448 = 462 B per snapshot, ≈ 9.2 KB/s (74 kbps) downstream per player at 20 Hz.
  - **Delta compression against the last acked snapshot** is a later optimisation (M12c), not a v1 requirement.
- **Reliable `EV` (type 3):** `u16 evSeq, u8 kind, payload` for joined/left, hit, kill feed, mission state, chat (≤ 280 chars, server-moderated), voice signaling (SFU session/track ids).
- **Appearance:** muguet `LOOK`/`VLOOK` equivalents are sent as `EV` on join and on change, not periodically, since the WebSocket is reliable.
- **Room checkpoint** (DO SQLite, every 5 s while active, plus on empty): one row `checkpoint(id=1, tick, blob)` holding world-event state, mission instance state and dropped items. That is ≈ 720 rows written per room-hour, which is negligible.
- **Player progression** (cash, unlocks) is **not** written from the tick. The Worker/DO writes it to Supabase at mission boundaries and on leave, through `DataPort.progress.commit()` with idempotency keys.

### 4.6 Interest management (SF-first)

- SF city and county is about 11 km × 11 km of land, matching R-MAP-01 in `owner-updates.md`. Keep a **uniform spatial hash with 64 m cells** in ENU metres from the world origin defined by `repos-world.md`.
- **Interest radius: 150 m on foot, 300 m in vehicles, with +70 m exit hysteresis** (muguet's 150/220 m idea).
- **Priority bands:** inside 50 m every tick (20 Hz), 50–150 m every 2nd tick (10 Hz), beyond that every 4th tick (5 Hz). Always include the player's own vehicle occupants and current mission participants.
- Store the cell per socket in memory, not in tags: tags are set at accept time. Recompute on each accepted input.
- **Sharding:**
  - v1: one room = one SF instance of ≤ 16 players covering the whole city, with interest culling inside.
  - Later: district rooms (Mission, SoMa, Tenderloin, Haight, Chinatown, Marina, Hunters Point) with a 150 m border overlap and a server-issued `handoff {roomId, resumeToken}`. The client opens the new socket before closing the old one.
  - Bridges remain portals to future Bay districts (East Bay/Peninsula backdrop in v1, per `owner-updates.md`).

### 4.7 Limits and room-size math

| Quantity | Value | Source |
|---|---|---|
| Hibernatable sockets per DO | 32,768 (practically lower) | DO State API |
| Soft throughput per DO | ~500–1,000 simple req/s | Rules of DOs / limits FAQ |
| Inbound at 20 Hz × N | N=16 → 320/s; N=24 → 480/s; N=32 → 640/s | derived |
| Outbound sends per s | 20 × N (16 → 320/s) | derived |
| Per-event CPU limit | 30 s default (5 min max) | DO limits |
| Isolate memory | 128 MB (Workers); DO memory limit not stated | Workers limits |
| Storage per DO | 10 GB (Free: 1 GB per FAQ) | DO limits |
| Row/BLOB max | 2 MB | DO limits |
| Attachment per socket | 16,384 B | WebSocket API |
| Auto-response pair | ≤ 2,048 chars each | State API |
| Received WS message | 32 MiB | DO limits / changelog |

**Decision:**
- `CAP = 16` default, `CAP_MAX = 32` behind a config flag.
- Raise the cap only when a load test (k6 or Artillery WebSocket scenario, bots at 20 Hz from at least 2 PoPs) shows tick p99 ≤ 10 ms, zero overload errors, and snapshot jitter p95 ≤ 15 ms for 30 minutes.
- Mobile clients may send inputs at 10 Hz (two samples per frame), which halves inbound load.

**Cost per full 16-player room-hour:**
- Duration: 0.125 GB × 3,600 s = 450 GB-s → $0.0056.
- Inbound messages: 16 × 72,000 / 20 = 57,600 billable requests → $0.0086.
- Total **≈ $0.014 per room-hour** (≈ $0.0009 per player-hour); outbound is free.

### 4.8 Failure modes

| Failure | Handling |
|---|---|
| Deploy restart | Reconnect with resume token; 5 s checkpoint; build check → PWA update |
| Overload error | Worker sees `.overloaded`, does not retry into the same DO, and asks the directory for another room; the DO sheds by halving far-band rates |
| Slow mobile receiver | Ack-lag degrade (every-other-tick) then 1013 close at 2 s lag |
| Hibernation wake | Constructor + `blockConcurrencyWhile` restore from `getWebSockets()` attachments and SQLite; never assume in-memory state survived |
| Alarm handler throws | ≤ 6 retries with backoff from 2 s; catch inside and re-arm explicitly |
| Clock skew | Server time in every snapshot header; client uses the muguet min-offset estimator |
| Cheating in M12a | Bounds and speed checks, server-owned interactions, rate limits; authoritative movement in M12b |
| Head-of-line blocking (TCP) | Small frames; latest-wins snapshots; client extrapolates ≤ 250 ms; no unreliable channel to the DO exists (see Risks) |

### 4.9 Room DO skeleton (TypeScript, illustrative)

```ts
// apps/edge/src/rooms/RoomDO.ts  (wrangler: new_sqlite_classes = ["RoomDO","DirectoryDO","CutsceneJobDO"])
import { DurableObject } from "cloudflare:workers";
type Att = { pid: string; slot: number; name: string; joinedAt: number; lastSeq: number };
const HZ = 20, TICK_MS = 1000 / HZ, CAP = 16, AFK_MS = 60_000, CHECKPOINT_TICKS = 100;

export class RoomDO extends DurableObject<Env> {
  private bySlot = new Map<number, WebSocket>();
  private latest = new Map<number, PlayerState>();   // coalesced latest input/state per slot
  private lastAck = new Map<number, number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private tick = 0; private lastInputAt = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS checkpoint(id INTEGER PRIMARY KEY, tick INTEGER, blob BLOB)");
      ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS schedule(at INTEGER, kind TEXT, payload TEXT)");
      for (const ws of ctx.getWebSockets()) {               // rebuild after hibernation
        const a = ws.deserializeAttachment() as Att | null;
        if (a) this.bySlot.set(a.slot, ws);
      }
      // restore world state from checkpoint row if present (omitted)
    });
  }

  async check() { return { players: this.ctx.getWebSockets().length, capacity: CAP }; }   // RPC, reserves nothing

  async fetch(req: Request): Promise<Response> {             // Worker already verified token + build
    if (this.ctx.getWebSockets().length >= CAP) return new Response("room full", { status: 409 });
    const [client, server] = Object.values(new WebSocketPair());
    const pid = hex16(), slot = this.freeSlot();
    this.ctx.acceptWebSocket(server, [`p:${pid}`]);
    server.serializeAttachment({ pid, slot, name: req.headers.get("x-player-name") ?? "", joinedAt: Date.now(), lastSeq: -1 } satisfies Att);
    this.bySlot.set(slot, server);
    server.send(JSON.stringify({ t: "welcome", protocol: 2, id: pid, slot, hz: HZ, tick: this.tick, serverTimeMs: Date.now(), peers: this.peerList() }));
    this.emitEvent({ t: "joined", id: pid, slot }, slot);
    this.startTick();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, msg: ArrayBuffer | string) {
    if (typeof msg === "string" || msg.byteLength > 2048) return this.strike(ws);    // binary only, size cap
    const a = ws.deserializeAttachment() as Att;
    if (!this.bucketTake(a.slot)) return ws.close(1008, "Message rate exceeded");
    const f = decodeIn(msg);
    if (f.kind === "ack") { this.lastAck.set(a.slot, f.tick); return; }
    if (f.seq <= a.lastSeq && !seqWrapped(f.seq, a.lastSeq)) return;                  // drop non-monotonic
    a.lastSeq = f.seq; ws.serializeAttachment(a);
    this.latest.set(a.slot, applyInput(this.latest.get(a.slot), f));                  // coalesce latest
    this.lastInputAt = Date.now();
    this.startTick();                                                                  // wake from AFK
  }

  async webSocketClose(ws: WebSocket) { this.drop(ws); }
  async webSocketError(ws: WebSocket) { this.drop(ws); }

  private startTick() { if (!this.timer) this.timer = setInterval(() => this.step(), TICK_MS); }
  private stopTick() { if (this.timer) { clearInterval(this.timer); this.timer = null; } }

  private step() {
    this.tick++;
    if (Date.now() - this.lastInputAt > AFK_MS) { this.checkpoint(); return this.stopTick(); }  // allow hibernation
    simulateOrValidate(this.latest, TICK_MS);                    // M12a: validate claims; M12b: integrate inputs
    for (const [slot, ws] of this.bySlot) {
      const lag = this.tick - (this.lastAck.get(slot) ?? this.tick);
      if (lag > 40) { ws.close(1013, "Receiver too slow"); continue; }
      if (lag > 10 && this.tick % 2) continue;                   // degrade slow receivers
      ws.send(encodeSnap(this.tick, Date.now(), interestSet(slot, this.latest, this.tick)));
    }
    if (this.tick % CHECKPOINT_TICKS === 0) this.checkpoint();   // every 5 s
  }

  private drop(ws: WebSocket) {
    const a = ws.deserializeAttachment() as Att | null; if (!a) return;
    this.bySlot.delete(a.slot); this.latest.delete(a.slot); this.lastAck.delete(a.slot);
    this.emitEvent({ t: "left", id: a.pid, slot: a.slot }, a.slot);
    if (this.ctx.getWebSockets().length === 0) {
      this.stopTick(); this.checkpoint();
      this.ctx.storage.setAlarm(Date.now() + 10 * 60_000);       // empty-room GC
    }
  }

  async alarm() {
    if (this.ctx.getWebSockets().length === 0) { await this.ctx.storage.deleteAll(); return; }
    // else: run due rows from `schedule`, then re-arm for the next due row
  }
  // checkpoint(), emitEvent(), bucketTake(), strike(), freeSlot(), peerList() omitted
}
```

Worker entry, abbreviated:
- `if (url.pathname.match(/^\/api\/v1\/rooms\/[^/]+\/ws$/))`: verify the JWT with `jose.jwtVerify(token, JWKS)` (Supabase JWKS), check `build === env.BUILD_ID`, apply `env.RL.limit({key: sub})`, then `return env.ROOM.getByName(roomId).fetch(req)`.
- Set the COOP/COEP/CORP headers on every Worker-generated response.

---

## 5. Why not Supabase Realtime or Convex for 20 Hz movement (numbers)

Assumptions: 8 players per room, each sending 20 position updates/s for one hour (72,000 per player).

| Option | Billing unit | Per player-hour | At 10k MAU (20,000 MP player-hours/mo) | Hard ceilings |
|---|---|---|---|---|
| **DO room** | 20 inbound msgs = 1 request ($0.15/M) + 128 MB × wall time | ≈ $0.0009–0.0015 | ≈ $23 | ~500–1,000 events/s per room → shard |
| **Supabase Broadcast** | 1 send + 7 receives = 8 msgs per update; $2.50/M | 576,000 msgs ≈ **$1.44** | 11.5B msgs ≈ **$28,800** | **2,500 msgs/s per project** (Pro, no spend cap). One 8-player room needs 160 sends/s + 1,120 receipts/s = 1,280 msg/s, so about **2 rooms per project** |
| **Convex mutations** | 1 function call per update; $2/M (Pro) | ≥ 72,000 calls ≈ **$0.144** (excludes subscription re-runs and DB I/O) | ≥ **$2,880** | S256: 256 concurrent mutations; OCC retries on hot room documents; nearest region us-east-1 |

**Conclusion:** use DOs for anything at or above 1 Hz per player. Supabase Realtime or Convex reactivity are acceptable only for low-rate events: forum updates, friend online/offline, UGC publish notifications, world announcements.

---

## 6. Decision matrix

Legend: **Bold** = recommended. CF = Cloudflare-native; SB = Supabase; CX = Convex.

| Workload | Cloudflare-native option | Supabase option | Convex option | Recommendation and rationale |
|---|---|---|---|---|
| **Single-player saves** | DO-per-player SQLite or D1 `saves` table; blobs > 256 KB in R2 | Postgres `saves(player_id, slot, version, data jsonb, updated_at)` + RLS (`auth.uid()`), anon user id | `saves` table + mutation with version check | **Local IndexedDB is authoritative offline (M04, no account). Cloud mirror = SB via Worker `/api/v1/saves` with optimistic `version` and tombstones, using Grand-V save-profile rules (32-hex ids, ≤ 64 profiles, Story/Sandbox namespaces). Blobs > 256 KB go to R2 `saves/{uid}/{profile}/{version}.bin`.** One system of record for player data; survives anonymous → linked identity |
| **Cutscene cache** | **R2 `cutscenes/{cacheKey}.mp4` + `CutsceneJobDO` per cache key (single-flight) + Workflow (submit to fal → waitForEvent(webhook) → copy to R2 → record) + KV/static manifest for story cutscenes** | Index table `cutscenes(cache_key pk, status, r2_key, model_id, cost_usd, created_at)` | Same as table + file storage | **CF for media and coordination, SB for the audit index.** `idFromName(cacheKey)` guarantees one coordinator per key, enforcing "generated at most once per key" (R-CUT-01). Existence check = R2 `HEAD` (Class B $0.36/M); R2 egress free; no DB on the hot path |
| **UGC / mod publishing** | R2 presigned PUT (S3 endpoint, ≤ 15 min, fixed Content-Type, size cap e.g. 128 MiB from Grand-V) → Queue validation → `ugc/published/{sha256}` | **`experiences`, `mods`, `mod_versions`, `moderation_queue` tables + RLS; full-text search** | Tables + file storage (1 GB free / 100 GB Pro) | **R2 for archives + SB for metadata/moderation.** Manifest fields from `repos-grand-v.md` rec. 6; no third-party scraping; mods disabled in MP rooms |
| **Forum** | D1 tables + DO per thread for live updates | **Postgres threads/posts/votes, tsvector search, Realtime private channel `forum:thread:{id}` fed by `realtime.broadcast_changes` trigger** | Reactive queries (best developer experience here) | **SB.** Convex is nicer for a reactive feed, but not enough to justify a second backend. Message volume is tiny (≪ 5M/mo quota) |
| **AI NPC memory** | Vectorize + D1 | **pgvector (HNSW) `npc_memories(player_id, npc_id, kind, text, embedding vector(1024), salience, created_at)`; summaries in `npc_relationships`** | Vector index (≤ 4,096 dims, ≤ 256 results, 4 per table) | **SB pgvector.** Relational joins with player and NPC state in one query, RLS per player. Embeddings from Workers AI `bge-m3` (or `qwen3-embedding-0.6b`) via a Queue consumer |
| **Multiplayer rooms (10–20 Hz authoritative, interest management)** | **RoomDO per instance/district + DirectoryDO; hibernation API; binary snapshots** | Broadcast/Presence: cost and 2,500 msg/s cap make it infeasible (§5) | Mutations/subscriptions: cost, OCC, no US West, no tick model | **CF DO.** See §4 |
| **Presence / friends online / party** | **PresenceDO sharded by `hash(pid) % 64`, hibernatable sockets (idle sockets cost nothing)** | Presence (10 keys/object, 50–1,000 presence msgs/s) | `@convex-dev/presence` | **CF DO** (same socket stack as rooms, free while idle). SB Presence is an acceptable fallback for the menu |
| **Voice chat** | **Realtime SFU + TURN (1,000 GB/mo free, then $0.05/GB); signaling over the room socket; RealtimeKit if prebuilt UI is wanted** | none | none | **CF Realtime.** Opus ~32 kbps per speaker; proximity mixing on the client by distance |
| **Leaderboards** | DO per board (SQLite sorted index) or D1; KV top-N cache | **Postgres `scores(board, player_id, value, replay_r2_key, verified)` + index; top-100 view cached in KV (30 s TTL)** | Table + index | **SB + KV cache.** Writes only through the Worker after server-side plausibility checks (race-time bounds, replay hash), never from the client directly |
| **Analytics / telemetry** | **Workers Analytics Engine (10M points/mo included, currently unbilled) + Workers Logs; Queue for raw event fan-in** | Postgres events table (bloats the DB) | n/a | **CF AE.** Device tier, fps, load phases, room tick p99, crash beacons; no PII |
| **Auth (phases)** | Worker-signed HMAC "play token" (M00–M11, no backend account) | **Anonymous sign-in (M12) → linkIdentity / Web3 (EIP-4361) / custom OIDC (M13–M14)** | Custom JWT (RS256/ES256) | **SB Auth** as the identity spine; Thirdweb attaches via Web3 sign-in or a Worker-side link (Open questions) |
| **Job orchestration** | **Queues + Workflows + Cron** | pg_cron / Edge Functions | Scheduled functions/actions | **CF.** Same runtime as the fal/Anthropic proxies; secrets stay in Workers |
| **Secrets / API proxy (fal, Anthropic)** | **Worker routes with secrets + Rate Limiting binding** | Edge Functions (2 s CPU, 400 s wall) | Actions | **CF Workers.** Keys never reach the browser |

---

## 7. Recommended architecture

```
Browser PWA (Three.js, IndexedDB saves, OPFS asset cache)
   │  static assets (free)            │ /api/v1/* (Worker)             │ wss /api/v1/rooms/:id/ws
   ▼                                  ▼                                ▼
Workers static assets  ◄──── edge Worker (router, JWT verify, COOP/COEP, rate limit)
                                  │        │          │           │
                                  │        │          │           └─► RoomDO (per instance/district) ─► DO SQLite checkpoints
                                  │        │          └─► DirectoryDO, PresenceDO, CutsceneJobDO
                                  │        └─► Queues ─► consumers (UGC validate, embeddings, telemetry)
                                  │        └─► Workflows (fal jobs: submit → webhook event → R2 → record)
                                  ├─► R2 (media.<domain>: world packs > 25 MiB, cutscenes, UGC, save blobs)
                                  ├─► KV (manifest pointer, flags, leaderboard cache)
                                  ├─► Analytics Engine (telemetry)
                                  ├─► Workers AI (embeddings, filler barks, moderation pre-filter)
                                  └─► Supabase us-west-1 (Postgres+RLS+pgvector, Auth) via supabase-js (user JWT, RLS) or Hyperdrive (service queries)
Voice: browser ⇄ Cloudflare Realtime SFU/TURN (signaling via RoomDO)
```

**Rules for the spec:**
1. **The client knows only three backends:** static assets, `/api/v1/*`, and room/presence sockets. The only Supabase code in the client is `packages/client/src/auth/supabase-auth.ts` (sign-in, token refresh), and only from M12. All data goes through the Worker.
2. The Worker uses **supabase-js with the caller's JWT** for user-scoped CRUD, so RLS stays the second line of defence. It uses **Hyperdrive + `postgres`** with a server role for set-based queries (leaderboards, moderation, NPC memory k-NN).
3. **`packages/shared/src/data-port.ts`** defines `DataPort` with namespaces `saves`, `progress`, `ugc`, `forum`, `npcMemory`, `leaderboards`, `cutscenes`, `profiles`. There is exactly one implementation, `apps/edge/src/data/supabase/*`, plus an in-memory fake for tests.
4. **Wrangler bindings** (names are contracts):
   - `ASSETS` (static)
   - `ROOM`, `DIRECTORY`, `PRESENCE`, `CUTSCENE_JOB` (DO, `new_sqlite_classes`)
   - `MEDIA` (R2), `FLAGS` (KV)
   - `JOBS` (Queue), `CUTSCENE_WF` (Workflow)
   - `AE` (Analytics Engine), `AI` (Workers AI)
   - `HYPERDRIVE`
   - `RL` (Rate Limiting)
   - Secrets: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `FAL_KEY`, `ANTHROPIC_API_KEY`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `PLAY_TOKEN_HMAC`.
5. **Environments:** `dev` (wrangler dev / Miniflare, Supabase CLI local stack), `staging` (Workers env + Supabase Free project; pausing is tolerable), `prod` (Workers Paid + Supabase Pro `us-west-1`).

---

## 8. Supabase vs Convex: recommendation and switch cost

**Recommendation: Supabase for persistence and identity; Durable Objects for every realtime game socket; Convex is the documented alternative (ADR G1).**

Why Supabase wins for this game:
1. **Region:** `us-west-1` (N. California) is in the same metro as the target players and the SF-first world. Convex's closest region is `aws-us-east-1` and regions cannot be changed after creation.
2. **Data shape:** saves, UGC, forum, leaderboards, moderation and NPC memory are relational and analytical. Postgres + pgvector + full-text search covers all of them in one store, and SQL makes moderation and leaderboard queries simple.
3. **Auth roadmap fit:**
   - Anonymous users now, upgraded later via `linkIdentity`/`updateUser`.
   - **Built-in Web3 sign-in (EIP-4361)** for the Thirdweb milestone.
   - **Custom OIDC providers** (Pro: unlimited) if a ChatGPT/OpenAI OIDC issuer is available. Dimension `auth-ugc-input-maps` must confirm whether one exists.
   - Asymmetric JWKS lets the Worker verify tokens locally.
4. **Cloudflare fit:** Hyperdrive is a first-class Postgres path from Workers. Convex is reachable only over HTTP/WebSocket.
5. **Open source and portability:** Postgres data can move to any Postgres. Convex self-hosting is FSL-licensed.
6. **Cost parity:** see §9; both land at about $25–$130/month for persistence at 1k–100k MAU.

Where Convex would be better:
- A reactive forum/UGC feed and TypeScript end to end, with no SQL migrations.
- The built-in scheduler.
- Simpler developer experience for a solo builder model.

None of these outweighs the region and auth-roadmap points, and DOs already provide realtime.

**Switch cost (Supabase → Convex), assuming the `DataPort` rule is followed:**

| Work item | Effort (Sonnet 5.5 sessions) |
|---|---|
| Port `DataPort` implementation (~10 tables, ~40 methods) to Convex functions + schema | 2–3 |
| Auth: Convex `customJwt` trusting Supabase JWKS (keep Supabase Auth), or move to Convex Auth | 0.5 (keep) / 1.5 (move) |
| RLS policies → explicit checks in Convex functions + tests | 1 |
| Data migration: Postgres → JSONL → `npx convex import`, verification, dual-run read compare | 1 |
| pgvector → Convex vector index (same dims; ≤ 256 results, 4 indexes/table) | 0.5 |
| Leaderboard/moderation SQL → indexed queries/aggregates | 0.5–1 |
| **Total** | **≈ 5–7 sessions + a maintenance window; rooms/DOs untouched** |

If the client calls supabase-js directly across features, add about 4–6 sessions to find and rewrite call sites, and the risk rises sharply. The reverse switch (Convex → Supabase) costs about the same. **Lock-in mitigation:** UUID v7 primary keys generated in the Worker (not DB serials), ISO timestamps, JSON-schema-validated payloads shared from `packages/shared`, and no Postgres-only features (triggers, RPC functions) in the core game paths. Postgres-only features are allowed in forum/moderation.

---

## 9. Monthly cost estimate (USD, infra only)

**Assumptions** (state them in the spec and re-measure after launch):
- 8 sessions × 30 min = **4 play-hours per MAU per month**.
- Multiplayer phase: 50% of play-hours in rooms, 8 players per active room on average, 20 Hz in, 20 Hz out.
- About 120 Worker API requests per play-hour; ~5 ms CPU each.
- World and asset download about 450 MB per MAU per month, served from static assets/R2 with free egress; 5% cache-miss Class B reads.
- R2 storage 20 / 50 / 200 GB.
- Voice in 20% of MP hours at ~64 kbps average downstream (28.8 MB/h).
- Supabase saves about 200 KB per user.
- Excludes fal.ai generation, Anthropic NPC dialogue, Thirdweb, domain and Apple/Google fees (other dimensions).

| Line item | 1k MAU | 10k MAU | 100k MAU |
|---|---|---|---|
| Workers Paid base | $5 | $5 | $5 |
| Workers requests/CPU (0.48M / 4.8M / 48M req) | $0 | $0 | ≈ $16 |
| Static asset requests | $0 | $0 | $0 |
| DO requests (MP: 7.2M / 72M / 720M billable) | ≈ $1 | ≈ $11 | ≈ $108 |
| DO duration (250 / 2,500 / 25,000 room-hours × 450 GB-s) | $0 | ≈ $12.50 | ≈ $137.50 |
| DO SQLite (checkpoints) | $0 | $0 | < $2 |
| R2 storage + ops | < $1 | ≈ $1 | ≈ $5–15 |
| Queues / Workflows / KV / AE | $0 | ≈ $1 | ≈ $5–10 |
| Realtime SFU voice (115 GB / 1,150 GB) | $0 | $0 | ≈ $8 |
| Workers Logs | $0 | $0 | ≈ $5–10 |
| **Cloudflare subtotal** | **≈ $6** | **≈ $30** | **≈ $300** |
| Supabase Pro + compute (Micro → Small → Medium, $10 credit) | $25 | ≈ $30 | ≈ $75 |
| Supabase DB overage (0.2 / 2 / 20 GB) | $0 | $0 | ≈ $2 |
| Supabase Realtime (low-rate notifications only; peak CCU ≈ 20 / 170 / 1,700) | $0 | $0 | ≈ $10–20 |
| **Supabase subtotal** | **≈ $25** | **≈ $30** | **≈ $90–100** |
| **Total (CF + Supabase)** | **≈ $31** | **≈ $60** | **≈ $400** |
| Alternative: Convex instead of Supabase (Pro $25/dev, 1 seat; 0.5M / 4.8M / 48M calls) | ≈ $0–25 | ≈ $25 | ≈ $25 + $46 calls + I/O ≈ $80–110 |
| Single-player-only phase (no rooms, no voice) | ≈ $30 | ≈ $35 | ≈ $110 |

Sensitivity:
- **DO duration dominates at scale.** It is linear in room-hours; fuller rooms are cheaper per player. AFK hibernation and closing empty rooms quickly matter more than message volume.
- Moving to 30 Hz raises DO requests by 1.5× but leaves duration unchanged.
- Supabase compute is the main lever if NPC-memory k-NN queries grow. Move embeddings to Vectorize only if Postgres CPU becomes the bottleneck.

---

## 10. Code-pattern notes (with sources)

**Wrangler config (jsonc) skeleton:**
```jsonc
{
  "name": "tha-bay-edge", "main": "apps/edge/src/index.ts", "compatibility_date": "2026-10-18",
  "assets": { "directory": "./apps/client/dist", "not_found_handling": "single-page-application",
              "binding": "ASSETS", "run_worker_first": ["/api/*"] },
  "durable_objects": { "bindings": [
    { "name": "ROOM", "class_name": "RoomDO" }, { "name": "DIRECTORY", "class_name": "DirectoryDO" },
    { "name": "PRESENCE", "class_name": "PresenceDO" }, { "name": "CUTSCENE_JOB", "class_name": "CutsceneJobDO" } ] },
  "migrations": [ { "tag": "v1", "new_sqlite_classes": ["RoomDO", "DirectoryDO", "PresenceDO", "CutsceneJobDO"] } ],
  "r2_buckets": [ { "binding": "MEDIA", "bucket_name": "tha-bay-media" } ],
  "kv_namespaces": [ { "binding": "FLAGS", "id": "<id>" } ],
  "queues": { "producers": [ { "binding": "JOBS", "queue": "tha-bay-jobs" } ],
              "consumers": [ { "queue": "tha-bay-jobs", "max_batch_size": 50 } ] },
  "workflows": [ { "name": "cutscene", "binding": "CUTSCENE_WF", "class_name": "CutsceneWorkflow" } ],
  "analytics_engine_datasets": [ { "binding": "AE", "dataset": "tha_bay_telemetry" } ],
  "ai": { "binding": "AI" },
  "hyperdrive": [ { "binding": "HYPERDRIVE", "id": "<id>" } ]
}
```
The exact keys for `workflows`, `analytics_engine_datasets` and the rate-limit binding block must be checked against `wrangler@4.151.1` JSON schema during M00 (see Unverified).

**`public/_headers`:**
```
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  Cross-Origin-Resource-Policy: same-origin
/assets/*
  Cache-Control: public, max-age=31556952, immutable
```
Mirror the three isolation headers on Worker responses. The R2 bucket CORS allows `GET, HEAD` from the app origin, and the client fetches media in CORS mode.

**Supabase anonymous → linked (client auth module only, M12+):**
```ts
const { data, error } = await supabase.auth.signInAnonymously(/* pass Turnstile token per Supabase CAPTCHA guide */);
// later, when the player opts in:
await supabase.auth.linkIdentity({ provider: 'google' });            // or updateUser({ email })
await supabase.auth.signInWithWeb3({ chain: 'ethereum', statement: 'Sign in to Tha Bay' }); // Thirdweb/EOA milestone
```
RLS that separates anonymous users: `with check ((select (auth.jwt()->>'is_anonymous')::boolean) is false)` on publish/forum inserts. Cron SQL `delete from auth.users where is_anonymous and created_at < now() - interval '30 days'`.

**Supabase Realtime (low-rate only), forum thread feed:**
```ts
const ch = supabase.channel(`forum:thread:${threadId}`, { config: { private: true } });
ch.on('broadcast', { event: 'INSERT' }, ({ payload }) => addPost(payload)).subscribe();
```
Server side: a trigger calls `realtime.broadcast_changes('forum:thread:' || NEW.thread_id, TG_OP, TG_OP, TG_TABLE_NAME, TG_TABLE_SCHEMA, NEW, OLD)`, with RLS on `realtime.messages` checking thread visibility.

**Worker JWT verification (no network):** `createRemoteJWKSet(new URL(env.SUPABASE_URL + '/auth/v1/.well-known/jwks.json'))` + `jwtVerify(token, jwks, { issuer: env.SUPABASE_URL + '/auth/v1' })`. Cache the JWKS in module scope. Confirm the exact issuer string and JWKS path in M12 (see Unverified).

**R2 presigned PUT (Worker, aws4fetch@1.0.20):** sign `PUT https://<ACCOUNT_ID>.r2.cloudflarestorage.com/<bucket>/ugc/incoming/<uuid>.zip?X-Amz-Expires=900` with `signQuery: true` and a fixed `Content-Type`. After upload, the client calls `/api/v1/ugc/commit`; the Worker `HEAD`s the object, checks size ≤ cap, and enqueues validation. Never presign custom-domain URLs (not supported).

**Cutscene single-flight:**
1. `CutsceneJobDO.idFromName(cacheKey).ensure(spec)` → `MEDIA.head('cutscenes/'+key+'.mp4')`. If present, return `ready`.
2. Otherwise, if no `pending` record, `put('pending')` and `CUTSCENE_WF.create({ id: cacheKey, params: spec })`. Return `pending`.
3. The Workflow runs these steps: submit to fal queue with `webhookUrl=/api/v1/hooks/fal?key=…` → `waitForEvent('fal-done')` → stream result into R2 (≤ 5 GiB single PUT) → insert the `cutscenes` row → `CutsceneJobDO.complete()`.
4. The webhook route verifies the fal signature (dimension `genai-pipeline-fal`) and calls `instance.sendEvent`.

---

## Verified facts

| fact | source URL | date checked | confidence |
|---|---|---|---|
| Pages landing page banner: "Workers supports most Pages use cases… Start new projects with Workers"; no deprecation notice | https://developers.cloudflare.com/pages/ | 2026-10-18 | high |
| Workers static assets support `_headers`/`_redirects`; custom domains outside Cloudflare zones are Pages-only; Branch Deploy Controls partial on Workers | https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/ | 2026-10-18 | high |
| SPA mode `not_found_handling = "single-page-application"`; navigation requests skip the Worker (compat ≥ 2025-04-01); `run_worker_first` route arrays need Wrangler ≥ 4.20.0 / Vite plugin ≥ 1.7.0 | https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/ | 2026-10-18 | high |
| `_headers`: 100 rules, 2,000 chars/line, not applied to Worker-generated responses; default `Cache-Control: public, max-age=0, must-revalidate`; ETag = file hash | https://developers.cloudflare.com/workers/static-assets/headers/ | 2026-10-18 | high |
| Workers limits: CPU 10 ms Free / 30 s default up to 5 min Paid; 128 MB memory; 64 MiB Worker; static assets 20k/100k files, 25 MiB/file; Cron 5/250; Free 100k req/day (page updated 2026-10-12) | https://developers.cloudflare.com/workers/platform/limits/ | 2026-10-18 | high |
| Workers Paid $5/mo; 10M req (+$0.30/M), 30M CPU-ms (+$0.02/M); static asset requests free; no egress; WS upgrade = 1 request, messages not billed (page updated 2026-10-02) | https://developers.cloudflare.com/workers/platform/pricing/ | 2026-10-18 | high |
| KV Paid: reads 10M (+$0.50/M), writes 1M (+$5/M), storage 1 GB (+$0.50/GB-mo); Queues 1M ops (+$0.40/M), 64 KB per op; D1 rows read 25B (+$0.001/M), written 50M (+$1/M), storage 5 GB (+$0.75/GB-mo); Hyperdrive Free 100k queries/day | https://developers.cloudflare.com/workers/platform/pricing/ | 2026-10-18 | high |
| Workflows Paid: 500k steps/mo (+$0.80/100k), 30M CPU-ms, 1 GB-mo storage | https://developers.cloudflare.com/workers/platform/pricing/ | 2026-10-18 | high |
| DO Hibernation API: `acceptWebSocket`, `webSocketMessage/Close/Error`, attachments ≤ 16,384 B survive hibernation; auto-reply to Close with compat ≥ 2026-04-07; deploy restarts all DOs and disconnects WebSockets; batch every 50–100 ms (page updated 2026-09-30) | https://developers.cloudflare.com/durable-objects/best-practices/websockets/ | 2026-10-18 | high |
| Max 32,768 hibernatable WebSockets per DO; ≤ 10 tags × 256 chars; auto-response pair ≤ 2,048 chars, no wake, no duration; event timeout ≤ 7 days; `blockConcurrencyWhile` 30 s; `waitUntil` ≤ 15 min | https://developers.cloudflare.com/durable-objects/api/state/ | 2026-10-18 | high |
| Hibernation after 10 s idle only if no timers, no pending I/O/outbound connections, no standard WS API, no in-flight request; non-hibernatable idle eviction 70–140 s; constructor re-runs on wake | https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/ | 2026-10-18 | high |
| Outbound connections (connect(), outbound WS) keep DOs alive (changelog 2026-06-19) | https://developers.cloudflare.com/changelog/post/2026-06-19-outbound-connections-keep-dos-alive/ | 2026-10-18 | high |
| Alarms: one per object; at-least-once; retries with exponential backoff from 2 s up to 6 retries; `alarmInfo.retryCount/isRetry` | https://developers.cloudflare.com/durable-objects/api/alarms/ | 2026-10-18 | high |
| DO limits: 10 GB per SQLite DO; 5 GB account on Free; 2 MB row/value; 100 columns; 100 KB SQL; 100 params; CPU 30 s default up to 5 min; 32 MiB received WS message; ~1,000 req/s soft limit per object (page updated 2026-06-01) | https://developers.cloudflare.com/durable-objects/platform/limits/ | 2026-10-18 | high |
| "A single Durable Object can handle approximately 500-1,000 requests per second for simple operations" | https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/ | 2026-10-18 | high |
| DO pricing: 1M req (+$0.15/M), 400k GB-s (+$12.50/M GB-s), 128 MB billed per object; incoming WS messages 20:1; outgoing and protocol pings free; auto-responses no duration; SQLite rows read 25B (+$0.001/M), written 50M (+$1/M), 5 GB-mo (+$0.20); each `setAlarm` = 1 row written; Free 100k req + 13k GB-s per day | https://developers.cloudflare.com/durable-objects/platform/pricing/ | 2026-10-18 | high |
| DO location hints `wnam, enam, sam, weur, eeur, apac, apac-ne, apac-se, oc, afr, me`; only first `get()` honoured; DOs do not move after creation; jurisdictions eu/us/fedramp | https://developers.cloudflare.com/durable-objects/reference/data-location/ | 2026-10-18 | high |
| Overload errors: "Too many requests queued / Too much data queued / queued for too long"; `.overloaded` property | https://developers.cloudflare.com/durable-objects/observability/troubleshooting/ | 2026-10-18 | high |
| WebSocket message size limit raised from 1 MiB to 32 MiB (2025-10-31) | https://developers.cloudflare.com/changelog/post/2025-10-31-increased-websocket-message-size-limit/ | 2026-10-18 | high |
| R2 pricing: Standard $0.015/GB-mo, IA $0.01; Class A $4.50/M, Class B $0.36/M; egress free; free tier 10 GB, 1M A, 10M B (Standard only); deletes free (updated 2026-10-01) | https://developers.cloudflare.com/r2/pricing/ | 2026-10-18 | high |
| R2 limits: 5 GiB single PUT; 4.995 TiB object; 10,000 parts; 1 write/s per key; 1,024-byte keys; 8,192-byte metadata; 100 custom domains/bucket; r2.dev for testing only | https://developers.cloudflare.com/r2/platform/limits/ | 2026-10-18 | high |
| R2 presigned URLs: GET/HEAD/PUT/DELETE; 1 s – 7 days; S3 endpoint only, not custom domains; Content-Type is signed | https://developers.cloudflare.com/r2/api/s3/presigned-urls/ | 2026-10-18 | high |
| D1: 500 MB / 10 GB per DB; 10 / 50,000 DBs; 50 / 1,000 queries per invocation; 30 s query; 2 MB row (updated 2026-04-21) | https://developers.cloudflare.com/d1/platform/limits/ | 2026-10-18 | high |
| Queues: 128 KB message; 5,000 msgs/s per queue; batch ≤ 100; 100 retries; delay ≤ 24 h; retention ≤ 14 d (24 h Free); 250 concurrent consumers | https://developers.cloudflare.com/queues/platform/limits/ | 2026-10-18 | high |
| Workflows: Free 1,024 steps / 10 ms CPU; Paid 10,000 (to 25,000) steps, 30 s CPU/step; sleep ≤ 365 d; step result ≤ 1 MiB; 50,000 concurrent; 300/s creation | https://developers.cloudflare.com/workflows/reference/limits/ | 2026-10-18 | high |
| KV: 1 write/s per key; 25 MiB values; 512 B keys; min cacheTtl 30 s; Free 100k reads / 1k writes per day | https://developers.cloudflare.com/kv/platform/limits/ | 2026-10-18 | high |
| Workers AI catalog has text-gen, text-to-image (flux-2-dev, flux-2-klein, flux-1-schnell…), TTS (aura-2, melotts), ASR (nova-3, whisper-large-v3-turbo), embeddings (bge-m3…); no video/3D models | https://developers.cloudflare.com/workers-ai/models/ | 2026-10-18 | high |
| Workers AI: $0.011 / 1k Neurons; 10k Neurons/day free; llama-3.1-8b $0.282/$0.827 per M; gpt-oss-120b $0.350/$0.750 per M; melotts $0.0002/min (updated 2026-10-15) | https://developers.cloudflare.com/workers-ai/platform/pricing/ | 2026-10-18 | high |
| Realtime SFU + TURN $0.05/GB egress; first 1,000 GB/mo free (shared); TURN free with SFU; STUN free (updated 2026-09-22) | https://developers.cloudflare.com/realtime/sfu/platform/pricing/ | 2026-10-18 | high |
| TURN endpoints turn.cloudflare.com 3478/udp, 443/udp, 3478/tcp, 80/tcp, 5349/tcp, 443/tcp; STUN stun.cloudflare.com 3478/udp | https://developers.cloudflare.com/realtime/turn/ | 2026-10-18 | high |
| Realtime products: RealtimeKit, Realtime SFU (audio/video/DataChannels), TURN, WebSocket adapter | https://developers.cloudflare.com/realtime/ | 2026-10-18 | high |
| Containers instance types lite → standard-4 (up to 4 vCPU, 12 GiB, 20 GB); billing per 10 ms; included 25 GiB-h / 375 vCPU-min / 200 GB-h; CPU billed on active usage | https://developers.cloudflare.com/containers/platform/pricing/ | 2026-10-18 | high |
| Containers account limits 6 TiB memory / 1,500 vCPU / 30 TB disk; 50 GB image storage (updated 2026-10-12) | https://developers.cloudflare.com/containers/platform/limits/ | 2026-10-18 | high |
| Hyperdrive transaction-mode pooling; origin connections ~20 Free / ~100 Paid per config (soft); postgres.js pattern `max: 5, fetch_types: false, prepare: true` | https://developers.cloudflare.com/hyperdrive/platform/limits/ ; https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/ | 2026-10-18 | high |
| Range behaviour: Cloudflare ignores Range and returns a full 200 when it must decompress; Worker-returned 206 never cached; Workers Caching slices full 200s (updated 2026-09-14) | https://developers.cloudflare.com/cache/reference/range-requests/ ; https://developers.cloudflare.com/workers/cache/configuration/ | 2026-10-18 | high |
| Default-compressed types include application/wasm, application/javascript, application/json; Zstandard via Compression Rules; model/gltf-binary and image/ktx2 not in the default list | https://developers.cloudflare.com/rules/compression-rules/examples/enable-zstandard/ | 2026-10-18 | medium |
| Analytics Engine: Paid 10M points/mo (+$0.25/M), 1M reads (+$1/M); Free 100k points + 10k reads/day; "Currently, you will not be billed" | https://developers.cloudflare.com/analytics/analytics-engine/pricing/ | 2026-10-18 | high |
| Rate Limiting binding: `simple {limit, period 10|60}`, `limit({key})`, per-location, eventually consistent, Wrangler ≥ 4.36.0 | https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/ | 2026-10-18 | high |
| COEP require-corp: requests in `cors` mode are not blocked by COEP (must pass CORS); `crossorigin` attribute needed for img | https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy | 2026-10-18 | high |
| Supabase plans: Free $0, Pro from $25, Team from $599; MAU 50k/100k then $0.00325; DB 500 MB / 8 GB then $0.125/GB; egress 5 / 250 GB then $0.09; Realtime 200/500 peak (then $10/1k), 2M/5M msgs (then $2.50/M); Edge Fn 500k/2M; $10 compute credit; Free pauses after 1 week | https://supabase.com/pricing | 2026-10-18 | high |
| Supabase compute: Nano $0 (Free), Micro ~$10, Small ~$15, Medium ~$60, Large ~$110, XL ~$210, 2XL ~$410; direct conns 60/60/90/120/160/240/380 | https://supabase.com/docs/guides/platform/compute-and-disk | 2026-10-18 | high |
| Supabase Realtime limits: connections 200/500/10,000; msgs/s 100/500/2,500; joins/s 100/500/2,500; presence msgs/s 20/50/1,000; broadcast payload 256 KB / 3,000 KB; Postgres Changes payload 1,024 KB | https://supabase.com/docs/guides/realtime/limits | 2026-10-18 | high |
| Supabase billing: each broadcast = 1 sent + 1 per receiving client; each DB change = 1 per listening client; rounded to whole million packages | https://supabase.com/docs/guides/platform/manage-your-usage/realtime-messages | 2026-10-18 | high |
| Supabase Realtime benchmarks: broadcast 32k users/224k msgs/s median 6 ms p95 28 ms p99 213 ms; RLS broadcast 50k users median 19 ms p95 49 ms; Postgres Changes with RLS ~3–4k msgs/s | https://supabase.com/docs/guides/realtime/benchmarks | 2026-10-18 | medium |
| Supabase Realtime Authorization via RLS on `realtime.messages`, `private: true`, `realtime.topic()`, policies cached per connection | https://supabase.com/docs/guides/realtime/authorization | 2026-10-18 | high |
| Supabase Edge Functions: 256 MB; wall 150 s Free / 400 s paid; CPU 2 s/request; bundle 20 MB CLI / 5 MB server; ports 25/587 blocked | https://supabase.com/docs/guides/functions/limits | 2026-10-18 | high |
| Supabase anonymous sign-ins: `authenticated` role + `is_anonymous` claim; convert via updateUser/linkIdentity; 30/hour IP limit; no auto cleanup | https://supabase.com/docs/guides/auth/auth-anonymous | 2026-10-18 | high |
| Supabase Web3 sign-in (Ethereum + Solana, EIP-4361), `signInWithWeb3`, signature ≤ 10 min old | https://supabase.com/docs/guides/auth/auth-web3 | 2026-10-18 | high |
| Supabase third-party auth: Clerk, Firebase Auth, Auth0, AWS Cognito, WorkOS; asymmetric JWT with `kid` required; $0.00325 per TP-MAU over quota | https://supabase.com/docs/guides/auth/third-party/overview | 2026-10-18 | high |
| Supabase custom OAuth/OIDC providers: `custom:` prefix; Free ≤ 3, Pro unlimited; OIDC via issuer discovery + JWKS | https://supabase.com/docs/guides/auth/custom-oauth-providers | 2026-10-18 | high |
| Supabase `getClaims()` verifies locally via `/.well-known/jwks.json`; asymmetric signing keys are the default for new projects | https://supabase.com/docs/reference/javascript/auth-getclaims ; https://supabase.com/docs/guides/getting-started/tutorials/with-nextjs | 2026-10-18 | high |
| Supabase legacy anon/service_role keys work until end of 2026; use sb_publishable_/sb_secret_ | https://supabase.com/docs/guides/realtime/getting_started | 2026-10-18 | high |
| Supabase regions include us-west-1 (N. California) and us-west-2 (Oregon) | https://supabase.com/docs/guides/platform/regions | 2026-10-18 | high |
| Supabase Storage max file 50 MB Free, 500 GB Pro/Team | https://supabase.com/docs/guides/storage/uploads/file-limits | 2026-10-18 | high |
| Supabase pgvector available; HNSW/IVFFlat mentioned | https://supabase.com/docs/guides/database/extensions/pgvector | 2026-10-18 | medium |
| Convex limits: queries/mutations 1 s; actions 30 min (Convex) / 10 min (Node); 16 MiB args/returns; 16 MiB read/write, 32k scanned, 16k written per txn; concurrency S16/S256/D1024/D2048; 1 MiB docs; vector ≤ 4,096 dims, ≤ 256 results | https://docs.convex.dev/production/state/limits | 2026-10-18 | high |
| Convex usage: Free 1M calls hard cap, 1,000 sessions; Starter $2.20/M over 1M; Professional 25M calls (+$2/M), 50 GB DB, 50 GB I/O, 100 GB files, 10,000 sessions; non-US 1.3× | https://docs.convex.dev/production/state/limits | 2026-10-18 | high |
| Convex Professional $25/developer/month; Business $2,500/mo minimum (secondary aggregators; official page not machine-readable) | https://www.jetadmin.io/blog/convex-vs-supabase/ ; https://www.saasodds.com/blog/convex-pricing | 2026-10-18 | medium |
| Convex regions: aws-us-east-1, aws-eu-west-1, aws-ap-southeast-2, aws-ca-central-1 (+30% non-US); region cannot be changed | https://docs.convex.dev/production/regions | 2026-10-18 | high |
| Convex OCC: read-set validation at commit, automatic retries, serializable | https://docs.convex.dev/database/advanced/occ | 2026-10-18 | high |
| Convex custom JWT: issuer, jwks, applicationID (aud), RS256/ES256 only | https://docs.convex.dev/auth/advanced/custom-jwt | 2026-10-18 | high |
| Convex self-hosting: FSL Apache 2.0; Docker Compose (3210/3211/6791); SQLite default, Postgres/MySQL; Fly.io/Railway guides | https://docs.convex.dev/self-hosting ; https://github.com/get-convex/convex-backend/blob/main/self-hosted/README.md | 2026-10-18 | high |
| `@convex-dev/presence` updates subscribers only on join/leave via scheduled functions | https://www.convex.dev/components/presence | 2026-10-18 | medium |
| npm versions: wrangler 4.151.1, @cloudflare/vite-plugin 1.64.0, @cloudflare/workers-types 5.20261018.1, @supabase/supabase-js 2.118.0, convex 1.47.0, @convex-dev/presence 0.4.0, partyserver 0.5.10, partysocket 1.3.0, aws4fetch 1.0.20 | https://registry.npmjs.org (npm view) | 2026-10-18 | high |
| partyserver: room routing, lifecycle hooks, `static options = { hibernate: true }`; repo marked work in progress | https://github.com/cloudflare/partykit | 2026-10-18 | medium |
| Grand-V relay protocol (check/join/welcome/joined/pose/left, 20 Hz, token bucket 30/25, coalescing, 1013/1008 closes, 2,048 B frames) | local: research/repos-grand-v.md §2(b) (`src/relay.rs`) | 2026-10-18 | high |
| muguet UDP: 105 B STATE @30 Hz, REL/ACK 150 ms/4 s, clock min-offset + p90 delay 45–300 ms, SHARE_NEAR/FAR 150/220 m | local: research/repos-webport.md §3.7 | 2026-10-18 | high |

## Unverified

- UNVERIFIED: Workers/DO `WebSocket.send()` backpressure. No `bufferedAmount` or flow-control signal was found in the docs. The design assumes none and uses client acks.
- UNVERIFIED: the DO in-memory limit. 128 MB is the Workers isolate limit; the DO limits page does not state a memory figure.
- UNVERIFIED: minimum alarm granularity and alarm latency (not documented).
- UNVERIFIED: whether WebSocket tags can be changed after `acceptWebSocket` (assumed immutable; design keeps cells in memory).
- UNVERIFIED: whether incoming WebSocket messages count toward the "~1,000 requests/s" soft limit the same way HTTP requests do. The design budgets them as if they do.
- UNVERIFIED: free-plan per-DO storage (table says 10 GB, FAQ says 1 GB).
- UNVERIFIED: Safari support for `COEP: credentialless` (MDN compat table not rendered); design avoids it.
- UNVERIFIED: whether Workers static assets can serve pre-compressed `.br/.zst` variants of glb/ktx2. The design serves identity-encoded binaries with in-format compression.
- UNVERIFIED: whether WebTransport or any unreliable datagram transport can terminate in a Worker or DO (none found). WebSocket only.
- UNVERIFIED: whether a Workflow instance created with an existing `id` errors (which would give a second single-flight guard). The design relies on the DO for single-flight anyway.
- UNVERIFIED: exact `wrangler.jsonc` keys for Workflows, Analytics Engine and Rate Limiting bindings in wrangler 4.151.1 (names follow docs conventions; check the schema in M00).
- UNVERIFIED: Supabase JWT issuer string and JWKS path for Worker-side verification (`<url>/auth/v1/.well-known/jwks.json` is assumed from the `getClaims` docs).
- UNVERIFIED: whether Supabase anonymous users count toward billed MAU (assumed yes in cost model).
- UNVERIFIED: whether Hyperdrive can reach a Supabase direct connection (Supabase direct connections may be IPv6-only without the IPv4 add-on) or must use the Supavisor pooler. Test in M12.
- UNVERIFIED: whether Supabase `signInWithWeb3` verifies smart-account (ERC-1271) signatures from Thirdweb smart wallets. EOA/in-app wallet signatures should work per EIP-4361.
- UNVERIFIED: the exact `signInAnonymously` CAPTCHA option name (`options.captchaToken` assumed).
- UNVERIFIED: Convex Professional $25/dev and Business $2,500 minimum on the official page (secondary sources only).
- UNVERIFIED: whether Convex counts reactive query re-executions as billed function calls (would make Convex movement costs higher than the §5 lower bound).
- UNVERIFIED: real RTT numbers from SF to Convex us-east-1 (informal 117 ms p50 cursor propagation only) and from SF to Supabase us-west-1.
- UNVERIFIED: whether Cloudflare's 512 MB CDN cache limit and R2 custom-domain caching changed since `repos-webport.md` (not re-checked here).

## Recommendations for the spec

1. Host on **Workers + static assets** (no Pages): `not_found_handling: "single-page-application"`, `run_worker_first: ["/api/*"]`, compatibility date ≥ 2026-10-18, Workers Paid from M00. Pin `wrangler@4.151.1`, `@cloudflare/vite-plugin@1.64.0`, `@cloudflare/workers-types@5.20261018.1`.
2. Ship `public/_headers` with COOP `same-origin`, COEP `require-corp`, CORP `same-origin`, and `immutable` caching for hashed paths. Set the same three isolation headers on every Worker response. Serve R2 media from `media.<domain>` with a bucket CORS policy and fetch it in CORS mode.
3. Keep any single static asset ≤ 25 MiB. Put larger files and all cutscenes/UGC in R2. Serve `.glb/.ktx2/.pack` identity-encoded (meshopt/Draco + KTX2 zstd inside) so range requests keep working. Enable Zstandard via a Compression Rule for text, JS and WASM.
4. Implement multiplayer as **`RoomDO` (one per instance; district shards later) + `DirectoryDO` + `PresenceDO`**, all SQLite-backed, using the Hibernation API. Use the protocol-v2 table in §4.2 verbatim as contract C-NET-01.
5. Run the room tick with **`setInterval(50 ms)` only while sockets are connected**. Stop it after 60 s of no input (AFK) to allow hibernation. **Never `setAlarm` per tick.** Use one alarm for GC, scheduled world events and safety checkpoints.
6. Persist room checkpoints to DO SQLite every 5 s and on empty. Rebuild in-memory maps from `getWebSockets()` + `deserializeAttachment()` in the constructor. Keep per-socket state ≤ 16 KiB.
7. Set `CAP = 16` default and `CAP_MAX = 32` behind a flag. Raise it only after the load-test gate (tick p99 ≤ 10 ms, zero overload errors, 30 min, 20 Hz bots).
8. Wire format: binary frames; `IN` ~32 B at 20 Hz (10 Hz with 2 samples on mobile); `SNAP` 12 B header + 28 B per entity; reliable `EV` with `evSeq` for resume. Port muguet's clock/interpolation algorithm into `packages/netcode` (re-implemented, not copied).
9. Interest management: 64 m cells; 150 m on-foot / 300 m vehicle radius with +70 m hysteresis; priority bands 20/10/5 Hz.
10. Validate tokens, build id and rate limits **in the Worker before forwarding upgrades**. Use `setWebSocketAutoResponse("ping","pong")` and auto-response timestamps for liveness. Close codes: 1008 rate, 1013 slow, 4001 auth, 4002 build mismatch, 4003 full, 4004 kicked.
11. Handle deploy restarts: resume tokens (60 s TTL), jittered reconnect 250 ms → 4 s, and a build-mismatch → PWA update flow. Schedule production deploys outside peak hours.
12. Choose **Supabase (project in `us-west-1`, Pro plan for production, Free for staging)** as the system of record for saves mirror, progress, UGC metadata, forum, leaderboards, cutscene index and NPC memory (pgvector). Use `sb_publishable_/sb_secret_` keys only.
13. **The client never imports supabase-js except in `packages/client/src/auth/`.** All data goes through `/api/v1/*` and `packages/shared/src/data-port.ts`, with one Supabase adapter in `apps/edge/src/data/supabase/` and an in-memory fake for tests. Record the Convex switch cost (§8) in ADR G1.
14. Identity phases:
    - M00–M11: no account; local profile + Worker-signed HMAC play token for API calls.
    - M12: Supabase anonymous sign-in with Turnstile, RLS distinguishing `is_anonymous`, nightly cleanup of anonymous users older than 30 days.
    - M13: link identity (OAuth/custom OIDC for ChatGPT if available).
    - M14: Thirdweb via Supabase Web3 (EIP-4361), with a Worker-side link fallback.
15. Cutscenes: R2 `cutscenes/{cacheKey}.mp4` + `CutsceneJobDO` single-flight per key + a Workflow (submit → `waitForEvent` webhook → copy to R2 → record). Story cutscenes are pre-generated and listed in a static manifest. The runtime never blocks on generation; it uses the in-engine fallback.
16. UGC: presigned R2 PUT on the S3 endpoint (15 min, fixed Content-Type, size cap) → `/commit` → Queue validation → `ugc/published/{sha256}`. Metadata and moderation live in Postgres.
17. Voice: Cloudflare Realtime SFU + TURN, signaled through `RoomDO`. Budget 1,000 GB/month free.
18. Telemetry: Workers Analytics Engine (`AE` binding) for fps/tier/load/tick metrics. Workers Logs for errors. No PII.
19. Proxy all third-party AI calls (fal, Anthropic, Workers AI) through Worker routes with secrets and the Rate Limiting binding. No keys in the browser.
20. Put the §9 cost model with its assumptions in `spec/02-architecture.md` and add a monthly budget alert task. DO duration (room-hours) is the KPI to watch.

## Risks

1. **TCP head-of-line blocking:** browsers cannot send unreliable datagrams to a DO (no WebRTC/WebTransport termination found). On lossy mobile networks, snapshot stalls of 100–300 ms will occur. Mitigation: latest-wins snapshots, extrapolation ≤ 250 ms, small frames, mobile 10 Hz inputs. Last resort: route state through Realtime SFU DataChannels peer-relay (complex; not planned).
2. **Single-thread ceiling per room:** about 500–1,000 events/s caps rooms at about 16–32 players. A "whole SF in one room" design will not scale; district sharding and handoff must be designed early, even if built in M12c.
3. **Deploys disconnect every room.** Frequent deploys during playtests mean constant disconnects. Mitigation: resume tokens, a deploy window, and separating the room Worker into its own script so UI deploys don't restart DOs (Open questions).
4. **DOs never relocate.** A room first created by a far-away player stays far away. Mitigation: the directory pre-creates SF rooms with `locationHint: "wnam"` and opens region-tagged room pools later.
5. **Cost runaway via AFK/zombie rooms:** a tick that never stops bills 128 MB × wall time 24/7 (≈ $4/room-month). Mitigation: AFK stop, ack-lag kicks, empty-room alarm GC, AE alert on room-hours.
6. **Anonymous-user abuse** (DB growth, spam): 30/hour IP default, Turnstile required, cleanup cron, `is_anonymous` restrictive RLS on publish/forum.
7. **Thirdweb ↔ Supabase identity gap:** Thirdweb is not a first-class Supabase third-party provider, and smart-wallet signatures may not pass Supabase Web3 verification. Mitigation: EOA/in-app wallet SIWE first; fallback is a Worker verifying Thirdweb auth and linking server-side.
8. **COEP require-corp breaks third-party embeds** (Thirdweb widgets, OAuth popups, fal media without CORS). Mitigation: CORS-mode fetches; auth/mod pages on a non-isolated route (`/account/*` without COEP), already flagged in `repos-webport.md`.
9. **Supabase Free pauses after 1 week of inactivity:** staging breaks silently. Mitigation: a weekly CI ping or use Pro for staging before launch.
10. **Supabase legacy keys expire at end of 2026:** any example code using `anon`/`service_role` will break. Mandate the new keys.
11. **Vendor-doc drift:** several limits were updated in Sep–Oct 2026 (Workers Logs pricing change on 2026-12-01, Containers, DO hints). Re-verify in M12 before multiplayer launch.
12. **Hyperdrive ↔ Supabase connectivity** (IPv6/pooler) may block M12. Mitigation: supabase-js over HTTPS as the default path; Hyperdrive optional.

## Open questions

1. Room script separation: should `RoomDO` live in a separate Worker (service-bound) so client/UI deploys do not restart DOs? This needs verification that DO restarts are scoped to the script that defines the class (likely, but UNVERIFIED).
2. What is the real target concurrency for the first multiplayer playtest (e.g. 4×16 players)? That decides whether district sharding is in M12 or deferred.
3. Is fully authoritative movement (server-side vehicle physics in the DO with Rapier WASM) required, or is server-validated client movement (M12a) acceptable for launch? This determines the DO CPU budget and the shared-physics package.
4. Does OpenAI expose an OIDC issuer for "Sign in with ChatGPT" that a Supabase custom OIDC provider can consume? Dimension `auth-ugc-input-maps` owns this.
5. Should cloud save sync wait for M12 (anonymous auth), or ship in M04 behind the HMAC play token with a device-bound id?
6. Data retention policy for NPC memories and chat logs (privacy and minors) feeds `legal-ip-likeness`.
7. Voice chat moderation (recording? reporting?): Realtime SFU supports recording via RealtimeKit, but recording minors is a legal question.
8. Do we accept Supabase Pro ($25) from the first public single-player launch for backups and no pausing, or stay Cloudflare-only until M12?
