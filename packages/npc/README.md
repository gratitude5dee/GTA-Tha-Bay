# @dv/npc

The client side of the NPC runtime ([spec/domains/04-npc.md](../../spec/domains/04-npc.md) section 3). Imports `@dv/shared` and `inkjs` only. M06a3 ships:

| Part | File | What it does |
|---|---|---|
| `DialogueClient` | `src/client/dialogue-client.ts` | POSTs a turn to route 31 and reads the answer with a streamed `fetch` body (not `EventSource`). Every event goes to a callback as it arrives; the result says how the turn ended. It never throws for a network or server failure. |
| SSE framing | `src/client/sse.ts` | Cuts frames at a blank line, so any chunk split gives the same events (also CRLF and multi-byte characters). |
| `NpcRuntime` | `src/client/runtime.ts` | `talk`, `playKnot`, `refreshFlags`, `endEncounter`, `roster`, `voiceSetting`. On a `fallback` event, a network failure or an offline `ApiError` code (`quota_exhausted`, `budget_offline`, `kill_switched`, `upstream_unavailable`) it continues in ink from the right knot, with no error. The setting `npc.aiDialogue = false` and a missing play token go straight to ink. |
| `InkRunner` | `src/ink/ink-runner.ts` | Plays the compiled ink of one NPC (`data/ink.<id>`). The inkjs runtime loads when the first story is made. A knot the story lacks falls back to `smalltalk`, `greeting`, `busy`. |
| Debug overlay | `src/debug/overlay.ts` | QA builds only. `window.__dvBridge.npc.talk(npcId, turn)` and a small panel with the AI badge, the streamed line, the source (live, recorded fixture, ink) and the event order. |

The executor (`validateTurn`) is pure and lives in `@dv/shared/npc` so the Worker can import it; this package re-exports it.

## Telemetry

Each turn records `npc.turn.client {ttftMs, fallback, reason?}` and each closed encounter `npc.encounter.client {turns, fallbacks, voiceTier, model}`. Counts and enums only: never text, ids or the play token.

## Tests

`pnpm --filter @dv/npc test` (Vitest): chunk-split streams at every byte offset, a mid-stream drop, each offline code, the flag poll, the ink knots and their fallbacks, and the 50 KB limit of the shipped ink. The browser behaviour of the panel is `tests/e2e/npc-dialogue.spec.ts` (`@npc-dialogue`, Chromium and WebKit).

## Not here yet

Memory, TTS, lip-sync and the evals are M06a4. The real dialogue panel, the likeness card and the report button are M06a5. Intents and barks are M06c.
