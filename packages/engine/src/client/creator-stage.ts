import {
  AmbientLight, CylinderGeometry, DirectionalLight, Group, Mesh, MeshStandardNodeMaterial, PerspectiveCamera, Scene, SphereGeometry, Color,
  type Material, type Object3D,
} from 'three/webgpu';
import { buildPlaceholderRig } from './anim/placeholder-rig.ts';

/**
 * The creator preview (10-ui-pages.md 2.8, M04b2): one `bay_rig_v1` mannequin on the shared canvas through the renderer host's menu scene
 * (C13 1.1: one canvas, never a second WebGL context). Parts without a model render as mannequin variants: height, build and palette tints.
 * The parameter shape is the structural twin of `MannequinParams` in `@dv/ui` (the engine imports no UI code).
 */
export interface StageParams {
  heightScale: number;
  buildScale: number;
  skin: number;
  hair: number;
  top: number;
  bottom: number;
  shoes: number;
  hairStyle: number;
  accessory: boolean;
  faceIndex: number;
}

export interface StageHost {
  setMenuScene(scene: Object3D, camera: PerspectiveCamera): void;
  clearMenuScene(): void;
}

export interface CreatorStage {
  show(p: StageParams): void;
  setZoom(zoom: 'full' | 'head'): void;
  rotate(dyaw: number): void;
  setReducedMotion(on: boolean): void;
  hide(): void;
  /** Current state for the QA bridge and tests. */
  readonly state: { shown: boolean; yaw: number; zoom: 'full' | 'head'; autoRotate: boolean; params: StageParams | null };
}

const TOP_BONES = new Set(['spine', 'chest', 'upperChest', 'l_shoulder', 'r_shoulder', 'l_upperArm', 'r_upperArm']);
const BOTTOM_BONES = new Set(['hips', 'l_upperLeg', 'r_upperLeg', 'l_lowerLeg', 'r_lowerLeg']);
const SHOE_BONES = new Set(['l_foot', 'r_foot', 'l_toes', 'r_toes']);
/** Turntable speed, radians per second. */
const SPIN = 0.5;

export function createCreatorStage(host: StageHost): CreatorStage {
  const scene = new Scene();
  scene.background = new Color(0x131a26);
  const camera = new PerspectiveCamera(32, 1, 0.1, 40);
  scene.add(new AmbientLight(0xffffff, 1.1));
  const key = new DirectionalLight(0xfff1dd, 2.6);
  key.position.set(2, 3, -3);
  scene.add(key);
  const rim = new DirectionalLight(0x7aa7ff, 1.2);
  rim.position.set(-3, 2, 3);
  scene.add(rim);

  const floorMat = new MeshStandardNodeMaterial({ color: 0x1d2736, roughness: 0.9 });
  const floor = new Mesh(new CylinderGeometry(0.9, 0.9, 0.04, 40), floorMat);
  floor.position.y = -0.02;
  scene.add(floor);

  const rig = buildPlaceholderRig();
  const pivot = new Group();
  pivot.add(rig.root);
  scene.add(pivot);

  const mats = {
    skin: new MeshStandardNodeMaterial({ color: 0xf0c8a0, roughness: 0.7 }),
    top: new MeshStandardNodeMaterial({ color: 0x4aa3ff, roughness: 0.6 }),
    bottom: new MeshStandardNodeMaterial({ color: 0x334455, roughness: 0.6 }),
    shoes: new MeshStandardNodeMaterial({ color: 0xcccccc, roughness: 0.5 }),
    hair: new MeshStandardNodeMaterial({ color: 0x222222, roughness: 0.8 }),
  };
  // Re-skin the stock mesh parts by the bone they hang from.
  rig.root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const bone = mesh.parent?.name ?? '';
    const isSkin = (mesh.material as MeshStandardNodeMaterial).color?.getHex?.() === 0xf0c8a0;
    mesh.material = (isSkin ? mats.skin : SHOE_BONES.has(bone) ? mats.shoes : BOTTOM_BONES.has(bone) ? mats.bottom : TOP_BONES.has(bone) ? mats.top : mats.top) as Material;
  });
  const head = rig.bones.get('head');
  const hair = new Mesh(new SphereGeometry(0.118, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), mats.hair);
  hair.position.set(0, 0.11, 0.005);
  head?.add(hair);
  const cap = new Mesh(new CylinderGeometry(0.1, 0.12, 0.04, 14), mats.hair);
  cap.position.set(0, 0.2, -0.04);
  head?.add(cap);

  const state: CreatorStage['state'] = { shown: false, yaw: 0.35, zoom: 'full', autoRotate: true, params: null };
  let raf = 0;
  let last = 0;

  const frame = (now: number): void => {
    if (!state.shown) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (state.autoRotate) state.yaw += SPIN * dt;
    pivot.rotation.y = state.yaw;
    raf = requestAnimationFrame(frame);
  };

  const place = (): void => {
    if (state.zoom === 'full') {
      camera.position.set(0, 1.05, -3.9);
      camera.lookAt(0, 0.92, 0);
    } else {
      camera.position.set(0, 1.6, -1.15);
      camera.lookAt(0, 1.58, 0);
    }
  };

  return {
    state,
    show(p) {
      state.params = p;
      rig.root.scale.set(p.buildScale, p.heightScale, p.buildScale);
      mats.skin.color.setHex(p.skin);
      mats.top.color.setHex(p.top);
      mats.bottom.color.setHex(p.bottom);
      mats.shoes.color.setHex(p.shoes);
      mats.hair.color.setHex(p.hair);
      // Hair style: the last style is bald; the cap shows for even styles; face index nudges the head size.
      hair.visible = p.hairStyle !== 16;
      hair.scale.setScalar(0.92 + (p.hairStyle % 5) * 0.045);
      cap.visible = p.accessory;
      head?.scale.setScalar(0.96 + (p.faceIndex % 6) * 0.015);
      place();
      if (!state.shown) {
        state.shown = true;
        host.setMenuScene(scene, camera);
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    },
    setZoom(zoom) {
      state.zoom = zoom;
      place();
    },
    rotate(dyaw) {
      state.yaw += dyaw;
      pivot.rotation.y = state.yaw;
    },
    setReducedMotion(on) {
      state.autoRotate = !on;
    },
    hide() {
      if (!state.shown) return;
      state.shown = false;
      cancelAnimationFrame(raf);
      host.clearMenuScene();
    },
  };
}
