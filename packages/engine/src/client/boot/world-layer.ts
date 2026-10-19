import type { PlayerSide } from '../../sim/publish.ts';
import type { SimEvent } from '../../sim/events.ts';
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
}

export interface WorldLayer {
  /** Called once when the engine view exists: add the lights, the sky and the world objects to `host.scene`. */
  attach(host: RendererHost): void;
  /** Every frame, after the snapshot sync and the camera rig. */
  frame(f: WorldFrame): void;
  /** Sim events (`world.status` and friends), oldest first. */
  onSimEvents?(events: readonly SimEvent[]): void;
  dispose(): void;
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
