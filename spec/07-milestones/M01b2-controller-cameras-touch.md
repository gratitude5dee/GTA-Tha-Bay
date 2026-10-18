# M01b2 — controller-cameras-touch

## Goal
After this session the deployed app opens on the S02 gray-box Civic Center block (M01f fixture: 4 chunks, 2 % slope, 12 boxes, a four-way road), walkable on desktop and in an iPhone Home Screen web app with touch. A procedural mannequin animates idle/walk/run, footsteps play through the audio bus skeleton, QA builds have a sim panel and free cam, and a Quest enters `immersive-vr` on the block. **Split boundary (`spec/domains/01-engine.md` §8, row M01b):** M01b1 delivered everything provable on desktop in the test fixture. This session takes touch, the gray-box block, camera polish, vault, anim graph v1, audio skeleton, debug panel and free cam, and the iPhone ≥ 30 fps and XR smoke checks (the pull-forwards in [research/gamedesign-decomposition.md §9]).

## Requirements
- R-PLAT-01: iPhone is the primary mobile target, so touch play works in the Home Screen web app from the Cloudflare preview.
- R-PLAT-04: camera polish (fade, shoulder ease, depth-aware near plane, reduced motion).
- R-PLAT-05: a first device check that the gray-box runs at ≥ 30 fps on an iPhone at `mobile-low` (Q-10 floor).
- R-PLAT-02: risk retirement only. Quest enters an immersive session on the block; the full XR port is M11b1.
- R-ENG-04: touch actions resolve through C03 `Binding`s, so they stay remappable; `client.Pause` is always bound.

## Depends on
- **M01b1** (binders, router, controller, rig, `player.default`). Through it: M01a2, M01a1, M00.
- **M01f** (S02): `packages/shared/src/world/{c08, pack-codec}.ts` with `decodeP0` and `toStaticShapeSet`, and the fixture `tests/fixtures/world/civic-graybox/` (`p0-64-64`, `l0-64-64`).
- **M00:** Playwright project `xr-quest3` (IWER 2.6.0, F-062), the minimal `RendererHost`, the `QaFlags` `?tier=` override, and `config/tier-budgets.json`.
- If **M01c** has already landed, use its `RendererHost` and register the sim panel in its `PerfHud`; otherwise build the minimal versions below.
- Contracts: C01, C02 1.1, C03 1.1, C04 1.1, C08 1.0 (read-only), C13 1.1 (read-only).

## Scope in
- **Touch binder** (`client/input/touch.ts`; Pointer Events, `pointerType: 'touch'` [research/stack-rendering-platform.md §3.5]): up to five contacts, one pointer per widget; floating left stick (origin = first left-half contact, radius 58 px, knob 26 px, `Sprint` beyond 1.35 × radius); right-half look (Δpx × 3.0 × 0.0025 rad × sensitivity; the 0.0025 scale is a design value); 120 ms minimum hold; release-all on `pointercancel`, `blur`, `visibilitychange`. Numbers per C03 rule 10 [research/repos-webport.md §3.6].
- **Touch overlay** (`client/input/touch-overlay.ts` + CSS):
  - a DOM layer with `touch-action: none`, no text selection and no long-press callout;
  - widgets inside `env(safe-area-inset-*)`, every target ≥ 44 px;
  - on-foot buttons Jump, Camera and Pause only, so no button is dead;
  - shown when the last active device is touch or `(pointer: coarse)` matches;
  - layout `config/input/touch/default-right.json` in S10's `TouchLayout` v1 shape (`10-ui-hud-xr.md` §2.9, engine-local structural type); bindings in `config/input/defaults.touch.json`.
- **Gray-box world** (the home page boots it; `world-boxes` stays a test fixture): the main thread fetches the fixture packs (hashed static files) and transfers them in `BootPayload`; `sim.worker` runs `decodeP0` and `toStaticShapeSet` and adds at most one chunk's statics per tick; the player spawns via `Waiting → Entering` once colliders exist; the main thread meshes each chunk (terrain, merged prisms, roads if exposed) into ≤ 6 render objects in one group with TSL node materials.
- **Vault:** with Jump pressed while running into an obstacle ≤ 1.2 m found by forward `castSphere` probes, the player enters state 120 for 24 ticks and ends beyond it. Taller obstacles block.
- **Camera polish:** player mesh fades to 0 below 0.6 m; shoulder swap eases over 0.25 s; far = tier building draw distance; with `depthPolicy` `'standard'` (assumed when unreported) near = max(near, far / 20000) (C04 rule 3); `prefers-reduced-motion` disables shake; DPR capped by the tier budget.
- **Anim graph v1** (`client/anim/`):
  - `types.ts` verbatim from the service interfaces; `graph.ts`: 1D blend on `p0` (0 / 1.6 / 4.2 m/s), 0.2 s crossfade;
  - `placeholder-rig.ts`: procedural `bay_rig_v1` mannequin (22 `HUMANOID_BONES`, code-built clips, no asset file);
  - `lod.ts`: rate bands from `config/engine-tiers.json`, created here from the `01-engine.md` §6 table.
- **Audio skeleton** (`client/audio/`): one `AudioContext` unlocked in the first `pointerdown`/`keydown`; `navigator.audioSession.type = 'playback'` when present [research/stack-rendering-platform.md §3.5]; buses `master → {music, sfx, ambience, voice, radio, ui, cutscene}`; voice ducks music and radio by 9 dB (80/400 ms); suspend on hidden, resume on visible; a synthesized footstep for the sim's `foot.step` cue; `config/audio.json`.
- **Debug (QA builds, `?debug=1`):** F3 sim panel (rendered fps as the median of 120 rAF deltas, ticks/frame, tick p50/p99, `droppedSec`, entities, transport, build, tier, backend); F4 free cam (pushes the `debug` context, WASD/mouse at 10 m/s, Shift 40 m/s; the sim keeps running).
- **XR smoke:** when `immersive-vr` is supported, set `renderer.xr.enabled = true` before `init()` and `forceWebGL: true` in Quest Browser [research/stack-rendering-platform.md §1.2, §4.1]. A QA-only "Enter VR (smoke)" button's click handler calls `navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] })` with nothing awaited first, then `renderer.xr.setSession` (`11-platform-xr.md` §5.1). The rig applies `mode: 'xr'`, `origin: 'feet'`, `lockPlayerToggle: true` (no push, shake or locomotion); a `FrameSignal` goes out on every XR frame (C02 rule 8); exit returns to `tp`.
- **Device checklists** `tools/ci/checklists/M01b2-iphone.json` and `M01b2-quest3.json`, in the `DeviceChecklist` shape (`11-platform-perf.md` §4).

## Scope out
- Touch layout editor, the extra layouts, the rotate overlay and the HUD: S10 M04b2, which adopts `default-right.json` and moves its type into `packages/ui`.
- Real `ChunkRenderer`, streaming and `asset.worker`: M02b1 and M01e (the gray-box mesher here is a placeholder). Tier benchmark, `PerfHud`, governor, `FramePacer`: M01c and M11a.
- XR locomotion, input and comfort, Vision Pro: M11b1 and M11b2. Real character models and clips: M01d/M10a. `FirstGestureUnlock` routing: M04c.

## Deliverables
- `packages/engine/src/client/input/{touch.ts, touch-overlay.ts, touch.css}`.
- `packages/engine/src/client/graybox/{load.ts, mesher.ts}`; `packages/engine/src/sim/world/fixture-statics.ts`.
- `packages/engine/src/sim/control/vault.ts`; extend `client/camera/rig.ts`.
- `packages/engine/src/client/anim/{types.ts, graph.ts, placeholder-rig.ts, lod.ts}`, `packages/engine/src/client/audio/{types.ts, audio-service.ts}`.
- `packages/engine/src/client/debug/{sim-panel.ts, free-cam.ts}`, `packages/engine/src/client/xr/smoke.ts`; the XR option in the minimal `RendererHost` (`packages/engine/src/platform/renderer-host.ts`, owned by S11).
- `config/input/defaults.touch.json`, `config/input/touch/default-right.json`, `config/engine-tiers.json`, `config/audio.json` and schemas under `config/schemas/`; F3/F4 bindings in `defaults.kbm.json`.
- `packages/engine/test/{input.touch.spec.ts, graybox.spec.ts, control.vault.spec.ts, camera.polish.spec.ts, anim.graph.spec.ts, audio.spec.ts, config.spec.ts}`; extend `camera.sweep.spec.ts` to the gray-box.
- `tests/e2e/{touch.spec.ts (@touch), graybox.spec.ts (@graybox), xr-smoke.spec.ts (@xr @xr-smoke)}`.
- `tools/ci/checklists/M01b2-iphone.json`, `tools/ci/checklists/M01b2-quest3.json`.

## Interfaces
- Implements the C03 touch `ControlId`s, the C04 rules 3, 5 and 6 subset, and the engine `AnimGraphDef`/`AudioService` types. Consumes C08 `decodeP0` and `toStaticShapeSet` read-only.
- No contract changes. The `TouchLayout` shape is S10's; any difference goes to S10 as a note, not an edit.

## Acceptance criteria
- AC-1 Given the branch When typecheck, lint, build and the config tests run Then all pass, and the touch layout, `engine-tiers.json` and `audio.json` validate — proof: `pnpm typecheck && pnpm lint && pnpm build && pnpm --filter @dv/engine test -- config`
- AC-2 Given synthetic touch pointer events in Node, the following hold — proof: `pnpm --filter @dv/engine test -- input.touch`:
  - a 29 px stick displacement gives |`moveY`| = 64;
  - 80 px sets `Sprint` and clamps the axis at 127;
  - a 100 px look drag gives 0.75 ± 0.001 rad of yaw;
  - a 30 ms button tap is latched for one tick;
  - `pointercancel` releases everything;
  - a sixth contact is ignored.
- AC-3 Given WebKit with an 844 × 390 touch viewport When synthetic touch pointer events (or `TouchEvent`s, see Risks) drag the stick up for 3 s, then tap Jump, then tap Camera Then the player moves ≥ 5 m, `control` 110 is observed, the mode becomes `'fp'`, the layer has `touch-action: none`, and every button is ≥ 44 × 44 px inside the viewport — proof: `pnpm check:e2e -- --project=webkit-webgl2 --grep @touch`
- AC-4 Given the M01f fixture in Node When the headless sim loads it Then chunk statics are added on 4 consecutive ticks (one per tick), the player is grounded within 60 ticks, and the 100-pose camera sweep passes on the gray-box — proof: `pnpm --filter @dv/engine test -- graybox camera.sweep`
- AC-5 Given the QA build When the home page loads in Chromium and in WebKit and W + Shift is held for 10 s Then `observe()` shows 4 chunks, the player crosses a chunk boundary without dropping more than 0.1 m below the terrain, and no chunk group exceeds 6 render objects — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @graybox && pnpm check:e2e -- --project=webkit-webgl2 --grep @graybox`
- AC-6 Given the headless gray-box, plus 1.0 m and 1.4 m boxes added by the test When the player runs and jumps into each Then it vaults the first (state 120, ending beyond it) and is blocked by the second. The rig sets player opacity 0 below 0.6 m; with `'standard'` depth and far 8,200 m, near is 0.41 m; reduced motion ignores `shake` — proof: `pnpm --filter @dv/engine test -- control.vault camera.polish`
- AC-7 Given the player graph When `p0` is 0, 1.6, 2.9 and 4.2 Then the weights are idle 1, walk 1, walk 0.5/run 0.5 and run 1 (±0.01); a state change crossfades over 0.2 s; at `mobile`, a mixer beyond 80 m is not updated; the rig has exactly the 22 `HUMANOID_BONES` — proof: `pnpm --filter @dv/engine test -- anim.graph`
- AC-8 Given a fake `AudioContext` When `unlock()` is called twice, `duck('voice', -9, 80, 400)` runs, and visibility goes hidden then visible Then the context resumes once, seven buses feed master, the music gain targets −9 dB with the 80/400 ms ramps, and suspend and resume are called once each — proof: `pnpm --filter @dv/engine test -- audio`
- AC-9 Given IWER emulating Quest 3 When the test clicks "Enter VR (smoke)" Then `renderer.xr.isPresenting` is true, at least 10 XR frames render, `camera.mode` is `'xr'` and the sim advances ≥ 10 ticks; after `session.end()`, the mode is `'tp'` and rAF frames continue — proof: `pnpm check:e2e -- --project=xr-quest3 --grep @xr-smoke`
- AC-10 Given `?debug=1` in Chromium When F3 and then F4 are pressed and W is held for 2 s Then the panel shows a numeric fps and tick p99, and the player position is unchanged while the free cam moves — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @graybox`
- AC-11 Given an iPhone 15 (or 16/17) on iOS 26+ with the preview URL plus `?debug=1&tier=mobile-low` added to the Home Screen When the operator plays 5 minutes in landscape with touch only, walking around all 12 boxes Then the panel's median fps stays ≥ 30, the page never reloads, and stick, look, Jump and Camera all respond — proof: manual: iPhone 15 Home Screen web app, steps in `tools/ci/checklists/M01b2-iphone.json`, panel screenshots attached to the PR
- AC-12 Given a Quest 3 or 3S in Quest Browser on the preview URL When the operator presses "Enter VR (smoke)", looks around for 60 s, then exits through the system menu Then the block appears at 1:1 scale around the feet, the head pose tracks, and the flat page resumes without a reload — proof: manual: Quest 3, steps in `tools/ci/checklists/M01b2-quest3.json`, notes attached to the PR
- AC-13 Given a production build When the dist verifier and the preview deploy run Then both pass — proof: `pnpm build && pnpm --filter @dv/web verify:dist && pnpm deploy:preview`

## Test plan
- **Unit/integration (Node):** `input.touch`, `graybox`, `camera.sweep`, `control.vault`, `camera.polish`, `anim.graph`, `audio`, `config`.
- **e2e:** `@touch` (WebKit), `@graybox` (Chromium, WebKit), `@xr-smoke` (`xr-quest3`); M01b1's `@fp-tp` and `@determinism` stay green.
- **Device:** AC-11, AC-12; a failure there is recorded for M01c/M11a and does not block the merge.

## Demo script
1. Open the CI preview URL on desktop with `?debug=1`; walk, vault a low box, toggle fp/tp, press F3 (panel) and F4 (free cam).
2. On iPhone: Safari → Share → Add to Home Screen; open it in landscape and play with touch.
3. On Quest: open the URL, press "Enter VR (smoke)", look around, exit.

## Effort
1 Builder session; about 36 files; risk **medium**. iPhone frame rate and IWER behaviour are the unknowns.

## Risks & fallbacks
- **iPhone below 30 fps.** Lower the DPR cap and merge meshes further; record the numbers for M01c, whose device spike decides the tier.
- **Synthetic `PointerEvent`s in Playwright WebKit** may not set `pointerType` (not in the ledger). Fallback: the binder also accepts `TouchEvent`s, and the test dispatches those.
- **Quest UA detection** (`OculusBrowser`) follows `11-platform.md` §5.2. If entry fails on the WebGPU backend, force WebGL2 there.
- **Provenance:** if M00b's `provenance:check` flags the bundled fixture, add C07 `ProvenanceRecord`s (source `original`).

## Notes for the Builder
- Read first: `10-ui-hud-xr.md` §2.9, `11-platform-xr.md` §5.1, `02-world-contracts.md` §1 item 7, `01-engine.md` §2.6, §2.8, §2.9, §6.
- Facts: iPhone has no Pointer Lock, haptics or element fullscreen (F-011); Home Screen sites open as web apps (F-004); `navigator.xr` is main-thread only (F-006); Quest needs 72 Hz minimum (F-013, informational here); IWER runs three XR (F-062).
- UNVERIFIED and kept out of ACs: Quest face-button indices (U-ENG-5, so no required action sits on them), XR `visibilitychange` (U-PLT-13), iOS suspension timing (U-ENG-8).
- Order of work: gray-box load → touch → vault and polish → anim → audio → debug → XR → e2e → device runs.
- Secrets and accounts: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (CI, M00) for the preview. Physical iPhone and Quest per Q-13; without them, AC-11 and AC-12 stay open and are listed in the PR.
