import { SimStage, type EntityId, type SystemDef } from '@dv/shared';
import { Anim, RenderKey, Transform } from './ecs/components.ts';
import type { EcsWorld } from './ecs/world.ts';
import type { SnapshotWriter } from './transport/snapshot-buffer.ts';
import { writeRecord, type SnapshotRecord } from './transport/snapshot-buffer.ts';

export const SNAPSHOT_PUBLISH_ID = 'engine.publish.snapshot';
/** Snapshot record `flags` bit 0: the entity is visible. */
export const SNAP_FLAG_VISIBLE = 1;

/**
 * The Publish-stage system that writes the render snapshot (C02: records of entities with Transform and RenderKey,
 * ascending EntityId). One snapshot per tick, stamped with the number of ticks completed, so the page always holds
 * the newest tick and the one before it. The side block maps each renderKey string-table id to its string, because
 * the 64-byte record carries only the id.
 */
export function snapshotPublisher(writer: SnapshotWriter, ecs: EcsWorld, origin?: () => readonly number[]): SystemDef {
  const rec: SnapshotRecord = {
    handle: 0, renderKey: 0, px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1,
    animState: 0, flags: 0, animP0: 0, animP1: 0, variant: 0, lod: 0,
  };
  return {
    id: SNAPSHOT_PUBLISH_ID, owner: 'S01', stage: SimStage.Publish, order: 1000,
    run: ({ tick }) => {
      const keys: Record<string, string> = {};
      writer.write(
        tick + 1,
        (view, max) => {
          const ids = ecs.query([Transform, RenderKey]);
          const tr = ecs.store(Transform);
          const rk = ecs.store(RenderKey);
          const an = ecs.store(Anim);
          let n = 0;
          for (let i = 0; i < ids.length && n < max; i++) {
            const id = ids[i] as number;
            const asset = rk.asset[id] as number;
            rec.handle = ecs.handle(id as EntityId);
            rec.renderKey = asset;
            rec.px = tr.px[id] as number;
            rec.py = tr.py[id] as number;
            rec.pz = tr.pz[id] as number;
            rec.qx = tr.qx[id] as number;
            rec.qy = tr.qy[id] as number;
            rec.qz = tr.qz[id] as number;
            rec.qw = tr.qw[id] as number;
            const hasAnim = ecs.hasId(id, Anim);
            rec.animState = hasAnim ? (an.state[id] as number) : 0;
            rec.animP0 = hasAnim ? (an.p0[id] as number) : 0;
            rec.animP1 = hasAnim ? (an.p1[id] as number) : 0;
            rec.flags = (rk.visible[id] as number) !== 0 ? SNAP_FLAG_VISIBLE : 0;
            rec.variant = rk.variant[id] as number;
            rec.lod = 0;
            writeRecord(view, n, rec);
            if (asset !== 0 && keys[asset] === undefined) keys[asset] = ecs.strings.get(asset);
            n++;
          }
          return n;
        },
        { rk: keys, ...(origin ? { origin: [...origin()] } : {}) },
      );
    },
  };
}
