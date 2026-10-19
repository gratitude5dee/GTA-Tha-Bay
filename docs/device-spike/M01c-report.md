# M01c device spike report

Status: **template filled for everything a CI runner can observe; every device row is NOT RUN (device check pending, Q-13).**
Written 2026-10-19 by the Builder. The device rows are filled by the operator from `pnpm perf:checklist -- tools/ci/checklists/M01c-<device>.json`; captured `perf.json` and `notes.json` go under `docs/device-spike/M01c/<device>/`.

## Decision: `webgpu.mobile` (DN-S11-01, AC-14)

| Item | Value |
|---|---|
| `config/platform-flags.json` `webgpu.mobile` | `false` |
| Reason | The iPhone 15 Home Screen WebGPU run (`?perf=1&tier=mobile-low&gpu=1`, 30 minutes) has not been done. The flag flips to `true` only if that run has no abnormal exit and its p90 is at most `frameBudgetMs` (33.3 ms at `mobile-low`). |
| Until then | `mobile` and `mobile-low` build the renderer with `forceWebGL: true`; `?gpu=1` (QA builds) lifts that for the spike. |

## Device matrix

| Role | Device and software | Tier | Result | Notes |
|---|---|---|---|---|
| iPhone floor | iPhone 15, iOS 26.x, Home Screen app | `mobile-low` (30 fps) | NOT RUN (device check pending) | AC-12, AC-14: `M01c-iphone15.json` |
| iPhone primary | iPhone 16 or 17 | `mobile` (60 fps) | NOT RUN (device check pending) | `M01c-iphone16.json` |
| Quest | Quest 3 and 3S, Quest Browser | flat page, backend `webgl2` expected | NOT RUN (device check pending) | AC-13: `M01c-quest3.json` |
| Vision Pro | visionOS 26.2 or newer, Safari | flat page | NOT RUN (device check pending) | AC-13: `M01c-visionpro.json` |
| Mac | Apple Silicon, Chrome and Safari 26+ | `desktop` | NOT RUN (device check pending) | AC-13: `M01c-mac.json` |

The fixtures under `tools/ci/fixtures/ua/*.json` are still synthetic (`"synthetic": true`), written from the rules of 11-platform.md section 5.2. Captured `DeviceSignals` replace them in AC-13; the `expect` blocks stay.

## Memory bomb (AC-12)

| Device | Last stored total (`localStorage['dv.membomb']`) | Phase at the kill | Heartbeat after relaunch | `app.abnormal_exit` in the next batch |
|---|---|---|---|---|
| iPhone 15 | NOT RUN | | | |
| iPhone 16 or 17 | NOT RUN | | | |

## What CI observed (software renderers; frame times are never asserted)

Recorded by `pnpm check:e2e` and `pnpm check:perf -- --fail` on the Builder machine, 2026-10-19.

| Project | `navigator.gpu` | Adapter | Backend selected |
|---|---|---|---|
| `chromium-webgpu` (SwiftShader flags) | yes | vendor `google`, architecture `swiftshader`, `isFallbackAdapter: true`, `maxTextureDimension2D` 8192; features include `texture-compression-astc/bc/etc2` and `timestamp-query` | `webgpu` |
| `chromium-webgl2` | yes in Chromium, no adapter without the flags | none | `webgl2` |
| `webkit-webgl2` (Linux) | no | none | `webgl2` |

`desktop-ultra` is never chosen on the SwiftShader adapter: it is a fallback adapter (`isFallbackAdapter: true`) and the promotion rule needs a real one.

`check:perf -- --fail`, graybox-walk (6 s after 2 s warm-up), counts per view pass; every row is under its tier budget:

| Tier | Render objects (max / budget) | Triangles (max / budget) | `renderer.info.render.drawCalls` max (WebGL2) |
|---|---|---|---|
| `desktop-ultra` | 720 / 900 | 4,723,200 / 6,000,000 | 721 |
| `desktop` | 480 / 600 | 3,148,800 / 4,000,000 | 481 |
| `mobile` | 120 / 150 | 787,200 / 1,000,000 | 121 |
| `mobile-low` | 80 / 100 | 474,240 / 600,000 | 81 |

Same numbers on `chromium-webgl2` and `webkit-webgl2`. AC-6: the meter's maximum triangle count was 3,148,800 against 3,148,801 from `renderer.info.render.triangles` at `desktop` (ratio 1.000).

## Observations for the Architect (never asserted)

| Id | Observation |
|---|---|
| U-PLT-1 iOS Home Screen vs Safari-tab WebGPU parity | NOT RUN. Needs the iPhone 15 (`M01c-iphone15.json` steps 7 to 9). |
| U-PLT-2 GPU-process jetsam limit, 2,048 MB WebContent kill | NOT RUN. The memory bomb records the total at the kill. |
| U-PLT-4 post-jetsam behaviour | NOT RUN. The heartbeat record and the next boot's batch are the evidence. |
| U-PLT-6 `adapter.info` on Safari | NOT RUN on Safari. On the Chromium SwiftShader adapter `info` has vendor `google`, architecture `swiftshader`, empty `device` and `description`. `DeviceProbe` stores empty strings for missing fields. |
| U-PLT-7 Safari `timestamp-query` | NOT RUN on Safari. Chromium SwiftShader lists `timestamp-query`. GPU timers stay optional (`trackTimestamp` is false). |
| U-PLT-9 visionOS user agent | NOT RUN. The classifier keys on capabilities (`hasNavigatorXr`, `immersiveVrSupported`, `hasXrGpuBinding`, no touch). |
| U-PLT-14 `info.render.drawCalls` with `BundleGroup` on WebGPU | Not measured: the benchmark and graybox scenes use plain meshes without `BundleGroup`. On WebGL2 `drawCalls` equals render objects plus one (the background). The report records `gpuDrawCmdsMax: null` on the WebGPU backend by design. |
| U-PLT-15 `navigator.standalone` | `DeviceProbe` reads `matchMedia('(display-mode: standalone)')` first and `navigator.standalone` second. NOT RUN on a Home Screen app. |
| U-PLT-18 iPhone RAM sizes | NOT RUN. `deviceMemory` is absent on Safari; tiers come from the benchmark and `hardwareConcurrency <= 4`. |
| U-ENG-5 Quest A/B/X/Y indices | NOT RUN. M01c has no XR session. |
| U-ENG-8 iOS PWA background-suspension timing | NOT RUN. The heartbeat distinguishes `hidden` (`app.cold_resume`) from `running` (`app.abnormal_exit`). |

## How to finish this report

1. Run each checklist on its device and commit `perf.json` and `notes.json` under `docs/device-spike/M01c/<device>/`.
2. `pnpm perf:verify -- docs/device-spike/M01c/iphone15/perf.json --tier mobile-low --checklist tools/ci/checklists/M01c-iphone15.json` must pass (AC-12).
3. Replace the synthetic UA fixtures with the captured signals (AC-13) and run `pnpm check:unit -- packages/shared`.
4. Decide `webgpu.mobile` per the table above and edit `config/platform-flags.json` only if both conditions hold.
