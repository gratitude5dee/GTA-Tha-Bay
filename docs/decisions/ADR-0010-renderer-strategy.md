# ADR-0010 — Renderer strategy

**Status:** accepted · **Date:** 2026-10-18 · **Decides:** spec/03 D-07, D-09, D-10, D-11; R-PLAT-02, R-PLAT-03, R-PLAT-05

## Context
One codebase must render on desktop, iPhone-class PWAs, Quest 3/3S and Apple Vision Pro. Safari 26 ships WebGPU on iOS, macOS and visionOS [F-004]. three.js `WebGPURenderer` falls back to WebGL2 by itself [F-002]. Native WebGPU XR in r186 has no multiview; Quest Browser's WebGPU path is experimental; visionOS 26.2 supports WebGPU XR [F-002, F-005]. `navigator.xr` does not exist in workers, so XR sessions live on the main thread [F-006]. Per-object cost, not triangle count, binds first (issue #30560) [F-007]. Quest 3 targets 72 Hz with under 200 draw calls and 1.5 M triangles [F-013].

## Options considered
1. **React Three Fiber.** R3F 9.8.2 caps React below 19.4 and v10 is alpha; it fights the worker topology and the XR renderer swap [F-015].
2. **`postprocessing` and `n8ao`.** `postprocessing@6.39.5` requires three below 0.187 and `n8ao@2.0.1` is not WebGPU-compatible [F-008].
3. **A render worker.** Impossible for XR (F-006) and adds a second path.
4. **WebGPU only.** iPhone Home Screen parity and GPU-process limits are UNVERIFIED (U-PLT-1, U-PLT-2), so a guaranteed fallback is required.
5. **Vanilla three with one `WebGPURenderer`, TSL materials, WebGL2 as the guaranteed path** (chosen).

## Decision
- **Renderer.** `three@0.186.1` [F-001], one `WebGPURenderer`; TSL node materials only, no GLSL (`no-glsl-in-engine` lint). WebGL2 is the guaranteed path: automatic fallback, `?gl=1` in QA builds, and the CI project `chromium-webgl2`.
- **Per tier.** Desktop and Vision Pro: WebGPU. Mobile tiers: the WebGL2 backend until `webgpu.mobile` is flipped by a reviewed pull request after the M01c iPhone 15 Home Screen run passes (30 minutes, no jetsam, p90 in budget) and M11a revalidates (DN-S11-01). Quest: the WebGL2 backend with multiview. Vision Pro: native WebGPU XR with `setupWebGLXRFallback` swapping to WebGL2 when `XRGPUBinding` is absent [F-003]. `RendererHost` swaps renderer and canvas at XR entry, sets `renderer.xr.enabled` before `init()`, and re-warms pipelines.
- **Render-object budgets (D-09).** `BundleGroup` per chunk with `static = true`, instancing and batching, at most 6 objects per chunk; mobile ≤ 150 objects and ≤ 1.0 M triangles; `RenderBudgetMeter` counts objects (U-PLT-14 limits `renderer.info` on WebGPU).
- **Post-processing (D-10).** TSL `RenderPipeline` nodes; `DirectRenderPipeline` in XR; `PCFShadowMap`. Fewer command encoders per frame mitigates the WebKit GPU-process leak [F-012].
- **Language (D-11).** Vanilla three and TypeScript; Preact for DOM UI only.
- **Threads.** Main-thread rendering with `sim.worker` and `asset.worker` (ADR-0017).

## Consequences
- (+) One shader language and one pipeline for all backends; the fallback is exercised on every CI run.
- (+) The tier ladder (`desktop-ultra` … `xr-visionpro`, C13) can change backend without code changes.
- (−) TSL is newer and less documented than GLSL; screen-space effects must be written as nodes.
- (−) XR entry costs a renderer swap and warm-up; Vision Pro WebGPU XR has no multiview, so its cost is UNVERIFIED (U-PLT-10).
- (−) CI cannot prove real GPU behaviour: SwiftShader runs WebGPU headless, WebKit on Linux has no `navigator.gpu` [F-062]; device runs record the rest.

## Affected contracts and milestones
C13 (tiers, budgets, `RendererHost`), C04 (`XRRigParams`, depth policy), C08 (≤ 6 objects per chunk). M00 (probe), M01c (device spike), M02b1 (budgets in practice), M07b2 (visual pass), M11a, M11b1–M11b3.

## Links
`research/stack-rendering-platform.md` §1, §4–5; `research/INDEX.md` §1.7–1.11; `spec/domains/11-platform.md`; `spec/11-decision-log.md` DL-030, DL-031, DL-032; ADR-0005, ADR-0017, ADR-0027.
