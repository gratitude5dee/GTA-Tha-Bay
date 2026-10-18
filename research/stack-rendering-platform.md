# stack-rendering-platform — Three.js WebGPU, iPhone PWA, WebXR (Quest / Vision Pro), physics/ECS, toolchain, performance budgets

Date checked: 2026-10-18. Dimension key: `stack-rendering-platform` (S00).
Builds on (does not repeat): `research/repos-webport.md` (worker topology, SAB/Atomics IPC, OPFS block store, COOP/COEP on Cloudflare, iOS memory anecdotes, Quest Browser release-note rows, Safari 26/26.2 WebGPU rows) and `research/repos-world.md` §1, §5, §7 (SF bake pipeline, library pins, pixel budget and adaptive governor). Binding owner update applied: accurate San Francisco first; the rest of the Bay is a low-detail backdrop in v1 (`research/owner-updates.md` #1).

Method: npm registry metadata pulled live (`registry.npmjs.org`, 2026-10-18); three.js `0.186.1` tarball, Rapier `0.21.0`, Jolt `1.1.0`, postprocessing `6.39.5`, n8ao `2.0.1`, 3d-tiles-renderer `0.5.3`, workbox-build `7.4.1`, @gltf-transform/cli `4.5.1` and MDN browser-compat-data `8.1.6` (timestamp 2026-10-15) downloaded and inspected; vendor pages fetched (webkit.org, developers.meta.com, apple.com, github.com/mrdoob/three.js). Code-level claims cite file paths inside the npm tarballs. Everything not confirmed against a source this session is labelled UNVERIFIED and collected in "## Unverified".

---

## 0. Executive summary

1. **Three.js is at r186 (`three@0.186.1`, published 2026-09-24); r187 is not out.** `WebGPURenderer` is one renderer with two backends: WebGPU, and an automatic WebGL2 fallback (`getFallback` in `src/renderers/webgpu/WebGPURenderer.js`); `forceWebGL: true` selects WebGL2 explicitly. r186 removed the "(wip)" label from the WebGPU examples, added `DirectRenderPipeline`, MSAA for WebXR-on-WebGPU, and removed `PCFSoftShadowMap` (deprecated, maps to `PCFShadowMap`). `PostProcessing` was renamed `RenderPipeline` in r183.
2. **Does WebXR work with WebGPURenderer today? Yes, in two ways, but only one of them is broadly usable.** (a) *Native WebGPU XR* (r185+, via `XRGPUBinding` and the `'webgpu'` session feature): shipping only on Apple Vision Pro (Safari 26.2+); experimental behind `chrome://flags` on Quest Browser 146+; absent in stable desktop Chrome 153. In r186 it renders a single projection layer **without multiview** (`XRManager.js`: "WebGPU XR does not support multiview yet"). (b) *WebGPURenderer on its WebGL2 backend* (`forceWebGL`, or the official `setupWebGLXRFallback()` helper that swaps renderers at session start): works wherever WebXR+WebGL2 works (Quest, Vision Pro), with `XRProjectionLayer`, `OVR_multiview2` multiview, quad/cylinder layers and foveation. **For Quest 3/3S the spec must use (b). For Vision Pro use (a) with (b) as fallback.** Classic `WebGLRenderer` also does XR but cannot run our TSL materials (only via the limited `WebGLNodesHandler` addon).
3. **Correction to repos-world §7 pins.** The four pins are still the latest on npm today (`three@0.186.1`, `postprocessing@6.39.5`, `n8ao@2.0.1`, `earcut@3.2.4`), but `postprocessing` and `n8ao` are **WebGLRenderer-only**. The postprocessing peer range is `three >=0.168.0 <0.187.0`. n8ao's README says: "N8AO is not yet compatible with WebGPU". With WebGPURenderer, the spec must use three's TSL `RenderPipeline` with the built-in nodes (`GTAONode`, `SSAONode`, `BloomNode`, `SMAANode`, `FXAANode`, `TRAANode`, `FSR1Node`, `TAAUNode`, and others) and drop both packages. Also replace repos-world rec 10 ("start WebGL2 with the WebGPU renderer behind a flag"): use `WebGPURenderer` everywhere with one TSL material codebase and pick the backend per tier.
4. **The main perf risk is CPU cost per object, not GPU throughput.** three.js issue #30560 is still open: WebGPURenderer has per-object UBO overhead (maintainer demo: 12 FPS vs 60 FPS for WebGLRenderer; Android 19 vs 57). On r186 the WebGL2 fallback issues about 80% more GL calls than WebGLRenderer (user report, 2026-09-15). The engine must therefore be designed around few render objects: merged world chunks, `BatchedMesh`, `InstancedMesh`, `BundleGroup` render bundles and `Object3D.static = true`. Draw-call budgets below are expressed as **render objects** (pipeline + bind-group units), not GPU draw commands.
5. **iPhone PWA (iOS 26/27 Safari):**
   - Platform features: WebGPU (incl. in workers), OPFS (sync handles), SharedArrayBuffer under COOP/COEP, wasm SIMD/threads/exceptions/GC, JSPI (Safari 27), AudioWorklet, `navigator.audioSession`, Wake Lock (18.4), Web Push for Home Screen apps (16.4), Gamepad API, WebTransport (26.4).
   - What iPhones lack: element fullscreen ("Only available on iPad, not on iPhone"), orientation lock, Vibration API, gamepad rumble, Pointer Lock, `beforeinstallprompt`, `navigator.deviceMemory`, memory measurement, WebXR.
   - Installing: since iOS 26 "every website added to the Home Screen opens as a web app" with "zero requirements for installability".
   - Storage: origin quota up to 60% of disk, and Home Screen apps get the same quota as Safari; `persist()` is granted by heuristics "like whether the website is opened as a Home Screen Web App".
   - Memory: the WebContent process has a reported **ActiveHard 2,048 MB** jetsam kill on iPhone 17 Pro, and Apple confirmed iPhones have stricter limits than iPads.
   - Frame rate: rAF is reportedly capped near 60 fps by default (Safari feature flag).
6. **Quest 3 targets (Meta):** 72 Hz minimum (90 recommended), 13.8 ms, **<200 draw calls, <1.5 M triangles**, KTX2/Basis textures recommended. Quest 3S has the same XR2 Gen 2 and 8 GB RAM at 1832×1920 per eye. Vision Pro (M5): 16 GB, 23 M pixels, 90/96/100/120 Hz.
7. **Physics, ECS, framework, toolchain:**
   - Physics: **Rapier `@dimforge/rapier3d-simd-compat@0.21.0`** (Apache-2.0; `KinematicCharacterController`, `DynamicRayCastVehicleController`, snapshots, a cross-platform `-deterministic` variant). Jolt `jolt-physics@1.1.0` (MIT) is the fallback if racing needs a drivetrain sim (`WheeledVehicleController`, `MotorcycleController`, ragdolls), at the cost of manual `Jolt.destroy` memory management. cannon-es is unmaintained (last publish 2022-08-12).
   - ECS: **bitECS `0.4.0`** (SoA typed arrays that can be SharedArrayBuffer-backed; MPL-2.0).
   - Framework: **vanilla three, no R3F** (R3F 9.8.2 caps React <19.4, and v10 with WebGPU is alpha).
   - Toolchain: Vite `8.3.4` (Rolldown) + `vite-plugin-pwa@2.0.0` + Workbox `7.4.1` (precache default max 2 MiB per file); TypeScript **6.0.3** (typescript-eslint 8.71.2 requires `<6.1.0`, although TS 7.0.2 is "latest"); `@gltf-transform/cli@4.5.1` (meshopt by default, KTX2 needs KTX-Software ≥4.4.0).

---

## 1. Three.js r186: renderer, TSL, post, batching, loaders

### 1.1 Release status and pins (verified on npm 2026-10-18)

| Package | Latest | Published | Peer / note | Spec action |
|---|---|---|---|---|
| `three` | 0.186.1 | 2026-09-24 | MIT; r186 tag "24 Sep"; live `threejs.org/build/three.core.js` has `REVISION = '186'` | **Pin `0.186.1`** |
| `@types/three` | 0.186.0 | 2026-09-11 (time field of version) | — | Pin `0.186.0` |
| `postprocessing` | 6.39.5 | 2026-09-09 | peer `three >=0.168.0 <0.187.0`; 62 refs to `WebGLRenderer`, 0 to WebGPU in `build/index.js`; `7.0.0-beta.16` peer `three >=0.179.0 <0.184.0` | **Remove from stack** (WebGL-only; blocks r187) |
| `n8ao` | 2.0.1 | 2026-08-10 | peer `postprocessing >=6.30.0`; README: "not yet compatible with WebGPU" | **Remove**; use `GTAONode`/`SSAONode` |
| `earcut` | 3.2.4 | 2026-09-28 | ISC | Pin `3.2.4` (bake-time footprint triangulation) |
| `three-mesh-bvh` | 0.9.16 | 2026-10-08 | peer `three >=0.159.0` | Pin (LOS for director camera, raycasts) |
| `3d-tiles-renderer` | 0.5.3 | 2026-09-18 | no WebGPU-specific code in `src/`/`build/` (grep) | Only if photo mode exists; WebGPU compat UNVERIFIED |
| `@takram/three-atmosphere` | 0.19.1 | 2026-05-06 | WebGPU entry "Work-in-progress" (repos-world §5) | Desktop-ultra only, behind an adapter; r186 compat UNVERIFIED |

r186 changelog lines that matter for this game (https://github.com/mrdoob/three.js/releases/tag/r186): "Add MSAA support to WebXR WebGPU", "Enable MSAA for native XR layers", "Fix native WebGPU XR camera selection", "Detect WebGPU XR support upfront", "Add DirectRenderPipeline", "Introduce compileComputeAsync()", "Support dynamic swapping of the lighting system", "Add SunLight with cascaded shadow maps" (moved to addons), "Add `SSAONode` and `depthAwareBlur`", "Add node for Order Independent Transparency", "Add `softParticles()`", "Remove remaining PCFSoftShadowMap code", "Deprecate CommonJS build", "Remove minified builds", "Removed (wip) from webgpu", "GaussianSplatMesh -> GaussianSplat", "Remove `ecsy`".
r185 (01 Jul) lines: "Add support for WebXR with WebGPU", "Add fallback for XR with WebGPU", "Use `foveateBoundTexture()` to enable foveation", "Added ClusteredLighting (Forward+ clustered) shading", "Surface uncaptured GPU errors and WGSL diagnostics", DRACOLoader "Use relative file urls by default" / "Deprecate setDecoderConfig".

### 1.2 WebGPURenderer construction and backend selection (source: `three@0.186.1/src/renderers/webgpu/WebGPURenderer.js`, `WebGPUBackend.js`)

- With no `forceWebGL`, the constructor creates `WebGPUBackend` and sets `parameters.getFallback = () => new WebGLBackend(parameters)`. It warns "WebGPU is not available, running under WebGL2 backend." `forceWebGL: true` goes straight to `WebGLBackend`.
- Options worth fixing in the spec: `antialias` (MSAA, default false), `samples`, `forceWebGL`, `multiview` (XR on the WebGL backend), `outputBufferType` (default `HalfFloatType`; `UnsignedByteType` saves bandwidth), `powerPreference`, `requiredLimits`, `trackTimestamp` (GPU timestamp queries), `reversedDepthBuffer`, `logarithmicDepthBuffer`.
- `WebGPUBackend.init()` requests the adapter with `{ powerPreference, featureLevel: 'compatibility', xrCompatible: renderer.xr.enabled }`. **`renderer.xr.enabled = true` must be set before `await renderer.init()`** on XR-capable devices, or the device is not XR-compatible.
- `await renderer.init()` is the supported pattern. `renderAsync()`, `hasFeatureAsync()` and `KTX2Loader.detectSupportAsync()` are all deprecated since r181 in favour of "`await renderer.init()` when creating the renderer".
- Pipeline warm-up: `renderer.compileAsync(scene, camera)` exists and r186 fixed a crash when a material is disposed mid-flight. Pair it with the boot-set and pipeline-seed capture from repos-webport rec 5.

### 1.3 TSL / node materials maturity

- TSL is the material language for both backends: it emits WGSL on WebGPU and GLSL on WebGL2. r186 adds GPU-native TSL unit tests (math, packing, lights, tone mapping), a "TSL Guide", `softParticles()`, `billboarding({horizontalRotation})`, `batchIndirectIndex`, GLSL→TSL transpiler macros, and atomics/workgroup arrays for compute.
- **Not available on WebGPURenderer**: `ShaderMaterial`/`RawShaderMaterial` GLSL, `onBeforeCompile` shader patching, and the `postprocessing`/`EffectComposer` stack. The SF repo's string-patched takram cloud shaders (repos-world §1.4) do not carry over.
- Classic `WebGLRenderer` can render node materials only through the addon `examples/jsm/tsl/WebGLNodesHandler.js` (`renderer.setNodesHandler`). Its documented limitations: "VSM shadows not supported", "MRT not supported", "Transmission not supported", "WebGPU postprocessing stack not supported", "Storage textures not supported", and "instanced mesh geometry cannot be shared". **Do not build on it.**
- Practical rule for the Builder: every material is a `*NodeMaterial` (`MeshStandardNodeMaterial`, `MeshBasicNodeMaterial`, `MeshLambertNodeMaterial`, `SpriteNodeMaterial`) or a TSL `Fn`. Use no GLSL strings anywhere in `packages/engine`.

### 1.4 Post-processing in the WebGPU path

- Class: `THREE.RenderPipeline` (`PostProcessing` is a deprecated alias since r183). `DirectRenderPipeline` (r186) renders without an intermediate pass; the official XR example uses it.
- Built-in nodes present in `examples/jsm/tsl/display/`: `GTAONode`, `SSAONode`, `SSRNode`, `SSGINode`, `SSSNode`, `BloomNode`, `SMAANode`, `FXAANode`, `TRAANode`, `TAAUNode`, `FSR1Node`, `SSAAPassNode`, `DepthOfFieldNode`, `MotionBlur`, `GodraysNode`, `LensflareNode`, `Lut3DNode`, `OITPassNode`, `OutlineNode`, `DenoiseNode`, `RecurrentDenoiseNode`, `TemporalReprojectNode`, `TransitionNode`, `FilmNode`, `ChromaticAberrationNode`, `RGBShiftNode`, `SharpenNode`, `PixelationPassNode`.
- Mapping from the SF repo composer (repos-world §1.4): N8AO → `GTAONode` at half resolution (desktop only); `FogEffect` → TSL `fog()`/`rangeFogFactor`/`densityFogFactor`, or a custom height-fog `Fn`; Bloom → `BloomNode`; tone mapping NEUTRAL → `renderer.toneMapping = THREE.NeutralToneMapping`; SMAA → `SMAANode` (or `FXAANode` on mobile); upscaling on mobile → `FSR1Node` or `TAAUNode` (evaluate cost on device).
- XR: no screen-space post in XR on Quest (fill-rate bound, and the WebGL backend in XR draws straight to the layer). Use `DirectRenderPipeline`, with tone mapping done in materials.

### 1.5 Batching, instancing, bundles, LOD (the per-object overhead problem)

- **Issue #30560 is open** ("WebGPURenderer: Current UBO system has severe performance issues with many render items", opened 2025-02-19). On 2026-01-06 sunag said the fix needs a group-based buffer architecture that "still needs some polishing". Mugen87 measured 12 FPS vs 60 FPS (WebGLRenderer) in Chrome and 19 vs 57 on Android. A 2026-09-15 user comment says the r186 WebGL2 fallback makes about 80% more GL calls than WebGLRenderer, mostly UBO uploads. Don McCurdy (forum, 2025-09-02): "I would not expect performance improvement simply by swapping WebGPURenderer in for WebGLRenderer today … batching and/or instancing will remain important."
- `BatchedMesh` (`src/objects/BatchedMesh.js`) offers per-instance frustum culling (`perObjectFrustumCulled`), sorting, `setCustomSort`, `addGeometry`/`addInstance` and `optimize()`. **On the WebGPU backend it loops `drawIndexed()` once per visible instance** (`WebGPUBackend.js`, no multi-draw-indirect), but with one pipeline and bind group. That is cheap compared with separate meshes, though not one draw.
- `InstancedMesh` issues one `drawIndexed(count, instanceCount)`. Use it for cars, peds, trees, lamps, props (the SF repo's 4 draw calls for 540 cars, repos-world §1.6).
- `BundleGroup` (`src/renderers/common/BundleGroup.js`) records WebGPU render bundles for static subtrees. It is "only fully supported by WebGPURenderer with a WebGPU backend. With a WebGL backend … without any performance improvements". `static = true` by default; set `needsUpdate` to re-record. **Use one BundleGroup per streamed world chunk** (buildings + roads + static props).
- `Object3D.static` (new): "If set to `true` … the 3D object is not going to be changed after the initial render … certain state checks can be bypassed. Only relevant in context of WebGPURenderer." Set it on every baked chunk mesh.
- LOD: core `THREE.LOD` works for hero props. For crowds, `@three.ez/instanced-mesh@0.3.16` (BVH frustum culling, LOD, sorting; peer `three >=0.159.0`) is optional; its WebGPU behaviour is UNVERIFIED. Impostors: three has no core impostor system. Use baked "skyline cards" (camera-facing or octahedral atlases generated at bake time and drawn as one `InstancedMesh` with a TSL billboard) for the far field (East Bay and Marin backdrop per owner update #1).
- Lighting at night: `ClusteredLighting` (Forward+, r185 addon) is desktop-only. On mobile and XR, fake lamps with emissive textures plus a light-probe grid (`LightProbeGrid`, which has a WebGPURenderer version in r186) and no per-lamp lights.

### 1.6 Loaders and asset formats

- `GLTFLoader` + `setKTX2Loader` + `setMeshoptDecoder` + `setDRACOLoader`. Fixes in r186: `EXT_mesh_gpu_instancing` custom instance attributes; "Skip skinning without skin attributes"; `KHR_texture_transform` rotation.
- `KTX2Loader.detectSupport(renderer)` on WebGPURenderer reads `renderer.hasFeature('texture-compression-astc' | 'texture-compression-etc2' | 'texture-compression-bc' | 's3tc' | 'pvrtc')`. Call it **after** `await renderer.init()`. Fleet data (web3dsurvey): ASTC in WebGPU on iOS 99.96%, Android 99.95%, macOS 95.29%, Windows 0.04%. So Basis/KTX2 (UASTC for hero textures, ETC1S for bulk) transcodes to ASTC on iPhone, Quest and Vision Pro, and to BC7 on Windows.
- Decoders ship inside the npm package: `examples/jsm/libs/basis/basis_transcoder.{js,wasm}` (wasm 527,333 B), `libs/draco/draco_decoder.wasm` (285,747 B), `libs/meshopt_decoder.module.js` (29 KB). **Self-host them same-origin** (COEP `require-corp`; r185 made DRACO/KTX2 URLs relative by default).
- Geometry compression: `EXT_meshopt_compression` plus quantization is the default in `@gltf-transform/cli@4.5.1` (`--compress` default `"meshopt"`, options `draco|meshopt|quantize|false`). Meshopt decodes faster than Draco and also compresses animation, so prefer it.

### 1.7 3D Tiles (only for an optional online photo mode)

repos-world already excluded Google Photorealistic 3D Tiles from gameplay (licence: no caching, no extraction). `3d-tiles-renderer@0.5.3` has peer deps on R3F and Babylon but contains no WebGPU-specific code. Its plugins that patch shaders are WebGL-oriented. Treat WebGPURenderer compatibility as UNVERIFIED and keep photo mode out of v1.

### 1.8 Shadows and sky

- `PCFSoftShadowMap` is deprecated since r186 (`src/constants.js`: "Use `PCFShadowMap` instead"). The SF repo's `PCFSoftShadowMap` (repos-world §1.3) must change.
- Desktop: the `SunLight` addon with cascaded shadow maps (r186), 2–3 cascades.
- Mobile: one 1024² cascade near the player, or blob shadows.
- XR: blob shadows only. Meta: "Drawing the scene to render the shadow map counts against your overall scene budget for draw calls and triangles."
- Sky: the `timecyc.json` keyframe model (repos-world rec 7) with a TSL sky dome on every tier. takram's WebGPU nodes only on desktop-ultra, behind an adapter, removable.

---

## 2. Browser and device support matrix (for our targets)

Sources: MDN browser-compat-data 8.1.6 (2026-10-15) unless another source is named. BCD has no visionOS entry, so the Vision Pro column comes from WebKit posts.

| Capability | Chrome/Edge desktop | Safari macOS 26/27 | Safari iOS 26/27 (iPhone) | Quest Browser (≤152.1) | Safari visionOS 26.2/27 |
|---|---|---|---|---|---|
| WebGPU (`navigator.gpu`) | 113+ (Win/Mac/ChromeOS); Linux Intel Gen12+ from 144 | 26 | 26 | BCD: since Oculus Browser 32 (Blink 122) — medium | 26 (WebKit) |
| WebGPU in workers (`WorkerNavigator.gpu`) | yes | 26 | 26 | yes (BCD) | 26 (assumed same engine; UNVERIFIED) |
| WebXR `immersive-vr` | yes | no | **no** (`navigator.xr` absent) | yes (since 8.0) | yes since visionOS 2 (Safari 18) |
| WebXR on WebGPU (`XRGPUBinding`) | absent in Chrome 153 stable; flags on Canary (Win/Android) | — | — | **experimental, behind chrome://flags** (146+) | **shipping** (26.2) |
| `OVR_multiview2` (WebGL) | partial | no | no | 17.0+ | no (Safari 27 adds texture-array projection layers) |
| XR Layers (`XRProjectionLayer`) | 147 | — | — | 16.1+ | Safari 27 adds texture-array projection layers in WebXR Layers |
| Hand input (`XRHand`) | 131 | — | — | 15.1+ | yes, with permission prompt (Safari 18) |
| `updateTargetFrameRate` | no | — | — | 31.2+ | UNVERIFIED |
| SharedArrayBuffer (COOP/COEP) | yes | 15.2 | 15.2 | yes | yes (WebKit) |
| COEP `credentialless` | 96 | **no** | **no** | yes | no |
| wasm SIMD128 / relaxed SIMD | 91 / 114 | 16.4 / preview | 16.4 / **no** | 16.0 / 31.2 | follows Safari |
| wasm threads / exceptions / GC / tail calls | yes | 15.2 / 15.2 / 18.2 / 18.2 | same | yes | follows Safari |
| wasm memory64 / JSPI | 133 / 137 | preview / 27 | **no** / 27 | 38.1 / 40.0 | follows Safari |
| OPFS + `createSyncAccessHandle` | 102 | 15.2 | 15.2 | yes | follows Safari |
| Element fullscreen | 71 | 16.4 | **iPad only** ("Only available on iPad, not on iPhone") | yes | yes (Safari 18 visionOS) |
| `screen.orientation.lock()` | partial | no | **no** | yes (Android) | — |
| Manifest `orientation` | 39 | no | **no** | 5.0 | — |
| Pointer Lock | 37 | 10.1 | **no** | **no** (BCD) | — |
| Gamepad API | yes | 10.1 | 10.3 | yes (+XR gamepads) | `gamepadconnected` fixed in Safari 27 |
| Gamepad rumble (`vibrationActuator`) | 68 | 16.4 | **no** | yes (6.0) | — |
| `navigator.vibrate` | 32 | no | **no** | yes | — |
| `navigator.audioSession` | no | 16.4 | 16.4 | no | — |
| Wake Lock | 84 | 16.4 | 18.4 | yes | — |
| Push API | 42 | 16 | 16.4 (Home Screen apps) | 42 | — |
| `beforeinstallprompt` | 44 | no | no | 44 | — |
| `navigator.deviceMemory` | 63 | no | no | yes | no |
| `measureUserAgentSpecificMemory` | 89 | no | no | yes | no |
| WebTransport | 97 | 26.4 | 26.4 | yes | 26.4 (assumed) |
| `requestIdleCallback` | 47 | preview (flag) | **no** | yes | no |
| `scheduler.yield` | 129 | no | no | yes | no |

---

## 3. iPhone PWA constraints (iPhone 15/16/17 class, iOS 26/27)

### 3.1 Install flow
- iOS/iPadOS 26: "By default, every website added to the Home Screen opens as a web app", "Giving users a web app experience simply no longer requires a manifest file", "there are now zero requirements for 'installability' in Safari". The manifest still supplies icons, name, `display`, `start_url` and `scope`. `display` is supported since iOS 11.3; `orientation`, `display_override`, `share_target` and `launch_handler` are **not** supported on iOS (BCD).
- There is no `beforeinstallprompt` on Safari. Show a one-time coach mark: "Share → Add to Home Screen". Chromium (desktop, Android, Quest) uses `beforeinstallprompt`.
- Design consequence: the game must not depend on install. Treat install as a quality tier: Home Screen gives more persistent storage and full-screen chrome.

### 3.2 Storage quotas and eviction (WebKit "Updates to Storage Policy", 2023-08-10, still the current policy document)
- "For a browser app, the origin quota is up to 60% of the total disk space"; overall quota up to 80%; cross-origin frames get "10% of the main frame's origin quota".
- "When a web app is running standalone (as Home Screen Web App on iOS …), it has the same origin quota and overall quota as when it is opened in a browser app."
- The policy covers "localStorage, Cache API, IndexedDB, Service Worker, and File System". Cookies and the HTTP cache are excluded.
- Eviction is per origin, LRU, triggered by exceeding the overall quota, by storage pressure, or when a site goes unused "for some time". An origin "might be excluded from eviction if it has active page".
- `navigator.storage.persist()`: "WebKit currently grants a request based on heuristics like whether the website is opened as a Home Screen Web App." `estimate()` is available since iOS 17.
- Spec implication: a full SF world pack of a few hundred MB fits in the quota. It must be **re-downloadable at any time** (manifest-hash-versioned OPFS store with a "re-downloading district" state, repos-webport P3). Saves are mirrored to the backend once identity exists.

### 3.3 Memory ceilings
- No official per-tab number. The best current evidence (Apple Developer Forums thread 823061, April 2026): `com.apple.WebKit.WebContent … exceeded mem limit: ActiveHard 2048 MB (fatal)` on an iPhone 17 Pro (12 GB) under iOS 26.3–26.4.1. An Apple Frameworks Engineer replied: "iPhones do indeed have stricter jetsam limits than iPads." Older anecdotes (repos-webport) range from about 1.5 GB to 3 GB.
- WebGPU allocations live in the separate `com.apple.WebKit.GPU` process, whose own limit is UNVERIFIED. WebKit bug 303203 (a WebGPU GPU-process leak in `CommandEncoder::trackEncoder` on iOS/macOS 26, fixed in main on 2025-12-05) shows the GPU process gets jetsammed too. The reporter's mitigation was **fewer command encoders per frame**, so keep one encoder per frame.
- Spec budget (engineering target, not a platform number): JS+wasm heap ≤ 600 MB, GPU resources ≤ 600 MB on `mobile`; a self-accounting `MemoryBudget` service sums `renderer.info.memory` (textures and geometries), wasm `memory.buffer.byteLength` and asset-cache sizes, because Safari has no `deviceMemory` and no `measureUserAgentSpecificMemory`.

### 3.4 Display, frame rate, fullscreen, orientation
- iPhone 17: A19 (6-core CPU, 5-core GPU), "ProMotion technology with adaptive refresh rates up to 120Hz", 2622×1206. iPhone 16: A18, 2556×1179. iPhone 15: A16, 2556×1179 (apple.com). RAM is not published by Apple; press reports say 15 = 6 GB, 16 = 8 GB, 17 = 8 GB, 17 Pro/Air = 12 GB (low/medium confidence).
- rAF: Safari is reported to cap page rendering near 60 fps by default via the "Prefer Page Rendering Updates near 60fps" feature flag (secondary sources only). Plan for **60 Hz max on iPhone**. Do not promise 120 Hz.
- Fullscreen: element fullscreen is unavailable on iPhone, so run as a Home Screen web app (`display: standalone`), set `viewport-fit=cover`, and lay the HUD out against `env(safe-area-inset-*)`.
- Orientation cannot be locked. Show a "rotate to landscape" overlay for driving, fighting and on-foot gameplay, keep menus responsive in portrait, and listen to `screen.orientation` `change` (iOS 16.4+).

### 3.5 Input, haptics, audio, background
- Touch: Pointer Events (iOS 13+) with a virtual stick (repos-webport rec 9 numbers). Pointer Lock is unavailable.
- Gamepad API works (iOS 10.3+); use the standard mapping. There is **no haptics API on iPhone** (`navigator.vibrate` absent, `Gamepad.vibrationActuator` absent on iOS). Use haptics only on Chromium, desktop Safari 16.4+ gamepads and Quest controllers.
- Audio: create or resume the `AudioContext` inside the first `pointerdown`/`keydown`. Set `navigator.audioSession.type = 'playback'` (iOS 16.4+, feature-detect) so game audio is not silenced by the ringer switch; this is WebKit bug-thread guidance, medium confidence. Resume on `visibilitychange`. Use `AudioWorklet` (iOS 14.5+) only if a worker mixer is adopted.
- Background: assume the page is suspended when hidden. Persist the save on `visibilitychange`→`hidden` and on `pagehide`, pause the sim, close or re-open network sockets on resume. Exact iOS suspension timing is UNVERIFIED. Use Wake Lock (iOS 18.4+) during cutscenes and races.
- Push: Web Push works only for Home Screen apps on iOS 16.4+. It is not a v1 feature (multiplayer invites later).

### 3.6 Threads, SIMD, isolation
- SharedArrayBuffer requires COOP `same-origin` + COEP `require-corp` (Safari 15.2+). Safari has no `credentialless`, so every cross-origin subresource (R2, fal.ai media, Thirdweb or ChatGPT widgets) needs CORP/CORS or a same-origin proxy (repos-webport risk 3).
- wasm SIMD128 is available on all targets (iOS 16.4+, Quest 16+), so ship the Rapier **SIMD** build. Relaxed SIMD and memory64 are not on iOS, so ship nothing that needs them.

---

## 4. WebXR: Quest 3/3S and Apple Vision Pro

### 4.1 The plain answer: WebXR with WebGPURenderer

- **Yes, WebXR works with `WebGPURenderer` in three r185+, and this is how to run it per headset:**
  - **Apple Vision Pro (Safari 26.2+):** native WebGPU XR works ("Now with Safari 26.2 on visionOS, WebXR supports WebGPU"). three r186 renders it as one projection layer per frame with MSAA and **no multiview**, so each eye is a separate pass and CPU cost per eye adds up.
  - **Meta Quest 3/3S (Quest Browser ≤152.1):** native WebGPU XR is **experimental and flag-gated** (146.0 "Experimental WebGPU and WebXR depth projection support"; Meta engineer Rik Cabanier: enable "webXR experimental features" in chrome://flags; later releases added experimental WebGPU space-warp, foveation and composition layers). Players will not flip flags, so **Quest must use WebGPURenderer on the WebGL2 backend** (`forceWebGL: true` or `setupWebGLXRFallback`). With `multiview: true` that path uses `OVR_multiview2`, XR projection layers, foveation, and quad/cylinder layers.
  - **Desktop Chrome (PC VR, Quest Link):** `XRGPUBinding` is missing in Chrome 153 stable, so this path also uses the WebGL2 backend.
- **The classic `WebGLRenderer` is not needed for XR.** Keeping one renderer class and one TSL material set is the point.
- three's `XRManager` (common) checks `typeof globalThis.XRGPUBinding !== 'undefined'` and requires the `'webgpu'` session feature. Otherwise it throws: "WebGPU XR sessions require the "webgpu" session feature. Use VRButtonGPU/XRButton with "webgpu" enabled or use a WebGL backend."
- Defaults to know: reference space `'local-floor'`, `framebufferScaleFactor 1` (cannot change during a session), foveation `1.0` (maximum).

### 4.2 Official setup pattern (three r186 `examples/webgpu_xr_cubes.html`)
```ts
import * as THREE from 'three/webgpu';
import { XRButton } from 'three/addons/webxr/XRButton.js';
import { setupWebGLXRFallback } from 'three/addons/webxr/WebGLXRFallback.js';

const base = { antialias: true, outputBufferType: THREE.UnsignedByteType, multiview: true };
function createRenderer(forceWebGL = false) {
  const r = new THREE.WebGPURenderer({ ...base, forceWebGL });
  r.xr.enabled = true;               // before init(): adapter is requested with xrCompatible
  r.setAnimationLoop(frame);
  return r;
}
let renderer = createRenderer(isQuestBrowser());          // Quest: go straight to WebGL2 backend
setupWebGLXRFallback(renderer, () => createRenderer(true), (next, prev) => swapCanvas(next, prev));
let pipeline = new THREE.DirectRenderPipeline(renderer);  // no screen-space post in XR
document.body.append(XRButton.createButton(renderer, {
  optionalFeatures: ['webgpu', 'local-floor', 'bounded-floor', 'layers', 'hand-tracking'],
}));
```
`setupWebGLXRFallback` patches `renderer.xr.setSession`. If the session starts on a WebGPU-backend renderer and `XRGPUBinding` is undefined, it builds the fallback WebGL2-backend renderer, copies `xr.enabled`, reference space and framebuffer scale, moves the animation loop, calls `onFallback(next, prev)`, then starts the session on it. The game's `RendererHost` must therefore support **swapping the renderer and canvas at XR entry** and re-uploading GPU resources (resources are per renderer). Spec this as a "re-warm" step that recompiles the pipeline seed for the XR tier.

### 4.3 Input
- Quest: `tracked-pointer` controllers with `gamepad` (XR haptics via `hapticActuators`), and `XRHand` (since 15.1).
- Vision Pro: default input is `transient-pointer` (gaze + pinch). The input array "is empty" until a pinch. With `hand-tracking`, the first two inputs are hand `tracked-pointer`s and the transient inputs come later (indices 2/3). `targetRaySpace` starts between the eyes, so attach hand-held objects to `gripSpace`. **Never hard-code `inputSources[0|1]`; route by `event.inputSource`.**
- Whether PS VR2 Sense controllers (native visionOS 26 support) appear as WebXR gamepads is UNVERIFIED. Design Vision Pro for hands and gaze first.

### 4.4 Comfort and locomotion for an open world (Meta Locomotion Best Practices / IWSDK docs)
- On foot: default to **teleport + snap turn** for new users, smooth locomotion opt-in. A vignette only while moving, with a short fade-out on stop. IWSDK slide defaults: comfort assist about 0.4–0.6, max speed about 4–6 m/s. Quantize velocity (stop/walk/run), and use teleport nodes on stairs and steep SF hills.
- Driving (needed for Racing): seated cockpit with the vehicle as the rest frame, a stable horizon, vignette proportional to yaw rate, no camera shake, and an optional "diorama chase" view (third-person tabletop) for police pursuits.
- Culture Wars in XR: a fixed arena camera (the player watches a life-size or diorama stage). No artificial locomotion.
- UI: menus and HUD in `renderer.xr.createQuadLayer(...)`/`createCylinderLayer(...)` (present in `XRManager.js`) for crisp text on the WebGL path. Fall back to in-scene panels on WebGPU XR (composition layers on WebGPU are experimental on Quest 152.1).
- Libraries: `@iwsdk/locomotor@1.0.1` and `@iwsdk/xr-input@1.0.1` (Meta, MIT, peer `three >=0.160.0`) are usable references or deps. `@iwsdk/core@1.0.1` pins `three: npm:super-three@0.181.0` (a fork), so do **not** adopt IWSDK core. IWSDK with WebGPURenderer is UNVERIFIED, so prototype before committing.

### 4.5 Quest performance levers
- Meta (Quest 3): target 72 Hz (90 recommended), 13.8 ms, **<200 draw calls, <1.5 M triangles per frame**; Quest 2: <100 / <750K. Use KTX 2.0/Basis Universal. Stagger updates ("only need to update animations 30 times a second even though you're rendering at 90"). Shadow passes count against the budget.
- Multiview on the WebGL backend halves CPU submission. Without multiview (WebGPU XR today), each eye costs a full pass.
- Foveation: `renderer.xr.setFoveation(0..1)`, default 1.0 in three. Quest supports `fixedFoveation` (BCD 8.0). One forum report says a value of 0 removes a dark-square artefact; treat that as a tuning knob in settings.
- Frame rate: `session.updateTargetFrameRate(90)` when `supportedFrameRates` includes 90 (Quest Browser 31.2+). Drop to 72 under the governor.
- Framebuffer: `setFramebufferScaleFactor` only before a session. Choose it at entry from the tier (Quest 3: 1.0; under load on the next entry: 0.85).

---

## 5. Physics, ECS, framework, project layout

### 5.1 Physics: Rapier (default) vs Jolt vs cannon-es

| | Rapier `@dimforge/rapier3d-simd-compat@0.21.0` | Jolt `jolt-physics@1.1.0` | cannon-es `0.20.0` |
|---|---|---|---|
| Published | 2026-09-25 | 2026-07-11 | 2022-08-12 (unmaintained) |
| Licence | Apache-2.0 | MIT | MIT |
| WASM size | 3,292,228 B (`rapier_wasm3d_bg.wasm`, SIMD) | 2,021,569 B (`jolt-physics.wasm.wasm`) | pure JS |
| Character | `KinematicCharacterController` (`enableAutostep`, `enableSnapToGround`, `setMaxSlopeClimbAngle`, `setSlideEnabled`) | `CharacterVirtual` (+ character-vs-character) | none built-in |
| Vehicles | `DynamicRayCastVehicleController` (per-wheel suspension, engine force, brake, steering) | `WheeledVehicleController` (engine, transmission, differentials, anti-roll), `MotorcycleController`, `TrackedVehicleController` | RaycastVehicle |
| Other | `PidController`, `takeSnapshot()/restoreSnapshot()` | Ragdoll, soft bodies, multithread builds (need SAB) | — |
| Determinism | base = locally deterministic; `-deterministic` = cross-platform (also 0.21.0) | `CROSS_PLATFORM_DETERMINISTIC` build option (custom build) | no |
| Precision | f32 | f32 (`DOUBLE_PRECISION` build option "allows worlds larger than a couple of km") | f64 JS |
| Memory model | GC-friendly handles; `world.free()` | manual: "everything you newed with `new Jolt.XXX` needs to be destroyed by `Jolt.destroy(...)`" + ref-counting | GC |

Decision: **Rapier SIMD-compat** for the character, traffic and arcade vehicles (NFS/Forza-arcade feel is tuned on top of the ray-cast vehicle with a custom tire-grip curve). Ergonomics favour a builder model, and the `-deterministic` variant is available for replays and server-side checks. Keep a `PhysicsBackend` interface (C-contract) so Racing can swap to Jolt's `WheeledVehicleController` if the vehicle feel fails acceptance. The fighter (Culture Wars) does not use rigid-body physics; it uses frame-data hitboxes.

**Floating origin is mandatory.** The SF world is 20 km × 20 km around City Hall (repos-world §1.1), so f32 resolution at 10 km is about 1 mm, and slow bodies jitter or stall. Keep the physics world local: active radius 200–400 m around the player, rebase the physics origin when the player is more than 1 km from it, and re-create static colliders per streamed chunk. Rendering is unaffected (three composes matrices in f64 on the CPU).

### 5.2 ECS
- **bitECS `0.4.0`** (2025-12-06, MPL-2.0): SoA components "made of TypedArrays backed by `SharedArrayBuffer`", `query(world, [Position, Mass], asBuffer)` returns a SAB-backed `Uint32Array`, and structural changes happen only on the owning thread through a command queue. That matches the repos-webport shared-memory topology: `sim.worker` owns the world and the render thread reads transforms from SAB. MPL-2.0 is file-level copyleft (modified bitECS files must stay MPL); using it unmodified is fine for a closed or open game (engineering note, not legal advice).
- Alternative: **koota `0.6.6`** (pmndrs, ISC; React optional via `koota/react`; SoA schema traits; relations; change tracking). Pick it if the team prefers ergonomics over SAB sharing.
- miniplex `2.0.0` (last publish 2023-07-16): do not adopt.

### 5.3 React Three Fiber vs vanilla
**Recommend vanilla three + TypeScript for the engine.**
- `@react-three/fiber@9.8.2` peers `react >=19 <19.4`; `10.0.0-alpha.6` (2026-10-17) is the WebGPU-era line and still alpha.
- R3F adds reconciliation cost per frame and fights the worker/SAB architecture and the renderer-swap-at-XR-entry requirement (§4.2).
- Menus and DOM UI may use any small framework, kept outside `packages/engine`; the engine exposes an event and command API.
- `@pmndrs/xr@6.6.32` is R3F-centric. Not needed.

### 5.4 Threads and contexts (amends repos-webport rec 1)
- `navigator.xr` exists only on `Window` (BCD: no `WorkerNavigator.xr`), while `navigator.gpu` exists in workers (Safari 26+). **v1 renders on the main thread** on every tier, with `sim.worker` (ECS, physics, AI, streaming decisions) and `asset.worker` (fetch, OPFS, decode). An OffscreenCanvas render worker is an optional later optimization for flat-screen tiers only, behind a flag, because XR entry would require moving rendering back to the main thread.

### 5.5 Toolchain (verified versions)
- `vite@8.3.4` (2026-10-08; Vite 8 stable 2026-03-12 with Rolldown; Node `^20.19.0 || >=22.12.0`).
- `vite-plugin-pwa@2.0.0` (2026-10-03; peer vite ^3–^8, `workbox-build`/`workbox-window ^7.4.1`, `@vite-pwa/assets-generator ^1||^2`; Node ≥20.19).
- `workbox-*@7.4.1`, `@vite-pwa/assets-generator@2.0.0`.
- `@cloudflare/vite-plugin@1.64.0` (peer vite ^6.1–^8, wrangler ^4.151.0) and `wrangler@4.151.1` (Node ≥22). Cross-ref stack-cloudflare-backend.
- `vitest@5.0.5` (Node ^22.12 || ^24 || ≥26), `@playwright/test@1.64.1`.
- TypeScript: npm `latest` is **7.0.2** (2026-07-08, native compiler), but `typescript-eslint@8.71.2` requires `typescript >=4.8.4 <6.1.0`. **Pin `typescript@6.0.3`** for the repo. TS 7 can be trialled later for type-check speed.
- Node: pin **Node 24 LTS** in `.nvmrc` (satisfies Vite, Vitest, Wrangler ≥22). The exact LTS label for Node 24 in Oct 2026 is UNVERIFIED.

### 5.6 Asset pipeline tools
- `@gltf-transform/cli@4.5.1` (2026-09-28): `optimize` with `--compress meshopt` (default), `--texture-compress ktx2|webp|avif|auto`, `--simplify`/`--simplify-ratio`/`--simplify-error`. KTX2 commands (`uastc`, `etc1s`) require **KTX-Software ≥ 4.4.0** on PATH (`KTX_SOFTWARE_VERSION_MIN = "4.4.0"` in the CLI bundle).
- KTX-Software: latest stable **v4.4.2** (assets dated 2025-10-04); `v5.0.0-rc2` is a pre-release where "The legacy tools have been removed" (`toktx` → `ktx create`). Pin 4.4.2 in CI and call `ktx create`/`ktx encode` rather than `toktx`.
- basis_universal latest **v2.50** (XUASTC with in-loop deblocking, XUBC7). three's bundled transcoder is the runtime path, so do not mix newer XUASTC encodes until three's transcoder supports them (UNVERIFIED).
- `meshoptimizer@1.3.0` (2026-09-25) for custom bake steps (LOD chains, `simplify`).

---

## 6. Code-pattern notes

### 6.1 Renderer init with tiered backend
```ts
// packages/engine/src/render/createRenderer.ts
import * as THREE from 'three/webgpu';
export type Backend = 'webgpu' | 'webgl2';
export async function createRenderer(canvas: HTMLCanvasElement, tier: QualityTier) {
  const forceWebGL = tier.forceWebGL || new URLSearchParams(location.search).has('gl');
  const renderer = new THREE.WebGPURenderer({
    canvas, antialias: false, forceWebGL,
    outputBufferType: tier.hdrOutput ? THREE.HalfFloatType : THREE.UnsignedByteType,
    multiview: tier.xr, powerPreference: 'high-performance', trackTimestamp: tier.gpuTimers,
  });
  renderer.xr.enabled = tier.xrCapable;            // must precede init()
  await renderer.init();                            // falls back to WebGL2 automatically
  const backend: Backend = renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl2';
  renderer.shadowMap.enabled = tier.shadows !== 'off';
  renderer.shadowMap.type = THREE.PCFShadowMap;      // PCFSoft removed in r186
  renderer.toneMapping = THREE.NeutralToneMapping;
  ktx2Loader.detectSupport(renderer);               // after init()
  return { renderer, backend };
}
```
Report `backend`, `adapter.info` (where exposed), the features list and the chosen tier to telemetry on every boot.

### 6.2 Per-chunk static batching
```ts
const chunk = new THREE.BundleGroup();               // one render bundle per world chunk (WebGPU backend)
const buildings = new THREE.Mesh(mergedGeo, cityFacadeMaterial); buildings.static = true;
const props = new THREE.BatchedMesh(maxInst, maxVerts, maxIdx, propsMaterial); props.static = true;
chunk.add(buildings, roads, props);
scene.add(chunk);                                    // set chunk.needsUpdate = true only on LOD swap
```
Target: ≤ 6 render objects per chunk (buildings, roads, water edge, props batch, trees instanced, lamps instanced).

### 6.3 Tier detection (boot)
1. `xr = navigator.xr && await navigator.xr.isSessionSupported('immersive-vr')`. Combine with UA (`OculusBrowser` → `xr-standalone`; visionOS Safari → `xr-pro`). XR tiers still boot a flat 2D lobby and switch on session start.
2. After `renderer.init()`: `mobileGPU = hasFeature('texture-compression-astc') && !hasFeature('texture-compression-bc')`; `touch = navigator.maxTouchPoints > 1`; `deviceMemory` when present (Chromium); `adapter.limits.maxBufferSize`/`maxTextureDimension2D`; `screen.width*devicePixelRatio`.
3. Pick a provisional tier, then run a **3 s benchmark** in the loading screen. It renders the boot chunk at the provisional tier's settings with the camera on a canned path and records median and p90 frame ms. Step down one level if p90 > budget × 1.1.
4. Persist `{tier, level, uaHash, adapterHash}` in IndexedDB. The Settings page shows the tier and a manual override, plus a "Re-run benchmark" button.

### 6.4 Runtime governor (two-way, with hysteresis; extends repos-world §1.3's one-way governor)
- Signal: EMA of frame ms (α = 0.06) plus p90 over a rolling 120 frames. In XR use `XRFrame` deltas; on WebGPU with `trackTimestamp`, use GPU time where available (Safari timestamp-query support UNVERIFIED).
- Downgrade when p90 > budget × 1.15 for 2 s. Upgrade when p90 < budget × 0.70 for 10 s. At most one change per 5 s and one upgrade per 30 s.
- Knob order, cheapest visual loss first: render scale/DPR (−10% steps to the tier floor), shadow distance, building draw distance, LOD bias, crowd/traffic density, post nodes (GTAO → bloom → AA mode), cloud/atmosphere tier, foveation (XR), and finally the target frame rate (XR 90→72; mobile 60→30).
- Memory guard: when the `MemoryBudget` hits 85% of the tier cap, evict LRU chunks and textures and lower the texture-resolution bias. At 95%, drop the streaming radius one step.

### 6.5 PWA / service worker strategy for multi-hundred-MB content
- `vite-plugin-pwa` with `strategies: 'injectManifest'`, `registerType: 'prompt'`. Precache the **app shell only**: HTML, hashed JS/CSS, fonts, icons, the wasm decoders and Rapier. Workbox's default `maximumFileSizeToCacheInBytes` is 2,097,152 B and Rapier SIMD wasm is 3.29 MB, so set `maximumFileSizeToCacheInBytes: 6 * 1024 * 1024` and keep everything else over 6 MB out of precache.
- World content (chunk packs, KTX2, glTF, audio banks) **does not go through the SW or the Cache API**. It goes through `asset.worker` and the OPFS block store keyed by manifest hash (repos-webport P3/P4), with `fetch(..., {cache:'no-store', priority})`. Packs are ≤ 4 MB (CDN-friendly, Workers static assets cap 25 MiB) and live on R2 behind a custom domain.
- Small immutable assets (UI atlases, SFX) use runtime `CacheFirst` with `workbox-expiration` (cap about 100 MB) on hashed URLs.
- Cutscene MP4s (R2 or fal-cached): stream by default. "Keep for offline" stores the full `200` response and serves `Range` through `workbox-range-requests` (`RangeRequestsPlugin`), because media elements issue range requests.
- Navigation responses served by the SW must carry COOP/COEP. With `injectManifest`, precached `index.html` keeps the headers from the network response at install time. Add a Playwright check that `crossOriginIsolated === true` after an SW-served reload.
- Updates show "Update ready" only at safe points (main menu, mission end) via `onNeedRefresh`. Never reload mid-mission.
- Request `navigator.storage.persist()` after the player starts the story or installs. Show `estimate()` and "Download San Francisco for offline (≈ N MB)" and "Clear downloaded data" in Settings › Storage.

---

## Performance budgets

These are engineering targets for acceptance tests (R-ENG-02). They are anchored on verified numbers (Meta Quest budgets, Apple display specs, the iPhone 2,048 MB WebContent report, three.js per-object overhead, the SF repo's measured 3.14 M triangles at 60 fps on integrated GPUs), but **the budgets themselves are recommendations, not vendor limits.** "Render objects" means three render items, each a pipeline + bind-group change (what `renderer.info.render.calls` approximates on the WebGL backend). "GPU draw cmds" includes `BatchedMesh` per-instance draws and shadow passes. Streaming radii are in metres from the player in the ENU frame (repos-world §1.1).

| Budget item | Desktop (`desktop`; `desktop-high` = uncapped) | iPhone 16/17 class (`mobile`) | iPhone 15 class / thermal (`mobile-low`) | Quest 3 / 3S (`xr-standalone`) | Vision Pro (`xr-pro`) |
|---|---|---|---|---|---|
| Backend | WebGPU (WebGL2 auto-fallback) | WebGPU | WebGPU (WebGL2 if errors) | **WebGL2 backend + multiview** | WebGPU XR (WebGL2 fallback) |
| Target frame rate | 60 fps (16.7 ms); high: display refresh | 60 fps (16.7 ms); floor 30 | 30 fps (33.3 ms) | 72 Hz min (13.9 ms); 90 Hz on Quest 3 when p90 < 9 ms | 90 Hz (11.1 ms) |
| Internal render resolution | ≤ 2.56 MP, DPR cap 1.5 (repos-world) | ≤ 1.2 MP (≈ 0.63 of native 3.0–3.2 MP), DPR cap 1.25 rel. CSS×1.5 | ≤ 0.8 MP | framebufferScale 1.0 (Q3 2064×2208/eye; 3S 1832×1920/eye), foveation 1.0 → tune | Safari default XR framebuffer; scale 1.0, drop to 0.8 on next entry if needed |
| Render objects / frame (incl. shadows) | ≤ 600 | ≤ 150 | ≤ 100 | ≤ 150 (Meta < 200) | ≤ 200 per eye (no multiview: ≤ 400 total) |
| GPU draw cmds / frame | ≤ 2,500 | ≤ 500 | ≤ 300 | ≤ 300 | ≤ 600 total |
| Triangles / frame | ≤ 4 M | ≤ 1.0 M | ≤ 0.6 M | ≤ 0.75 M (Meta < 1.5 M; headroom for hands/UI/NPCs) | ≤ 1.5 M per eye |
| Texture memory (GPU) | ≤ 1.0 GB (BC7) | ≤ 350 MB (ASTC) | ≤ 250 MB | ≤ 400 MB (ASTC/ETC2 via KTX2) | ≤ 800 MB (ASTC) |
| Total GPU resources | ≤ 2 GB | ≤ 600 MB | ≤ 400 MB | ≤ 700 MB | ≤ 1.5 GB |
| JS + wasm heap | ≤ 1.5 GB | ≤ 600 MB (WebContent total ≤ 1.2 GB vs 2,048 MB kill) | ≤ 450 MB (total ≤ 900 MB) | ≤ 700 MB | ≤ 1.0 GB |
| Full-detail streaming radius | 1,800 m (always-visible 2,800 m) | 600 m | 400 m | 400 m | 800 m |
| Building draw distance | 8,200 m (+ altitude boost ≤ 2,800) | 2,500 m | 1,500 m | 1,500 m + fog | 3,000 m |
| Far field (Bay backdrop) | 80 km impostor ring + DEM | skyline cards 20 km | skyline cards 10 km | skyline cards 10 km | skyline cards 20 km |
| Chunk GPU uploads / frame | ≤ 1 (repos-world) | ≤ 1 | ≤ 1, ≤ 2 MB | ≤ 1, ≤ 2 MB | ≤ 1 |
| Shadows | SunLight CSM, 3 cascades 2048², 1,650 m | 1 cascade 1024², 150 m | blob only | blob only | 1 cascade 2048², 200 m |
| Post | GTAO ½-res, bloom, SMAA/TRAA, tone map | FXAA + tone map; bloom on A19 Pro only | tone map only | none (DirectRenderPipeline) | none / tone map in material |
| Traffic / peds (instanced) | 540 cars / 400 peds | 200 / 150 | 120 / 80 | 120 / 80 | 300 / 200 |
| Sim / physics | sim 60 Hz fixed; physics radius 400 m | 60 Hz (30 Hz AI); 200 m | 30 Hz AI; 150 m | 72/90 Hz render, 60 Hz sim + interpolation, distant anim 30 Hz | 90 Hz render, 60 Hz sim |
| Boot to playable (warm cache) | ≤ 8 s | ≤ 12 s | ≤ 15 s | ≤ 12 s | ≤ 10 s |
| Boot download (cold, first district) | ≤ 60 MB | ≤ 40 MB | ≤ 30 MB | ≤ 40 MB | ≤ 60 MB |

Checks the spec should automate:
- Playwright + Chrome WebGPU for desktop numbers (`renderer.info`, frame ms on canned camera paths).
- The same run with `?gl=1` for the WebGL2 backend.
- A `limits`-override "weak device" run (repos-webport P15).
- Manual device checks listed per milestone for iPhone 15/16/17, Quest 3/3S and Vision Pro, with numbers read from an on-screen perf HUD (`?perf=1`).

---

## Quality tiers and auto-detect (maps to contract C13)

`tier: 'mobile' | 'desktop' | 'xr-standalone' | 'xr-pro'` per C13. Add `level: 'low' | 'medium' | 'high' | 'ultra'` inside each tier: `mobile-low` = `mobile/low`, `desktop-high` = `desktop/high`, takram atmosphere only at `desktop/ultra`. Detection is §6.3, the runtime governor §6.4. Overrides: Settings page (persisted), and URL flags `?tier=`, `?level=`, `?gl=1`, `?perf=1` for QA.

---

## Verified facts

| fact | source URL | date checked | confidence |
|---|---|---|---|
| `three` latest = 0.186.1, published 2026-09-24; 0.186.0 on 2026-09-08; 0.185.0 on 2026-06-25; MIT | https://registry.npmjs.org/three | 2026-10-18 | high |
| Live threejs.org build reports `REVISION = '186'` | https://threejs.org/build/three.core.js | 2026-10-18 | high |
| r186 (24 Sep): "Add MSAA support to WebXR WebGPU", "Enable MSAA for native XR layers", "Detect WebGPU XR support upfront", "Add DirectRenderPipeline", "Remove remaining PCFSoftShadowMap code", "Deprecate CommonJS build", "Remove minified builds", "Removed (wip) from webgpu", "Add SunLight with cascaded shadow maps" | https://github.com/mrdoob/three.js/releases/tag/r186 | 2026-10-18 | high |
| r185 (01 Jul): "Add support for WebXR with WebGPU", "Add fallback for XR with WebGPU", "Use foveateBoundTexture() to enable foveation", "Added ClusteredLighting (Forward+ clustered) shading" | https://github.com/mrdoob/three.js/releases/tag/r185 | 2026-10-18 | high |
| WebGPURenderer defaults to WebGPUBackend with `getFallback` → WebGLBackend; `forceWebGL` option forces WebGL2 | https://unpkg.com/three@0.186.1/src/renderers/webgpu/WebGPURenderer.js | 2026-10-18 | high |
| WebGPUBackend requests adapter with `featureLevel: 'compatibility'` and `xrCompatible: renderer.xr.enabled`; options incl. `trackTimestamp`, `requiredLimits`, `powerPreference` | https://unpkg.com/three@0.186.1/src/renderers/webgpu/WebGPUBackend.js | 2026-10-18 | high |
| XRManager: native WebGPU XR needs `XRGPUBinding` + `'webgpu'` session feature; "WebGPU XR does not support multiview yet"; WebGL path uses XRProjectionLayer and `OVR_multiview2`; quad/cylinder layers; defaults `local-floor`, scale 1, foveation 1.0 | https://unpkg.com/three@0.186.1/src/renderers/common/XRManager.js | 2026-10-18 | high |
| `setupWebGLXRFallback` swaps to a `forceWebGL` renderer at session start when `XRGPUBinding` is undefined; official example uses `multiview: true`, `XRButton` with `optionalFeatures: ['webgpu']`, `DirectRenderPipeline` | https://unpkg.com/three@0.186.1/examples/jsm/webxr/WebGLXRFallback.js ; https://threejs.org/examples/webgpu_xr_cubes.html | 2026-10-18 | high |
| `PostProcessing` deprecated since r183, renamed `RenderPipeline` | https://unpkg.com/three@0.186.1/src/renderers/common/PostProcessing.js | 2026-10-18 | high |
| TSL display nodes in r186 include GTAONode, SSAONode, SSRNode, SSGINode, BloomNode, SMAANode, FXAANode, TRAANode, TAAUNode, FSR1Node, OITPassNode | https://unpkg.com/browse/three@0.186.1/examples/jsm/tsl/display/ | 2026-10-18 | high |
| `PCFSoftShadowMap` "@deprecated since r186. Use PCFShadowMap instead" | https://unpkg.com/three@0.186.1/src/constants.js | 2026-10-18 | high |
| `Object3D.static` lets WebGPURenderer bypass state checks; `BundleGroup` = WebGPU render bundles, no gain on WebGL backend | https://unpkg.com/three@0.186.1/src/core/Object3D.js ; https://unpkg.com/three@0.186.1/src/renderers/common/BundleGroup.js | 2026-10-18 | high |
| BatchedMesh on WebGPU backend = loop of `drawIndexed` per visible instance | https://unpkg.com/three@0.186.1/src/renderers/webgpu/WebGPUBackend.js | 2026-10-18 | high |
| Issue #30560 (per-object UBO overhead in WebGPURenderer) open; maintainer numbers 12 vs 60 FPS (Chrome), 19 vs 57 (Android); r186 WebGL2 fallback ~80% more GL calls (user, 2026-09-15) | https://github.com/mrdoob/three.js/issues/30560 | 2026-10-18 | high (status) / medium (numbers) |
| Maintainer: no speed-up expected from swapping renderers; batching/instancing remain important | https://discourse.threejs.org/t/understanding-about-webgpurenderer/86635 | 2026-10-18 | medium |
| `WebGLNodesHandler` limitations: no VSM, MRT, transmission, WebGPU post stack, storage textures | https://unpkg.com/three@0.186.1/examples/jsm/tsl/WebGLNodesHandler.js | 2026-10-18 | high |
| `KTX2Loader.detectSupport` uses `renderer.hasFeature('texture-compression-astc'/'etc2'/'bc')`; `detectSupportAsync` deprecated r181 | https://unpkg.com/three@0.186.1/examples/jsm/loaders/KTX2Loader.js | 2026-10-18 | high |
| three npm ships basis transcoder (wasm 527,333 B), Draco decoder (285,747 B), meshopt decoder | https://unpkg.com/browse/three@0.186.1/examples/jsm/libs/ | 2026-10-18 | high |
| `postprocessing@6.39.5` (2026-09-09) peer `three >=0.168.0 <0.187.0`, no WebGPU code; `7.0.0-beta.16` peer `three <0.184.0` | https://registry.npmjs.org/postprocessing | 2026-10-18 | high |
| `n8ao@2.0.1` (2026-08-10), README: "N8AO is not yet compatible with WebGPU" | https://registry.npmjs.org/n8ao ; https://unpkg.com/n8ao@2.0.1/README.md | 2026-10-18 | high |
| `earcut@3.2.4` (2026-09-28), ISC | https://registry.npmjs.org/earcut | 2026-10-18 | high |
| `3d-tiles-renderer@0.5.3` contains no WebGPU-specific code | https://unpkg.com/browse/3d-tiles-renderer@0.5.3/ | 2026-10-18 | medium |
| Safari 26.0 (2025-09-15): WebGPU shipping on macOS/iOS/iPadOS/visionOS; "By default, every website added to the Home Screen opens as a web app"; "zero requirements for 'installability'" | https://webkit.org/blog/17333/webkit-features-in-safari-26-0/ | 2026-10-18 | high |
| Safari 26.2 (2025-12-12): "Now with Safari 26.2 on visionOS, WebXR supports WebGPU"; WebXR first shipped in Safari 18.0 / visionOS 2 | https://webkit.org/blog/17640/webkit-features-for-safari-26-2/ | 2026-10-18 | high |
| Safari 18.0: `immersive-vr` on visionOS 2, `transient-pointer`, hand tracking with permission prompt | https://webkit.org/blog/15865/webkit-features-in-safari-18-0/ | 2026-10-18 | high |
| visionOS transient input: array empty until pinch; with hand-tracking, transient inputs follow hand inputs; attach objects to `gripSpace` | https://webkit.org/blog/15162/introducing-natural-input-for-webxr-in-apple-vision-pro/ | 2026-10-18 | high |
| Safari 26.4 (2026-03-24): WebTransport; Fullscreen Keyboard Lock (`requestFullscreen({keyboardLock:"browser"})`) | https://webkit.org/blog/17862/ (https://webkit.org/?p=17862) | 2026-10-18 | high |
| Safari 27.0 (2026-09-17): WGSL `clip_distances`; texture-array projection layers in WebXR Layers; JSPI; `<model>` on iOS/iPadOS/macOS; visionOS `gamepadconnected` fix; restored `maxStorageBuffersInFragmentStage` | https://webkit.org/blog/18325/webkit-features-for-safari-27-0/ | 2026-10-18 | high |
| WebKit storage policy: origin quota ≤ 60% disk, overall ≤ 80% (browser apps); standalone web apps same quotas; `persist()` granted on heuristics incl. Home Screen web app; LRU origin eviction | https://webkit.org/blog/14403/updates-to-storage-policy/ | 2026-10-18 | high |
| iOS Safari `requestFullscreen`: "Only available on iPad, not on iPhone" | https://github.com/mdn/browser-compat-data (v8.1.6, api.Element.requestFullscreen) | 2026-10-18 | high |
| iOS Safari lacks `ScreenOrientation.lock`, manifest `orientation`, `navigator.vibrate`, `Gamepad.vibrationActuator`, Pointer Lock, `beforeinstallprompt`, `deviceMemory`, `measureUserAgentSpecificMemory`, `requestIdleCallback`, COEP `credentialless`, relaxed SIMD, memory64 | https://github.com/mdn/browser-compat-data (v8.1.6) | 2026-10-18 | high |
| iOS Safari has PushManager 16.4, `navigator.audioSession` 16.4, Wake Lock 18.4, SAB 15.2, OPFS sync handles 15.2, `WorkerNavigator.gpu` 26, OffscreenCanvas 16.4, WebTransport 26.4, wasm SIMD 16.4, JSPI 27 | https://github.com/mdn/browser-compat-data (v8.1.6) | 2026-10-18 | high |
| Quest Browser (BCD "oculus"): WebGPU since 32; XRHand 15.1; XRProjectionLayer 16.1; OVR_multiview2 17.0; `updateTargetFrameRate` 31.2; `fixedFoveation` 8.0 | https://github.com/mdn/browser-compat-data (v8.1.6) | 2026-10-18 | medium |
| Quest Browser 146.0 (2026-04-21) "Experimental WebGPU and WebXR depth projection support"; 149.1 WebGPU space-warp layers; 150.1 experimental WebGPU foveation; 152.1 (2026-10-02) experimental WebGPU composition layers | https://developers.meta.com/horizon/documentation/web/browser-release-notes/ | 2026-10-18 | high |
| Meta engineer: Quest Browser 146 WebGPU in WebXR is experimental; enable "webXR experimental features" in chrome://flags | https://x.com/rcabanier/status/2047408843244912810 | 2026-10-18 | medium |
| Chrome 153 exposes `navigator.xr` and `navigator.gpu` but no `XRGPUBinding` | https://github.com/playcanvas/developer-site/pull/1240 | 2026-10-18 | medium |
| three issue #32858 (Jan 2026): WebGPU-on-WebXR "shipping on Apple Vision Pro and experimental on Chrome for Windows and Android XR"; closed 2026-05-23 for r185 | https://github.com/mrdoob/three.js/issues/32858 | 2026-10-18 | high |
| Chrome flags for WebGPU-in-WebXR: "WebXR Projection Layers" + "WebXR/WebGPU Bindings" (Canary 135+), projection layers only | https://toji.dev/2025/03/03/experimenting-with-webgpu-in-webxr.html | 2026-10-18 | medium (2025 post) |
| Quest 3: XR2 Gen 2, 8 GB, 2064×2208/eye, 72/80/90/120 Hz, target 72 Hz (90 recommended), 13.8 ms, < 200 draw calls, < 1.5 M triangles; Quest 2 < 100 / < 750K | https://developers.meta.com/horizon/resources/device-optimization-comparison/ | 2026-10-18 | high |
| Meta WebXR: "KTX 2.0/Basis Universal is the recommended approach"; shadow map counts against budget; update animations at 30 Hz while rendering 90 | https://developers.meta.com/horizon/documentation/web/webxr-perf-bp/ | 2026-10-18 | high |
| Quest 3S: 1832×1920/eye, XR2 Gen 2, 8 GB | https://roadtovr.com/quest-3s-quest-3-quest-2-specs-compared/ | 2026-10-18 | medium |
| Meta locomotion guidance: default teleport + snap turn, vignette while moving, quantized velocity; IWSDK slide comfort 0.4–0.6, 4–6 m/s | https://developers.meta.com/horizon/design/locomotion-best-practices/ ; https://developers.meta.com/horizon/documentation/web/iwsdk-concept-locomotion-slide/ | 2026-10-18 | medium |
| Apple Vision Pro: M5, 16 GB unified memory, 23 M pixels, refresh 90/96/100/120 Hz | https://www.apple.com/apple-vision-pro/specs/ | 2026-10-18 | high |
| iPhone 17: A19 (6-core CPU, 5-core GPU), ProMotion up to 120 Hz, 2622×1206; iPhone 16 A18 2556×1179; iPhone 15 A16 2556×1179 | https://www.apple.com/iphone-17/specs/ ; https://www.apple.com/iphone/compare/ | 2026-10-18 | high |
| iPhone RAM: 15 = 6 GB, 16 = 8 GB, 17 = 8 GB, 17 Pro/Air = 12 GB (not published by Apple) | https://appleosophy.com/2025/09/04/new-report-lists-ram-specs-for-all-iphone-17-models/ | 2026-10-18 | low |
| iPhone 17 Pro (iOS 26.3–26.4.1): WebContent killed at "ActiveHard 2048 MB"; Apple engineer: "iPhones do indeed have stricter jetsam limits than iPads" | https://developer.apple.com/forums/thread/823061 | 2026-10-18 | medium |
| WebKit bug 303203: WebGPU GPU-process leak (`CommandEncoder::trackEncoder`) on iOS/macOS 26, fixed 2025-12-05; fewer encoders per frame mitigated | https://bugs.webkit.org/show_bug.cgi?id=303203 | 2026-10-18 | high |
| Safari renders near 60 fps by default unless "Prefer Page Rendering Updates near 60fps" flag is off | https://www.macrumors.com/how-to/enable-smoother-120hz-browsing-in-safari/ | 2026-10-18 | low |
| WebGPU `texture-compression-astc`: iOS 99.96%, Android 99.95%, macOS 95.29%, Windows 0.04%; iOS `maxBufferSize` ≥ 1 GiB on 80% of reports | https://web3dsurvey.com/webgpu/features/texture-compression-astc ; https://web3dsurvey.com/webgpu/limits/maxBufferSize | 2026-10-18 | medium |
| Rapier JS 0.21.0 (2026-09-25), Apache-2.0; base = locally deterministic, `-simd` needs simd128, `-deterministic` cross-platform, `-compat` embeds wasm; `KinematicCharacterController`, `DynamicRayCastVehicleController`, `PidController`, `takeSnapshot` | https://registry.npmjs.org/@dimforge/rapier3d-simd-compat ; https://unpkg.com/@dimforge/rapier3d-simd-compat@0.21.0/README.md | 2026-10-18 | high |
| jolt-physics 1.1.0 (2026-07-11), MIT; WheeledVehicleController, MotorcycleController, TrackedVehicleController, CharacterVirtual, Ragdoll; manual `Jolt.destroy`; `DOUBLE_PRECISION` "allows worlds larger than a couple of km"; `CROSS_PLATFORM_DETERMINISTIC` | https://registry.npmjs.org/jolt-physics ; https://unpkg.com/jolt-physics@1.1.0/README.md | 2026-10-18 | high |
| cannon-es last publish 0.20.0 on 2022-08-12 | https://registry.npmjs.org/cannon-es | 2026-10-18 | high |
| bitecs 0.4.0 (2025-12-06), MPL-2.0; SAB-backed SoA stores, `asBuffer` queries; ECS structural APIs not usable in workers | https://registry.npmjs.org/bitecs ; https://github.com/NateTheGreatt/bitECS/blob/main/docs/Multithreading.md | 2026-10-18 | high |
| koota 0.6.6, ISC, React optional peer; SoA schema traits, relations | https://registry.npmjs.org/koota ; https://github.com/pmndrs/koota | 2026-10-18 | high |
| miniplex last publish 2.0.0 on 2023-07-16 | https://registry.npmjs.org/miniplex | 2026-10-18 | high |
| @react-three/fiber 9.8.2 (2026-10-14) peer `react >=19 <19.4`; 10.0.0-alpha.6 (2026-10-17) | https://registry.npmjs.org/@react-three/fiber | 2026-10-18 | high |
| Vite 8.3.4 (2026-10-08), Node `^20.19.0 || >=22.12.0`; Vite 8 stable 2026-03-12 with Rolldown | https://registry.npmjs.org/vite ; https://vite.dev/blog/announcing-vite8.html | 2026-10-18 | high |
| vite-plugin-pwa 2.0.0 (2026-10-03), peer vite ^3–^8, workbox ^7.4.1, Node ≥ 20.19 | https://registry.npmjs.org/vite-plugin-pwa ; https://github.com/vite-pwa/vite-plugin-pwa/releases | 2026-10-18 | high |
| workbox-build 7.4.1: `maximumFileSizeToCacheInBytes` default 2,097,152; `workbox-range-requests` 7.4.1 exists | https://unpkg.com/workbox-build@7.4.1/build/schema/GenerateSWOptions.json ; https://registry.npmjs.org/workbox-range-requests | 2026-10-18 | high |
| TypeScript latest 7.0.2 (2026-07-08); 6.0.3 (2026-04-16); typescript-eslint 8.71.2 peer `typescript >=4.8.4 <6.1.0` | https://registry.npmjs.org/typescript ; https://registry.npmjs.org/typescript-eslint | 2026-10-18 | high |
| @gltf-transform/cli 4.5.1: `--compress` default `meshopt`; `--texture-compress ktx2|webp|avif|auto`; needs KTX-Software ≥ 4.4.0 | https://unpkg.com/@gltf-transform/cli@4.5.1/dist/cli.mjs | 2026-10-18 | high |
| KTX-Software latest stable v4.4.2; v5.0.0-rc2 pre-release removes legacy tools (toktx → `ktx create`) | https://github.com/KhronosGroup/KTX-Software/releases | 2026-10-18 | high |
| basis_universal latest v2.50 (XUASTC deblocking, XUBC7) | https://github.com/BinomialLLC/basis_universal/releases | 2026-10-18 | medium |
| meshoptimizer 1.3.0 (2026-09-25); three-mesh-bvh 0.9.16 (2026-10-08) | https://registry.npmjs.org/meshoptimizer ; https://registry.npmjs.org/three-mesh-bvh | 2026-10-18 | high |
| @iwsdk/core 1.0.1 (2026-10-01) depends on `three: npm:super-three@0.181.0`; @iwsdk/locomotor & xr-input 1.0.1 peer `three >=0.160.0`, MIT | https://registry.npmjs.org/@iwsdk/core ; https://registry.npmjs.org/@iwsdk/locomotor | 2026-10-18 | high |
| @cloudflare/vite-plugin 1.64.0 peer vite ^6.1–^8, wrangler ^4.151.0; wrangler 4.151.1 Node ≥ 22; vitest 5.0.5; @playwright/test 1.64.1 | https://registry.npmjs.org/@cloudflare/vite-plugin ; https://registry.npmjs.org/wrangler | 2026-10-18 | high |
| `navigator.xr` is not exposed on `WorkerNavigator`; `navigator.gpu` is | https://github.com/mdn/browser-compat-data (v8.1.6) | 2026-10-18 | high |

---

## Unverified

- UNVERIFIED: WebGPU behaves identically (features, limits, memory) in an iOS Home Screen web app and in a Safari tab.
- UNVERIFIED: the jetsam limit of `com.apple.WebKit.GPU` on iPhone, and whether the 2,048 MB WebContent limit applies to every iPhone model (only an iPhone 17 Pro report).
- UNVERIFIED: whether ProMotion iPhones run rAF above 60 Hz in Safari or standalone without the feature flag (secondary sources only).
- UNVERIFIED: Safari iOS background suspension timing for PWAs (rAF, timers, WebSocket/WebTransport lifetime).
- UNVERIFIED: Vision Pro WebXR default framebuffer resolution, achievable frame rate (90 vs 100/120 Hz) and foveation in Safari, plus the relative cost of the WebGPU XR path vs the WebGL XR path there.
- UNVERIFIED: `immersive-ar` on visionOS Safari, and whether PS VR2 Sense controllers appear as WebXR input sources.
- UNVERIFIED: the exact chrome://flags names in Quest Browser 152.1 for WebXR/WebGPU binding, and whether non-XR WebGPU is on by default in current Quest Browser (BCD says since 32; not checked on a device).
- UNVERIFIED: takram `@takram/three-atmosphere` WebGPU nodes working with three r186.
- UNVERIFIED: `3d-tiles-renderer@0.5.3` and `@three.ez/instanced-mesh` rendering correctly under WebGPURenderer.
- UNVERIFIED: `@iwsdk/locomotor` working with WebGPURenderer or the WebGL2 backend of WebGPURenderer.
- UNVERIFIED: Safari support for the WebGPU `timestamp-query` feature (affects `trackTimestamp` GPU timing).
- UNVERIFIED: Safari on Apple Silicon Macs exposes `texture-compression-bc` (web3dsurvey shows ASTC at 95% on macOS; BC not checked).
- UNVERIFIED: three's bundled Basis transcoder supports basis_universal v2.x XUASTC payloads.
- UNVERIFIED: iPhone RAM sizes (Apple does not publish them).
- UNVERIFIED: the r187 release date and whether `postprocessing` will widen its three peer range (irrelevant if the recommendation to drop it is accepted).
- UNVERIFIED: Node 24's LTS status label as of 2026-10-18.
- UNVERIFIED: Safari 27 "Safari MCP" server for coding agents (named in search summaries of the Safari 27.0 post, not in the sections fetched). It could support agentic QA on macOS.

---

## Recommendations for the spec

1. **Pin** `three@0.186.1`, `@types/three@0.186.0`, `earcut@3.2.4`, `three-mesh-bvh@0.9.16`, `@dimforge/rapier3d-simd-compat@0.21.0` (plus `@dimforge/rapier3d-deterministic-compat@0.21.0` for replay/server checks), `bitecs@0.4.0`, `vite@8.3.4`, `vite-plugin-pwa@2.0.0`, `workbox-window@7.4.1`, `workbox-build@7.4.1`, `workbox-range-requests@7.4.1`, `@vite-pwa/assets-generator@2.0.0`, `typescript@6.0.3`, `typescript-eslint@8.71.2`, `vitest@5.0.5`, `@playwright/test@1.64.1`, `@gltf-transform/cli@4.5.1`, `meshoptimizer@1.3.0`, KTX-Software **4.4.2** in CI.
2. **Remove `postprocessing` and `n8ao` from the stack** (WebGLRenderer-only; postprocessing's peer `<0.187.0` would block upgrades). Update repos-world rec 11 and the master prompt's pin line accordingly. Use three's `RenderPipeline` and TSL nodes (`GTAONode`/`SSAONode`, `BloomNode`, `SMAANode`/`FXAANode`/`TRAANode`, `FSR1Node`/`TAAUNode`).
3. **Replace "start WebGL2 with WebGPU behind a flag"**: use `WebGPURenderer` on every platform with one TSL material codebase, selecting the backend per tier (WebGPU on desktop, iPhone and Vision Pro; `forceWebGL: true` on Quest XR; `?gl=1` override everywhere). Forbid `ShaderMaterial`, `onBeforeCompile` and GLSL strings in engine code (lint rule).
4. **XR architecture**:
   - Set `renderer.xr.enabled = true` before `await renderer.init()`.
   - Use the official `setupWebGLXRFallback` pattern. The `RendererHost` must support swapping the renderer and canvas at XR entry and re-warming pipelines.
   - Request `optionalFeatures: ['webgpu','local-floor','bounded-floor','layers','hand-tracking']`.
   - Use `multiview: true` on the WebGL backend and `DirectRenderPipeline` (no screen-space post) in XR.
   - Route input by `event.inputSource`, never by index.
5. **State in the spec, verbatim**: "WebXR runs on WebGPURenderer. Native WebGPU XR is used only where `XRGPUBinding` exists (Vision Pro, Safari 26.2+). Quest 3/3S and desktop Chrome use WebGPURenderer's WebGL2 backend with multiview. Revisit when Quest Browser ships the binding by default."
6. **Design for render-object count**:
   - One `BundleGroup` per world chunk, with `static = true` on baked meshes.
   - `InstancedMesh` for every repeated prop or agent class; `BatchedMesh` for heterogeneous props.
   - ≤ 6 render objects per chunk.
   - Budgets from "## Performance budgets" become milestone acceptance criteria, measured with `renderer.info` on canned camera paths.
7. **Shadows**: replace `PCFSoftShadowMap` with `PCFShadowMap`. Use the `SunLight` CSM addon on desktop, one 1024² cascade on `mobile`, and blob shadows on `mobile-low` and Quest.
8. **Context topology (amends repos-webport rec 1)**: render on the main thread in v1 (XR requires it), with `sim.worker` (bitECS + Rapier) and `asset.worker` (fetch + OPFS). An OffscreenCanvas render worker is a flagged, flat-screen-only experiment after M11.
9. **Floating origin for physics**: active physics radius 200–400 m, rebase when more than 1 km from the origin, and per-chunk static colliders built from the same baked heightfield and building cells as rendering (repos-world invariant).
10. **Physics backend interface** (`PhysicsBackend` contract) with a Rapier implementation. Keep Jolt `1.1.0` as the documented swap for Racing if vehicle-feel acceptance fails. No cannon-es.
11. **iPhone UX rules**:
    - Treat Home Screen install as the recommended mode, with a coach mark and no `beforeinstallprompt` assumption.
    - "Rotate to landscape" overlay; `viewport-fit=cover` with safe-area HUD.
    - Audio unlock on first gesture, plus `navigator.audioSession.type='playback'` when present.
    - No haptics on iPhone (design feedback via audio and visuals).
    - Gamepad supported; Wake Lock during cutscenes and races.
    - Persist on `visibilitychange` and `pagehide`.
12. **Memory**:
    - Implement a `MemoryBudget` service (texture/geometry bytes from `renderer.info.memory`, wasm heap, caches) with per-tier caps from the budget table, LRU eviction at 85% and radius drop at 95%.
    - On iOS, cap JS+wasm at 600 MB (`mobile`) / 450 MB (`mobile-low`).
    - Use one command encoder per frame.
13. **PWA**:
    - `injectManifest` strategy, app shell only in precache, `maximumFileSizeToCacheInBytes = 6 MiB`.
    - World packs through `asset.worker` + OPFS (not the SW); cutscene offline copies via `RangeRequestsPlugin`.
    - `registerType: 'prompt'`, updates applied only at safe points.
    - Playwright test asserts `crossOriginIsolated` after an SW-served reload.
    - `persist()` after story start; Settings › Storage UI with `estimate()`.
14. **Assets**:
    - `gltf-transform optimize --compress meshopt --texture-compress ktx2` (UASTC for hero and character textures, ETC1S for bulk city and props); KTX2 transcoded to ASTC on Apple/Quest and BC7 on Windows.
    - Self-host the three decoders (`examples/jsm/libs/basis`, `draco`, meshopt) same-origin.
    - Max pack 4 MB, max texture 2048² on mobile and 4096² on desktop.
15. **Tier detection and governor**:
    - Implement §6.3 (features + UA + 3 s benchmark + persisted choice + settings override) and §6.4 (two-way governor with hysteresis and the listed knob order). Expose `?tier= ?level= ?gl=1 ?perf=1`.
    - Add the perf HUD to M01 so device checks can read numbers.
16. **XR comfort defaults**: teleport + snap turn (30°/45° options) on foot, smooth locomotion opt-in with vignette, quantized speeds, cockpit rest-frame driving with yaw-rate vignette, a fixed-camera fighter arena, and quad/cylinder layers for HUD and menus on the WebGL XR path. Evaluate `@iwsdk/locomotor` in M11 (not `@iwsdk/core`).
17. **Frame-rate targets**: 60 Hz max on iPhone (30 Hz `mobile-low`); Quest 72 Hz baseline with `updateTargetFrameRate(90)` when the governor allows; Vision Pro 90 Hz; desktop 60 Hz (`desktop-high` uncapped).
18. **Device test matrix in `spec/08-test-and-ci.md`**: Chrome stable (Win/macOS) WebGPU + `?gl=1`; Safari 27 macOS; iPhone 15 (A16), iPhone 16 or 17 (A18/A19) as Home Screen apps on iOS 26.x and 27.x; Quest 3 and Quest 3S on Quest Browser ≥152; Vision Pro on visionOS 26.2+ and 27. Each milestone lists which devices must pass.
19. **No R3F**. Vanilla three engine in `packages/engine`; UI framework (if any) only in `apps/web` UI, talking to the engine via commands and events.
20. **Keep takram atmosphere strictly optional** (`desktop/ultra`), behind an adapter with a timecyc fallback, because its WebGPU path is WIP and r186 compatibility is unverified.

---

## Risks

1. **WebGPURenderer per-object CPU overhead** (issue #30560 open; the WebGL2 fallback is heavier than WebGLRenderer). A naive scene of thousands of meshes will miss every budget, Quest's above all. Mitigation: chunk merging, instancing, bundles and render-object budgets enforced in CI from M01.
2. **Quest stays on the WebGL2 backend** until Meta ships the WebXR/WebGPU binding by default, so WebGPU-only features (compute-driven culling, storage buffers in shaders, render bundles) give no benefit in Quest XR. Mitigation: never make gameplay depend on compute shaders; keep compute optional (particles, culling) with CPU fallbacks.
3. **Renderer swap at XR entry** (`setupWebGLXRFallback`) re-creates GPU resources. On a streamed city this can cost seconds and a memory spike (two renderers briefly alive). Mitigation: on XR-capable UAs start the flat lobby already on the XR-appropriate backend (Quest → WebGL2), dispose the old renderer before re-streaming, and show a loading vignette.
4. **No multiview in native WebGPU XR (three r186)** doubles CPU submission on Vision Pro. Mitigation: halve the per-eye render-object budget and test the WebGL fallback path on Vision Pro as a comparison.
5. **iPhone memory kills are silent page reloads** (2,048 MB WebContent report; separate GPU-process limits unknown; past WebGPU leak in iOS 26.0/26.1). Mitigation: `MemoryBudget` caps, one encoder per frame, a reload-detection banner, and saves on `visibilitychange`.
6. **60 Hz cap and thermals on iPhone**: sustained 60 fps in an open city on A16/A18 is not guaranteed. Mitigation: 30 Hz `mobile-low`, governor-driven fallback, and the R-PLAT-05 wording kept as SHOULD.
7. **No orientation lock or fullscreen on iPhone** risks accidental portrait play and browser chrome in Safari tabs. Mitigation: rotate overlay, Home Screen install coaching, safe-area layout.
8. **COEP `require-corp` without `credentialless` on Safari** breaks third-party auth/mod widgets in the isolated document (repos-webport risk 3). Mitigation: separate non-isolated routes for auth and forum, and CORP on R2.
9. **Upgrade drift**: three releases monthly with renames (r183 PostProcessing→RenderPipeline, r186 PCFSoft removal, CJS deprecation). Mitigation: pin exact versions, gate upgrades behind a visual regression suite (SF repo luminance gates) and an `UPGRADING.md` checklist.
10. **f32 physics precision** over a 20 km world causes jitter if the physics origin is not rebased. Mitigation: floating origin (rec 9) with a unit test that drops a body at (±9.5 km, ±9.5 km) and asserts rest stability.
11. **TypeScript 7 vs lint tooling mismatch**: `typescript-eslint` does not support TS ≥ 6.1 yet. Mitigation: pin TS 6.0.3.
12. **XR comfort**: driving and police chases in VR are high-vection. Mitigation: comfort defaults, opt-in intensity, and a seated diorama chase mode; require comfort playtest sign-off in M11.
13. **Takram / 3D Tiles / IWSDK addons** may not work on WebGPURenderer (unverified). Mitigation: all optional, behind adapters, none on the critical path.

---

## Open questions

1. Is the Quest XR experience required at launch to have parity visuals with desktop, or is "Quest = mobile-class visuals at 72 Hz" acceptable? This decides whether we invest in WebGL-backend-specific XR optimizations.
2. Minimum supported iPhone: is iPhone 15 (A16, 6 GB, `mobile-low` 30 fps) in scope, or is iPhone 16 (A18) the floor?
3. Must XR support every mode, or only the main game, racing and the Culture Wars viewer? Tycoon could be a flat panel in XR.
4. Vision Pro: is hands/gaze-only acceptable, or must we support PS VR2 controllers (their WebXR exposure is unverified)?
5. Should players be able to run a takram-quality "ultra sky" on desktop, given its WIP WebGPU status, or do we ship only the timecyc sky everywhere in v1?
6. Offline: should a Home Screen install pre-download all of SF (an estimated few hundred MB, to be measured in M02), or only districts as visited?
7. Can a device lab (iPhone 15/16/17, Quest 3/3S, Vision Pro) run each milestone's manual checks, or must acceptance be emulator-only for some devices?
8. Is Racing's vehicle feel "arcade" (Rapier ray-cast vehicle + custom grip) or closer to Forza-sim (Jolt `WheeledVehicleController` with drivetrain)? This decides the physics backend for that mode.
9. When should the spec revisit native WebGPU XR on Quest: at a fixed milestone (M11) or when Meta announces default-on?
10. Should the WebGPU render worker (OffscreenCanvas) be explored at all, given XR forces main-thread rendering?
