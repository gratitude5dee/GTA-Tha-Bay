import type { EnvState } from '@dv/shared';
import type { PublishedCamera } from '../../sim/camera/collision.ts';
import type { PlayerSide } from '../../sim/publish.ts';
import type { SnapshotRead } from '../../sim/transport/snapshot-buffer.ts';
import { interpolateSnapshots, type Pose } from './interpolate.ts';

/**
 * Turns the transport's snapshot pair into drawable poses. It remembers the renderKey strings the worker sends in the
 * side block (`rk`: string-table id to string), so the draw code can map the 32-bit id in a record back to an asset key.
 */
export class SnapshotView {
  /** renderKey id to asset key string, accumulated from the side blocks. */
  readonly keys = new Map<number, string>();
  readonly poses: Pose[] = [];
  count = 0;
  tick = -1;
  alpha = 0;
  /** Poses that were placed without blending in the last update. */
  snapped = 0;
  /** The camera directive the sim published with the newest snapshot (side key `cam`); null when nothing is followed. */
  camera: PublishedCamera | null = null;
  /** The local player (side key `pl`); null when there is none. */
  player: PlayerSide | null = null;
  /** The game clock and weather (side key `env`, M02b2); null before the first snapshot that carries one. */
  env: EnvState | null = null;
  /** Blackout in force (side key `bo`, set by the world module, M02b2). */
  blackout = false;
  /** Fog far-plane factor near the county line (side key `wf`, set by the world module, M02c1); 1 when absent. */
  boundaryFog = 1;

  /** Update from the newest read. Returns false when there is nothing to draw yet. */
  update(read: SnapshotRead | null): boolean {
    if (!read) return false;
    if (read.fresh) {
      const rk = read.cur.side['rk'];
      if (rk && typeof rk === 'object') {
        for (const [id, name] of Object.entries(rk as Record<string, unknown>)) {
          if (typeof name === 'string') this.keys.set(Number(id), name);
        }
      }
      const cam = read.cur.side['cam'];
      this.camera = cam && typeof cam === 'object' ? (cam as PublishedCamera) : null;
      const pl = read.cur.side['pl'];
      this.player = pl && typeof pl === 'object' ? (pl as PlayerSide) : null;
      const env = read.cur.side['env'];
      if (env && typeof env === 'object') this.env = env as EnvState;
      this.blackout = read.cur.side['bo'] === 1;
      const wf = read.cur.side['wf'];
      this.boundaryFog = typeof wf === 'number' && wf > 0 && wf <= 1 ? wf : 1;
    }
    this.count = interpolateSnapshots(read.prev, read.cur, read.alpha, this.poses);
    this.tick = read.cur.tick;
    this.alpha = read.alpha;
    let snapped = 0;
    for (let i = 0; i < this.count; i++) if ((this.poses[i] as Pose).snapped) snapped++;
    this.snapped = snapped;
    return true;
  }
}
