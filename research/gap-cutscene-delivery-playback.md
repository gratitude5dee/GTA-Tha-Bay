# gap-cutscene-delivery-playback — what H3 actually outputs, where to transcode it, and how cutscenes play on desktop, iPhone, Quest and Vision Pro

Research dimension `gap-cutscene-delivery-playback` (S00 gap agent). Checked 2026-10-18. Feeds S03 (C09 `CutsceneRequest`/`CutsceneAsset`, mission playback), S05 (C07 addressing, transcode job, provenance), S11 (C13 tiers and budgets), S09 (Workflow, R2, headers), S10 (subtitle UI and settings), S07 (fight intros).

**Builds on, does not repeat:**
- `research/genai-pipeline-fal.md` §2.3 (output handling: "MP4/H.264 assumed; UNVERIFIED", "transcode … if bitrate demands it") and §4.2 (`GenJobWorkflow`). This report closes both open points.
- `research/stack-cloudflare-backend.md` §1.2 (COOP/COEP/CORP, Range behaviour), §1.8 (Containers prices) and the cutscene single-flight (`CutsceneJobDO`).
- `research/stack-rendering-platform.md` §2 (support matrix), §3 (iPhone constraints, 2,048 MB WebContent report), §4 (XR renderer setup, `setupWebGLXRFallback`) and §6.5 (service worker; `RangeRequestsPlugin` for "keep offline").
- `research/gamedesign-decomposition.md` §4.5 (C09 cache keys; fight intro = per-character walk-in + per-pair face-off; 222 clips at N=12).
- Owner updates (`research/owner-updates.md`): San Francisco first. This changes nothing in the delivery path. Every v1 cutscene is an SF scene.

**Method.**
- Endpoint schemas came from fal's public registry (`GET https://api.fal.ai/v1/models?endpoint_id=<id>&expand=openapi-3.0`).
- The three sample outputs linked from the H3 model pages were downloaded into a new scratch directory (`scratchpad/s00cut_dl/media/`). They were analysed with ffprobe 6.1.1, a small MP4 box walker and `c2pa-python` 0.38.0 (official C2PA SDK bindings).
- Test transcodes were run locally with ffmpeg 6.1.1/libx264 on a 4-vCPU container (`scratchpad/s00cut_out/`, recipe `scratchpad/s00cut_scripts/ladder.sh`).
- Browser and platform behaviour came from four sources: MDN browser-compat-data 8.1.6 (2026-10-15), WebKit's `main` branch source (commit `5b2e266b`, files named below), webkit.org release notes, and the three.js `0.186.1` npm tarball plus the `r186` examples.
- Cloudflare facts came from the Cloudflare docs MCP and developers.cloudflare.com, plus live header probes of Stream's documentation demo video.
- Anything not confirmed against a source this session is listed under "## Unverified".

---

## 0. Headline findings

1. **The H3 output format is now measured, not assumed.** Three fal sample outputs were checked: one from `h3-max-turbo/image-to-video`, one from `h3-max-turbo/text-to-video` and one from the `h3-max/reference-to-video` page. All three share the same format:
   - **Container:** MP4 (`isom`, muxer `Lavf58.76.100`), `moov` before `mdat` (fast-start).
   - **Video:** H.264 **Constrained Baseline, level 4.1**, **1344×768**, **24 fps CFR**, 124 frames for a 5 s request (5.167 s).
   - **Encoder:** x264 core 163 at **crf 18** with near-"ultrafast" settings (`cabac=0 bframes=0 me=dia subme=0 aq=0 keyint=48 scenecut=0`). This gives **5.0–12.6 Mbps** for 5 s of 768p, or 3.3–8.3 MB per 5 s clip.
   - **Audio:** every sample has a non-silent **AAC-LC 32 kHz stereo** track (≈195 kbps, 5.184 s, so 17 ms longer than the video).
   - **Schemas:** neither endpoint has a parameter that disables audio.
2. **Every output carries a C2PA manifest signed by fal.** It sits in a 13.4 KB `uuid` box before `moov`.
   - Contents: `c2pa.created`, `digitalSourceType = trainedAlgorithmicMedia`, `softwareAgent = fal-ai/minimax-h3-turbo`, and an `ai.fal.info` assertion with the internal endpoint and `request_id`. The hash is `c2pa.hash.bmff.v3` and the certificate is "fal - Features & Labels Inc.".
   - `c2pa-python` reports `validation_state: Valid`, with `signingCredential.untrusted` (fal's CA is not on the SDK's default trust list).
   - **Any transcode or remux drops it.** The re-encoded rendition had no JUMBF data.
   - There is no visible watermark. fal says it also embeds an invisible watermark; whether that applies to video is UNVERIFIED.
3. **Transcoding is required, and it is cheap.** Re-encoding the fal output with x264 High/`slow` at CRF 21 (5 Mbps cap) cut bytes by **66–77 %** at SSIM 0.984. A 540p rendition of the hardest sample is 1.08 MB per 5 s.
   - The full ladder used **≈24 CPU-seconds per 5 s clip**: two fMP4 video renditions, a loudness-normalised `a.m4a` and a WebP poster.
   - On Cloudflare Containers that is **≈ $0.001 per clip**. Roughly 900 clips a month fit inside the Workers Paid included 375 vCPU-minutes.
4. **Recommended transcoder: ffmpeg in Cloudflare Containers**, as new steps in the existing cutscene Workflow. Containers have been GA since 2026-04-13; cold starts are 1–3 s. The same pinned image runs in CI and the batch CLI.
   - **Cloudflare Stream is not recommended.** Its manifests "must not be cached, proxied or stored", so "keep offline" is impossible. Delivery is billed in 4 s segments. Its manifests and segments send `Access-Control-Allow-Origin: *` but no `Cross-Origin-Resource-Policy`, and its iframe player sends no COEP. Adaptive bitrate also gains nothing on 0.92–15 s clips.
   - **Media Transformations** is a fallback only, for posters or an emergency 720p MP4. It outputs H.264/AAC MP4 with no control over profile, bitrate, GOP or fMP4. The Workers binding is in beta and unbilled until GA.
5. **iPhone (iOS 26/27, Home Screen app): muted autoplay is not enough.**
   - WebKit `main` adds `RequireUserGestureForVideoDueToLowPowerMode` and `…AggressiveThermalMitigation` at element creation. In Low Power Mode, *any* video element, muted or not, needs a user gesture to play.
   - A `play()` inside a user gesture removes all per-element restrictions, including audio, load and low-power (`removeBehaviorRestrictionsAfterFirstUserGesture`).
   - On iOS, audible video elements cannot play concurrently (`ConcurrentPlaybackNotPermitted` for `VideoAudio`).
   - **Design consequence:** unlock a pool of 2–3 `<video>` elements in the first tap, always play video *muted*, and play cutscene audio through the game's `AudioContext`.
   - A muted video does not keep the display awake (`shouldBeAbleToSleep` is true unless the type is `VideoAudio`). So request Wake Lock, which has worked in Home Screen apps since iOS 18.4.
6. **Gapless fight intros:**
   - iPhone has no `MediaSource` but has **`ManagedMediaSource`** (iOS 17.1+; it requires `disableRemotePlayback` or an AirPlay alternative). Desktop Chrome and Quest have `MediaSource`.
   - Encode all clips with identical parameters as fMP4 and append them into one video-only `SourceBuffer` in `sequence` mode. Schedule the per-clip audio sample-accurately in Web Audio.
   - Fallback: ping-pong between two pre-rolled muted elements. Safari 27 "loosened the gap tolerance between buffered ranges" in MSE, so expect stalls on 26.x if clips leave gaps; test it.
7. **three.js r186 video on WebGPU:**
   - `VideoTexture` sets `needsUpdate` from `requestVideoFrameCallback`. The WebGPU backend then uploads each new frame with **`copyExternalImageToTexture`**.
   - `importExternalTexture` appears in r186 only on a path fed by XR textures. Video never uses it, although Safari 26 and Chrome expose `GPUExternalTexture` (BCD).
   - `VideoFrameTexture` + WebCodecs (`webgpu_video_frame` example, `three/addons/libs/demuxer_mp4.js`) gives a decoder path that bypasses media-element policies.
   - For **full-screen cutscenes on desktop and mobile, a DOM `<video>` overlay is preferable**. The 3D render loop is paused under it.
8. **XR:**
   - **Quest** has `XRMediaBinding` media layers (Browser 16.1+, BCD "oculus 16.1" only). three r186 does not wrap them, but its `XRManager` composes `session.renderState.layers`, and the official r186 example `webxr_vr_layers.html` adds a media layer that way. Use a media quad layer on Quest.
   - **Vision Pro** (Safari visionOS 26.2/27) has neither media layers nor `XRWebGLBinding.createQuadLayer` (BCD: Safari false). Safari 27 adds only texture-array projection layers. So **in-scene textured planes only**: WebCodecs → `VideoFrameTexture` is preferred, with `VideoTexture` as fallback.
   - Video textures freezing after entering XR is reported on Quest and Pico (community sources). Mitigations: create elements before `requestSession`, and poll `currentTime` as well as rVFC.
   - Run Quest at **72 Hz during cutscenes**, because 72 = 3 × 24 gives judder-free cadence.
9. **Subtitles:** WebVTT per clip feeds one engine-side subtitle renderer: a DOM layer on flat screens, and a canvas-textured plane or Quest quad layer in XR. Native `<track>` rendering is not used.
   - Generate VTT from the mission script's dialogue lines.
   - Run Workers AI `whisper-large-v3-turbo` (VTT output, $0.000513 per audio minute) on every generated audio track. Because H3 audio can contain unscripted speech, any detected speech blocks publish until a human approves the clip or its audio is replaced.

---

## 1. H3 output format (measured 2026-10-18)

### 1.1 Schema facts (fal OpenAPI, both endpoints)

| Item | `minimax/h3-max-turbo/image-to-video` | `minimax/h3-max/reference-to-video` |
|---|---|---|
| Registry `updated_at` | 2026-10-16T17:18:37Z | 2026-10-02T18:53:14Z |
| Output schema | `{ video: File, expanded_prompt?, timings? }` | `{ video: File, expanded_prompt?, seed (required), timings? }` |
| `File` | `{ url (required), content_type?, file_name?, file_size? }` | same |
| Codec, bitrate or fps parameters | none | none |
| Audio switch | none. `target_audio_url` (≥2 s, ≤15 MB) *replaces* "the output soundtrack", which implies one is always generated | none. `reference_audio_urls` ≤ 3 |
| Duration | 0.92–15 s; "output can run up to about 0.7 s longer than requested" | same |
| Resolutions | 480P / 768P / 1080P ("1080P latent refinement from a native 768P source") | same; `middle_image_url` only at 480P/768P |
| Schema title | `TurboImageToVideoHailuo03Input` | `TurboReferenceToVideoHailuo03Input` |

The reference-to-video sample's C2PA assertion names the internal endpoint `fal-ai/minimax-h3-turbo/reference-to-video`. With the "Turbo…" schema title, this suggests H3 Max reference-to-video is served by a Turbo backend. That is an observation, not a documented fact, so it is UNVERIFIED. It matters for the C09 key's `gen.endpoint` field (genai-pipeline-fal §2.2): key on the public endpoint id plus `metadata.updated_at`, not on internal names.

### 1.2 Sample outputs (ffprobe 6.1.1, box walk, c2pa-python 0.38.0)

| Field | i2v sample (`0aa8e7f1/h6xL…`) | t2v sample (`0aa8f038/UcnQ…`) | ref2v-page sample (`0aa91f5a/mMxt…`) |
|---|---|---|---|
| C2PA endpoint / created | `fal-ai/minimax-h3-turbo/max-turbo/image-to-video`, 2026-09-03 | `…/max-turbo/text-to-video`, 2026-09-03 | `fal-ai/minimax-h3-turbo/reference-to-video`, 2026-09-04 |
| Size / duration | 8,277,609 B / 5.184 s | 3,342,830 B / 5.184 s | 5,252,129 B / 5.184 s |
| Video | H.264 Constrained Baseline L4.1, 1344×768, yuv420p, 24/1, 124 frames, **12.59 Mbps** | same, **4.95 Mbps** | same, **7.90 Mbps** |
| Colour tags | unset (`color_range/space/transfer/primaries = unknown`) | same | same |
| GOP | keyframes at 0, 2, 4 s (keyint 48, no scene-cut) | same | same |
| Audio | AAC-LC 32 kHz stereo 196 kbps, 5.184 s; mean −17.3 dB, max −1.9 dB | 193 kbps; mean −10.0 dB, max **0.0 dB** | 201 kbps; mean −23.0 dB, max −3.5 dB |
| Box order | `ftyp` 32 B → `uuid` (C2PA, 13.4 KB) → `moov` 4.4 KB → `free` → `mdat` | same | same |
| C2PA | Valid; `signingCredential.untrusted`; ES256; issuer "fal - Features & Labels Inc.", CN `fal.ai` | same | same |

x264 options string, the same in all three: `cabac=0 ref=1 deblock=0:0:0 analyse=0:0 me=dia subme=0 … trellis=0 8x8dct=0 … bframes=0 weightp=0 keyint=48 keyint_min=4 scenecut=0 … rc=crf mbtree=0 crf=18.0 … aq=0`.

fal CDN response headers on the sample: `content-type: video/mp4`, `accept-ranges: bytes`, `access-control-allow-origin: *`, `cache-control: public, max-age=5184000, immutable`, `content-security-policy: sandbox; default-src 'none'; media-src 'self'`, and **no `Cross-Origin-Resource-Policy`**.

No visible watermark was found: frames at 0.5 s, 2.5 s and 4.5 s were inspected, including all four corners of the reference sample. The large "H3 MAX TURBO" text in two samples is prompted marketing content.

**What this means for the pipeline:**
- Constrained Baseline at CRF 18 is a fast-encode format, not a delivery format. Re-encoding with x264 High/`slow` keeps quality (SSIM 0.984) at a third of the bytes or less (§2.4).
- The 1344×768 frame is 1.75:1, not 16:9. Keep the native aspect and letterbox or pillarbox at playback. Do not crop: walk-ins are framed by the model.
- The colour tags are unset. Tag the renditions BT.709 so Safari and Chrome agree on conversion. three warns that video textures must use an sRGB-transfer colour space (`Textures.js`).
- The audio is always present and sometimes peaks at 0 dBFS. Normalise it to −16 LUFS / −1.5 dBTP and resample to 48 kHz (the iOS `AudioContext` rate). Treat it as optional content gated by QA (§6).
- Video is 124/24 s and audio is 5.184 s. Concatenation offsets must come from the *video frame count* recorded in the manifest, not from container duration.
- Clients must never load fal URLs. They expire (genai-pipeline-fal §2.3 sets 24 h), and fal sends no CORP header.

### 1.3 Provenance

fal's verify page says: "Every piece of media generated through fal's hosted applications is signed with Content Credentials (C2PA)" and "embedded with an invisible watermark". It also says credentials may be removed "via editing, re-saving, compression". Its upload form lists only image types, so the video watermark is UNVERIFIED.

The measured manifest is a BMFF hash (`c2pa.hash.bmff.v3`) excluding only `/uuid`, `/ftyp`, `/mfra`, `/free` and `/skip`. Any re-encode, remux or fMP4 conversion therefore invalidates or drops it. The transcoded `v768.mp4` returned `ManifestNotFound`.

Spec consequences:
1. Keep `orig.mp4` byte-exact as the provenance anchor.
2. Copy its validation result, `ai.fal.info.request_id` and sha256 into the provenance record (legal-ip-likeness §2.3).
3. Treat re-signing renditions with our own C2PA claim, using the original as ingredient, as an optional ADR for legal (§8 Q-CUT-04).
4. Never expose `orig.mp4` publicly by default. It contains fal's `request_id`, and it is 2–4× larger.

---

## 2. Transcoding on Cloudflare

### 2.1 Options compared (facts checked 2026-10-18)

| | **Cloudflare Stream** | **Media Transformations** | **ffmpeg in Containers** | **ffmpeg in CI/CLI (batch)** |
|---|---|---|---|---|
| Status | GA. Workers binding `env.STREAM` since 2026-05-07 | URL mode GA. **Workers binding in beta** (2026-03-18) | **GA 2026-04-13** ("Containers and Sandboxes are now generally available") | n/a |
| Ingest | `POST /accounts/{id}/stream/copy {url}` or `env.STREAM.upload(url)`; fal or R2 URL works | URL: `/cdn-cgi/media/<opts>/<src>`; binding: `env.MEDIA.input(stream)` from R2 | Worker → container `fetch`; container pulls and pushes via R2 presigned URLs | `@fal-ai/client` download → local ffmpeg → R2 S3 API |
| Output | HLS (fMP4 segments, 4.004 s at EXTINF), DASH, ABR ladder 240p–1080p (demo manifest: avc1.42c015 … avc1.4d4028), optional MP4 download | "H.264/AAC optimized MP4"; `frame` → JPEG/PNG; `spritesheet`; `audio` → M4A. Options: `width/height` 10–2000, `fit`, `time`, `duration` 1–60 s, `audio` true/false | Anything ffmpeg does: CMAF fMP4, exact GOP, profile/level, BT.709 tags, loudnorm, WebP poster, identical params across clips | same as Containers |
| Input limits | 30 GB file | **<100 MB, ≤10 min**, origin must support HEAD + Range | instance disk 2–20 GB; standard-2 = 1 vCPU / 6 GiB / 12 GB | none |
| Price | **$5 per 1,000 min stored (prepaid)** + **$1 per 1,000 min delivered**; encoding and ingress free; delivery rounded to segment length (4 s); preloading is billable | $0.50 per 1,000 unique transformations after 5,000 free per month; 1 per output second for video; binding unbilled while in beta, then billed per operation | CPU $0.000020/vCPU-s (active), memory $0.0000025/GiB-s, disk $0.00000007/GB-s; Paid includes 375 vCPU-min, 25 GiB-h, 200 GB-h (stack-cloudflare-backend §1.8) | CI minutes |
| Works under our COEP `require-corp`? | Manifests and segments send ACAO `*` and no CORP, so only in CORS mode (`crossorigin` or hls.js). Player iframe sends no COEP/CORP, so by spec it is blocked as a nested document in an isolated page (in-browser behaviour UNVERIFIED). Manifests "must not be cached, proxied or stored", so no offline | Output served from our zone; same-origin or CORS | Output is plain R2 objects on our media domain | same |
| Fit for 100–400 clips of 0.92–15 s | Poor: ABR startup on 5 s clips, segment rounding (a 5.2 s clip spans two 4 s segments), recurring cost, no offline, no fMP4 control for gapless MSE | Partial: posters and a quick 720p, but no fMP4, GOP, level or colour tags; `duration` minimum 1 s vs H3's 0.92 s minimum | **Best** | Best for the roster prewarm (genai-pipeline-fal §4.2 note (c)) |

### 2.2 Cost at our scale (assumptions labelled A)

- **(A) Clip counts:** 222 fighter clips at 5.2 s plus 100 story clips at 15 s gives 2,654 s ≈ **44 minutes** of video, and about 322 transcodes per full regeneration.
- **Stream:** storage needs the $5/month minimum block (1,000 min).
  - (A) Each MAU plays about 40 clips. Rounding each played clip up to whole 4.004 s segments (two for a 5.2 s clip, four for a 15 s clip) bills about 10 s per play, so ≈ 6.7 min per MAU.
  - At 10k MAU that is ≈ 67,000 min ≈ **$67 per month** in delivery, plus $5 storage.
  - R2 is still needed for the masters and for offline copies.
- **R2 + Containers:**
  - Storage: about 400 clips × ≈16 MB (orig + renditions + audio) ≈ 6.4 GB, inside the 10 GB-month free tier ($0.015/GB-month after).
  - Reads: range reads from a cached custom domain mostly hit Cloudflare's cache. R2 Class B is $0.36 per million after 10 M free.
  - Egress is free.
  - Transcode ≈ $0.001 per 5 s clip and ≈ $0.003 per 15 s clip (§2.4), so ≈ **$0.50 per full regeneration** of 322 clips.

### 2.3 Recommendation

**Transcode with ffmpeg in a Cloudflare Container, invoked from new steps of the existing cutscene Workflow** (§7.2). Use the same Docker image in `tools/media/transcode` for the CI and CLI batch prewarm, so both paths emit byte-identical encoder settings. The recipe file is versioned (`cut@1`) and its version enters the manifest, not the cache key.

Use Media Transformations (binding) only as a degraded path if the container step exhausts its retries:
- `frame` gives `poster.jpg`;
- `video` at 720p gives `v720-mt.mp4` (non-fMP4, so progressive playback only, with no MSE concatenation);
- mark the manifest `degraded: true`.

Do not adopt Stream.

### 2.4 Measured transcode (local, 4 vCPU, ffmpeg 6.1.1, recipe `cut@1`)

| Sample | fal orig | `v768` (High, slow, CRF 21, cap 5 Mbps, fMP4) | `v540` (CRF 23, cap 1.8 Mbps) | `a.m4a` (AAC 128k 48 kHz, loudnorm) | `poster.webp` |
|---|---|---|---|---|---|
| i2v (high motion) | 8.28 MB | 2.73 MB (4.2 Mbps) | 1.08 MB | 85 KB | 41 KB |
| t2v (low motion) | 3.34 MB | 0.76 MB (CRF 21, 6 Mbps-cap variant) | — | — | — |
| ref2v | 5.25 MB | 1.65 MB (same variant) | — | — | — |

- **Quality:** SSIM of the re-encoded 768p against the fal original is 0.9839 (Y), 0.9865 (all planes). A 720p (1260×720) upscaled back gives 0.9768.
- **CPU:** the full `cut@1` ladder (two video renditions, audio, poster) used **user 22.3 s + sys 1.5 s CPU and 8.8 s wall** for 5.2 s of input, about 4.6 CPU-s per second of video.
- **Container cost:** on `standard-2` (1 vCPU, 6 GiB) a 5 s clip is ≈ 24 vCPU-s ($0.00048) plus ≈ 30 s × 6 GiB of memory ($0.00045), so **≈ $0.001**. A 15 s clip is ≈ $0.003.
- **Included allowance:** 375 vCPU-min = 22,500 vCPU-s covers ≈ 900 five-second clips per month.

Recipe (the core of `services/transcoder/ladder.sh`; pin the ffmpeg build in the image):

```sh
COMMON="-c:v libx264 -profile:v high -preset slow -g 24 -keyint_min 24 -sc_threshold 0 -pix_fmt yuv420p \
 -color_primaries bt709 -color_trc bt709 -colorspace bt709 -an \
 -movflags +frag_keyframe+empty_moov+default_base_moof+cmaf"
ffmpeg -i orig.mp4 $COMMON -level 4.0 -crf 21 -maxrate 5M   -bufsize 10M  v768.mp4   # codecs avc1.640028
ffmpeg -i orig.mp4 -vf scale=-2:540 $COMMON -level 3.1 -crf 23 -maxrate 1.8M -bufsize 3.6M v540.mp4  # avc1.64001f
ffmpeg -i orig.mp4 -vn -af loudnorm=I=-16:TP=-1.5:LRA=11 -c:a aac -b:a 128k -ar 48000 -ac 2 a.m4a   # mp4a.40.2
ffmpeg -ss 0 -i orig.mp4 -frames:v 1 -c:v libwebp -quality 80 poster.webp
# 1080P source (optional): add v1080 at -level 4.1 -crf 21 -maxrate 8M (dims UNVERIFIED until a 1080P sample is probed)
```

- The renditions are **video-only CMAF fMP4** with a 1 s GOP. They play progressively through `<video src>` and also append to (Managed)MediaSource.
- Audio is a separate `a.m4a`, decoded into Web Audio (§3, §7.4).
- Each step's outputs are written with `Cache-Control: public, max-age=31536000, immutable`, since keys are content-addressed.

---

## 3. iPhone Home Screen web app (iOS 26/27): playback rules that decide black screen vs cutscene

### 3.1 Autoplay and gesture rules (WebKit policy post plus current WebKit source)

- **Published policy (webkit.org, 2016-07-25, still current):**
  - "`<video muted>` elements will also be allowed to autoplay without a user gesture."
  - Video with audio needs a gesture.
  - "If a `<video>` element gains an audio track or becomes un-muted without a user gesture, playback will pause."
  - `playsinline` videos "will not automatically enter fullscreen mode". Without it, iPhone still goes fullscreen.
  - Elements not in the DOM, or hidden with `display:none` / `visibility:hidden`, need a click-triggered gesture.
  - `play()` returns a Promise that rejects when these rules are not met.
- **WebKit `main`, `Source/WebCore/html/HTMLMediaElement.cpp` (commit 5b2e266b):**
  - When the element is created, `page->isLowPowerModeEnabled()` adds `RequireUserGestureForVideoDueToLowPowerMode`, and `isAggressiveThermalMitigationEnabled()` adds `…DueToAggressiveThermalMitigation`.
  - `MediaElementSession::playbackStateChangePermitted` then denies any video without a gesture ("Video low power mode restriction"), **muted or not**.
  - `play()` inside a gesture calls `removeBehaviorRestrictionsAfterFirstUserGesture()`. That removes the load, video-rate, audio-rate, fullscreen, low-power, thermal and invisible-autoplay restrictions **for that element** and notes user interaction on the main document.
  - So a pre-unlocked element can later `play()` with a new `src`, whatever the power mode. Shipping iOS 26/27 behaviour must be confirmed on a device in Low Power Mode (UNVERIFIED for the shipping build).
- **iOS session rules (`platform/audio/ios/MediaSessionManagerIOS.mm`):**
  - `VideoAudio` sessions get `ConcurrentPlaybackNotPermitted`, `BackgroundProcessPlaybackRestricted` and `SuspendedUnderLockPlaybackRestricted`.
  - `HTMLMediaElement::presentationType()` classifies a muted `<video>` as `Video`, not `VideoAudio`.
  - Two audible videos cannot play at once, so pre-rolling clip B with sound pauses clip A. Muted pre-roll is safe.
- **Chrome (desktop, Quest):** "Muted autoplay is always allowed". Sound needs prior interaction (developer.chrome.com, autoplay policy).

**Rule for the spec:**
1. Every cutscene `<video>` is `muted`, `playsinline`, `disableRemotePlayback`, `crossorigin="anonymous"` and `preload="auto"`.
2. Cutscene audio never comes from the media element.
3. A pool of three elements is unlocked in the title screen's first `pointerup`/`keydown`, the same handler that resumes the `AudioContext` (stack-rendering-platform §3.5). Each element plays a 0.1 s same-origin blank clip, then pauses.

### 3.2 Native HLS vs ManagedMediaSource vs progressive MP4

- **iPhone:**
  - `MediaSource` is "Exposed in Mobile Safari on iPad but not on iPhone" (BCD).
  - **`ManagedMediaSource` / `ManagedSourceBuffer` are available from Safari iOS 17.1** (BCD; WebKit 17.1 post). It is "only available when an AirPlay source alternative is present" or "remote playback is explicitly disabled".
  - The MSE editor's draft (W3C WD 2026-08-07): the UA "can evict content … for any reason". Apps must listen for `bufferedchange` and `startstreaming`/`endstreaming`.
- **Desktop Chrome and Quest Browser:** `MediaSource` yes; `ManagedMediaSource` no (BCD).
- **visionOS Safari:** BCD has no visionOS column. MMS is assumed present because the engine is the same (UNVERIFIED).
- **Native HLS:** it would mean a manifest per clip and gives no benefit for ≤15 s single-rendition clips. It is only needed for long-form streams, which we do not have.

**Decision:**
- **Progressive fMP4 via `<video src>`** for single clips (story beats, specials, endings).
- **(M)MSE in `sequence` mode** for composed sequences (fight intros) on every tier.
- No HLS.

### 3.3 Wake Lock, memory, interruptions

- **Wake Lock:**
  - Supported from iOS 18.4 (BCD). WebKit bug 254545 ("New Wake Lock API does not work in Home Screen Web Apps") is RESOLVED FIXED. A "regressed in iOS 26.1" comment from 2025-12-04 was retracted the same day ("issue was with our browser detection library").
  - Because muted video lets the screen sleep (`shouldBeAbleToSleep`), **request `navigator.wakeLock.request('screen')` at cutscene start**, release it at the end, and re-acquire on `visibilitychange`.
- **Memory:** there is no platform number for media decode on iOS. Media playback runs in WebKit's GPU process (trac.webkit.org/wiki/GPUProcess), separate from the 2,048 MB WebContent limit (stack-rendering-platform §3.3).
  - Engineering estimate (UNVERIFIED): one decoded 1344×768 NV12 frame = 1.55 MB. A hardware decoder queue of about 8–16 frames is 12–25 MB per playing element. Add the fMP4 bytes held by MMS (≤ 2.8 MB per 5 s at 768p) and a 4.1 MB RGBA copy if the video is sampled as a texture.
  - Budget **64 MB "media" headroom** on `mobile`, with ≤ 1 decoding plus ≤ 1 pre-rolled element. Release with `removeAttribute('src'); load()` after use.
- **Interruptions:** on `visibilitychange` → `hidden` (call, app switch), pause video, suspend the audio scheduling, release Wake Lock and keep the playhead. On return, show a "Resume" button. The `AudioContext` may be `interrupted` and need a gesture.

---

## 4. Rendering video in three.js r186 `WebGPURenderer`

Source read: `three@0.186.1` tarball.

- **`VideoTexture`** (`src/textures/VideoTexture.js`):
  - `generateMipmaps = false`, `LinearFilter`.
  - If `requestVideoFrameCallback` exists (Safari 15.4+, Chrome 83+, Oculus 10+ per BCD), each callback sets `needsUpdate = true`; otherwise `update()` polls `readyState`.
  - Uploads therefore happen at the **video rate (24 Hz)**, not the display rate.
- **WebGPU backend upload** (`src/renderers/webgpu/utils/WebGPUTextureUtils.js` ~L1005): `device.queue.copyExternalImageToTexture({source: video, flipY}, {texture, premultipliedAlpha}, extent)`, wrapped in `try/catch` ("fix bad video frame data on certain devices, see #32391"). One full RGBA8 copy per new frame: 4.1 MB at 1344×768, ≈ 99 MB/s at 24 fps.
- **`importExternalTexture`:** it appears only in `WebGPUBindingUtils.createBindGroup` when `textureData.externalTexture !== undefined`. That field is set only by `setXRRenderTargetTextures` (XR). **No `GPUExternalTexture` path exists for video in r186**, although BCD 8.1.6 lists `GPUDevice.importExternalTexture` and `GPUExternalTexture` as supported in Safari 26 / iOS 26, Oculus 32 and Chrome (recorded as 144, with platform notes). A custom TSL node plus a backend patch would be needed. **Not worth it in v1.**
- **WebGL2 backend** (`webgl-fallback/utils/WebGLTextureUtils.js` ~L661): `gl.texImage2D(..., video)` per update. This is the Quest path.
- **`VideoFrameTexture`** (`src/textures/VideoFrameTexture.js`): `setFrame(frame)` takes a WebCodecs `VideoFrame`. The r186 example `webgpu_video_frame.html` decodes with `VideoDecoder` through `three/addons/libs/demuxer_mp4.js`.
  - That addon imports `mp4box@2.3.0` **from cdn.jsdelivr.net at runtime**. Vendor and pin `mp4box@2.4.1` (BSD-3-Clause, npm 2026-06-19) in our bundle instead.
  - BCD: `VideoDecoder` and `VideoFrame` are in Safari 16.4 and Oculus 18. `copyExternalImageToTexture` with a `VideoFrame` source is in Safari 26 and Chrome 144.
  - Advantages: WebCodecs decoding is not media-element playback, so autoplay, low-power and session rules do not apply to it. Frames are presented by our own clock, so concatenation is gapless by construction.
  - Cost: demux plus scheduling code and an explicit `frame.close()` (three issue #30379 noted in the example).
- **Colour:** set `texture.colorSpace = SRGBColorSpace`. `Textures.js` warns otherwise.

**Which presentation path when** (full table in §7.3):
- **Full-screen cutscene, desktop and mobile:** a **DOM `<video>` overlay** above the canvas with `object-fit: contain` on black. The system compositor presents it with zero three.js GPU cost. Pause the sim and stop `renderer.setAnimationLoop` while it covers the screen; keep GPU resources resident for an instant resume. This avoids a 4 MB-per-frame copy and any WebGPU/video interaction on a thermally limited iPhone.
- **In-world screens** (TV in a bar, Salesforce-Tower-style LED billboard, phone UI): `VideoTexture`, at most 1 live on `mobile` and 2 on `desktop`, using `v540`.
- **XR:** §5.

---

## 5. Cutscenes inside WebXR

### 5.1 Quest Browser (xr-standalone; WebGPURenderer on its WebGL2 backend)

- **Media layers:**
  - `XRMediaBinding` with `createQuadLayer` / `createCylinderLayer` / `createEquirectLayer` is in **Oculus Browser 16.1+** (BCD; the Meta blog of 2021-06-29 says the layers were "open to all users" from 16.1).
  - BCD lists **no other browser**: not Chrome desktop, not Safari.
  - Meta docs: the compositor "renders the video directly … video pixels are sampled once rather than twice", and "any video will work, including cross-origin and streaming video". Playback is controlled through `HTMLMediaElement`.
- **Spec shape** (immersive-web Layers ED): `createQuadLayer(HTMLVideoElement video, optional XRMediaQuadLayerInit init)` with `{ space (required), layout = "mono", invertStereo, transform?, width?, height? }`, where width and height are in metres.
- **three r186:**
  - `XRManager` has `createQuadLayer` / `createCylinderLayer` only for *rendered* layers via `XRWebGLBinding`, with a `rendercall` drawing into an `XRRenderTarget`. These need the WebGL backend.
  - It has **no `XRMediaBinding` wrapper**. At session start it calls `session.updateRenderState({ layers: [ ...ownLayers, glProjLayer ] })`. When adding a layer mid-session it reads `session.renderState.layers`, `unshift`s and re-applies.
  - So an app-owned media layer added after session start survives later three layer additions.
  - The official r186 example `webxr_vr_layers.html` builds `[equirectMediaLayer, quadLayers…, session.renderState.layers[0]]` this way.
  - The r186 example `webgpu_xr_native_layers.html` shows `createQuadLayer` working with `WebGPURenderer({ forceWebGL: true, multiview: true })`.
- **Layer order:** layers composite back to front. Put the cutscene media layer **after** the projection layer (in front) so no "punch-through" plane is needed. Hide controllers and hands during the cutscene; they would otherwise be drawn behind the screen. Use a second quad layer (rendered, `XRWebGLBinding`) for subtitles.
- **Frame rate:** `XRSession.updateTargetFrameRate` is in Oculus 31.2+ only (BCD). Switch to **72 Hz during cutscenes**: 72 = 3 × 24, so each video frame lasts exactly three refreshes, while 90/24 = 3.75 judders. Restore the previous rate on exit (stack-rendering-platform §4.5 governor).
- **Known hazard:** community reports (three.js forum 2022; a note.com write-up on Quest 2/3/Pro and Pico 4) say textures from `<video>` elements freeze after entering an immersive session, especially for elements created during it.
  - Mitigations: create and unlock the pool before `requestSession`, and use the media layer (the compositor reads the element).
  - On the texture fallback, also set `needsUpdate` when `video.currentTime` advanced since the last XR frame, in case rVFC callbacks stall. This is UNVERIFIED on current Quest Browser 152.1 and needs a device test.

### 5.2 Vision Pro (xr-pro; native WebGPU XR in Safari 26.2+, WebGL2 fallback)

- BCD shows `XRMediaBinding` and `XRWebGLBinding.createQuadLayer` as **false** for Safari.
- Safari 27.0 adds only "texture array projection layers in WebXR Layers" and fixes `XRProjectionLayer` sizes (webkit.org, 2026-09-17). No media-layer item appears in the 26.0, 26.2 or 27.0 notes.
- three r186 WebGPU XR renders one projection layer without multiview (stack-rendering-platform §0.2).
- **Only in-scene textures work.**
- **Default path:** WebCodecs `VideoDecoder` → `VideoFrameTexture` on a world-locked plane. This sidesteps any media-element behaviour while the page is behind an immersive session (UNVERIFIED either way).
- **Fallback:** `VideoTexture` from a pre-unlocked element with the same `currentTime` poll.
- `updateTargetFrameRate` is not available (BCD Safari false). Vision Pro runs 90/96/100 Hz (stack-rendering-platform §0.6), and 96 = 4 × 24 would be ideal, but the session rate is not controllable from WebXR (UNVERIFIED).
- **Load control:** during a cutscene, render only the "cinema" scene: dimmed sky, the screen plane, the subtitle plane and a floor. Do not render the city. This keeps the two non-multiview passes trivial. The full-scene frame rate is irrelevant while the screen fills the view.

### 5.3 Comfort rules for video in XR

These are recommendations; the vendor guidance on 2D video in VR was not checked this session.
- The screen is world-locked, never head-locked.
- About 2.4 m wide at 3 m (≈ 44° horizontal FOV), centred at seated eye height.
- 300 ms fade to "cinema" and back.
- Skippable with a controller button or a pinch.
- No camera motion is applied to the player's view. All motion is inside the clip.
- Do not use passthrough during cutscenes.

---

## 6. Subtitles (R-ENG-04) and generated audio

- **Format:** one WebVTT file per clip per language (`subs.<lang>.vtt`).
- **Rendering:** cues are not rendered by the browser. Native `<track>` rendering differs across tiers and never reaches XR. Safari 27 itself fixed "subtitles and closed captions not appearing in fullscreen video on iOS" and "WebVTT … cues that are larger than the viewport". One `SubtitleRenderer` (S10) draws:
  - a DOM layer over the video (desktop and mobile);
  - a `CanvasTexture` plane under the screen (Vision Pro, Quest fallback);
  - a rendered quad layer (Quest; crisp text via `renderer.xr.createQuadLayer(..., rendercall)` on the WebGL backend).
- **Parsing:** our VTT files are authored by our pipeline, so a ≤100-line parser for the subset `cue timing + text + <v Speaker>` is enough. An alternative on flat tiers is a hidden `TextTrack` (`mode = 'hidden'`) and its `cues` list (TextTrack and VTTCue are universal per BCD).
- **Sync:** choose the active cue from `requestVideoFrameCallback` `metadata.mediaTime` on element paths, or from the presented `VideoFrame.timestamp` on the WebCodecs path. For a concatenated sequence, shift each clip's cues by that clip's start offset in frames/24.
- **Where cues come from:**
  1. **Scripted dialogue.** The mission DSL's dialogue lines (TTS VO) are the authoritative cue text and timings.
  2. **SDH sound cues** by template per hook type (`[crowd roars]`, `[bass drops]`).
  3. **Generated audio QA.** H3 always generates a soundtrack (§1.1), and the fal samples contain sound at up to 0 dBFS. Run Workers AI `@cf/openai/whisper-large-v3-turbo` ($0.000513 per audio minute; returns "the transcription in WebVTT format") on `a.m4a` in the Workflow. If it finds words, set `audio.speechDetected = true` and hold publish for human review, which can approve with the Whisper VTT edited or swap to engine audio. Unscripted, unsubtitled speech would break R-ENG-04, and generated lyrics or speech carry IP and likeness risk (legal-ip-likeness).
- **Settings (S10):** Subtitles on/off (default **on** for cutscenes); size S/M/L/XL; background opacity; speaker names and colours; "Generated cutscenes" on/off (off means in-engine fallback always); "Cutscene audio" (generated / music-only).

---

## 7. Recommended CutscenePlayer design

### 7.1 R2 layout and the per-key manifest (C09 + C07 change)

C09 currently says `cutscenes/<sha256>.mp4` + poster. Replace that with a directory per key. The key derivation is unchanged (gamedesign §4.5, genai-pipeline-fal §2.2).

```
MEDIA_PRIVATE bucket (no public domain):
  cutscenes/<key>/orig.mp4            # fal bytes, unmodified; C2PA intact; provenance anchor
  cutscenes/<key>/probe.json          # ffprobe + c2pa validation output

MEDIA bucket → https://media.<domain>  (custom domain, CORS, Cache Rule "eligible, edge TTL 1y" for /cutscenes/*)
  cutscenes/<key>/manifest.json       # written LAST = the "ready" signal
  cutscenes/<key>/v768.mp4            # video-only CMAF fMP4, H.264 High L4.0, 1344×768, 24 fps, GOP 1 s
  cutscenes/<key>/v540.mp4            # 946×540, H.264 High L3.1
  cutscenes/<key>/v1080.mp4           # only when gen.params.resolution = 1080P (desktop tier)
  cutscenes/<key>/a.m4a               # AAC-LC 48 kHz stereo, −16 LUFS; absent if audio policy = engine
  cutscenes/<key>/poster.webp         # first frame (handoff frame for in-engine → video)
  cutscenes/<key>/last.webp           # last frame (hold frame for ping-pong / XR end)
  cutscenes/<key>/subs.en.vtt         # + subs.<lang>.vtt
```

```ts
// packages/engine/src/cutscene/types.ts — C09 CutsceneAsset (S03 owns; S05 writes)
export interface CutsceneManifest {
  schema: 'cutscene-asset/1';
  key: string;                        // sha256 hex (C09)
  recipe: 'cut@1';                    // transcode recipe version (not part of the key)
  fps: 24; frames: number;            // from ffprobe of orig; concatenation uses frames/fps, never container duration
  width: number; height: number;      // native 1344×768 for 768P
  video: Record<'v1080' | 'v768' | 'v540', { url: string; bytes: number; sha256: string; codecs: string; kbps: number } | undefined>;
  audio?: { url: string; codecs: 'mp4a.40.2'; lufs: number; speechDetected: boolean; approvedBy?: string };
  poster: string; last: string;
  subs: Record<string, string>;       // lang → url
  provenance: { endpoint: string; endpointUpdatedAt: string; falRequestId: string; origSha256: string;
                c2pa: 'valid' | 'valid-untrusted' | 'absent' | 'invalid'; aiGenerated: true };
  degraded?: true;                    // Media Transformations fallback output (no fMP4 → no MSE concat)
}
```

### 7.2 Where the transcode runs: steps added to the existing Workflow

The steps below extend `GenJobWorkflow` (genai-pipeline-fal §4.2) for `kind: 'cutscene'`. They replace its single `copy-to-r2` and `record` steps. `CutsceneJobDO.ensure()` (stack-cloudflare-backend) must test `cutscenes/<key>/manifest.json`, not `.mp4`.

```ts
// services/pipeline/src/cutscene/steps.ts (sketch)
import { Container, getContainer } from '@cloudflare/containers'; // 0.3.7 (npm 2026-06-04)
export class Transcoder extends Container { defaultPort = 8080; sleepAfter = '2m'; } // image: services/transcoder/Dockerfile (pinned ffmpeg)

// … after 'poll+result' in GenJobWorkflow.run():
await step.do('copy-orig', async () => {
  const f = await fetch(out.primaryUrl);                                  // fal CDN, ACAO *, accept-ranges
  await this.env.MEDIA_PRIVATE.put(`cutscenes/${j.cacheKey}/orig.mp4`, f.body, { httpMetadata: { contentType: 'video/mp4' } });
});
const probe = await step.do('probe+transcode', { retries: { limit: 3, delay: '20 seconds', backoff: 'exponential' } }, async () => {
  const c = getContainer(this.env.TRANSCODER, j.cacheKey);              // one instance per key; cold start 1–3 s
  const urls = await presignAll(this.env, j.cacheKey);                   // R2 S3-endpoint presigned GET (orig) + PUTs (outputs); 15 min
  const r = await c.fetch('http://transcoder/ladder', { method: 'POST', body: JSON.stringify({ recipe: 'cut@1', ...urls }) });
  if (!r.ok) throw new Error(`transcode ${r.status}`);
  return r.json() as Promise<ProbeResult>;                               // {frames, fps, w, h, audio:{present, lufs}, c2pa, sha256s, bytes}
});
const speech = await step.do('captions', async () => {
  if (!probe.audio.present) return { words: 0 };
  const audio = await (await this.env.MEDIA.get(`cutscenes/${j.cacheKey}/a.m4a`))!.arrayBuffer();
  const res: any = await this.env.AI.run('@cf/openai/whisper-large-v3-turbo', { audio: toBase64(audio), language: 'en', vad_filter: true });
  if (res?.vtt) await this.env.MEDIA_PRIVATE.put(`cutscenes/${j.cacheKey}/whisper.en.vtt`, res.vtt);
  return { words: (res?.text ?? '').trim().split(/\s+/).filter(Boolean).length };
});
await step.do('qa-gate', () => qaGate(this.env, j, probe, speech));      // frames within ±17 of request; black/frozen-frame check; lufs; C2PA present
await step.do('subs', () => writeScriptedVtt(this.env, j));               // from mission DSL lines; SDH template
await step.do('publish', () => this.env.MEDIA.put(`cutscenes/${j.cacheKey}/manifest.json`,
  JSON.stringify(buildManifest(j, probe, speech)), { httpMetadata: { contentType: 'application/json', cacheControl: 'public, max-age=31536000, immutable' } }));
await step.do('record', () => recordAsset(this.env, j, probe));           // Supabase row + provenance (legal-ip-likeness §2.3)
```

- **Speech:** if `speech.words > 0`, `qa-gate` writes the manifest with `audio.speechDetected = true` and *no* public `audio` URL until a reviewer approves (admin UI, S05). The clip plays with engine music meanwhile.
- **Container failure** after retries: run the Media Transformations binding (`frame` → poster; `video` 720p) and publish with `degraded: true`.
- **Batch prewarm on roster freeze:** `tools/media/transcode` runs the same image in CI over the CLI-generated originals and writes identical keys.
- **wrangler configuration:** the exact `containers` block keys (`class_name`, `image`, `instance_type: "standard-2"`, `max_instances: 4`) must be checked against the wrangler 4.151.1 schema in M00 (UNVERIFIED).

### 7.3 Player per tier

`CutscenePlayer` (S03, `packages/engine/src/cutscene/`) exposes:
- `prepare(ref) → Prepared | Fallback`
- `play(prepared, host) → Promise<'ended' | 'skipped' | 'failed'>`

The host is one of `dom-overlay`, `xr-media-layer`, `xr-texture` or `webcodecs-texture`. Audio always goes through the game `AudioContext` on a `cutscene` bus. The music bus is ducked by 12 dB, and SFX are muted.

| | **desktop** | **mobile (iPhone PWA)** | **xr-standalone (Quest 3/3S)** | **xr-pro (Vision Pro)** |
|---|---|---|---|---|
| Rendition | `v768` (`v1080` if present and the screen is ≥ 1440 px tall) | `v768` on Wi-Fi / `effectiveType` unknown; `v540` when Settings › Data saver is on or measured throughput < 4 Mbps | `v768` (compositor-sampled) | `v768` |
| Host, single clip | DOM overlay `<video src>` | DOM overlay `<video src>` (pre-unlocked pool element) | `XRMediaBinding.createQuadLayer(video, {space: local-floor, transform, width: 2.4, height: 2.4 × h/w})` in front of the projection layer | `webcodecs-texture`: `VideoDecoder` → `VideoFrameTexture` on a world-locked plane |
| Host, composed sequence | `MediaSource` in `sequence` mode in the same element | `ManagedMediaSource` (+ `disableRemotePlayback = true`) in `sequence` mode | `MediaSource` in `sequence` mode bound to the media layer's element | WebCodecs: decode clips back to back on one timeline |
| Fallback host | ping-pong elements | ping-pong elements → `webcodecs-texture` on the WebGPU canvas if `play()` rejects | `xr-texture` (`VideoTexture`, WebGL2 `texImage2D`) if `layers` was not granted | `xr-texture` from a pre-unlocked element |
| 3D loop during the cutscene | paused (no `render`) | paused | render the cinema scene only; `updateTargetFrameRate(72)` | render the cinema scene only |
| Subtitles | DOM layer | DOM layer (safe-area aware) | rendered quad layer below the screen | `CanvasTexture` plane below the screen |
| Audio | `a.m4a` → `AudioBufferSourceNode` | same; `navigator.audioSession.type = 'playback'` | same | same |
| Wake Lock | yes | **yes (required: muted video lets the screen sleep)** | n/a | n/a |
| Memory guard | — | ≤ 1 decoding + 1 pre-rolled element; release after `ended` | — | close every `VideoFrame` after upload |

**A/V sync (single and composed).**
- Decode `a.m4a` per clip with `decodeAudioData`: ≈ 5.8 MB of PCM per 15 s stereo at 48 kHz.
- Call `video.play()`. In the first `requestVideoFrameCallback`, map `metadata.expectedDisplayTime` to `AudioContext` time with `ctx.getOutputTimestamp()` (Safari iOS 14.5+, Chrome 57+, per BCD). Start clip *i*'s buffer at `t0 + Σ frames_j/24` for j < i.
- Every rVFC, compare `(ctx.currentTime − t0)` with `metadata.mediaTime`. Beyond ±45 ms, nudge `video.playbackRate` to 0.98 or 1.02 until within 15 ms. Seek only beyond 250 ms.
- On the WebCodecs path the audio clock is the master and frames are presented when `frame.timestamp ≤ audioTime`.

### 7.4 Concatenation strategy (fight intros: walk-in(s) + face-off)

1. **Compose on the client from a list of keys:** `[walkIn(P1, stage), walkIn(P2, stage), faceOff(P1, P2)]`. The per-pair-per-stage file stays rejected (gamedesign §4.5).
2. **Encoding invariants** make append-concatenation clean:
   - one recipe for every clip of a rendition: same width/height, profile/level, 24 fps and timescale;
   - closed 1 s GOPs, keyframe first;
   - video-only fMP4.
   - QA rejects any clip whose probe differs (e.g., a different H3 aspect ratio).
3. **(M)MSE:**
   - `ms = new (window.ManagedMediaSource ?? window.MediaSource)()`, `video.src = URL.createObjectURL(ms)`, `sb = ms.addSourceBuffer('video/mp4; codecs="avc1.640028"')`, `sb.mode = 'sequence'`.
   - Append clip 1, clip 2, clip 3 (≤ 3 × 2.8 MB at 768p), then `endOfStream()`.
   - On MMS, append after `startstreaming`. Handle `bufferedchange` evictions by re-appending from the in-memory `ArrayBuffer`s; keep them until `ended`.
   - Appending each clip's init segment again before its media segments is allowed by MSE when the configuration is unchanged.
4. **Audio** is scheduled in Web Audio at the exact frame offsets (§7.3), so it is gapless by construction, with no AAC priming issues. The 17 ms tail of each `a.m4a` is trimmed with `source.start(when, 0, frames/24)`.
5. **Ping-pong fallback** (no (M)MSE, or append error):
   - Pre-roll element B muted: `src = next`, `currentTime = 0`, wait for `loadeddata`.
   - When A's rVFC reports `mediaTime ≥ (framesA − 1)/24`, swap visibility (CSS `opacity`, or the texture source) and `B.play()`.
   - Expect a gap of 0–2 frames, masked by the hard cut. Show `last.webp` of A under B in the DOM path so a late B never shows black.
6. **XR:** the media layer is bound to one element, so use MSE (path 3) on Quest. Swapping elements would require destroying and creating layers mid-sequence.

### 7.5 Preload and caching rules

- **Stream by default.** Media is served from `media.<domain>` (R2 custom domain). Every object is `immutable` with a 1-year Cloudflare edge TTL through a Cache Rule. Cloudflare's default cached-extension list is not relied on, since `.vtt` and `.m4a` may not be on it.
  - The bucket CORS policy is `AllowedOrigins: [app origin(s)], AllowedMethods: [GET, HEAD], ExposeHeaders: [Content-Length, Content-Range, Accept-Ranges, ETag], MaxAgeSeconds: 86400`.
  - `Range` is a CORS-safelisted request header (single range; Fetch spec), so media range requests need no preflight.
  - Purge the hostname after any CORS change (R2 docs).
  - Never route media through a Worker: a Worker-generated 206 is never cached (stack-cloudflare-backend §1.2).
- **Prefetch windows:**
  - (a) Mission DSL `CutsceneRef` with `prefetch: 'onObjective' | 'onEnterTrigger'`: fetch `manifest.json`, `poster.webp` and `a.m4a`, and set `preload="auto"` on a pool element for `v*` when the player is ≤ 1 objective or ≤ 30 s from the beat.
  - (b) Culture Wars: when both fighters and the stage are confirmed (character select → stage select), `fetch()` all intro clips fully into `ArrayBuffer`s (≈ 3–8 MB at 768p; 1–3 MB at 540p) for MSE.
  - (c) Never prefetch more than 2 cutscenes ahead on `mobile`.
- **"Keep offline"** (Settings › Storage), as in stack-rendering-platform §6.5:
  - The service worker does `cache.add()` of the tier's rendition, `a.m4a`, `poster.webp` and the subs, as full `200` CORS responses (cached responses must be CORS-type to satisfy COEP).
  - A `CacheFirst` route for `request.destination === 'video' || 'audio'` with `RangeRequestsPlugin` (`workbox-range-requests@7.4.1`) slices the ranges. Workbox requires `crossorigin` on the media element, "even for same-origin URLs".
  - The MSE path reads the same cache via `caches.match()` before `fetch()`.
  - Cap: 300 MB on `mobile`, 1 GB elsewhere, LRU by last play. Show the size from `navigator.storage.estimate()`.
- **Never precache** cutscenes in the Workbox manifest: the 2 MiB default limit, and they are not shell assets.

### 7.6 Fallback triggers (R-CUT-03: the in-engine director sequence with the same subtitles)

| # | Trigger | Detection | Action |
|---|---|---|---|
| F1 | Asset not ready | `/api/v1/cutscenes/<key>` → `pending` or `absent`, or `manifest.json` 404 | in-engine now; `ensure()` queues generation (R-CUT-01) |
| F2 | Playback not permitted | `play()` rejects `NotAllowedError` (Low Power Mode, thermal, un-unlocked element) | mobile: retry once on `webcodecs-texture`; else show "Tap to play" for 3 s, then in-engine |
| F3 | Media error | `error` event (`MEDIA_ERR_*`), MSE `appendBuffer` exception, `VideoDecoder` error | ping-pong (for MSE) → in-engine |
| F4 | Start stall | no first frame (rVFC) within 2.5 s of `play()` (1.5 s if the bytes were prefetched) | in-engine; telemetry `cutscene.stall` |
| F5 | Mid-play stall | `waiting` > 1.5 s, or `currentTime` frozen for 1 s in XR | hold `last.webp` → finish with in-engine |
| F6 | Codec unsupported | `MediaSource.isTypeSupported` / `ManagedMediaSource.isTypeSupported` / `VideoDecoder.isConfigSupported` false | next path, then in-engine |
| F7 | Budget | `MemoryBudget` > 85 % on mobile, or XR frame p90 > budget × 1.15 for 2 s during the cutscene | drop to `v540`, then in-engine |
| F8 | Policy | likeness kill-switch removed the key from the manifest (R-NPC-04), region gate, or setting "Generated cutscenes: Off" | in-engine |
| F9 | Offline, not kept | `navigator.onLine === false` and no cache entry | in-engine |
| F10 | `degraded: true` and a composed sequence requested | manifest flag | play the degraded clips ping-pong, or in-engine for the face-off |

Every fallback emits `TelemetryEvent` `{name: 'cutscene.fallback', props: {key, trigger, tier, path}}` (C16; gap-observability-cost-guardrails).

### 7.7 Acceptance tests (M-spike before the cutscene milestone; S13 to place)

1. **Device matrix:** iPhone 15 / 16 / 17 on iOS 26.x and 27.x, as Home Screen app *and* Safari tab; Low Power Mode on and off; Quest 3 (Browser ≥ 152.1); Vision Pro (visionOS 26.2 and 27); Chrome and Safari desktop.
   - Each must pass: a single clip; a 3-clip composed sequence with a measured gap ≤ 1 frame (rVFC `presentedFrames` continuity) and A/V offset ≤ 45 ms; and an F2/F4 fallback in under 3 s.
2. **Isolation:** a Playwright test under COOP/COEP serves `v768.mp4` from the media domain with `crossorigin` and asserts `crossOriginIsolated === true` and playback. A second test removes the bucket CORS and asserts F3/F4 fallback, not a hang.
3. **Pipeline:** for 10 generated keys, `orig.mp4` C2PA is `Valid` and the renditions' `frames` equal the original's. Whisper runs, and a key with injected speech is held.
4. **Memory:** on iPhone 15, play 20 fight intros in a row inside the fighter mode with no jetsam. Telemetry shows `media` within 64 MB of the pre-cutscene baseline.

---

## Verified facts

| fact | source URL | date checked | confidence |
|---|---|---|---|
| H3 Turbo I2V and H3 Max Ref2V output schema is `{video: File{url, content_type?, file_name?, file_size?}, expanded_prompt?, timings?}` (+`seed` for Ref2V); no codec, bitrate, fps or audio-off input; `target_audio_url` replaces "the output soundtrack" | https://api.fal.ai/v1/models?endpoint_id=minimax/h3-max-turbo/image-to-video&expand=openapi-3.0 ; https://api.fal.ai/v1/models?endpoint_id=minimax/h3-max/reference-to-video&expand=openapi-3.0 | 2026-10-18 | high |
| Registry `updated_at`: Turbo I2V 2026-10-16T17:18:37Z; H3 Max Ref2V 2026-10-02T18:53:14Z; schema titles "TurboImageToVideoHailuo03Input" / "TurboReferenceToVideoHailuo03Input" | same | 2026-10-18 | high |
| fal sample outputs are MP4 (isom, Lavf58.76.100), H.264 Constrained Baseline L4.1, 1344×768, 24 fps, 124 frames for a 5 s request, 4.95–12.59 Mbps, keyframes every 2 s, colour tags unset | https://v3b.fal.media/files/b/0aa8e7f1/h6xLvyfV4xLB1a4m3ssje_minimax-h3.mp4 ; https://v3b.fal.media/files/b/0aa8f038/UcnQt_-5BsueASBEHTGEv_minimax-h3.mp4 ; https://v3b.fal.media/files/b/0aa91f5a/mMxt2Ga15hBB51PNsOdYo_minimax-h3.mp4 (linked from the fal model pages) | 2026-10-18 | high (measured; 3 samples) |
| x264 settings in all samples: `cabac=0 bframes=0 me=dia subme=0 aq=0 keyint=48 scenecut=0 crf=18.0` | same files (SEI user data) | 2026-10-18 | high (measured) |
| All samples carry AAC-LC 32 kHz stereo audio, ≈193–201 kbps, 5.184 s, non-silent (mean −10 to −23 dB; one peaks at 0.0 dB) | same files | 2026-10-18 | high (measured) |
| `moov` precedes `mdat`; a 13.4 KB C2PA `uuid` box (`d8fec3d6-1b0e-483c-9297-5828877ec481`) sits before `moov` | same files | 2026-10-18 | high (measured) |
| C2PA manifest: `c2pa.created`, `digitalSourceType` trainedAlgorithmicMedia, `softwareAgent` fal-ai/minimax-h3-turbo, `ai.fal.info {endpoint, request_id}`, `c2pa.hash.bmff.v3`; ES256, issuer "fal - Features & Labels Inc."; `validation_state` Valid with `signingCredential.untrusted` | same files, read with c2pa-python 0.38.0 | 2026-10-18 | high (measured) |
| The Ref2V model-page sample's C2PA endpoint is `fal-ai/minimax-h3-turbo/reference-to-video` | https://v3b.fal.media/files/b/0aa91f5a/mMxt2Ga15hBB51PNsOdYo_minimax-h3.mp4 | 2026-10-18 | high (what it says); its meaning UNVERIFIED |
| Re-encoding drops the C2PA manifest (`ManifestNotFound` on our transcode) | local test (scratchpad/s00cut_out/ladder/v768.mp4) | 2026-10-18 | high (measured) |
| fal CDN serves `accept-ranges: bytes`, `access-control-allow-origin: *`, `cache-control: public, max-age=5184000, immutable`, no CORP header | sample URLs above (response headers) | 2026-10-18 | high |
| fal: "Every piece of media generated through fal's hosted applications is signed with Content Credentials (C2PA)" and "embedded with an invisible watermark"; credentials may be removed "via editing, re-saving, compression" | https://fal.ai/verify | 2026-10-18 | high (statement); video watermark UNVERIFIED |
| x264 High/slow CRF 21 (5 Mbps cap) re-encode: 8.28→2.73 MB, 3.34→0.76 MB, 5.25→1.65 MB; SSIM(Y) 0.984; full ladder 22.3 s user + 1.5 s sys CPU for 5.2 s input | local measurement, ffmpeg 6.1.1 (scratchpad/s00cut_scripts/ladder.sh) | 2026-10-18 | high (measured; one machine) |
| Stream pricing: $5 per 1,000 min stored (prepaid), $1 per 1,000 min delivered; encoding and ingress free; delivery rounded to segment length, 4 s for uploads; preloading billable | https://developers.cloudflare.com/stream/pricing/ (updated 2026-10-15) | 2026-10-18 | high |
| Stream: "Manifests are dynamic assets … Do not cache, proxy, or store manifests" | https://developers.cloudflare.com/stream/viewing-videos/using-own-player/ | 2026-10-18 | high |
| Stream upload from URL (`/stream/copy`, `env.STREAM.upload(url)`); binding can `generateToken()` for signed URLs; binding launched 2026-05-07 | https://developers.cloudflare.com/stream/uploading-videos/upload-via-link/ ; https://developers.cloudflare.com/changelog/post/2026-05-07-stream-workers-binding/ | 2026-10-18 | high |
| Stream demo manifests and segments send ACAO `*`, `access-control-allow-headers: range`, no CORP; iframe page sends no COEP/CORP; HLS segments are fMP4 at 4.004 s, ABR ladder 240p–1080p | https://customer-f33zs165nr7gyfy4.cloudflarestream.com/6b9e68b07dfee8cc2d116e4c51d6a957/manifest/video.m3u8 (docs demo; header probe) | 2026-10-18 | high (probe of one demo video) |
| Media Transformations: input <100 MB, ≤10 min, origin needs HEAD + Range; `mode=video` outputs "H.264/AAC optimized MP4"; width/height 10–2000; duration 1–60 s; $0.50 per 1,000 unique transformations, 5,000 free, 1 per output second; binding unbilled while in beta | https://developers.cloudflare.com/stream/transform-videos/ ; https://developers.cloudflare.com/stream/transform-videos/bindings/ ; https://developers.cloudflare.com/stream/pricing/ | 2026-10-18 | high |
| Media Transformations Workers binding announced 2026-03-18 | https://developers.cloudflare.com/changelog/post/2026-03-18-media-transformations-workers-binding/ | 2026-10-18 | high |
| "Cloudflare Containers and Sandboxes are now generally available" (2026-04-13); Sep 2026 adds snapshot/restore and scheduling policy (beta) | https://developers.cloudflare.com/changelog/product/containers/ | 2026-10-18 | high |
| Container cold starts "often … 1-3 second range"; disk ephemeral; no built-in autoscaling | https://developers.cloudflare.com/containers/beta-info/ (updated 2026-10-05) | 2026-10-18 | high |
| Workflows: step wall clock unlimited; CPU 30 s default (configurable to 5 min); step result ≤1 MiB; 10,000 steps default | https://developers.cloudflare.com/workflows/reference/limits/ | 2026-10-18 | high |
| R2: $0.015/GB-month, Class A $4.50/M, Class B $0.36/M, egress free; free 10 GB-month, 1 M A, 10 M B | https://developers.cloudflare.com/r2/pricing/ (updated 2026-10-01) | 2026-10-18 | high |
| R2 custom domains return CORS headers when a bucket CORS policy exists; purge cache after CORS changes; only certain file types are cached by default | https://developers.cloudflare.com/r2/buckets/cors/ ; https://developers.cloudflare.com/r2/buckets/public-buckets/ | 2026-10-18 | high |
| Workers AI `@cf/openai/whisper-large-v3-turbo`: $0.000513 per audio minute; outputs "transcription in WebVTT format"; `vad_filter` option | https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/ | 2026-10-18 | high |
| iOS: muted video may autoplay; video with audio needs a gesture; unmuting without a gesture pauses; `playsinline` prevents auto-fullscreen on iPhone; hidden or detached elements need a gesture | https://webkit.org/blog/6784/new-video-policies-for-ios/ | 2026-10-18 | high |
| WebKit adds `RequireUserGestureForVideoDueToLowPowerMode` / `…AggressiveThermalMitigation` at element creation; these deny any video without a gesture; gesture-initiated `play()` removes them and the audio, load and invisible-autoplay restrictions for that element | https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/HTMLMediaElement.cpp ; https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/MediaElementSession.cpp | 2026-10-18 | high for `main`; medium for shipping iOS 26/27 |
| iOS: `VideoAudio` sessions have `ConcurrentPlaybackNotPermitted`; a muted `<video>` is classified `Video`; non-`VideoAudio` media lets the display sleep | https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/audio/ios/MediaSessionManagerIOS.mm ; HTMLMediaElement.cpp | 2026-10-18 | high for `main`; medium for shipping |
| ManagedMediaSource on iPhone since Safari 17.1; requires an AirPlay alternative or disabled remote playback | https://webkit.org/blog/14735/webkit-features-in-safari-17-1/ ; BCD 8.1.6 | 2026-10-18 | high |
| `MediaSource` "Exposed in Mobile Safari on iPad but not on iPhone"; Quest and Chrome have MediaSource, not ManagedMediaSource | https://github.com/mdn/browser-compat-data (8.1.6, 2026-10-15) | 2026-10-18 | high |
| ManagedMediaSource: the UA may evict buffered content "for any reason"; `streaming`, `startstreaming`/`endstreaming`, `bufferedchange` | https://w3c.github.io/media-source/ ; https://www.w3.org/TR/media-source-2/ (WD 2026-08-07) | 2026-10-18 | high |
| Safari 27.0: MSE "loosening the gap tolerance between buffered ranges"; fixed iOS fullscreen captions and oversized WebVTT cues; WebXR adds texture-array projection layers only | https://webkit.org/blog/18325/webkit-features-for-safari-27-0/ (2026-09-17) | 2026-10-18 | high |
| Safari 26.0: WebGPU shipped; detachable MediaSource; every Home Screen site opens as a web app | https://webkit.org/blog/17333/webkit-features-in-safari-26-0/ | 2026-10-18 | high |
| Wake Lock in Safari iOS 18.4; Home Screen web app bug 254545 RESOLVED FIXED; 26.1 "regression" comment retracted | BCD 8.1.6 ; https://bugs.webkit.org/show_bug.cgi?id=254545 | 2026-10-18 | high |
| BCD: `importExternalTexture`, `GPUExternalTexture` and `copyExternalImageToTexture` (incl. `VideoFrame` source) in Safari 26 / iOS 26, Oculus 32; rVFC Safari 15.4, Oculus 10; WebCodecs Safari 16.4, Oculus 18; `getOutputTimestamp` iOS 14.5; `playsinline` iOS 10 | BCD 8.1.6 | 2026-10-18 | high |
| BCD: `XRMediaBinding` (quad/cylinder/equirect) Oculus 16.1 only; `XRWebGLBinding.createQuadLayer` Chrome 147, Oculus 16.1, Safari false; `updateTargetFrameRate` Oculus 31.2 only | BCD 8.1.6 | 2026-10-18 | high (BCD lacks a visionOS column) |
| three r186 `VideoTexture` uses rVFC to flag updates; WebGPU backend uploads with `copyExternalImageToTexture` (try/catch, #32391); WebGL fallback uses `texImage2D`; `importExternalTexture` only on a path fed by XR textures | three@0.186.1 `src/textures/VideoTexture.js`, `src/renderers/webgpu/utils/WebGPUTextureUtils.js`, `WebGPUBindingUtils.js`, `webgl-fallback/utils/WebGLTextureUtils.js` | 2026-10-18 | high |
| three r186 has `VideoFrameTexture.setFrame(VideoFrame)` and example `webgpu_video_frame.html` with `three/addons/libs/demuxer_mp4.js`, which imports `mp4box@2.3.0` from cdn.jsdelivr.net | three@0.186.1 tarball; https://github.com/mrdoob/three.js/blob/r186/examples/webgpu_video_frame.html | 2026-10-18 | high |
| three r186 `XRManager` has no XRMediaBinding; it composes `session.renderState.layers` (unshift + updateRenderState); example `webxr_vr_layers.html` adds an `XRMediaBinding` equirect layer; `webgpu_xr_native_layers.html` uses `createQuadLayer` with `WebGPURenderer({forceWebGL: true})` | three@0.186.1 `src/renderers/common/XRManager.js`; https://github.com/mrdoob/three.js/tree/r186/examples | 2026-10-18 | high |
| Meta: media layers are created with `new XRMediaBinding(session)`; "any video will work, including cross-origin and streaming video"; the compositor samples video once | https://developers.meta.com/horizon/documentation/web/webxr-layers/ | 2026-10-18 | high |
| Oculus Browser 16.1 opened WebXR Layers (incl. media layers) to all users (blog 2021-06-29) | https://developers.meta.com/vr/blog/achieve-better-rendering-and-performance-with-webxr-layers-in-oculus-browser/ | 2026-10-18 | high |
| Quest Browser 152.1 (2026-10-02) "Experimental WebGPU composition layers"; 150.1 enables MV-HEVC playback | https://developers.meta.com/horizon/release-notes/web/ | 2026-10-18 | high |
| WebXR Layers ED: `XRMediaBinding.createQuadLayer(HTMLVideoElement, XRMediaQuadLayerInit{space, layout="mono", invertStereo, transform?, width?, height?})`; width and height in metres | https://immersive-web.github.io/layers/ | 2026-10-18 | high |
| `range` is a CORS-safelisted request header (single range value) | https://fetch.spec.whatwg.org/ | 2026-10-18 | high |
| Workbox: serving cached media needs `RangeRequestsPlugin`, a full (non-206) cached response added ahead of time, and `crossorigin` "even for same-origin URLs" | https://developer.chrome.com/docs/workbox/serving-cached-audio-and-video | 2026-10-18 | high |
| Chrome: "Muted autoplay is always allowed" | https://developer.chrome.com/blog/autoplay | 2026-10-18 | high |
| npm: `@cloudflare/containers` 0.3.7 (2026-06-04), `workbox-range-requests` 7.4.1, `mp4box` 2.4.1 (BSD-3-Clause), `mediabunny` 1.61.6 (MPL-2.0), `hls.js` 1.7.3 | https://registry.npmjs.org/ | 2026-10-18 | high |
| Video textures freezing after entering WebXR is reported on headsets (Quest/Pico) | https://discourse.threejs.org/t/video-texture-no-longer-updating-after-entering-webxr-mode/43068 ; https://note.com/sawa_zen/n/nc055e9ebedea | 2026-10-18 | low (community reports) |

## Unverified

- H3 **1080P** output dimensions, bitrate and encoder settings (no 1080P sample was probed). Also whether production outputs for *our* parameters (768P, `prompt_expansion_mode: disabled`, keyframe-first) match the marketing samples' encoder settings. fal can change its encoder at any time, so the probe step must validate every output.
- Whether `minimax/h3-max/reference-to-video` is served by a Turbo backend (inferred from the C2PA endpoint string and the schema title).
- Whether fal's **invisible watermark** is applied to video (the verify page lists only image upload types).
- Shipping iOS 26.x/27.x behaviour of the WebKit `main` rules used here: Low Power Mode and thermal gesture restrictions, per-element unlock surviving `src` changes, and no concurrent audible video. Device tests are required (§7.7).
- `ManagedMediaSource` on visionOS Safari; `SourceBuffer.mode = 'sequence'` on `ManagedSourceBuffer` on iPhone (BCD's `SourceBuffer.mode` iOS row is "partial: iPad only").
- Progressive playback of fragmented (CMAF) MP4 through `<video src>` on iOS 26 (expected to work; not tested on a device).
- Media decode memory on iPhone (the 12–25 MB per element estimate) and the GPU-process jetsam limit.
- `copyExternalImageToTexture` cost per 768p frame on A16–A19 GPUs.
- `requestVideoFrameCallback` firing and `<video>` decoding while an immersive session is active on Quest Browser 152.1 and visionOS 26.2/27.
- Vision Pro WebXR session frame-rate control (no `updateTargetFrameRate` in BCD Safari).
- Whether Stream's iframe player is blocked in a COEP `require-corp` page in practice (spec inference), and whether Safari's native HLS fetches Stream segments in CORS mode under COEP.
- The exact Stream delivery-minute rounding for clips shorter than two segments.
- Media Transformations output encoding parameters (profile, bitrate, GOP, faststart, fMP4) are undocumented.
- wrangler 4.151.1 `containers` configuration keys and `@cloudflare/containers` API details beyond `Container`/`getContainer` (check against the package README in M00).
- Web Audio vs video drift over 15 s on each target, and the ±45 ms nudge policy's audibility.
- Comfort geometry for 2D video in XR (≈44° FOV screen, 300 ms fades): recommendations only, not checked against Meta or Apple guidance this session.

## Recommendations for the spec

1. **C09 (S03, with S05):** change `CutsceneAsset` from `cutscenes/<sha256>.mp4` to the directory layout and `CutsceneManifest` in §7.1. Readiness = `manifest.json` exists. `CutsceneJobDO.ensure()` checks that object.
2. **S05 pipeline:** add the Workflow steps in §7.2: `copy-orig` → `probe+transcode` (Container) → `captions` (Whisper) → `qa-gate` → `subs` → `publish` → `record`. Keep `orig.mp4` in a private bucket. Fail the step if the probe shows a codec other than H.264, fps ≠ 24, a missing C2PA manifest, or `frames` outside the request ±0.75 s.
3. **S05:** adopt recipe `cut@1` (§2.4) as `services/transcoder/` (Dockerfile with a pinned ffmpeg build plus a 50-line HTTP wrapper) and the identical `tools/media/transcode` CLI. Instance type `standard-2`, `max_instances: 4`, `sleepAfter: '2m'`. Do not use Cloudflare Stream. Use Media Transformations only as the `degraded` fallback.
4. **S05/legal:** record `provenance.c2pa`, `falRequestId` and `origSha256` for every cutscene (legal-ip-likeness §2.3). Label generated cutscenes "AI-generated" in Credits and in the cutscene pause menu (MiniMax AUP item 12, genai-pipeline-fal §6). Re-signing renditions with C2PA is an ADR (Q-CUT-04).
5. **S09:** media origin is `media.<domain>` (R2 custom domain). Bucket CORS: `GET, HEAD`; `ExposeHeaders: Content-Length, Content-Range, Accept-Ranges, ETag`. Add a Cache Rule "eligible for cache, edge TTL 1 year" on `/cutscenes/*`. Every object gets `Cache-Control: public, max-age=31536000, immutable`. No Worker in the media path. Clients never receive fal URLs.
6. **S03 player:** implement `CutscenePlayer` with the four hosts in §7.3. Every `<video>`: `muted playsinline disableRemotePlayback crossorigin="anonymous"`. Cutscene audio only via the game `AudioContext` (`a.m4a` + `AudioBufferSourceNode`), with music ducked by 12 dB.
7. **S10/S03:** unlock a pool of **3** `<video>` elements and the `AudioContext` in the title screen's first gesture. Do not create cutscene video elements later. Reuse the pool for in-world video textures.
8. **S11 (C13):** rendition per tier = desktop `v768`/`v1080`, mobile `v768` (`v540` on data saver or < 4 Mbps), xr-standalone `v768` media layer, xr-pro `v768` WebCodecs texture. Pause the 3D render loop under DOM cutscenes. In XR render only the cinema scene. Set Quest `updateTargetFrameRate(72)` during cutscenes. Add a 64 MB `media` line to the mobile memory budget.
9. **S03:** compose fight intros with (Managed)MediaSource in `sequence` mode on all element tiers, with ping-pong as fallback, and a WebCodecs timeline on xr-pro. Audio is scheduled by frame offsets (`frames/24`) from the manifest. Pass/fail is the gap and sync criteria in §7.7.
10. **S03:** XR media layer on Quest: request optional feature `layers` (already in stack-rendering-platform §4.2). After session start, `new XRMediaBinding(session).createQuadLayer(video, {space: localFloor, transform, width: 2.4, height: 2.4 * h / w})`, inserted after the projection layer. Remove the layer and restore the frame rate on end. Fall back to `VideoTexture` when `layers` is not granted.
11. **S01/S03:** for every `VideoTexture` in XR, set `needsUpdate` also when `video.currentTime` advanced since the previous XR frame (rVFC stall workaround). Create elements before `requestSession`.
12. **S01:** vendor `mp4box@2.4.1` into the bundle for the WebCodecs path. Never import from a CDN at runtime: COEP, plus R-ENG-01 deterministic builds.
13. **S10 (R-ENG-04):** one `SubtitleRenderer` for video and in-engine cutscenes, driven by WebVTT and rVFC/`VideoFrame` timestamps. Settings: on by default, 4 sizes, background opacity, speaker names. "Generated cutscenes" and "Cutscene audio" toggles.
14. **S05 (R-ENG-04 + IP):** run Whisper on every generated audio track. Any detected words hold publish (`speechDetected`) until a human approves the VTT or the audio is replaced by engine music. Prompts for keyed cutscenes ask for "no dialogue, no singing, no lyrics" (prompt template, genai-pipeline-fal §2.1).
15. **S01/S11:** request Wake Lock for the duration of any cutscene (mobile) and re-acquire on `visibilitychange`. Pause and offer "Resume" on interruption.
16. **S03:** implement fallback triggers F1–F10 (§7.6) with the stated thresholds and `cutscene.fallback` telemetry. The in-engine director sequence reuses the same VTT cues.
17. **S09/SW (stack-rendering-platform §6.5):** "Keep offline" stores the tier rendition, `a.m4a`, the poster and subs as full 200 CORS responses. A `CacheFirst` route plus `RangeRequestsPlugin` serves them. Cap 300 MB on mobile with LRU eviction. Never precache cutscenes.
18. **S13:** add an M-spike "cutscene playback" before the cutscene milestone with the device matrix and tests in §7.7, including Low Power Mode on iPhone and a COEP Playwright test.

## Risks

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| RISK-CUT-01 | Black screen on iPhone in Low Power Mode or thermal mitigation: even muted `play()` is denied | M | H | gesture-unlocked element pool (rec 7); F2 → WebCodecs on the canvas → in-engine |
| RISK-CUT-02 | Second audible video pauses the first on iOS; audio gaps at clip joins | H if audio stays in `<video>` | M | muted video plus Web Audio (rec 6) |
| RISK-CUT-03 | MSE/MMS concatenation stalls on Safari 26.x (27.0 changed the gap tolerance); MMS evicts buffered data mid-play | M | M | identical-recipe fMP4, `sequence` mode, re-append on `bufferedchange`, ping-pong fallback, device tests |
| RISK-CUT-04 | XR video texture freezes after session start (Quest/Pico reports) | M | M | media layer on Quest, pre-created elements, `currentTime` poll, F5 |
| RISK-CUT-05 | Frame-rate collapse in XR if the city keeps rendering behind the screen, or with 4 MB per-frame uploads on Vision Pro without multiview | M | H (comfort) | cinema-only scene, 24 Hz uploads, Quest 72 Hz, F7 |
| RISK-CUT-06 | fal changes encoder, resolution or audio behaviour silently (registry pages updated 2026-10-16) | M | M | probe gate (rec 2); recipe normalises everything; manifest records the probe |
| RISK-CUT-07 | Provenance loss: renditions lack C2PA; a regulator or platform asks for machine-readable marking | L (US-only v1) | M | keep `orig.mp4` plus the provenance record; C2PA re-sign ADR; visible "AI-generated" label |
| RISK-CUT-08 | Generated soundtrack contains unscripted speech or lyrics, so it is unsubtitled (R-ENG-04) or infringing | M | M | Whisper gate, human approval, engine-music replacement, prompt rules |
| RISK-CUT-09 | COEP or CORS misconfiguration makes media fail without a useful error | M | H | Playwright isolation tests, CORS purge procedure, F3/F4 |
| RISK-CUT-10 | iPhone memory: video decode plus WebGPU scene plus MMS buffers lead to a jetsam | L–M | H | DOM overlay, pool of 3, release after `ended`, 64 MB media budget, F7 |
| RISK-CUT-11 | Container dependency: cold start, capacity or an outage blocks new cutscenes | L | L | the game never blocks (R-CUT-03); Media Transformations `degraded` path; CLI batch prewarm |
| RISK-CUT-12 | Media Transformations binding pricing changes at GA (per operation, not per unique) | M | L | fallback-only use; outputs stored in R2 |
| RISK-CUT-13 | 1.75:1 clips on a 19.5:9 iPhone or a 2.4 m XR screen look letterboxed or soft at 768p | M | L | `object-fit: contain`, `v1080` for desktop, art direction frames for 1.75:1 |

## Open questions

- **Q-CUT-01 (owner/creative):** keep H3's generated soundtrack for story cutscenes, or always replace it with engine music, SFX and VO? This decides whether `a.m4a` is shipped at all and how much Whisper review is needed.
- **Q-CUT-02 (S03):** fight-intro order and length: walk-in P1 + walk-in P2 + face-off (≈15 s) or one shared walk-in shot? This changes clip count (gamedesign §4.5) and the prefetch volume.
- **Q-CUT-03 (S11):** should desktop get `v1080` (1080P costs 2× at fal; genai-pipeline-fal) or upscale 768p? This needs a probe of a 1080P output first.
- **Q-CUT-04 (legal):** must renditions carry our own C2PA claim (orig as ingredient), and may `orig.mp4` be offered for verification? It contains fal's `request_id`.
- **Q-CUT-05 (S11):** on Vision Pro, is the in-scene cinema enough, or should a cutscene end the immersive session and use visionOS's native docked video player? Re-entry then requires a fresh pinch (transient activation). Prototype both in the spike.
- **Q-CUT-06 (S10):** which subtitle languages ship in v1 (VTT per language per clip; Whisper `translate` only gives English)?
- **Q-CUT-07 (S09):** a separate private R2 bucket for `orig.mp4`, or a private prefix protected by WAF? (Custom-domain buckets are public per bucket.)
- **Q-CUT-08 (S05):** do user-NPC cutscenes (R-NPC-03) run the same Whisper/human gate, or does user content need a stricter moderation queue before publish (legal-ip-likeness §5)?
