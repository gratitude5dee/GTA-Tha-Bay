# GenAI spike results (M00c)

Status: **skipped** (FAL_KEY not set). Env `previs`. Ledger $0.00 of cap $4.00.
Tools: ffprobe present, c2patool absent. Metadata only: no media, no fal CDN URLs, no keys.

## Steps

| Step | Title | Endpoint | Registry | Status | Request | Queue ms | Run ms | HTTP | error_type | Reason |
|---|---|---|---|---|---|---|---|---|---|---|
| C1 | Turnaround sheet of spike_runner | openai/gpt-image-2.5/sunburst/text-to-image | - | not_run | - | - | - | - | - | FAL_KEY not set |
| C2 | Programmatic crops: front, left, back, right | - | - | not_run | - | - | - | - | - | FAL_KEY not set |
| C3 | Mesh from four crops | meshy/v7.1/multi-image-to-3d | - | not_run | - | - | - | - | - | FAL_KEY not set |
| C4 | Rig with five library clips | fal-ai/meshy/rigging/multi-animation | - | not_run | - | - | - | - | - | FAL_KEY not set |
| C5 | GLB probe: bones, clips, triangles | - | - | not_run | - | - | - | - | - | FAL_KEY not set |
| K1 | Keyframe on the stage | openai/gpt-image-2.5/sunburst/edit | - | not_run | - | - | - | - | - | FAL_KEY not set |
| V1 | Recipe K, default provider | h3.partner#i2v | - | not_run | - | - | - | - | - | FAL_KEY not set |
| V2 | Recipe R, reference to video | h3.max#ref2v | - | not_run | - | - | - | - | - | FAL_KEY not set |
| V3 | Fallback provider | ltx25.fast#i2v | - | not_run | - | - | - | - | - | FAL_KEY not set |
| V4 | Provider clip, H3 Max Turbo | h3.maxTurbo#i2v | - | not_run | - | - | - | - | - | FAL_KEY not set |
| V5 | Provider clip, Gemini Omni Flash | gemini.omniFlash11#ref2v | - | not_run | - | - | - | - | - | FAL_KEY not set |
| A1 | TTS line, retrievability with X-Fal-Store-IO: 0 | fal-ai/minimax/speech-2.8-turbo | - | not_run | - | - | - | - | - | FAL_KEY not set |
| R1 | Refusal probe on the operator's own photo (optional) | openai/gpt-image-2.5/sunburst/edit | - | not_run | - | - | - | - | - | FAL_KEY not set |

## Outputs

None.

## U-items

| Item | Question | Outcome | Detail |
|---|---|---|---|
| U-AST-1 | Meshy bone names, finger/jaw/face bones, animation clip licence text | skipped | FAL_KEY not set |
| U-ENG-7 | Meshy rig bone names for the bay_rig_v1 alias table | skipped | FAL_KEY not set |
| U-AST-2 | Meshy honours the image_urls order (front, left, back, right) | skipped | FAL_KEY not set |
| U-AST-3 | fal CDN Content-Length; retrieval with X-Fal-Store-IO: 0 | skipped | FAL_KEY not set |
| U-AST-4 | C2PA presence on outputs of each endpoint | skipped | FAL_KEY not set |
| U-AST-7 | Cost of extra input images (invoice line) | skipped | FAL_KEY not set |
| U-AST-8 | Refusal behaviour on real-person edits | skipped | FAL_KEY not set |
| U-AST-14 | TTS container (the iOS decode test is a device check in M01c) | skipped | FAL_KEY not set |
| U-AST-17 | Art-lead minutes per character | skipped | FAL_KEY not set |
| U-S03-1 | Identity across K1, V1 and V4 | skipped | FAL_KEY not set |
| U-S03-3 | seed and prompt_expansion_mode accepted per endpoint | skipped | FAL_KEY not set |
