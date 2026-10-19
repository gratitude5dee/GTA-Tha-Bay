import { Frustum, Matrix4, Sphere, type BufferGeometry, type Camera, type Object3D } from 'three/webgpu';

/**
 * RenderBudgetMeter (11-platform-perf.md section 5). Backend-independent per-frame counts: the visible (ancestors visible,
 * layers enabled, frustum-tested) Mesh, SkinnedMesh, InstancedMesh, BatchedMesh, Points, Line and Sprite nodes, plus one per
 * shadow pass for each shadow-casting renderable, and the triangle total from geometry index counts times instances. It does
 * not use `renderer.info.render.drawCalls`, whose value with BundleGroup on the WebGPU backend is UNVERIFIED. QA builds
 * measure with it: it walks the scene graph once per measured frame.
 */
export interface FrameCounts {
  renderObjects: number;
  triangles: number;
}

interface Renderable extends Object3D {
  isMesh?: boolean;
  isPoints?: boolean;
  isLine?: boolean;
  isSprite?: boolean;
  isInstancedMesh?: boolean;
  isBatchedMesh?: boolean;
  count?: number;
  geometry?: BufferGeometry;
  boundingSphere?: Sphere | null;
}

const isRenderable = (o: Renderable): boolean => o.isMesh === true || o.isPoints === true || o.isLine === true || o.isSprite === true;

function triangleCount(o: Renderable): number {
  if (o.isPoints === true || o.isLine === true) return 0;
  const g = o.geometry;
  if (!g) return o.isSprite === true ? 2 : 0;
  const total = g.index ? g.index.count : (g.getAttribute('position')?.count ?? 0);
  const range = g.drawRange;
  const start = Math.max(0, range.start);
  const count = Math.max(0, Math.min(total - start, range.count));
  const instances = o.isInstancedMesh === true ? (o.count ?? 1) : 1;
  return (count / 3) * instances;
}

export class RenderBudgetMeter {
  private readonly frustum = new Frustum();
  private readonly projView = new Matrix4();
  private readonly sphere = new Sphere();
  private readonly objectsRing: Float32Array;
  private head = 0;
  private filled = 0;
  /** Largest counts seen since the last reset. */
  maxRenderObjects = 0;
  maxTriangles = 0;
  frames = 0;

  constructor(ringSize = 36_000) {
    this.objectsRing = new Float32Array(ringSize);
  }

  reset(): void {
    this.head = 0;
    this.filled = 0;
    this.maxRenderObjects = 0;
    this.maxTriangles = 0;
    this.frames = 0;
  }

  /**
   * Counts one frame. `shadowPasses` is the number of shadow passes that render casters this frame (cascades x lights); each
   * shadow-casting renderable adds that many render objects.
   */
  measure(scene: Object3D, camera: Camera, shadowPasses = 0, extra: readonly { scene: Object3D; camera: Camera }[] = []): FrameCounts {
    let objects = 0;
    let triangles = 0;
    // `extra` roots (the backdrop pass of M02b1) are drawn in the same frame with their own camera planes: counted with it.
    for (const root of [{ scene, camera }, ...extra]) {
      root.camera.updateMatrixWorld();
      this.projView.multiplyMatrices(root.camera.projectionMatrix, root.camera.matrixWorldInverse);
      this.frustum.setFromProjectionMatrix(this.projView);
      const cam = root.camera;
      const visit = (o: Object3D): void => {
        if (!o.visible) return;
        const r = o as Renderable;
        // A node on another layer is not drawn, but its children may be on the camera's layers.
        if (o.layers.test(cam.layers) && isRenderable(r) && this.inFrustum(r)) {
          objects += 1;
          if (shadowPasses > 0 && r.castShadow) objects += shadowPasses;
          triangles += triangleCount(r);
        }
        for (const c of o.children) visit(c);
      };
      visit(root.scene);
    }
    this.record(objects, triangles);
    return { renderObjects: objects, triangles };
  }

  private inFrustum(o: Renderable): boolean {
    if (!o.frustumCulled) return true;
    const g = o.geometry;
    if (o.isSprite === true || !g) return true;
    if (o.isInstancedMesh === true || o.isBatchedMesh === true) {
      const bs = o.boundingSphere;
      if (!bs) return true;
      this.sphere.copy(bs).applyMatrix4(o.matrixWorld);
      return this.frustum.intersectsSphere(this.sphere);
    }
    if (g.boundingSphere === null) g.computeBoundingSphere();
    if (g.boundingSphere === null) return true;
    this.sphere.copy(g.boundingSphere).applyMatrix4(o.matrixWorld);
    return this.frustum.intersectsSphere(this.sphere);
  }

  private record(objects: number, triangles: number): void {
    this.objectsRing[this.head] = objects;
    this.head = (this.head + 1) % this.objectsRing.length;
    if (this.filled < this.objectsRing.length) this.filled += 1;
    this.frames += 1;
    if (objects > this.maxRenderObjects) this.maxRenderObjects = objects;
    if (triangles > this.maxTriangles) this.maxTriangles = triangles;
  }

  /** 95th percentile (nearest rank) of the per-frame render-object counts. */
  objectsP95(): number {
    if (this.filled === 0) return 0;
    const s = this.objectsRing.slice(0, this.filled).sort();
    return s[Math.min(s.length - 1, Math.max(0, Math.ceil(0.95 * s.length) - 1))] as number;
  }
}
