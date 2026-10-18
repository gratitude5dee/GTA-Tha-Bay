# M06a5 — dialogue-panel-ui

## Goal
Talking to an NPC has a real interface that replaces the M06a3 debug overlay. `DialogueBubble` (`packages/ui/src/dialogue`) shows the speaker name, reveals the streamed line no faster than its audio plays, and offers intent choices as buttons plus optional typed text. It carries a persistent **AI character** badge and swaps to the offline ink line on `fallback` without any error UI. A fixed out-of-character safety card with a crisis resource (988, US) appears when the player's own words match the self-harm list. `LikenessCard` shows the disclaimer the first time a save profile meets a non-original NPC. The report button exists but stays hidden until route 41 lands in M06b2 (spec/05 route 41 note). Subtitles feed `hud.subtitle`. Every part is keyboard, gamepad and touch operable and meets the S10 accessibility baseline.

## Requirements
- R-NPC-05: the player always gets a line, from the model or from ink, and the panel never shows an error for the offline paths.
- R-IP-03: the report surface is built into the panel and wired to C12 `ReportReq`; it becomes visible when route 41 exists.
- R-ENG-04: subtitles for every line, reduced motion, contrast, ≥ 44 px targets, focus order, Esc/`UiBack` closes.

## Depends on
- **M06a3** (dialogue-proxy): `NpcRuntime.talk` events, `InkRunner`, `packages/shared/src/npc/safety-lists.ts`, the QA bridge `__dvBridge.npc`.
- **M04b2** (creator-phone-hud-kit): HUD grid, the `Subtitles` widget, kit components, `ReportButton`, the `UgcSurface` lint, touch layouts, `UiPrefs`.
- Contracts: C06 1.1 (`UiBridge`, `VmKey` `hud.subtitle` and `sys.*`), C10 1.1 (`DialogueEvent` incl. `meta.data.safety?`, `CompiledSoulPublic.disclaimer`, `PlayerIntent`), C05 1.1 (`StorySlice.npcRelations[id].met`, `ProfileSettings.npc`), C12 1.1 (`ReportReq`, `ModSubject 'chat_turn'`).

## Scope in
- **`DialogueSession`** adapter (main thread) turns `NpcRuntime` events into a view state: speaker, revealed text, full text, choices, badge, fallback flag and closed flag. It opens on `sys.dialogue.open` (patched by the Talk handler from M06c, or by `__dvBridge.npc.talk` in QA builds) and closes on `done {closed:true}`, a `farewell` intent, Esc or `UiBack`.
- **Reveal rule:** text appears progressively, never ahead of the audio clock when audio plays, and all at once when voice is off. The full line is always available, as is a "show full line" control.
- **Intent choices:** `greet`, `smalltalk`, `ask_mission` (only when `offers.missionIds` is non-empty), `trade`, `compliment`, `farewell`. Free text up to 280 chars on flat screens (XR text entry is flat-only, DL-142).
- **AI badge:** persistent while the panel is open, driven by `meta.disclosure.aiCharacter`, with icon and text, and present on ink fallback lines too.
- **Safety card:** shown when the player's typed text matches the shared self-harm list, or when `effects.endConversation` follows such a text. It carries fixed copy and the 988 resource, and only "Close" and "Resources" actions.
- **`LikenessCard`:** when `npcRelations[id].met` is false and `disclaimer ≠ 'none'`, show the §5.10 text for `parody`, `fictional` or `courtesy` once, before the first line. It is then marked met through the existing `talk` path; never write C05 from the UI directly.
- **`ReportButton`** inside the panel posts `ReportReq {target:{kind:'chat_turn', id:'<encounterId>:<turnIndex>'}, category}`. It renders only when `dialogueCapabilities.reports` is true (`packages/ui/src/dialogue/capabilities.ts`, default `false`; M06b2 sets it). The `UgcSurface` lint already accepts the panel because the component is present.
- **Subtitles:** each line (model or ink) is patched as `hud.subtitle {speaker, text, startMs, endMs}`, and each cue stays up for at least `max(1.5 s, 0.06 s × chars)`.
- Platform: phone-sized panel layout on the bottom half and a desktop side panel. XR bubbles are out of scope (M11b2).

## Scope out
- The visible report flow and route 41: M06b2. NPC builder screens: M06b3. XR bubble and head-locked caption: M11b2/M11b3.
- Producing the asynchronous crisis signal (M06b1 sets it; M06a3 carries it).

## Deliverables
- `packages/ui/src/dialogue/{DialogueBubble.tsx, LikenessCard.tsx, SafetyCard.tsx, IntentChoices.tsx, session.ts, capabilities.ts, reveal.ts, index.ts}`, `packages/ui/src/dialogue/dialogue.css` (tokens only).
- `dialogue.*` LocKeys (disclaimer and crisis copy) in the `en` catalog M04b1 created.
- `packages/ui/test/dialogue/{reveal.spec.ts, session.spec.ts, likeness-card.spec.ts, report.spec.ts, a11y.spec.ts}`.
- `tests/e2e/npc-dialogue.spec.ts` (`@npc`, `@npc-offline`, plus one `@ui-a11y` panel case) with `tests/e2e/fixtures/npc/talk-happy.sse`.
- `packages/npc/src/debug/overlay.ts`: hidden when the real panel is mounted.
- About 17 files.

## Interfaces
- C06 1.1 `UiBridge`: `hud.subtitle` and `sys.dialogue.open` keys (inside the existing `sys.${string}` and `hud.${string}` patterns; no shape change).
- C10 1.1 `DialogueEvent` (a `meta` with `safety: 'crisis'` shows the crisis card before the line, DL-226), `PlayerIntent`; C12 1.1 `ReportReq` (client type only).
- No contract change.

## Acceptance criteria
- AC-1 Given a QA build with route 31 intercepted to replay `talk-happy.sse` When the player opens a conversation with `npc_test` and picks "Greet" Then the bubble shows the speaker name and the streamed line, the AI character badge is visible for the whole exchange, a matching `hud.subtitle` cue appears, the report button is absent, and the panel closes after `done {closed:true}` — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @npc`
- AC-2 Given route 31 aborted at the network layer When the player greets `npc_test` Then the `greeting` line from `data/ink.npc_test` appears with the badge, no error dialog or error toast appears, and the telemetry queue holds `npc.turn.client` with `fallback: true` — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @npc-offline`
- AC-3 Given audio of 2.0 s for a 20-word line and a fake clock When the line streams in one delta Then at 0.5 s no more than 30 % of the words are revealed, at 2.0 s all are, and with voice `off` the whole line shows at once — proof: `pnpm check:unit -- packages/ui/test/dialogue`
- AC-4 Given souls with disclaimers `parody`, `fictional`, `courtesy` and `none` and `met: false` When each conversation opens Then the first three show their fixed text once before the first line and the fourth shows none; a second conversation with the same NPC shows no card — proof: `pnpm check:unit -- packages/ui/test/dialogue`
- AC-5 Given `dialogueCapabilities.reports = true` in a unit render When Report is activated on turn 2 of encounter E Then the injected API client receives `ReportReq` with `target {kind:'chat_turn', id:'E:2'}` and a category; with the default `false` the button is not rendered — proof: `pnpm check:unit -- packages/ui/test/dialogue`
- AC-6 Given typed text that matches the shared self-harm list When it is sent Then the safety card with the 988 resource appears and only Close and Resources are focusable; other text never shows it — proof: `pnpm check:unit -- packages/ui/test/dialogue`
- AC-7 Given the panel at `uiScale` 150 % on a 360 px wide viewport with reduced motion on When it is rendered and navigated by keyboard Then no control is clipped, every target is ≥ 44 px, focus order is speaker → line → choices → close, Esc closes, no transition exceeds 150 ms, and axe reports zero critical or serious issues — proof: `pnpm check:e2e -- --project=webkit-webgl2 --grep @ui-a11y`
- AC-8 Given the branch When CI and the preview deploy run Then unit, e2e and build jobs pass and the preview serves the panel in QA builds only — proof: `pnpm check:unit && pnpm deploy:preview`

## Test plan
- **Unit:** `ui/dialogue.reveal`, `ui/dialogue.session`, `ui/dialogue.likeness-card`, `ui/dialogue.report`, `ui/dialogue.a11y` — `pnpm check:unit -- packages/ui/test/dialogue`.
- **E2E:** `@npc` and `@npc-offline` on `chromium-webgl2`; the panel case added to `@ui-a11y` on `webkit-webgl2`.
- **Static:** the `ugc-surface` lint from M04b2 (`pnpm check:unit -- packages/ui`).

## Demo script
1. `pnpm dev`; in the console, `__dvBridge.npc.talk('npc_test', {intent:'greet'})`: the panel opens with the badge.
2. Block `/api/v1/npc/*` in devtools and greet again: the ink line appears with no error.
3. Type a self-harm phrase from the test list: the safety card appears.
4. Toggle reduced motion and 150 % UI scale; tab through the panel.

## Effort
0.3 Builder session; about 17 files; risk **low**.

## Risks & fallbacks
- **Audio clock unavailable before the first gesture:** reveal falls back to a text-speed reveal (word every 180 ms) and the line is never hidden.
- **Panel competes with HUD regions on small phones:** the panel takes `bc` and hides the minimap while open. Any choice beyond that is a Builder decision.
- **Asynchronous crisis signal:** the panel shows the card on `meta.data.safety === 'crisis'` (fixture-driven here; the live signal arrives with M06b1, DL-226).

## Notes for the Builder
- Read first: `10-ui-hud-xr.md` §2.10 (dialogue overlays) and §2.13; `04-npc.md` §5.1 (client), §5.5 and §5.10 (disclosure); `10-ui.md` §3.3 (`UiBridge`); `spec/05-api-and-realtime.md` route 41.
- Secrets: none. E2E uses route interception and never calls the real API.
- Copy is LocKey-based and passes `names:lint`. The display name comes only from `config/brand.ts`.
- Branch `m06a5-dialogue-panel-ui`.
