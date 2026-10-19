# @dv/pipeline

Generative-AI job pipeline, compiled into the `tha-bay-web` Worker (no cross-Worker binding: a Preview's service bindings call production). M05b1 delivers the `cutscene_shot` job over mocks; the live run waits for ADR-GENAI-01 `cleared` and M05c3.

| Path | What it is |
|---|---|
| `src/ports.ts` | `FalPort`, `BlobPort`, `RosterPort`, `BudgetPort`, `FlagsPort`, `ClockPort`, `TranscodePort`, `SignPort`, `FalGatePort`, `JobSinkPort`. Port results are plain data, so step results stay JSON and under 1 MiB. |
| `src/gate.ts` | `assertStageAllowed` / `evaluateGate`: tier, kill state, provider status, prompt lint, then (from `budget-reserve` on) kill switches and the governor level. Production and `FAL_MODE=live` need a `cleared` provider. |
| `src/steps/cutscene.ts` | `runCutsceneJob(step, ctx, job)`: gate, cache-check, budget-reserve, acquire, keyframes, plan, submit, wait, poll, copy-orig, transcode, captions, qa-gate, resign, subs, publish (manifest last), record. Runs over a real `WorkflowStep` or the shim in `check:pipeline`. |
| `src/workflow.ts` | `GenJobWorkflow` (needs `cloudflare:workers`). |
| `src/do/FalGateDO.ts` | Semaphore sized by `genai.falConcurrency`; slots carry a TTL; release always runs. |
| `src/fal.ts` | `verifyFalWebhook` (ED25519, JWKS cached at most 24 h, +-300 s), `handleFalWebhook` (route 29), `LiveFalPort`. |
| `src/mock/` | `MockFalPort` (replays the fixture clip, posts a webhook signed with the fixed test key), `MockTranscodePort`, `MockSignPort`. |
| `fixtures/` | `cutscene/` (orig, two renditions re-signed with the pinned C2PA tool, poster, last frame, VTT), `cutscene-data.ts` (generated base64 copy for the Worker bundle), `sign-fixtures.ts` (regenerates both), `c2pa-signer.json` (pinned tool). |
| `scripts/check-pipeline.ts` | `pnpm check:pipeline`. |
| `src/core.ts` | Everything above except the classes that import `cloudflare:workers`; `@dv/pipeline/core` is safe to import from Node. |

Commands (repository root):

```bash
pnpm check:pipeline            # one mock job end to end, then the same key again: 0 FalPort calls
pnpm check:workers             # the Workflow, DOs and routes inside workerd (cutscene-singleflight, genjob-poll-fallback, ...)
pnpm check:c2pa                # shipped cutscene manifests keep origSha256, aiGenerated and the re-sign
tsx services/pipeline/fixtures/sign-fixtures.ts   # rebuild and re-sign the fixtures (needs ffmpeg, openssl, npm)
```

Rules that hold here: spend is integer USD micros; fal is never called from a browser or from CI; the original (`orig.mp4`) is stored in `PRIVATE` only; `manifest.json` is written last and is the ready test.
