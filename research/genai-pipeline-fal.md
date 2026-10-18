# genai-pipeline-fal: cutscene video (MiniMax H3), character sheets, image-to-3D, rigging, voice and music on fal.ai

Research dimension `genai-pipeline-fal` (S00). Checked 2026-10-18. This report builds on `research/stack-cloudflare-backend.md` §1.5 (Workflows/Queues limits), §6 rows "Cutscene cache" and "Job orchestration", §10 (webhook → Workflow pattern) and `research/gamedesign-decomposition.md` §4.5 (C09 cutscene cache keys and clip counts), and on spec requirements R-CUT-01..03, R-NPC-02..05, R-ENG-03, R-IP-02 in `spec/00-plan.md`. It does not repeat them. Owner updates (`research/owner-updates.md`) apply: San Francisco first, so every story/fighter/racing cutscene in v1 is SF-only.

**Method.** Endpoint ids, input schemas and license types come from fal's public model registry (`GET https://api.fal.ai/v1/models?endpoint_id=<id>&expand=openapi-3.0`, no key needed). Prices come from each model page (`https://fal.ai/models/<id>` and `https://fal.ai/models/<id>/llms.txt`). fal's pricing API (`/v1/models/pricing`) needs a key, so prices are the published page text, not account quotes. Platform behaviour comes from fal docs (`https://fal.ai/docs/...`). Vendor policy comes from vendor pages. Raw downloads are in the scratchpad (`s00fal_data/`). Search-engine summaries were used only to find primary pages. Where only a secondary source exists, the fact is marked medium or low confidence, or listed as UNVERIFIED.

---

## 0. Headline

1. **"Minimax H3 Max Turbo" is a real fal product.** The ids are `minimax/h3-max-turbo/text-to-video`, `minimax/h3-max-turbo/image-to-video` and `minimax/h3-max-turbo/extend-video`. It is fal's distilled, post-trained variant of the open-weights MiniMax H3. It renders 480P/768P/1080P clips of 0.92–15 s. List price is $0.04/s at 768p; a 35% promo ($0.026/s) ends Oct 31, 2026. fal measured 1.54 s of inference for a 5 s 768p clip. **Turbo has no reference-to-video mode.** Character-consistent multi-subject shots need `minimax/h3-max/reference-to-video` (≤9 reference images, $0.08/s at 768p), or a keyframe-first pipeline: a GPT Image 2.5 keyframe, then Turbo image-to-video with first and last frames.
2. **"OpenAI Sunburst" is GPT Image 2.5 Sunburst.** On fal the ids are `openai/gpt-image-2.5/sunburst/text-to-image` and `openai/gpt-image-2.5/sunburst/edit`. On OpenAI the id is `gpt-image-2.5-sunburst`, snapshot `-2026-09-08`. The edit endpoint takes ≤16 reference images and five quality levels. A 2560×1440 sheet at `high` costs ≈ $0.055.
3. **Mesh → T-pose → rig → animation is available on fal end to end.** `meshy/v7.1/multi-image-to-3d` has `pose_mode: "t-pose"`, `target_polycount` 100–300k, PBR, and optional built-in rigging (+$0.20) and animation (+$0.12/clip). `fal-ai/meshy/rigging` and `fal-ai/meshy/rigging/multi-animation` rig any humanoid GLB, including meshes from Hunyuan, Trellis or Tripo. Library ids run 0–696. Steps that still need a human or Blender: likeness approval, best-of-N choice, failed rigs (accessories, hands), facial and viseme rigs, and fighter frame-data animation.
4. **Costs are small. The licence is the blocker.** At list prices, a Standard character (sheet + 3D + rig + 5 clips) costs ≈ $3.73, so 60 NPCs cost ≈ $224. A 15 s cutscene costs ≈ $1.06 (Turbo, keyframe-first) to $1.80 (H3 Max reference), so 100 cutscenes cost ≈ $106–$196. The full 222-clip fighter set (N=12) costs $67–$133.
5. **Blocking legal finding (primary source).** The MiniMax H3 Community License excludes the **United States**, EU, UK and Korea from its territory. It covers Model Derivatives and use "through any Hosted Services". fal describes H3 Max as a post-trained variant of H3. fal ToS §4(b) also requires End Users to be **18+** and forbids exposing fal APIs directly to End Users. **The spec must gate H3 Max/Turbo behind written confirmation from fal (ADR) and keep the video provider swappable.**

---

## 1. Owner model names → real endpoint ids

| Owner's name | Real product (verified) | Exact fal endpoint ids | Notes |
|---|---|---|---|
| "Minimax H3 Max Turbo" | **H3 Max Turbo**, fal Research's distilled variant of H3 Max. H3 Max is fal's post-train of open-weights MiniMax H3. fal registry group `hailuo-03-new-max-turbo`; first registry date 2026-09-02. | `minimax/h3-max-turbo/text-to-video`, `minimax/h3-max-turbo/image-to-video`, `minimax/h3-max-turbo/extend-video` | No reference-to-video, lip-sync or camera-control variant exists under `h3-max-turbo`. Those exist only under `minimax/h3-max/*`. fal hosts the model itself (`provider_type: fal`, `is_partner_api: false`). |
| (sibling) "H3 Max" | Non-distilled fal post-train | `minimax/h3-max/{text-to-video, image-to-video, reference-to-video, lip-sync/image-to-video, camera-controls, extend-video, insert-video, 3d-to-video, recast, relight, reference-director}` | `reference-director` is in category "worlds" (real-time interactive). Its schema is not public. |
| (base) "MiniMax H3" | MiniMax's own model through MiniMax's hosted API (`is_partner_api: true`) | `minimax/h3/{text-to-video, image-to-video, reference-to-video}`, plus `/lora` variants with trainers `minimax/h3/i2v/trainer` and `minimax/h3/flf2v/trainer` | Renders up to 2K/4K. 768p costs $0.06/s. Possibly a cleaner licence path (see §6.2). |
| "OpenAI Sunburst" | **GPT Image 2.5 Sunburst**, OpenAI's precision tier, released 2026-09-08 with sibling **Flare** (the faster default) | `openai/gpt-image-2.5/sunburst/text-to-image`, `openai/gpt-image-2.5/sunburst/edit`; siblings `openai/gpt-image-2.5/flare/{text-to-image, edit}` | fal proxies OpenAI (`hostingType: proxy`, partner API), so OpenAI usage policies apply on top of fal's (fal ToS §14(b)). OpenAI's model page describes Sunburst as for "workflows where editing precision matters most". |

Older MiniMax endpoints remain live but are superseded for this project: `fal-ai/minimax/hailuo-2.3/pro/image-to-video` ($0.49/video), `fal-ai/minimax/hailuo-2.3-fast/pro/image-to-video` ($0.33/video), `fal-ai/minimax/hailuo-02/*` and `fal-ai/minimax/video-01*`.

---

## Endpoint catalog

All endpoints listed below are `status: active` and `license_type: commercial` in the fal registry on 2026-10-18 (63/63 published endpoints checked). Prices are fal list prices. "Latency" is vendor-published where it exists; otherwise UNVERIFIED and to be measured in the M00 spike with fal's analytics API (`prepare_duration` = queue time, `duration` = execution time).

### A. Video — MiniMax H3 family (cutscenes)

| Endpoint id | Mode | Price (USD) | Limits / key inputs | Latency (fal-published, inference only) |
|---|---|---|---|---|
| `minimax/h3-max-turbo/text-to-video` | T2V | 480P $0.025/s · **768P $0.04/s** · 1080P $0.08/s list. Promo −35% ($0.01625 / $0.026 / $0.052) ends **Oct 31, 2026**. | `prompt` ≤ 50,000 chars; `duration` 0.92–15 s (output can run ≈0.7 s longer); `resolution` 480P/768P/1080P (1080P = latent refinement of a native 768P); `aspect_ratio` 21:9/16:9/4:3/1:1/3:4/9:16; `prompt_expansion_mode` `disabled` / `balanced` (≈1 s) / `quality` (≤≈30 s); `target_audio_url` (≥2 s, ≤15 MB) pins a soundtrack; `seed`; `enable_safety_checker` (default true); `sync_mode` | 5 s: 0.44 s (480p), 1.54 s (768p), 2.33 s (1080p); 15 s: 1.71 / 8.44 / 13.56 s |
| `minimax/h3-max-turbo/image-to-video` | I2V | same as T2V | as T2V plus `image_url` (first frame, sets canvas) and `end_image_url` (last frame; usable alone) | as above (UNVERIFIED for I2V specifically) |
| `minimax/h3-max-turbo/extend-video` | V2V extend | per *new* second: $0.025 (480p), $0.04 (768p), $0.08 (1080p), $0.16 (2K) | `video_url` 1.625–60 s, ≤50 MB, aspect 0.4–2.5; adds 0.71–15 s; `output` `extended` or `continuation` (continuation starts with a 1.625 s repeat); ≤3 `reference_audio_urls` (2–15 s each, ≤15 s total); up to 2K | UNVERIFIED |
| `minimax/h3-max/text-to-video` | T2V | list $0.05 / **$0.08** / $0.16 per s (480/768/1080). Promo $0.0325 / $0.052 / $0.104 until Oct 31. | same schema as Turbo T2V | 5 s 768p 2.46 s; 15 s 1080p 17.63 s |
| `minimax/h3-max/image-to-video` | I2V | as H3 Max T2V | first/last frame | UNVERIFIED |
| **`minimax/h3-max/reference-to-video`** | Ref2V (subject-consistent) | **$0.05 / $0.08 / $0.16 per s**. 4,096 reference tokens included; a square reference image = 1,024 tokens, so 4 square images are free; extra tokens $0.02/1k (≈ $0.02 per extra square image). A 5 s 768p clip with ≤4 refs = $0.40. | `reference_image_urls` ≤ 9 (cited as "Image 1…"); `reference_video_urls` ≤ 3 (2–15 s each, ≤15 s total); `reference_audio_urls` ≤ 3; ≤ 12 files total, or an ordered `reference_conditions` (≤12); optional `image_url` first, `middle_image_url` + `middle_frame_time` (24 fps rounding; 480P/768P only) and `end_image_url`; `aspect_ratio` adds `adaptive`; 0.92–15 s; output includes `seed` | UNVERIFIED |
| `minimax/h3-max/lip-sync/image-to-video` | image + audio → talking clip | $0.05 / $0.08 / $0.16 / $0.32 per s (480p / 768p / 1080p / 2K); ×1.2 above 15 s (30 s at 768p = $2.88) | optional transcription guidance | UNVERIFIED |
| `minimax/h3-max/camera-controls` | single image → keyframed orbit/elevation/distance | list $0.08/s at 768p (promo $0.052) | keyframe camera path | UNVERIFIED |
| `minimax/h3-max/3d-to-video` | Blender/previs render → photoreal | $0.08/s at 768p, min 5 s, plus reference tokens; auto-generates ≤2 refs at ≈$0.02–0.04 each. fal's example: 5 s 768p ≈ $0.96. | source clip drives layout, camera and timing | UNVERIFIED |
| `minimax/h3-max/extend-video` | extend | $0.08/s at 768p; 2K $0.32/s; ref tokens as Ref2V | — | — |
| `minimax/h3-max/insert-video` | insert a scene | $0.05/s (480p), $0.06/s (768p) for the new scene only | — | — |
| `minimax/h3-max/recast` | replace people via reference photos | $0.30/s (768p), $0.45/s (1080p) | **likeness-swap tool: ban in this project** | — |
| `minimax/h3-max/reference-director` | real-time "worlds" | billing unit seconds, base $0.05 | schema not public (`endpoint_id` lookup returns not found) | — |
| `minimax/h3/text-to-video` / `image-to-video` | MiniMax partner API | $0.05 (480p), **$0.06 (768p)**, $0.13 (2K), $0.16 (4K) per s | T2V: 2K, 5–15 s, 7 aspect ratios | UNVERIFIED |
| `minimax/h3/reference-to-video` | MiniMax partner Ref2V | as above; first 5 refs free, then $0.08/image | ≤9 images, ≤3 videos, ≤3 audio | UNVERIFIED |

**Fallback video models** (one per vendor family; all commercial on fal):

| Endpoint id | Price | Limits | Why consider |
|---|---|---|---|
| `google/gemini-omni-flash/v1.1/reference-to-video` | $0.03/s (360p), **$0.10/s (720p)**, $0.15/s (1080p), $0.30/s (4K) | 3–10 s; 16:9 or 9:16; ≤10 `image_urls`; ≤3 reference videos ≤3 s each | Cheapest strong reference model; "characters retaining their face, clothing, and voice" (vendor claim) |
| `fal-ai/kling-video/o3/pro/reference-to-video` | $0.112/s (audio off), $0.14/s (audio on) | 3–15 s; 16:9/9:16/1:1; `elements` (@Element1…) with optional bound `voice_id`; 1–3 extra angle refs per element; ≤4 elements + images when using video | Element-bound identity and voice suit fighter face-offs |
| `fal-ai/kling-video/v3/turbo/standard/image-to-video` | $0.112/s | — | Cheap Kling I2V |
| `bytedance/seedance-2.5/us/reference-to-video` | ≈$0.2205/s (480p), $0.473/s (720p), $1.164/s (1080p); token formula `h·w·(in+out s)·24/1024` | **US-hosted**; ≤30 images, 10 videos, 10 audio; 4–30 s | Longest clips and US hosting; 4–10× the price |
| `bytedance/seedance-2.0/mini/reference-to-video` | ≈$0.0721/s (480p), $0.1547/s (720p) | — | Budget reference model |
| `lightricks/ltx-2.5/image-to-video/fast` | $0.09/s (720p), $0.13 (1080p), $0.19 (1440p), $0.30 (4K) | 6–20 s at 24/25 fps; native audio; "open-source audio-video model" | Open-model path (licence UNVERIFIED) |
| `alibaba/wan-3.0/{image,reference}-to-video` | $0.05 (480p), $0.10 (720p), $0.20 (1080p) per s | — | Low cost |
| `fal-ai/veo3*` | **deprecated on fal** | — | Do not use |

### B. Image — character reference sheets and keyframes

| Endpoint id | Price | Reference support / limits | Notes |
|---|---|---|---|
| **`openai/gpt-image-2.5/sunburst/edit`** ("OpenAI Sunburst") | Tokens: text in $5/M (cached $1.25), image in $8/M (cached $2), image out $30/M (OpenAI Batch $15/M). fal canonical table (incl. one input image), high / xhigh / max: 1024×1024 **$0.05268** / $0.09366 / $0.21072; 1024×1536 $0.04116 / $0.07377 / $0.16464; 1920×1080 $0.03960 / $0.07041 / $0.15840; 2560×1440 **$0.05529** / $0.09828 / $0.22110; 3840×2160 $0.10008 / $0.17790 / $0.40026. Low and medium are 4–10× cheaper. | `image_urls` **≤16**; `mask_url`; `num_images` 1–10; `quality` auto/low/medium/high/xhigh/max (default high); `background` transparent/opaque/auto; `prompt` ≤32,000 chars; `image_size` auto or custom; png/jpeg/webp. OpenAI: edges ≤3840 px, total 655,360–8,294,400 px, sizes above 2560×1440 "experimental"; `moderation` auto/low. | Best fit for multi-view turnaround sheets that keep identity across edits. Latency UNVERIFIED (a third-party benchmark reports ≈27.7 s at high, vs 19.7 s for Flare). |
| `openai/gpt-image-2.5/sunburst/text-to-image` | same tokens | text-only | For style bibles and environment keyframes |
| `openai/gpt-image-2.5/flare/{text-to-image,edit}` | same token prices | as Sunburst | Faster; use for drafts and keyframes |
| `openai/gpt-image-2`, `/edit` | same token prices | — | Previous generation |
| `google/nano-banana-2.1/edit` | 1K **$0.044**, 2K $0.063, 4K $0.138 (with two 1K inputs); each extra input ≈1,120 tokens ≈ $0.002 | many inputs (fal's example cites 14); `resolution` 1K/2K/4K; extreme aspect ratios (4:1, 8:1); `thinking_level` | **Lean-tier sheet model**; also takes video or PDF context |
| `fal-ai/nano-banana-pro/edit` | $0.15/image (4K ×2) | — | — |
| `blackforestlabs/flux-3/edit-image` | $0.048/MP | — | Released 2026-10-01 |
| `bytedance/seedream/v5/pro/edit` | $0.0675/image ≤1536²; $0.135 ≤2048²; +$0.0045 per extra input | — | — |
| `alibaba/qwen-image-3/edit` | $0.04 (1K), $0.075 (2K) | — | — |
| `fal-ai/qwen-image-edit-2511-multiple-angles` | $0.035/MP | novel-view generation from one image | Cheap way to make missing turnaround views |

### C. 3D — image/multi-view → mesh

| Endpoint id | Price | Inputs | Output / topology | T/A-pose control | Latency |
|---|---|---|---|---|---|
| **`meshy/v7.1/multi-image-to-3d`** | $0.80 untextured; **$1.20 textured**; +$0.20 rig; +$0.12 per animation call. Textured + rig + animation = $1.52. | `image_urls` 1–4 views of the same object; `texture_prompt` ≤600 chars; `texture_image_url` | GLB plus `model_urls` (glb, fbx, obj, usdz, stl, blend); `target_polycount` 100–300,000 (default 30,000); `topology` quad/triangle; `should_remesh`; `symmetry_mode`; `enable_pbr` (metallic, roughness, normal); `geometry_resolution` standard/2k | **`pose_mode`: `t-pose` / `a-pose`** | UNVERIFIED (Meshy FAQ: Meshy 6 took 1–2 min) |
| `meshy/v7.1/image-to-3d` | same | single image | same | same | — |
| `fal-ai/hunyuan-3d/v3.1/pro/image-to-3d` | $0.375 base; +$0.15 PBR; +$0.15 multi-view; +$0.15 custom face count | front image (128–5000 px, ≤8 MB) plus optional back/left/right/left-front/right-front/top/bottom views | obj/mtl/glb/usdz/fbx; `face_count` 40k–1.5M (default 500k); `generate_type` Normal/Geometry | none (follows input pose) | UNVERIFIED |
| `fal-ai/hunyuan-3d/v3.1/rapid/image-to-3d` | $0.225; +$0.15 PBR | — | — | none | ≈2–3 min (third-party, low confidence) |
| `fal-ai/hunyuan-3d/v3.1/smart-topology` | $0.75 | mesh | retopology | — | — |
| `tripo3d/h3.1/multiview-to-3d` | $0.20 untextured / $0.30 standard / $0.40 HD textures; +$0.20 detailed geometry; +$0.05 quad | 2–4 views, order [front, left, back, right] | `face_limit` 1k–2M; quad; PBR; returns `task_id` "for rig or rig-check" | `orientation` only | — |
| `tripo3d/p2/image-to-3d` | $1.00–$1.30 | single image | `face_limit` 48–50,000 (quad ≤25k); `export_orientation`; `auto_size` (metres); `delight` | — | — |
| `fal-ai/trellis-2` | $0.25 (512) / $0.30 (1024) / $0.35 (1536) | single image | GLB only; `decimation_target` 5k–2M (schema advises 20–50k for web); textures 1024–4096 | none | — |
| `fal-ai/hyper3d/rodin/v2.5` | $0.40; +$0.80 HighPack | ≤5 images | glb/usdz/fbx/obj/stl; `quality_mesh_option` e.g. "20K Triangle" or "50K Quad"; PBR or Shaded | **`TAPose: true`** | — |
| `hitem3d/hi3d/v3.0/multi-view-to-3d` | $2.10 / $9.10 | multi-view | — | — | — |
| `tripo3d/tripo/remesh` | billing $0.01/unit (units per call UNVERIFIED) | GLB/OBJ/FBX/STL ≤150 MB | `face_limit` 500–20,000 (quad ≤10k); bakes textures | — | — |

### D. Rigging and animation

| Endpoint / tool | Price | What it does | Limits |
|---|---|---|---|
| **`fal-ai/meshy/rigging`** | $0.20; +$0.12 with `enable_animation` | Rigs **any** humanoid GLB (fal docs name Hunyuan, Trellis and Meshy sources). Returns `rigged_character_glb`/`fbx` plus `basic_animations` (walking/running as GLB, FBX and armature-only GLB). | `height_meters` (default 1.7); `animation_action_id` 0–696 (0 = Idle). Meshy native docs: humanoid "with clearly defined limbs", textured, **face toward +Z**, ≤300k faces (task path), GLB ≤400 MB (no Draco above 100 MB), 422 on pose-estimation failure. |
| **`fal-ai/meshy/rigging/multi-animation`** | $0.20 + $0.12 per clip (3 clips = $0.56) | One rig plus N library clips, returned in request order | `animation_action_ids` list |
| Meshy built-in (`enable_rigging`, `enable_animation` on `meshy/v7.1/*`) | +$0.20 / +$0.12 | Rig during generation | Bundled with generation; rejecting a mesh later wastes the rig fee |
| Meshy animation library | — | Categories DailyActions, BodyMovements, Fighting, WalkAndRun, Dancing. Example ids: 0 Idle, 30 Casual_Walk, 16 RunFast, 466 Regular_Jump, 96 Kung_Fu_Punch, 206 Spartan_Kick, 138 Block1, 178 Hit_Reaction, 187 Knock_Down, 403 Victory_Fist_Pump, 32 Chair_Sit_Idle_F | Licence terms for clips not stated on the library page |
| `fal-ai/hunyuan-motion` (1B) and `/fast` (0.46B) | $0.08/generation | Text → human motion, 0.5–12 s, FBX or JSON | Skeleton definition UNVERIFIED; needs retargeting |
| `tripo3d/tripo/{rig, rig-check, retarget, animate}` | — | Ids exist in the fal registry with **no metadata or schema** (unlisted) | Not usable until published (UNVERIFIED) |
| `fal-ai/sam-3/3d-body` | $0.02/unit | Human body mesh from an image | Optional (NPC-builder body proportions) |
| **UniRig** (VAST-AI-Research, MIT) | self-host GPU (e.g. fal Serverless) | Autoregressive skeleton + skinning prediction for diverse assets; VRoid/Rig-XL datasets; Blender add-on for VRM | Released checkpoint trained on Articulation-XL2.0; full Rig-XL/VRoid checkpoints "planned" |
| **Mixamo** (Adobe) | free | Humanoid auto-rigger and clip library | No API; maintenance mode; not for automation (low confidence) |
| **three.js `SkeletonUtils`** (`three@0.186.1`) | — | `retarget(target, source, options)` and `retargetClip(target, source, clip, options)` with `names`, `getBoneName`, `hip`, `hipInfluence`, `scale`, `localOffsets`, `fps`, `trim`, `useFirstFramePosition` | Forum reports fragility across differing rest poses; prefer identical skeletons |

### E. Voice and music

| Endpoint id | Price | Notes |
|---|---|---|
| `elevenlabs/tts/eleven-v4` | $0.08 / 1k chars | On fal: preset voices by name (default "Rachel"; Aria, Roger, Sarah…), `stability`, `language_code`. Native: `eleven_v4`, 10,000 chars/request, 90+ languages. |
| `elevenlabs/tts/eleven-v4-turbo` | $0.04 / 1k chars | Native `eleven_v4_turbo`: ≈100 ms median inference (excluding network), Text-to-Dialogue WebSocket |
| `fal-ai/elevenlabs/tts/turbo-v2.5` | $0.05 / 1k chars | — |
| (native only) `eleven_flash_v2_5` | ElevenLabs pricing | ≈75 ms; 40,000 chars; 32 languages |
| `fal-ai/minimax/speech-2.8-turbo` / `speech-2.8-hd` | $0.06 / $0.10 per 1k chars | `voice_setting` takes designed or cloned voice ids |
| `fal-ai/minimax/voice-design` | **$3 per voice** (+$0.03/1k preview chars) | Text-described original voice; parody-tier default |
| `fal-ai/minimax/voice-clone` | $1.50 per clone (+$0.30/1k preview chars) | **`consented` tier only** |
| `fal-ai/qwen-3-tts/voice-design/1.7b` / `clone-voice/1.7b` | $0.09/1k chars / $0.0008/min | Open-model alternative |
| `google/gemini-3.8-flash-tts` | $0.045 / 1k chars | — |
| `fal-ai/inworld-tts` | $0.01 / 1k chars | Cheapest for crowd barks |
| Cloudflare Workers AI `aura-2-en` | $0.030 / 1k chars | From `stack-cloudflare-backend.md` §1.6 |
| `minimax/music-3` | $0.002/s | Songs up to 300 s; requires `lyrics` and `prompt`. fal-hosted; licence chain UNVERIFIED (MiniMax open weights?). |
| `elevenlabs/music/v2.5` | $0.60 per output minute (rounded up) | 3 s–10 min; composition plans. ElevenLabs Music terms exclude "Studio Games" from self-serve commercial rights (medium confidence). |
| `google/lyria-3.5` | $0.10/generation | Google terms and watermarking UNVERIFIED |
| `fal-ai/elevenlabs/sound-effects/v2` | (not priced here) | SFX; used by `universal-modder` |

---

## 2. Cutscene pipeline (R-CUT-01..03)

### 2.1 Shot recipes (ranked)

**Recipe K: keyframe-first (default for story beats).**
1. A Director step (deterministic, from the mission DSL `CutsceneRef` and the event-timeline recorder; see gamedesign §2.6 and repos-world P13) emits a shot list: `{shotId, durationS (≤15), camera, subjects[npcId], stage, mood}`.
2. For each shot, `openai/gpt-image-2.5/sunburst/edit` composes a **start keyframe** at 1920×1080, quality `high` ($0.040). Its inputs are the style bible, each subject's approved sheet crop (≤16 inputs) and the stage plate. An end keyframe is optional ($0.040).
3. `minimax/h3-max-turbo/image-to-video` renders the shot with `image_url` (and optionally `end_image_url`) at 768P, `prompt_expansion_mode: "disabled"` (keeps cache determinism), a fixed `seed`, and `duration` = shot length.
4. Optional `minimax/h3-max-turbo/extend-video` (continuation mode) chains shots longer than 15 s.
5. Clients concatenate shots and subtitle tracks at playback, as gamedesign §4.5 already plans for fighter intros.

**Recipe R: reference-to-video** (multi-subject action, fighter face-offs and walk-ins). Use `minimax/h3-max/reference-to-video` with `reference_image_urls` = ≤4 square crops (stays inside the free 4,096-token allowance). The prompt cites "Image 1 is <slot id>…". Use `image_url` = a stage plate or keyframe when composition matters. 768P, 5 s.

**Recipe L: lip-sync dialogue.** Render TTS lines first (§5), then use `minimax/h3-max/lip-sync/image-to-video` from the keyframe. Use this sparingly ($0.08/s); in-engine dialogue with subtitles is the cheaper default.

**Recipe P: previs → video** (optional, for landmark set pieces). Render a Three.js/Blender camera fly-through of the real SF geometry. `minimax/h3-max/3d-to-video` then matches layout and camera to the real streets. This is the only recipe that ties generated video to the accurate-SF requirement. Cost ≈ $0.96 per 5 s.

### 2.2 Determinism and cache keys

Extend the C09 key input (gamedesign §4.5) with: `gen.endpoint`, `gen.endpointUpdatedAt` (the registry's `metadata.updated_at` at generation time; fal changed H3 Max pages on 2026-10-16), `gen.params` (resolution, duration, aspect ratio, `prompt_expansion_mode`, seed), `inputs[]` (sha256 of each keyframe/reference file, not URLs) and `promptTemplate@version`. Set `prompt_expansion_mode: "disabled"` for keyed assets. Otherwise the server rewrites the prompt and returns `expanded_prompt`; that cannot be keyed reproducibly unless the expanded text is stored. Store `seed` from the response; reference-to-video returns it.

### 2.3 Output handling

- The video output is a `File {url, content_type, file_name, file_size}`. The container and codec are not documented (MP4/H.264 assumed; UNVERIFIED) and must be checked in the spike.
- Copy to R2 `cutscenes/{cacheKey}.mp4` immediately. Then transcode an HLS/CMAF or 720p mobile rendition if bitrate demands it; there is no transcoding service in the stack yet (UNVERIFIED need).
- Send `X-Fal-Object-Lifecycle-Preference: {"expiration_duration_seconds": 86400}` so the fal CDN copy expires after a day. Expired fal files are deleted permanently.
- Serve from the R2 custom domain with CORS. This fits the COEP `require-corp` setup in `stack-cloudflare-backend.md` §1.2; the client fetches in CORS mode.

---

## 3. Character pipeline (R-NPC-02, R-NPC-03, R-NPC-04)

### 3.1 Stages, endpoints and QA gates

| # | Stage | Endpoint (default → alternates) | Settings | Automated gate | Human gate |
|---|---|---|---|---|---|
| 0 | Tier check | — | Read `soul.md` frontmatter: `tier ∈ {consented, parody, fictionalized}`, `soulVersion`, `nameRegistryId` | Prompt linter rejects real names or aliases from NameRegistry in any fal prompt (P-6) | Consent record exists if `consented` |
| 1 | Style bible (once per project) | `openai/gpt-image-2.5/sunburst/text-to-image` | 2560×1440, high | — | Art director approves `bay-cel@N` |
| 2 | Turnaround sheet | `openai/gpt-image-2.5/sunburst/edit` → `google/nano-banana-2.1/edit` → `bytedance/seedream/v5/pro/edit` | 2560×1440 high; fixed 4-panel layout (front, left, back, right); full body; **T-pose, arms horizontal**; neutral flat light; plain mid-grey background; style bible plus backstory refs as inputs (references follow §6.1) | Vision check: 4 panels, full body, T-pose arm angle, background uniformity | Pick best of 3 |
| 3 | Per-view crops | **Programmatic crop** of the fixed layout (free). Fall back to `…/sunburst/edit` at 1024×1536 ($0.041/view) or `fal-ai/qwen-image-edit-2511-multiple-angles` for missing views. | — | Aspect and size checks | — |
| 4 | Mesh | **`meshy/v7.1/multi-image-to-3d`** → `fal-ai/hunyuan-3d/v3.1/pro/image-to-3d` (multi-view, PBR) → `tripo3d/h3.1/multiview-to-3d` | `pose_mode: "t-pose"`; `target_polycount` 30,000 (hero) / 12,000 (crowd); `topology: "triangle"`; `should_remesh: true`; `enable_pbr: true`; `symmetry_mode: "auto"`; **`enable_rigging: false`** (rig only accepted meshes) | glTF-Validator clean; triangle count ≤ budget; bbox height 1.5–2.1 m; +Z facing; texture ≤2048² | Pick best of 2 |
| 5 | Rig and clips | **`fal-ai/meshy/rigging/multi-animation`** | `height_meters` from soul.md; `animation_action_ids` = the project's shared clip set (e.g. 0, 30, 16, 466 + 3–6 signature moves) | Bone-name map matches the project rig; skin-weight sanity (no vertex with weight sum ≠ 1); 422 → retry with remesh | Rig spot-check in viewer |
| 6 | Post | gltf-transform + meshoptimizer (in repo tooling) | LOD0/1/2, KTX2 textures, meshopt compression, normalise bone names to `bay_rig_v1` | Size budget per device tier (R-ENG-02) | — |
| 7 | Publish | R2 `characters/{npcId}/{soulVersion}/{hash}.glb` plus manifest row | provenance: endpoint ids, request ids, input hashes, costs, tier | CI provenance check (R-IP-01) | Kill-switch wired (R-IP-02) |

### 3.2 Fully automated vs human or Blender

- **Automatable now:** stages 1–7 above. That is sheet and keyframe generation, multi-view → T-pose textured mesh, humanoid auto-rig with walk/run plus library clips, LOD and compression, and validation. `universal-modder/skills/fal-assets/SKILL.md` already runs the same chain (image → `fal-ai/trellis-2` → `fal-ai/meshy/rigging` → `tripo3d/tripo/remesh`), so the pattern is proven in local research.
- **Needs a human:** likeness and tier approval; best-of-N choice (an LLM-vision score can pre-rank, but a human makes the final call); accessories that break skinning (chains, hats, hoodies, long hair, which matter for rappers); hands and fingers (Meshy docs do not mention finger bones; UNVERIFIED).
- **Needs Blender work:** facial rigs, blendshapes and visemes for in-engine lip sync. Meshy outputs are not documented to include face bones or blendshapes (UNVERIFIED), so plan for a jaw bone plus texture-swap mouth, or video lip-sync only.
- **Fighter animation:** Culture Wars needs 60–80 clips per fighter with frame data (gamedesign §4.12). The Meshy library supplies base locomotion and a Fighting category, but startup/active/recovery timing must be hand-tuned or authored once on the canonical rig in Blender and shared.

### 3.3 Retargeting strategy

1. **One skeleton family.** Every NPC goes through Meshy rigging, so all rigs share bone naming. Meshy states Mixamo-style names (vendor claim, medium confidence). Three.js `AnimationMixer` binds tracks by bone name, so library clips play on any Meshy-rigged NPC without retargeting. Apply hip-height scaling (`soul.md` height) and foot IK for ground contact.
2. **Foreign clips** (Hunyuan Motion FBX, mocap, user uploads): bake offline with `SkeletonUtils.retargetClip(target, source, clip, { names: boneMap, hip: 'Hips', fps: 30 })` in a Node/three build script. Store baked `AnimationClip` JSON per rig family. Do not retarget at runtime on mobile.
3. **Canonical rig.** Keep one hand-checked "mannequin" Meshy rig in the repo as the retarget target and test fixture. Its bone map lives in `packages/genai-core/rig/bay_rig_v1.json`.

### 3.4 User NPC builder (R-NPC-03)

- Same stages, but triggered by players through the Worker. **fal ToS §4(b) requires End Users to be ≥18.** User-triggered generation therefore cannot ship before auth plus age gating. That matches "auth added last": the NPC builder's generation step is an auth-milestone feature. Before auth, the builder can run locally with a bring-your-own fal key (R-MOD-01 route) or stay text-only (soul.md and chat).
- Uploads go to R2 (presigned PUT, `stack-cloudflare-backend.md` §10). Then: image moderation pre-filter, user attestation ("this is me, or fictional; I have rights"), no celebrity names (NameRegistry check), and a per-user quota (e.g. 1 build/day, ≈ $1.05 Lean tier). Use the Lean tier by default.
- Send `X-Fal-Store-IO: 0` for user jobs so fal does not keep payloads for 90 days. Whether results are still retrievable with this header set is UNVERIFIED; test it.

---

## 4. Platform mechanics (fal) and the Cloudflare job pattern

### 4.1 fal facts that shape the design

- **Queue:** `POST https://queue.fal.run/{endpoint_id}` with `Authorization: Key $FAL_KEY` returns `{request_id, response_url, status_url, cancel_url, queue_position}`. `GET …/requests/{id}/status[?logs=1]` returns `IN_QUEUE` (with `queue_position`), `IN_PROGRESS` or `COMPLETED` (`metrics.inference_time`; `error` and `error_type` on failure). Also: `GET …/requests/{id}` (result), `PUT …/cancel` (202/400/404) and an SSE status stream.
- **Headers:** `X-Fal-Request-Start-Timeout` (seconds, before processing starts; 504 when it passes); `X-Fal-Queue-Priority: normal|low`; `X-Fal-No-Retry`; `X-Fal-Runner-Hint`; `X-Fal-Object-Lifecycle-Preference`; `X-Fal-Store-IO`. The queue retries runner failures up to 10 times.
- **Webhooks:** append `?fal_webhook=<url>`. The body is `{request_id, gateway_request_id, status: OK|ERROR, payload, error?, payload_error?}`. The receiver must answer 2xx. Timeouts are 15 s for the first attempt and 120 s for retries; up to 31 retries with backoff. **Retries stop when the stored result expires: ≈1 h, or ≈6 min for results ≥10 KB.** 3xx responses are not followed. Deliveries to private IPs are dropped.
- **Webhook signature:** headers `X-Fal-Webhook-{Request-Id, User-Id, Timestamp, Signature(hex)}`. The message is `request_id \n user_id \n timestamp \n sha256hex(body)`. Verify ED25519 against any key in `https://rest.fal.ai/.well-known/jwks.json` (live: 2 OKP/Ed25519 keys; the `x` values carry `=` padding, so strip it before JWK import). Cache keys ≤24 h; allow ±300 s clock skew. Optional IP allowlist from `https://api.fal.ai/v1/meta` → `webhook_ip_ranges` (15 /32s today).
- **Concurrency:** new accounts get **2 concurrent requests**. Limits rise with paid invoices over the last 4 weeks, to 40 self-serve; higher limits need sales. A 429 `concurrent_requests_limit` comes with `X-Fal-needs-retry: 1`. `IN_QUEUE` requests do not count and are not dropped.
- **Storage:** CDN files expire per the account setting or the per-request header (`null` = never). Request payloads are kept **90 days** by default for dashboard history; opt out with `X-Fal-Store-IO: 0`.
- **Keys:** keep keys in environment secrets. Presets are `API` and `SERVERLESS`, or custom permissions. The JS client (`@fal-ai/client@1.10.1`) says to keep credentials protected and to use the proxy package (`@fal-ai/server-proxy@1.2.1`) client-side. **fal ToS §4(b): "Client will not expose any of the Services APIs directly to any End Users".** So no generic browser proxy; only typed, allowlisted job endpoints in our Worker.
- **Terms:** ToS last updated 2026-09-08. fal claims no IP in Output Content (§4(c)) and gives no originality warranty. Third-party model terms pass through (§14(b)). Outputs may not be used to train competing models (§14(c)). The customer indemnifies fal for privacy and publicity claims (§15(a)). The AUP prohibits impersonation via name, image, voice or likeness without consent (§3.3), violating publicity rights (§4.1, §7.1.5) and non-consensual sexual likeness (§1.3). It has no parody exception.

### 4.2 Worker + Workflow pattern (extends stack-cloudflare-backend.md §10)

```ts
// packages/genai-core/src/registry.ts — the ONLY endpoints the backend may call (allowlist + pricing snapshot)
export const ENDPOINTS = {
  'video.turbo.i2v': { id: 'minimax/h3-max-turbo/image-to-video', unit: 's', usd768: 0.04, legalGate: 'ADR-GENAI-01' },
  'video.ref':       { id: 'minimax/h3-max/reference-to-video',  unit: 's', usd768: 0.08, legalGate: 'ADR-GENAI-01' },
  'video.fallback':  { id: 'google/gemini-omni-flash/v1.1/reference-to-video', unit: 's', usd720: 0.10 },
  'image.sheet':     { id: 'openai/gpt-image-2.5/sunburst/edit', unit: 'tokens', usdHigh2560x1440: 0.05529 },
  'image.lean':      { id: 'google/nano-banana-2.1/edit', unit: 'tokens', usd2k: 0.063 },
  'mesh.default':    { id: 'meshy/v7.1/multi-image-to-3d', unit: 'gen', usdTextured: 1.20 },
  'rig.multi':       { id: 'fal-ai/meshy/rigging/multi-animation', unit: 'gen', usdBase: 0.20, usdPerClip: 0.12 },
} as const; // pricing.checkedAt = '2026-10-18'; re-verify monthly via GET https://api.fal.ai/v1/models/pricing (auth)
```

```ts
// apps/worker/src/genai/fal.ts (server-side only; FAL_KEY is a Worker secret)
export async function falSubmit(env: Env, endpointId: string, input: unknown, wfInstanceId: string) {
  const u = new URL(`https://queue.fal.run/${endpointId}`);
  u.searchParams.set('fal_webhook', `${env.PUBLIC_ORIGIN}/api/v1/hooks/fal?wf=${encodeURIComponent(wfInstanceId)}`);
  const r = await fetch(u, { method: 'POST', body: JSON.stringify(input), headers: {
    Authorization: `Key ${env.FAL_KEY}`, 'Content-Type': 'application/json',
    'X-Fal-Object-Lifecycle-Preference': JSON.stringify({ expiration_duration_seconds: 86400 }),
    'X-Fal-Request-Start-Timeout': '3600',
  }});
  if (!r.ok) throw new Error(`fal submit ${r.status}`);       // 429 → Workflow step retry with backoff
  return r.json() as Promise<{ request_id: string; status_url: string; response_url: string; cancel_url: string }>;
}

export async function verifyFalWebhook(req: Request, raw: ArrayBuffer, env: Env): Promise<boolean> {
  const h = (k: string) => req.headers.get(k);
  const [rid, uid, ts, sig] = ['X-Fal-Webhook-Request-Id','X-Fal-Webhook-User-Id','X-Fal-Webhook-Timestamp','X-Fal-Webhook-Signature'].map(h);
  if (!rid || !uid || !ts || !sig || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const bodyHex = toHex(await crypto.subtle.digest('SHA-256', raw));
  const msg = new TextEncoder().encode([rid, uid, ts, bodyHex].join('\n'));
  const { keys } = await getJwksCached(env);                   // KV, TTL ≤ 24 h, from https://rest.fal.ai/.well-known/jwks.json
  for (const k of keys) {
    const key = await crypto.subtle.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', x: k.x.replace(/=+$/, '') },
      { name: 'Ed25519' }, false, ['verify']);
    if (await crypto.subtle.verify({ name: 'Ed25519' }, key, fromHex(sig), msg)) return true;
  }
  return false;
}
// Route POST /api/v1/hooks/fal: verify → (await env.GEN_WF.get(wf)).sendEvent({ type: 'fal-done', payload: { request_id, status } }) → 200 fast.
```

```ts
// apps/worker/src/genai/workflow.ts — one Workflow class for cutscene/sheet/mesh/rig jobs
export class GenJobWorkflow extends WorkflowEntrypoint<Env, GenJob> {
  async run(ev: WorkflowEvent<GenJob>, step: WorkflowStep) {
    const j = ev.payload;                                       // {cacheKey, kind, endpointKey, input, r2Key, budgetUsd}
    if (await step.do('cache-check', async () => !!(await this.env.MEDIA.head(j.r2Key)))) return { cached: true };
    await step.do('budget-reserve', () => reserveBudget(this.env, j));          // daily cap (G3), per-user quota
    const sub = await step.do('submit', { retries: { limit: 5, delay: '15 seconds', backoff: 'exponential' } },
      () => falSubmit(this.env, ENDPOINTS[j.endpointKey].id, j.input, ev.instanceId));
    try { await step.waitForEvent('await fal webhook', { type: 'fal-done', timeout: '20 minutes' }); } catch { /* lost webhook → poll */ }
    const out = await step.do('poll+result', { retries: { limit: 12, delay: '30 seconds', backoff: 'exponential' } }, async () => {
      const st: any = await (await fetch(sub.status_url, { headers: { Authorization: `Key ${this.env.FAL_KEY}` } })).json();
      if (st.status !== 'COMPLETED') throw new Error(`pending ${st.status}`);
      const res: any = await (await fetch(sub.response_url, { headers: { Authorization: `Key ${this.env.FAL_KEY}` } })).json();
      return pickFileUrls(res);                                  // return URLs only: step results must stay < 1 MiB
    });
    await step.do('copy-to-r2', async () => {
      const f = await fetch(out.primaryUrl);                     // stream; Content-Length present on fal CDN (UNVERIFIED)
      await this.env.MEDIA.put(j.r2Key, f.body, { httpMetadata: { contentType: f.headers.get('content-type') ?? 'application/octet-stream' },
        customMetadata: { endpoint: ENDPOINTS[j.endpointKey].id, falRequestId: sub.request_id } });
    });
    await step.do('record', () => recordAsset(this.env, j, sub.request_id, out));  // Supabase row + manifest; release budget delta
  }
}
```

Notes: (a) Concurrency must match the fal account limit (start at 2). Gate submits through a Durable Object semaphore keyed `fal-concurrency`; `IN_QUEUE` jobs are fine, but 429s waste steps. (b) Batch prewarm on roster freeze uses `createBatch` (Workflows rule). (c) Roster production (60 NPCs, ~200 story/fighter clips) can instead run from a repo CLI (`tools/genai/`, Node, `@fal-ai/client` with `fal.queue.submit`/`status`/`result`) on the art lead's machine or in CI, writing the same manifest rows. The Worker path is required only for on-demand jobs (user NPCs, late cutscene keys). (d) Keep `CutsceneJobDO` single-flight per cache key, as `stack-cloudflare-backend.md` §6 decided.

---

## Cost model

All prices are fal list prices checked 2026-10-18. Assumptions are marked (A). The Turbo promo is ignored for budgeting because it ends Oct 31, 2026.

### Per character (sheet + 3D + rig)

| Tier | Sheet stage | 3D stage | Rig + clips | **Total / character** | **× 60 NPCs** |
|---|---|---|---|---|---|
| **Lean** | `google/nano-banana-2.1/edit` 2K × 4 attempts = $0.252 | `tripo3d/h3.1/multiview-to-3d` standard textures × 2 = $0.60 | `fal-ai/meshy/rigging` (walk/run included) = $0.20 | **$1.05** | **$63** |
| **Standard (recommended)** | Sunburst edit 2560×1440 high × 3 attempts at ($0.05529 + 3 extra refs × $0.01 (A)) = $0.256; 4 view crops at 1024×1536 high = $0.165 (A: $0 if programmatic crop); 2 portraits at 1024² high = $0.105 → $0.526 | `meshy/v7.1/multi-image-to-3d` textured × 2 = $2.40 | multi-animation, 5 clips = $0.80 | **$3.73** | **$224** |
| **Premium** | Sunburst xhigh: 4 sheets ($0.128) + 6 views ($0.074) + 3 portraits ($0.094) = $1.24 | Meshy × 3 ($3.60) + Hunyuan 3.1 Pro multi-view + PBR + face count ($0.825) = $4.43 | multi-animation, 10 clips = $1.40 | **$7.06** | **$424** |

Voice add-ons per character (A: 15,000 characters of lines): MiniMax voice-design ($3) + speech-2.8-hd ($1.50) = **$4.50** (×60 = $270). ElevenLabs v4 preset voice = **$1.20** (×60 = $72). MiniMax speech-2.8-turbo preset = $0.90 (×60 = $54).

### Per cutscene

(A) One story cutscene = 3 shots × 5 s = 15 s at 768p (720p for Google), with 1.5× generation for retakes. Keyframes where used: 4 × Sunburst 1920×1080 high = $0.158.

| Option | Endpoint(s) | **Per cutscene** | **× 100 cutscenes** |
|---|---|---|---|
| A — owner's model, keyframe-first | Sunburst keyframes + `minimax/h3-max-turbo/image-to-video` | **$1.06** (promo: $0.74) | **$106** |
| B — subject-consistent | `minimax/h3-max/reference-to-video` (≤4 square refs) | **$1.80** (+keyframe first frame: $1.96) | **$180** ($196) |
| C — B at 1080p | same | $3.60 | $360 |
| G — MiniMax partner API | `minimax/h3/reference-to-video` | $1.35 | $135 |
| D — fallback | `google/gemini-omni-flash/v1.1/reference-to-video` 720p | $2.25 | $225 |
| E — fallback | `fal-ai/kling-video/o3/pro/reference-to-video` (audio on) | $3.15 | $315 |
| H — fallback | Sunburst keyframes + `lightricks/ltx-2.5/image-to-video/fast` 720p | $2.18 | $218 |
| F — US-hosted fallback | `bytedance/seedance-2.5/us/reference-to-video` 720p | $10.64 | $1,064 |

**Fighter clip set** (gamedesign §4.5; 5 s clips, 1.5× retakes): N=8 (116 clips) $70 (B) / $35 (A); **N=12 (222 clips) $133 (B) / $67 (A)**; N=16 (360 clips) $216 (B) / $108 (A).

**Indicative v1 GenAI program:** 60 Standard NPCs ($224) + 100 cutscenes, option B ($180) + 222 fighter clips, option B ($133) + ElevenLabs preset voices ($72) ≈ **$609** in fal spend. Add 25% for experiments ≈ **$760**. Storage is negligible in R2 (≈2–5 GB). Spend on fal is not the constraint; legal clearance and human QA time are.

---

## 6. Likeness, licence and policy constraints

### 6.1 Real people (R-NPC-04 tiers)

- No provider checked has a parody exception: fal AUP §3.3/§4.1/§7.1.5, the MiniMax H3 AUP item 13 ("impersonate another person without that person's consent"), ElevenLabs Use Policy §3 (no cloning of a living person's voice "without their explicit and informed consent") and §9 (publicity rights). fal ToS §15(a) makes us indemnify fal for publicity claims.
- **Tier rules for the pipeline:**
  - `consented`: photos and voice samples may be used as references and for voice-clone, with a signed record id in soul.md.
  - `parody`: **no photographs of the real person go to any generator**. Prompts use archetype descriptors and original design only; the name never appears in prompts. Voice comes from voice-design with a timbre description and is never a clone.
  - `fictionalized`: like parody, plus a deliberate dissimilarity check (a face-similarity threshold against the person's reference photo, run locally; tooling UNVERIFIED).
- **Ban list in the endpoint allowlist:** `minimax/h3-max/recast`, any `*/voice-clone` unless the tier is `consented`, and any face-swap endpoints.
- OpenAI's and Google's handling of identifiable real people in the image endpoints was **not verified from primary pages**. Expect refusals for real-person photo edits, and test this in the spike.
- MiniMax H3 AUP item 12 requires "clearly and prominently disclosing" machine-generated content in public environments. Label shared clips and UGC "AI-generated", and keep fal's provenance (fal has a "Verify fal-Generated Content" service; mechanism UNVERIFIED).

### 6.2 MiniMax H3 licence (primary text, HF `MiniMaxAI/MiniMax-H3/LICENSE`, dated 2026-08-02)

- Applicable Territory = worldwide **excluding the EU, UK, Republic of Korea and USA**. "MiniMax H3 Works" include **Model Derivatives** (any modification or work based on H3). Acceptance happens on use "including through any Hosted Services". §V.4: no use or display of the Works **or their Outputs** outside the Applicable Territory. §IV.2: commercial products must "prominently display 'MiniMax H3'" in the UI. §IV.1: written authorization is needed above $20M yearly revenue. §VI.4: "MiniMax claims no rights over the Outputs".
- fal describes H3 Max/Turbo as "post-trained variant[s] of MiniMax H3" hosted by fal, which reads as a Model Derivative served as a Hosted Service. Whether fal holds a separate MiniMax licence that covers US customers is **UNVERIFIED**. No fal page found addresses it. `minimax/h3/*` on fal is MiniMax's own partner API; secondary sources say MiniMax's API is not bound by the community licence's territory (UNVERIFIED).
- **Consequence:** the game is SF-based and US-distributed, so using H3-family outputs needs written confirmation (ADR-GENAI-01) from fal, or from MiniMax for the partner endpoints, before any H3 asset ships. Until then, H3 may be used for internal previs only, and production assets use fallback D or E. The provider switch is a config change because the cache key includes `gen.endpoint`.

### 6.3 Other terms

- **fal ToS §4(b):** End Users must be ≥18, and Services APIs must not be exposed directly → server-side only, and the user-triggered NPC builder ships behind an age gate (§3.4).
- **ElevenLabs Music:** self-serve rights exclude "Studio Games" (commercialised and on more than one platform); a PWA plus XR stores likely qualifies. Use an enterprise licence or another music source (medium confidence; confirm).
- **MiniMax Music 3 / Lyria 3.5:** licence chain UNVERIFIED. Treat AI music as legal-review items (the legal dimension decides). Commissioned "hyphy-inspired" tracks stay the safe default (gamedesign §2.17).

---

## Verified facts

| Fact | Source URL | Date checked | Confidence |
|---|---|---|---|
| `minimax/h3-max-turbo/text-to-video` and `/image-to-video` exist, active, licence commercial; first registry date 2026-09-02 | https://api.fal.ai/v1/models?endpoint_id=minimax/h3-max-turbo/text-to-video&expand=openapi-3.0 | 2026-10-18 | high |
| `minimax/h3-max-turbo/extend-video` exists (registry date 2026-10-01): source 1.625–60 s, ≤50 MB; adds 0.71–15 s; up to 2K | https://api.fal.ai/v1/models?endpoint_id=minimax/h3-max-turbo/extend-video&expand=openapi-3.0 | 2026-10-18 | high |
| H3 Max Turbo T2V/I2V schema: prompt ≤50,000; duration 0.92–15 s; 480P/768P/1080P; 6 aspect ratios; `prompt_expansion_mode`; `target_audio_url` ≥2 s, ≤15 MB; safety checker default on | same as row 1 | 2026-10-18 | high |
| Turbo T2V/I2V price: $0.01625/$0.026/$0.052 per s promo (−35%) until Oct 31, then $0.025/$0.04/$0.08 | https://fal.ai/models/minimax/h3-max-turbo/text-to-video | 2026-10-18 | high |
| Turbo extend: $0.025/$0.04/$0.08/$0.16 per new second (480p/768p/1080p/2K) | https://fal.ai/models/minimax/h3-max-turbo/extend-video | 2026-10-18 | high |
| No `h3-max-turbo` reference-to-video endpoint in the registry search for "minimax" | https://api.fal.ai/v1/models?q=minimax | 2026-10-18 | high |
| H3 Max reference-to-video: ≤9 images, ≤3 videos, ≤3 audio, ≤12 files; first/middle/end frames; $0.05/$0.08/$0.16 per s; 4,096 ref tokens included; 1,024 tokens per square image; $0.02/1k extra | https://fal.ai/models/minimax/h3-max/reference-to-video/llms.txt | 2026-10-18 | high |
| H3 Max T2V/I2V list $0.05/$0.08/$0.16 per s, promo −35% to Oct 31 | https://fal.ai/models/minimax/h3-max/text-to-video | 2026-10-18 | high |
| H3 Max lip-sync $0.05/$0.08/$0.16/$0.32 per s, ×1.2 above 15 s | https://fal.ai/models/minimax/h3-max/lip-sync/image-to-video | 2026-10-18 | high |
| H3 Max 3d-to-video $0.08/s at 768p, min 5 s; recast $0.30/s at 768p; insert $0.06/s at 768p | https://fal.ai/models/minimax/h3-max/3d-to-video ; …/recast ; …/insert-video | 2026-10-18 | high |
| MiniMax H3 (partner) $0.05/$0.06/$0.13/$0.16 per s (480p/768p/2K/4K); ref: first 5 images free, +$0.08 each | https://fal.ai/models/minimax/h3/reference-to-video | 2026-10-18 | high |
| H3 Max published Aug 26, 2026 as fal Research's post-train of open-weights MiniMax H3; latency table (Turbo 5 s 768p 1.54 s; H3 Max 2.46 s; 15 s 1080p 13.56 / 17.63 s) | https://fal.ai/learn/devs/introducing-h3-max-by-fal | 2026-10-18 | high (vendor-measured) |
| Turbo announced as 2× speed, half cost of H3 Max | https://x.com/fal/status/2095210540083884453 | 2026-10-18 | medium (seen via search) |
| GPT Image 2.5 Sunburst on fal: `openai/gpt-image-2.5/sunburst/{text-to-image,edit}`, registry date 2026-09-08; edit ≤16 images, quality up to `max`, prompt ≤32,000 | https://api.fal.ai/v1/models?endpoint_id=openai/gpt-image-2.5/sunburst/edit&expand=openapi-3.0 | 2026-10-18 | high |
| Sunburst fal cost table (e.g. 1024² high $0.05268; 2560×1440 high $0.05529; 3840×2160 max $0.40026); tokens $5/$8/$30 per M | https://fal.ai/models/openai/gpt-image-2.5/sunburst/edit | 2026-10-18 | high |
| OpenAI model id `gpt-image-2.5-sunburst`, snapshot `gpt-image-2.5-sunburst-2026-09-08`; image output $30/M ($15 Batch); rate limits Build 20 IPM, Launch 150, Grow 250 | https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst | 2026-10-18 | high |
| OpenAI images: max edge 3840 px; 655,360–8,294,400 px; >2560×1440 experimental; `moderation` auto/low | https://developers.openai.com/api/docs/guides/image-generation | 2026-10-18 | high |
| Nano Banana 2.1 edit: 1K $0.044, 2K $0.063, 4K $0.138 (two 1K inputs); ≈1,120 tokens per input image | https://fal.ai/models/google/nano-banana-2.1/edit | 2026-10-18 | high |
| Meshy 7.1 multi-image-to-3d: 1–4 images, `pose_mode` t-pose/a-pose, polycount 100–300k, PBR, rigging/animation flags; $0.80/$1.20, +$0.20 rig, +$0.12 anim | https://fal.ai/models/meshy/v7.1/multi-image-to-3d/llms.txt | 2026-10-18 | high |
| `fal-ai/meshy/rigging` rigs any humanoid GLB; outputs rigged GLB/FBX plus walk/run; action ids 0–696; $0.20 (+$0.12) | https://fal.ai/models/fal-ai/meshy/rigging/llms.txt | 2026-10-18 | high |
| `fal-ai/meshy/rigging/multi-animation` $0.20 + $0.12/clip | https://fal.ai/models/fal-ai/meshy/rigging/multi-animation/llms.txt | 2026-10-18 | high |
| Meshy rigging needs textured humanoid, face +Z, ≤300k faces (task path), GLB; 422 on pose failure | https://docs.meshy.ai/en/api/rigging-and-animation | 2026-10-18 | high |
| Meshy animation library categories and example ids (0 Idle, 96 Kung_Fu_Punch, 187 Knock_Down…) | https://docs.meshy.ai/en/api/animation-library | 2026-10-18 | high |
| Meshy rigs use Mixamo-style bone names | https://www.meshy.ai/features/ai-auto-rigging | 2026-10-18 | medium (vendor marketing) |
| Hunyuan 3D v3.1 Pro: up to 8 views, face_count 40k–1.5M, $0.375 + $0.15 per option; formats obj/glb/usdz/fbx | https://fal.ai/models/fal-ai/hunyuan-3d/v3.1/pro/image-to-3d | 2026-10-18 | high |
| Tripo H3.1 multiview $0.20/$0.30/$0.40 (+$0.20 detailed, +$0.05 quad); 2–4 views; returns task_id for rig | https://fal.ai/models/tripo3d/h3.1/multiview-to-3d | 2026-10-18 | high |
| Trellis 2 $0.25/$0.30/$0.35 by resolution; GLB; decimation 5k–2M | https://fal.ai/models/fal-ai/trellis-2 | 2026-10-18 | high |
| Rodin v2.5 $0.40 (+$0.80 HighPack); `TAPose`; ≤5 images | https://fal.ai/models/fal-ai/hyper3d/rodin/v2.5 | 2026-10-18 | high |
| `tripo3d/tripo/{rig,rig-check,retarget,animate}` registered without metadata or OpenAPI | https://api.fal.ai/v1/models?endpoint_id=tripo3d/tripo/rig&expand=openapi-3.0 | 2026-10-18 | high (existence); usability unknown |
| Hunyuan Motion: text → FBX/JSON, 0.5–12 s, $0.08 | https://fal.ai/models/fal-ai/hunyuan-motion/llms.txt | 2026-10-18 | high |
| Veo 3 / Veo 3 Fast endpoints deprecated on fal | https://api.fal.ai/v1/models?q=veo3 | 2026-10-18 | high |
| Gemini Omni Flash 1.1 ref2v: 3–10 s, ≤10 images, $0.03–$0.30/s | https://fal.ai/models/google/gemini-omni-flash/v1.1/reference-to-video | 2026-10-18 | high |
| Kling O3 Pro ref2v: $0.112/s (audio off), $0.14/s (audio on); 3–15 s; elements with voice_id | https://fal.ai/models/fal-ai/kling-video/o3/pro/reference-to-video | 2026-10-18 | high |
| Seedance 2.5 US ref2v: US-hosted; ≤30 images; 4–30 s; ≈$0.2205/$0.473/$1.164 per s | https://fal.ai/models/bytedance/seedance-2.5/us/reference-to-video | 2026-10-18 | high |
| LTX 2.5 fast I2V $0.09–$0.30/s; 6–20 s; native audio | https://fal.ai/models/lightricks/ltx-2.5/image-to-video/fast | 2026-10-18 | high |
| ElevenLabs v4 on fal $0.08/1k chars; v4 Turbo $0.04/1k | https://fal.ai/models/elevenlabs/tts/eleven-v4/llms.txt | 2026-10-18 | high |
| ElevenLabs native ids `eleven_v4`, `eleven_v4_turbo` (~100 ms), `eleven_flash_v2_5` (~75 ms, 40k chars) | https://elevenlabs.io/docs/overview/models | 2026-10-18 | high |
| ElevenLabs Use Policy (updated 09 Oct 2026): no cloning of a living person without explicit informed consent; no parody exception | https://elevenlabs.io/use-policy | 2026-10-18 | high |
| ElevenLabs Music self-serve rights exclude "Studio Games" | https://elevenlabs.io/eleven-music-model-specific-terms | 2026-10-18 | medium (via search) |
| MiniMax speech-2.8 turbo/hd $0.06/$0.10 per 1k; voice-design $3; voice-clone $1.50 | https://fal.ai/models/fal-ai/minimax/voice-design ; …/voice-clone ; …/speech-2.8-turbo/llms.txt | 2026-10-18 | high |
| MiniMax Music 3 $0.002/s, up to 300 s; ElevenLabs Music v2.5 $0.60/min; Lyria 3.5 $0.10/gen | https://fal.ai/models/minimax/music-3/llms.txt ; …/elevenlabs/music/v2.5 ; …/google/lyria-3.5/llms.txt | 2026-10-18 | high |
| Queue API paths, statuses, headers (`X-Fal-Request-Start-Timeout`, priority, no-retry, lifecycle, store-IO); up to 10 runner retries | https://fal.ai/docs/model-apis/model-endpoints/queue | 2026-10-18 | high |
| Webhook payload, 31 retries, 15 s/120 s timeouts, retries end ≈1 h (≈6 min for ≥10 KB results); ED25519 message format; ±300 s | https://fal.ai/docs/model-apis/model-endpoints/webhooks | 2026-10-18 | high |
| JWKS live with 2 Ed25519 keys; webhook IP ranges at /v1/meta | https://rest.fal.ai/.well-known/jwks.json ; https://api.fal.ai/v1/meta | 2026-10-18 | high |
| Default concurrency 2; self-serve up to 40; 429 `concurrent_requests_limit`; queued requests not counted | https://fal.ai/docs/documentation/model-apis/concurrency-limits | 2026-10-18 | high |
| Media expiry header `{"expiration_duration_seconds": N or null}`; expired files deleted permanently; payloads kept 90 days unless `X-Fal-Store-IO: 0` | https://fal.ai/docs/documentation/model-apis/media-expiration | 2026-10-18 | high |
| `@fal-ai/client` 1.10.1 (2026-05-04); `@fal-ai/server-proxy` 1.2.1 | https://registry.npmjs.org/@fal-ai/client ; https://registry.npmjs.org/@fal-ai/server-proxy | 2026-10-18 | high |
| fal ToS (updated 2026-09-08): §4(b) End Users ≥18 and no direct API exposure; §4(c) no originality warranty; §14 third-party terms; §15(a) publicity indemnity | https://fal.ai/legal/terms-of-service | 2026-10-18 | high |
| fal AUP §1.3, §3.3, §4.1, §7.1.5 likeness/impersonation rules | https://fal.ai/legal/acceptable-use-policy | 2026-10-18 | high |
| All 63 published endpoints checked carry `license_type: commercial` | https://api.fal.ai/v1/models (per endpoint) | 2026-10-18 | high |
| MiniMax H3 Community License (2026-08-02): excludes EU/UK/KR/USA; covers Model Derivatives and Hosted Services; Outputs not usable outside territory; "MiniMax H3" UI display; $20M cap; AUP items 12–13 | https://huggingface.co/MiniMaxAI/MiniMax-H3/raw/main/LICENSE | 2026-10-18 | high |
| HF repo `MiniMaxAI/MiniMax-H3` created 2026-07-28, licence "other / minimax-h3-community-license-agreement", not gated | https://huggingface.co/api/models/MiniMaxAI/MiniMax-H3 | 2026-10-18 | high |
| Workers Web Crypto supports Ed25519 sign/verify and JWK import | https://developers.cloudflare.com/workers/runtime-apis/web-crypto/ | 2026-10-18 | high |
| Workflows `waitForEvent` default timeout 24 h; `sendEvent({type,payload})`; step results ≤1 MiB; step timeouts ≤30 min | https://developers.cloudflare.com/workflows/build/workers-api/ ; https://developers.cloudflare.com/workflows/build/rules-of-workflows/ | 2026-10-18 | high |
| three.js latest 0.186.1; SkeletonUtils exports `retarget`, `retargetClip`, `clone` with listed options | https://registry.npmjs.org/three/latest ; https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/jsm/utils/SkeletonUtils.js | 2026-10-18 | high |
| UniRig: MIT licence; skeleton + skinning prediction released; full Rig-XL/VRoid checkpoints planned | https://raw.githubusercontent.com/VAST-AI-Research/UniRig/main/README.md | 2026-10-18 | high |
| `universal-modder` fal-assets skill uses trellis-2 → meshy/rigging → tripo remesh | local: `/tmp/claude-0/-home-user/d5596183-032b-5cac-9516-8839e0bfb562/scratchpad/repos/universal-modder/skills/fal-assets/SKILL.md` lines 74–84 | 2026-10-18 | high |

## Unverified

- UNVERIFIED: whether fal's hosted H3 Max / H3 Max Turbo (and MiniMax's partner `minimax/h3/*` API) are licensed for US customers and US-distributed outputs despite the community licence's excluded territories.
- UNVERIFIED: whether the H3 licence's "MiniMax H3" UI-display duty and its downstream "bind users to terms" duty (§V.2) apply to fal API customers.
- UNVERIFIED: end-to-end latency (queue plus inference plus upload) for every endpoint. Only vendor inference numbers exist (H3 table; ElevenLabs ~75–100 ms). Sunburst ≈27.7 s at high is third-party. Hunyuan Rapid ≈2–3 min is third-party.
- UNVERIFIED: video output container and codec (MP4/H.264 assumed) and whether `target_audio_url` produces lip-synced speech or only a pinned soundtrack.
- UNVERIFIED: GPT-image cost per *extra* input image. $0.01 is assumed from $8/M image-input tokens; OpenAI's calculator "does not estimate GPT Image 2.5 token usage".
- UNVERIFIED: OpenAI and Google policies on edits of identifiable real people via their image APIs (no primary page found).
- UNVERIFIED: Meshy rig bone names (vendor says Mixamo-style), presence of finger, face or blendshape data, and licence terms for Meshy library clips.
- UNVERIFIED: skeleton definition of `fal-ai/hunyuan-motion` FBX output.
- UNVERIFIED: units per call for `tripo3d/tripo/remesh` ($0.01/unit).
- UNVERIFIED: usability and pricing of unlisted `tripo3d/tripo/{rig,rig-check,retarget,animate}` and of `minimax/h3-max/reference-director`.
- UNVERIFIED: whether results remain retrievable via `response_url` when `X-Fal-Store-IO: 0` is set, and how long `GET …/requests/{id}` works after completion.
- UNVERIFIED: fal CDN responses include `Content-Length` (needed to stream `fetch().body` into `R2.put`).
- UNVERIFIED: licence chain of `minimax/music-3`, `google/lyria-3.5` and `lightricks/ltx-2.5` (open model) outputs for a commercial game.
- UNVERIFIED: Mixamo status (no Adobe primary source found; secondary sources say free, maintenance mode, no API).
- UNVERIFIED: fal's "Verify fal-Generated Content" provenance mechanism (C2PA or watermark).

## Recommendations for the spec

1. **Name the endpoints exactly in config, never in code.** Add `packages/genai-core/registry.ts` with the allowlist in §4.2 and a `pricing.json` snapshot (`checkedAt: 2026-10-18`). CI fails if any `fal` call uses an id outside the registry. Re-verify prices monthly with the authenticated fal pricing API and `/v1/models/pricing/estimate`.
2. **Map the owner's names:** "Minimax H3 Max Turbo" → `minimax/h3-max-turbo/image-to-video` (default shot renderer) plus `…/extend-video`. Add `minimax/h3-max/reference-to-video` for subject-consistent shots, because Turbo has no reference mode. "OpenAI Sunburst" → `openai/gpt-image-2.5/sunburst/edit` for sheets and keyframes, with `…/flare/edit` for drafts.
3. **Add ADR-GENAI-01 (legal gate) before M05b.** Get written confirmation from fal (and MiniMax for `minimax/h3/*`) that H3-family outputs may be used in a US-distributed commercial game. Until it is recorded, `legalGate` blocks H3 endpoints for production keys, and `video.fallback` = `google/gemini-omni-flash/v1.1/reference-to-video` (alternate `fal-ai/kling-video/o3/pro/reference-to-video`). Display "Cutscenes generated with MiniMax H3 Max via fal" in credits and settings regardless.
4. **Use the keyframe-first cutscene recipe (§2.1 K) by default and Ref2V for fighters.** Story shots are ≤15 s, 768P, `prompt_expansion_mode: "disabled"`, fixed seed, 16:9 (9:16 for phone-portrait UI, if ever). Every cutscene also keeps its in-engine `DirectorScript` fallback (R-CUT-03).
5. **Extend the C09 cache key** with `gen.endpointUpdatedAt`, all generation params and sha256 of every input file (§2.2). Store `expanded_prompt` and `seed` in the manifest row.
6. **Run every fal call through one `GenJobWorkflow`** (§4.2). It does cache check → budget reserve → submit with `fal_webhook` → `waitForEvent('fal-done', 20 min)` → status/result poll fallback (webhook retries can stop after ≈6 min) → stream to R2 → record. Verify webhooks with ED25519 against the JWKS (strip `=` padding; KV cache ≤24 h; ±300 s). Answer 2xx within 15 s.
7. **Never expose fal to the browser** (fal ToS §4(b)). `FAL_KEY` is a Worker secret. Clients call typed endpoints only (`POST /api/v1/gen/cutscene`, `/gen/npc`), validated by zod schemas derived from the fal OpenAPI. No `@fal-ai/server-proxy` passthrough.
8. **Concurrency and budget controls (R-ENG-03).** Use a Durable Object semaphore sized to the fal account limit (2 at start; buy credits to reach ≥10 before roster prewarm). Set a daily spend cap and a per-user quota. Add an admin-only prewarm Queue. Track spend with fal usage APIs and alert at 50/80/100% of budget.
9. **Character pipeline = §3.1 Standard tier.** Sunburst turnaround sheet in a fixed 4-panel T-pose layout, then programmatic crops, then `meshy/v7.1/multi-image-to-3d` (`pose_mode: "t-pose"`, `target_polycount` 30k hero / 12k crowd, PBR, `enable_rigging: false`), then `fal-ai/meshy/rigging/multi-animation`, then gltf-transform LODs/KTX2/meshopt, then QA gates. Use the Lean tier for user NPCs.
10. **One skeleton family.** Rig every NPC with Meshy. Share library clips by bone name. Keep a canonical mannequin rig and `bay_rig_v1.json` bone map in the repo. Bake foreign clips offline with `SkeletonUtils.retargetClip` (`three@0.186.1`). Do not retarget at runtime on mobile.
11. **Human gates are explicit tasks**, not hopes: tier approval, best-of-N picks, rig spot-checks, accessory fixes, fighter frame-data animation in Blender. Budget art-lead time per character (UNVERIFIED estimate: 20–40 min).
12. **Likeness enforcement in code (R-NPC-04, R-IP-02).**
    - `parody` and `fictionalized` tiers send no real-person photos and no names to any generator. A prompt linter checks names against NameRegistry.
    - The allowlist bans `minimax/h3-max/recast` and face-swap endpoints.
    - `*/voice-clone` is allowed only for `consented` with a consent record id.
    - All shared outputs are labelled "AI-generated".
13. **Voice.** Live NPC conversation uses ElevenLabs' native streaming API (`eleven_flash_v2_5` or `eleven_v4_turbo`) through the Worker. Pre-generated barks use fal TTS (`fal-ai/minimax/speech-2.8-turbo` with voice-design voices for parody tier, or `elevenlabs/tts/eleven-v4` presets), cached in R2 by `sha256(text + voiceId + model)`. Crowd lines can use `fal-ai/inworld-tts` ($0.01/1k) or Workers AI `aura-2-en`.
14. **Music is a legal-review item.** Do not ship AI music until the legal dimension clears a provider. ElevenLabs Music self-serve excludes Studio Games. MiniMax Music 3 and Lyria licences are unverified. Default to commissioned tracks.
15. **Storage hygiene.** Send `X-Fal-Object-Lifecycle-Preference: {"expiration_duration_seconds": 86400}` on every submit, and `X-Fal-Store-IO: 0` for user-uploaded content once retrievability is confirmed. R2 is the only long-term store.
16. **User NPC builder generation ships after auth and an 18+ gate** (fal ToS §4(b)). Before that, the builder is text-only or BYO-key local.
17. **M00 spike (1 day, ≤$30):** one end-to-end character (Standard tier) and three cutscene shots (recipes K and R plus fallback D). Measure queue and run latency, file sizes and codecs, and Meshy bone names. Test real-person refusal behaviour of Sunburst and Nano Banana. Record the results in `research/` before M05b and M10.

## Risks

- **Licence (high):** H3-family outputs may be unlicensed for US distribution. Mitigation: ADR-GENAI-01, config-level provider swap, and cache keys that include the endpoint.
- **Likeness and publicity (high):** a roster of real celebrities with photo-reference generation risks right-of-publicity and false-light claims. fal makes us indemnify; no provider has a parody exception. Mitigation: tier rules in §6.1 and legal sign-off per character.
- **Age gate (medium):** fal's 18+ End User clause conflicts with a teen-rated, auth-last game for any user-triggered generation. Mitigation: admin-only generation until auth.
- **Endpoint churn (medium):** H3 Max pages changed on 2026-10-16; Veo was deprecated; promos end. Mitigation: registry, `endpointUpdatedAt` in keys, monthly re-verification.
- **Webhook loss (medium):** retries stop ≈6 min after completion for large results. Mitigation: polling fallback in the Workflow.
- **Rig quality (medium):** hoodies, chains, hair and sneakers can break auto-rigging, and fingers and face may be missing. Mitigation: human gate, Blender fix path, jaw-bone lip-sync fallback.
- **Consistency drift (medium):** identity drifts across shots and models. Mitigation: keyframe-first recipe with the same sheet crops, fixed seeds, Ref2V with ≤4 square refs.
- **Cost overrun from retries or abuse (low–medium):** small absolute numbers, but uncapped user generation is open-ended. Mitigation: quotas, daily cap, Lean tier for users.
- **Concurrency bottleneck (low):** a limit of 2 slows roster batches. Mitigation: buy credits; batch overnight.

## Open questions

1. Will fal (and MiniMax) confirm in writing that H3 Max/Turbo and `minimax/h3/*` outputs are licensed for a US-distributed commercial game, and does the "MiniMax H3" UI-display duty apply? (blocks ADR-GENAI-01)
2. Which roster characters will be `consented` (signed likeness and voice releases) versus `parody` or `fictionalized`? Does the owner accept that parody-tier characters get no photo references and no cloned voices?
3. Does the owner accept Gemini Omni Flash 1.1 or Kling O3 as the production fallback if H3 clearance is slow?
4. Target cutscene resolution and length: is 768p enough for desktop "ultra", or is 1080p needed (doubles cost)? Is any phone-portrait 9:16 variant required?
5. Is fighter animation authoring (60–80 clips per fighter) budgeted as human Blender work, or should v1 limit fighters to library moves plus a few custom specials?
6. Should roster production run as a local/CI CLI (art lead's fal account) or only through the hosted Workflow? This affects who holds the production `FAL_KEY` and its scopes.
7. Music: commission tracks, or license an AI music provider after legal review?
8. What is the monthly GenAI budget ceiling to encode as the hard daily cap (G3)?

