/**
 * The physics wireframe (QA builds with `?debug=1`; 01-engine.md 2.11; M03a1). Rapier's debug-render API is UNVERIFIED (U-ENG-6),
 * so this draws the fallback: the shape every body was created with (`BodyDesc`: box, sphere, capsule), as a wireframe at the
 * pose of its entity. The sim lists the shapes by entity handle (`debug.physics`); the poses come from the snapshot, so the
 * wireframes move with the meshes. Toggle with F6.
 *
 * Reachable only through a dynamic import behind `VITE_DV_QA === '1'`.
 */
import {
  BoxGeometry, CapsuleGeometry, EdgesGeometry, Group, LineBasicNodeMaterial, LineSegments, SphereGeometry, WireframeGeometry,
  type BufferGeometry, type Object3D, type Scene,
} from 'three/webgpu';
import type { Pose } from '../snapshot/interpolate.ts';

export interface PhysicsShapeInfo {
  handle: number;
  shape: string;
  dims: number[];
  kind: string;
}

const COLORS: Readonly<Record<string, number>> = { dynamic: 0x3df0a0, kinematic: 0x4aa8ff, fixed: 0xf0c040 };

export class PhysicsDraw {
  readonly root = new Group();
  private readonly lines = new Map<number, LineSegments>();
  private readonly materials = new Map<number, LineBasicNodeMaterial>();
  private readonly geometries: BufferGeometry[] = [];
  private shapes = new Map<number, PhysicsShapeInfo>();
  private on = false;

  constructor(private readonly scene: Pick<Scene, 'add' | 'remove'>) {
    this.root.name = 'physics-wireframe';
    this.root.visible = false;
    scene.add(this.root);
  }

  get visible(): boolean {
    return this.on;
  }

  /** Number of wireframes in the scene. */
  get count(): number {
    return this.lines.size;
  }

  /** The kinds drawn, for the bridge. */
  get shapesDrawn(): string[] {
    return [...this.shapes.values()].map((s) => s.shape);
  }

  toggle(on?: boolean): void {
    this.on = on ?? !this.on;
    this.root.visible = this.on;
  }

  /** The newest shape list from the sim. */
  setShapes(list: readonly PhysicsShapeInfo[]): void {
    this.shapes = new Map(list.map((s) => [s.handle, s]));
    for (const [handle, line] of this.lines) {
      if (this.shapes.has(handle)) continue;
      this.root.remove(line);
      this.lines.delete(handle);
    }
  }

  /** Place the wireframes at the poses of this frame. */
  sync(poses: readonly Pose[], count: number): void {
    if (!this.on) return;
    for (let i = 0; i < count; i++) {
      const p = poses[i] as Pose;
      const info = this.shapes.get(p.handle);
      if (!info) continue;
      let line = this.lines.get(p.handle);
      if (!line) {
        const made = this.make(info);
        if (!made) continue;
        line = made;
        this.lines.set(p.handle, line);
        this.root.add(line);
      }
      line.position.set(p.px, p.py, p.pz);
      line.quaternion.set(p.qx, p.qy, p.qz, p.qw);
      // a kinematic capsule stands on its feet: the pose is the feet, the shape is centred half the height above
      if (info.shape === 'capsule') line.position.y += (info.dims[0] as number) + (info.dims[1] as number);
    }
  }

  private make(info: PhysicsShapeInfo): LineSegments | null {
    const d = info.dims;
    let g: BufferGeometry;
    switch (info.shape) {
      case 'box':
        g = new EdgesGeometry(new BoxGeometry((d[0] as number) * 2, (d[1] as number) * 2, (d[2] as number) * 2));
        break;
      case 'sphere':
        g = new WireframeGeometry(new SphereGeometry(d[0] as number, 10, 8));
        break;
      case 'capsule':
        g = new WireframeGeometry(new CapsuleGeometry(d[1] as number, (d[0] as number) * 2, 4, 10));
        break;
      default:
        return null;
    }
    this.geometries.push(g);
    const color = COLORS[info.kind] ?? 0xffffff;
    let m = this.materials.get(color);
    if (!m) {
      m = new LineBasicNodeMaterial({ color });
      this.materials.set(color, m);
    }
    const line = new LineSegments(g, m);
    line.frustumCulled = false;
    return line;
  }

  dispose(): void {
    this.scene.remove(this.root as Object3D);
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials.values()) m.dispose();
    this.lines.clear();
  }
}
