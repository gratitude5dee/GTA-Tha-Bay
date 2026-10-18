# ADR-0022 — GenAI pipeline and cutscene delivery

**Status:** accepted · **Date:** 2026-10-18 · **Decides:** spec/03 D-18, D-19, D-20; R-NPC-02, R-CUT-01…03, R-ENG-03

## Context
Characters (sheet → mesh → rig) and cutscenes are generated on fal.ai, once, and cached. fal bills per use with no spend cap [F-048], forbids exposing its APIs to end users [F-042], delivers via a queue with ED25519-signed webhooks whose retries stop after about 6 minutes for results of 10 KB or more [F-047], and serves outputs from a CDN where copies expire. Workers AI has no video or 3D models [F-025]. Workflows allow 500 k steps and 1 MiB per step result [F-024]. fal's H3 outputs are H.264 MP4 at 1344×768, 24 fps with AAC and a fal C2PA manifest that transcoding strips [F-043]. Video licensing is gated separately (ADR-GENAI-01).

## Options considered
1. **On-demand generation from the player's path.** Breaks fal's no-direct-exposure term, has no cap, and blocks the game on a vendor [F-042, F-048].
2. **Cloudflare Stream for playback.** No offline caching and missing CORP; incompatible with the isolated page [research/gap-cutscene-delivery-playback.md].
3. **One `<video>` per cutscene created at play time.** iOS needs a user gesture per element, and Low Power Mode blocks video without one [F-063].
4. **Offline, internal generation with a release-time index; a pooled player with an in-engine fallback** (chosen).

## Decision
**Registry (D-18).** Every endpoint id, role, price (decimal list price with `checkedAt`), `status`, `pinnedUpdatedAt` and terms snapshot lives in `config/genai-endpoints.json`; a nightly keyless `genai:liveness` fails on a missing id, a non-`active` status or a licence type other than `commercial`. Initial ids: sheet `openai/gpt-image-2.5/sunburst/edit` [F-044]; mesh `meshy/v7.1/multi-image-to-3d` (T-pose) and rig `fal-ai/meshy/rigging/multi-animation` [F-045]; TTS `fal-ai/minimax/speech-2.8-{turbo,hd}` [F-046], listed but not funded in the v1 baseline (voices use Workers AI, DL-171). Banned: `recast`, face-swap endpoints, non-consented voice cloning and `seedance-2.5/image-to-video`. Video providers follow ADR-GENAI-01.

**Jobs (D-19).** `CutsceneJobDO` (`idFromName(key)`) is the single-flight lock; one `GenJobWorkflow` runs: likeness gate → cache check (R2 `HEAD`) → budget reserve → acquire → submit with webhook → wait for the webhook, with a polling fallback → copy to R2 immediately → transcode in a Container (ffmpeg; renditions `v540`, `v768`, `v1080`, or `p720` with `degraded`) → captions (Whisper) → QA → re-gate → record. The manifest is written last. Generation is internal-only in v1 (admin routes, staff key); Queues only fan out prewarm. A cache miss on the player's path never starts generation.

**Playback (D-20).** A pool of three muted `<video>` elements is unlocked at the first user gesture and reused; cutscene audio plays through the `AudioContext` (`a.m4a`, absent when engine audio is used). Fight intros are composed from clips with ManagedMediaSource in sequence mode, ping-pong as fallback; Quest uses a media layer; Vision Pro uses `VideoFrameTexture`. The in-engine `DirectorScript` is armed before the video-or-fallback decision, so the fallback starts without a gap and mission state is identical on both paths. Subtitles use one WebVTT renderer; an "AI-generated" badge accompanies every generated clip. "Keep offline" stores the tier rendition, audio, poster and subtitles (cap 300 MB on mobile, LRU).

**Scope under the cap.** Generation follows the priority list that stops at the $40 cutscene line (ADR-0015, DL-173); everything else uses the in-engine director (R-CUT-03).

## Consequences
- (+) The game never blocks on a vendor; a repeated request makes zero fal calls.
- (+) Pipeline stages are testable with `MockFalPort` and recorded fixtures (`FAL_MODE=mock`).
- (−) No late or on-demand cutscenes; content is prewarmed before release.
- (−) A Container transcoder and a Whisper pass add moving parts; Workflow `waitForEvent` limits and Container config keys are UNVERIFIED (U-AST-5, U-AST-6).
- (−) Safari MSE gaps and Low Power Mode video behaviour on real devices are recorded in M04c, not asserted.

## Affected contracts and milestones
C07 (`GenJob`, registry types), C09 (manifest, `CutscenePlayer`), C12 (route 27, `CutsceneStatus`), C13 (`FirstGestureUnlock`, video pool, `XrMediaHost`). M00b (registry), M00c (spike), M04c (playback spike), M05b1–M05b2, M05c2–M05c3, M08b2, M10b, M11b2.

## Links
`research/genai-pipeline-fal.md`; `research/gap-cutscene-delivery-playback.md` §7; `spec/domains/05-assets.md`, `05-assets-pipeline.md`; `03-story-cutscenes.md`; `spec/11-decision-log.md` DL-019, DL-045, DL-072, DL-173; ADR-0003, ADR-0013, ADR-GENAI-01.
