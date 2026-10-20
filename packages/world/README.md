# @dv/world

The streamed city (M02b1) with its day, night and weather (M02b2): chunk interest and residency, the statics feed into physics, the L0/L1/L2 meshers that run in `asset.worker`, the chunk renderer and its upload gate, the backdrop (DEM ring, massing, skyline cards), the sky (`src/client/sky/`: keyframed dome, fog, rain, night windows and street lamps, the per-tier matrix) and the boot rule. It draws what `@dv/shared`'s world codec decodes from the packs that `pnpm map:build` bakes.

## Layout and import rules

| Path | Holds | Imports |
|---|---|---|
| `src/sim/**` | `ChunkStore`, streaming plan, priority, statics feed, boot set, the sim module (`worldStreamingModule`), the blackout switch (`env/blackout.ts`), and the world services of M02c1: the road graph and router (`graph/`), `TrafficControl` (`traffic/`), the map data (`map/`), and `api/` (query, resolver, places, teleport, portals, boundaries, `createWorldApi`) | `@dv/shared`, `@dv/engine/sim` types; no `three`, no DOM; the C02 determinism lint applies |
| `src/client/**` | meshers, `ChunkRenderer`, `ChunkUploadGate`, materials, backdrop, the sky (`sky/`), `WorldView`, asset-worker jobs, the QA bridge | `three`, `@dv/engine`, `@dv/shared`, `earcut` |

`@dv/engine` never imports this package: the app composes it through `SimModule` (sim worker), `AssetJob` (asset worker) and `WorldLayer` (render), see `apps/web/src/workers/` and `apps/web/src/main.ts`.

## See the world

```bash
pnpm map:build -- --area synth      # bake the offline test city into dist/world
DV_WORLD=synth pnpm dev             # merge the bake into the media mirror and serve it
```

Open `/?perf=1&tier=mobile` or `/?tier=desktop`. Flags: `debug=1` (straight to play), `gl=1` (force WebGL2), `scenario=route-ferry-ocean-beach` (fly the perf route). With the QA build `window.__dvBridge.world` reports `chunks()`, `backdrop()`, `boot()` and more.

## See the day, the night and the weather

With the synth world running (`DV_WORLD=synth pnpm dev`), open `/?debug=1&tier=desktop`, press `F3` (a phone shows it from the start) and use the sky controls under the sim panel: the hour slider, the weather list (`clear`, `karl-fog`, `overcast`, `rain`, `smoke`, `golden`), Blackout (windows dim to 15 %, lamps go out), Rain (streaks on top of any preset, for example Karl fog in the rain) and Freeze (stops the clock and the weather schedule). Karl fog greys out the west first. The same controls are `window.__dvBridge.world.setHour(h)`, `setWeather(w)`, `blackout(on)`, `freeze(on)`, `rain(n)`, `sky()` (the shared uniforms, the tier configuration, counts) and `luma(pitchDeg, yawDeg)` (a 128 x 72 readback). `?sky=0` draws the world without the sky, for the on/off cost comparison. Tiers: `?tier=desktop-ultra|desktop|mobile|mobile-low`; `config/world/sky-keys.json` holds the keyframes and `src/client/sky/tiers.ts` the per-tier matrix.

## See the teleports, the GPS route and the world edges

With the synth world running (`DV_WORLD=synth pnpm dev`), open `/?debug=1&tier=desktop`. Under the sky controls the world box has a landmark list with **Go** (the screen fades out, the player moves, it fades back in), a list with **Route** and **Clear** (the GPS route from where you stand; its length and time show below), and two edge buttons: **Coast** (30 m inland of the south coast: walk south, you swim, fade out and are put back on the shore) and **County** (100 m inside a county-line barrier: walk east, the fog closes in, a boundary event fires once and a barrier stops you). The same calls are `window.__dvBridge.world.teleport('lm.coit-tower')`, `route('lm.city-hall', 'lm.ferry-building')`, `resolve(lat, lng)`, `lastBoundaryEvent()`, `fade()`, `map()` and the generic `call(op, args)` (`src/sim/api/debug.ts` lists the ops).

The services (`createWorldApi` in `src/sim/api/world-api.ts`) implement the C08 interfaces over the resident `p0` chunks and the always-resident `sf-graph.v1`: A* with ties by edge id (`graph/astar.ts`), `signal()` from the pure `signalAspect`, `TrafficControl` (blackout, density, closures, owner release), `WorldQuery` (ground, water, neighbourhood and district from `data/district-grid.v1`), `WorldResolver` (`snap` within 25 m), `PlaceIndex`, `TeleportApi` (pre-stream, fade, place) and the edges: county-line barriers and fog, portals (`closed`, `open`, `sealed`), the play-bounds wall and the swim respawn. The engine reaches the edges only through `WorldBoundsPort` on `services.world` (`@dv/engine/sim`).

## Scripts

| Command | Does |
|---|---|
| `pnpm --filter @dv/world test` | unit tests (needs the `synth` bake for the bake-backed suites) |
| `DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @world-route` | the streaming e2e (`@world-route`, `@world-boot-size`, `@world-faults`, `@world-backdrop`) |
| `DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @world-sky` | the sky e2e: luminance gates, Karl fog, blackout, the tier matrix |
| `DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep "@world-teleport\|@world-astar\|@world-bounds"` | the M02c1 e2e: ten landmark teleports, 50 routes (Node against the page), the water, county-line and play-bounds edges |
| `DV_WORLD=synth pnpm check:perf -- --scenario route-ferry-ocean-beach --fail` | render-object and triangle budgets of the flight over the whole city |
