# Example repos: GTA V web/native port architecture (playgta5, muguet)

Dimension key: `repos-webport`. Date of analysis: 2026-10-18.

Sources read locally (shallow clones):

| Repo | Remote | Last commit | License |
|---|---|---|---|
| playgta5 | https://github.com/shadany7824/playgta5 | `2fb671a` 2026-10-12 "Update README with archival note and V2 link" | none in repo (scraped site JS; copyright of an unidentified port author) |
| muguet | https://github.com/c22dev/muguet | `1b4600b` 2026-10-18 | GPL-3.0-or-later (`Cargo.toml`, `LICENSE`) |

playgta5 files read: `README.md`, `ENGINE_INVESTIGATION.md`, `INVESTIGATION.md`, `headers.txt`, `loader.js` (146 lines), `io_worker.js` (644), `wgpu_worker.js` (2,969), `game.js` (minified, 124 KB; grepped), `homepage.html` (603), `serve_local.py`, `data-manifest.json` (5,814 entries), `shader-index.json` (4,919 entries + `_packs`), `snapshot/*.json` inventories.
muguet files read: `Cargo.toml`, `build.rs`, `src/main.rs`, `host.rs`, `io.rs`, `fs.rs` (head), `proto.rs`, `server.rs`, `mp.rs` (selected regions of 3,017 lines), `patch.rs`, `config.rs`, `app.rs`, `audio.rs`, `touch.rs` (head), `gpu.rs` (head + grep), `import.rs` (head), `heapcheck.rs` (head), `ios/*`, `make-ios.sh`, `make-app.sh`, `build.sh`.

Not present / not read: the `mirror/` folder (gitignored, 19.7 GB of Rockstar data), `audio-worklet.js` (1,496 bytes, listed in the inventory but not committed), `prejs.js` (referenced by comments, not captured), the C++ port sources (`wgpu_backend.cpp`, `httpfs_wasm.cpp`, `userdata_wasm.cpp`, `browser_input_wasm.cpp`, `browser_audio_wasm.cpp`; only referenced in comments), Grand-V v2 (not clonable).

---

## 0. TL;DR

1. playgta5 is a **source-level Emscripten build of a RAGE/GTA V engine** (41,244 `rage::` symbols in `game.wasm`, 63.2 MB, Memory64 + shared memory + pthreads) wrapped in a four-part browser runtime: page (`homepage.html`) -> engine worker (`loader.js` + `game.js`) -> GPU worker (`wgpu_worker.js`, D3D11-command-stream-to-WebGPU translator) and IO worker (`io_worker.js`, HTTP range streamer with an OPFS block store). Everything crosses thread boundaries through **one shared `WebAssembly.Memory`** and `Atomics`; `postMessage` is used only for bootstrap. None of the game content is reusable; the **runtime architecture is**, and it is unusually well documented in code comments with measured numbers.
2. muguet proves the same `game.wasm` runs natively (wasmtime 49 + wgpu 30 on Metal) by re-implementing the ~20 custom imports. Its two transferable contributions are (a) a **concrete iOS budget**: 5 GB heap cap (8 GB with the paid `increased-memory-limit` entitlement), 2,560 MB streaming-pool cap, AOT-compiled code in a read-only `__GAME` Mach-O segment because iOS forbids JIT, `-FrameQueueLimit=2`, BC1 -> ASTC transcoding because Apple GPUs lack BC; and (b) a **small, complete UDP multiplayer design**: star relay on port 47520, 105-byte state snapshots at 30 Hz, adaptive interpolation delay (45 to 300 ms), a 150 ms/4 s reliable layer over UDP, and lowest-id "population owner" election for shared traffic/pedestrians.
3. Hard IP line: `game.wasm`, every file in the data manifest, the WGSL shader packs/index (translations of Rockstar DXBC), `pipelines.json`/`bootset.json` (derived from Rockstar draw/read traces), title art/fonts, the GTA native-function tables in `mp.rs`/`patch.rs`, and the Rockstar function names they hook are **off limits**. muguet's Rust is GPL-3.0; playgta5's JS has no license. **Re-implement patterns; copy nothing.**

---

## 1. What the repos are (provenance, from the repo's own investigation)

* `ENGINE_INVESTIGATION.md`: `game.wasm` is 63,201,802 bytes (code 48.2 MB, data 7.8 MB, `name` section 6.8 MB), 86 imports, 22 exports, retains Rockstar development paths (`E:\P1\GTA5\SRC\DEV_NG\...effect_d3d11.cpp`), a build timestamp string `09:29:05 Oct 5 2026`, and port-specific imports `wasm_httpfs_*`, `wasm_userdata_*`, `wgpu_start_worker`. No producers/DWARF sections; port author unknown.
* `INVESTIGATION.md`: data set = 5,814 files, 20.94 GB (RPF archives 20.30 GB; 1,528 PC-format RPF7 with AES flag). Content is an early DLC set (`mpLTS`, Oct 2014 era) plus a `env_test` level the site labelled "GTA VI map". `headers.txt`: served behind Cloudflare with `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`, `Cross-Origin-Resource-Policy: same-origin`, `cache-control: private, no-cache` on the HTML.
* muguet `README.md`: "runs the same `game.wasm` as a regular native app, with wasmtime for the code and wgpu on Metal"; macOS 14+/Apple Silicon, iOS 15+ "ideally 8 GB of RAM", Xcode 26, Rust 1.98.1 toolchain for iOS; UDP port 47520; "iOS needs the increased memory limit entitlement"; "Story missions are single player only".

---

## 2. playgta5: browser runtime architecture

### 2.1 Hosted file layout (from `snapshot/files.jsonl`, 12,482 URLs)

| Path | Size | Role |
|---|---|---|
| `/` (homepage.html) | 44 KB | page: canvas owner, title screen, progress, input, audio start |
| `/b/<build>/loader.js` | 9 KB | engine worker bootstrap |
| `/b/<build>/game.js` | 124 KB minified | Emscripten glue (runs in engine worker and every pthread worker) |
| `/b/<build>/game.wasm` | 63.2 MB | engine (streaming-compiled) |
| `/b/<build>/wgpu_worker.js` | 191 KB | GPU worker |
| `/b/<build>/io_worker.js` | 40 KB | IO worker |
| `/b/<build>/audio-worklet.js` | 1.5 KB | AudioWorklet processor (not committed) |
| `/b/<build>/shaders/index.json` | 686 KB | 4,919 shader records keyed by FNV-1a-64 hex hash |
| `/b/<build>/shaders/pack<N>.<hash>.bin` x18 | 71.8 MB total, ~4.18 MB each | WGSL + constant tables bundled per effect |
| `/b/<build>/shaders/pipelines.json`, `pipelines_low.json` | 359 KB / 223 KB | pipeline "recipe" seeds |
| `/b/<build>/title/{logo.png,spinner.png,chalet.woff,art/*.webp}` | 41 files | loading-screen art (Rockstar assets) |
| `/data/manifest.json` | 393 KB | `{mount, version, files:[[path,size,mtime]...]}` |
| `/data/bootset.json`, `bootset_low.json` | 193 KB / 190 KB | recorded boot read set `[[path,[[first,last]...]]...]` |
| `/data/batchc/<sha1>.bin` | n/a | static gzip copies of boot batches (host-built) |
| `/data/<path>` | 20.94 GB | raw game files served with `Range` |

Build id `8b0b5899ed` is baked into URLs (`BASE = '/b/8b0b5899ed'`) so build files are cache-forever; data URLs carry `?v=<manifest version>` (`1791169379-5814`) for the same reason. The page itself is `no-cache`.

### 2.2 Worker topology and boot sequence

```
page (homepage.html, main thread)
 ├─ canvas.transferControlToOffscreen() ─► loader.js (dedicated Worker = Emscripten "main runtime thread")
 │                                           ├─ new Worker('wgpu_worker.js?slots=&low=&limits=…')   (created BEFORE game.js runs)
 │                                           ├─ new Worker('io_worker.js'); io.postMessage({init, base:'/data/', bootset})  (prefetch starts at once)
 │                                           └─ importScripts('game.js') after both workers post {loaded:true}
 │                                                 └─ PThread pool: min(160, cores<=2 ? 28 : 36+4*cores) Workers, each importScripts(game.js)
 ├─ BroadcastChannel 'game-progress' / 'game-log' / 'game-crash' / 'game-fps' / 'game-debug' / 'game-io'  (fan-in telemetry, no ports to wire)
 ├─ installInput(memory, block)   ◄── worker.postMessage({input:{memory, block}})   (wasm_input_publish_js)
 └─ AudioWorklet 'game-audio'     ◄── worker.postMessage({audio:{memory, ring, capacity}}) (wasm_audio_publish_js), after first user gesture
```

Key ordering rules written into `loader.js`:
* The GPU worker is created before the engine blocks the loader thread because "Chrome fetches the script of a worker nested in a worker through the parent's event loop"; it idles until `wgpu_start_worker(ring,size,dbg)` posts `{memory, ring, size, dbg, shaderUrl, shotEvery, canvas}` with the OffscreenCanvas transferred.
* `instantiateWasm` is overridden: `WebAssembly.instantiateStreaming` on a cloned response for progress (0 to 20 %), fallback to buffered instantiate; wasm fetch retried up to 8 times with `min(5000, 300*2^n) * (0.5..1.5)` ms backoff on 5xx/429.
* `preRun` restores `/userdata/**` from IndexedDB `gta5-userdata` into the Emscripten MEMFS with an 8 s run-dependency timeout "so a broken IndexedDB cannot keep the game from starting".
* `mainScriptUrlOrBlob` is set so pthread workers load `game.js` and find `game.wasm` next to it.

### 2.3 Message protocol (the only `postMessage` traffic)

| Direction | Message | Purpose |
|---|---|---|
| page -> loader | `{canvas, base, args[], shotEvery, shotRt, noHints, noPack, gpuLimits, keepThreads, cores, noStore, fullConsole, remoteLog, trace, slots, syncPipelines, record, lowMemory}` + transfer `[offscreen]` | one-shot config; engine CLI args assembled on the page |
| loader -> io | `{init:true, base, noStore, record, trace, log, noHints, bootset}` then `{memory, table}` (via `wasm_httpfs_io_start_js`) | manifest load + prefetch, then attach to shared heap |
| loader -> gpu | `{memory, ring, size, dbg, shaderUrl, shotEvery, canvas}` (via `wgpu_start_worker`) | attach to ring + canvas |
| gpu/io -> loader | `{loaded:true}`, `{ready:true}` | gating |
| any engine thread -> io | `{userdata:{path,data,mtime}}`, `{userdataDelete:path}` | save files to IndexedDB |
| loader -> page | `{hud}`, `{input:{memory,block}}`, `{audio:{memory,ring,capacity}}` | hand page the shared-memory views |
| any -> page (BroadcastChannel) | `{pct,label}`, `{dl:bytes}`, `{lines:[]}`, `{choice}`, `{commit,mode}`, `{compiling}`, `{world}`, `{error}`, `{gpuLost}`; `'game-crash' {kind,thread,text,heap,tail}` | progress/telemetry |

All 15 custom wasm imports (from `game.js` `wasmImports`): `wasm_audio_publish_js, wasm_hang_line_js, wasm_has_page_js, wasm_httpfs_io_start_js, wasm_httpfs_manifest_js, wasm_input_publish_js, wasm_module_int_js, wasm_now_ms, wasm_print_line_js, wasm_userdata_delete_js, wasm_userdata_page_js, wasm_userdata_put_js, wgpu_start_worker` plus Emscripten/WASI. `wasm_httpfs_manifest_js` fetches `/data/manifest.json` with a **synchronous XHR** on the engine thread and copies it into a wasm buffer (allowed in workers). `wasm_module_int_js(name, default)` reads `Module[name]` (or `process.env` in Node) as a generic int-config channel.

### 2.4 Shared-memory protocols (the real IPC)

**Memory**: `new WebAssembly.Memory({initial: 3221225472/65536, maximum: 262144n, shared: true, address: "i64"})` = **3 GiB initial, 16 GiB max, Memory64**. All views are rebuilt after every `await` ("another thread may have grown the memory meanwhile"); `mem.buffer` getter costs ~1 % of the GPU worker so refreshes are batched.

**IO request table** (`io_worker.js` header comment; `io.rs` mirrors it with 64-byte slots):
```
header words: [0] doorbell (incremented on every request/hint) [1] slot count [2] hint ring word offset [3] ring entries [4] hints claimed [5] hints consumed
slot i (16 words at 16+16*i): [0] state 0 idle/1 requested/3 taken/2 done  [1] file id  [2..3] offset lo/hi  [4..5] dest addr lo/hi  [6] length  [7] result bytes or -1
hint ring entry (4 words): file id, offset lo, offset hi, length (bit 30 = low-priority look-ahead; 0 = free)
```
Worker loop: `Atomics.waitAsync(HEAP32, bell, seen)` -> scan slots with `compareExchange(1->3)` -> serve -> `Atomics.store(result); store(state=2); notify`. Engine threads block in `Atomics.wait` on their slot word.

**GPU command ring** (`wgpu_worker.js` / `wgpu_backend.h` contract):
```
ring header int32: [0] head (producer, under lock) [1] tail (consumer) [2] state 0 starting/1 running/2 failed [3] executed count [4] validation-error count [5] consumer-sleeping flag
commands from byte 64: [opcode, payloadWords, payload...]; opcode WRAP(1) rewinds to 64
48 opcodes (0..47): CREATE_TEXTURE/BUFFER/SHADER/LAYOUT/STATE/SRV/UAV/QUERY, UPLOAD_*, SET_* (shader, layout, topology, VB/IB, cbuffers, SRVs, samplers, RTs, blend, DS, raster, viewports, scissors, UAVs), DRAW, DISPATCH, CLEAR_*, COPY_*, RESOLVE, GENERATE_MIPS, READBACK, FENCE, PRESENT, SCREENSHOT, LOG
```
FENCE = `onSubmittedWorkDone()` then `Atomics.store/notify` a word the engine waits on. READBACK records the copy immediately and only awaits the `mapAsync`. The consumer publishes `tail` every 512 commands, yields to the macrotask queue through a `MessageChannel` round-trip at most every 2 ms (fences/readbacks are macrotasks; without the yield "a flat 25 fps with the worker half idle"), and sets the sleeping flag so producers only `Atomics.notify` when needed. `case` labels are numeric literals because V8 builds a jump table for constant Smi cases.

**Input block** (`WasmInputBlock`): 256 key bytes (Windows VK codes, 0x80 = down) + int32 `mouseX, mouseY, dX, dY, dZ, buttons, focus, locked, textHead, textTail`, `text[64]` uint16 ring; `+424` `dbgDrawLimit, dbgFrameDraws, winW, winH`; `+440` `startMode`. The page writes with `Atomics.store/add/or/and`; the engine consumes one wheel notch per frame.

**Audio ring**: int32 header at `ring` (`[0]` frames written, `[1]` frames read, `[3]` worklet callbacks, `[4]` peak), interleaved stereo `f32` at `ring+64`, capacity a power of two (`mask = capacity-1`), 48 kHz, `latencyHint:'interactive'`; AudioContext created on first `pointerdown`/`keydown`. muguet's `audio.rs` consumes the identical layout with CoreAudio.

### 2.5 Asset manifest, streaming and caching (`io_worker.js`)

* **Manifest**: `files: [[path, size, mtime]]`, index = position; `?v=<version>` on every data URL; `cache:'no-store'` on fetches because the OPFS store, not the HTTP cache, is the cache ("Chrome would keep every 206 in its HTTP cache next to this store").
* **Why a worker + OPFS**: engine threads previously used sync XHR behind a service worker; responses piled up as ~1.5 GB of renderer memory because blocked wasm threads never GC, plus ~0.9 GB in the service worker. The IO worker streams response chunks straight into an OPFS file and reads from it **directly into the shared heap** (`sh.read(HEAPU8.subarray(dst,...))`, with a temp-buffer fallback if a browser refuses shared views).
* **Store format**: `store.bin` append-only; `journal.bin` = 16-byte header (`magic 0x4a415449`, float64 manifest version) + 16-byte entries `(fileId u32, block u32, offsetLo u32, offsetHi u32)`; journal flushed 2 s after data (`sh.flush()` first, then entries). Version mismatch = empty store. Block size **4 KiB** (first versions used 256 KiB/16 KiB and "made the boot download 25x larger" because the engine mounts ~1,200 archives and reads only ~3 KB TOC each). Sync access handles are exclusive per tab: open retried 40x250 ms; the page broadcasts `'close'` on `pagehide` so a reload can reacquire them. No-OPFS fallback: 256 KiB blocks in a 48 MB LRU `Map`.
* **Demand reads**: a cold read is split into **32-block (128 KiB) slices fetched in parallel** ("one stream moves ~0.15 MB/s after a ~0.6 s round trip; eight in parallel finish in about a second"). Sequential reads (same file, `off === lastEnd`, len >= 64 KiB; or radio streams within 64 KiB) get read-ahead doubling 64 KiB -> 512 KiB max; only the requested blocks are awaited.
* **Hints**: the engine announces queued streaming reads; the worker fetches up to **96 in flight** (48 for low-priority look-ahead), queue cap 2,000, `priority:'low'` so demand reads are not queued behind them ("engine reads waited up to 6.6 s behind 32 prefetch streams" before priorities).
* **Boot set**: recorded with `?record=1` (per-file byte ranges in first-touch order, merged within 4 KiB), replayed on every load: ~580 MB as 1 MiB runs across **32 lanes**, plus small compressible files (`fxc|meta|xml|dat|ymt|txt|csv|gfx|json|sps|cfg`, <= 8 MB) fetched whole, gzip, in batches of <= 4 MB / 300 files over **4 lanes**. Measured host throughput scaled with concurrency: 6 streams 3.4 MB/s, 32: 3.6, 64: 7.1, 128: 14.1 MB/s.
* **Batch endpoint**: `POST /data/batch?gz=1&c=1&v=<ver>` with body `[[path,start,end]...]` -> one concatenated body, `X-Run-Lengths: n1,n2,...` header for clamped ranges; the host also stores each batch as a static file `/data/batchc/<sha1(version:body)>.bin` that is tried first with a plain GET (CDN-cacheable; `DecompressionStream('gzip')` client side). `serve_local.py` shows the server side: `Range` -> 206, batch limit 1,000 runs / 64 MiB, gzip level 1.
* **Robustness**: 8 retries with jittered exponential backoff on 5xx/429 (added 2026-10-06 after "10,000 visitors in a day"); files shorter than the manifest are shrunk in place "instead of failing over and over (the engine retries a failed read forever)".
* **Telemetry**: per-extension and per-size-class byte accounting, 5 s network stats (fetches in flight, demand misses, wait ms, cold vs hinted), `?trace=1` request log for offline analysis.

### 2.6 Shader and pipeline handling (`wgpu_worker.js`)

* Shaders are identified by a 64-bit hash of the original bytecode; `index.json` maps hash -> `{stage, effect, program, ok, p:[pack, offset, wgslBytes, constBytes]}`. Stats: 1,112 vs / 3,667 ps / 31 cs translated; 109 ds/hs/gs programs "have no WebGPU equivalent"; 2 cs failed Tint uniformity analysis (`workgroupBarrier` in non-uniform control flow).
* **Packs**: ~4 MB files grouped by effect so "a browser makes ~20 requests instead of one or two per shader (~6,000 in a session)". A pack is dropped from memory 8 s after last use (~70 MB if all stayed). `?nopack=1` falls back to per-shader files.
* **WGSL reflection** (`parseWgsl`) builds bind-group layouts from the shader text; `packUniforms` merges all constant buffers of a stage into one `struct cbpack_t` at binding 0 with a dynamic offset, copied into a per-frame ring (64 KiB uniform window), with a small per-(program,stage) identity cache to skip re-packing.
* **Pipeline recipes**: key = `[vsHash, psHash, inputLayout, strides, topology, stripFormat, blendWords, dsWords, rasterWords, rtFormats, samples, dsFormat, readOnlyFlags]`. New recipes are saved to IndexedDB `gta-pipelines` every 20 s (max 6,000); on start, local recipes + the server seed (`pipelines.json`, or `pipelines_low.json` for the low-memory profile) are compiled ahead with `createRenderPipelineAsync`, `AHEAD_MAX = clamp(hardwareConcurrency-1, 2, 8)` in flight, <= 3 ms per idle step. Draws whose pipeline is still compiling are **skipped** (white holes); the GPU worker holds the title screen until a frame stops skipping (`{compiling}` -> "Preparing shaders"). Rationale quoted: a 4-core Chromebook needed ~250 pipelines for the first view, 28,000 draws skipped in one second.
* **Device setup**: `requestAdapter({powerPreference:'high-performance'})`; requested features = intersection of `['texture-compression-bc','texture-compression-bc-sliced-3d','depth32float-stencil8','float32-filterable','indirect-first-instance','rg11b10ufloat-renderable','bgra8unorm-storage','depth-clip-control','clip-distances','texture-formats-tier1','dual-source-blending']` with `adapter.features`; limits = every adapter limit (maxed), overridable with `?limits=name:value` to emulate weak devices. `uncapturederror` is counted and deduped by message shape; `device.lost` is surfaced to the page.
* **Present**: engine render target blitted to the canvas with a fullscreen triangle; `canvasCtx.configure()` only on first present or size change ("it ran every frame"); `alphaMode:'opaque'`. Per-10 s log: fps, draws/frame, submits/frame by reason, skipped draws, pipelines compiled (ms), worker busy %, stutter breakdown (idle/pipeline/modules/uploads/gpu-wait/submit) for frames > 40 ms.
* Objects live in a dense array indexed by never-reused ids (`IdTable`) because "a draw looks up ~15 objects, and an element load is several times cheaper than Map.get".

### 2.7 Input, audio, save handling

* **Input** (page thread, no worker hop): `keydown`/`keyup` -> VK byte; printable keys into a 64-entry uint16 text ring; `pointerlock` with `unadjustedMovement:true`; relative deltas when locked, absolute scaled to back-buffer when not; wheel normalized to notches by `deltaMode` (100 px/notch, 3 lines/notch); `blur` releases all keys; F5/F11/F12/devtools shortcuts pass through; numpad flight aliases (I/K/J/L/U/O). Back buffer = window in device pixels, even numbers, capped 3840x2160 (2560x1440 low-memory), resize debounced 150 ms, written at `+432/+436`.
* **Audio**: AudioWorklet pulls from the shared ring; ring state logged every 5 s with `?mem=1`.
* **Saves**: engine writes `/userdata/Documents/...` to MEMFS; `userdata_wasm.cpp` posts settled files to the IO worker which puts `{data, mtime}` into IndexedDB `gta5-userdata` (store `files`, key = path). Chosen over OPFS because OPFS handles are single-tab and keyed to the data version. A failed save is logged "whatever ?log=1 says: a lost save is worth a line".
* **Start-mode handshake**: the page writes `startMode` (1 story / 2 sandbox / 3 sandbox-env_test) into the input block; the engine reads it ~62 % into the load and posts `{choice}` if nothing is chosen (page pulses key caps), `{commit, mode}` when taken.

### 2.8 Memory and thread profile (desktop vs low-memory)

* Threads: pool formula above (cores <= 2 -> 28 workers; 8 cores -> 68; capped 160). Each engine Web Worker costs "~20 MB", so the low-memory profile fakes `hardwareConcurrency = 2` (54 threads instead of 80 to 116).
* Low-memory profile trigger: `?low=1` or `navigator.deviceMemory <= 4` (Chromium only; Safari lacks the API). Engine args: `-textureQuality=0 -pedVariety=0 -vehicleVariety=0 -shadowQuality=-1 -reflectionQuality=0 -particleQuality=0 -grassQuality=0 -cityDensity=0 -lodScale=0 -pedLodBias=0 -vehicleLodBias=0`; measured in Node: GPU memory 1.16 GB -> 0.5 GB, streamed assets 1.38 GB -> 0.95 GB; shadows off removed a third of draws (600 to 900 of 1,300 to 2,900 per frame).
* World needs ~1.2 to 1.4 GB of data after scripts start (`WORLD_BYTES = 1.2e9` drives the 72 to 98 % progress band).
* Windows timer trick: `setInterval(() => {}, 1)` on the page keeps Chrome's process on a fine timer tick so `Atomics.wait` with timeout is not rounded to 15.6 ms (limiter held "60 fps cap to 37 fps").
* Stall watchdog: 30 s without any progress message -> "the device may be out of memory"; crash reports include `deviceMemory`, `hardwareConcurrency`, wasm heap MB and the last log lines.

---

## 3. muguet: native host for the same wasm, and UDP multiplayer

### 3.1 Runtime (`main.rs`)

* wasmtime `49` (`features = ["runtime","threads","profiling","anyhow"]`), `Config`: `wasm_memory64`, `wasm_threads`, `shared_memory`, `wasm_bulk_memory`, `wasm_multi_memory`, `cranelift_opt_level(Speed)`, heap/table Spectre mitigations disabled; macOS: `memory_reservation(17 GiB)`, `memory_guard_size(2 GiB)`; iOS: reservation = `IOS_HEAP_MAX` (default 5 GB, `MUGUET_IOS_HEAP_GB`), guard 64 KiB; `memory_may_move(false)`.
* The imported `env.memory` is rebuilt as a `SharedMemory` with the maximum clamped to the iOS cap (`heap_type`). `emscripten_get_heap_max` answers 16 GiB; `emscripten_resize_heap` grows with 20 % over-allocation, halving the overshoot on failure.
* Threads: `__pthread_create_js` -> real OS thread, 16 MiB stack, name from the pthread struct (`arg+24`), QoS `USER_INTERACTIVE` for `RenderThread`/mixer, `USER_INITIATED` otherwise; the engine main thread gets a 64 MiB stack, the GPU thread 32 MiB. Each thread instantiates its own `Instance` over the shared memory and runs `_emscripten_thread_init` / `_emscripten_tls_init` before the start routine. Emscripten's thread mailbox is emulated (`PENDING_MAILBOX`, checked on every host call).
* `invoke_*` trampolines implement setjmp/longjmp via a thread-local flag and `_emscripten_stack_restore` + `setThrew`.
* Code cache: macOS compiles once to `game-<len>-<mtime>-<hookKey>.cwasm` (`Module::serialize`). `--precompile-ios` targets `aarch64-apple-ios` with `has_lse`, after `wasm-opt -O3 --enable-memory64 --enable-threads --enable-bulk-memory ... --enable-multimemory`.

### 3.2 Host import surface (`host.rs`)

Implements the same contract as `game.js`: `wasm_httpfs_manifest_js` -> `fs::httpfs_manifest`, `wasm_httpfs_io_start_js` -> `io::start`, `wgpu_start_worker` -> `gpu::start`, `wasm_input_publish_js`, `wasm_audio_publish_js`; `wasm_userdata_page_js` returns 0 so the engine writes saves through ordinary POSIX syscalls which `fs.rs` maps onto `~/Library/Application Support/Muguet/saves` (iOS: `Documents/`). `EM_ASM` blocks are matched by numeric id (`7980558` locale -> "en-US", `7980673` open URL, `7980768` reload). Unknown imports are stubbed and logged three times.

### 3.3 Binary patching for hooks (`patch.rs`)

`wasmparser` + `wasm-encoder` re-encode `game.wasm` once: resolve target functions by **name section** (`GtaThread::Update(int)`, `CExplosionManager::AddExplosion(...)`, `CTextFile::GetInternal`, `rage::sysMemGrowBuddyAllocator::GrowHeap()`, `opus_decode_frame`, ...), append new imports (`env.muguet_script`, `muguet_pool`, `muguet_opus_frame`, ...) and prepend `local.get`/`call` sequences at the start of the target bodies; export ~190 script natives as `mp:<Name>` and `emscripten_builtin_malloc` as `muguet:malloc`; also patches two constants (`PerformCollisionChecksForScenarioPoint` 6->5, `CMovieMgr::PreloadMovie` returns 0). `is_patched` checks for the first hook import. `VERSION = 11` is hashed into the cache file name. The *technique* (name-section-driven wasm instrumentation) is general; the *targets* are Rockstar symbols.

### 3.4 Native IO loop (`io.rs`) and file system (`fs.rs`)

`serve_loop` polls the same table layout as the web worker (`table+4*word`, slots at `table+64+64*i`, state `compareExchange(1->3)`, result at `+28`, `atomic_notify`), reading with `read_exact_at` **directly into the shared heap** from up to 1,024 open file handles, `atomic_wait32` with 20 ms timeout on the doorbell. `fs.rs` is a minimal POSIX layer (`__syscall_openat/stat64/...`) writing Emscripten wasm64 struct layouts (`stat` 112 bytes, `statfs` 120 bytes with 8-byte fields). `import.rs` extracts only `data/` and `b/<build>/shaders` (and `game.wasm` on macOS) from the user's zip, skipping `env_test`/`verityradio`, into a staging dir before renaming.

### 3.5 GPU (`gpu.rs`)

wgpu `30.0.1`, `Backends::METAL`; same feature wish-list as the browser plus `TEXTURE_COMPRESSION_ASTC` and `TEXTURE_ADAPTER_SPECIFIC_FORMAT_FEATURES`. If BC is unsupported (iPhone/iPad) or `MUGUET_SOFT_BC`: **BC1 -> ASTC 4x4 transcoded on the GPU** by a compute shader (`bc1_astc.wgsl`, batched 1,024 jobs / 32 MB / 4,096 per submit); BC2 to BC7 **decoded on the CPU** with `bcdec_rs` to RGBA8 (credit: "decoding bc textures on all cores"); `expanded` memory accounting shows the cost. `FRAME_SLOTS = 3`, `RING_CHUNK = 8 MiB`, `UBO_WINDOW = 64 KiB`, `PIPELINE_WAIT = 8 ms` (native compiles are synchronous-ish), `BG_LIMIT = 24,000` cached bind groups, occlusion query capacity 2,048. `SUSPENDED`/`OCCLUDED` flags pause presenting when the app is backgrounded; `max_msaa()` clamps the settings file.

### 3.6 iOS constraints and how muguet meets them (useful for the iPhone PWA budget)

| Constraint | muguet's answer | Evidence |
|---|---|---|
| No JIT for third-party apps | AOT with `wasmtime --precompile-ios`; `.cwasm` bytes placed by `global_asm!` `.incbin` into a `__GAME,__code` section, linker `-Wl,-segprot,__GAME,rx,rx`; `CustomCodeMemory` with no-op `publish_executable` because the code is signed as part of the binary; `Module::deserialize_raw` points at it | `main.rs`, `build.rs` |
| Per-process memory limit | `com.apple.developer.kernel.increased-memory-limit` (+ `extended-virtual-addressing` for paid accounts); heap cap 8 GB paid / 5 GB free or sideloaded (`make-ios.sh`); launcher reads `os_proc_available_memory() + phys_footprint` and warns when the entitlement is missing ("the game will likely close after a few minutes") | `ios/*.entitlements`, `ios/Launcher.swift` |
| Streaming pool growth | `muguet_pool` hook caps `rage::sysMemGrowBuddyAllocator` at **2,560 MB** on iOS (`MUGUET_POOL_CAP_MB`) | `host.rs pool_grow` |
| GPU latency / memory | `-FrameQueueLimit=2` injected on iOS; back buffer scale 0.5 default, cap 2560x1440, width forced >= 1.5 x height; `CADisplayLink` held at 60 or 120 Hz; MSAA/TXAA toggles rewrite `settings.xml` | `config.rs`, `app.rs`, `Launcher.swift` |
| No BC textures on Apple GPUs | ASTC transcode / CPU decode (3.5) | `gpu.rs` |
| Touch input | overlay with per-vehicle-mode button sets (9 modes: foot, car, heli, plane, sub, bike...), virtual stick radius 58 pt / knob 26 pt, sprint beyond 1.35 x radius, look gain 3.0, steering wheel dead-zone 10 deg / full 45 deg, min hold 120 ms; `GCController` extended gamepad, `GCKeyboard`, `GCMouse` | `touch.rs`, `pad.rs`, `Info.plist` |
| Telemetry | `footprint_mb` (proc_pid_rusage), resident heap via `mincore`, compressed memory via `task_info`, malloc zone stats, Metal `currentAllocatedSize` | `main.rs` |
| Open-file limit | `setrlimit(RLIMIT_NOFILE, 10240)` | `main.rs` |

### 3.7 UDP multiplayer (`proto.rs`, `server.rs`, `mp.rs`)

**Topology**: star relay. `muguet-server` (or the hosting player with `MUGUET_HOST=1`, in-process thread) binds `0.0.0.0:47520`; clients `bind 0.0.0.0:0; connect(server)`. **No NAT traversal, no STUN/hole punching, no lobby service**: clients must reach the server's IP (LAN, or a port-forwarded/VPS host). Because every client initiates outbound UDP, client-side NAT works; the server side must be reachable. `NSLocalNetworkUsageDescription` is set for iOS local-network permission.

**Packet**: `[0x47 magic][kind u8][payload]`, max 1,500-byte receive buffer; the server prefixes the sender id (u8, 1..255) to relayed payloads. Kinds: `HELLO 1, WELCOME 2, STATE 3, NAME 4, LEAVE 5, BYE 6, FULL 7, LOOK 8, SHOT 9, POP 10, KILL 11, VLOOK 12, TAKEN 13, EXPLODE 14, HIT 15, VHIT 16, TIME 17, POPX 18, REL 19, ACK 20, KILLFEED 21, VCTL 22`. `relayed(kind)` = everything except session kinds.

**Session**: `HELLO <name>` every 1 s until `WELCOME <id>`, then every 2 s as keepalive; server times out after 5 s (sweep every 2 s), rebroadcasts `NAME` for all players every 2 s, `FULL` when > max (clamped 2..32, default 8), `LEAVE 0` to an unknown sender (forces re-HELLO), `BYE` on quit.

**State snapshot** (`State::encode`, **105 bytes** fixed): `ped_model u32, pos f32x3, heading f32, vel f32x3, flags u8 (IN_VEHICLE|DEAD|AIMING|INSIDE|RAGDOLL|ENTERING), veh_model u32, veh_pos f32x3, veh_rot f32x3, veh_vel f32x3, weapon u32, health u16, armour u8, veh_owner u8, seat i8, veh_colours u8x2, veh_engine/body/tank i16x3, veh_tyres u8, veh_windows u8, veh_dead u8, aim f32x3`, followed by a u32 sender-clock ms. Sent every **33 ms (30 Hz)**; all floats validated finite on decode. Appearance: `LOOK` (12 component triples + 5 props = 63 bytes) every 1 s and on change; `VLOOK` (69 bytes: colours, livery, tint, wheels, 50 mod slots, toggles, plate, radio) every 1 s / resend after 4 s; `VCTL` 4 bytes (lights/siren etc.) every 1 s.

**Reliable layer**: `REL` = `seq u16 + kind + payload`; receiver answers `ACK [from, seqLo, seqHi]` and dedupes with a 256-entry per-peer window; sender keeps `Pending{seq, packet, waiting:[ids], first, last}`, resends every **150 ms for at most 4 s**, dropping peers that left. Used for `EXPLODE`, `HIT`, `VHIT`, `TAKEN`, `KILLFEED`.

**Clock sync and interpolation** (`Clock`, `sample`): per peer, `gap = localMs - sentMs` over the last 90 packets; offset = min gap; jitter = p90 of (gap - offset); target delay = `clamp(p90 + 33 + 12, 45, 300)` ms, adopted immediately when larger, decayed 2 % per packet when smaller; initial 80 ms. Snapshots buffered (20); render time = `now - delay`; linear interpolation of positions/velocities, shortest-arc `lerp_angle` for heading/rotation; no interpolation across vehicle enter/exit or model change; **extrapolation** with velocity for at most 250 ms past the newest snapshot. Remote avatars are driven by `TaskGoStraightToCoord` toward `pos + vel` with a blend ratio by speed (1/2/3) and a position correction with gain 0.05 / 0.12 / 0.4 when the error exceeds 0.3 / 0.8 / 2.0 m.

**Shared population ("traffic and pedestrians")**: `POP` every 100 ms, up to 26 entries x 54 bytes per packet, split into <= 3 parts; entries = `{key u32, is_vehicle, model, driver_model, pos, rot, vel, dead, engine i16, body i16}`. Owner election: the **lowest player id** among peers within `SHARE_NEAR 150 m` (`SHARE_FAR 220 m` hysteresis for the current owner) who is outdoors; the local player defers if any such peer has a lower id, clearing own vehicles/peds in 220 m and mirroring the owner's entries; the owner also sends `POPX` extras. Weather is one of 14 named states; `TIME` syncs the clock.

**Host election inside the client**: the hook `muguet_script` is called from every script thread's `GtaThread::Update`; the tick runs on the highest-ranked live script (`main_persistent > standard_global_reg > main > sandbox > freemode`), with a 2 s takeover if the current host thread stops ticking.

**Join UX**: after 100 ticks the newcomer is teleported next to the lowest-id peer (`+2.5, +2.5, +0.5`) and frozen 3 s while streaming catches up.

Bandwidth estimate (derived): one player sends ~116 bytes x 30 Hz ~= 3.5 KB/s of STATE plus ~14 KB/s of POP when owner; the relay fans out N-1 copies.

---

## 4. Pattern cards (reusable in an original Three.js/WebGPU engine)

**P1. Three-process worker split: engine worker, GPU worker, IO worker, page as thin shell**
Where: `homepage.html` (page), `loader.js`, `wgpu_worker.js` header, `io_worker.js` header.
What: the page only owns the canvas (`transferControlToOffscreen`), DOM UI, input and the AudioContext; simulation runs in a worker that may block; all WebGPU objects live in one worker with its own event loop; all network/disk IO lives in another worker with its own event loop. Workers are created before the engine blocks because nested-worker script fetches go through the parent's event loop.
Apply: our Three.js sim thread (physics, AI, streaming decisions) runs in a worker; the renderer (Three.js `WebGPURenderer` on an OffscreenCanvas) runs in a render worker; an asset worker owns fetch + OPFS; the main thread handles DOM/PWA/XR session setup. On iOS Safari keep the fallback of rendering on the main thread (WebGPU in workers must be feature-tested).
Caveats: WebXR sessions need the canvas/XR layer on the thread that created the session; verify OffscreenCanvas + WebGPU + XR on Safari visionOS 26.2 and Quest Browser before committing to a render worker in XR mode.

**P2. One shared WebAssembly.Memory as the IPC bus; postMessage only for bootstrap**
Where: `game.js` `initMemory`, `io_worker.js` protocol, `wgpu_worker.js` ring, `homepage.html` `installInput`.
What: fixed-layout int32 tables in shared memory; producers increment a doorbell and `Atomics.notify`; consumers `Atomics.waitAsync` (workers with event loops) or `Atomics.wait` (blocked threads); results written with `Atomics.store` + `notify`. Views are refreshed after every `await` because memory may grow.
Apply: even without a C++ engine, allocate one `SharedArrayBuffer` (or `WebAssembly.Memory({shared:true})`) for input state, audio ring, render command/transform buffers and streaming requests; use typed-array views with the same slot discipline. Requires `crossOriginIsolated`.
Caveats: Safari supports SAB from 15.2 and `Atomics.waitAsync` from 16.4 (verified below); keep a `postMessage` fallback for non-isolated contexts (e.g., when served from a domain that cannot set COEP).

**P3. OPFS append-only block store with a journal, keyed to the manifest version**
Where: `io_worker.js` `openStore`, `indexRun`, `writeJournal`, `readFromStore`.
What: `store.bin` grows by whole 4 KiB blocks; `journal.bin` records `(fileId, block, offset)` after data is flushed; a version mismatch starts empty; exclusive sync handles are released on `pagehide` via BroadcastChannel; memory LRU fallback when OPFS is unavailable.
Apply: our world is chunked (tiles, LOD meshes, KTX2 textures, audio banks). Store every fetched chunk in one OPFS file through `createSyncAccessHandle` in the asset worker; index by `(assetId, block)`; read straight into shared memory for the render worker. Version the journal with the content manifest hash so a deploy invalidates cleanly.
Caveats: `createSyncAccessHandle` is dedicated-worker-only (MDN) and exclusive per tab; iOS storage quotas are opaque and Safari may evict OPFS after 7 days of non-use (ITP rule; UNVERIFIED for OPFS specifically); keep the 48 MB in-memory fallback.

**P4. Content manifest + immutable URLs + recorded boot set**
Where: `data-manifest.json`, `io_worker.js` `prefetch`, `recordTouch/dumpRecording`, `homepage.html` `BASE`.
What: `[[path,size,mtime]]` manifest with a version string on every data URL (`?v=`), build id in code URLs (`/b/<id>/`), `cache:'no-store'` client side so only the CDN and OPFS cache; a `?record=1` run logs the first-touch read set which is then prefetched on every start with high concurrency.
Apply: generate `manifest.json` at build; serve world data from R2 behind a custom domain with Cache Everything; put the build hash in asset paths (Workers static assets, 25 MiB per file limit, so anything larger goes to R2); record a "boot set" for each spawn point/game mode and prefetch it from the main menu.
Caveats: Cloudflare caches whole objects up to 512 MB (Free/Pro/Business); split world files so each is < 512 MB and ideally a few MB; Cloudflare aligns origin range fetches to 1 MiB.

**P5. Batched small-file fetch with a static CDN-cacheable fallback**
Where: `io_worker.js` `batchFetch`, `serve_local.py` `do_POST`.
What: thousands of small files cost one round trip each; a `POST /batch` returns one concatenated gzip body with `X-Run-Lengths`; because the boot batches are identical for everyone they are also pre-built as `batchc/<sha1(version:request)>.bin` and fetched with GET first.
Apply: pack small JSON/metadata/shader/audio files per world tile into one `.pack` at build time (no runtime POST needed on Cloudflare); if a dynamic batch endpoint is ever needed, implement it as a Worker that returns `200` full bodies so Workers Caching can slice ranges.
Caveats: Workers Caching does not store `206` responses generated by a Worker; return full `200` bodies.

**P6. Concurrency-based throughput: lanes, slices, priorities**
Where: `io_worker.js` constants `RUN_LANES 32, BATCH_LANES 4, SLICE_BLOCKS 32, HINT_PAR 96, LOW_PAR 48`, `fetchRangeRaw priority`.
What: per-stream throughput is latency-bound; demand reads are split into 128 KiB parallel slices, speculative reads stay whole and run at `priority:'low'`, hints (reads the engine will do soon) are fetched up to 96 at a time.
Apply: our streamer should expose "will need soon" hints (camera frustum/velocity prediction) as a low-priority queue distinct from "blocking now" reads; use `fetch(..., {priority:'high'|'low'})` (Safari 17.2+).
Caveats: HTTP/3 and Cloudflare change the per-stream curve; re-measure. Keep an in-flight map so a demand read joins an existing speculative fetch.

**P7. Retry with jittered exponential backoff on 5xx/429 at every fetch site**
Where: `loader.js` `fetchWasm`, `io_worker.js` `fetchRetry`, `wgpu_worker.js` `fetchRetry`.
What: 8 attempts, `min(5000, 300 * 2^n) * (0.5 + random)`, retry only before the body is consumed; added after a traffic spike produced 503s that bricked sessions.
Apply: one shared `fetchRetry` helper in the asset worker; never let a transient CDN error poison a cache entry (the shader-pack case: "a pack that came back as an error left every draw that needs it unshaded for good").

**P8. GPU command ring with cooperative yielding and sleep flag**
Where: `wgpu_worker.js` `runCommands`, `loop`, `yieldTask`.
What: a lock-free ring of `[opcode, n, payload]`; consumer publishes `tail` every 512 commands, yields through `MessageChannel` at most every 2 ms so `onSubmittedWorkDone`/`mapAsync` macrotasks run; sets a "sleeping" word so producers only notify when the consumer waits; numeric `case` labels for V8 jump tables.
Apply: for a Three.js render worker the "commands" are per-frame transform/visibility updates from the sim worker: write them into a double/triple-buffered shared array with a frame counter and `Atomics.notify`, and keep the render loop on `requestAnimationFrame` of the OffscreenCanvas. The yield discipline matters whenever a worker loop awaits only resolved promises.
Caveats: Three.js owns its own WebGPU objects; do not try to mirror a D3D-style opcode set.

**P9. Pipeline recipe cache: IndexedDB per browser + shipped seed, compile-ahead while loading**
Where: `wgpu_worker.js` `pipelineRecipe`, `recipeKey`, `loadRecipes`, `saveRecipes`, `aheadStep`.
What: every render pipeline is keyed by a content recipe; recipes are persisted locally (max 6,000, every 20 s) and shipped as a seed captured in a headless run; while loading, seed recipes whose shaders are present are compiled with `createRenderPipelineAsync`, a bounded number in flight, in <= 3 ms slices; draws that would need a compiling pipeline are skipped and the world is only revealed once no draws are skipped.
Apply: with Three.js, pre-compile materials with `renderer.compileAsync(scene, camera)` for the spawn area during the loading screen; persist the set of `(material variant, geometry layout)` keys seen in IndexedDB and ship a seed per game mode; gate the loading screen on "no new pipelines compiled in the last N frames". Separate `pipelines_low.json` for the low-memory profile (fewer shadow variants).
Caveats: Chrome keeps a Dawn disk cache keyed by the GPU process; it helps second visits, not first.

**P10. Shader packs grouped by use, dropped on an idle timer**
Where: `wgpu_worker.js` `packBytes`, `packShader`, `_packs` in `index.json`.
What: ~4 MB packs grouped by effect; an index maps hash -> `[pack, offset, len, constLen]`; packs are released 8 s after last use.
Apply: build-time bundles of WGSL/TSL node material definitions, animation clips and small meshes grouped by world region; an index of offsets so the asset worker can serve sub-ranges from one OPFS block run.

**P11. Low-memory profile keyed by device signals**
Where: `homepage.html` low-memory block, `LOW_ARGS`, `wantSize`.
What: `deviceMemory <= 4` (or a query flag) halves thread count, quarters texture memory, disables shadows/particles/reflections, caps back buffer at 2560x1440, and loads a separate pipeline seed; the HUD tells the user to close tabs.
Apply: define three profiles (desktop, mobile, mobile-low) selected from `navigator.deviceMemory` (absent on Safari -> assume mobile-low on iOS), `hardwareConcurrency`, adapter limits (`maxTextureDimension2D`, `maxBufferSize`) and a stored user override; render at `devicePixelRatio * scale` with an even-size cap; persist the choice.
Caveats: Safari never reports `deviceMemory`; use UA/`maxTouchPoints` + adapter info and a first-run benchmark.

**P12. Progress and health telemetry over BroadcastChannel**
Where: `homepage.html` progress block, `'game-crash'`, stall watchdog, `wgpu_worker.js` 10 s fps/stutter log, `io_worker.js` 5 s net stats.
What: workers broadcast `{pct,label}`, bytes downloaded, last log line, crash reports (kind, thread, heap MB, last lines), GPU-lost; the page shows a creeping progress bar (<= 6 points past the last report), data MB and MB/s, a 30 s stall watchdog with an OOM hint; a `=` key toggles FPS; `?log=1` ships logs to a dev server (off by default after 10k visitors/day produced 5,500 crash posts).
Apply: same channel set; send sampled telemetry to a Cloudflare Worker -> Analytics Engine/D1 at low volume; include `measureUserAgentSpecificMemory()` samples on Chromium when `crossOriginIsolated`.

**P13. User-gesture-gated AudioWorklet reading a shared ring**
Where: `homepage.html` `tryStartAudio`, `audio.rs`.
What: the mixer writes interleaved f32 stereo into a power-of-two ring in shared memory; the AudioWorklet (or CoreAudio) reads with atomics; context created on first gesture; `latencyHint:'interactive'`, 48 kHz.
Apply: if we mix in a worker (e.g., WASM audio engine or custom spatial mixer), use this ring; otherwise Three.js `PositionalAudio` on the main thread is simpler. Always resume on `pointerdown`/`keydown`, and on `visibilitychange` for iOS.

**P14. Save data in IndexedDB keyed by path, restored before boot with a timeout**
Where: `loader.js` `preRun`, `io_worker.js` `userdataWrite`.
Apply: keep saves/settings in IndexedDB (multi-tab safe, survives data-version bumps), restore at startup with a bounded wait, and mirror to Supabase/Convex when signed in. Never put saves in the OPFS asset store.

**P15. Native/headless host for the same core (muguet, Node mode of `wgpu_worker.js`)**
Where: `wgpu_worker.js` `isNode` branches (Dawn via `webgpu` npm package, `WGPU_SHOT_EVERY` screenshots, `WGPU_RECORD_PIPELINES`), muguet as a whole.
What: the GPU worker runs under Node with Dawn for deterministic screenshots, pipeline-seed recording and weak-device emulation (`WGPU_LIMITS`).
Apply: run our render worker under Node + Dawn (or Playwright headless) in CI to capture pipeline seeds, boot sets and golden screenshots per game mode; keep the engine core free of DOM assumptions so a native XR or desktop wrapper remains possible.

**P16. UDP-style multiplayer design transposed to WebSocket/WebRTC**
Where: `proto.rs`, `server.rs`, `mp.rs` `Clock`, `sample`, `send_reliable`, `population`.
What: tiny fixed-layout binary snapshots at 30 Hz; dumb relay that prefixes sender ids; keepalive/timeout; optional reliability as a thin seq/ack layer; per-peer clock offset + adaptive delay; interpolate/extrapolate; vehicle-change discontinuities handled by snapping; lowest-id area ownership for shared NPC traffic with distance hysteresis and interior exclusion.
Apply: browsers cannot do raw UDP; map `STATE/POP/LOOK` to an unreliable WebRTC DataChannel (or WebTransport datagrams on Chromium) and `REL` kinds to a reliable channel or the WebSocket; the relay becomes a Cloudflare Durable Object per area/instance (or Supabase Realtime broadcast / Convex for low-rate reliable events). Keep the 105-byte-class snapshot discipline and the clock/interp code as-is in TypeScript.
Caveats: muguet is GPL-3.0; re-implement from the description, do not port the Rust.

**P17. wasm binary instrumentation by name section**
Where: `patch.rs`.
What: locate functions by their symbol names in the `name` custom section and prepend host calls or export them, without recompiling.
Apply: only relevant if we ship a WASM core (e.g., Rapier/Jolt physics or a C++ sim): keep the name section in debug builds so tooling can inject tracing/replay hooks without a rebuild.

**P18. iOS memory budget playbook**
Where: muguet `main.rs` (`IOS_HEAP_MAX`, pool cap), `make-ios.sh` (5 vs 8 GB), `Launcher.swift` (entitlement check), `config.rs` (`-FrameQueueLimit=2`, scale 0.5), `app.rs` (back-buffer cap).
Apply (PWA, no entitlements): assume **far less** than muguet's native 5 GB; see Risks. Budget: wasm/JS heap < 1 GB, GPU textures < 600 MB (ASTC/ETC2 via KTX2), 2 frames in flight, render scale 0.5 to 0.75 of device pixels, aggressive LOD, and an in-page OOM watchdog (P12) because iOS reloads the tab silently.

---

## 5. What must NOT be reused (IP line)

Do not copy, mirror, derive from, or reference at runtime:

1. `game.wasm` and anything derived from it: RAGE/GTA engine code, its `name` section symbols, `snapshot/engine-evidence.json` symbol lists, the `mp.rs` `COMMANDS` native table, `patch.rs` hook targets (`GtaThread::Update`, `CExplosionManager::AddExplosion`, ...), script-native argument conventions, control ids (`VEH_ACCELERATE = 71`...), weapon/animation/model names, `joaat` hash usage for Rockstar identifiers, `settings.xml` tags, `WasmInputBlock`/engine command-line flags (`-fastscriptcore`, `-wasmstartchoice`, `-FrameQueueLimit`).
2. Everything in `data-manifest.json` / `mirror/`: RPF archives, `.fxc` DXBC shaders, `.ymt/.meta/.xml` data, `.ytd/.ydd`, audio, `env_test`, `common/non_final`, `RadioLog.csv`; `snapshot/manifest-sha256.json`, `files.jsonl`, `download-plan.json` (inventories of that data).
3. Translated shaders: `shader-index.json`, `pack*.bin`, loose `.wgsl`, `.consts.json` (derivative works of Rockstar HLSL/DXBC), and `pipelines.json`/`pipelines_low.json` (derived from the game's draw state), `bootset*.json` (traces of Rockstar data reads).
4. Title/loading-screen material: `title/art/*.webp`, `logo.png`, `spinner.png`, `chalet.woff` (Chalet London 1960 font), and the `LOADINGSCREEN_STARTUP` choreography constants ported from Rockstar's ActionScript in `homepage.html` (the `SCREENS`/`ORDERS` tables, 55-degree Scaleform camera, 14 s/42 s timings).
5. Rockstar trademarks and names in UI (`GTA V Map`, `GTA VI Map`, `Story Mode` as Rockstar presents it, `Rockstar Games` paths).
6. muguet source code: GPL-3.0; copying any Rust/WGSL into a non-GPL repo is a license violation. The `bc1_astc.wgsl` transcoder and `minimap_alpha.wgsl` are GPL too.
7. playgta5 JavaScript: no license; scraped from a site run by an unidentified operator who may not own it; the comments reference a private `phase3/` toolchain and D:\ paths. Treat as read-only reference. Our implementation must be written fresh from the pattern cards above, not adapted line by line.
8. The DXGI -> WebGPU format table and the D3D11 state-object semantics are generic Microsoft/W3C enums and may be re-derived from public documentation, but there is no reason to carry D3D11 semantics into a Three.js engine.
9. Example-repo hostnames, build ids (`8b0b5899ed`), manifest versions, Telegram/Discord links, and the `playgta5.com` origin must not appear in our code, docs or prompts.

---

## 6. Verified facts

| fact | source URL | date checked | confidence |
|---|---|---|---|
| playgta5 `game.wasm` is 63,201,802 bytes, 86 imports, 22 exports, 41,244 `rage::` symbols, no producers/DWARF sections | local `ENGINE_INVESTIGATION.md`, `snapshot/engine-evidence.json` (repo https://github.com/shadany7824/playgta5) | 2026-10-18 | high |
| Data set: 5,814 files, 20.94 GB, 1,528 RPF = 20.30 GB; manifest version `1791169379-5814`, mount `/game/` | local `data-manifest.json` (computed) | 2026-10-18 | high |
| Shader index: 4,919 entries (1,112 vs / 3,667 ps / 31 cs; 109 ds/hs/gs untranslatable), 18 packs totalling 71,761,794 bytes | local `shader-index.json`, `snapshot/files.jsonl` (computed) | 2026-10-18 | high |
| `WebAssembly.Memory({initial: 3 GiB, maximum: 262144 pages (16 GiB), shared: true, address: "i64"})`; pthread pool `min(160, cores<=2 ? 28 : 36+4*cores)` | local `game.js` (grep) | 2026-10-18 | high |
| Site served with COOP `same-origin`, COEP `require-corp`, CORP `same-origin`, via Cloudflare | local `headers.txt` | 2026-10-18 | high |
| IO protocol constants: block 4 KiB, 32 run lanes, 4 batch lanes, 96 hint fetches in flight, 48 MB memory fallback, 8 retries | local `io_worker.js` | 2026-10-18 | high |
| GPU worker: 48 opcodes, ring data offset 64, yields every 512 commands / 2 ms, recipes max 6,000 saved every 20 s, compile-ahead up to 8 | local `wgpu_worker.js` | 2026-10-18 | high |
| muguet: wasmtime 49, wgpu 30.0.1, winit 0.30.13, cpal 0.18.2, bcdec_rs 0.2, GPL-3.0 | local `Cargo.toml`, `LICENSE` | 2026-10-18 | high |
| muguet GitHub: "A native Mach-O port for iOS/macOS of GTA V, with multiplayer", GPL-3.0, 646 stars, UDP 47520, iOS 15+, needs increased-memory-limit entitlement | https://github.com/c22dev/muguet | 2026-10-18 | high |
| muguet iOS heap cap default 5 GB (8 GB with paid entitlements in `make-ios.sh`), streaming pool cap 2,560 MB, AOT code in `__GAME` segment with `-segprot rx` | local `src/main.rs`, `src/host.rs`, `build.rs`, `make-ios.sh` | 2026-10-18 | high |
| muguet multiplayer: STATE every 33 ms, POP every 100 ms (<= 26 entries x 54 B, 3 parts), LOOK every 1 s, REL resend 150 ms for 4 s, interp delay clamp 45 to 300 ms, timeout 5 s, max players clamp 2..32 (default 8), SHARE_NEAR/FAR 150/220 m | local `src/mp.rs`, `src/proto.rs`, `src/server.rs` | 2026-10-18 | high |
| wasmtime 49.0.0 released 2026-09-21; 49.0.3 released 2026-10-14 (security fixes); requires Rust 1.96 | https://github.com/bytecodealliance/wasmtime/releases | 2026-10-18 | high |
| wgpu 30.0.0 released 2026-07-01, 30.0.1 on 2026-08-22 | https://github.com/gfx-rs/wgpu/releases ; https://docs.rs/crate/wgpu/latest | 2026-10-18 | high |
| WebGPU ships in Safari 26.0 for macOS, iOS, iPadOS, visionOS (post dated 2025-09-15) | https://webkit.org/blog/17333/webkit-features-in-safari-26-0/ | 2026-10-18 | high |
| Safari 26.2 (2025-12-12): WebXR on visionOS supports WebGPU; `WebAssembly.Memory.prototype.toResizableBuffer()` added | https://webkit.org/blog/17640/webkit-features-for-safari-26-2/ | 2026-10-18 | high |
| web.dev (2025-11-25): WebGPU available in Chrome/Edge 113+, Firefox 141 (Windows) / 145 (macOS 26 ARM64), Safari 26 on macOS 26/iOS 26/iPadOS 26/visionOS 26; Chrome Android 121+ on Android 12+ Qualcomm/ARM GPUs; Linux "in progress" | https://web.dev/blog/webgpu-supported-major-browsers | 2026-10-18 | high |
| Wasm feature table: memory64 Chrome 133, Firefox 134, Safari flag only ("Safari Technical Preview 251"), Node 24, wasmtime 30; threads Safari 14.1 (iOS 14.5); multi-memory Chrome 120/Firefox 125, Safari absent; JSPI Chrome 137, Firefox 153, Safari 27; relaxed SIMD Safari behind flag | https://raw.githubusercontent.com/WebAssembly/website/main/features.json | 2026-10-18 | high |
| `Atomics.waitAsync`: Chrome 90, Firefox 145, Safari 16.4 / iOS 16.4 | https://caniuse.com/mdn-javascript_builtins_atomics_waitasync | 2026-10-18 | high |
| `createSyncAccessHandle`: Chrome 102, Firefox 111, Safari 15.2 / iOS 15.2; dedicated workers only | https://caniuse.com/mdn-api_filesystemfilehandle_createsyncaccesshandle ; https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createSyncAccessHandle | 2026-10-18 | high |
| `DecompressionStream`: Chrome 80, Firefox 113, Safari 16.4 / iOS 16.4 | https://caniuse.com/mdn-api_decompressionstream | 2026-10-18 | high |
| Fetch priority (`fetchpriority` / `fetch({priority})`): Safari 17.2+, Chrome 102+, Firefox 132+ | https://caniuse.com/wf-fetch-priority | 2026-10-18 | medium (caniuse entry covers the attribute family; the `fetch()` option is implied) |
| `SharedArrayBuffer` requires secure context + cross-origin isolation (COOP/COEP); Baseline since Dec 2021 | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer | 2026-10-18 | high |
| `navigator.deviceMemory` is not supported in Safari/iOS (Chromium only) | https://caniuse.com/mdn-api_workernavigator_devicememory | 2026-10-18 | high |
| `performance.measureUserAgentSpecificMemory()` requires secure context + cross-origin isolation; experimental, not Baseline | https://developer.mozilla.org/en-US/docs/Web/API/Performance/measureUserAgentSpecificMemory | 2026-10-18 | high |
| Cloudflare Workers static assets: `_headers` file, up to 100 rules, 2,000 chars per line, not applied to Worker-generated responses | https://developers.cloudflare.com/workers/static-assets/headers/ | 2026-10-18 | high |
| Workers static assets: 25 MiB max per file; 20,000 files (Free) / 100,000 (Paid); Worker bundle 64 MiB uncompressed; response body unlimited; CDN cacheable size 512 MB (Free/Pro/Business), 5 GB Enterprise | https://developers.cloudflare.com/workers/platform/limits/ ; https://developers.cloudflare.com/cache/concepts/default-cache-behavior/ | 2026-10-18 | high |
| Cloudflare range requests: 206 for single valid ranges, origin fetches aligned to 1 MiB, max cacheable size checked against full `Content-Range` size; Workers Caching strips `Range`, caches full `200`, slices itself; a Worker-generated `206` is not cached | https://developers.cloudflare.com/cache/reference/range-requests/ ; https://developers.cloudflare.com/workers/cache/configuration/ | 2026-10-18 | high |
| R2 public buckets: custom domain enables Cloudflare Cache (needs Cache Everything for all types), `r2.dev` is rate-limited/dev only; CORS policy configurable | https://developers.cloudflare.com/r2/buckets/public-buckets/ ; https://developers.cloudflare.com/r2/buckets/cors/ | 2026-10-18 | high |
| Meta Quest Browser: 146.0 (2026-04-21) "Experimental WebGPU and WebXR depth projection support"; 149.1 WebGPU space-warp layers; 150.1 experimental WebGPU foveation; 152.1 (2026-10-02) experimental WebGPU composition layers | https://developers.meta.com/horizon/documentation/web/browser-release-notes/ | 2026-10-18 | high |
| three.js r185 (01 Jul 2026): "Add support for WebXR with WebGPU"; r186 (24 Sep 2026): MSAA for WebXR WebGPU, XR fixes | https://github.com/mrdoob/three.js/releases | 2026-10-18 | high |
| Emscripten: `MEMORY64` setting deprecated in favor of `-m64`/`--target=wasm64`; `MAXIMUM_MEMORY` default 2 GiB; `PTHREAD_POOL_SIZE` default 0; `SHARED_MEMORY` default false | https://emscripten.org/docs/tools_reference/settings_reference.html | 2026-10-18 | high |
| iOS Safari per-tab memory limit: no official number; developer reports range from ~1.5 GB (iPhone 12 Pro) to ~3 GB (iPhone 15 Pro) before "This webpage was reloaded"; older engine guidance 300 to 500 MB; Godot/.NET defaulted wasm max memory to 256 MB after iOS failures | https://github.com/Nehanth/pooled/issues/207 ; https://github.com/godotengine/godot/issues/70621 ; https://github.com/dotnet/runtime/issues/84638 | 2026-10-18 | low (anecdotal) |
| Chromium keeps an on-disk persistent cache for Dawn/WebGPU pipelines (`GpuDiskCacheType::kDawnWebGPU`), memory-first then disk, deferred writes | https://chromium.googlesource.com/chromium/src/+/main/gpu/command_buffer/service/gpu_persistent_cache.h | 2026-10-18 | medium (source code, not docs) |

UNVERIFIED (not checked, stated by the repos only): the measured host throughput numbers (3.4 to 14.1 MB/s by lane count), the ~20 MB per engine Web Worker, the "1.5 GB renderer memory" sync-XHR regression, the iPhone RAM "ideally 8 GB" recommendation, and Apple GPU lack of BC support (inferred from muguet's transcoder path; Apple's Metal feature tables not fetched).

---

## 7. Recommendations for the spec

1. **Architecture**: specify a four-context runtime: `main` (DOM, PWA, XR session, input capture, AudioContext), `sim.worker` (gameplay/physics/AI/streaming decisions), `render.worker` (Three.js `WebGPURenderer` on OffscreenCanvas; main-thread fallback flag for XR and Safari), `asset.worker` (fetch, OPFS store, decode queue). Bootstrap via `postMessage`; steady-state via one `SharedArrayBuffer` with fixed-layout Int32/Float32 tables and `Atomics` (P1, P2).
2. **Headers**: ship `public/_headers` with `/*  Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` (plus `Cross-Origin-Resource-Policy: same-origin` on same-origin assets); mark every cross-origin asset (R2 custom domain, fal.ai cutscene MP4s) with `Cross-Origin-Resource-Policy: cross-origin` or proxy them same-origin; set these on Worker-generated responses too (the `_headers` file does not apply there). Feature-detect `crossOriginIsolated` and degrade to `postMessage` + `ArrayBuffer` copies.
3. **Storage split**: OPFS append-only block store + journal for world content, versioned by manifest hash (P3); IndexedDB for saves/settings/pipeline seeds (P14, P9); never the HTTP cache (`cache:'no-store'` on content fetches, immutable URLs with content hashes).
4. **Content pipeline**: build emits `manifest.json` `[[path,size,sha]]`, tile-packed `.pack` bundles (< 4 MB typical, hard cap 25 MiB if served as Workers static assets, otherwise R2), KTX2/Basis Universal textures (transcode to ASTC on iOS/Quest, BC7 on desktop), Draco/meshopt geometry, Opus audio. Large files go to R2 behind a custom domain with a Cache Everything rule; keep every object < 512 MB (P4).
5. **Boot set**: a CI job runs the game headless (Playwright + Chrome WebGPU) for each spawn/game mode, records first-touch asset ranges and pipeline recipes, and commits `bootset.<mode>.json` and `pipelines.<mode>.json`; the client prefetches the boot set with 16 to 32 parallel streams and pre-compiles materials (`renderer.compileAsync`) during the loading screen; reveal the world only when no new pipelines were compiled for N frames (P9).
6. **Streaming API**: the sim worker publishes `needNow(id, range)` and `willNeed(id, range, priority)` into a shared ring; the asset worker serves demand reads first (`priority:'high'`, sliced in 128 KiB parallel ranges) and speculative reads at `priority:'low'`, with an in-flight map so demand joins speculation (P6). Add `fetchRetry` with 8 jittered exponential attempts everywhere (P7).
7. **Device profiles**: `desktop`, `mobile`, `mobile-low`; choose from adapter limits/features (`texture-compression-astc` present => mobile GPU), `hardwareConcurrency`, `deviceMemory` when present, UA, and a 2-second startup benchmark; expose a settings page override; the low profile uses render scale 0.5, 2560x1440 cap, shadows off, half LOD distances, and its own pipeline seed (P11).
8. **iPhone PWA budget** (derive from muguet native caps but assume no entitlements): target < 900 MB total JS+wasm heap, < 500 MB GPU, 2 frames in flight, 30 fps cap by default, 60 fps optional; implement the 30 s stall watchdog and OOM hint (P12, P18); test on an iPhone with the lowest RAM you intend to support, because Safari reloads the tab silently.
9. **Input**: write input directly from main thread event handlers into the shared block (keys as 256-byte table, mouse deltas accumulated with `Atomics.add`, text ring, wheel notches by `deltaMode`), `pointerlock` with `unadjustedMovement`, release all on `blur`; touch overlay with per-vehicle-mode button sets (foot/car/heli/plane/boat/bike), 58 px virtual stick, hysteresis dead zones; Gamepad API (P2, muguet `touch.rs` numbers as a starting point).
10. **Audio**: AudioWorklet pulling from a shared f32 stereo ring at 48 kHz if we mix in a worker; otherwise Three.js audio on main; always gesture-gated and resumed on `visibilitychange` (P13).
11. **Multiplayer (phase 2)**: define a binary snapshot schema (<= 128 bytes: model, pos, heading, vel, flags, vehicle pos/rot/vel, weapon, health, aim, sender-clock ms), 20 to 30 Hz unreliable over WebRTC DataChannel (unordered, maxRetransmits 0) with WebSocket fallback; a reliable event channel with seq/ack dedupe; per-peer min-offset clock with p90 jitter-based delay (45 to 300 ms); interpolate, extrapolate <= 250 ms, snap on vehicle transitions; lowest-id ownership of NPC traffic per 150/220 m zone; relay = Cloudflare Durable Object per instance (hibernatable WebSockets) or Supabase Realtime for the reliable channel; 5 s timeout, 2 s keepalive (P16).
12. **Telemetry**: BroadcastChannels `progress`, `log`, `crash`, `fps`; sampled uploads only (rate-limited per client), include `measureUserAgentSpecificMemory` on Chromium (P12).
13. **Headless mode**: keep the render worker runnable under Node + Dawn (`webgpu` npm) or Playwright for screenshots, pipeline-seed capture and weak-device emulation via a `limits` override (P15).
14. **IP guardrails in the master prompt**: forbid any reference to the example repos' data, shader packs, symbol names, native tables, title art, or hostnames; require original assets (fal.ai-generated), original city data (OSM/Mapbox-derived, see Mapbox CLI note in the brief), and a license header on every file; keep muguet strictly as a design reference (GPL).

---

## 8. Risks

1. **Memory64 is not in stable Safari** (flag only in STP 251 per the wasm feature table). Any wasm module we ship must be wasm32 with `maximum <= 4 GiB` (practically <= 1 GiB on iOS); playgta5's 3 GiB-initial Memory64 layout is not portable to iPhone.
2. **iOS Safari memory ceiling is undocumented and far below native caps** (anecdotal 1.5 to 3 GB on recent iPhones; older guidance 300 to 500 MB). A Three.js city with streamed assets must be designed to stay under ~1 GB total or the tab reloads without an error.
3. **COEP `require-corp` breaks third-party embeds** (fal.ai media, Thirdweb widgets, "Sign in with ChatGPT" iframes) unless they send CORP/CORS headers; `credentialless` COEP is Chromium-only. Plan a non-isolated fallback path for auth/mod UI pages.
4. **OPFS exclusivity and eviction**: sync handles are single-tab; two game tabs fight; Safari may evict storage under pressure; always keep the memory fallback and show a "re-downloading" state.
5. **WebGPU in WebXR is uneven**: shipping on visionOS (Safari 26.2); experimental behind flags on Quest Browser (146 to 152); three.js support landed in r185/r186. Budget a WebGL2 fallback renderer path for Quest until the flag is default.
6. **Pipeline compilation stalls** on low-end GPUs (hundreds of pipelines for a first view); without compile-ahead and a reveal gate the first seconds show missing geometry.
7. **CDN caching of large objects**: objects > 512 MB are never cached on non-Enterprise plans; range requests do not bypass the size check; a Worker-generated `206` is uncacheable. Mis-sized packs would hit R2 directly on every read.
8. **Licensing contamination**: muguet is GPL-3.0 and playgta5 is unlicensed scraped code; an LLM-written implementation that paraphrases them too closely could be treated as derivative. Keep the spec at the pattern level and require independent implementation.
9. **Traffic spikes**: playgta5's own notes show 503/429 storms at 10k visitors/day on a PHP host; Cloudflare + R2 mitigates but origin-less static serving and retry/backoff are mandatory.
10. **`navigator.deviceMemory` absent on Safari** makes profile detection heuristic on exactly the platform with the tightest budget.

---

## 9. Open questions

1. Can the render worker + OffscreenCanvas + WebGPU drive a WebXR session on Safari visionOS 26.2 and Quest Browser, or must XR mode render on the main thread? (Not verifiable from docs; needs a device test.)
2. What is the practical wasm/JS heap ceiling on the target iPhones (iPhone 13/14/15/16 class) under iOS 26 Safari as a PWA (standalone mode), and does standalone mode differ from a Safari tab?
3. Does Safari 26 expose `texture-compression-astc` and `texture-compression-etc2` to WebGPU on iPhone, and `texture-compression-bc` on Apple Silicon Macs? (MDN lists the features; per-platform availability was not verified.)
4. Will the Thirdweb / "Sign in with ChatGPT" flows work inside a `COEP: require-corp` document, or do they need a separate non-isolated route?
5. Is Chrome's WebTransport (datagrams) worth a code path next to WebRTC DataChannel for the unreliable snapshot stream, given Safari's WebTransport status?
6. Which relay primitive (Cloudflare Durable Objects vs Supabase Realtime vs Convex) can sustain 30 Hz x N fan-out per instance at acceptable cost, and does it need a regional pin for Bay Area players?
7. `audio-worklet.js` and `prejs.js` were not captured; the exact worklet pull strategy (block size, underrun handling) is unknown.
8. Grand-V v2 (the successor to this port) could not be read; any v2 changes to the IO/GPU protocols are unknown.
