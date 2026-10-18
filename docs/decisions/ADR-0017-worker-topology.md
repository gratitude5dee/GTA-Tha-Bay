# ADR-0017 — Worker topology

**Status:** accepted · **Date:** 2026-10-18 · **Decides:** spec/03 D-08 as amended by DL-152; contracts C02, C13, C14

## Context
Simulation, asset IO and rendering must not block each other on a phone. XR sessions can only be requested from a Window: `navigator.xr` is not exposed on `WorkerNavigator`, while `navigator.gpu` is [F-006]. Pose inference (fighter) and script mods (modding) need isolation from the sim but are used rarely. Cross-origin isolation (COOP/COEP) is on, so `SharedArrayBuffer` transport is available [ADR-0020].

## Options considered
1. **Render worker (OffscreenCanvas).** Impossible for XR [F-006]; one render path would be forked anyway.
2. **Everything on the main thread.** Rapier steps and mod scripts stall rAF; pose inference janks the HUD.
3. **One worker per subsystem.** More boundaries and message types for no measured gain.
4. **Main thread for rendering, two always-on workers, two lazy non-rendering workers** (chosen).

## Decision
| Context | Lifetime | Owns | Never does |
|---|---|---|---|
| Main thread (Window) | always | DOM UI, input capture, XR session and panels, rendering including the menu scene, camera, animation, audio, `CutscenePlayer`, map views, telemetry client | mutate sim state |
| `sim.worker` | always | ECS, physics, world sim (graphs, traffic, peds), AI and NPC brains, pursuit, modes, mission VM, `ModHost`, saves, the room socket (M12) | DOM, `three`, GPU |
| `asset.worker` | always | fetch lanes, OPFS pack store, SHA-256 verification, decoding, `l0` chunk meshing, mod installer | game logic |
| `pose.worker` (DL-152) | lazy: only while pose control is on | MediaPipe Pose Landmarker (lite on mobile, full on desktop within budget), filters, gesture FSM; classic IIFE worker; emits gestures only | upload, store or decode-to-disk frames; any network call except a same-origin GET of `/pose/**` |
| `mod.worker` (DL-152) | lazy: created when the first script mod loads, terminated when none remain | QuickJS-wasm, one runtime per script mod, deadlines and memory limits | DOM, network, clocks, rendering |

- **Transport.** `SharedArrayBuffer` blocks under isolation: an input block (main → worker), a command ring, a snapshot triple buffer with a seqlock, and an event ring; wake-ups with `Atomics.notify`/`waitAsync`. Without isolation a `postMessage` transport with transferable buffers carries the same `{v, t, seq, p}` messages (DN-S11-02); no performance guarantee.
- **Messages.** `ModMsg v1` over a `MessagePort` at ≤ 10 Hz to `mod.worker`; pose frames go main → `pose.worker` as transferred `ImageBitmap`s and come back as gestures.
- **Net socket.** The room socket lives in `sim.worker`, with a main-thread `MessagePort` relay if iOS workers lack WebSocket (U-ENG-4; decided in M12b, D-S01-05).
- **No wasm pthreads in v1.** Rapier and MediaPipe tasks-vision 1.1.1 are single-thread builds [F-057].
- **Checks.** `check:bundle` fails if the `pose.worker` bundle references `fetch`, `XMLHttpRequest`, `WebSocket` or `sendBeacon` beyond the allow-listed loader call.

## Consequences
- (+) The main thread never waits for the sim; one tick of latency buys stall isolation.
- (+) Lazy workers cost nothing for players who never use pose or mods.
- (−) Five contexts mean five message schemas to test; each message type is schema-tested on both sides.
- (−) XR stays on the main thread, so a heavy main-thread task still hurts the 72/90 Hz render loop.
- (−) Whether tasks-vision 1.1.1 runs as a classic IIFE worker under Vite 8 is UNVERIFIED (Q-S07-1; the M08c spike checks it, and module-worker use is also UNVERIFIED).

## Affected contracts and milestones
C02 (transport, `FrameSignal`), C03 (pose binder), C14 (`ModMsg v1`), C13 (`RendererHost`). M01a2 (`sim.worker`, transport), M01e (`asset.worker`), M08c1 (`pose.worker`), M12b1 (socket), M13a4 (`mod.worker`).

## Links
`spec/domains/01-engine.md` §2.1–2.2; `07-fighter-pose.md` FP2; `12-modding.md` §2.2; `spec/02-architecture.md` §1, §3.1; `spec/11-decision-log.md` DL-071, DL-152, DL-164; ADR-0010, ADR-0012, ADR-0024.
