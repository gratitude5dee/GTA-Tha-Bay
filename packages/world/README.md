# @dv/world

The streamed city (M02b1): chunk interest and residency, the statics feed into physics, the L0/L1/L2 meshers that run in `asset.worker`, the chunk renderer and its upload gate, the backdrop (DEM ring, massing, skyline cards) and the boot rule. It draws what `@dv/shared`'s world codec decodes from the packs that `pnpm map:build` bakes.

## Layout and import rules

| Path | Holds | Imports |
|---|---|---|
| `src/sim/**` | `ChunkStore`, streaming plan, priority, statics feed, boot set, the sim module (`worldStreamingModule`) | `@dv/shared`, `@dv/engine/sim` types; no `three`, no DOM; the C02 determinism lint applies |
| `src/client/**` | meshers, `ChunkRenderer`, `ChunkUploadGate`, materials, backdrop, `WorldView`, asset-worker jobs, the QA bridge | `three`, `@dv/engine`, `@dv/shared`, `earcut` |

`@dv/engine` never imports this package: the app composes it through `SimModule` (sim worker), `AssetJob` (asset worker) and `WorldLayer` (render), see `apps/web/src/workers/` and `apps/web/src/main.ts`.

## See the world

```bash
pnpm map:build -- --area synth      # bake the offline test city into dist/world
DV_WORLD=synth pnpm dev             # merge the bake into the media mirror and serve it
```

Open `/?perf=1&tier=mobile` or `/?tier=desktop`. Flags: `debug=1` (straight to play), `gl=1` (force WebGL2), `scenario=route-ferry-ocean-beach` (fly the perf route). With the QA build `window.__dvBridge.world` reports `chunks()`, `backdrop()`, `boot()` and more.

## Scripts

| Command | Does |
|---|---|
| `pnpm --filter @dv/world test` | unit tests (needs the `synth` bake for the bake-backed suites) |
| `DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @world-route` | the streaming e2e (`@world-route`, `@world-boot-size`, `@world-faults`, `@world-backdrop`) |
| `DV_WORLD=synth pnpm check:perf -- --scenario route-ferry-ocean-beach --fail` | render-object and triangle budgets of the flight over the whole city |
