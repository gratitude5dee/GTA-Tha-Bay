# @dv/mode-story

The story mode adapter (M05a1, M05a2): the mission authoring builder, the compiler that turns an authored mission into C09 IR, the mission VM that runs that IR on the sim scheduler, the autoplayer that plays a mission as a bot, and the in-engine cinematic director. It owns no content; missions live in `content/missions/<id>/` and ship as `data/mission.<id>` assets.

## Layout and import rules

| Path | Holds | Imports |
|---|---|---|
| `src/authoring/**` | the typed builder (`mission()`, `stage()`, `obj.*`, `op.*`, `when.*`) | `@dv/shared` types only |
| `src/compiler/**` | validate, lint (13 error codes), resolve (world references against a `WorldResolver`), emit | `@dv/shared` |
| `src/vm/**` | `MissionRuntime`: op runner, objectives, predicates, tasks, checkpoints, hooks | `@dv/shared`, `@dv/engine/sim`; C02 determinism lint applies |
| `src/mode.ts` | the C06 `GameModeDescriptor` for the story mode | as above |
| `src/autoplay/**` | the `story.autoplayer` bot (goals from objectives, movement policies, the observation surface); C02 lint applies | `@dv/shared`, `@dv/engine/qa` types |
| `src/director/**` | DirectorScript runner, auto-director, shot validation, the system the runtime drives; C02 lint applies | `@dv/shared` |
| `src/scenario.ts`, `src/specs.ts`, `src/qa.ts` | the headless `missions` scenario of the canonical runner and the det specs; QA builds and Node only | `@dv/engine/qa` |
| `src/debug/**` | the QA mission bridge (`window.__dvBridge.mission`) and DOM overlay | DOM; reached only behind `import.meta.env.VITE_DV_QA === '1'` |

## Build and test

```bash
pnpm missions:build            # content/missions/** -> assets/src/data/mission.<id> (deterministic; -- --check verifies)
pnpm --filter @dv/mode-story test
```

## See it

In a QA build (`pnpm dev`, default scene or `DV_WORLD=synth`), open `/?mission=m.dev.sample&seed=1&talk=scripted`, or click **start m.dev.sample** in the mission panel at the bottom left. The panel lists the live threads, objectives, cast, flags and events, with pause, step, skip stage, pass, fail, retry and quit. The same calls are `window.__dvBridge.mission.state()`, `jump(n)`, `pass()`, `fail()`, `events()`. Flags: `stage=<n>`, `seed=<n>`, `talk=scripted`, `beats=instant`.

## Bot, preview and director (M05a2)

```bash
pnpm check:missions [-- --mission <id> | --act <n>]     # every mission x 3 seeds x 2 runs under the autoplayer; writes test-results/missions/<id>.<seed>.{json,dvtl}
pnpm missions:preview -- --mission m.dev.sample --seed 1 # one run with the beats played; writes test-results/preview/<id>.<seed>.dvtl and lists the chapters
DV_UPDATE_GOLDEN=1 pnpm check:missions -- --mission m.dev.sample   # rewrites tests/golden/missions/m.dev.sample.1.json (a labelled PR only)
```

- **Autoplayer.** It reads `MissionObs` (`autoplay/observe.ts`: the active objectives, resolved zones, cast and player poses, a ray, the ground height and a route) and writes player 0's `InputFrame`; it never places an entity or sets an objective. `check:missions` fails a run that does not pass (the message names the objective it is stuck on), ends outside `expectedSec`, ends with another hash on its second run, or whose det run differs from its Node golden.
- **Preview.** `apps/web/qa/mission-preview.html` (QA builds) opens a `.dvtl`, scrubs the recorded tracks with a binary search (`lastBefore`), marks one chapter per `mis.stage` event and shows the `mis.say` subtitle at its tick. The file format is documented at the top of `packages/engine/src/sim/script/dvtl.ts`.
- **Director.** A `beat` op with a `director` ref runs the DirectorScript: actors on their start marks, the first shot on the arming tick, timed actions as NPC tasks, cues as `hud.subtitle`, actors on their end marks. `camera` ops use the auto-director. Both validate every shot (8 rays a tick, 6 alternates, a cut after 48 blocked ticks, the SF hill rule, clearance) and obey reduced motion and the XR vantage. Author scripts with `defineDirector` (`authoring/director.ts`); `missions:build` compiles `content/missions/<id>/director/*.ts` to `data/director.<id>`.
- **Live.** In a QA build `__dvBridge.mission.autoplay(true)` hands the controls to the bot (not an oracle: the live profile is `local`). Try it at `/?mission=m.dev.sample&seed=1&talk=scripted`: the intro is a cinematic shot, then the bot walks to the plaza and on.
