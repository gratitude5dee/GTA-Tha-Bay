/**
 * M10d5 AC-3: the on-foot bodies of the object pool. The player is one `SkinnedMesh` with one material built from the profile's
 * `PlayerAvatar` (the creator kit's parts, `mid` on desktop and mobile, `lo` on mobile-low and XR), a catalog row without `model` draws its
 * `fallbackPart`, a failed load keeps the mannequin, `ped.actor` draws the ped kit, and both play a clip (never the bind pose). The parts are
 * the committed `assets/src` files, read through a mock asset port.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Scene, type Mesh, type Object3D, type SkinnedMesh } from 'three/webgpu';
import { ANIM_STATE, HUMANOID_BONES } from '@dv/shared';
import {
  ACTOR_ATLAS, ACTOR_BODY, ACTOR_OUTFIT, BodyLoader, BODY_CATALOG, actorColors, bodyVariantOf, buildBody, playerBody, resolveBody,
  type BodyAssets, type BodyVariant,
} from '../src/client/avatar/player-body.ts';
import { parsePersonGlb } from '../src/client/avatar/person-glb.ts';
import { GRAYBOX_CAPSULE, ObjectPool } from '../src/client/snapshot/object-pool.ts';
import prefabPlayer from '../../../assets/prefabs/player.default.json';
import prefabActor from '../../../assets/prefabs/ped.actor.json';

const repo = path.resolve(import.meta.dirname, '../../..');
const fileOf = (ref: string, variant: BodyVariant): string => {
  const [kind, id] = ref.split('/') as [string, string];
  return path.join(repo, 'assets/src', kind, id, `${variant}.${kind === 'texture' ? 'png' : 'glb'}`);
};

/** A mock asset port over the committed files: records every ref and variant asked for, rejects the refs in `fail`. */
function mockAssets(fail: ReadonlySet<string> = new Set()): BodyAssets & { asked: { ref: string; variant: BodyVariant }[] } {
  const asked: { ref: string; variant: BodyVariant }[] = [];
  return {
    asked,
    group: (refs, variant) => {
      for (const ref of refs) asked.push({ ref, variant });
      const bad = refs.find((r) => fail.has(r));
      if (bad) return Promise.reject(new Error(`${bad}: no pack`));
      return Promise.resolve(refs.map((r) => new Uint8Array(readFileSync(fileOf(r, variant)))));
    },
    // the page decode is the browser's: here a page is a placeholder image object (the texture is never uploaded in Node)
    image: (ref, variant) => {
      asked.push({ ref, variant });
      return Promise.resolve({ source: { width: 4, height: 4 } });
    },
  };
}

/** A realistic avatar of the creator: every slot a modelled row. */
const REALISTIC = {
  v: 1, name: 'Tester', callsign: 'Tester',
  body: { preset: 'body-lean', height: 0.8, build: 0.2 },
  face: { preset: 'face-karl', morphs: { 'jaw-width': 0.8, 'nose-length': -0.5 } },
  skinTone: 3,
  hair: { style: 'hair-waves', color: 2 },
  outfit: { top: 'top-flannel', bottom: 'bottom-cargo', shoes: 'shoes-boots', accessory: 'acc-cap' },
};

const pose = (handle: number, animState = 0, speed = 0): Parameters<ObjectPool['sync']>[0][number] => ({
  handle, renderKey: handle, px: 4, py: 1, pz: -3, qx: 0, qy: 0, qz: 0, qw: 1, animState, animP0: speed, animP1: 0, flags: 1, snapped: true,
});

const meshesUnder = (root: Object3D | undefined): Mesh[] => {
  const out: Mesh[] = [];
  root?.traverse((o) => {
    if ((o as Mesh).isMesh) out.push(o as Mesh);
  });
  return out;
};

/** Syncs the pool until the bodies have settled (the loads are promises; each sync takes what has arrived). */
async function settle(pool: ObjectPool, poses: ReturnType<typeof pose>[], keyOf: (k: number) => string, dt = 0.1): Promise<void> {
  for (let i = 0; i < 20; i++) {
    pool.sync(poses, poses.length, keyOf, dt);
    await new Promise((r) => setTimeout(r, 0));
  }
  pool.sync(poses, poses.length, keyOf, dt);
}

describe('resolveBody (the avatar to parts)', () => {
  it('draws the fallbackPart of each Coast row without a model (the default avatar, Coast)', () => {
    const s = resolveBody({});
    const bySlot = Object.fromEntries(s.parts.map((p) => [p.slot, p]));
    expect(bySlot['body']).toEqual({ slot: 'body', part: 'body-coast', ref: 'character/pc-body-athletic', path: 'fallback' });
    expect(bySlot['face']).toMatchObject({ part: 'face-coast', ref: 'character/pc-face-sunset', path: 'fallback' });
    expect(bySlot['hair']).toMatchObject({ part: 'hair-coast', ref: 'character/pc-hair-crop', path: 'fallback' });
    expect(bySlot['top']).toMatchObject({ part: 'top-coast-hoodie', ref: 'character/pc-top-hoodie', path: 'fallback' });
    expect(s.parts.map((p) => p.slot)).toEqual(['body', 'face', 'hair', 'top', 'bottom', 'shoes']);
    expect(s.missing).toEqual([]);
    // the Coast rows' own colours tint the fallback garments
    expect(s.colors.top).toBe(0x141414);
    expect(s.colors.bottom).toBe(0x262c3f);
    // the prefab names the body the default avatar draws (the milestone's `render.asset`)
    expect(prefabPlayer.render.asset).toBe(bySlot['body']?.ref);
  });

  it('draws every chosen model of a realistic avatar, with its colours, morphs and scales', () => {
    const s = resolveBody(REALISTIC);
    expect(s.parts.every((p) => p.path === 'model')).toBe(true);
    expect(s.parts.map((p) => p.ref)).toEqual([
      'character/pc-body-lean', 'character/pc-face-karl', 'character/pc-hair-waves', 'character/pc-top-flannel', 'character/pc-bottom-cargo',
      'character/pc-shoes-boots', 'character/pc-acc-cap',
    ]);
    expect(s.colors.skin).toBe(Number.parseInt((BODY_CATALOG.palettes.skin[3] as string).slice(1), 16));
    expect(s.morphs).toEqual({ 'jaw-width': 0.8, 'nose-length': -0.5 });
    expect(s.heightScale).toBeCloseTo(0.92 + 0.16 * 0.8, 6);
    expect(s.buildScale).toBeCloseTo(0.9 + 0.28 * 0.2, 6);
  });

  it('takes the catalog default for an unknown or retired id', () => {
    const s = resolveBody({ ...REALISTIC, body: { preset: 'body-nope' }, outfit: { ...REALISTIC.outfit, top: 42 } });
    expect(s.parts.find((p) => p.slot === 'body')?.ref).toBe('character/pc-body-athletic');
    expect(s.parts.find((p) => p.slot === 'top')?.ref).toBe('character/pc-top-hoodie');
  });

  it('reads mid on desktop and mobile, lo on mobile-low and both XR tiers', () => {
    expect(bodyVariantOf('desktop-ultra')).toBe('mobile');
    expect(bodyVariantOf('desktop')).toBe('mobile');
    expect(bodyVariantOf('mobile')).toBe('mobile');
    expect(bodyVariantOf('mobile-low')).toBe('mobile-low');
    expect(bodyVariantOf('xr-quest')).toBe('mobile-low');
    expect(bodyVariantOf('xr-visionpro')).toBe('mobile-low');
  });
});

describe('buildBody (one skinned mesh, one material)', () => {
  const parts = (variant: BodyVariant): { slot: 'body' | 'face' | 'hair' | 'top' | 'bottom' | 'shoes'; mesh: ReturnType<typeof parsePersonGlb> }[] =>
    resolveBody(REALISTIC).parts.filter((p) => p.slot !== 'accessory').map((p) => ({
      slot: p.slot as 'body', mesh: parsePersonGlb(new Uint8Array(readFileSync(fileOf(p.ref, variant)))),
    }));

  it('merges the parts on the 22 bay_rig_v1 bones, with a page id per vertex', () => {
    for (const variant of ['mobile', 'mobile-low'] as const) {
      const f = buildBody({ parts: parts(variant), colors: resolveBody(REALISTIC).colors });
      const meshes = meshesUnder(f.root);
      expect(meshes).toHaveLength(1);
      expect((meshes[0] as SkinnedMesh).isSkinnedMesh).toBe(true);
      expect(Array.isArray(meshes[0]?.material)).toBe(false);
      expect(f.skeleton.bones.map((b) => b.name)).toEqual([...HUMANOID_BONES]);
      const page = f.mesh.geometry.getAttribute('aPage');
      const pages = new Set(Array.from(page.array as Float32Array));
      expect([...pages].sort()).toEqual([0, 1, 2]);
      expect(f.mesh.geometry.morphAttributes['position']).toBeUndefined();
      expect(f.clipSource).toBe('placeholder');
      expect(f.clips.has('walk') && f.clips.has('idle')).toBe(true);
      f.dispose();
    }
  });

  it('is lighter at lo than at mid', () => {
    const mid = buildBody({ parts: parts('mobile'), colors: resolveBody({}).colors });
    const lo = buildBody({ parts: parts('mobile-low'), colors: resolveBody({}).colors });
    expect(lo.triangles).toBeLessThan(mid.triangles);
    expect(lo.triangles).toBeGreaterThan(500);
    mid.dispose();
    lo.dispose();
  });

  it('bakes the face morphs into the positions', () => {
    const plain = buildBody({ parts: parts('mobile'), colors: resolveBody({}).colors });
    const morphed = buildBody({ parts: parts('mobile'), colors: resolveBody({}).colors, morphs: { 'jaw-width': 1 } });
    const a = plain.mesh.geometry.getAttribute('position').array as Float32Array;
    const b = morphed.mesh.geometry.getAttribute('position').array as Float32Array;
    let moved = 0;
    for (let i = 0; i < a.length; i++) if (Math.abs((a[i] as number) - (b[i] as number)) > 1e-5) moved++;
    expect(moved).toBeGreaterThan(0);
    plain.dispose();
    morphed.dispose();
  });
});

describe('the object pool draws the bodies', () => {
  const PLAYER = 'character/pc-body-athletic';

  it('swaps the mannequin for the player body: one skinned mesh, one material, the pose and an active clip kept', async () => {
    const assets = mockAssets();
    const scene = new Scene();
    const pool = new ObjectPool(scene);
    pool.setBodies(assets, 'desktop');
    pool.setAvatar(REALISTIC);
    pool.sync([pose(1)], 1, () => PLAYER, 0.1);
    // the mannequin stands in while the parts load
    expect(pool.bodyReport().player).toMatchObject({ drawn: 'mannequin', state: 'loading' });
    expect(meshesUnder(pool.meshFor(1)).length).toBeGreaterThan(1);
    await settle(pool, [pose(1)], () => PLAYER);
    const r = pool.bodyReport();
    expect(r.variant).toBe('mobile');
    expect(r.keys).toEqual([PLAYER]);
    expect(r.player).toMatchObject({ drawn: 'body', state: 'body', objects: 1, skinned: 1, materials: 1, failure: null, clipSource: 'placeholder' });
    expect(r.player?.parts.map((p) => p.ref)).toContain('character/pc-body-lean');
    const root = pool.meshFor(1) as Object3D;
    expect(root.position.x).toBe(4);
    expect(root.userData['dvActor']).toBe('avatar');
    expect(scene.children).toContain(root);
    expect(meshesUnder(root)).toHaveLength(1);
    // every asked part was the mid file, and the creator's three pages were read
    expect(new Set(assets.asked.map((a) => a.variant))).toEqual(new Set(['mobile']));
    expect(assets.asked.map((a) => a.ref)).toEqual(expect.arrayContaining(['texture/pc.skin', 'texture/pc.cloth', 'texture/pc.hair', 'character/pc-acc-cap']));
    // idle, then walk: the mixer plays a clip each time (never the bind pose)
    pool.sync([pose(1, ANIM_STATE.idle, 0)], 1, () => PLAYER, 0.2);
    expect(pool.bodyReport().player?.clips[0]?.name).toBe('idle');
    for (let i = 0; i < 10; i++) pool.sync([pose(1, ANIM_STATE.walk, 1.6)], 1, () => PLAYER, 0.1);
    const walk = pool.bodyReport().player?.clips ?? [];
    expect(walk[0]?.name).toBe('walk');
    expect(walk[0]?.weight ?? 0).toBeGreaterThan(0.5);
    expect(walk[0]?.time ?? 0).toBeGreaterThan(0);
    pool.dispose();
  });

  it('reads the lo parts on mobile-low and on the Quest tier', async () => {
    for (const tier of ['mobile-low', 'xr-quest'] as const) {
      const assets = mockAssets();
      const pool = new ObjectPool(new Scene());
      pool.setBodies(assets, tier);
      await settle(pool, [pose(1)], () => PLAYER);
      expect(pool.bodyReport().player).toMatchObject({ drawn: 'body', objects: 1 });
      expect(pool.bodyReport().variant).toBe('mobile-low');
      expect(new Set(assets.asked.map((a) => a.variant))).toEqual(new Set(['mobile-low']));
      pool.dispose();
    }
  });

  it('draws the fallbackPart for the default avatar (Coast rows without a model)', async () => {
    const assets = mockAssets();
    const pool = new ObjectPool(new Scene());
    pool.setBodies(assets, 'mobile');
    pool.setAvatar({});
    await settle(pool, [pose(1)], () => PLAYER);
    const p = pool.bodyReport().player;
    expect(p?.drawn).toBe('body');
    expect(p?.parts.filter((x) => x.path === 'fallback').map((x) => x.part)).toEqual([
      'body-coast', 'face-coast', 'hair-coast', 'top-coast-hoodie', 'bottom-coast-jeans', 'shoes-coast-sneakers',
    ]);
    expect(assets.asked.map((a) => a.ref)).toEqual(expect.arrayContaining(['character/pc-body-athletic', 'character/pc-hair-crop']));
    expect(assets.asked.map((a) => a.ref).some((r) => r.includes('coast'))).toBe(false);
    pool.dispose();
  });

  it('keeps the mannequin when a part fails to load, naming the part, and asks for it once', async () => {
    const assets = mockAssets(new Set(['character/pc-hair-waves']));
    const pool = new ObjectPool(new Scene());
    pool.setBodies(assets, 'desktop');
    pool.setAvatar(REALISTIC);
    await settle(pool, [pose(1)], () => PLAYER);
    const p = pool.bodyReport().player;
    expect(p).toMatchObject({ drawn: 'mannequin', state: 'failed' });
    expect(p?.failure?.ref).toBe('character/pc-hair-waves');
    expect(meshesUnder(pool.meshFor(1)).length).toBeGreaterThan(1);
    expect(p?.clips.length).toBeGreaterThan(0);
    const asks = assets.asked.filter((a) => a.ref === 'character/pc-hair-waves').length;
    expect(asks).toBe(2); // the group, then the file alone to name it
    await settle(pool, [pose(1)], () => PLAYER);
    expect(assets.asked.filter((a) => a.ref === 'character/pc-hair-waves').length).toBe(asks);
    pool.dispose();
  });

  it('rebuilds the player body when the avatar changes', async () => {
    const assets = mockAssets();
    const pool = new ObjectPool(new Scene());
    pool.setBodies(assets, 'desktop');
    await settle(pool, [pose(1)], () => PLAYER);
    const first = pool.meshFor(1);
    pool.setAvatar(REALISTIC);
    await settle(pool, [pose(1)], () => PLAYER);
    expect(pool.meshFor(1)).not.toBe(first);
    expect(pool.bodyReport().player?.parts.find((x) => x.slot === 'body')?.ref).toBe('character/pc-body-lean');
    pool.dispose();
  });

  it('draws a mission actor (ped.actor) from the ped kit, tinted by its seed', async () => {
    const assets = mockAssets();
    const pool = new ObjectPool(new Scene());
    pool.setBodies(assets, 'mobile');
    const keyOf = (k: number): string => (k === 1 ? PLAYER : prefabActor.render.asset);
    await settle(pool, [pose(1), pose(2), pose(3)], keyOf);
    const r = pool.bodyReport();
    expect(prefabActor.render.asset).toBe(ACTOR_BODY);
    expect(r.actors).toHaveLength(2);
    for (const a of r.actors) expect(a).toMatchObject({ drawn: 'body', objects: 1, skinned: 1, materials: 1 });
    expect(assets.asked.map((a) => a.ref)).toEqual(expect.arrayContaining([ACTOR_BODY, ACTOR_OUTFIT, ACTOR_ATLAS]));
    expect(actorColors(2)).not.toEqual(actorColors(3));
    pool.dispose();
  });

  it('keeps the mannequin with no body port (a gray-box scene, ?art=0) and for the capsule key', async () => {
    const pool = new ObjectPool(new Scene());
    await settle(pool, [pose(1)], () => PLAYER);
    expect(pool.bodyReport().player).toMatchObject({ drawn: 'mannequin', state: 'loading' });
    expect(pool.bodyReport().variant).toBeNull();
    pool.dispose();
    const capsule = new ObjectPool(new Scene());
    capsule.setBodies(mockAssets(), 'desktop');
    await settle(capsule, [pose(1)], () => GRAYBOX_CAPSULE);
    expect(capsule.bodyReport().player).toBeNull();
    expect(meshesUnder(capsule.meshFor(1)).length).toBeGreaterThan(1);
    capsule.dispose();
  });

  it('swaps only after the body program has compiled', async () => {
    let finish: () => void = () => undefined;
    const compiled: Object3D[] = [];
    const pool = new ObjectPool(new Scene());
    void pool.warm((root) => {
      compiled.push(root);
      return root.name === 'dv:body' ? new Promise<void>((r) => (finish = r)) : Promise.resolve();
    });
    pool.setBodies(mockAssets(), 'desktop');
    await settle(pool, [pose(1)], () => PLAYER);
    expect(compiled.some((o) => o.name === 'dv:body')).toBe(true);
    expect(pool.bodyReport().player).toMatchObject({ state: 'compiling', drawn: 'mannequin' });
    finish();
    await settle(pool, [pose(1)], () => PLAYER);
    expect(pool.bodyReport().player).toMatchObject({ state: 'body', drawn: 'body' });
    pool.dispose();
  });
});

describe('the loader', () => {
  it('answers null while loading and the parsed parts once in', async () => {
    const loader = new BodyLoader(mockAssets(), 'mobile');
    expect(loader.parts([ACTOR_BODY])).toBeNull();
    await loader.idle();
    expect(loader.parts([ACTOR_BODY])?.[0]?.position.length).toBeGreaterThan(0);
    const b = playerBody(loader, resolveBody({}));
    expect(b.state).toBe('loading');
    await loader.idle();
    const c = playerBody(loader, resolveBody({}));
    expect(c.state).toBe('ready');
    if (c.state === 'ready') c.figure.dispose();
  });
});
