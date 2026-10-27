/**
 * The presenter of Culture Wars (M08a2; 07-fighter.md section 2 "Presenter"): draws the view model of the sim on the shared canvas
 * through the renderer host's menu-scene slot (C13 1.1: one canvas, never a second WebGL context), so the arena is a stage of its
 * own and the city behind it is not drawn (`world: 'stage'`). It reads `mode.fighter.view` and `mode.fighter.train`; it never
 * writes anything back (C02 rule 7). Fighters pose by `FrameLockedClipPlayer`: while a move plays, the clip time is the move frame
 * of the sim, so the animation cannot drift from the frame data; every other state has a procedural pose.
 */
import { AmbientLight, Color, DirectionalLight, HemisphereLight, PerspectiveCamera, Scene, type Camera, type Object3D } from 'three/webgpu';
import type { CKit, FighterDef, FightTuning } from '@dv/shared/fight';
import { compileKit } from '@dv/shared/fight';
import { FIGHTER_ANIM, animOfState, isMoveDriven } from '../anim-states.ts';
import { fighterPack } from '../sim/data.ts';
import { rosterEntry, ROSTER } from '../sim/data.ts';
import { overlayBoxes } from '../sim/overlay.ts';
import { EVENT_KINDS } from '../sim/match.ts';
import type { FightView, TrainVm } from '../sim/vm.ts';
import { blank, moveClip, sampleClip, statePose, type Clip, type Pose } from './clips.ts';
import {
  buildFighterModel, buildOverlayLayer, buildPowellTurntable, buildProjectileLayer, buildSparkLayer,
  type FighterModel, type OverlayLayer, type ProjectileLayer, type SparkLayer, type StageScene,
} from './graybox.ts';

/** What the presenter needs of the renderer host. */
export interface StageHost {
  setMenuScene(scene: Object3D, camera: Camera): void;
  clearMenuScene(): void;
}

/** Plays a move clip at an explicit frame: no mixer, no clock, so the pose is a pure function of the sim's move frame. */
export class FrameLockedClipPlayer {
  private readonly out: Pose = blank();
  constructor(private readonly model: FighterModel, private readonly clips: ReadonlyMap<number, Clip>) {}

  /** Poses the model for `move` at `frame`; false when the kit has no clip for the move (the caller then poses the state). */
  play(move: number, frame: number, facing: number): boolean {
    const clip = this.clips.get(move);
    if (!clip) return false;
    this.model.setPose(sampleClip(clip, frame, this.out), facing);
    return true;
  }
}

/** The clip library of a kit: one procedural clip per move, keyed on the move index the sim uses (`FF.Move`). */
export function clipLibrary(def: FighterDef): Map<number, Clip> {
  const m = new Map<number, Clip>();
  const all = [...def.moves, ...def.supers, def.shutdown, def.taunt];
  all.forEach((d, i) => m.set(i, moveClip(d)));
  return m;
}

export interface FighterStageState {
  shown: boolean;
  tick: number;
  night: boolean;
  fighters: { x: number; y: number; facing: number; state: number; anim: number; move: number; frame: number }[];
  sparks: number;
  projectiles: number;
  overlaySegments: number;
  camera: { x: number; y: number; z: number; fov: number };
}

export interface FighterStage {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  show(): void;
  hide(): void;
  /** The latest view model of the sim (null clears the arena's fighters). `train` is the Training model for the box overlay. */
  apply(view: FightView | null, train: TrainVm | null): void;
  /** Once per render frame: camera smoothing, sparks, the cable car. */
  frame(dtSec: number): void;
  /** Meshes and lines the scene draws (render objects). */
  objects(): number;
  readonly state: FighterStageState;
  dispose(): void;
}

const DAY = { bg: 0x9fc3e8, sun: 0xfff2d6, sunI: 2.6, hemiSky: 0xcfe6ff, hemiGround: 0x6b6258, hemiI: 1.2 };
const NIGHT = { bg: 0x0d1424, sun: 0x8fa8ff, sunI: 0.9, hemiSky: 0x39466e, hemiGround: 0x1a1a22, hemiI: 1.0 };

export function createFighterStage(host: StageHost | null): FighterStage {
  const scene = new Scene();
  const camera = new PerspectiveCamera(36, 16 / 9, 0.1, 80);
  camera.position.set(0, 1.4, 6.5);
  scene.background = new Color(DAY.bg);
  const hemi = new HemisphereLight(DAY.hemiSky, DAY.hemiGround, DAY.hemiI);
  const sun = new DirectionalLight(DAY.sun, DAY.sunI);
  sun.position.set(-4, 8, 6);
  const fill = new AmbientLight(0xffffff, 0.25);
  scene.add(hemi, sun, fill);

  const stage: StageScene = buildPowellTurntable();
  scene.add(stage.group);
  const sparks: SparkLayer = buildSparkLayer();
  const projectiles: ProjectileLayer = buildProjectileLayer();
  const overlay: OverlayLayer = buildOverlayLayer();
  scene.add(sparks.mesh, projectiles.mesh, overlay.lines);
  overlay.lines.visible = false;

  const pack = fighterPack();
  const kits = pack.kits as unknown as Record<string, FighterDef>;
  const compiled = new Map<string, CKit>();
  const ckit = (slot: string): CKit => {
    let k = compiled.get(slot);
    if (!k) { k = compileKit(kits[slot] as FighterDef, pack.tuning as FightTuning); compiled.set(slot, k); }
    return k;
  };
  const libs = new Map<string, Map<number, Clip>>();
  const lib = (slot: string): Map<number, Clip> => {
    let l = libs.get(slot);
    if (!l) { l = clipLibrary(kits[slot] as FighterDef); libs.set(slot, l); }
    return l;
  };

  interface Side { model: FighterModel; player: FrameLockedClipPlayer | null; slot: string; id: string; lastState: number; stateAge: number; lastTick: number; lastX: number; walk: number }
  const sides: Side[] = [0, 1].map((i) => {
    const r = ROSTER[i] as (typeof ROSTER)[number];
    const model = buildFighterModel(r.colors);
    scene.add(model.root);
    return { model, player: null, slot: '', id: '', lastState: -1, stateAge: 0, lastTick: -1, lastX: 0, walk: 0 };
  });
  for (const s of sides) s.model.root.visible = false;

  let shown = false;
  let night = false;
  let seconds = 0;
  let tick = -1;
  let wantCam = { x: 0, y: 1.35, z: 6.5, fov: 36 };
  let reduced = false;
  let shakeMilli = 0;
  const cur = { x: 0, y: 1.35, z: 6.5 };
  let first = true;

  const setNight = (n: boolean): void => {
    if (n === night && !first) return;
    night = n;
    const t = n ? NIGHT : DAY;
    (scene.background as Color).setHex(t.bg);
    hemi.color.setHex(t.hemiSky); hemi.groundColor.setHex(t.hemiGround); hemi.intensity = t.hemiI;
    sun.color.setHex(t.sun); sun.intensity = t.sunI;
  };
  setNight(false);
  first = false;

  const sparkStrength = (dmg: number, flags: number): number => ((flags & 2) !== 0 ? 3 : dmg < 400 ? 0 : dmg < 700 ? 1 : dmg < 1000 ? 2 : 3);

  const poseSide = (i: 0 | 1, row: readonly number[], view: FightView): void => {
    const side = sides[i] as Side;
    const id = view.id[i];
    if (side.id !== id) {
      side.id = id;
      const e = rosterEntry(id) ?? (ROSTER[i] as (typeof ROSTER)[number]);
      side.slot = e.slot;
      side.player = new FrameLockedClipPlayer(side.model, lib(e.slot));
    }
    const x = row[0] as number, y = row[1] as number, facing = row[2] as number, state = row[3] as number, move = row[4] as number, mf = row[5] as number;
    const dt = side.lastTick < 0 ? 0 : Math.max(0, view.t - side.lastTick);
    if (state !== side.lastState) { side.lastState = state; side.stateAge = 0; } else side.stateAge += dt;
    side.walk += (Math.abs(x - side.lastX) / 1000) * 38 * (1 + 0 * i);
    side.lastX = x;
    side.lastTick = view.t;
    side.model.root.position.set(x / 1000, y / 1000, 0);
    side.model.root.rotation.y = facing >= 0 ? -Math.PI / 2 : Math.PI / 2;
    side.model.root.visible = true;
    const anim = animOfState(state, (row[10] as number) !== 0);
    if (!(isMoveDriven(state) && move >= 0 && side.player?.play(move, mf, facing))) {
      side.model.setPose(statePose(anim, side.stateAge, side.walk + view.t * 0.0), facing);
    }
    side.model.setFlash((row[6] as number) > 0 ? 0.55 : 0);
    side.model.setShadow(y / 1000);
  };

  const radiusOf = (owner: number, def: number, ex: number): number => {
    const slot = (sides[owner === 1 ? 1 : 0] as Side).slot;
    if (!slot) return 0.2;
    const k = ckit(slot);
    const p = k.projs[def];
    const use = ex !== 0 && p && p.exIdx >= 0 ? (k.projs[p.exIdx] ?? p) : p;
    const b = use?.def.hit.boxes[0];
    return b ? Math.max(0.12, (b.r / 1000) * 0.8) : 0.2;
  };

  const state: FighterStageState = {
    shown: false, tick: -1, night: false, fighters: [], sparks: 0, projectiles: 0, overlaySegments: 0, camera: { ...wantCam },
  };

  return {
    scene, camera, state,
    show() {
      if (shown) return;
      shown = true;
      state.shown = true;
      host?.setMenuScene(scene, camera);
    },
    hide() {
      if (!shown) return;
      shown = false;
      state.shown = false;
      host?.clearMenuScene();
    },
    apply(view, train) {
      if (!view) {
        for (const s of sides) { s.model.root.visible = false; s.lastTick = -1; s.lastState = -1; s.id = ''; }
        projectiles.set([], radiusOf);
        overlay.set([]);
        return;
      }
      tick = view.t;
      setNight(view.nt === 1);
      reduced = view.rm === 1;
      poseSide(0, view.f[0], view);
      poseSide(1, view.f[1], view);
      projectiles.set(view.p, radiusOf);
      for (const e of view.e) {
        const kind = EVENT_KINDS[e[0] as number];
        const x = (e[2] as number) / 1000, y = Math.max(0.2, (e[3] as number) / 1000);
        if (kind === 'hit') sparks.spawn(x, y, sparkStrength(e[4] as number, e[5] as number), 0);
        else if (kind === 'block') sparks.spawn(x, y, 0, 1);
        else if (kind === 'check') sparks.spawn(x, y, 1, 2);
        else if (kind === 'ko') sparks.spawn(x, 1.0, 4, 3);
        else if (kind === 'super') sparks.spawn(x, 1.0, 4, 0);
      }
      if (train?.overlay.boxes && view) {
        const ids = view.id;
        const k0 = ckit((rosterEntry(ids[0]) ?? (ROSTER[0] as (typeof ROSTER)[number])).slot);
        const k1 = ckit((rosterEntry(ids[1]) ?? (ROSTER[1] as (typeof ROSTER)[number])).slot);
        overlay.lines.visible = true;
        overlay.set(overlayBoxes(view, [k0, k1]));
      } else if (overlay.lines.visible) {
        overlay.lines.visible = false;
        overlay.set([]);
      }
      const c = view.cam;
      wantCam = { x: (c[0] as number) / 1000, y: (c[4] as number) / 1000, z: (c[1] as number) / 1000, fov: c[5] as number };
      shakeMilli = c[3] as number;
      state.tick = view.t; state.night = night;
      state.fighters = [0, 1].map((i) => {
        const r = view.f[i as 0 | 1];
        return { x: r[0], y: r[1], facing: r[2], state: r[3], anim: animOfState(r[3], r[10] !== 0), move: r[4], frame: r[5] };
      });
      state.sparks = sparks.live; state.projectiles = projectiles.live; state.overlaySegments = overlay.segments;
    },
    frame(dt) {
      seconds += dt;
      stage.update(seconds, night);
      sparks.step(dt * 60);
      // the camera follows the plan: smoothed horizontally, direct for the distance (the sim already eases the dolly)
      const k = 1 - Math.exp(-dt * 9);
      cur.x += (wantCam.x - cur.x) * k;
      cur.y += (wantCam.y - cur.y) * k;
      cur.z += (wantCam.z - cur.z) * (1 - Math.exp(-dt * 14));
      let sx = 0, sy = 0;
      if (!reduced && shakeMilli > 0) {
        sx = Math.sin(seconds * 83) * (shakeMilli / 1000);
        sy = Math.cos(seconds * 71) * (shakeMilli / 1000) * 0.7;
      }
      camera.position.set(cur.x + sx, cur.y + sy, cur.z);
      camera.lookAt(cur.x, 0.95, 0);
      if (Math.abs(camera.fov - wantCam.fov) > 0.01) { camera.fov = wantCam.fov; camera.updateProjectionMatrix(); }
      state.camera = { x: cur.x, y: cur.y, z: cur.z, fov: camera.fov };
      state.sparks = sparks.live;
      void FIGHTER_ANIM;
      void tick;
    },
    objects() {
      let n = 0;
      scene.traverse((o: Object3D) => {
        const m = o as { isMesh?: boolean; isLine?: boolean; visible: boolean };
        if ((m.isMesh || m.isLine) && m.visible) n++;
      });
      return n;
    },
    dispose() {
      this.hide();
      stage.dispose();
      sparks.dispose();
      projectiles.dispose();
      overlay.dispose();
      for (const s of sides) s.model.dispose();
    },
  };
}
