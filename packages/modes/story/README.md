# @dv/mode-story

The story mode adapter (M05a1): the mission authoring builder, the compiler that turns an authored mission into C09 IR, and the mission VM that runs that IR on the sim scheduler. It owns no content; missions live in `content/missions/<id>/` and ship as `data/mission.<id>` assets.

## Layout and import rules

| Path | Holds | Imports |
|---|---|---|
| `src/authoring/**` | the typed builder (`mission()`, `stage()`, `obj.*`, `op.*`, `when.*`) | `@dv/shared` types only |
| `src/compiler/**` | validate, lint (13 error codes), resolve (world references against a `WorldResolver`), emit | `@dv/shared` |
| `src/vm/**` | `MissionRuntime`: op runner, objectives, predicates, tasks, checkpoints, hooks | `@dv/shared`, `@dv/engine/sim`; C02 determinism lint applies |
| `src/mode.ts` | the C06 `GameModeDescriptor` for the story mode | as above |
| `src/debug/**` | the QA mission bridge (`window.__dvBridge.mission`) and DOM overlay | DOM; reached only behind `import.meta.env.VITE_DV_QA === '1'` |

## Build and test

```bash
pnpm missions:build            # content/missions/** -> assets/src/data/mission.<id> (deterministic; -- --check verifies)
pnpm --filter @dv/mode-story test
```

## See it

In a QA build (`pnpm dev`, default scene or `DV_WORLD=synth`), open `/?mission=m.dev.sample&seed=1&talk=scripted`, or click **start m.dev.sample** in the mission panel at the bottom left. The panel lists the live threads, objectives, cast, flags and events, with pause, step, skip stage, pass, fail, retry and quit. The same calls are `window.__dvBridge.mission.state()`, `jump(n)`, `pass()`, `fail()`, `events()`. Flags: `stage=<n>`, `seed=<n>`, `talk=scripted`, `beats=instant`.
