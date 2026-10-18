# S11 — Platform, part D: performance harness, test projects, device matrix

> Wave 1 · v0.1 · 2026-10-18 · continues `11-platform.md`. Covers R-ENG-02 (budgets as automated checks) and the verification half of R-PLAT-05. Checklist items P-29 to P-31. Sections: §3 components · §4 data · §5 runtime (what is measured and how) · §6 device matrix · §7 facts · §9 tests and checklists · §10 open questions.

## 3. Components

| Module | Path | Role |
|---|---|---|
| `RenderBudgetMeter` | `packages/engine/src/platform/perf/` | backend-independent per-frame counts |
| `PerfProbe` | same | frame-time ring (Float32Array, 36,000 samples), percentiles, hitch counters |
| `PerfHud` | same | `?perf=1` overlay: fps, p95, objects, triangles, texture and GPU MB, accounted heap, tier, backend, governor state, XR refresh |
| `PerfScenarioRunner` | same | runs a canned camera path with a seeded sim and writes `PerfReport` |
| `window.__dvBridge.platform` | same (QA builds only) | `tier()`, `backend()`, `setTier(id)`, `gpuProbe()`, `memory()`, `perf.run(id)`, `perf.report()`, `xr.enterForTest()`, `xr.exit()`, `xr.state()` |
| `perf-check`, `perf-verify`, `perf-checklist` | `tools/ci/` | `check:perf`, `perf:verify`, `perf:checklist` |

## 4. Data

```ts
export interface PerfScenario {
  id: string;                         // 'graybox-walk' (S01 engine graybox, pre-world, DL-065) | 'walk-civic-center' | 'route-ferry-ocean-beach' | 'downtown-rush' | 'fight-stage' | 'xr-walk'
  pathRef: string;                    // camera path file owned by the scenario's milestone (S02, S06, S07)
  durationS: number; warmupS: number; seed: number;
  density: 'off' | 'nominal';         // traffic and peds at the tier budget
}
export interface PerfReport {
  v: 1; build: string; c13: string; createdAt: number /* epoch ms */;
  device: { class: DeviceClass; browser: string; model?: string; uaHash: string;
            adapter: AdapterSummary | null; displayMode: DisplayMode; refreshHz: number | null };
  tier: QualityTierId; backend: RenderBackend; governor: 'on' | 'off'; scenario: PerfScenario;
  frames: { count: number; medianMs: number; p95Ms: number; p99Ms: number; maxMs: number;
            over50ms: number; over2xBudget: number };
  counts: { renderObjectsMax: number; renderObjectsP95: number; gpuDrawCmdsMax: number | null;
            trianglesMax: number; texturesMB: number; gpuResourcesMB: number };   // per view-pass
  memory: { accountedHeapMBMax: number; mediaMBMax: number; webContentEstMB: number | null };
  dynamic: { minRenderScale: number; downgrades: number; upgrades: number; tierChanges: number };
  boot: { warmBootToPlayableS: number | null; coldDownloadMB: number | null };
  errors: { gpuLost: number; uncaptured: number; js: number };
}
export interface Expectation { metric: string; op: '<=' | '>=' | '==' ; value: number | string | boolean }
export interface DeviceChecklist {
  id: string; milestone: string; device: string; urlTemplate: string;   // e.g. https://<preview>/?perf=1&tier=mobile-low
  steps: { id: string; instruction: string; expect?: Expectation[] }[];
  upload: ('perf.json' | 'notes.json')[];
}
```
`PerfReport` is validated by JSON Schema `tools/ci/schemas/perf-report.v1.json` (required: all top-level keys above; `v` const 1; numbers non-negative). `notes.json` is free-form operator output (UA string, `persist()` result, observed behaviour after the memory bomb, button indices).

QA flags (`QaFlags`, the single parser owned by S11, parsed only when `VITE_DV_QA=1`, i.e. dev, test and preview builds): platform `?tier=`, `?gl=1`, `?gpu=1`, `?perf=1`, `?governor=off`, `?limits=name:value`, `?xr-emulate=quest3`, `?scenario=<id>`; engine (S01, passed through to `sim.worker`) `?debug=1`, `?seed=`, `?profile=canonical`, `?mission=`, `?stage=`, `?unlockAll=1` (DL-064). Production builds ignore all URL flags.

## 5. Runtime: what is measured and how

**Frame time.** Flat tiers: `requestAnimationFrame` timestamp deltas of *rendered* frames; XR: `XRFrame` deltas. GPU timers only if `trackTimestamp` works (Safari support `UNVERIFIED`; never required).

**Render objects.** `RenderBudgetMeter` counts, once per rendered frame in measuring mode, the visible (ancestors visible, layers enabled, frustum-tested) `Mesh`, `SkinnedMesh`, `InstancedMesh`, `BatchedMesh`, `Points`, `Line` and `Sprite` nodes, adding one per shadow pass for each shadow-casting renderable (cascades × casters). It also sums triangles from geometry index counts × instances. This is backend-independent because `info.render.drawCalls` with `BundleGroup` on the WebGPU backend is `UNVERIFIED`. `renderer.info` (r186: `render.drawCalls`, `render.triangles`, `memory.texturesSize`, `memory.total`, with `autoReset = false` and a manual `reset()`) is authoritative for draw commands, texture MB and GPU MB on WebGL2 projects, and `meter-agrees-with-info.spec.ts` asserts triangles agree within ±10 % there. [S11-F1]

**Memory.** `MemoryBudget` accounted bytes (part A §5.6); nightly Chromium cross-check with `performance.measureUserAgentSpecificMemory()` (needs isolation; informational). iPhone process memory is not observable, so the memory-bomb page and the heartbeat give the empirical ceiling.

**Boot.** Cold download MB = sum of response bytes for the first-district boot set on an empty cache (Playwright network accounting, automated); warm boot seconds to the reveal gate are measured on devices only.

**Budgets as tests** (every row of part A §4.5 has a check):

| Budget | Automated check | Where | Mode |
|---|---|---|---|
| Render objects, triangles | `RenderBudgetMeter` max over scenario ≤ budget × passes | `check:perf` on `chromium-webgl2`, `webkit-webgl2`, `chromium-webgpu` | warn on PR, fail nightly |
| GPU draw cmds | `info.render.drawCalls` ≤ budget | WebGL2 projects only | same |
| Texture MB, GPU MB, accounted heap, media MB | `info.memory`, `MemoryBudget` ≤ caps | all projects | same |
| Streaming radius, draw distance, upload cadence | S02 route test: ≤ 1 chunk upload per frame; draw distance equals tier value | `check:e2e` | fail |
| Variant resolution | `VARIANT_FALLBACK` resolves for six tiers | `check:assets` | fail |
| Cold download | Playwright bytes ≤ `coldBootDownloadMB` per `?tier=` | `check:perf` | fail |
| Frame time (fps), warm boot, thermal, true memory | device pass with `perf.json` | `perf:verify` | release gate per milestone |

CI runs on SwiftShader, so frame-time numbers there are never asserted. [research/gap-ci-cd-release-assets.md §4.1]

**Weak-device emulation.** `?limits=name:value` lowers `requiredLimits`/adapter limits in QA builds; the engine requests only `GPU_LIMITS_NEEDED`, so a fallback adapter still starts. [research/repos-webport.md P15]

**`perf:verify -- <perf.json> --tier <id> [--checklist <file>]`** asserts: counts and memory ≤ budget (per pass); `medianMs ≤ frameBudgetMs × 1.05`; `p95Ms ≤ × 1.5`; `over50ms ≤ durationS / 60` (XR: `over2xBudget`); `errors.gpuLost == 0`; boot ≤ budgets; every checklist expectation. It prints one line per assertion and exits non-zero on failure.

## 6. Device matrix (P-31)

| Role | Device and software | Tier | When |
|---|---|---|---|
| iPhone floor (Q-10) | iPhone 15, iOS 26.x then 27.x; Home Screen app and Safari tab | mobile-low (30 fps) | M01c, M04c cutscene spike, M11a, release |
| iPhone primary | iPhone 16 or 17 | mobile (60 fps) | same |
| iPhone memory probe | an iPhone with 12 GB if available (17 Pro class) | mobile | M01c, M11a |
| Quest | Quest 3 and 3S, current Quest Browser | xr-quest (72/90) | M01c, M11b |
| Vision Pro | Vision Pro, visionOS 26.2 then 27 | xr-visionpro (90) | M01c, M11b |
| Desktop A | Apple Silicon Mac: Chrome and Safari 26/27 | desktop | M01c, M11a |
| Desktop B | Windows laptop with integrated GPU, Chrome | desktop (weak) | M11a |
| Desktop C | Windows desktop with discrete GPU, Chrome | desktop-ultra | M11a |
| CI | `ubuntu-24.04`: `chromium-webgpu` (SwiftShader), `chromium-webgl2`, `webkit-webgl2`, `xr-quest3` (IWER) | all tiers via `?tier=` | every PR |

Device availability is open question Q-13 (`spec/99-open-questions.md`; was Q-S11-01). Cloud devices (BrowserStack real iOS Playwright) are optional for Safari-tab regression only; WebGPU, WebXR and Home Screen mode there are undocumented. [research/gap-ci-cd-release-assets.md §4.3]

## 7. Facts used

F-007, F-009, F-013, F-062, S11-F1 (part A §7). Plus (checked 2026-10-18): Playwright 1.64.1 bundles Chromium 156.0.8078.4 and WebKit 27.2; headless Chromium has no WebGPU adapter by default; with `--enable-unsafe-webgpu --enable-features=Vulkan --use-angle=swiftshader --use-vulkan=swiftshader` it gets a SwiftShader adapter and renders; WebKit on Linux has no `navigator.gpu` or `navigator.xr`; WebKit screenshots need a running render loop; IWER 2.6.0 must be installed before the renderer and with `forceInstall: true` on Chromium. [research/gap-ci-cd-release-assets.md §4.1, §4.2; local measurements]. The SwiftShader recipe on a real GitHub runner is `UNVERIFIED` until the M00 `gpu-probe.json` artifact exists.

## 9. Tests

**Playwright projects** (single `playwright.config.ts`, defined by the CI report R2; S11 adds the flags above):
```ts
const SWIFTSHADER_WEBGPU = ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--use-vulkan=swiftshader'];
projects: [
  { name: 'chromium-webgpu', use: { browserName: 'chromium', launchOptions: { args: SWIFTSHADER_WEBGPU } } }, // backend === 'webgpu'
  { name: 'chromium-webgl2', use: { browserName: 'chromium' } },                                              // automatic fallback → 'webgl2'
  { name: 'webkit-webgl2',   use: { browserName: 'webkit' } },                                                // Safari-engine proxy
  { name: 'xr-quest3',       use: { browserName: 'chromium' }, grep: /@xr/ },                                 // IWER via addInitScript
]
```
Rules: assert on state (backend, frames, counts, hashes), not pixels; pixel goldens only at 128 to 256 px with tolerance; WebKit screenshots only while the render loop runs; IWER is installed before the app boots.

**Platform specs.**
1. `gpu-probe.spec.ts` (M00): writes `gpu-probe.json` `{ adapter, architecture, isFallbackAdapter, features, limits, backend, threeRevision }`; `chromium-webgpu` reports backend `webgpu`, `chromium-webgl2` reports `webgl2`.
2. `device-classify.spec.ts` (unit): fixtures under `tools/ci/fixtures/ua/` (desktop Chrome, desktop Safari, iPhone Safari, Quest Browser, Vision Pro Safari) classify to the expected class, tier and headset; `FLAT_LADDER` and `FLAT_TIER_OF` consistent.
3. `tier-select.spec.ts`: provisional tiers per profile; benchmark step-down with injected frame times; stored decision reused until `build` changes; `?tier=` ignored in production builds.
4. `renderer-host.spec.ts`: init with `forceWebGL`; fallback retry after a forced WebGPU init failure; `onDeviceLost` triggers one recovery and re-registers owners; second loss shows the reload prompt.
5. `governor.spec.ts`: simulated frame series: downgrade at p90 > 1.15 × budget for 2 s, upgrade after 10 s below 0.70, no more than one change per 5 s, knob order respected, XR never touches `renderScale`.
6. `memory-budget.spec.ts`: soft event at 85 %, hard at 95 %, eviction callbacks invoked.
7. `frame-pacer.spec.ts`: 30 fps target on 60 Hz and on 90 Hz timestamps renders every 2nd and 3rd callback within ±1 ms.
8. `perf-budget.spec.ts`: for each `?tier=` and project, run `walk-civic-center` (later `route-ferry-ocean-beach`) and assert the table in §5.
9. `meter-agrees-with-info.spec.ts` and `boot-download.spec.ts` as described above.
10. `check:perf` aggregates specs 8 to 9; `check:e2e` runs 1 to 7 on the three flat projects; `check:e2e:xr` runs the XR specs of part B.

**Device passes.** `pnpm perf:checklist -- tools/ci/checklists/<M##>-<device>.json` prints the scripted steps and URLs; the operator runs them, exports `perf.json` and `notes.json` from the bridge, uploads both as release assets; `pnpm perf:verify` decides. Checklist content per milestone: M01c (iPhone, Quest, Vision Pro, desktop spike: backend actually selected, UA fixtures, `adapter.info`, 10-minute gray-box run, memory bomb, `persist()`), M04c cutscene spike (gap report §7.7), M11a (`mobile` and `mobile-low` budgets, 30-minute soak, offline relaunch, Low Power Mode on and off, thermal observation), M11b (part B §9 item 8).

**Acceptance criteria proposed to S13** (each with proof):
- M00 AC-P1: Given a Preview URL When `pnpm check:headers -- <url>` and `pnpm check:coi -- <url>` run Then isolation headers are present and `crossOriginIsolated === true` after a SW-served reload — proof: those commands.
- M00 AC-P2: Given the e2e artifacts When `chromium-webgpu` and `chromium-webgl2` finish Then `gpu-probe.json` shows backend `webgpu` and `webgl2` respectively; `xr-quest3` reports ≥ 10 XR frames — proof: `pnpm check:e2e` and `pnpm check:e2e:xr`.
- M01c AC-P3: Given an iPhone 15 Home Screen app When `?perf=1&tier=mobile-low` runs the gray-box scenario for 10 minutes Then `perf:verify` passes at 30 fps and no abnormal exit is logged — proof: manual checklist `M01c-iphone15.json` then `pnpm perf:verify`.
- M11a AC-P4: Given each flat tier and the route scenario When `pnpm check:perf` runs in fail mode Then every row in §5 passes; on iPhone 15 and 16/17 `perf:verify` passes and a 30-minute soak shows no tab reload — proof: command plus manual checklist.
- M11b AC-P5: part B §9 items 1 to 7 pass and the Quest and Vision Pro checklists verify.

## 10. Open questions

Q-13 (was Q-S11-01; owner question in `spec/99-open-questions.md`): which physical devices exist (iPhone 15, 16 or 17, Quest 3 and 3S, Vision Pro, Windows GPUs)? Recommendation: the owner confirms the minimum set iPhone 15 + iPhone 16/17 + Quest 3 + Vision Pro; Desktop B and C can be borrowed or skipped with `desktop-ultra` marked unverified. Q-10 floor is binding. Add `perf:verify` and `perf:checklist` to the 08-test-and-ci script table (proposal to S13).
