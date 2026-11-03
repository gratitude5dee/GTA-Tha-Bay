import {
  AmbientLight, CylinderGeometry, DirectionalLight, Group, Mesh, MeshStandardNodeMaterial, PerspectiveCamera, Scene, SphereGeometry, Color,
  Texture, SRGBColorSpace, type Material, type Object3D,
} from 'three/webgpu';
import { buildPlaceholderRig } from './anim/placeholder-rig.ts';
import { assembleAvatar, type AssemblySlot, type Assembly, type AssembledPart } from './avatar/assemble.ts';
import { parsePersonGlb, type PersonMesh } from './avatar/person-glb.ts';

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
  /** The part of each slot and how it draws (M10d4): a model, a Coast row's fallback model, or the mannequin variant. */
  parts?: readonly StagePart[];
  /** Face morph weights by catalog morph id. */
  morphs?: Readonly<Record<string, number>>;
  /** Colour of the accessory (sRGB hex). */
  accessoryColor?: number;
}

export interface StagePart {
  slot: AssemblySlot;
  /** `character/pc-top-hoodie`; empty for the mannequin path. */
  ref: string;
  path: 'model' | 'fallback' | 'mannequin';
}

/** What the stage needs from the app to draw models: the bytes of an asset by AssetRef, and optionally an atlas page as a texture. */
export interface StageAssets {
  load(ref: string): Promise<ArrayBuffer | Uint8Array>;
  /** An atlas page as a decoded image (the stage makes the texture). */
  texture?(ref: string): Promise<ImageBitmap | null>;
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
  /** The URL of a portrait card (a blob URL kept for the session); null when it cannot be had. */
  portrait(ref: string): Promise<string | null>;
  hide(): void;
  /** Current state for the QA bridge and tests. */
  readonly state: {
    shown: boolean; yaw: number; zoom: 'full' | 'head'; autoRotate: boolean; params: StageParams | null;
    /** `models` once the assembled figure is on stage; `mannequin` for the variant figure (also while models load). */
    figure: 'models' | 'mannequin';
    /** The parts of the current avatar and how each draws. */
    parts: readonly StagePart[];
    /** Triangles and textures of the assembled figure (0 on the mannequin). */
    triangles: number;
    textures: number;
  };
}

const TOP_BONES = new Set(['spine', 'chest', 'upperChest', 'l_shoulder', 'r_shoulder', 'l_upperArm', 'r_upperArm']);
const BOTTOM_BONES = new Set(['hips', 'l_upperLeg', 'r_upperLeg', 'l_lowerLeg', 'r_lowerLeg']);
const SHOE_BONES = new Set(['l_foot', 'r_foot', 'l_toes', 'r_toes']);
/** Turntable speed, radians per second. */
const SPIN = 0.5;

export function createCreatorStage(host: StageHost, assets?: StageAssets): CreatorStage {
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

  const state: CreatorStage['state'] = { shown: false, yaw: 0.35, zoom: 'full', autoRotate: true, params: null, figure: 'mannequin', parts: [], triangles: 0, textures: 0 };
  const models = createModelCache(assets);
  let figure: Assembly | null = null;
  let figureKey = '';
  let want = 0;
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

  const dropFigure = (): void => {
    if (figure) {
      pivot.remove(figure.root);
      figure.dispose();
      figure = null;
    }
    figureKey = '';
    rig.root.visible = true;
    state.figure = 'mannequin';
    state.triangles = 0;
    state.textures = 0;
  };

  /** Draws the avatar from its part models when the app can load them and the body and face are models; otherwise the mannequin stays. */
  const syncFigure = async (p: StageParams): Promise<void> => {
    const parts = p.parts ?? [];
    const slotPath = (slot: AssemblySlot): StagePart | undefined => parts.find((x) => x.slot === slot);
    const body = slotPath('body');
    const face = slotPath('face');
    if (!assets || !body || !face || body.path === 'mannequin' || face.path === 'mannequin') {
      dropFigure();
      return;
    }
    const ticket = ++want;
    const draw = parts.filter((x) => x.ref !== '' && x.path !== 'mannequin');
    let meshes: PersonMesh[];
    try {
      meshes = await Promise.all(draw.map((x) => models.mesh(x.ref)));
    } catch {
      if (ticket === want) dropFigure();
      return;
    }
    if (ticket !== want || !state.shown) return;
    const key = draw.map((x) => `${x.slot}:${x.ref}`).join('|');
    const colors = { skin: p.skin, hair: p.hair, top: p.top, bottom: p.bottom, shoes: p.shoes, accessory: p.accessoryColor ?? p.hair };
    if (!figure || key !== figureKey) {
      const textures = await models.textures();
      if (ticket !== want || !state.shown) return;
      if (figure) {
        pivot.remove(figure.root);
        figure.dispose();
      }
      const assembled: AssembledPart[] = draw.map((x, i) => ({ slot: x.slot, mesh: meshes[i] as PersonMesh }));
      figure = assembleAvatar({ parts: assembled, colors, ...(p.morphs ? { morphs: p.morphs } : {}), textures });
      figureKey = key;
      pivot.add(figure.root);
      rig.root.visible = false;
      state.figure = 'models';
      state.triangles = figure.triangles;
      state.textures = figure.textures;
    } else {
      figure.setColors(colors);
      if (p.morphs) figure.setMorphs(p.morphs);
    }
    if (p.morphs) figure.setMorphs(p.morphs);
    figure.root.scale.set(p.buildScale, (p.heightScale * figure.heightM) / 1.8, p.buildScale);
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
      state.parts = p.parts ?? [];
      void syncFigure(p);
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
    portrait(ref) {
      return models.portrait(ref);
    },
    hide() {
      if (!state.shown) return;
      state.shown = false;
      want++;
      cancelAnimationFrame(raf);
      host.clearMenuScene();
    },
  };
}

/** Loads and keeps the parsed part models and the three atlas pages (one load per ref, a failed load is retried on the next ask). */
function createModelCache(assets: StageAssets | undefined): {
  mesh(ref: string): Promise<PersonMesh>;
  portrait(ref: string): Promise<string | null>;
  textures(): Promise<Partial<Record<'skin' | 'cloth' | 'hair', Texture>>>;
} {
  const meshes = new Map<string, Promise<PersonMesh>>();
  let pages: Promise<Partial<Record<'skin' | 'cloth' | 'hair', Texture>>> | null = null;
  const cards = new Map<string, Promise<string | null>>();
  return {
    portrait(ref) {
      let hit = cards.get(ref);
      if (!hit) {
        if (!assets || typeof URL === 'undefined' || typeof Blob === 'undefined') return Promise.resolve(null);
        hit = assets.load(ref).then((b) => URL.createObjectURL(new Blob([b as BlobPart], { type: 'image/png' }))).catch(() => {
          cards.delete(ref);
          return null;
        });
        cards.set(ref, hit);
      }
      return hit;
    },
    mesh(ref) {
      let hit = meshes.get(ref);
      if (!hit) {
        if (!assets) return Promise.reject(new Error('no asset port'));
        hit = assets.load(ref).then((b) => parsePersonGlb(b instanceof Uint8Array ? b : new Uint8Array(b)));
        hit.catch(() => meshes.delete(ref));
        meshes.set(ref, hit);
      }
      return hit;
    },
    textures() {
      if (!pages) {
        const load = async (id: 'skin' | 'cloth' | 'hair'): Promise<Texture | null> => {
          const bitmap = assets?.texture ? await assets.texture(`texture/pc.${id}`).catch(() => null) : null;
          if (!bitmap) return null;
          const tex = new Texture(bitmap);
          tex.colorSpace = SRGBColorSpace;
          tex.flipY = false;
          tex.needsUpdate = true;
          return tex;
        };
        pages = Promise.all([load('skin'), load('cloth'), load('hair')]).then(([skin, cloth, hair]) => {
          const out: Partial<Record<'skin' | 'cloth' | 'hair', Texture>> = {};
          if (skin) out.skin = skin;
          if (cloth) out.cloth = cloth;
          if (hair) out.hair = hair;
          return out;
        });
      }
      return pages;
    },
  };
}
