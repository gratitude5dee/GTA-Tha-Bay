/**
 * The gray-box look of Culture Wars (M08a2): the stage `powell_turntable` built from boxes, a disc and a few merged meshes, the
 * two fighters on the procedural `bay_rig_v1` mannequin, hit sparks, projectiles and the Training box overlay. Everything is code;
 * no asset is loaded. The ids are the C07 refs the final art will take over: `prop/graybox.stage-powell_turntable-{day,night}` and
 * `character/graybox.<slug>` (`origin: authored`, DL-460). The scene is kept small on purpose: the stage is 8 meshes, a fighter is
 * 18, and the effects are 3 more, so a round stays inside the `mobile-low` budget of 60 render objects (FX5).
 */
import {
  BoxGeometry, BufferGeometry, CircleGeometry, Color, CylinderGeometry, Float32BufferAttribute, Group,
  IcosahedronGeometry, InstancedMesh, LineBasicNodeMaterial, LineSegments, Matrix4, Mesh, MeshBasicNodeMaterial, MeshStandardNodeMaterial,
  Quaternion, SphereGeometry, Vector3,
  type Bone, type Material, type Object3D,
} from 'three/webgpu';
import { BONE_REST, buildPlaceholderRig, type HumanoidBone, type PlaceholderRig } from '@dv/engine/client/anim';
import type { OverlayBox } from '../sim/overlay.ts';
import type { Pose } from './clips.ts';

// ---- merged boxes ----------------------------------------------------------------------------------------------------------

export interface BoxSpec { x: number; y: number; z: number; w: number; h: number; d: number; color: number }

const FACES: { n: [number, number, number]; v: [number, number, number][] }[] = [
  { n: [0, 0, 1], v: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
  { n: [0, 0, -1], v: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
  { n: [1, 0, 0], v: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
  { n: [-1, 0, 0], v: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
  { n: [0, 1, 0], v: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
  { n: [0, -1, 0], v: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
];

/** One geometry from many boxes with a colour per box (vertex colours), so a whole set dresses the stage in one draw. */
export function mergeBoxes(boxes: readonly BoxSpec[]): BufferGeometry {
  const pos: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [];
  const c = new Color();
  for (const b of boxes) {
    c.setHex(b.color);
    for (const f of FACES) {
      const base = pos.length / 3;
      for (const v of f.v) {
        pos.push(b.x + (v[0] * b.w) / 2, b.y + (v[1] * b.h) / 2, b.z + (v[2] * b.d) / 2);
        nor.push(f.n[0], f.n[1], f.n[2]);
        col.push(c.r, c.g, c.b);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

// ---- the stage ----------------------------------------------------------------------------------------------------------------

export interface StageScene {
  group: Group;
  /** Moves what moves (the cable car) and switches the windows for day or night. `seconds` is free-running presentation time. */
  update(seconds: number, night: boolean): void;
  dispose(): void;
  /** Meshes in the group. */
  readonly objects: number;
}

const PASTELS = [0xe9c9a5, 0xc9d8e6, 0xe6b7b0, 0xd7e3b5, 0xf2dfa0, 0xb9c6e8, 0xe3c1de];

/** Powell and Market: the cable-car turntable in front, a row of painted facades behind, lamps, a few onlookers and a cable car passing. */
export function buildPowellTurntable(): StageScene {
  const group = new Group();
  group.name = 'stage.powell_turntable';
  const disposables: { dispose(): void }[] = [];
  let objects = 0;
  const add = (geo: BufferGeometry, mat: Material, name: string): Mesh => {
    const m = new Mesh(geo, mat);
    m.name = name;
    group.add(m);
    disposables.push(geo, mat);
    objects++;
    return m;
  };
  const lit = (): MeshStandardNodeMaterial => new MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.02 });

  // the street: a wide slab, kerbs, and the turntable disc with its planks
  const ground: BoxSpec[] = [
    { x: 0, y: -0.2, z: 0, w: 18, h: 0.4, d: 9, color: 0x3b3f48 },
    { x: 0, y: -0.2, z: 5.2, w: 18, h: 0.4, d: 1.4, color: 0x8b8e96 },
    { x: 0, y: 0.06, z: -4.6, w: 18, h: 0.32, d: 1.8, color: 0xa6a8ae },
    { x: -7.6, y: 0.0, z: 0.3, w: 0.18, h: 0.04, d: 7.6, color: 0xd9c25b },
    { x: 7.6, y: 0.0, z: 0.3, w: 0.18, h: 0.04, d: 7.6, color: 0xd9c25b },
  ];
  add(mergeBoxes(ground), lit(), 'stage.ground');
  const disc = new CylinderGeometry(2.7, 2.7, 0.08, 40);
  const planks = mergeBoxes([
    { x: 0, y: 0.09, z: 0, w: 5.2, h: 0.02, d: 0.16, color: 0x6b4a2b },
    { x: 0, y: 0.09, z: 0, w: 0.16, h: 0.02, d: 5.2, color: 0x6b4a2b },
    { x: 0, y: 0.095, z: 0, w: 0.5, h: 0.03, d: 0.5, color: 0xb23a3a },
  ]);
  const turntable = new Group();
  const discMesh = new Mesh(disc, new MeshStandardNodeMaterial({ color: 0x9b7447, roughness: 0.8 }));
  discMesh.position.y = 0.04;
  const plankMesh = new Mesh(planks, lit());
  turntable.add(discMesh, plankMesh);
  turntable.name = 'stage.turntable';
  group.add(turntable);
  disposables.push(disc, planks, discMesh.material as Material, plankMesh.material as Material);
  objects += 2;

  // the facades behind the street
  const facades: BoxSpec[] = [];
  let x = -9.4;
  let k = 0;
  while (x < 9.6) {
    const w = 3 + (k % 3) * 0.7;
    const h = 5.2 + ((k * 7) % 5) * 0.9;
    facades.push({ x: x + w / 2, y: h / 2 + 0.2, z: -8, w: w - 0.1, h, d: 2.6, color: PASTELS[k % PASTELS.length] as number });
    facades.push({ x: x + w / 2, y: h + 0.35, z: -8, w: w + 0.1, h: 0.3, d: 2.8, color: 0x6d6a73 });
    x += w;
    k++;
  }
  add(mergeBoxes(facades), lit(), 'stage.facades');
  // windows and lamp heads: one mesh, one colour (dark by day, warm at night)
  const glow: BoxSpec[] = [];
  let fx = -9.4;
  let fk = 0;
  while (fx < 9.6) {
    const w = 3 + (fk % 3) * 0.7;
    const h = 5.2 + ((fk * 7) % 5) * 0.9;
    for (let row = 0; row < Math.floor(h / 1.5); row++) {
      for (let c = 0; c < 2; c++) glow.push({ x: fx + w * (0.3 + 0.4 * c), y: 1.3 + row * 1.5, z: -6.66, w: 0.55, h: 0.8, d: 0.06, color: 0xffffff });
    }
    fx += w;
    fk++;
  }
  for (const lx of [-6.5, -2.2, 2.2, 6.5]) glow.push({ x: lx, y: 3.4, z: -3.9, w: 0.34, h: 0.34, d: 0.34, color: 0xffffff });
  const windowsMat = new MeshBasicNodeMaterial({ vertexColors: false, color: 0x56627a });
  add(mergeBoxes(glow), windowsMat, 'stage.windows');
  const poles: BoxSpec[] = [-6.5, -2.2, 2.2, 6.5].map((lx) => ({ x: lx, y: 1.6, z: -3.9, w: 0.1, h: 3.2, d: 0.1, color: 0x2d3038 }));
  add(mergeBoxes(poles), lit(), 'stage.lamps');

  // onlookers: simple figures behind the turntable
  const crowd: BoxSpec[] = [];
  for (let i = 0; i < 9; i++) {
    const cx = -6.8 + i * 1.7 + ((i * 37) % 5) * 0.08;
    const col = [0x7a5c4a, 0x4a6a7a, 0x8a4a5a, 0x5a7a4a][i % 4] as number;
    crowd.push({ x: cx, y: 0.72, z: -3.0 - (i % 2) * 0.5, w: 0.42, h: 0.9, d: 0.26, color: col });
    crowd.push({ x: cx, y: 1.4, z: -3.0 - (i % 2) * 0.5, w: 0.26, h: 0.28, d: 0.26, color: 0xd8b595 });
  }
  add(mergeBoxes(crowd), lit(), 'stage.crowd');

  // the cable car drifts along the street behind the fighters
  const car = mergeBoxes([
    { x: 0, y: 0.75, z: 0, w: 4.2, h: 1.1, d: 1.2, color: 0xb4352c },
    { x: 0, y: 1.45, z: 0, w: 4.4, h: 0.12, d: 1.4, color: 0xe8dcc0 },
    { x: 0, y: 1.0, z: 0.62, w: 3.6, h: 0.5, d: 0.04, color: 0xe8dcc0 },
    { x: 1.8, y: 1.9, z: 0, w: 0.08, h: 0.9, d: 0.08, color: 0x222222 },
  ]);
  const cableCar = add(car, lit(), 'stage.cablecar');
  cableCar.position.set(-12, 0.0, -2.1);

  // the sun or the moon
  const sky = new SphereGeometry(1, 16, 12);
  const skyMat = new MeshBasicNodeMaterial({ color: 0xfff1b8 });
  const sun = add(sky, skyMat, 'stage.sun');
  sun.scale.setScalar(1.3);
  sun.position.set(-7, 9, -20);

  return {
    group,
    get objects() { return objects; },
    update(seconds, night) {
      cableCar.position.x = ((seconds * 0.9 + 22) % 44) - 22;
      turntable.rotation.y = seconds * 0.04;
      windowsMat.color.setHex(night ? 0xffd37a : 0x56627a);
      skyMat.color.setHex(night ? 0xdfe8ff : 0xfff1b8);
      sun.position.set(night ? 8 : -7, 9, -20);
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}

// ---- fighters ------------------------------------------------------------------------------------------------------------------

const BODY_RIG = 0x4aa3ff;

export interface FighterModel {
  /** Root: feet on its origin; place it at the fighter's (x, y) and turn it by facing. */
  root: Group;
  rig: PlaceholderRig;
  setPose(p: Pose, facing: number): void;
  setFlash(k: number): void;
  setShadow(height: number): void;
  dispose(): void;
}

/** A fighter: the mannequin tinted for a side, a headband, a blob shadow. 18 meshes + the shadow. */
export function buildFighterModel(colors: { body: number; trim: number }): FighterModel {
  const rig = buildPlaceholderRig();
  const root = new Group();
  root.name = 'fighter';
  root.add(rig.root);
  const mats = new Set<MeshStandardNodeMaterial>();
  rig.root.traverse((o: Object3D) => {
    const m = (o as Mesh).material as MeshStandardNodeMaterial | undefined;
    if (m && (m as MeshStandardNodeMaterial).color) mats.add(m);
  });
  const bodyMat = [...mats].find((m) => m.color.getHex() === BODY_RIG) ?? null;
  const base = new Color(colors.body);
  const white = new Color(0xffffff);
  bodyMat?.color.copy(base);
  const head = rig.bones.get('head') as Bone;
  const bandMat = new MeshStandardNodeMaterial({ color: colors.trim, roughness: 0.7 });
  const bandGeo = new BoxGeometry(0.235, 0.035, 0.235);
  const band = new Mesh(bandGeo, bandMat);
  band.position.set(0, 0.13, 0);
  head.add(band);
  const shadowGeo = new CircleGeometry(0.55, 20);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowMat = new MeshBasicNodeMaterial({ color: 0x000000, transparent: true, opacity: 0.38 });
  const shadow = new Mesh(shadowGeo, shadowMat);
  shadow.position.y = 0.012;
  root.add(shadow);

  const bone = (n: HumanoidBone): Bone => rig.bones.get(n) as Bone;
  const set = (n: HumanoidBone, v: readonly [number, number, number], zs = 1, ys = 1): void => {
    bone(n).rotation.set(v[0], v[1] * ys, v[2] * zs);
  };

  return {
    root,
    rig,
    setPose(p, facing) {
      const lead = facing >= 0 ? 'l' : 'r';
      const rear = lead === 'l' ? 'r' : 'l';
      const zs = (side: 'l' | 'r'): number => (side === 'l' ? 1 : -1);
      const ys = facing >= 0 ? 1 : -1;
      const hips = bone('hips');
      hips.position.set(BONE_REST.hips[0] + p.hips[0], BONE_REST.hips[1] + p.hips[1], BONE_REST.hips[2] - p.hips[2]);
      hips.rotation.set(p.pitch, 0, 0);
      set('spine', p.spine, 1, ys);
      set('chest', p.chest, 1, ys);
      set('head', p.head, 1, ys);
      set(`${lead}_upperArm` as HumanoidBone, p.lUp, zs(lead));
      set(`${lead}_lowerArm` as HumanoidBone, p.lLo, zs(lead));
      set(`${rear}_upperArm` as HumanoidBone, p.rUp, zs(rear));
      set(`${rear}_lowerArm` as HumanoidBone, p.rLo, zs(rear));
      set(`${lead}_upperLeg` as HumanoidBone, p.lLeg, zs(lead));
      set(`${lead}_lowerLeg` as HumanoidBone, p.lKnee, zs(lead));
      set(`${rear}_upperLeg` as HumanoidBone, p.rLeg, zs(rear));
      set(`${rear}_lowerLeg` as HumanoidBone, p.rKnee, zs(rear));
      set(`${lead}_foot` as HumanoidBone, p.lFoot, zs(lead));
      set(`${rear}_foot` as HumanoidBone, p.rFoot, zs(rear));
    },
    setFlash(k) {
      bodyMat?.color.lerpColors(base, white, Math.max(0, Math.min(1, k)));
    },
    setShadow(height) {
      const s = Math.max(0.35, 1 - height * 0.35);
      shadow.scale.set(s, 1, s);
      shadowMat.opacity = 0.38 * s;
    },
    dispose() {
      rig.dispose();
      bandGeo.dispose();
      bandMat.dispose();
      shadowGeo.dispose();
      shadowMat.dispose();
    },
  };
}

// ---- effects --------------------------------------------------------------------------------------------------------------------

export const SPARK_MAX = 16;
export const PROJECTILE_MAX = 16;
export const SPARK_FRAMES = 12;

export interface SparkLayer {
  mesh: InstancedMesh;
  /** Starts a spark at stage metres (x, y), strength 0 to 4 (light to super), kind 0 hit, 1 block, 2 check, 3 ko. */
  spawn(x: number, y: number, strength: number, kind: number): void;
  /** Advances by `frames` presentation frames. */
  step(frames: number): void;
  readonly live: number;
  dispose(): void;
}

const SPARK_COLORS = [0xffe14d, 0xff9a3c, 0xff4d3c, 0x4de1ff, 0xff4de1];
const BLOCK_COLOR = 0xbfd4ff;
const CHECK_COLOR = 0x6dff9a;
const KO_COLOR = 0xffffff;

export function buildSparkLayer(): SparkLayer {
  const geo = new IcosahedronGeometry(1, 0);
  const mat = new MeshBasicNodeMaterial({ color: 0xffffff });
  const mesh = new InstancedMesh(geo, mat, SPARK_MAX);
  mesh.name = 'fx.sparks';
  mesh.frustumCulled = false;
  const live: { x: number; y: number; r: number; age: number; color: Color; kind: number }[] = [];
  const m = new Matrix4();
  const q = new Quaternion();
  const v = new Vector3();
  const s = new Vector3();
  const hide = new Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < SPARK_MAX; i++) { mesh.setMatrixAt(i, hide); mesh.setColorAt(i, new Color(0xffffff)); }
  const apply = (): void => {
    for (let i = 0; i < SPARK_MAX; i++) {
      const p = live[i];
      if (!p) { mesh.setMatrixAt(i, hide); continue; }
      const k = p.age / SPARK_FRAMES;
      const size = p.r * (p.kind === 2 ? 0.5 + 1.8 * k : 0.55 + 0.9 * Math.sin(Math.min(1, k * 1.4) * Math.PI)) * (1 - k * 0.5);
      q.setFromAxisAngle(v.set(0, 0, 1), k * 3 + p.x);
      m.compose(v.set(p.x, p.y, 0.5), q, s.set(size, size, size * 0.5));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, p.color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };
  apply();
  return {
    mesh,
    get live() { return live.length; },
    spawn(x, y, strength, kind) {
      if (live.length >= SPARK_MAX) live.shift();
      const color = new Color(kind === 1 ? BLOCK_COLOR : kind === 2 ? CHECK_COLOR : kind === 3 ? KO_COLOR : (SPARK_COLORS[Math.max(0, Math.min(4, strength))] as number));
      live.push({ x, y, r: kind === 3 ? 0.55 : 0.12 + 0.05 * strength, age: 0, color, kind });
      apply();
    },
    step(frames) {
      if (live.length === 0) return;
      for (const p of live) p.age += frames;
      while (live.length > 0 && (live[0] as { age: number }).age >= SPARK_FRAMES) live.shift();
      apply();
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      mesh.dispose();
    },
  };
}

export interface ProjectileLayer {
  mesh: InstancedMesh;
  /** `rows`: [owner, def, x, y, frame, ex, dir] in fight units; `radius(def, owner, ex)` in metres. */
  set(rows: readonly number[][], radius: (owner: number, def: number, ex: number) => number): void;
  readonly live: number;
  dispose(): void;
}

const OWNER_COLORS = [new Color(0x7fd2ff), new Color(0xff6fb0)];

export function buildProjectileLayer(): ProjectileLayer {
  const geo = new SphereGeometry(1, 12, 8);
  const mat = new MeshBasicNodeMaterial({ color: 0xffffff });
  const mesh = new InstancedMesh(geo, mat, PROJECTILE_MAX);
  mesh.name = 'fx.projectiles';
  mesh.frustumCulled = false;
  const m = new Matrix4();
  const hide = new Matrix4().makeScale(0, 0, 0);
  const q = new Quaternion();
  const v = new Vector3();
  const s = new Vector3();
  for (let i = 0; i < PROJECTILE_MAX; i++) { mesh.setMatrixAt(i, hide); mesh.setColorAt(i, OWNER_COLORS[0] as Color); }
  let n = 0;
  return {
    mesh,
    get live() { return n; },
    set(rows, radius) {
      n = Math.min(PROJECTILE_MAX, rows.length);
      for (let i = 0; i < PROJECTILE_MAX; i++) {
        const r = rows[i];
        if (!r) { mesh.setMatrixAt(i, hide); continue; }
        const rad = radius(r[0] as number, r[1] as number, r[5] as number);
        const pulse = 1 + 0.12 * Math.sin((r[4] as number) * 0.5);
        m.compose(v.set((r[2] as number) / 1000, (r[3] as number) / 1000, 0.1), q, s.set(rad * pulse, rad * pulse, rad * pulse * 0.6));
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, OWNER_COLORS[(r[0] as number) === 1 ? 1 : 0] as Color);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      mesh.dispose();
    },
  };
}

// ---- Training box overlay ---------------------------------------------------------------------------------------------------

export const OVERLAY_MAX_SEGMENTS = 520;
const BOX_COLORS: Record<OverlayBox['k'], number> = { hit: 0xff3b3b, hurt: 0x3b8bff, push: 0xffe03b, throw: 0x3bff7a };
const ARC = 8;

export interface OverlayLayer {
  lines: LineSegments;
  set(boxes: readonly OverlayBox[]): void;
  readonly segments: number;
  dispose(): void;
}

export function buildOverlayLayer(): OverlayLayer {
  const geo = new BufferGeometry();
  const pos = new Float32Array(OVERLAY_MAX_SEGMENTS * 2 * 3);
  const col = new Float32Array(OVERLAY_MAX_SEGMENTS * 2 * 3);
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new Float32BufferAttribute(col, 3));
  geo.setDrawRange(0, 0);
  const mat = new LineBasicNodeMaterial({ vertexColors: true, depthTest: false, transparent: true });
  const lines = new LineSegments(geo, mat);
  lines.name = 'overlay.boxes';
  lines.renderOrder = 20;
  lines.frustumCulled = false;
  const c = new Color();
  let segs = 0;
  const seg = (ax: number, ay: number, bx: number, by: number): void => {
    if (segs >= OVERLAY_MAX_SEGMENTS) return;
    const i = segs * 6;
    pos[i] = ax; pos[i + 1] = ay; pos[i + 2] = 0.8; pos[i + 3] = bx; pos[i + 4] = by; pos[i + 5] = 0.8;
    col[i] = c.r; col[i + 1] = c.g; col[i + 2] = c.b; col[i + 3] = c.r; col[i + 4] = c.g; col[i + 5] = c.b;
    segs++;
  };
  return {
    lines,
    get segments() { return segs; },
    set(boxes) {
      segs = 0;
      for (const b of boxes) {
        c.setHex(BOX_COLORS[b.k]);
        const x1 = b.x1 / 1000, y1 = b.y1 / 1000, x2 = b.x2 / 1000, y2 = b.y2 / 1000, r = b.r / 1000;
        if (b.k === 'push' || b.k === 'throw') {
          seg(x1, y1, x2, y1); seg(x2, y1, x2, y2); seg(x2, y2, x1, y2); seg(x1, y2, x1, y1);
          continue;
        }
        // a capsule: two half circles around the end points and the two sides
        const dx = x2 - x1, dy = y2 - y1;
        const len = Math.hypot(dx, dy);
        const ang = len > 1e-6 ? Math.atan2(dy, dx) : 0;
        const nx = -Math.sin(ang) * r, ny = Math.cos(ang) * r;
        seg(x1 + nx, y1 + ny, x2 + nx, y2 + ny);
        seg(x1 - nx, y1 - ny, x2 - nx, y2 - ny);
        for (let i = 0; i < ARC; i++) {
          const a0 = ang + Math.PI / 2 + (i / ARC) * Math.PI, a1 = ang + Math.PI / 2 + ((i + 1) / ARC) * Math.PI;
          seg(x1 + Math.cos(a0) * r, y1 + Math.sin(a0) * r, x1 + Math.cos(a1) * r, y1 + Math.sin(a1) * r);
          const b0 = ang - Math.PI / 2 + (i / ARC) * Math.PI, b1 = ang - Math.PI / 2 + ((i + 1) / ARC) * Math.PI;
          seg(x2 + Math.cos(b0) * r, y2 + Math.sin(b0) * r, x2 + Math.cos(b1) * r, y2 + Math.sin(b1) * r);
        }
      }
      geo.setDrawRange(0, segs * 2);
      (geo.getAttribute('position') as Float32BufferAttribute).needsUpdate = true;
      (geo.getAttribute('color') as Float32BufferAttribute).needsUpdate = true;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

