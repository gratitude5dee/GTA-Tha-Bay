# M06c — npc-agency-barks

## Goal
Named NPCs live in the city on their own. `ScheduleSystem`, `UtilitySystem` and a small in-house behaviour-tree library run in `sim.worker` at the C02 AI rate under LOD A, B and C, deterministic for a given seed. `whereIs` finds every named NPC at zero tick cost, so the minimap, phone and missions can query it. Heroes may ask route 32 for an LLM intent, throttled and cached, and recorded in the timeline so replays never ask again. The `InteractKind.Talk` handler opens the dialogue panel, and `ModeContext.npc` (C06 1.1) gives missions `whereIs`, `isKilled` and `playKnot`. Filler pedestrians and drivers bark from archetype pools with cooldowns and subtitles, and "Talk" on a filler plays a two-line ink exchange with no network call. Perf scenario `npc-mission-crowd` measures brain counts and cost per tier.

## Requirements
- R-NPC-01: roster NPCs follow their soul's schedule, places and goals; heroes get light LLM agency on top.
- R-MAP-04: the living city gains named-NPC routines and ambient barks layered on S02's pedestrians and traffic.

## Depends on
- **M06a3** (dialogue-proxy): `NpcRuntime`, `InkRunner`, upstream fixture mode, the Anthropic upstream and quota plumbing reused by route 32.
- **M03b2** (peds-transit): pedestrian agents (`amb:<cell>:<slot>`), the reaction FSM, the pedestrian route graph used by `whereIs` during `commute`.
- Contracts: C10 1.0 (§B2.5 intents, §B2.7 barks, `CompiledSoulPublic.schedule`), C06 1.1 (`ModeContext.npc`, `InteractKind.Talk`, `TimelineRecorder.external`, `weekdayOf`, `WorldClockApi`), C01 1.0 (component ids 768–775, `npc:<id>` keys), C02 1.1 (AI 30 Hz, RNG streams), C08 1.0 (`PoiId`, `WorldApi.places`), C13 1.1 (`PerfScenario`), C12 1.1 (route 32).

## Scope in
- **Components 768–775** (`04-npc.md` §3): `NpcIdentity`, `ScheduleCursor`, `NpcBrain`, `UtilityScores`, `Talkable`, `BarkEmitter`, `IntentGoal`, `NpcLod`, registered in the npc range.
- **Systems** (`packages/npc/src/brains`, run in `sim.worker`; `04-npc-builder.md` §C8). Apply the determinism ESLint config to `packages/npc/src/{brains,barks}/**` too. This is stricter than the C02 minimum scope; record it as a Builder decision:
  - `ScheduleSystem` picks the active block with `scheduleAt`.
  - `UtilitySystem` scores interrupts: threat, player proximity × trust, mission hooks, `interruptible`, `priority`.
  - `BtSystem` runs activity subtrees from in-house nodes: `Goto`, `Animate`, `UseSmartObject`, `Talk`, `Flee`.
  - `NpcLodSystem`: LOD A within 60 m (every 3rd AI tick, 10 Hz), B within 250 m (every 15th, 2 Hz, schedule movement only), C beyond (not simulated).
  - RNG stream seeded by `(worldSeed, npcId, gameDay)`. Per-tier LOD-A caps come from `config/npc.json`: desktop and desktop-ultra 8, xr-visionpro 8, xr-quest 6, mobile 4, mobile-low 3.
- **`whereIs(soul, clockT, poi, route?)`** in `packages/shared/src/npc/where.ts` (pure): the block's POI, or a position interpolated along the pedestrian route during `commute`. POIs come from `WorldApi.places`, and `content/npcs/poi.stub.json` is used only where a POI is missing (reported by `npc:lint` L2).
- **Intents, route 32** (`services/edge/src/npc/intent.ts`):
  - Haiku with `npc-intent-1.0` per soul version, under the same quota kind `turn`;
  - server cache of 10 min keyed by `(npcId, soulVersion, sha256(situation))`, where the hash excludes `clockT` and buckets distances to 10 m;
  - an invalid result becomes `continue_schedule` (`source:'default'`).
- **Client intent driver:**
  - triggers: block boundary; player within 40 m with |trust| ≥ 40; encounter ended; a `NearbyEvent` within 150 m; mission state change;
  - throttles: ≥ 60 s per NPC, ≤ 1 in flight and ≤ 6 per minute per client;
  - none while offline or at `mobile-low`;
  - results go to `sim.worker` as external input through `TimelineRecorder.external({src:'intent'})`, and replays read the recording.
- **Talk handler** for `InteractKind.Talk`: `canInteract` fails when the NPC is killed (`spawn`), busy (another encounter or a mission lock), or in a non-interruptible block. `begin` sets the BT to `Talk`, faces the player and patches `sys.dialogue.open`. The sim never pauses for dialogue.
- **`ModeContext.npc`** binding: `whereIs(npcId)`, `isKilled(npcId, scope)` (from `RosterFlags`), and `playKnot(npcId, knot, playId)`, whose lines arrive as `hud.subtitle` patches and whose end is the SimEvent `npc.knot.done`.
- **`BarkSystem`** (§C9):
  - pools `content/npcs/barks/<archetype>.json` and per-NPC pools validated by `bark-pool-1.0`;
  - weighted pick with the seeded RNG; cooldown 20 s per entity and 60 s for the same tag; at most 2 audible at once;
  - lines play their `audio_bark` when present, else subtitle only (pools ship with `audio: null` placeholders);
  - triggers from the M03b2 reaction FSM (`bump`, `car_crash_nearby`, `heat_*`, weather and night) and player events;
  - filler "Talk" plays the two-line `content/npcs/barks/<archetype>.ink` exchange locally.
- **Perf scenario `npc-mission-crowd`** (owned here): a seeded mission-hub path with 12 named NPCs and nominal density. `PerfReport` gains the brain-count and brain-ms readings in the existing counters block.

## Scope out
- Baked bark audio and roster ink lines: M10c. Shared agency in rooms and `EV NpcBusy`: not in v1 (DL-350; rooms run named NPCs locally per client). XR intent chips on panels: M11b2.
- Real-POI coverage for every soul is S02's (M02c1). This milestone only consumes it.

## Deliverables
- `packages/shared/src/npc/{where.ts, situation-hash.ts}`, `packages/shared/test/npc/{where.spec.ts, situation-hash.spec.ts}`.
- `packages/npc/src/brains/{components.ts, schedule-system.ts, utility-system.ts, bt.ts, bt-nodes.ts, lod-system.ts, talk-handler.ts, mode-context-npc.ts}`, `packages/npc/src/barks/{bark-system.ts, pools.ts}`, `packages/npc/src/client/intent-driver.ts`.
- `packages/npc/test/{brains.determinism.spec.ts, lod.spec.ts, talk-handler.spec.ts, barks.spec.ts, intent-driver.spec.ts, mode-context-npc.spec.ts}`.
- `services/edge/src/npc/intent.ts`, `services/edge/src/routes/npc-intent.ts`, `services/edge/test/npc-intent-throttle.test.ts`, `services/edge/test/fixtures/anthropic/intent-*.sse`.
- `content/npcs/barks/{civilian,vendor,police,founder,rapper}.json` and `.ink` (original placeholder lines, ≤ 80 chars each, passing `names:lint`).
- `config/npc.json` (LOD radii, caps per tier, throttles, intent TTL).
- the `npc-mission-crowd` camera path file, placed next to the existing scenario paths (M01c runner layout), plus its scenario registration; `tests/e2e/npc-barks.spec.ts` (`@npc-barks`).
- About 36 files.

## Interfaces
- C06 1.1: `ModeContext.npc`, `TimelineRecorder.external`, `InteractKind.Talk` (implemented, not changed).
- C10 1.0: `NPCIntentRequest`, `NpcIntent`, `NPCIntentResponse`, `BarkPool`, `BarkTag`.
- C12 1.1: route 32. C13 1.1: `PerfScenario.id = 'npc-mission-crowd'`.

## Acceptance criteria
- AC-1 Given seed 0xC0FFEE and 12 named NPCs When the headless sim runs 10 game minutes twice Then the per-tick brain traces (active block, BT node, utility winner) and the final state hash are identical, and changing one soul's schedule changes the trace — proof: `pnpm check:unit -- packages/npc/test/brains.determinism.spec.ts`
- AC-2 Given a schedule crossing midnight and a `commute` block When `whereIs` is evaluated at the block edges and mid-commute Then it returns the POI positions and the interpolated route point, and an NPC at LOD C runs 0 brain ticks while `whereIs` still answers — proof: `pnpm check:unit -- packages/shared/test/npc packages/npc/test/lod.spec.ts`
- AC-3 Given a crowd emitting `bump` 10 times in 5 s around one entity When barks fire Then that entity barks at most once per 20 s, the same tag at most once per 60 s, and never more than 2 barks are audible at once; each bark patches `hud.subtitle` — proof: `pnpm check:unit -- packages/npc/test/barks.spec.ts`
- AC-4 Given a hero and a client sending 8 intent requests in 60 s for 3 NPCs When route 32 and the client driver run Then at most 6 leave the client, at most 1 is in flight, a second request for the same NPC within 60 s is not sent, an identical situation within 10 min is answered with `cached: true` and no upstream call, and an invalid model result becomes `continue_schedule` with `source:'default'` — proof: `pnpm check:workers -- npc-intent-throttle && pnpm check:unit -- packages/npc/test/intent-driver.spec.ts`
- AC-5 Given a recorded run in which two intents arrived When it is replayed with the network disabled Then the replay reaches the same state hash and makes 0 intent requests — proof: `pnpm check:unit -- packages/npc/test/brains.determinism.spec.ts`
- AC-6 Given `npc_test` killed with scope `spawn`, busy in a mission lock, or in a `sleep` block When the player presses Talk Then `canInteract` fails with the matching reason; otherwise `sys.dialogue.open` is patched and the sim keeps ticking — proof: `pnpm check:unit -- packages/npc/test/talk-handler.spec.ts`
- AC-7 Given a mission sim using `ModeContext.npc` When it calls `playKnot('npc_test', 'greeting', 'p1')` offline Then the ink lines arrive as `hud.subtitle` patches and `npc.knot.done` fires once with `playId 'p1'`; `isKilled` reflects the roster flags — proof: `pnpm check:unit -- packages/npc/test/mode-context-npc.spec.ts`
- AC-8 Given the `mobile-low` tier or an offline client When intent triggers fire Then no intent request is made and NPCs follow their schedules — proof: `pnpm check:unit -- packages/npc/test/intent-driver.spec.ts`
- AC-9 Given scenario `npc-mission-crowd` on the four flat tiers When the perf runner executes it Then the number of LOD-A brains never exceeds that tier's cap, the report records brain ms per tick, and the counts stay within the tier budgets — proof: `pnpm check:perf -- --scenario npc-mission-crowd`
- AC-10 Given a QA build with request interception counting `/api/v1/*` calls When the player uses Talk on a filler pedestrian Then a two-line exchange from the archetype ink plays with subtitles and 0 API requests are made — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @npc-barks`

## Test plan
- **Unit:** `shared/npc.where`, `shared/npc.situation-hash`, `npc/brains.determinism`, `npc/lod`, `npc/barks`, `npc/talk-handler`, `npc/intent-driver`, `npc/mode-context-npc` — `pnpm check:unit -- packages/shared/test/npc packages/npc`.
- **Workers runtime:** `npc-intent-throttle` — `pnpm check:workers -- npc-intent-throttle`.
- **Perf (CPU-side, warn on PR, `--fail` nightly):** `pnpm check:perf -- --scenario npc-mission-crowd`. Brain time is reported; counts are asserted.
- **E2E:** `@npc-barks` on `chromium-webgl2`. **Lint:** the determinism rules cover the brain and bark paths (`pnpm lint`).

## Demo script
1. `pnpm dev`; teleport to the mission hub; open the QA overlay with LOD rings: named NPCs walk their schedules.
2. Skip the clock to 23:50 and watch the block change at midnight.
3. Bump a pedestrian twice: one bark with a subtitle, then cooldown.
4. Press Talk on a filler: two ink lines and no network calls in devtools.
5. `pnpm check:perf -- --scenario npc-mission-crowd`: read the brain counts per tier.

## Effort
1 Builder session; about 36 files; risk **medium** (BT and utility determinism, and the ≤ 0.3 ms brain budget at `mobile`).

## Risks & fallbacks
- **Brain cost above 0.3 ms per tick at `mobile`:** lower LOD-A caps in `config/npc.json` and drop LOD B to 1 Hz. The counts AC still holds.
- **POI gaps before every soul has real POIs:** stub positions are used and listed by `npc:lint` L2, and S02 fills the gaps.
- **Intent quality from Haiku:** invalid output always degrades to `continue_schedule`. Intents are optional flavour.

## Notes for the Builder
- Read first: `04-npc-builder.md` §C8–§C9; `04-npc.md` §5 and §6 (platform caps); `01-engine-save-modes.md` C06 1.1 section; `02-world-living.md` (pedestrian reaction events, M03b2).
- Secrets: `ANTHROPIC_API_KEY` for live intents (from M06a3). Without it, route 32 returns `continue_schedule` defaults and the tests use fixtures.
- Brains import no `three`, DOM or clock. The client intent driver lives outside `sim/` and feeds results in only through `TimelineRecorder.external`.
- Branch `m06c-npc-agency-barks`.
