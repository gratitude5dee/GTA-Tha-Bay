import type { EnvState } from '@dv/shared';
import type { PlayerSide } from '../../sim/publish.ts';
import type { SimEvent } from '../../sim/events.ts';
import type { Pose } from '../snapshot/interpolate.ts';
import type { SimHostOptions } from '../../sim/sim-host.ts';
import type { RendererHost } from '../../platform/renderer-host.ts';

/**
 * The seam between the engine and a streamed world (M02b1). The engine never imports `@dv/world`; the app builds a `WorldBoot` from
 * it and passes it to `bootEngine({ world })`. The sim half is a `SimModule` in the composed sim worker; the render half is a
 * `WorldLayer` drawn on the platform host's scene.
 */
export interface WorldFrame {
  nowMs: number;
  dtSec: number;
  /** The local player from the newest snapshot; null before the first one. */
  player: PlayerSide | null;
  /** The draw camera: world position and heading (unit vector), ENU metres. */
  camera: { pos: [number, number, number]; dir: [number, number, number] };
  /** The game clock and weather from the newest snapshot that carried one (M02b2); null before the first. */
  env: EnvState | null;
  /** Blackout in force (traffic signals dark, lamps off, windows dimmed). */
  blackout: boolean;
  /** Fog far-plane factor near the county line (M02c1): 1 away from it, 0.4 at the line. Absent in a test frame. */
  boundaryFog?: number;
  /**
   * The interpolated poses of the newest snapshot (M03b1): the world's instanced traffic renderer draws the records flagged ambient
   * (`flags & 2`). `poseKeys` maps a record's `renderKey` to its asset string. Absent in a test frame.
   */
  poses?: readonly Pose[];
  poseCount?: number;
  poseKeys?: ReadonlyMap<number, string>;
}

export interface WorldLayer {
  /** Called once when the engine view exists: add the lights, the sky and the world objects to `host.scene`. */
  attach(host: RendererHost): void;
  /** Every frame, after the snapshot sync and the camera rig. */
  frame(f: WorldFrame): void;
  /** Sim events (`world.status` and friends), oldest first. */
  onSimEvents?(events: readonly SimEvent[]): void;
  /**
   * QA hooks of the layer (M02b2), for the debug panel's sky controls; absent on layers without a sky. Only the panel and the
   * QA bridge call them.
   */
  debug?: WorldLayerDebug;
  dispose(): void;
}

/** What the QA debug panel needs of a world layer's sky. */
export interface WorldLayerDebug {
  /** Forces the rain intensity (0..255) whatever the weather preset says; null returns to the preset. */
  setRainOverride(rain: number | null): void;
  /** The rain override in force, or null. */
  rainOverride(): number | null;
  /** M02e: the look pass (materials, post stack, shadows) switch and its active post nodes; absent when the layer has no look. */
  look?: {
    /** Whether the tier has a look at all (the legacy tiers never do). */
    available(): boolean;
    isOn(): boolean;
    setOn(on: boolean): boolean;
    /** The post nodes running now, in order (empty when the look is off). */
    nodes(): readonly string[];
  };
}

export interface WorldBoot {
  /** The 64-hex bake id (C05 `worldBake`). */
  bakeId: string;
  /** Feet of the player at spawn, ENU metres, and the heading in radians. */
  spawn: [number, number, number];
  spawnYaw: number;
  /** Entries for `BootPayload.config` beyond `scenario`, `spawn` and `spawnYaw` (the streaming plan, the pack refs). */
  config: Record<string, unknown>;
  /** A fresh pack channel for every sim worker generation (see `SimHostOptions.initExtras`). */
  initExtras?: SimHostOptions['initExtras'];
  layer: WorldLayer;
}
