/**
 * World boot on the page (02-world.md section 5.1; M02b1): decide whether the catalog holds a baked world, read its index, compute
 * the boot set for the spawn point, warm and pin it, derive the spawn pose, and hand `bootEngine` everything it needs as a
 * `WorldBoot`: the sim payload, the pack channel for each sim worker generation, and the `WorldView` layer.
 */
import type { AssetClient } from '@dv/engine/assets/client';
import type { WorldBoot } from '@dv/engine/client/boot/world-layer';
import { decodeP0, type QualityTierId, type WorldIndex } from '@dv/shared';
import { WORLD_PORT, type WorldSimConfig } from '../sim/streaming/channel.ts';
import { bootSet, groundHeightAt, spawnPose, type BootSet } from '../sim/streaming/boot.ts';
import { WorldView, type WorldViewLabels } from './world-view.ts';

/** Whether the catalog resolves `data/world-index` (the boot rule's second input). False without a catalog or a world in it. */
export async function hasWorldIndex(assets: AssetClient): Promise<boolean> {
  try {
    if ((await assets.loadCatalog()) !== 'ready') return false;
    await assets.resolve('data/world-index');
    return true;
  } catch {
    return false;
  }
}

export interface PrepareWorldOptions {
  assets: AssetClient;
  tier: QualityTierId;
  flags: { cards: boolean; massing: boolean };
  labels: WorldViewLabels;
  container: HTMLElement;
  emit?: (name: 'world.stream', props: { residentL0: number; missCount: number; uploadP95Ms: number; bytesMB: number }) => void;
  qa?: boolean;
}

export interface PreparedWorld {
  boot: WorldBoot;
  view: WorldView;
  index: WorldIndex;
  set: BootSet;
}

/** Height above the ground the player is placed at; the ownership machine settles it onto the heightfield. */
export const SPAWN_LIFT_M = 1.5;

export async function prepareWorld(o: PrepareWorldOptions): Promise<PreparedWorld> {
  const { assets } = o;
  const base = (await assets.stats()).bytes;

  const indexBytes = await assets.get('data/world-index', { priority: 'now' });
  const index = JSON.parse(new TextDecoder().decode(indexBytes)) as WorldIndex;
  const pose = spawnPose(index);
  const set = bootSet(index, pose, o.tier, o.flags);

  // Warm and pin the boot set: the packs of the first district are never evicted while the session runs (11-platform-pwa.md 5).
  const all = [...set.p0, ...set.l0, ...set.l1, ...set.l2, ...set.far];
  await assets.pin(all);
  void assets.prefetch([...set.l1, ...set.l2, ...set.far], 'soon').catch(() => undefined);
  // The spawn tile's p0: its ground height places the player.
  const spawnPack = set.p0[0];
  if (!spawnPack) throw new Error('the world index has no p0 tile under the spawn point');
  const chunks = decodeP0(await assets.get(spawnPack, { priority: 'now' }));
  const ground = groundHeightAt(chunks, pose.x, pose.z) ?? 0;
  // The rest of the critical set arrives while the engine boots; the reveal waits for the first L0 upload.
  await Promise.all(set.critical.filter((a) => a !== spawnPack).map((a) => assets.get(a, { priority: 'now' }).catch(() => undefined)));

  const refs = (await assets.job('world.refs', { prefix: 'world_pack/p0-', tier: o.tier })) as WorldSimConfig['refs'];
  const spawn: [number, number, number] = [pose.x, ground + SPAWN_LIFT_M, pose.z];
  const simConfig: WorldSimConfig = { bakeId: index.bakeId, p0Tiles: index.tiles.p0, refs, spawn };

  const view = new WorldView({
    tier: o.tier,
    index,
    assets: {
      job: (name, args) => assets.job(name, args),
      stats: () => assets.stats(),
    },
    flags: o.flags,
    spawn: { x: pose.x, z: pose.z },
    labels: o.labels,
    container: o.container,
    bytesBase: base,
    ...(o.emit ? { emit: o.emit } : {}),
    ...(o.qa ? { qa: true } : {}),
  });

  const boot: WorldBoot = {
    bakeId: index.bakeId,
    spawn,
    spawnYaw: pose.yaw,
    config: { world: simConfig },
    // A fresh channel for every sim worker generation: one port to asset.worker, the other to the sim.
    initExtras: async () => {
      const ch = new MessageChannel();
      await assets.job('world.attach', { port: ch.port1 }, { transfer: [ch.port1] });
      return { ports: { [WORLD_PORT]: ch.port2 }, transfer: [ch.port2] };
    },
    layer: view,
  };
  return { boot, view, index, set };
}
