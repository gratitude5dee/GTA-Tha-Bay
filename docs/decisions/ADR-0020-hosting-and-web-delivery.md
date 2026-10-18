# ADR-0020 — Hosting, PWA shell and asset delivery

**Status:** accepted · **Date:** 2026-10-18 · **Decides:** spec/03 D-01, D-16, D-17; R-PLAT-01

## Context
The game needs `SharedArrayBuffer` (cross-origin isolation) for the sim transport, large binary assets with HTTP Range, an installable PWA that survives iOS storage rules, and one hosting vendor for web, API, Durable Objects and storage. Cloudflare's own guidance is to start new projects on Workers rather than Pages [research/stack-cloudflare-backend.md §1.1].

## Options considered
1. **Cloudflare Pages.** Not deprecated, but new projects are steered to Workers; custom domains outside Cloudflare zones are Pages-only, which does not apply because DNS moves to Cloudflare anyway.
2. **Another static host plus Workers for the API.** Splits headers, previews and deploys across vendors; `_headers` and previews already exist on Workers static assets [F-061].
3. **Workers with static assets, one deployable per concern** (chosen).

## Decision
**Hosting (D-01).** `tha-bay-web` serves the SPA with `assets.not_found_handling = "single-page-application"` and `run_worker_first: ["/api/*"]`, so API paths hit the Worker while navigations are served as assets; M12a1 adds `/.well-known/*` for the issuer's JWKS (DL-185). Workers Paid ($5/month) from M00; static asset requests are free and egress is free [F-018]. Static files are capped at 25 MiB each [F-018].
- COOP `same-origin`, COEP `require-corp` and CORP in `_headers`, **and in code on every Worker response**, because `_headers` is not applied to Worker-generated responses [F-019]. `/account/*` is the only non-isolated path (provider redirects). Cross-origin media is fetched in CORS mode; no third-party iframe sits inside the app. After a service-worker-served reload, `crossOriginIsolated` is re-checked (`check:coi`).
- Media origin `media.<domain>` is an R2 custom domain with CORS (`GET, HEAD`; exposed `Content-Length`, `Content-Range`, `Accept-Ranges`, `ETag`); objects are immutable (`Cache-Control: public, max-age=31536000, immutable`); R2 egress is free [F-023].
- Previews per pull request use Workers Previews (ADR-0025) [F-061].

**PWA (D-16).** Vite 8.3.4 with `vite-plugin-pwa` 2.0.0 (`injectManifest`, `registerType: 'prompt'`) [F-016]. The service worker precaches the **app shell only** (HTML, hashed JS/CSS, fonts, icons, wasm decoders, Rapier), with `maximumFileSizeToCacheInBytes` raised to 6 MiB because Rapier SIMD wasm is 3.29 MB; world packs (≤ 4 MiB) go through `asset.worker` and OPFS, not the service worker. iOS: a coach mark replaces the missing install prompt [F-011]; `navigator.storage.persist()` is requested after the story starts and OPFS is never assumed durable, since quota is a share of disk and eviction heuristics apply [F-010]; the WebContent process dies near 2 GB, so the accounted cap on `mobile` is 600 MB [F-009]; frame rate is capped at 60 Hz.

**Assets (D-17).** glTF with meshopt compression (`@gltf-transform/cli` 4.5.1) and KTX2 textures (UASTC for quality, ETC1S for size) transcoded at load to ASTC on Apple and Quest or BC7 on desktop; KTX-Software 4.4.2 [F-017]. `.glb` and `.ktx2` are not in Cloudflare's default compression list, and Cloudflare ignores `Range` when it must decompress, so these files are served identity-encoded and rely on in-format compression [F-019]. Object keys are `<root>/<variant>.<sha256[0:12]>.<ext>` with a catalog `manifests/assets-<sha256>.json` behind `/asset-catalog.json` (C07).

## Consequences
- (+) One vendor and one deploy tool for web, API, rooms and storage; no egress bill; previews on every PR.
- (+) Immutable hashed keys make caching, rollback and prefix purge simple.
- (−) Isolation headers must be remembered on every Worker response; `check:headers` and `check:coi` guard it.
- (−) iOS can evict storage, so every pack must be re-fetchable; offline play is limited to what is cached.
- (−) Home Screen versus Safari-tab WebGPU parity and the real GPU-process limit are UNVERIFIED (U-PLT-1, U-PLT-2); M01c and M11a measure them.

## Affected contracts and milestones
C13 (`WorldPackStore`, `PwaUpdateController`, precache rules), C07 (keys, catalog), C12 (`BootConfig.hosts`). M00 (shell, headers), M00a (Worker), M01d (`assets:publish`), M01e (`asset.worker`, OPFS), M04b1 (coach mark, storage), M11a (offline relaunch).

## Links
`research/stack-cloudflare-backend.md` §1.1–1.2; `research/stack-rendering-platform.md` §3, §6.5; `spec/domains/11-platform-pwa.md`; `09-backend-ops.md` §1; `spec/11-decision-log.md` DL-016, DL-042; ADR-0017, ADR-0025.
