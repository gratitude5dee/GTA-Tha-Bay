import { CanvasTexture, DoubleSide, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3, type Camera, type Scene } from 'three/webgpu';

/**
 * Scene panels for the UI (M04b2 skeleton of C13 `XrPanels`: `add`, `remove`, `setVisible`; the quad and cylinder layers of Quest and
 * the wrist and lazy-follow anchors are M11b1 and M11b3). A panel is a plane with a canvas texture. A `world` panel opens at
 * `distanceM` in front of the head, turned to face it, and stays there until it is closed. The canvas is redrawn and the texture uploaded
 * only when the panel says it changed. Head-locked UI does not exist: the anchor type has no such value.
 *
 * The structural `PanelDef` is the `@dv/ui` `XrPanelDef`; the engine imports no UI code.
 */
export interface PanelDef {
  id: string;
  sizeM: { w: number; h: number };
  pixels: { w: number; h: number };
  anchor: 'world' | 'wrist' | 'lazy-follow';
  distanceM: number;
  draw(ctx: CanvasRenderingContext2D, tSec: number): void;
  onRay(hit: { u: number; v: number } | null, pressed: boolean, hand: 'left' | 'right'): void;
  dirty(): boolean;
}

interface Entry {
  def: PanelDef;
  canvas: HTMLCanvasElement;
  texture: CanvasTexture;
  mesh: Mesh;
  uploads: number;
  openedAt: Vector3;
}

export interface XrPanelsInfo {
  id: string;
  visible: boolean;
  anchor: string;
  /** Distance from the head at the moment the panel opened, metres. */
  openDistanceM: number;
  /** Distance from the head now. */
  distanceM: number;
  sizeM: { w: number; h: number };
  pixels: { w: number; h: number };
  /** Texture uploads so far. */
  uploads: number;
}

export class XrPanelsLite {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly scene: Pick<Scene, 'add' | 'remove'>,
    private readonly camera: Camera,
  ) {}

  add(def: PanelDef): void {
    this.remove(def.id);
    const doc = typeof document === 'undefined' ? null : document;
    if (!doc) return;
    const canvas = doc.createElement('canvas');
    canvas.width = def.pixels.w;
    canvas.height = def.pixels.h;
    const texture = new CanvasTexture(canvas);
    const mesh = new Mesh(new PlaneGeometry(def.sizeM.w, def.sizeM.h), new MeshBasicMaterial({ map: texture, side: DoubleSide, transparent: false }));
    mesh.name = `xr-panel.${def.id}`;
    // Open in front of the head, facing it (yaw only), then stay.
    this.camera.updateWorldMatrix(true, false);
    const head = this.camera.getWorldPosition(new Vector3());
    const fwd = new Vector3(0, 0, -1).transformDirection(this.camera.matrixWorld);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    mesh.position.copy(head).addScaledVector(fwd, def.distanceM);
    mesh.rotation.y = Math.atan2(-fwd.x, -fwd.z) + Math.PI;
    mesh.updateMatrixWorld(true);
    this.scene.add(mesh);
    const e: Entry = { def, canvas, texture, mesh, uploads: 0, openedAt: head.clone() };
    this.entries.set(def.id, e);
    this.draw(e, 0, true);
  }

  remove(id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    this.scene.remove(e.mesh);
    e.mesh.geometry.dispose();
    (e.mesh.material as MeshBasicMaterial).dispose();
    e.texture.dispose();
    this.entries.delete(id);
  }

  setVisible(id: string, visible: boolean): void {
    const e = this.entries.get(id);
    if (e) e.mesh.visible = visible;
  }

  /** Once per frame: redraw and upload the panels that changed. */
  update(tSec: number): void {
    for (const e of this.entries.values()) if (e.mesh.visible && e.def.dirty()) this.draw(e, tSec, false);
  }

  private draw(e: Entry, tSec: number, force: boolean): void {
    const g = e.canvas.getContext('2d');
    if (!g) return;
    if (force || e.def.dirty()) {
      e.def.draw(g, tSec);
      e.texture.needsUpdate = true;
      e.uploads++;
    }
  }

  /** A ray at panel coordinates (the test and the XR input router call this). */
  ray(id: string, hit: { u: number; v: number } | null, pressed: boolean, hand: 'left' | 'right' = 'right'): void {
    this.entries.get(id)?.def.onRay(hit, pressed, hand);
  }

  info(id: string): XrPanelsInfo | null {
    const e = this.entries.get(id);
    if (!e) return null;
    const head = this.camera.getWorldPosition(new Vector3());
    return {
      id,
      visible: e.mesh.visible,
      anchor: e.def.anchor,
      openDistanceM: e.mesh.position.distanceTo(e.openedAt),
      distanceM: e.mesh.position.distanceTo(head),
      sizeM: e.def.sizeM,
      pixels: e.def.pixels,
      uploads: e.uploads,
    };
  }

  dispose(): void {
    for (const id of [...this.entries.keys()]) this.remove(id);
  }
}
