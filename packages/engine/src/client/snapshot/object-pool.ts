import { BoxGeometry, Mesh, MeshStandardNodeMaterial, type BufferGeometry, type Object3D, type Scene } from 'three/webgpu';
import type { Pose } from './interpolate.ts';

/**
 * The debug cube view's object pool: one three Mesh per entity handle, created on first sight and removed when the
 * handle leaves the snapshot. Materials are TSL node materials (no GLSL, P-03). Geometry and material come from the
 * asset key string the sim put in the snapshot side block:
 *   dbg/box/1x1x1  dbg/platform/6x0.5x6  dbg/static/WxHxD  dbg/ground/<size>
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

export class ObjectPool {
  private readonly meshes = new Map<number, Mesh>();
  private readonly geometries = new Map<string, BufferGeometry>();
  private readonly materials = new Map<number, MeshStandardNodeMaterial>();
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

  /** Create, move and remove meshes so they match `poses[0..count)`. */
  sync(poses: readonly Pose[], count: number, keyOf: (renderKey: number) => string | undefined): void {
    this.stamp++;
    for (let i = 0; i < count; i++) {
      const p = poses[i] as Pose;
      let mesh = this.meshes.get(p.handle);
      if (!mesh) {
        mesh = this.create(keyOf(p.renderKey) ?? '');
        this.meshes.set(p.handle, mesh);
        this.scene.add(mesh);
      }
      mesh.position.set(p.px, p.py, p.pz);
      mesh.quaternion.set(p.qx, p.qy, p.qz, p.qw);
      mesh.visible = (p.flags & 1) !== 0;
      this.seen.set(p.handle, this.stamp);
    }
    for (const [handle, mesh] of this.meshes) {
      if (this.seen.get(handle) === this.stamp) continue;
      this.scene.remove(mesh);
      this.meshes.delete(handle);
      this.seen.delete(handle);
    }
  }

  /** Remove every mesh (worker restart: handles are not valid across sessions). */
  clear(): void {
    for (const mesh of this.meshes.values()) this.scene.remove(mesh);
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
