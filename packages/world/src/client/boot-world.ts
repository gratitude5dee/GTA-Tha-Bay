/**
 * World boot on the page (02-world.md section 5.1; M02b1): decide whether the catalog holds a baked world, read its index, compute
 * the boot set for the spawn point, warm and pin it, derive the spawn pose, and hand `bootEngine` everything it needs as a
 * `WorldBoot`: the sim payload, the pack channel for each sim worker generation, and the `WorldView` layer.
 */
import type { AssetClient } from '@dv/engine/assets/client';
import type { WorldBoot } from '@dv/engine/client/boot/world-layer';
import { decodeP0, type QualityTierId, type RenderBackend, type WorldIndex } from '@dv/shared';
import { WORLD_PORT, type WorldSimConfig } from '../sim/streaming/channel.ts';
import { bootSet, groundHeightAt, spawnPose, type BootSet } from '../sim/streaming/boot.ts';
import type { LandmarkSpot } from './chunks/landmark-layer.ts';
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
  /** `world.rain`, `world.atmosphere` and the QA sky switch (M02b2). */
  sky?: { rain: boolean; atmosphere: boolean; enabled: boolean };
  /** The look pass (M02e): the `world.look` flag, the browser and the backend (WebKit never bakes the environment) and the governor's `postLevel`. */
  look?: { enabled: boolean; browser: string; backend: RenderBackend; postLevel: number };
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

const SPAWN_RETRY_MS = 2000;

/**
 * The spawn tile's `p0`. When it cannot be had the session is blocked (02-world.md 5.6): offline shows the offline message over the
 * page, any other failure the "re-downloading district" message, and the fetch is tried again every two seconds (and at once when
 * the browser reports it is back online) until it arrives; the overlay then goes away and the boot continues.
 */
async function getSpawnTile(assets: AssetClient, pack: string, o: PrepareWorldOptions): Promise<ArrayBuffer> {
  let overlay: HTMLElement | null = null;
  const show = (reason: string): void => {
    const offline = reason === 'offline';
    if (!overlay) {
      overlay = o.container.ownerDocument.createElement('div');
      overlay.setAttribute('role', 'status');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;background:#0b0e14;color:#fff;font:600 18px system-ui,sans-serif;text-align:center;padding:24px';
      o.container.append(overlay);
    }
    overlay.dataset['testid'] = offline ? 'world-offline' : 'world-redownload';
    overlay.textContent = offline ? o.labels.offline : o.labels.redownload;
  };
  for (;;) {
    try {
      const bytes = await assets.get(pack, { priority: 'now' });
      (overlay as HTMLElement | null)?.remove();
      return bytes;
    } catch (error) {
      const reason = (error as { name?: string; reason?: string } | null)?.name === 'PackUnavailable' ? ((error as { reason?: string }).reason ?? 'unavailable') : 'unavailable';
      if (reason === 'quota' || reason === 'aborted') throw error;
      show(reason);
      await new Promise<void>((resolve) => {
        const view = o.container.ownerDocument.defaultView;
        const done = (): void => {
          view?.removeEventListener('online', done);
          resolve();
        };
        view?.addEventListener('online', done);
        setTimeout(done, SPAWN_RETRY_MS);
      });
    }
  }
}

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
  const chunks = decodeP0(await getSpawnTile(assets, spawnPack, o));
  const ground = groundHeightAt(chunks, pose.x, pose.z) ?? 0;
  // The rest of the critical set arrives while the engine boots; the reveal waits for the first L0 upload. It is not awaited here: a
  // pack that is unavailable is the view's to retry, with the "re-downloading district" message over the page (02-world.md 5.6).
  void Promise.all(set.critical.filter((a) => a !== spawnPack).map((a) => assets.get(a, { priority: 'now' }).catch(() => undefined)));

  const refsFor = async (prefix: string): Promise<WorldSimConfig['refs']> => (await assets.job('world.refs', { prefix, tier: o.tier })) as WorldSimConfig['refs'];
  // The p0 tiles, plus the always-resident road topology and the district grid (M02c1), which the sim loads through the same channel.
  const refs: WorldSimConfig['refs'] = {
    ...(await refsFor('world_pack/p0-')),
    ...(await refsFor('map_data/sf-graph')),
    ...(await refsFor('data/district-grid')),
  };
  // M02d1: the landmarks that have a model in the catalog; the layer swaps their baked proxies for the glTF near the player.
  const modelled = await refsFor('building/lm.').catch(() => ({}) as WorldSimConfig['refs']);
  const landmarks: LandmarkSpot[] = index.landmarks.flatMap((l, i) => (l.asset in modelled ? [{ id: l.id, index: i, x: l.x, z: l.z, asset: l.asset }] : []));
  const spawn: [number, number, number] = [pose.x, ground + SPAWN_LIFT_M, pose.z];
  const simConfig: WorldSimConfig = { bakeId: index.bakeId, p0Tiles: index.tiles.p0, refs, spawn, index };

  const view = new WorldView({
    tier: o.tier,
    index,
    assets: {
      job: (name, args) => assets.job(name, args),
      stats: () => assets.stats(),
    },
    flags: o.flags,
    ...(o.sky ? { sky: o.sky } : {}),
    ...(o.look ? { look: o.look } : {}),
    spawn: { x: pose.x, z: pose.z },
    landmarks,
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
