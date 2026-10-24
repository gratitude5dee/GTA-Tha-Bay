# @dv/npc

The client side of the NPC runtime ([spec/domains/04-npc.md](../../spec/domains/04-npc.md) section 3). Imports `@dv/shared` and `inkjs` only. M06a3 ships:

| Part | File | What it does |
|---|---|---|
| `DialogueClient` | `src/client/dialogue-client.ts` | POSTs a turn to route 31 and reads the answer with a streamed `fetch` body (not `EventSource`). Every event goes to a callback as it arrives; the result says how the turn ended. It never throws for a network or server failure. |
| SSE framing | `src/client/sse.ts` | Cuts frames at a blank line, so any chunk split gives the same events (also CRLF and multi-byte characters). |
| `NpcRuntime` | `src/client/runtime.ts` | `talk`, `playKnot`, `refreshFlags`, `endEncounter`, `roster`, `voiceSetting`. On a `fallback` event, a network failure or an offline `ApiError` code (`quota_exhausted`, `budget_offline`, `kill_switched`, `upstream_unavailable`) it continues in ink from the right knot, with no error. The setting `npc.aiDialogue = false` and a missing play token go straight to ink. |
| `InkRunner` | `src/ink/ink-runner.ts` | Plays the compiled ink of one NPC (`data/ink.<id>`). The inkjs runtime loads when the first story is made. A knot the story lacks falls back to `smalltalk`, `greeting`, `busy`. |
| Debug overlay | `src/debug/overlay.ts` | QA builds only. `window.__dvBridge.npc.talk(npcId, turn)` and a small panel with the AI badge, the streamed line, the source (live, recorded fixture, ink) and the event order. M06a4 adds a Voice switch and a 3x3 mouth readout (the lit cell is the current Rhubarb shape). |
| `TtsPlayer` (M06a4) | `src/tts/tts-player.ts` | Plays the `line.delta {audio}` chunks of a stream: joins the chunks of a sentence, decodes, schedules sentences back to back on the `voice` bus and ducks the music. Does nothing before the first-gesture unlock. Emits `npc.voice.client {ttfaMs, tier}`. |
| `LipSyncDriver` (M06a4) | `src/lipsync/` | Turns viseme cues (t2 alignment) or an analyser RMS envelope (t1) into a mouth atlas cell with a 60 ms hold; the jaw bone moves only when the rig has one; at most two speakers. |

The executor (`validateTurn`) is pure and lives in `@dv/shared/npc` so the Worker can import it; this package re-exports it.

## Telemetry

Each turn records `npc.turn.client {ttftMs, fallback, reason?}` and each closed encounter `npc.encounter.client {turns, fallbacks, voiceTier, model}`. Counts and enums only: never text, ids or the play token.

## Tests

`pnpm --filter @dv/npc test` (Vitest): chunk-split streams at every byte offset, a mid-stream drop, each offline code, the flag poll, the ink knots and their fallbacks, and the 50 KB limit of the shipped ink. The browser behaviour of the panel is `tests/e2e/npc-dialogue.spec.ts` (`@npc-dialogue`, Chromium and WebKit).

## Evals (M06a4)

`pnpm npc:eval -- --replay` plays `evals/` (red-team probes, the five builder probes, ten golden conversations for each of the five souls) against recordings keyed by the sha256 of the request body, and gates on the deterministic checks. `--live` and `--record` need `ANTHROPIC_EVALS_KEY` and print a SKIP line without it. The shipped recordings are synthetic (`source: synthetic`). The Sonnet judge is report-only until M10c. CI runs the replay in the content job; `.github/workflows/weekly.yml` runs the live pass.

## Not here yet

The real dialogue panel, the likeness card and the report button are M06a5. Intents and barks are M06c.
