import { BoxGeometry, Group, Mesh, MeshStandardNodeMaterial, Vector3, type BufferGeometry, type Object3D, type Scene } from 'three/webgpu';
import { AnimLod, ENGINE_TIERS } from '../anim/lod.ts';
import { buildPlaceholderRig, MannequinAnimator, type PlaceholderRig } from '../anim/placeholder-rig.ts';
import { buildGrayboxThing, GrayboxAssets, isGrayboxThing, type DrawnThing } from '../vehicle/vehicle-view.ts';
import { art } from '../vehicle/art.ts';
import { isArtKey } from '../vehicle/art-model.ts';
import { grayboxOf } from '../vehicle/art-tables.ts';
import { buildArtThing } from '../vehicle/gltf-thing.ts';
import type { Pose } from './interpolate.ts';

export const GRAYBOX_CAPSULE = 'prop/graybox.capsule';
/**
 * The render keys whose programs `ObjectPool.warm` compiles before any of them is drawn (DL-715): the character placeholder and the
 * gray-box kit a mission's cast and markers draw from (assets/prefabs). Keys that share a material share its program, so one of each
 * material variant is enough; the list names every kit key so that a new material in the kit is warmed too.
 */
export const WARM_KEYS: readonly string[] = [
  GRAYBOX_CAPSULE,
  'vehicle/graybox.compact',
  'vehicle/graybox.pickup',
  'prop/graybox.pickup-item',
  'prop/graybox.pickup-cash',
  'prop/graybox.beam',
  'prop/graybox.crate',
  'prop/graybox.cone',
  'prop/graybox.barrier',
  'prop/graybox.spikestrip',
];

/** Snapshot record flag of ambient entities (`SNAP_FLAG_INSTANCED` of the publisher). */
const AMBIENT_FLAG = 2;

/**
 * The debug cube view's object pool: one three Mesh per entity handle, created on first sight and removed when the
 * handle leaves the snapshot. Materials are TSL node materials (no GLSL, P-03). Geometry and material come from the
 * asset key string the sim put in the snapshot side block:
 *   dbg/box/1x1x1  dbg/platform/6x0.5x6  dbg/static/WxHxD  dbg/ground/<size>
 * and the player's placeholder, `prop/graybox.capsule`: since M01b2 the procedural `bay_rig_v1` mannequin (1.8 m tall, 22 bones,
 * code-built clips, no file) animated from the snapshot's `Anim` state and speed.
 * Keys the pool does not know draw as a unit grey cube.
 */
export interface PoolStyle {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly color: number;
}

const KIND_COLORS: Record<string, number> = {
  box: 0xe0a030,
  platform: 0x3a8fd9,
  static: 0x8a8f98,
  ground: 0x2b3340,
};

/** Parses a debug asset key into a box size and colour; null for keys that are not debug boxes. */
export function parseDebugAsset(key: string): PoolStyle | null {
  const m = /^dbg\/(box|platform|static|ground)\/(.+)$/.exec(key);
  if (!m) return null;
  const kind = m[1] as string;
  const rest = m[2] as string;
  const color = KIND_COLORS[kind] as number;
  if (kind === 'ground') {
    const size = Number(rest);
    return Number.isFinite(size) && size > 0 ? { width: size, height: 0.1, depth: size, color } : null;
  }
  const parts = rest.split('x').map(Number);
  if (parts.length !== 3 || parts.some((p) => !Number.isFinite(p) || p <= 0)) return null;
  return { width: parts[0] as number, height: parts[1] as number, depth: parts[2] as number, color };
}

/** A pool entry that is an animated character instead of one mesh. */
interface Avatar {
  rig: PlaceholderRig;
  animator: MannequinAnimator;
  pendingSec: number;
}

export class ObjectPool {
  private readonly meshes = new Map<number, Object3D>();
  private readonly avatars = new Map<number, Avatar>();
  private readonly lod = new AnimLod(ENGINE_TIERS.desktop.animBands);
  /** Vehicles, props and pickups drawn from the gray-box kit (M03a1), by handle. */
  private readonly things = new Map<number, DrawnThing>();
  private readonly assets = new GrayboxAssets();
  private readonly geometries = new Map<string, BufferGeometry>();
  private readonly materials = new Map<number, MeshStandardNodeMaterial>();
  /** Entities drawn from a gray-box stand-in while the model of their final art loads (M10d1): handle to asset key. */
  private readonly pendingArt = new Map<number, string>();
  private artSeen = -1;
  /** The handle whose mesh stays hidden (the player in first person). */
  hiddenHandle: number | null = null;
  /** The handle whose mesh fades with the camera distance (the followed player), and its opacity 0..1 (`CameraRig.playerOpacity`). */
  fadeHandle: number | null = null;
  fadeOpacity = 1;
  private stamp = 0;
  private readonly seen = new Map<number, number>();
  /** The warm set (`warm`): one object per `WARM_KEYS` entry, kept hidden so that their pipelines and programs stay alive. */
  private warmSet: Group | null = null;
  private readonly warmRigs: PlaceholderRig[] = [];

  constructor(private readonly scene: Pick<Scene, 'add' | 'remove'>) {}

  get size(): number {
    return this.meshes.size;
  }

  /** The mesh for a handle, if one exists (tests and the bridge). */
  meshFor(handle: number): Object3D | undefined {
    return this.meshes.get(handle);
  }

  /** The animator of a character entry (tests and the bridge). */
  animatorFor(handle: number): MannequinAnimator | undefined {
    return this.avatars.get(handle)?.animator;
  }

  private readonly attachOpacity = new Map<number, number>();
  private readonly tmp = new Vector3();

  /**
   * M02g1: the parts of the followed vehicle that stand between the chase camera and its anchor (the tow boom) fade out, render-only: the
   * sim, the physics and the camera ray are untouched. The part fades when the segment from the camera to the anchor passes within its
   * radius of its centre, and eases back when it does not (10 per second). Returns the lowest opacity of the vehicle's attachments, 1 for
   * a vehicle that has none or an unknown handle.
   */
  fadeAttachments(handle: number, cam: { x: number; y: number; z: number }, anchor: { x: number; y: number; z: number }, dtSec: number): number {
    const thing = this.things.get(handle);
    const parts = thing?.attachments;
    if (!thing || !parts || parts.length === 0) return 1;
    thing.root.updateWorldMatrix(true, false);
    let lowest = 1;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (!p) continue;
      const c = this.tmp.set(p.centre[0], p.centre[1], p.centre[2]);
      thing.root.localToWorld(c);
      // distance from c to the segment cam -> anchor
      const sx = anchor.x - cam.x, sy = anchor.y - cam.y, sz = anchor.z - cam.z;
      const len2 = sx * sx + sy * sy + sz * sz;
      let t = len2 > 0 ? ((c.x - cam.x) * sx + (c.y - cam.y) * sy + (c.z - cam.z) * sz) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(cam.x + sx * t - c.x, cam.y + sy * t - c.y, cam.z + sz * t - c.z);
      const target = d < p.radius ? 0.12 : 1;
      const key = handle * 8 + i;
      const cur = this.attachOpacity.get(key) ?? 1;
      const next = cur + (target - cur) * Math.min(1, Math.max(0, dtSec) * 10);
      this.attachOpacity.set(key, next);
      for (const m of p.materials) m.opacity = next;
      p.node.visible = next > 0.03;
      if (next < lowest) lowest = next;
    }
    return lowest;
  }

  /** Sets the anim LOD bands of the tier (config/engine-tiers.json). */
  setLodBands(bands: { fullHzWithinM: number; halfHzWithinM: number; quarterHzWithinM: number }): void {
    this.lod.setBands(bands);
  }

  /**
   * Create, move and remove meshes so they match `poses[0..count)`. `dtSec` is the frame time, which the character
   * animators consume; `camera` is the camera position for the animation LOD bands.
   */
  sync(
    poses: readonly Pose[], count: number, keyOf: (renderKey: number) => string | undefined,
    dtSec = 0, camera: { x: number; y: number; z: number } | null = null,
  ): void {
    this.stamp++;
    this.lod.nextFrame();
    if (art.version !== this.artSeen) this.refreshArt();
    for (let i = 0; i < count; i++) {
      const p = poses[i] as Pose;
      // ambient entities (traffic, parked cars) are drawn instanced by the world layer, not one mesh each
      if ((p.flags & AMBIENT_FLAG) !== 0) continue;
      let mesh = this.meshes.get(p.handle);
      if (!mesh) {
        const key = keyOf(p.renderKey) ?? '';
        if (key === GRAYBOX_CAPSULE) {
          const rig = buildPlaceholderRig();
          this.avatars.set(p.handle, { rig, animator: new MannequinAnimator(rig), pendingSec: 0 });
          mesh = rig.root;
        } else if (isGrayboxThing(key)) {
          const thing = buildGrayboxThing(this.assets, key) as DrawnThing;
          this.things.set(p.handle, thing);
          mesh = thing.root;
        } else if (isArtKey(key)) {
          // the final model, or the gray-box stand-in until it has arrived (M10d1)
          const model = art.get(key);
          let thing: DrawnThing;
          if (model) thing = buildArtThing(this.assets, key, model);
          else {
            art.request(key);
            thing = buildGrayboxThing(this.assets, grayboxOf(key)) as DrawnThing;
            this.pendingArt.set(p.handle, key);
          }
          this.things.set(p.handle, thing);
          mesh = thing.root;
        } else {
          mesh = this.create(key);
        }
        // M02g1: the look finds the actors by this tag (shadow casters on the desktop tiers); the engine draws them either way.
        mesh.userData['dvActor'] = key === GRAYBOX_CAPSULE ? 'avatar' : key.startsWith('vehicle/') || key === 'prop/police.heli' ? 'vehicle' : 'prop';
        this.meshes.set(p.handle, mesh);
        this.scene.add(mesh);
      }
      mesh.position.set(p.px, p.py, p.pz);
      mesh.quaternion.set(p.qx, p.qy, p.qz, p.qw);
      const shown = (p.flags & 1) !== 0 && p.handle !== this.hiddenHandle;
      const avatar = this.avatars.get(p.handle);
      if (avatar) {
        const fade = p.handle === this.fadeHandle ? this.fadeOpacity : 1;
        avatar.rig.setOpacity(shown ? fade : 0);
        // Mixer rate bands (full, half, quarter, frozen) by distance from the camera; a mixer that skips frames gets the elapsed time next.
        const dist = camera ? Math.hypot(p.px - camera.x, p.py - camera.y, p.pz - camera.z) : 0;
        avatar.pendingSec += dtSec;
        if (this.lod.update(dist, p.handle & 3)) {
          avatar.animator.update(dtSec, p.animState, p.animP0, avatar.pendingSec);
          avatar.pendingSec = 0;
        }
      } else {
        mesh.visible = shown;
        // a vehicle's forward speed and steer input ride in the record's anim params
        this.things.get(p.handle)?.update(dtSec, p.animP0, p.animP1);
      }
      this.seen.set(p.handle, this.stamp);
    }
    for (const [handle, mesh] of this.meshes) {
      if (this.seen.get(handle) === this.stamp) continue;
      this.scene.remove(mesh);
      this.meshes.delete(handle);
      this.seen.delete(handle);
      for (const a of this.things.get(handle)?.attachments ?? []) for (const m of a.materials) m.dispose();
      this.things.delete(handle);
      this.pendingArt.delete(handle);
      this.disposeAvatar(handle);
    }
  }

  /**
   * Compiles the render programs of the cast kit before a mission draws it (DL-715, M05b2 AC-8): a mission's first beat spawns its cast
   * on the tick the beat starts, and a program first linked on that frame stalls the main thread. `compile` is the renderer's
   * `compileAsync(object, camera, scene)` (three r186 `Renderer.compileAsync`), which collects the objects synchronously and then
   * builds and links their pipelines without blocking where the backend allows it (WebGL2: KHR_parallel_shader_compile). The objects
   * are hidden once the compile has collected them, so they are never drawn; they stay in the scene so their programs are not released.
   */
  warm(compile: (root: Object3D) => Promise<unknown>): Promise<void> {
    if (this.warmSet) return Promise.resolve();
    const set = new Group();
    set.name = 'dv:warm';
    for (const key of WARM_KEYS) {
      let obj: Object3D;
      if (key === GRAYBOX_CAPSULE) {
        const rig = buildPlaceholderRig();
        this.warmRigs.push(rig);
        obj = rig.root;
      } else {
        obj = buildGrayboxThing(this.assets, key)?.root ?? this.create(key);
      }
      set.add(obj);
    }
    // the compile collects what the camera sees; the warm set is collected wherever it stands
    set.traverse((o) => void (o.frustumCulled = false));
    this.warmSet = set;
    this.scene.add(set);
    let done: Promise<unknown>;
    try {
      done = compile(set);
    } catch (e) {
      done = Promise.reject(e);
    }
    set.visible = false;
    return done.then(
      () => undefined,
      () => undefined,
    );
  }

  /** Swaps the gray-box stand-ins whose model has arrived for the final art (M10d1), keeping pose, visibility and tags. */
  private refreshArt(): void {
    this.artSeen = art.version;
    for (const [handle, key] of [...this.pendingArt]) {
      const model = art.get(key);
      const old = this.meshes.get(handle);
      if (!model || !old) continue;
      const thing = buildArtThing(this.assets, key, model);
      thing.root.position.copy(old.position);
      thing.root.quaternion.copy(old.quaternion);
      thing.root.visible = old.visible;
      thing.root.userData['dvActor'] = old.userData['dvActor'];
      this.scene.remove(old);
      this.scene.add(thing.root);
      for (const a of this.things.get(handle)?.attachments ?? []) for (const m of a.materials) m.dispose();
      this.things.set(handle, thing);
      this.meshes.set(handle, thing.root);
      this.pendingArt.delete(handle);
    }
  }

  /** The asset keys whose final model has not arrived yet (QA bridge and tests). */
  pendingArtKeys(): string[] {
    return [...new Set(this.pendingArt.values())].sort();
  }

  /** Remove every mesh (worker restart: handles are not valid across sessions). */
  clear(): void {
    this.pendingArt.clear();
    for (const mesh of this.meshes.values()) this.scene.remove(mesh);
    for (const handle of [...this.avatars.keys()]) this.disposeAvatar(handle);
    this.things.clear();
    this.meshes.clear();
    this.seen.clear();
  }

  dispose(): void {
    this.clear();
    if (this.warmSet) this.scene.remove(this.warmSet);
    this.warmSet = null;
    for (const rig of this.warmRigs.splice(0)) rig.dispose();
    for (const g of this.geometries.values()) g.dispose();
    for (const m of this.materials.values()) m.dispose();
    this.geometries.clear();
    this.materials.clear();
    this.assets.dispose();
  }

  private disposeAvatar(handle: number): void {
    const a = this.avatars.get(handle);
    if (!a) return;
    a.animator.dispose();
    a.rig.dispose();
    this.avatars.delete(handle);
  }

  private create(key: string): Mesh {
    const style = parseDebugAsset(key) ?? { width: 1, height: 1, depth: 1, color: 0x9aa0a6 };
    const gKey = `${style.width}x${style.height}x${style.depth}`;
    let geometry = this.geometries.get(gKey);
    if (!geometry) {
      geometry = new BoxGeometry(style.width, style.height, style.depth);
      this.geometries.set(gKey, geometry);
    }
    let material = this.materials.get(style.color);
    if (!material) {
      material = new MeshStandardNodeMaterial({ color: style.color, roughness: 0.8, metalness: 0.05 });
      this.materials.set(style.color, material);
    }
    return new Mesh(geometry, material);
  }
}
