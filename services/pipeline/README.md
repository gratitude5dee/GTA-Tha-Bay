# @dv/pipeline

Generative-AI job pipeline, compiled into the `tha-bay-web` Worker (no cross-Worker binding: a Preview's service bindings call production). M05b1 delivers the `cutscene_shot` job over mocks; M05c3 adds the Transcoder Container and the prewarm CLI (`tools/assets/gen/`). The live run still waits for ADR-GENAI-01 `cleared`, `FAL_KEY` and the owner's go.

| Path | What it is |
|---|---|
| `src/ports.ts` | `FalPort`, `BlobPort`, `RosterPort`, `BudgetPort`, `FlagsPort`, `ClockPort`, `TranscodePort`, `SignPort`, `FalGatePort`, `JobSinkPort`. Port results are plain data, so step results stay JSON and under 1 MiB. |
| `src/gate.ts` | `assertStageAllowed` / `evaluateGate`: tier, kill state, provider status, prompt lint, then (from `budget-reserve` on) kill switches and the governor level. Production and `FAL_MODE=live` need a `cleared` provider. |
| `src/steps/cutscene.ts` | `runCutsceneJob(step, ctx, job)`: gate, cache-check, budget-reserve, acquire, keyframes, plan, submit, wait, poll, copy-orig, transcode, captions, qa-gate, resign, subs, publish (manifest last), record. Runs over a real `WorkflowStep` or the shim in `check:pipeline`. |
| `src/workflow.ts` | `GenJobWorkflow` (needs `cloudflare:workers`). |
| `src/do/FalGateDO.ts` | Semaphore sized by `genai.falConcurrency`; slots carry a TTL; release always runs. |
| `src/fal.ts` | `verifyFalWebhook` (ED25519, JWKS cached at most 24 h, +-300 s), `handleFalWebhook` (route 29), `LiveFalPort`. |
| `src/mock/` | `MockFalPort` (replays the fixture clip, posts a webhook signed with the fixed test key), `MockTranscodePort`, `MockSignPort`. |
| `src/transcode.ts` | The live `TranscodePort` and `SignPort` (M05c3): HTTP clients of the Transcoder Container, one instance per cutscene key. `ready()` of each is the job's preflight before any money moves. |
| `src/do/TranscoderContainerDO.ts` | `TranscoderContainer` (`extends Container`, `@cloudflare/containers`): the Durable Object class the `TRANSCODER` binding and the `containers` application of `wrangler.jsonc` point at. Production only. |
| `transcoder/` | The container image: `Dockerfile` (ubuntu 24.04, ffmpeg 6.1.1, Node 22.22.0, `@contentauth/c2pa-node` 0.9.10), `ladder.sh` (recipe `cut@1`), `server.ts` (`/ping`, `/health`, `/ladder`, `/resign`). Not a workspace package; `package-lock.json` is for the image's `npm ci`. |
| `fixtures/` | `cutscene/` (orig, two renditions re-signed with the pinned C2PA tool, poster, last frame, VTT), `cutscene-data.ts` (generated base64 copy for the Worker bundle), `sign-fixtures.ts` (regenerates both), `c2pa-signer.json` (pinned tool). |
| `scripts/check-pipeline.ts` | `pnpm check:pipeline`. |
| `src/core.ts` | Everything above except the classes that import `cloudflare:workers`; `@dv/pipeline/core` is safe to import from Node. |

Commands (repository root):

```bash
pnpm check:pipeline            # one mock job end to end, then the same key again: 0 FalPort calls
pnpm check:workers             # the Workflow, DOs and routes inside workerd (cutscene-singleflight, genjob-poll-fallback, ...)
pnpm check:c2pa                # shipped cutscene manifests keep origSha256, aiGenerated and the re-sign; --env prod demands the re-sign
pnpm assets:gen prewarm -- --release <tag> --offline   # the Act 1 plan and its USD 16 line, no network (M05c3)
tsx services/pipeline/fixtures/sign-fixtures.ts   # rebuild and re-sign the fixtures (needs ffmpeg, openssl, npm)
```

Rules that hold here: spend is integer USD micros; fal is never called from a browser or from CI; the original (`orig.mp4`) is stored in `PRIVATE` only; `manifest.json` is written last and is the ready test.
