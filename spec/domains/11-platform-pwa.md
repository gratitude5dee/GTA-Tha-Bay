# S11 — Platform, part C: PWA, headers, offline cache, iOS, telemetry client

> Wave 1 · v0.1 · 2026-10-18 · continues `11-platform.md`. Covers R-PLAT-01, the WASM half of R-PLAT-03, and the client side of crash/telemetry (C16 owner S09). Checklist items P-16 to P-22, P-28. Sections here: §2 headers · §3 manifest and install · §4 service worker · §5 world-pack store · §6 iOS quirks and lifecycle · §7 first-gesture unlock and flat cutscene hosting · §8 WASM policy · §9 telemetry client · §10 facts, milestones, tests.

## 1. Scope

The shell is a Workers-served static PWA (Workers + static assets, no Pages) that precaches only the app shell. World content lives on R2 behind `media.<domain>` and is cached by `asset.worker` in OPFS, never by the service worker. iPhone is the reference platform; the game must not depend on installation. [D-01, D-16; research/stack-rendering-platform.md §3, §6.5]

## 2. Headers and cross-origin isolation (P-16)

`apps/web/public/_headers` (up to 100 rules, 2,000 chars per line; `! Header` removes one):
```
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  Cross-Origin-Resource-Policy: same-origin
/assets/*
  Cache-Control: public, max-age=31556952, immutable
/account/*
  ! Cross-Origin-Opener-Policy
  ! Cross-Origin-Embedder-Policy
```
1. `_headers` does not apply to Worker-generated responses (API, `run_worker_first` paths): `services/edge` applies `withIsolationHeaders(response)` to every Worker response (S09). [F-019]
2. `index.html`, `sw.js` and `manifest.webmanifest` keep the platform default `Cache-Control: public, max-age=0, must-revalidate`.
3. Cross-origin media (`media.<domain>`) is fetched in CORS mode; elements carry `crossorigin="anonymous"`; the bucket CORS allows `GET, HEAD` from the app origin. Safari has no COEP `credentialless`, so nothing relies on it; no third-party iframe loads inside the isolated app. Third-party sign-in and widgets live on `/account/*`, which is not isolated (D-01). [F-011; research/stack-cloudflare-backend.md §1.2]
4. World packs, `.glb` and `.ktx2` are served identity-encoded (not in Cloudflare's default compression list; in-format compression applies) so Range works. [research/stack-cloudflare-backend.md §1.2]
5. **Isolation guard:** at boot `crossOriginIsolated === false` in production emits `app.start{coi:false}`, shows a non-blocking notice, and selects the postMessage transport (DN-S11-02).
6. Static assets: ≤ 25 MiB per file, ≤ 20,000 files (Free) or 100,000 (Paid); `check:bundle` enforces. [F-018]

Open item for S12: the mod UI iframe (opaque origin, D-26) must be compatible with `require-corp`; raised as risk R-S11-05.

## 3. Manifest and install (P-18)

- Generated at build by `vite-plugin-pwa` from `config/brand.ts` (`DISPLAY_NAME`, `SHORT_NAME`): `display: 'standalone'`, `start_url: '/'`, `scope: '/'`, colors from S10 tokens, icons from `@vite-pwa/assets-generator@2.0.0` including a maskable icon and an Apple touch icon. No `orientation` and no `display_override` (unsupported on iOS). [F-011, F-016]
- iOS 26: any site added to the Home Screen opens as a web app and nothing is required for installability, so install is a quality tier (standalone chrome, better `persist()` odds), not a gate. [F-004]
- **Chromium (desktop, Android, Quest):** capture `beforeinstallprompt`, expose "Install" in Settings.
- **iOS:** one-time coach mark "Share → Add to Home Screen" on the first main-menu visit in a Safari tab; dismissal is a per-viewer convenience (try/catch around `localStorage`); permanent entry in Settings › Install. Home Screen detection: `matchMedia('(display-mode: standalone)')` plus `navigator.standalone` when present (`UNVERIFIED`).
- `<meta viewport>` uses `viewport-fit=cover`; HUD and menus lay out against `env(safe-area-inset-*)`. [research/stack-rendering-platform.md §3.4]

## 4. Service worker (P-19)

```ts
// apps/web/vite.config.ts (illustrative)
VitePWA({
  strategies: 'injectManifest', srcDir: 'src', filename: 'sw.ts', registerType: 'prompt',
  injectManifest: { maximumFileSizeToCacheInBytes: 6 * 1024 * 1024 },
  manifest: brandManifest(),
})
```
- **Precache (shell only):** HTML, hashed JS and CSS, `/asset-catalog.json` (C07 `CatalogPointer`, so an offline relaunch finds its cached catalog), fonts, icons, the self-hosted decoders (basis 527,333 B, draco 285,747 B, meshopt 29 KB) and the Rapier SIMD wasm (3,292,228 B). The Workbox default limit is 2 MiB, so the limit is 6 MiB and anything larger is not precached; `check:bundle` fails if a precached file exceeds it. [research/stack-rendering-platform.md §6.5]
- **Runtime caches:** small immutable UI atlases and SFX on hashed URLs, `CacheFirst` with `workbox-expiration` (≈ 100 MB cap). Cutscene "Keep offline" per the gap report: full `200` CORS responses, `CacheFirst` with `RangeRequestsPlugin` (`workbox-range-requests@7.4.1`), caps 300 MB on mobile and 1 GB elsewhere, LRU by last play, never precached. [research/gap-cutscene-delivery-playback.md §7.5]
- **Never through the SW or Cache API:** chunk packs, glTF, KTX2, audio banks (the `asset.worker` + OPFS path, §5).
- **Navigation:** the precached `index.html` keeps the COOP/COEP headers received at install time; `/api/` and `/account/` are denied from the navigation route. `check:coi` asserts `crossOriginIsolated === true` after a service-worker-served reload.
- **Updates:** `onNeedRefresh` feeds the update controller; "Update ready" shows only at safe points and never reloads mid-mission.

```ts
export interface PwaUpdateController {
  readonly updateAvailable: boolean;
  markSafePoint(kind: 'menu' | 'mission-end' | 'safehouse' | 'loading'): void; // S01/S10 call
  markUnsafe(): void;
  applyNow(opts?: { force?: boolean }): Promise<void>;  // refuses while unsafe unless forced
  onChange(fn: (available: boolean) => void): () => void;
}
```
World content is content-addressed (§5) and updates independently of the shell.

## 5. World-pack store and asset fetch layer (P-20)

**Design.** Packs (≤ 4 MB typical, keyed by C07 `sha256`) are read whole, so the store is **content-addressed, one OPFS file per pack**, rather than the append-only block store of the reference port (that suited random 3 KB reads of huge archives). A new deploy changes only the hashes that changed, so unchanged districts survive updates. All OPFS access happens in `asset.worker` with `createSyncAccessHandle` (dedicated-worker-only). [research/repos-webport.md P3, P4; F-010]

```
OPFS  dv/packs/<sha256>.bin
IDB   dv-packs / packs  { sha256, bytes, kind, tags, createdAt, lastUsedAt, pinned }
IDB   dv-platform       { tier-decision, settings (PlatformSettings), pipeline-seeds, ... }    saves live in dv-saves (S01, C05), never OPFS
```
```ts
export interface PackRef { url: string /* BootConfig.hosts.media + C07 AssetVariant.key */; sha256: string /* C07 AssetVariant.sha256 */; bytes: number; kind: 'chunk' | 'tex' | 'mesh' | 'audio' | 'data'; tags?: string[] /* C07 tags, e.g. char:<npcId> */ }
export type PackFailure = 'offline' | 'http' | 'hash-mismatch' | 'quota' | 'aborted';
export class PackUnavailable extends Error { constructor(readonly reason: PackFailure, readonly ref: PackRef) { super(reason) } }
export interface StorageUsage { usageMB: number; quotaMB: number; persisted: boolean | null; packsMB: number; packs: number; cutscenesMB: number }
export interface WorldPackStore {
  open(): Promise<'opfs' | 'memory-fallback'>;
  has(hash: string): Promise<boolean>;
  get(ref: PackRef, o?: { priority?: 'now' | 'soon' | 'idle'; signal?: AbortSignal }): Promise<ArrayBuffer>;
  prefetch(refs: readonly PackRef[], priority: 'soon' | 'idle'): void;
  pin(hashes: readonly string[]): void;                    // boot set of the current manifest
  gc(current: ReadonlySet<string>): Promise<{ removed: number; freedMB: number }>;
  usage(): Promise<StorageUsage>;
  downloadAll(refs: readonly PackRef[], onProgress: (done: number, total: number) => void): Promise<void>;
  evictByTag(tag: string): Promise<{ removed: number }>;   // kill-switch path (S05 §5.5): drop every pack tagged char:<npcId>
  clear(): Promise<void>;
}
```
**Rules.**
1. *Write:* fetch → verify SHA-256 (`crypto.subtle.digest`) → write `<hash>.bin` through a short-lived sync handle → `flush()` → **commit = IDB row written after the flush**. A file without a row is an orphan (partial write), removed at startup or overwritten by the next fetch. A hash mismatch throws `PackUnavailable('hash-mismatch')` and nothing is committed.
2. *Read:* IDB row lookup, `getFile().arrayBuffer()`, size check, `lastUsedAt` update. A decode failure upstream purges the pack and refetches once.
3. *Eviction:* soft cap `WORLD_CACHE_SOFT_CAP_MB` (mobile 600, desktop 2,048: S11 targets), LRU among unpinned, plus eviction on `QuotaExceededError`. `gc(current)` drops packs absent from the current manifest and unused for 14 days (S11 target).
4. *Eviction by the OS:* a missing pack is a normal miss; S02 shows "re-downloading district". Whether OPFS suffers the 7-day non-use eviction is `UNVERIFIED`, so nothing assumes persistence.
5. *Persistence:* `navigator.storage.persist()` after the story starts or the app runs standalone for the first time; the result is logged (`storage.persist{granted}`). Settings › Storage shows `estimate()`, "Download San Francisco for offline (≈ N MB)" and "Clear downloaded data". Before `downloadAll`, require free quota ≥ 1.2 × bytes. [F-010]
6. *No OPFS:* `memory-fallback` keeps a 48 MB LRU of packs, marks the session online-only and emits `app.start{store:'memory'}`.
7. *Tabs:* writers retry sync-handle opens with jitter (up to 20 tries); a `BroadcastChannel('dv-instance')` shows "the game is open in another tab" and makes the second tab read-only. Cross-tab handle behaviour is `UNVERIFIED`.

**Fetch layer** (one shared `fetchRetry`): `fetch(url, { cache: 'no-store', priority })` in CORS mode; up to 8 attempts on 5xx, 429 or network error before the body is consumed, delay `min(5000, 300 × 2ⁿ) × (0.5 to 1.5)` ms; an error body is never stored; an in-flight map lets a demand `get` join a speculative prefetch; objects over 4 MB (cutscenes, audio banks) use Range slices aligned to 1 MiB. Lanes: `now` up to 8, `soon` up to `LANES`, `idle` 2, with `LANES` = 16 desktop, 8 mobile and XR (starting values; reference throughput numbers were host-specific, recalibrate in M11a). Safari supports `fetch` priority from 17.2. The CI headless run emits `bootset.<mode>.json` (`PackRef[]` in first-touch order); the client prefetches it from the main menu. [research/repos-webport.md P6, P7, rec 5]

## 6. iOS quirks and lifecycle (P-21)

| Quirk | Design rule |
|---|---|
| No element fullscreen on iPhone | Run standalone; hide fullscreen controls when `document.fullscreenEnabled` is false; `viewport-fit=cover`. |
| No orientation lock, no manifest `orientation` | "Rotate to landscape" overlay for on-foot, driving and fighting; menus work in portrait; listen to `screen.orientation` `change`; resize through `setSize` without recreating the renderer. |
| No haptics (`vibrate`, gamepad rumble absent) | `HapticsPort` is a no-op on iOS; cues are visual and audio. |
| No Pointer Lock | Touch look on the right half; drag deltas. |
| No `requestIdleCallback`, no `scheduler.yield`, no `deviceMemory` | `idle()` wrapper over `MessageChannel`/`setTimeout`; tiering via benchmark. |
| Audio gated by gesture and ringer switch | `FirstGestureUnlock` (§7); `navigator.audioSession.type = 'playback'` when present (medium confidence); resume on `visibilitychange`. |
| WebContent killed near 2,048 MB, GPU process separate | Budgets (part A §4.5), `MemoryBudget`, heartbeat, tier demotion (§9). One encoder per frame. |
| rAF near 60 Hz | Plan 60; never promise 120. |
| Background suspension | See lifecycle below. |
| Wake Lock (18.4) | Held during cutscenes and races; re-acquired on `visible`. |
| Gamepad API works, no rumble | Standard mapping; MFi and console pads. |
| Safari tab vs Home Screen WebGPU parity | `UNVERIFIED`; M01c and M11a run both. |

**Lifecycle.** `LifecycleController` handles `visibilitychange` and `pagehide`. On hidden: pause the sim, post C02 `SimControlMessage {t:'save.request', reason:'hidden'}` on the command ring (`sim.worker` runs `SaveService` outside ticks, C02 rule 9; it writes only when C05 rule 4 eligibility holds), set heartbeat `hidden`, flush telemetry with `sendBeacon`, release Wake Lock, suspend audio. On visible: resume `AudioContext` (show "Tap to resume" if interrupted), re-acquire Wake Lock, clamp the first `dt`, verify the GPU device is alive, re-open sockets (M12). Sources: [research/stack-rendering-platform.md §3.5; research/gap-cutscene-delivery-playback.md §3.3].

## 7. First-gesture unlock and flat cutscene hosting (P-22)

`FirstGestureUnlock` is the single handler on the title screen's first `pointerup`, `touchend` or `keydown`: create or resume the `AudioContext`, set the audio session type, and unlock a **pool of three** `<video>` elements (`muted playsinline disableRemotePlayback crossorigin="anonymous" preload="auto"`) by playing a 0.1 s same-origin blank clip then pausing. S03's `CutscenePlayer` and in-world video textures reuse the pool; cutscene video elements are never created later. Under iOS Low Power Mode any video needs a gesture, and an unlocked element keeps working with a new `src` (WebKit source reading; shipping behaviour `UNVERIFIED`, device test in the M04c cutscene spike). [F-063; research/gap-cutscene-delivery-playback.md §3.1]

Flat hosting (desktop, iPhone): a DOM `<video>` overlay above the canvas with `object-fit: contain` on black; the host stops `renderer.setAnimationLoop` and pauses the sim while it covers the screen and keeps GPU resources resident for an instant resume; Wake Lock is mandatory on mobile (muted video lets the screen sleep). Memory: ≤ 1 decoding plus ≤ 1 pre-rolled element, released with `removeAttribute('src'); load()`; the `media` line in `MemoryBudget` is 64 MB on mobile tiers. Rendition choice (`v768` or `v540` when `dataSaver` or measured throughput < 4 Mbps) is S03's rule using `PlatformSettings.dataSaver`. Fallback triggers F1 to F10 belong to S03. [research/gap-cutscene-delivery-playback.md §3, §4, §7.3]

## 8. WASM policy (P-17)

1. Every module is wasm32. No memory64 (Safari flag only), no relaxed SIMD, no multi-memory, no dependency on JSPI (Safari 27 only).
2. SIMD128 is allowed on all targets: ship `@dimforge/rapier3d-simd-compat@0.21.0` for free-roam physics (the `-deterministic` build only where S01 mandates it; one build per simulation). [D-12, F-014]
3. No wasm pthreads in v1. Rapier and MediaPipe tasks-vision 1.1.1 are single-thread builds; SharedArrayBuffer is used for JS-side blocks only. A threaded Jolt build would need an ADR. [F-057]
4. Basis, Draco and meshopt decoders are self-hosted same-origin from the three npm package; the mp4box dependency for `VideoFrameTexture` is vendored (no runtime CDN import). `check:headers` asserts `Content-Type: application/wasm` for every `.wasm`.
5. `WasmCaps` probes SIMD and exceptions with `WebAssembly.validate` on tiny modules and reports them in `app.start`.

## 9. Telemetry and crash client (P-28)

`packages/engine/src/platform/telemetry/` implements the client half of C16 (shape owned by S09: `{ name, ts, sessionId, props }`; batches ≤ 50 events and ≤ 64 KB to `POST /api/v1/t`, `sendBeacon` on hidden and `pagehide`). The sketch measured 919 B gzip. [research/gap-observability-cost-guardrails.md Rec 1]

```ts
export interface HeartbeatRecord {
  v: 1; sid: string; t: number; state: 'running' | 'hidden' | 'closed';
  scene: string; mode: string; chunkKey: string | null; tier: QualityTierId; backend: RenderBackend;
  memEstMB: number; gpuEstMB: number; build: string; ring: string[]; // ≤ 20 events, record ≤ 4 KB
}
export interface Telemetry {
  emit(name: TelemetryName, props?: Record<string, string | number | boolean>): void;
  heartbeat(patch: Partial<HeartbeatRecord>): void;
  setConsent(c: { diagnostics: boolean; analytics: boolean }): void;   // events dropped client-side when off
  flush(reason: 'hidden' | 'pagehide' | 'interval'): void;
}
```
- **Abnormal exit:** at boot read `localStorage['dv.hb']` synchronously. `running` → emit `app.abnormal_exit` with the persisted context; `hidden` → `app.cold_resume` (normal on iOS, not a crash). While visible rewrite every 5 s and on scene, mode or chunk change; `hidden` and `closed` on the lifecycle events. Navigation type `reload` plus `running` is a hint only. The record is always written locally; it is **sent** only with Diagnostics consent. [research/gap-observability-cost-guardrails.md §2.2]
- **Demotion:** two `app.abnormal_exit` within 24 h on the same tier with `memEstMB` > 0.8 × (`maxAccountedHeapMB` + `maxGpuResourceMB`) lower the tier one rung (floor `mobile-low`), record `TierDecision{source:'abnormal-exit-demotion'}`, and show a one-time notice; the player can raise it in Settings. Thresholds are S11 targets.
- **Errors:** `onerror`, `unhandledrejection` (fingerprint dedupe ≤ 5 per session), `renderer.onDeviceLost`, uncaptured GPU errors, `err.asset`. A rAF stall watchdog writes `raf.stall` to the ring after 5 s.
- **Events emitted by S11:** `app.start{nav, coi, store, backend, tier}`, `app.ready{bootMs}`, `app.hidden`, `perf.minute{fpsP50, fpsP5, frameP95Ms, drawCalls, tris, texMBEst, gpuMBEst, memEstMB}` (100 % mobile and XR, 25 % desktop), `err.*`, `xr.session{evt, fps}`, `tier.decision{tier, source, benchP90Ms}`, `settings.tier_override`. `tier.decision` and `storage.persist` are in the C16 registry (DL-025).
- **Privacy:** no IP, user agent, `profileId`, free text or finer-than-chunk position; `sessionId` is a random UUID per launch; props ≤ 16 keys, strings ≤ 128 chars; URL query strings, emails and tokens scrubbed. Desktop Chrome additionally gets Reporting-API crash reports through a `Reporting-Endpoints` header set by the edge Worker.

## 10. Facts, milestones, tests

**Facts used** (see part A §7 for shared rows; checked 2026-10-18): F-004, F-009, F-010, F-011, F-012, F-014, F-016, F-018, F-019, F-057, F-063, F-064; plus rows below.

| Fact | Source |
|---|---|
| Workbox `maximumFileSizeToCacheInBytes` default 2,097,152; `workbox-range-requests@7.4.1` exists | unpkg.com/workbox-build@7.4.1 `GenerateSWOptions.json` · registry.npmjs.org/workbox-range-requests |
| Rapier SIMD wasm 3,292,228 B; three ships basis (527,333 B), draco (285,747 B), meshopt (29 KB) decoders | [research/stack-rendering-platform.md §1.6, §5.1] |
| Safari: SAB 15.2, OPFS sync handles 15.2 (dedicated workers only), Wake Lock 18.4, `audioSession` 16.4; no `requestIdleCallback`, no `deviceMemory` | BCD 8.1.6 · MDN createSyncAccessHandle |
| Fetch `priority`: Safari 17.2+ (medium confidence) | caniuse wf-fetch-priority |
| Heartbeat design, `GPUDevice.lost` 26.0+, `sendBeacon` 11.3+, Safari lacks crash reports | gap-observability §2 |
| Cloudflare: `_headers` rules and Worker-response exception; media objects need CORS; origin range fetches align to 1 MiB; Worker-generated 206 is not cached | developers.cloudflare.com/workers/static-assets/headers · /cache/reference/range-requests |
| vite 8.3.4, vite-plugin-pwa 2.0.0, workbox 7.4.1, assets-generator 2.0.0 | registry.npmjs.org (F-016) |

**Milestone detail.** *M00:* §2, §3, §4 (stub update UI), `check:headers`, `check:coi`, `check:bundle`, empty telemetry sink. *M01c:* §6 lifecycle, §7 unlock (audio only), §9 heartbeat and memory-bomb page. *M01e:* §5 complete with CI integration test. *M04a:* coach mark, Settings › Install and Storage. *M04c cutscene spike:* §7 video pool, Wake Lock, flat host. *M11a:* offline relaunch, safe-point updates, demotion, 30-minute soak, lane calibration.

**Tests.**
1. `check:headers -- <url>`: COOP, COEP, CORP on `/`, `/assets/*.js` (immutable), `/sw.js`; `application/wasm`; `/account/` has no COEP; a Worker route carries all three.
2. `check:coi`: `crossOriginIsolated` true on first load and after a SW-served reload (Chromium, WebKit).
3. `pwa-installability.spec.ts`: manifest name equals `DISPLAY_NAME`, `display: standalone`, maskable icon present, no `orientation`; SW registered; precache contains the Rapier wasm and no file over 6 MiB.
4. `sw-update.spec.ts`: new build raises `updateAvailable`; `applyNow()` refuses while unsafe; applied at a safe point; isolation still true.
5. `pack-store.spec.ts` (Chromium, WebKit): write/read, hash mismatch rejected, orphan cleanup, pinned LRU eviction, quota error, memory fallback, dedupe of concurrent `get`, `fetchRetry` backoff against injected 503s.
6. `offline-relaunch.spec.ts`: after warm-up and `context.setOffline(true)`, reload reaches the menu and starts single-player from pinned packs (M11a).
7. `lifecycle.spec.ts`: `visibilitychange` to hidden requests the eligible `hidden` autosave within 100 ms and sets heartbeat `hidden`.
8. `heartbeat.spec.ts`: state machine, `cold_resume` not counted, two abnormal exits demote one rung, Diagnostics off sends nothing.
9. `telemetry-privacy.spec.ts`: payload keys and lengths within limits; no IP, UA or profile id.
10. Device (iPhone 15, 16/17; Home Screen and Safari tab): `crossOriginIsolated`; `persist()` and `estimate()` recorded; rotate overlay; coach mark; audio after gesture; memory-bomb outcome recorded in `device-notes.json`; 30-minute soak with no tab reload (M11a).
