/**
 * The instanced pedestrians (02-world-living.md section 4.5; M03b2). Ambient pedestrians are snapshot records flagged ambient
 * (`flags & 2`) whose render key is one of the eight `character/ped.ambient.{a..h}` bodies; the object pool skips them and this
 * renderer draws them:
 *
 *  - far level: ONE `InstancedMesh` per body of a rigid low-poly figure (72 triangles) whose legs and arms swing in the vertex
 *    shader (TSL) with a phase per instance; the clothing colour (one of 20 outfits) is an instance attribute;
 *  - near level (within 25 m): the nearest pedestrians, up to the tier's skinned cap (24 desktop, 16 Vision Pro, 12 mobile, 8 Quest,
 *    6 mobile-low), are drawn as one skinned figure each on `bay_rig_v1` driven by the engine anim states, and leave the far level;
 *  - M10d4: with an asset port (`art`) the figures are the pedestrian kit (`kit.ts`): a near ped is the body of its sim key merged with
 *    its outfit into one `SkinnedMesh`, a far body draws the kit's far figure. Until the kit has loaded, and for good when it fails, the
 *    mannequin of `mannequin.ts` draws (the fallback); the sim, the caps and `CrowdLimits` are the same either way. With `ahead` (the
 *    app's) a near ped whose kit figure is not built yet draws at the far level until a frame may build it (BD-REPAIR-M10d4-04);
 *  - the total drawn never exceeds the C13 `CrowdLimits.maxPedInstances` of the tier. Excess near pedestrians draw as far figures.
 *
 * Slots are stable per entity handle; a freed slot is a zero-scale matrix and the mesh `count` is the highest slot in use.
 */
import {
  BoxGeometry, BufferAttribute, BufferGeometry, Group, InstancedBufferAttribute, InstancedMesh, MeshStandardNodeMaterial, type Object3D,
} from 'three/webgpu';
import type { WorldFrame } from '@dv/engine/client/boot/world-layer';
import { MannequinAnimator } from '@dv/engine/client/anim';
import { PED_ASSETS, PED_BODIES, PED_PALETTE } from '../../sim/peds/components.ts';
import { NEAR_PED_M } from '../../sim/peds/density.ts';
import { asNode, attribute, cos, float, sin, vec3, vertexColor, positionLocal, type L } from '../sky/tsl.ts';
import { buildNearFigure, type NearFigure } from './mannequin.ts';
import { loadPedKit, PED_ART, type PedArtInfo, type PedKit, type PedKitAssets } from './kit.ts';
import { ART_QUIET_FRAMES, ArtGate, type WorldLoad } from './art-gate.ts';

type Pose = NonNullable<WorldFrame['poses']>[number];

export interface PedInfo {
  /** Instances drawn at the far level, near skinned figures, and their sum. */
  far: number;
  near: number;
  instances: number;
  /** Far instances per body. */
  perBody: number[];
  /** Draw calls the pedestrians cost: far meshes in use plus near figures. */
  draws: number;
  /** Render objects the renderer adds to the scene (visible meshes). */
  objects: number;
  cap: number;
  nearCap: number;
  dropped: number;
}

export interface PedRendererOptions {
  parent: Pick<Object3D, 'add' | 'remove'>;
  /** C13 `CrowdLimits.maxPedInstances` of the tier. */
  cap: number;
  /** Skinned near-LOD cap of the tier. */
  nearCap: number;
  /**
   * M02h2: the render lift of a foot at world (x, z) (the curb height on a curbed sidewalk, chunks/sidewalks.ts); the figures draw that much
   * higher. Absent: 0. Render only: the sim keeps its heights.
   */
  lift?: (x: number, z: number) => number;
  /** M10d4: the asset port of the pedestrian kit; absent (the QA switch `?art=0`, or no asset client): the mannequin draws. */
  art?: PedKitAssets;
  /**
   * The kit load waits for `startArt()` (BD-REPAIR-M10d4-02): the world view starts it after the reveal and its boot figures, as it starts
   * the surface textures, so the kit's 37 files are not on the boot's critical path. Default false: the load starts at construction.
   */
  artWaits?: boolean;
  /**
   * BD-REPAIR-M10d4-03: what the world is doing, read once a frame in `update` while the kit loads (`art-gate.ts`). The kit's requests, its
   * parses, its build and the swap from the mannequin go only after `ART_QUIET_FRAMES` quiet frames in a row (no cutscene holding the
   * world, no streaming unit requested or retrying and no new request, no mesh job, every landmark and the surface textures settled), and
   * a request in flight stops at its next file on the first frame that is not quiet. Absent: every step goes at once (dispose still stops
   * a request in flight).
   */
  worldLoad?: () => WorldLoad;
  /**
   * BD-REPAIR-M10d4-04: pace the kit's figures. Before the swap, in the quiet window the kit is built in, the far geometries and the kit
   * figures of up to `AHEAD_PER_FRAME` near pedestrians the mannequin draws (at least one, for the atlas page) are built, then drawn once,
   * collapsed to a point, on the next frame with the UI down, so that frame's own passes upload their buffers and the atlas page; the swap
   * follows on the frame after and moves them in. After it, a near pedestrian whose kind has no free figure takes a new one only on a frame with the UI
   * down (`ui`), at most `AHEAD_PER_FRAME` a frame, and draws at the far level until then. The kit's near figures draw with the
   * mannequin's render program or pipeline (`mannequin.ts`), so nothing is linked. Absent (unit tests): the swap builds every figure on
   * its first frame, and later ones are built on the frame they are needed, as the mannequin's are.
   */
  ahead?: boolean;
  /**
   * BD-REPAIR-M10d4-04 (round 2): true while the shell shows something over the world that the player reads or works (the gates, the
   * menus, the loading screen, the pause page and the phone with its apps, a dialogue panel). The kit takes no step of its load then
   * (`ArtGate`), and with `ahead` builds no figure. Absent: never.
   */
  ui?: () => boolean;
}

export { ART_QUIET_FRAMES };

/**
 * BD-REPAIR-M10d4-04: with `ahead`, the kit figures built ahead of the swap (drawn once together on the next frame), and the most built
 * on any one frame after it. Four keep a frame's builds to tens of milliseconds (a batch of four took 61 and 83 ms on a loaded
 * webkit-webgl2) and add no quiet window before the swap, whatever the crowd: at `desktop` on a loaded software-GL runner the gate opens
 * every 5 to 17 s, and a preparation of the whole near crowd, four a quiet frame, held the swap back.
 */
export const AHEAD_PER_FRAME = 4;

/** `world.peds().art` (QA): the kit's report and where its load stands. */
export interface PedArtReport extends PedArtInfo {
  /** `off`: no asset port; `loading`; `ready`: the kit draws; `failed`: the kit did not load and the mannequin draws. */
  state: 'off' | 'loading' | 'ready' | 'failed';
  /** The asset refs the figures are drawn from (the kit's bodies, outfits, far figures and atlas; `mannequin` while it draws). */
  refs: string[];
}

const COLORS = PED_PALETTE.map((hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255] as const);
const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
/** A walking cycle of the far figure, radians per metre walked. */
const GAIT_PER_M = 4.2;
const SWING = 0.55;
const SKIN_TONES: readonly (readonly [number, number, number])[] = [
  [1, 0.8, 0.66], [0.78, 0.55, 0.4], [0.55, 0.38, 0.27], [0.93, 0.72, 0.58], [0.4, 0.27, 0.2], [0.86, 0.66, 0.5], [0.68, 0.47, 0.34], [0.97, 0.78, 0.64],
];

const HIP_Y = 0.9;
const SHOULDER_Y = 1.45;

/** The far figure: torso, head, two legs, two arms as boxes; `aSwing` is the swing direction of a part, `aPivot` its pivot height. */
export function figureGeometry(): BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const swing: number[] = [];
  const pivot: number[] = [];
  const idx: number[] = [];
  let base = 0;
  const box = (w: number, h: number, l: number, x: number, y: number, z: number, c: [number, number, number], sw: number, pv: number): void => {
    const g = new BoxGeometry(w, h, l);
    const gp = g.getAttribute('position');
    const gn = g.getAttribute('normal');
    for (let i = 0; i < gp.count; i++) {
      pos.push(gp.getX(i) + x, gp.getY(i) + y, gp.getZ(i) + z);
      nor.push(gn.getX(i), gn.getY(i), gn.getZ(i));
      col.push(c[0], c[1], c[2]);
      swing.push(sw);
      pivot.push(pv);
    }
    const gi = g.getIndex();
    if (gi) for (let i = 0; i < gi.count; i++) idx.push(gi.getX(i) + base);
    base += gp.count;
    g.dispose();
  };
  // clothing is white (it takes the tint); skin parts are marked by the blue channel being 0 and take the body's skin tone
  const W: [number, number, number] = [1, 1, 1];
  const S: [number, number, number] = [1, 1, 0];
  box(0.4, 0.62, 0.22, 0, 1.18, 0, W, 0, HIP_Y); // torso
  box(0.22, 0.24, 0.22, 0, 1.62, 0, S, 0, HIP_Y); // head
  box(0.15, 0.9, 0.16, 0.1, 0.45, 0, W, 1, HIP_Y); // left leg
  box(0.15, 0.9, 0.16, -0.1, 0.45, 0, W, -1, HIP_Y); // right leg
  box(0.1, 0.62, 0.12, 0.26, 1.16, 0, S, -1, SHOULDER_Y); // left arm
  box(0.1, 0.62, 0.12, -0.26, 1.16, 0, S, 1, SHOULDER_Y); // right arm
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(Float32Array.from(pos), 3));
  geo.setAttribute('normal', new BufferAttribute(Float32Array.from(nor), 3));
  geo.setAttribute('color', new BufferAttribute(Float32Array.from(col), 3));
  geo.setAttribute('aSwing', new BufferAttribute(Float32Array.from(swing), 1));
  geo.setAttribute('aPivot', new BufferAttribute(Float32Array.from(pivot), 1));
  geo.setIndex(idx);
  return geo;
}

interface BodyMesh {
  mesh: InstancedMesh;
  tint: InstancedBufferAttribute;
  gait: InstancedBufferAttribute;
  slotOf: Map<number, number>;
  free: number[];
  high: number;
  live: number;
  /** Walk phase per slot (radians). */
  phase: Float32Array;
}

interface NearSlot {
  fig: NearFigure;
  /** The kit figure this slot holds (`<body>:<outfit>`), or '' for the mannequin. */
  kind: string;
  /** The sim key of the pedestrian the slot last drew ('' before its first). */
  key: string;
  anim: MannequinAnimator;
  handle: number;
  pending: number;
  outfit: number;
}

export class PedRenderer {
  readonly group = new Group();

  /** The governor's `crowdDensity` (M11a1): at most `cap x scale` pedestrians are drawn; the crowd itself still runs. */
  setDensityScale(scale: number): void {
    this.densityScale = Math.min(1, Math.max(0, Number.isFinite(scale) ? scale : 1));
  }

  private readonly bodies: BodyMesh[] = [];
  private readonly archByKey = new Map<string, number>();
  private readonly near: NearSlot[] = [];
  private readonly nearBy = new Map<number, NearSlot>();
  private readonly seen = new Set<number>();
  private readonly cand: { p: Pose; d: number }[] = [];
  private readonly geo: BufferGeometry;
  private info0: PedInfo;
  private lastT = 0;
  private kit: PedKit | null = null;
  private artState: PedArtReport['state'] = 'off';
  private artStarted = false;
  /** BD-REPAIR-M10d4-03: the gate every step of the kit's load waits for (always open without `worldLoad`; dispose stops it). */
  private readonly gate: ArtGate;
  /**
   * BD-REPAIR-M10d4-04, with `ahead`: the group the swap is prepared in. It holds the kit figures built for the near pedestrians, each
   * hidden but for its one collapsed draw, until the swap takes them.
   */
  private aheadSet: Group | null = null;
  /** The far geometry of each body, built before the swap. */
  private farNext: BufferGeometry[] = [];
  /** Kit figures built before the swap, by kind (`<body>:<outfit>`). */
  private prebuilt: NearSlot[] = [];
  /** The pieces of the swap waiting to be drawn once, collapsed, one entry per open frame; and the pieces drawn on the frame before. */
  private readonly onceQueue: { objs: Object3D[]; done: () => void }[] = [];
  private onceShown: { objs: Object3D[]; done: () => void } | null = null;
  /** The swap waiting for the UI to go (`uiDown`). */
  private readonly uiWaiters: (() => void)[] = [];
  /** With `ahead`, kit figures built on this frame (at most `AHEAD_PER_FRAME`). */
  private builtThisFrame = 0;
  private disposed = false;
  /** The governor's `crowdDensity` (M11a1): the share of `cap` drawn, 0 to 1. */
  private densityScale = 1;

  constructor(private readonly o: PedRendererOptions) {
    this.gate = new ArtGate(o.worldLoad ?? null, o.ui ?? null);
    this.group.name = 'peds';
    this.geo = figureGeometry();
    const n = Math.max(1, o.cap);
    for (let b = 0; b < PED_BODIES; b++) {
      this.archByKey.set(PED_ASSETS[b] as string, b);
      const tint = new InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);
      const gait = new InstancedBufferAttribute(new Float32Array(n * 2), 2);
      const g = this.geo.clone();
      g.setAttribute('aTint', tint);
      g.setAttribute('aGait', gait);
      const skin = SKIN_TONES[b] as readonly [number, number, number];
      const m = new MeshStandardNodeMaterial({ roughness: 0.75, metalness: 0.02 });
      const vc = vertexColor(0) as L;
      const isSkin = float(1).sub(vc.b);
      const tintA = attribute('aTint', 'vec3') as L;
      // M10d4: the red channel shades the tint (1 on the mannequin's figure and on garments, dark on the kit's hair)
      m.colorNode = asNode(tintA.mul(vc.r).mul(float(1).sub(isSkin)).add(vec3(skin[0], skin[1], skin[2]).mul(isSkin)));
      const swingA = (attribute('aSwing', 'float') as L).mul((attribute('aGait', 'vec2') as L).y).mul(sin((attribute('aGait', 'vec2') as L).x));
      const pivotA = attribute('aPivot', 'float') as L;
      const p = positionLocal;
      const dy = p.y.sub(pivotA);
      const y2 = pivotA.add(dy.mul(cos(swingA))).sub(p.z.mul(sin(swingA)));
      const z2 = dy.mul(sin(swingA)).add(p.z.mul(cos(swingA)));
      m.positionNode = asNode(vec3(p.x, y2, z2));
      const mesh = new InstancedMesh(g, m, n);
      mesh.name = `peds.far.${String.fromCharCode(97 + b)}`;
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.visible = false;
      (mesh.instanceMatrix.array as Float32Array).fill(0);
      this.group.add(mesh);
      this.bodies.push({ mesh, tint, gait, slotOf: new Map(), free: [], high: 0, live: 0, phase: new Float32Array(n) });
    }
    this.info0 = this.blank();
    o.parent.add(this.group);
    if (o.art) {
      // `loading` from here: the mannequin draws until the kit is ready, whether or not its load has started yet
      this.artState = 'loading';
      if (o.artWaits !== true) this.startArt();
    }
  }

  /**
   * M10d4: starts the kit load, once; nothing without an asset port or after `dispose`. The files come in four groups, one file at a time;
   * each request, each parse, the build and the swap from the mannequin wait for the gate, and a request in flight stops when the world
   * gets busy (BD-REPAIR-M10d4-03).
   */
  startArt(): void {
    const assets = this.o.art;
    if (!assets || this.artStarted || this.disposed) return;
    this.artStarted = true;
    void loadPedKit(assets, PED_ART, this.gate)
      .then(async (kit) => {
        // the swap (new geometry, the kit's material and its first draw) is main-thread and GPU work: only while the world is quiet too
        if (kit) await this.prepare(kit).catch(() => undefined);
        return kit;
      })
      .then((kit) => this.useKit(kit));
  }

  /**
   * The work of the swap, ahead of it (BD-REPAIR-M10d4-04): in the quiet window the kit was built in (the gate is still open, so the wait
   * returns at once), the far geometries and, with `ahead`, the kit figures of up to `AHEAD_PER_FRAME` pedestrians the mannequin draws now
   * (at most the near cap; at least one figure, for the atlas page); the next frame draws them once, collapsed (`stepDrawOnce`), and the
   * swap follows on the frame after, as soon as the UI is down. So the swap needs the same quiet window as without `ahead` (claude/build
   * swapped right after building the kit) and two frames more, whatever the crowd and however busy the world is then; the other near
   * pedestrians take their figures after it (`drawNear`). Rejects when the gate is disposed (the load ends; `useKit` and `dispose` drop
   * what was built).
   */
  private async prepare(kit: PedKit): Promise<void> {
    await this.gate.wait();
    this.farNext = this.bodies.map((body, b) => {
      const g = kit.far(PED_ASSETS[b] as string).clone();
      g.setAttribute('aTint', body.tint);
      g.setAttribute('aGait', body.gait);
      return g;
    });
    if (this.o.ahead === true) {
      const set = new Group();
      set.name = 'peds.ahead';
      this.aheadSet = set;
      this.group.add(set);
      const cap = Math.min(AHEAD_PER_FRAME, Math.max(1, this.o.nearCap));
      const batch: Object3D[] = [];
      while (this.prebuilt.length < cap) {
        const want = this.wantedKind(kit);
        if (!want) break;
        const tint = PED_PALETTE[((want.outfit % PED_PALETTE.length) + PED_PALETTE.length) % PED_PALETTE.length] as number;
        const fig = kit.near(want.key, want.outfit, tint, this.archByKey.get(want.key) ?? 0);
        fig.root.visible = false;
        set.add(fig.root);
        this.prebuilt.push({ fig, kind: want.kind, key: want.key, anim: new MannequinAnimator(fig), handle: 0, pending: 0, outfit: -1 });
        batch.push(fig.root);
      }
      if (batch.length > 0) await this.drawOnce(batch);
    }
    await this.uiDown();
  }

  /** Resolves at once with the UI down, else on the first frame it is down (or at `dispose`). */
  private uiDown(): Promise<void> {
    if (this.o.ui?.() !== true || this.disposed) return Promise.resolve();
    return new Promise<void>((resolve) => this.uiWaiters.push(resolve));
  }

  /** Resolves once `objs` have been drawn on a frame with the UI down, collapsed to a point (`stepDrawOnce`), or the renderer is disposed. */
  private drawOnce(objs: Object3D[]): Promise<void> {
    return new Promise<void>((done) => this.onceQueue.push({ objs, done }));
  }

  /**
   * Once a frame, before the frame draws: hides the pieces the frame before drew; on a frame with the UI down shows the next queued pieces
   * (one entry a frame) at scale 0, so the frame's own passes draw them (uploading their buffers and textures, in the frame's own pass)
   * and they cover no pixel. Not held for a quiet frame: the upload is the one claude/build made on the frame after its swap, and
   * waiting for the gate again held the swap back by a quiet window at `desktop` (BD-REPAIR-M10d4-04).
   */
  private stepDrawOnce(): void {
    const shown = this.onceShown;
    if (shown) {
      for (const o of shown.objs) {
        o.visible = false;
        o.scale.setScalar(1);
      }
      this.onceShown = null;
      shown.done();
    }
    const next = this.onceQueue[0];
    if (next && this.o.ui?.() !== true) {
      for (const o of next.objs) {
        o.scale.setScalar(0);
        o.visible = true;
      }
      this.onceShown = next;
      this.onceQueue.shift();
    }
  }

  /** The kind of the next kit figure to build ahead of the swap: a near pedestrian the mannequin draws whose kind is not built yet. */
  private wantedKind(kit: PedKit): { key: string; outfit: number; kind: string } | null {
    const have = new Map<string, number>();
    for (const p of this.prebuilt) have.set(p.kind, (have.get(p.kind) ?? 0) + 1);
    const need = new Map<string, number>();
    for (const s of this.near) {
      if (s.handle === 0 || s.key === '') continue;
      const kind = `${s.key}:${s.outfit % PED_PALETTE.length}`;
      need.set(kind, (need.get(kind) ?? 0) + 1);
      if ((need.get(kind) as number) > (have.get(kind) ?? 0)) return { key: s.key, outfit: s.outfit, kind };
    }
    if (this.prebuilt.length > 0) return null;
    // nobody near: one figure of the first body and outfit, so the atlas page is uploaded ahead all the same
    const key = kit.keys[0] as string;
    return { key, outfit: 0, kind: `${key}:0` };
  }

  /** M10d4: the kit has loaded (or failed, `null`): the far bodies take its figures, the near slots are rebuilt on their next frame. */
  private useKit(kit: PedKit | null): void {
    if (this.disposed) {
      this.dropPrepared();
      kit?.dispose();
      return;
    }
    if (!kit) {
      this.artState = 'failed';
      return;
    }
    this.kit = kit;
    this.artState = 'ready';
    this.bodies.forEach((body, b) => {
      let g = this.farNext[b];
      if (!g) {
        g = kit.far(PED_ASSETS[b] as string).clone();
        g.setAttribute('aTint', body.tint);
        g.setAttribute('aGait', body.gait);
      }
      const old = body.mesh.geometry;
      body.mesh.geometry = g;
      old.dispose();
    });
    this.farNext = [];
    // the mannequins in use go; the kit figures built ahead become free slots of their kinds, and every near pedestrian takes a kit
    // figure on its next frame (one built ahead when its kind is there, built then otherwise)
    for (const s of this.near) {
      this.group.remove(s.fig.root);
      s.anim.dispose();
      s.fig.dispose();
    }
    this.near.length = 0;
    this.nearBy.clear();
    for (const p of this.prebuilt.splice(0)) {
      p.fig.root.visible = false;
      this.group.add(p.fig.root);
      this.near.push(p);
    }
    if (this.aheadSet) {
      this.group.remove(this.aheadSet);
      this.aheadSet = null;
    }
  }

  /** Disposes what `prepare` built when the load ends before the swap (the far geometries already swapped in are the meshes' own). */
  private dropPrepared(): void {
    for (const p of this.prebuilt.splice(0)) {
      p.anim.dispose();
      p.fig.dispose();
    }
    for (const g of this.farNext.splice(0)) g.dispose();
    if (this.aheadSet) {
      this.group.remove(this.aheadSet);
      this.aheadSet = null;
    }
  }

  /** `world.peds().art` (QA). */
  art(): PedArtReport {
    if (this.kit) {
      const refs = [...new Set([...Object.values(PED_ART.bodies).flatMap((b) => [b.body, b.far]), ...PED_ART.outfits, PED_ART.atlas])];
      return { ...this.kit.info(), state: this.artState, refs };
    }
    return { bodies: 0, near: 'mannequin', far: 'mannequin', clips: 'placeholder', textureBytes: 0, state: this.artState, refs: ['mannequin'] };
  }

  private blank(): PedInfo {
    return { far: 0, near: 0, instances: 0, perBody: this.bodies.map(() => 0), draws: 0, objects: 0, cap: this.o.cap, nearCap: this.o.nearCap, dropped: 0 };
  }

  info(): PedInfo {
    return this.info0;
  }

  /** M02h2 QA: the drawn feet of up to `max` pedestrians (the far instances' translations and the near figures' roots). */
  drawnFeet(max = 64): { x: number; y: number; z: number }[] {
    const out: { x: number; y: number; z: number }[] = [];
    for (const s of this.near) {
      if (out.length >= max) return out;
      if (s.handle !== 0) out.push({ x: s.fig.root.position.x, y: s.fig.root.position.y, z: s.fig.root.position.z });
    }
    for (const body of this.bodies) {
      const m = body.mesh.instanceMatrix.array as Float32Array;
      for (const slot of body.slotOf.values()) {
        if (out.length >= max) return out;
        out.push({ x: m[slot * 16 + 12] as number, y: m[slot * 16 + 13] as number, z: m[slot * 16 + 14] as number });
      }
    }
    return out;
  }

  /** M02h2: the render lift at a foot (0 without a lift source). */
  private liftAt(x: number, z: number): number {
    return this.o.lift ? this.o.lift(x, z) : 0;
  }

  /** Draws the ambient pedestrian poses of a frame; returns the instances drawn (far and near). */
  update(f: Pick<WorldFrame, 'poses' | 'poseCount' | 'poseKeys' | 'camera'>, timeSec: number): number {
    const dt = this.lastT > 0 ? Math.min(0.1, Math.max(0, timeSec - this.lastT)) : 0;
    this.lastT = timeSec;
    // the kit's gate reads the world once a frame while the kit loads (BD-REPAIR-M10d4-03)
    if (this.artStarted && this.artState === 'loading') this.gate.frame();
    this.stepDrawOnce();
    if (this.uiWaiters.length > 0 && this.o.ui?.() !== true) for (const w of this.uiWaiters.splice(0)) w();
    this.builtThisFrame = 0;
    const poses = f.poses;
    const keys = f.poseKeys;
    const count = f.poseCount ?? 0;
    const info = this.blank();
    if (!poses || !keys) {
      this.finish(info);
      return 0;
    }
    this.seen.clear();
    this.cand.length = 0;
    const cx = f.camera.pos[0], cz = f.camera.pos[2];
    let drawn = 0;
    for (let i = 0; i < count; i++) {
      const p = poses[i] as Pose;
      if ((p.flags & 2) === 0) continue;
      const key = keys.get(p.renderKey);
      if (key === undefined || !this.archByKey.has(key)) continue;
      if (drawn >= Math.floor(this.o.cap * this.densityScale)) {
        info.dropped++;
        continue;
      }
      drawn++;
      const dx = p.px - cx, dz = p.pz - cz;
      this.cand.push({ p, d: dx * dx + dz * dz });
    }
    // the nearest pedestrians within the near radius take the skinned figures
    const r2 = NEAR_PED_M * NEAR_PED_M;
    const nearSet = new Set<number>();
    if (this.o.nearCap > 0) {
      const within = this.cand.filter((c) => c.d <= r2).sort((a, b) => (a.d !== b.d ? a.d - b.d : a.p.handle - b.p.handle));
      for (let i = 0; i < within.length && nearSet.size < this.o.nearCap; i++) nearSet.add((within[i] as { p: Pose }).p.handle);
    }
    for (const c of this.cand) {
      const p = c.p;
      this.seen.add(p.handle);
      // a near ped with no figure this frame may build draws at the far level (BD-REPAIR-M10d4-04): it leaves the near set
      if (nearSet.has(p.handle) && !this.drawNear(p, keys.get(p.renderKey) as string, dt, info)) nearSet.delete(p.handle);
      if (!nearSet.has(p.handle)) this.drawFar(p, keys.get(p.renderKey) as string, dt, info);
    }
    this.sweep(nearSet);
    this.finish(info);
    return info.instances;
  }

  private drawFar(p: Pose, key: string, dt: number, info: PedInfo): void {
    const b = this.archByKey.get(key) as number;
    const body = this.bodies[b] as BodyMesh;
    let slot = body.slotOf.get(p.handle);
    const fresh = slot === undefined;
    if (slot === undefined) {
      slot = body.free.pop() ?? body.high++;
      if (slot >= body.mesh.instanceMatrix.count) {
        info.dropped++;
        body.free.push(slot);
        return;
      }
      body.slotOf.set(p.handle, slot);
      body.live++;
    }
    const t = body.tint.array as Float32Array;
    if (fresh) {
      const c = COLORS[Math.round(p.animP1) % COLORS.length] ?? COLORS[0];
      if (c) {
        t[slot * 3] = toLinear(c[0]);
        t[slot * 3 + 1] = toLinear(c[1]);
        t[slot * 3 + 2] = toLinear(c[2]);
      }
      body.phase[slot] = ((p.handle * 2654435761) >>> 0) / 4294967296 * 6.2832;
    }
    // the stride follows the speed: phase per metre walked
    const sp = p.animState === 2 ? Math.max(p.animP0, 2.4) : p.animP0;
    body.phase[slot] = (body.phase[slot] as number) + sp * dt * GAIT_PER_M;
    const g = body.gait.array as Float32Array;
    g[slot * 2] = body.phase[slot] as number;
    g[slot * 2 + 1] = sp > 0.1 ? SWING * Math.min(1.6, sp / 1.4) : 0;
    this.writeMatrix(body.mesh, slot, p, 1);
    info.far++;
    info.instances++;
    (info.perBody as number[])[b] = (info.perBody[b] as number) + 1;
  }

  private writeMatrix(mesh: InstancedMesh, slot: number, p: Pose, scale: number): void {
    const m = mesh.instanceMatrix.array as Float32Array;
    const o = slot * 16;
    const { qx, qy, qz, qw } = p;
    const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
    const xx = qx * x2, xy = qx * y2, xz = qx * z2, yy = qy * y2, yz = qy * z2, zz = qz * z2;
    const wx = qw * x2, wy = qw * y2, wz = qw * z2;
    m[o] = (1 - (yy + zz)) * scale;
    m[o + 1] = (xy + wz) * scale;
    m[o + 2] = (xz - wy) * scale;
    m[o + 3] = 0;
    m[o + 4] = (xy - wz) * scale;
    m[o + 5] = (1 - (xx + zz)) * scale;
    m[o + 6] = (yz + wx) * scale;
    m[o + 7] = 0;
    m[o + 8] = (xz + wy) * scale;
    m[o + 9] = (yz - wx) * scale;
    m[o + 10] = (1 - (xx + yy)) * scale;
    m[o + 11] = 0;
    m[o + 12] = p.px;
    m[o + 13] = p.py + this.liftAt(p.px, p.pz);
    m[o + 14] = p.pz;
    m[o + 15] = 1;
  }

  /**
   * Whether this frame may build a new near figure: the mannequin's always (as before); with `ahead`, a kit figure only with the UI down
   * and fewer than `AHEAD_PER_FRAME` built on this frame (BD-REPAIR-M10d4-04).
   */
  private mayBuild(): boolean {
    if (!this.kit || this.o.ahead !== true) return true;
    return this.builtThisFrame < AHEAD_PER_FRAME && this.o.ui?.() !== true;
  }

  /** Draws a near ped on its figure; false (nothing drawn) when it has none and this frame may not build one (`mayBuild`). */
  private drawNear(p: Pose, key: string, dt: number, info: PedInfo): boolean {
    const outfit = Math.round(p.animP1);
    // the kit figure of this body and outfit ('' for the mannequin, which takes any outfit as a tint)
    const kind = this.kit ? `${key}:${outfit % PED_PALETTE.length}` : '';
    let s = this.nearBy.get(p.handle);
    if (s && s.kind !== kind) {
      // the outfit changed under a kit figure: give the slot back and take one of the new kind
      this.nearBy.delete(p.handle);
      s.handle = 0;
      s.fig.root.visible = false;
      s = undefined;
    }
    if (!s) {
      const free = this.near.find((n) => n.handle === 0 && n.kind === kind);
      if (!free && !this.mayBuild()) return false;
      s = free ?? this.makeNear(key, outfit, kind);
      s.key = key;
      s.handle = p.handle;
      s.pending = 0;
      s.outfit = -1;
      this.nearBy.set(p.handle, s);
      s.fig.root.visible = true;
    }
    if (s.outfit !== outfit) {
      s.outfit = outfit;
      s.fig.setTint(PED_PALETTE[s.outfit % PED_PALETTE.length] as number);
    }
    s.fig.root.position.set(p.px, p.py + this.liftAt(p.px, p.pz), p.pz);
    s.fig.root.quaternion.set(p.qx, p.qy, p.qz, p.qw);
    s.pending += dt;
    // states the mannequin graph knows (0 to 3); everything else stands
    const st = p.animState === 1 || p.animState === 2 || p.animState === 3 ? p.animState : 0;
    s.anim.update(dt, st, p.animP0, s.pending);
    s.pending = 0;
    info.near++;
    info.instances++;
    return true;
  }

  private makeNear(key: string, outfit: number, kind: string): NearSlot {
    // never more figures than the near cap: past it, a free figure of another kind is rebuilt as this one
    if (this.near.length >= Math.max(1, this.o.nearCap)) {
      const at = this.near.findIndex((n) => n.handle === 0);
      if (at >= 0) {
        const old = this.near[at] as NearSlot;
        this.group.remove(old.fig.root);
        old.anim.dispose();
        old.fig.dispose();
        this.near.splice(at, 1);
      }
    }
    const b = this.archByKey.get(key) ?? 0;
    if (this.kit && kind !== '') this.builtThisFrame++;
    const fig = this.kit && kind !== ''
      ? this.kit.near(key, outfit, PED_PALETTE[((outfit % PED_PALETTE.length) + PED_PALETTE.length) % PED_PALETTE.length] as number, b)
      : buildNearFigure();
    const slot: NearSlot = { fig, kind, key, anim: new MannequinAnimator(fig), handle: 0, pending: 0, outfit: -1 };
    this.group.add(fig.root);
    this.near.push(slot);
    return slot;
  }

  /** Frees the slots of pedestrians that left the snapshot or moved to the other level. */
  private sweep(nearSet: ReadonlySet<number>): void {
    for (const [h, s] of this.nearBy) {
      if (this.seen.has(h) && nearSet.has(h)) continue;
      this.nearBy.delete(h);
      s.handle = 0;
      s.fig.root.visible = false;
    }
    for (const body of this.bodies) {
      let freed = false;
      for (const [h, slot] of body.slotOf) {
        if (this.seen.has(h) && !nearSet.has(h)) continue;
        body.slotOf.delete(h);
        body.free.push(slot);
        body.live--;
        (body.mesh.instanceMatrix.array as Float32Array).fill(0, slot * 16, slot * 16 + 16);
        freed = true;
      }
      if (freed) {
        const used = new Set(body.slotOf.values());
        while (body.high > 0 && !used.has(body.high - 1)) {
          body.high--;
          const at = body.free.indexOf(body.high);
          if (at >= 0) body.free.splice(at, 1);
        }
        body.mesh.instanceMatrix.needsUpdate = true;
      }
    }
  }

  private finish(info: PedInfo): void {
    let meshes = 0;
    for (const body of this.bodies) {
      body.mesh.visible = body.live > 0;
      body.mesh.count = body.high;
      if (body.live > 0) {
        body.mesh.instanceMatrix.needsUpdate = true;
        body.tint.needsUpdate = true;
        body.gait.needsUpdate = true;
        meshes++;
      }
    }
    info.draws = meshes + info.near;
    info.objects = meshes + info.near;
    this.info0 = info;
  }

  dispose(): void {
    this.disposed = true;
    // ends the load: a step waiting for the gate rejects and a request in flight stops at its next file (a built kit is disposed in `useKit`)
    this.gate.dispose();
    for (const x of [...this.onceQueue.splice(0), this.onceShown]) x?.done();
    this.onceShown = null;
    for (const w of this.uiWaiters.splice(0)) w();
    this.dropPrepared();
    this.o.parent.remove(this.group);
    for (const b of this.bodies) {
      b.mesh.geometry.dispose();
      (b.mesh.material as MeshStandardNodeMaterial).dispose();
      b.mesh.dispose();
    }
    for (const n of this.near) {
      n.anim.dispose();
      n.fig.dispose();
    }
    this.geo.dispose();
    this.kit?.dispose();
  }
}
