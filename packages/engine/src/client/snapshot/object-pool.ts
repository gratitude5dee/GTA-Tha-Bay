import { BoxGeometry, Mesh, MeshStandardNodeMaterial, type BufferGeometry, type Object3D, type Scene } from 'three/webgpu';
import { AnimLod, ENGINE_TIERS } from '../anim/lod.ts';
import { buildPlaceholderRig, MannequinAnimator, type PlaceholderRig } from '../anim/placeholder-rig.ts';
import type { Pose } from './interpolate.ts';

export const GRAYBOX_CAPSULE = 'prop/graybox.capsule';

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
  private readonly geometries = new Map<string, BufferGeometry>();
  private readonly materials = new Map<number, MeshStandardNodeMaterial>();
  /** The handle whose mesh stays hidden (the player in first person). */
  hiddenHandle: number | null = null;
  /** The handle whose mesh fades with the camera distance (the followed player), and its opacity 0..1 (`CameraRig.playerOpacity`). */
  fadeHandle: number | null = null;
  fadeOpacity = 1;
  private stamp = 0;
  private readonly seen = new Map<number, number>();

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
    for (let i = 0; i < count; i++) {
      const p = poses[i] as Pose;
      let mesh = this.meshes.get(p.handle);
      if (!mesh) {
        const key = keyOf(p.renderKey) ?? '';
        if (key === GRAYBOX_CAPSULE) {
          const rig = buildPlaceholderRig();
          this.avatars.set(p.handle, { rig, animator: new MannequinAnimator(rig), pendingSec: 0 });
          mesh = rig.root;
        } else {
          mesh = this.create(key);
        }
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
      }
      this.seen.set(p.handle, this.stamp);
    }
    for (const [handle, mesh] of this.meshes) {
      if (this.seen.get(handle) === this.stamp) continue;
      this.scene.remove(mesh);
      this.meshes.delete(handle);
      this.seen.delete(handle);
      this.disposeAvatar(handle);
    }
  }

  /** Remove every mesh (worker restart: handles are not valid across sessions). */
  clear(): void {
    for (const mesh of this.meshes.values()) this.scene.remove(mesh);
    for (const handle of [...this.avatars.keys()]) this.disposeAvatar(handle);
    this.meshes.clear();
    this.seen.clear();
  }

  dispose(): void {
    this.clear();
    for (const g of this.geometries.values()) g.dispose();
    for (const m of this.materials.values()) m.dispose();
    this.geometries.clear();
    this.materials.clear();
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
