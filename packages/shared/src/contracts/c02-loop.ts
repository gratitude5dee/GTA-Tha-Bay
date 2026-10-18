// packages/shared/src/contracts/c02-loop.ts
// C02 1.1.0. Copied from spec/domains/01-engine-contracts.md without shape changes. Owner: S01.
import type { EcsApi } from './c01-ecs.ts';
import type { QualityTierId } from '../platform/c13.ts';

export const C02_VERSION = '1.1.0' as const;   // 1.1: rule 3 clarification (stateless counter hash), see the 1.1 section at the end
export const SIM_HZ = 60;
export const SIM_DT = 1 / 60;            // seconds; the only dt sim code may use
export const MAX_FRAME_DT = 0.15;        // accumulator clamp [research/repos-modding.md §3.4]
export const MAX_TICKS_PER_FRAME = 9;    // floor(0.15 / SIM_DT)
export const AI_DIVISOR = 2;             // AI "think" at 30 Hz on every tier (deterministic)
export const NET_DIVISOR = 3;            // netOut at 20 Hz (A-04)
export type Tick = number;               // u32, starts at 0 per sim session

/** Per render frame, in this order. Input, Sim (hand-off), Anim, Audio and Render run on the main thread; NetIn and NetOut run in
 *  sim.worker (socket in the worker, D-S01-05): NetIn before the tick's Commands stage, NetOut after a tick where tick % NET_DIVISOR === 0 (DL-071). */
export const enum FramePhase { Input = 0, NetIn = 1, Sim = 2, Anim = 3, Audio = 4, Render = 5, NetOut = 6 }

/** Per sim tick, inside sim.worker, in this order. Systems declare one stage + an order key. */
export const enum SimStage {
  Commands = 0,     // apply queued external commands (UI, mods, net) in arrival order
  Control = 1,      // ownership state machine; player + AI intents from InputFrame
  Script = 2,       // GameMode.tick, mission interpreter threads (A-02), zone events
  AI = 3,           // pursuit director, police tactics, traffic/ped brains (rateDivisor 2)
  PhysicsPre = 4,   // kinematic targets, character moves, vehicle controller inputs
  PhysicsStep = 5,  // backend.step(SIM_DT, substeps)
  PhysicsPost = 6,  // read back transforms, contacts → SimEvents, ragdoll timers
  Rules = 7,        // damage, infractions → heat, interaction resolution, economy, clock, weather
  Streaming = 8,    // chunk interest + collider working set requests (C08)
  Publish = 9,      // render snapshot, audio cues, UI view-model patches, stateHash, telemetry
}

export type SimProfile = 'local' | 'canonical';
/** local: tier-dependent density, Rapier simd-compat (D-12), deterministic only on the same build+browser.
 *  canonical: fixed density (mobile-low caps), Rapier deterministic-compat, cross-browser identical. */

export interface SimConfig {
  seed: number;                          // u32 world seed
  profile: SimProfile;
  physicsBuild: 'simd-compat' | 'deterministic-compat'; // derived from profile; one build per session
  tier: QualityTierId;                   // C13 (S11) — read for crowd caps, physics radius and config/engine-tiers.json only
  worldBake: string;                     // C08 bake hash
  hashEvery: number;                     // ticks between stateHash; 0 = off
  startTick?: Tick;
}
export type { QualityTierId }; // re-export of the C13 type // desktop-ultra | desktop | mobile | mobile-low | xr-quest | xr-visionpro

export interface SystemDef {
  id: string;                            // 'engine.control.owner', 'world.traffic.brain', …
  owner: string;                         // S##
  stage: SimStage;
  order: number;                         // run order within stage; ties broken by id (string compare)
  rateDivisor?: 1 | 2 | 4;               // runs when (tick + offset) % div === 0; offset = fnv32(id) % div
  profiles?: SimProfile[];               // default both
  run(ctx: SystemContext): void;
}
export interface SystemContext { tick: Tick; dt: typeof SIM_DT; ecs: EcsApi; services: SimServices }
export interface SimServices { /* injected: rng, physics, clock, pursuit, zones, scheduler, events, … (part 2) */
  readonly xrPoses: Readonly<Float32Array> | null; // S11 XrPoseBlock (11-platform-xr.md §4.3) via its seqlock reader; null outside XR
  readonly [name: string]: unknown }

/** Main thread → sim, once per render frame (SAB block or postMessage). */
export interface FrameSignal { frame: number; nowMs: number; dtSec: number; paused: boolean; timeScale: 0.25 | 0.5 | 1 | 2 }

/** Main thread → sim command ring messages that the worker handles outside ticks (rule 9). UI and debug commands for the
 *  Commands stage use the same ring with other `t` values, owned by their senders. */
export type SimControlMessage =
  | { t: 'save.request'; reason: 'hidden' };   // LifecycleController (S11) on visibilitychange → hidden; C05 rule 4 decides eligibility

export interface LoopStats { tick: Tick; ticksLastFrame: number; tickMsP50: number; tickMsP99: number; droppedSec: number; overruns: number }

/** Render snapshot: triple-buffered in SAB; reader takes the newest complete buffer and the previous one. */
export interface SnapshotHeader { seq: number /*u32, odd while writing*/; tick: Tick; count: number; flags: number }
export const SNAPSHOT_RECORD_BYTES = 64;   // layout below
export const SNAPSHOT_MAX_RECORDS = 8_192;
export interface InterpRules { skipIfTickGap: 3; teleportMeters: 2; angleShortestArc: true }

export interface SimHost {
  start(cfg: SimConfig, boot: BootPayload): Promise<void>;
  frame(sig: FrameSignal): void;         // never blocks; worker accumulates and ticks
  stepOnce(): void;                      // debug/headless
  restart(cfg: SimConfig): Promise<void>; // profile switch (GameMode with different simProfile)
  readonly stats: LoopStats;
  dispose(): Promise<void>;
}
export interface BootPayload { strings: string[]; prefabs: unknown[]; config: Record<string, unknown> }
