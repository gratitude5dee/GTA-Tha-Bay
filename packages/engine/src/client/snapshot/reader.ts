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
