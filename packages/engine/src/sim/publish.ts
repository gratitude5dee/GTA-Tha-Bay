import { SimStage, type EntityId, type SystemDef } from '@dv/shared';
import { Ambient, Anim, CharacterBody, Control, LocalPlayer, RenderKey, Transform, Vehicle, Velocity } from './ecs/components.ts';
import type { EcsWorld } from './ecs/world.ts';
import type { SnapshotWriter } from './transport/snapshot-buffer.ts';
import { writeRecord, type SnapshotRecord } from './transport/snapshot-buffer.ts';

export const SNAPSHOT_PUBLISH_ID = 'engine.publish.snapshot';
/** Snapshot record `flags` bit 0: the entity is visible. */
export const SNAP_FLAG_VISIBLE = 1;
/** Snapshot record `flags` bit 1: an ambient entity (traffic, parked cars). The object pool leaves it to the world's instanced renderer. */
export const SNAP_FLAG_INSTANCED = 2;

/**
 * The Publish-stage system that writes the render snapshot (C02: records of entities with Transform and RenderKey,
 * ascending EntityId). One snapshot per tick, stamped with the number of ticks completed, so the page always holds
 * the newest tick and the one before it. The side block maps each renderKey string-table id to its string, because
 * the 64-byte record carries only the id.
 */
export function snapshotPublisher(
  writer: SnapshotWriter,
  ecs: EcsWorld,
  origin?: () => readonly number[],
  extraSide?: () => Record<string, unknown>,
): SystemDef {
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
          const ve = ecs.store(Vehicle);
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
            if (ecs.hasId(id, Vehicle)) {
              // a vehicle's render params: signed forward speed (wheel spin) and the front steer input -1..1 (wheel steer)
              rec.animP0 = ve.speed[id] as number;
              rec.animP1 = (ve.steer[id] as number) / 127;
            }
            rec.flags = ((rk.visible[id] as number) !== 0 ? SNAP_FLAG_VISIBLE : 0) | (ecs.hasId(id, Ambient) ? SNAP_FLAG_INSTANCED : 0);
            rec.variant = rk.variant[id] as number;
            rec.lod = 0;
            writeRecord(view, n, rec);
            if (asset !== 0 && keys[asset] === undefined) keys[asset] = ecs.strings.get(asset);
            n++;
          }
          return n;
        },
        { rk: keys, ...(origin ? { origin: [...origin()] } : {}), ...(extraSide ? extraSide() : {}) },
      );
    },
  };
}

/** The local player as the page's bridge and HUD see it (side block key `pl`). */
export interface PlayerSide {
  /** Feet, ENU metres. */
  pos: [number, number, number];
  /** Achieved velocity, m/s. */
  vel: [number, number, number];
  /** Control state id (100 idle ... 701 teleport waiting). */
  control: number;
  owner: number;
  grounded: boolean;
  /**
   * The last water respawn (DL-753): its number this session and the inland yaw the page turns the camera to when the number changes.
   * Absent until the first one (the runtime adds it from `ControlShared`).
   */
  respawn?: { seq: number; yaw: number };
  /** True while the movement input is latched after a water respawn (DL-753); absent otherwise. */
  latched?: boolean;
}

/** `pl` for the first entity tagged LocalPlayer, or null when there is none. */
export function playerSide(ecs: EcsWorld): PlayerSide | null {
  const ids = ecs.query([LocalPlayer, Transform, Control, CharacterBody, Velocity]);
  if (ids.length === 0) return null;
  const id = ids[0] as number;
  const tr = ecs.store(Transform);
  const ve = ecs.store(Velocity);
  const co = ecs.store(Control);
  return {
    pos: [tr.px[id] as number, tr.py[id] as number, tr.pz[id] as number],
    vel: [ve.vx[id] as number, ve.vy[id] as number, ve.vz[id] as number],
    control: co.state[id] as number,
    owner: co.owner[id] as number,
    grounded: (ecs.store(CharacterBody).grounded[id] as number) !== 0,
  };
}
