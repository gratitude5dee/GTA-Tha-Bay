import {
  AmbientLight, CylinderGeometry, DirectionalLight, Group, Mesh, MeshStandardNodeMaterial, PerspectiveCamera, Scene, SphereGeometry, Color,
  Texture, SRGBColorSpace, Vector3, type Material, type Object3D, type SkinnedMesh,
} from 'three/webgpu';
import { buildPlaceholderRig } from './anim/placeholder-rig.ts';
import { assembleAvatar, type AssemblySlot, type Assembly, type AssembledPart } from './avatar/assemble.ts';
import { parsePersonGlb, type PersonMesh } from './avatar/person-glb.ts';
import { creatorFrame, cylinderHalfWidth, shownDownTo, type CreatorFrame, type FrameBox, type FrameRect, type FrameSize } from './creator-frame.ts';

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

/** What the stage reads of the shared canvas: its CSS size and where it is in the viewport. */
export interface StageCanvas {
  readonly clientWidth: number;
  readonly clientHeight: number;
  getBoundingClientRect(): { left: number; top: number };
}

export interface StageHost {
  setMenuScene(scene: Object3D, camera: PerspectiveCamera): void;
  clearMenuScene(): void;
  /**
   * The canvas the menu scene is drawn on. With it the stage keeps its camera's aspect ratio and frames the figure in the free area
   * (`setFreeArea`); a host without one gets the centred picture and the aspect ratio the host sets at its next resize.
   */
  readonly currentCanvas?: StageCanvas;
}

/** The stage's frame (`creatorFrame`) on a canvas of `canvas` CSS pixels. */
export interface StageFrame extends CreatorFrame {
  canvas: FrameSize;
}

/** Where the drawn figure is on the canvas, CSS pixels from the canvas's top-left corner (`CreatorStage.measure`). */
export interface StageMeasure {
  canvas: FrameSize;
  /** The box around every vertex of the drawn figure (the assembled models or the mannequin, at the current turn) that is on the canvas vertically; null when none is. */
  figure: FrameBox | null;
  /** The centre of the floor disc, where the turntable axis meets the floor. */
  floor: { x: number; y: number };
  /**
   * The highest row the floor disc is drawn on (its far edge); past the canvas's bottom edge where the picture does not show the floor.
   * The disc is wider than the figure: from this row down it can run past the free area, behind the panel.
   */
  floorTop: number;
}

export interface CreatorStage {
  show(p: StageParams): void;
  setZoom(zoom: 'full' | 'head'): void;
  rotate(dyaw: number): void;
  setReducedMotion(on: boolean): void;
  /**
   * The part of the viewport the page leaves free for the figure (CSS pixels, viewport coordinates: the area beside the options panel
   * and above the zoom buttons), or null for none. The stage shifts its projection so that the figure and the floor disc are centred in
   * it, at both zoom presets, and scales the picture down when the area is smaller than the figure, however small that makes it
   * (BD-FIX-CREATOR-FRAME-01, -06). The area is forgotten at `hide`.
   */
  setFreeArea(area: FrameRect | null): void;
  /** Projects the drawn figure's vertices: where the figure really is on the canvas. For the QA bridge and tests; null while hidden or without a canvas. */
  measure(): StageMeasure | null;
  /** The URL of a portrait card (a blob URL kept for the session); null when it cannot be had. */
  portrait(ref: string): Promise<string | null>;
  hide(): void;
  /** Current state for the QA bridge and tests. */
  readonly state: {
    shown: boolean; yaw: number; zoom: 'full' | 'head'; autoRotate: boolean; params: StageParams | null;
    /**
     * `models` while an assembled figure is on stage; `mannequin` for the variant figure (also while the first models load). While
     * `pending`, this is the figure of an earlier `show`: a figure stays on stage until the next one is assembled.
     */
    figure: 'models' | 'mannequin';
    /** The parts of the current avatar (the latest `show`) and how each draws. */
    parts: readonly StagePart[];
    /**
     * True from a `show` until the stage draws what that show asked for: the figure assembled from exactly `parts`, or the mannequin
     * (the body or the face on the mannequin path, or a part that failed to load). `figure`, `triangles` and `textures` describe
     * `parts` only once this is false (BD-FIX-CREATOR-SHOES-01).
     */
    pending: boolean;
    /** Triangles and textures of the assembled figure (0 on the mannequin). */
    triangles: number;
    textures: number;
    /** How the picture is framed on the canvas (set at `show`, `setZoom`, `setFreeArea` and when the canvas changes size); null without a canvas. */
    frame: StageFrame | null;
  };
}

const TOP_BONES = new Set(['spine', 'chest', 'upperChest', 'l_shoulder', 'r_shoulder', 'l_upperArm', 'r_upperArm']);
const BOTTOM_BONES = new Set(['hips', 'l_upperLeg', 'r_upperLeg', 'l_lowerLeg', 'r_lowerLeg']);
const SHOE_BONES = new Set(['l_foot', 'r_foot', 'l_toes', 'r_toes']);
/** Turntable speed, radians per second. */
const SPIN = 0.5;
const FOV_DEG = 32;
/** The zoom presets: where the camera stands and where it looks. The turntable axis is the y axis. */
const PRESETS = {
  full: { eye: [0, 1.05, -3.9], at: [0, 0.92, 0] },
  head: { eye: [0, 1.6, -1.15], at: [0, 1.58, 0] },
} as const;
/**
 * How far the turning figure reaches from the turntable axis, by how far down a picture shows it: the radius of the cylinder the
 * figure stays inside (metres, with margin, at the widest build of 1.18 and the tallest figure). Measured over every part model:
 * above 0.64 m (0.74 m on the tallest figure) the widest body with the widest top reaches 0.253 m, 0.299 m at the widest build; the
 * hem of the skirt, from there down, 0.272 m and 0.321 m; the toes of the widest shoes, under 0.06 m, 0.300 m and 0.354 m.
 * A picture is framed with the first row of `UPPER_REACH` it does not show below, or else with the whole figure's radius
 * (BD-FIX-CREATOR-FRAME-06): the full body always with the whole figure's; the head preset with the first row on a desktop or a
 * phone, and with a later one where a narrow, tall free area makes its picture so small that the canvas shows the figure to the knees
 * or to the feet.
 */
const UPPER_REACH = [
  { downTo: 0.9, radius: 0.32 },
  { downTo: 0.2, radius: 0.34 },
] as const;
const WHOLE_REACH = 0.4;
/** The floor disc under the figure, metres. */
const FLOOR_RADIUS = 0.9;

/** The frame of a preset's picture on the canvas (`creatorFrame`), as wide as the part of the figure it shows reaches. */
function frameOf(preset: (typeof PRESETS)[keyof typeof PRESETS], canvas: FrameSize, free: FrameRect | null): CreatorFrame {
  // The camera's distance from the turntable axis; its eye and its look-at point are within 13 cm of one height.
  const distance = -preset.eye[2];
  for (const reach of UPPER_REACH) {
    const f = creatorFrame(canvas, free, cylinderHalfWidth(reach.radius, distance, FOV_DEG));
    if (shownDownTo(f, canvas.height, preset.at[1], distance, FOV_DEG) >= reach.downTo) return f;
  }
  return creatorFrame(canvas, free, cylinderHalfWidth(WHOLE_REACH, distance, FOV_DEG));
}

export function createCreatorStage(host: StageHost, assets?: StageAssets): CreatorStage {
  const scene = new Scene();
  scene.background = new Color(0x131a26);
  const camera = new PerspectiveCamera(FOV_DEG, 1, 0.1, 40);
  scene.add(new AmbientLight(0xffffff, 1.1));
  const key = new DirectionalLight(0xfff1dd, 2.6);
  key.position.set(2, 3, -3);
  scene.add(key);
  const rim = new DirectionalLight(0x7aa7ff, 1.2);
  rim.position.set(-3, 2, 3);
  scene.add(rim);

  const floorMat = new MeshStandardNodeMaterial({ color: 0x1d2736, roughness: 0.9 });
  const floor = new Mesh(new CylinderGeometry(FLOOR_RADIUS, FLOOR_RADIUS, 0.04, 40), floorMat);
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

  const state: CreatorStage['state'] = {
    shown: false, yaw: 0.35, zoom: 'full', autoRotate: true, params: null, figure: 'mannequin', parts: [], pending: false, triangles: 0, textures: 0,
    frame: null,
  };
  /** The free area the page reported (viewport CSS pixels) and the canvas size the current frame was made for. */
  let area: FrameRect | null = null;
  const framed = { width: 0, height: 0 };
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
    // A canvas that changed size is framed again at once; the page reports the new free area when its own layout has settled.
    const c = host.currentCanvas;
    if (c && (c.clientWidth !== framed.width || c.clientHeight !== framed.height)) place();
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

  /**
   * Draws the avatar from its part models when the app can load them and the body and face are models; otherwise the mannequin stays.
   * Every call takes a new ticket, the mannequin path included, so a load started for an earlier avatar never draws over a later one.
   */
  const syncFigure = async (p: StageParams): Promise<void> => {
    const ticket = ++want;
    const parts = p.parts ?? [];
    const slotPath = (slot: AssemblySlot): StagePart | undefined => parts.find((x) => x.slot === slot);
    const body = slotPath('body');
    const face = slotPath('face');
    if (!assets || !body || !face || body.path === 'mannequin' || face.path === 'mannequin') {
      dropFigure();
      state.pending = false;
      return;
    }
    state.pending = true;
    const draw = parts.filter((x) => x.ref !== '' && x.path !== 'mannequin');
    let meshes: PersonMesh[];
    try {
      meshes = await Promise.all(draw.map((x) => models.mesh(x.ref)));
    } catch {
      if (ticket === want) {
        dropFigure();
        state.pending = false;
      }
      return;
    }
    if (ticket !== want || !state.shown) return;
    const key = draw.map((x) => `${x.slot}:${x.ref}`).join('|');
    const colors = { skin: p.skin, hair: p.hair, top: p.top, bottom: p.bottom, shoes: p.shoes, accessory: p.accessoryColor ?? p.hair };
    try {
      if (!figure || key !== figureKey) {
        const textures = await models.textures();
        if (ticket !== want || !state.shown) return;
        if (figure) {
          pivot.remove(figure.root);
          figure.dispose();
          figure = null;
          figureKey = '';
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
      }
      if (p.morphs) figure.setMorphs(p.morphs);
      figure.root.scale.set(p.buildScale, (p.heightScale * figure.heightM) / 1.8, p.buildScale);
    } catch (e) {
      // BD-FIX-CREATOR-SHOES-02: a page that cannot be read or a figure that cannot be assembled falls back to the mannequin and ends
      // `pending`, instead of leaving the stage waiting on a promise nobody handles.
      if (ticket === want) {
        console.warn('creator stage: the avatar could not be assembled; showing the mannequin', e);
        dropFigure();
      }
    }
    if (ticket === want) state.pending = false;
  };

  /**
   * Places the camera for the zoom preset and frames the picture on the canvas: the aspect ratio of the canvas (the host sets it only
   * at its own resize, so a stage shown on a canvas that is not square drew a stretched figure until then), and the view offset that
   * centres the figure in the free area (`creatorFrame`).
   */
  function place(): void {
    const preset = PRESETS[state.zoom];
    camera.position.set(preset.eye[0], preset.eye[1], preset.eye[2]);
    camera.lookAt(preset.at[0], preset.at[1], preset.at[2]);
    const c = host.currentCanvas;
    const width = c?.clientWidth ?? 0;
    const height = c?.clientHeight ?? 0;
    framed.width = width;
    framed.height = height;
    if (!c || !(width > 0) || !(height > 0)) {
      state.frame = null;
      if (camera.view?.enabled) camera.clearViewOffset();
      return;
    }
    camera.aspect = width / height;
    let free: FrameRect | null = null;
    if (area) {
      const at = c.getBoundingClientRect();
      free = { x: area.x - at.left, y: area.y - at.top, width: area.width, height: area.height };
    }
    const f = frameOf(preset, { width, height }, free);
    // Both calls update the projection matrix.
    if (f.offset) camera.setViewOffset(f.offset.fullWidth, f.offset.fullHeight, f.offset.x, f.offset.y, f.offset.width, f.offset.height);
    else camera.clearViewOffset();
    state.frame = { canvas: { width, height }, ...f };
  }

  const probe = new Vector3();
  const measure = (): StageMeasure | null => {
    if (!state.shown || !state.frame) return null;
    const { width, height } = state.frame.canvas;
    pivot.rotation.y = state.yaw;
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    const box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    // A part that crosses the canvas's top or bottom edge counts with the vertices just outside it.
    const over = height * 0.03;
    (figure ? figure.root : rig.root).traverseVisible((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      (mesh as SkinnedMesh).skeleton?.update();
      const count = mesh.geometry.getAttribute('position')?.count ?? 0;
      for (let i = 0; i < count; i++) {
        mesh.getVertexPosition(i, probe).applyMatrix4(mesh.matrixWorld).project(camera);
        if (probe.z < -1 || probe.z > 1) continue;
        const x = ((probe.x + 1) / 2) * width;
        const y = ((1 - probe.y) / 2) * height;
        if (y < -over || y > height + over) continue;
        if (x < box.left) box.left = x;
        if (x > box.right) box.right = x;
        if (y < box.top) box.top = y;
        if (y > box.bottom) box.bottom = y;
      }
    });
    probe.set(0, 0, 0).project(camera);
    const centre = { x: ((probe.x + 1) / 2) * width, y: ((1 - probe.y) / 2) * height };
    // the camera stands on the -z side of the axis, above the floor: the disc's far edge is its highest point in the picture
    probe.set(0, 0, FLOOR_RADIUS).project(camera);
    return {
      canvas: { width, height },
      figure: box.left <= box.right ? box : null,
      floor: centre,
      floorTop: ((1 - probe.y) / 2) * height,
    };
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
    setFreeArea(next) {
      const same = next === null || area === null ? next === area : next.x === area.x && next.y === area.y && next.width === area.width && next.height === area.height;
      if (same) return;
      area = next ? { x: next.x, y: next.y, width: next.width, height: next.height } : null;
      if (state.shown) place();
    },
    measure,
    portrait(ref) {
      return models.portrait(ref);
    },
    hide() {
      if (!state.shown) return;
      state.shown = false;
      want++;
      state.pending = false;
      area = null;
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
        // a failed read is asked again next time, like a part model (BD-FIX-CREATOR-SHOES-02)
        const mine = pages;
        mine.catch(() => {
          if (pages === mine) pages = null;
        });
      }
      return pages;
    },
  };
}
