/**
 * Procedural gray-box animation (FX7): poses for the 22-bone `bay_rig_v1` mannequin written as numbers, a keyframed clip per move built
 * from the move's own frame data (startup, active, recovery), and a pose per non-move state. Pure arithmetic: no three, no DOM, so the
 * tests can sample a clip in Node. A clip is sampled at an explicit frame (`FighterView.frame`), which is what makes the animation
 * frame-locked to the data (the `FrameLockedClipPlayer` in presenter.ts). M08b1 brings library clips and M10a the real art; the
 * keyframes here are a placeholder that reads as the move.
 *
 * Poses are written for a fighter facing right in terms of the LEAD side (near the camera) and the REAR side; the presenter maps
 * them to the rig's `l_` and `r_` bones by facing. Rotations are Euler XYZ in radians as the rig expects: a positive X swings a
 * hanging limb forward, a positive Y on the chest turns the lead shoulder forward, a positive Z on a limb swings it outward.
 */
import type { MoveDef } from '@dv/shared/fight';

export type V3 = [number, number, number];

export interface Pose {
  hips: V3;      // offset of the hips from rest: x sideways, y up, z forward (toward the opponent)
  pitch: number; // whole-body lean about X (positive leans back), used for knockdowns and launches
  spine: V3; chest: V3; head: V3;
  lUp: V3; lLo: V3; rUp: V3; rLo: V3;       // lead and rear arm
  lLeg: V3; lKnee: V3; rLeg: V3; rKnee: V3; // lead and rear leg
  lFoot: V3; rFoot: V3;
}

const z = (): V3 => [0, 0, 0];
export const blank = (): Pose => ({
  hips: z(), pitch: 0, spine: z(), chest: z(), head: z(), lUp: z(), lLo: z(), rUp: z(), rLo: z(),
  lLeg: z(), lKnee: z(), rLeg: z(), rKnee: z(), lFoot: z(), rFoot: z(),
});

const KEYS = ['hips', 'spine', 'chest', 'head', 'lUp', 'lLo', 'rUp', 'rLo', 'lLeg', 'lKnee', 'rLeg', 'rKnee', 'lFoot', 'rFoot'] as const;

export function clonePose(p: Pose): Pose {
  const o = blank();
  for (const k of KEYS) o[k] = [...p[k]] as V3;
  o.pitch = p.pitch;
  return o;
}

export function lerpPose(a: Pose, b: Pose, t: number, out: Pose = blank()): Pose {
  for (const k of KEYS) {
    const x = a[k], y = b[k], o = out[k];
    o[0] = x[0] + (y[0] - x[0]) * t; o[1] = x[1] + (y[1] - x[1]) * t; o[2] = x[2] + (y[2] - x[2]) * t;
  }
  out.pitch = a.pitch + (b.pitch - a.pitch) * t;
  return out;
}

/** Builds a pose from a sparse spec on top of a base (the fighting stance by default). */
export function pose(spec: Partial<Record<(typeof KEYS)[number], V3>> & { pitch?: number }, base: Pose = STANCE): Pose {
  const o = clonePose(base);
  for (const k of KEYS) { const v = spec[k]; if (v) o[k] = [...v] as V3; }
  if (spec.pitch !== undefined) o.pitch = spec.pitch;
  return o;
}

/** The fighting stance: knees soft, lead foot forward, hands up at the chin. */
export const STANCE: Pose = {
  hips: [0, -0.08, 0], pitch: 0, spine: [-0.06, 0, 0], chest: [0, 0.22, 0], head: [0.04, 0, 0],
  lUp: [0.65, 0, 0.35], lLo: [1.55, 0, 0], rUp: [0.55, 0, 0.45], rLo: [1.65, 0, 0],
  lLeg: [0.42, 0, 0.12], lKnee: [-0.6, 0, 0], rLeg: [-0.28, 0, 0.12], rKnee: [-0.45, 0, 0], lFoot: [0.15, 0, 0], rFoot: [0.1, 0, 0],
};

export interface Key { f: number; p: Pose }
export interface Clip { keys: Key[]; length: number }

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** The pose of a clip at `frame` (clamped to its ends), keys blended with an ease. */
export function sampleClip(c: Clip, frame: number, out: Pose = blank()): Pose {
  const ks = c.keys;
  if (ks.length === 0) return lerpPose(STANCE, STANCE, 0, out);
  if (frame <= (ks[0] as Key).f) return lerpPose(ks[0]!.p, ks[0]!.p, 0, out);
  for (let i = 1; i < ks.length; i++) {
    const a = ks[i - 1] as Key, b = ks[i] as Key;
    if (frame <= b.f) return lerpPose(a.p, b.p, b.f === a.f ? 1 : smooth((frame - a.f) / (b.f - a.f)), out);
  }
  const last = ks[ks.length - 1] as Key;
  return lerpPose(last.p, last.p, 0, out);
}

// ---- move poses --------------------------------------------------------------------------------------------------------------

const LOW = { hips: [0, -0.42, 0.05] as V3, spine: [-0.35, 0, 0] as V3, lLeg: [1.35, 0, 0.18] as V3, lKnee: [-1.95, 0, 0] as V3, rLeg: [0.55, 0, 0.3] as V3, rKnee: [-1.5, 0, 0] as V3 };

const jabReach = (reach: number, lo = 0.1): Partial<Pose> => ({ lUp: [1.5 + reach, 0, 0.05], lLo: [lo, 0, 0] });

export function crouchPose(): Pose { return pose({ ...LOW, lUp: [0.7, 0, 0.35], lLo: [1.6, 0, 0], rUp: [0.6, 0, 0.45], rLo: [1.7, 0, 0] }); }

type Shape = 'jab' | 'cross' | 'haymaker' | 'lowJab' | 'lowCross' | 'sweep' | 'kick' | 'airKick' | 'throw' | 'cast' | 'rising' | 'slide' | 'super' | 'taunt';

function shapeOf(d: MoveDef): { shape: Shape; strength: 0 | 1 | 2 } {
  const inp = d.input;
  const mask = inp.t === 'chord' || inp.t === 'button' || inp.t === 'motion' || inp.t === 'charge' ? inp.buttons : 0;
  const strength: 0 | 1 | 2 = (mask & (64 | 512)) !== 0 ? 2 : (mask & (32 | 256)) !== 0 ? 1 : 0;
  if (d.kind === 'throw') return { shape: 'throw', strength };
  if (d.kind === 'super') return { shape: 'super', strength };
  if (d.kind === 'taunt' || d.kind === 'shutdown') return { shape: 'taunt', strength };
  if (d.kind === 'air') return { shape: 'airKick', strength };
  if (d.kind === 'special') {
    if (inp.t === 'motion' && inp.seq === '623') return { shape: 'rising', strength };
    if (d.spawn && d.spawn.length > 0) return { shape: 'cast', strength };
    if (inp.t === 'motion' && inp.seq === '214') return { shape: 'slide', strength };
    return { shape: 'cast', strength };
  }
  const kick = (mask & 896) !== 0 && (mask & 112) === 0;
  const low = inp.t === 'button' && (inp.dir === 2 || inp.dir === 1 || inp.dir === 3);
  if (low) return { shape: kick || strength === 2 ? 'sweep' : strength === 1 ? 'lowCross' : 'lowJab', strength };
  if (kick) return { shape: 'kick', strength };
  return { shape: strength === 2 ? 'haymaker' : strength === 1 ? 'cross' : 'jab', strength };
}

/** The three poses of a strike: the wind-up, the extension and the follow-through, for a shape. */
function strikePoses(shape: Shape, strength: 0 | 1 | 2): { wind: Pose; hit: Pose; hold: Pose } {
  const lunge = 0.04 + 0.04 * strength;
  switch (shape) {
    case 'jab':
      return {
        wind: pose({ lUp: [0.4, 0, 0.4], lLo: [1.9, 0, 0], chest: [0, 0.1, 0] }),
        hit: pose({ ...jabReach(0.05), chest: [0, 0.5, 0], hips: [0, -0.08, lunge], spine: [-0.1, 0, 0] }),
        hold: pose({ ...jabReach(0.05), chest: [0, 0.45, 0], hips: [0, -0.08, lunge] }),
      };
    case 'cross':
      return {
        wind: pose({ rUp: [-0.2, 0, 0.5], rLo: [2.0, 0, 0], chest: [0, -0.35, 0], hips: [0, -0.1, -0.03] }),
        hit: pose({ rUp: [1.55, 0, -0.05], rLo: [0.08, 0, 0], chest: [0, 0.6, 0], spine: [-0.18, 0, 0], hips: [0, -0.1, lunge + 0.04], rLeg: [0.1, 0, 0.12], rKnee: [-0.2, 0, 0] }),
        hold: pose({ rUp: [1.5, 0, -0.05], rLo: [0.08, 0, 0], chest: [0, 0.55, 0], spine: [-0.15, 0, 0], hips: [0, -0.1, lunge + 0.04] }),
      };
    case 'haymaker':
      return {
        wind: pose({ rUp: [-0.9, 0, 0.7], rLo: [1.2, 0, 0], chest: [0.05, -0.6, 0], spine: [0.1, 0, 0], hips: [0, -0.14, -0.06] }),
        hit: pose({ rUp: [1.2, 0, -0.5], rLo: [0.1, 0, 0], chest: [-0.1, 0.8, 0], spine: [-0.25, 0, 0], hips: [0, -0.14, 0.18], lLeg: [0.6, 0, 0.12], lKnee: [-0.7, 0, 0] }),
        hold: pose({ rUp: [1.15, 0, -0.5], rLo: [0.1, 0, 0], chest: [-0.1, 0.75, 0], spine: [-0.22, 0, 0], hips: [0, -0.14, 0.16] }),
      };
    case 'lowJab':
    case 'lowCross': {
      const hitArm = shape === 'lowJab' ? { lUp: [1.4, 0, 0.1] as V3, lLo: [0.15, 0, 0] as V3 } : { rUp: [1.4, 0, 0] as V3, rLo: [0.15, 0, 0] as V3 };
      return {
        wind: pose({ ...LOW, lUp: [0.7, 0, 0.35], lLo: [1.6, 0, 0] }),
        hit: pose({ ...LOW, ...hitArm, chest: [0, 0.45, 0], hips: [0, -0.42, 0.12] }),
        hold: pose({ ...LOW, ...hitArm, chest: [0, 0.4, 0], hips: [0, -0.42, 0.1] }),
      };
    }
    case 'sweep':
      return {
        wind: pose({ ...LOW, rLeg: [1.0, 0, 0.1], rKnee: [-1.8, 0, 0], hips: [0, -0.5, -0.05] }),
        hit: pose({ ...LOW, hips: [0, -0.55, 0.1], lLeg: [0.9, 0, 0.2], lKnee: [-1.7, 0, 0], rLeg: [1.35, 0, 0.1], rKnee: [-0.1, 0, 0], rFoot: [-0.2, 0, 0], spine: [-0.45, 0, 0] }),
        hold: pose({ ...LOW, hips: [0, -0.55, 0.12], rLeg: [1.4, 0, 0.1], rKnee: [-0.05, 0, 0], spine: [-0.45, 0, 0] }),
      };
    case 'kick':
      return {
        wind: pose({ rLeg: [0.9, 0, 0.15], rKnee: [-1.6, 0, 0], spine: [0.1, 0, 0], hips: [0, -0.08, -0.04] }),
        hit: pose({ rLeg: [1.55, 0, 0.1], rKnee: [-0.1, 0, 0], rFoot: [-0.3, 0, 0], spine: [0.22, 0, 0], hips: [0, -0.04, 0.08], lUp: [0.6, 0, 0.8], lLeg: [0.1, 0, 0.1], lKnee: [-0.2, 0, 0] }),
        hold: pose({ rLeg: [1.5, 0, 0.1], rKnee: [-0.1, 0, 0], spine: [0.2, 0, 0], hips: [0, -0.04, 0.08], lUp: [0.6, 0, 0.8] }),
      };
    case 'airKick':
      return {
        wind: pose({ lLeg: [0.8, 0, 0.1], lKnee: [-1.4, 0, 0], rLeg: [0.6, 0, 0.1], rKnee: [-1.2, 0, 0], lUp: [1.6, 0, 0.3], rUp: [1.6, 0, 0.3], spine: [0.1, 0, 0] }),
        hit: pose({ lLeg: [1.3, 0, 0.1], lKnee: [-0.15, 0, 0], rLeg: [0.5, 0, 0.1], rKnee: [-1.0, 0, 0], lUp: [1.8, 0, 0.4], rUp: [1.8, 0, 0.4], spine: [0.3, 0, 0] }),
        hold: pose({ lLeg: [1.3, 0, 0.1], lKnee: [-0.15, 0, 0], rLeg: [0.5, 0, 0.1], rKnee: [-1.0, 0, 0], lUp: [1.8, 0, 0.4], rUp: [1.8, 0, 0.4], spine: [0.3, 0, 0] }),
      };
    case 'throw':
      return {
        wind: pose({ lUp: [1.5, 0, 0.5], lLo: [0.2, 0, 0], rUp: [1.5, 0, 0.5], rLo: [0.2, 0, 0], hips: [0, -0.1, 0.05], spine: [-0.2, 0, 0] }),
        hit: pose({ lUp: [1.45, 0, -0.1], lLo: [0.3, 0, 0], rUp: [1.45, 0, 0.1], rLo: [0.3, 0, 0], hips: [0, -0.12, 0.2], spine: [-0.3, 0, 0] }),
        hold: pose({ lUp: [2.4, 0, -0.1], lLo: [0.3, 0, 0], rUp: [2.4, 0, 0.1], rLo: [0.3, 0, 0], hips: [0, -0.1, 0.1], spine: [0.25, 0, 0] }),
      };
    case 'cast':
      return {
        wind: pose({ lUp: [0.2, 0, 0.5], lLo: [1.8, 0, 0], rUp: [0.2, 0, 0.5], rLo: [1.8, 0, 0], hips: [0, -0.14, -0.05], spine: [0.12, 0, 0] }),
        hit: pose({ lUp: [1.55, 0, 0.12], lLo: [0.1, 0, 0], rUp: [1.55, 0, -0.1], rLo: [0.1, 0, 0], hips: [0, -0.14, 0.1], spine: [-0.12, 0, 0] }),
        hold: pose({ lUp: [1.5, 0, 0.12], lLo: [0.1, 0, 0], rUp: [1.5, 0, -0.1], rLo: [0.1, 0, 0], hips: [0, -0.14, 0.1], spine: [-0.1, 0, 0] }),
      };
    case 'rising':
      return {
        wind: pose({ ...LOW, rUp: [0.2, 0, 0.5], rLo: [2.0, 0, 0], hips: [0, -0.5, 0.05] }),
        hit: pose({ rUp: [2.9, 0, -0.1], rLo: [0.1, 0, 0], lUp: [0.9, 0, 0.4], lLo: [1.6, 0, 0], hips: [0, 0.18, 0.08], spine: [-0.3, 0, 0], lLeg: [0.3, 0, 0.1], lKnee: [-0.5, 0, 0], rLeg: [-0.2, 0, 0.1], rKnee: [-0.2, 0, 0] }),
        hold: pose({ rUp: [3.0, 0, -0.1], rLo: [0.1, 0, 0], hips: [0, 0.3, 0.08], spine: [-0.3, 0, 0], lLeg: [0.6, 0, 0.1], lKnee: [-1.3, 0, 0], rLeg: [0.4, 0, 0.1], rKnee: [-1.0, 0, 0] }),
      };
    case 'slide':
      return {
        wind: pose({ ...LOW, hips: [0, -0.5, -0.05], spine: [-0.5, 0, 0] }),
        hit: pose({ hips: [0, -0.6, 0.3], spine: [-0.7, 0, 0], lLeg: [1.4, 0, 0.1], lKnee: [-0.3, 0, 0], rLeg: [-0.4, 0, 0.1], rKnee: [-1.6, 0, 0], lUp: [1.2, 0, 0.3], rUp: [1.0, 0, 0.3] }),
        hold: pose({ hips: [0, -0.6, 0.3], spine: [-0.7, 0, 0], lLeg: [1.4, 0, 0.1], lKnee: [-0.3, 0, 0], rLeg: [-0.4, 0, 0.1], rKnee: [-1.6, 0, 0] }),
      };
    case 'super':
      return {
        wind: pose({ lUp: [2.6, 0, 0.7], lLo: [0.2, 0, 0], rUp: [2.6, 0, 0.7], rLo: [0.2, 0, 0], hips: [0, -0.2, 0], spine: [0.15, 0, 0], lLeg: [0.5, 0, 0.35], rLeg: [0.3, 0, 0.35], lKnee: [-0.9, 0, 0], rKnee: [-0.9, 0, 0] }),
        hit: pose({ lUp: [1.55, 0, 0.1], lLo: [0.1, 0, 0], rUp: [1.55, 0, -0.1], rLo: [0.1, 0, 0], hips: [0, -0.18, 0.28], spine: [-0.3, 0, 0], chest: [0, 0.5, 0] }),
        hold: pose({ lUp: [1.5, 0, 0.1], lLo: [0.1, 0, 0], rUp: [1.5, 0, -0.1], rLo: [0.1, 0, 0], hips: [0, -0.18, 0.3], spine: [-0.3, 0, 0], chest: [0, 0.5, 0] }),
      };
    case 'taunt':
      return {
        wind: pose({ lUp: [0.2, 0, 1.2], lLo: [0.6, 0, 0], rUp: [0.2, 0, 1.2], rLo: [0.6, 0, 0] }),
        hit: pose({ lUp: [-0.2, 0, 1.5], lLo: [0.2, 0, 0], rUp: [-0.2, 0, 1.5], rLo: [0.2, 0, 0], head: [-0.2, 0, 0], spine: [0.1, 0, 0] }),
        hold: pose({ lUp: [-0.2, 0, 1.5], lLo: [0.2, 0, 0], rUp: [-0.2, 0, 1.5], rLo: [0.2, 0, 0], head: [-0.2, 0, 0] }),
      };
  }
}

/**
 * The clip of a move, keyed on the move's own frame numbers. Move frames count from 1 (the first startup frame) as the core does;
 * the last key is the end of recovery, back in the stance. Rising moves lift the whole body (`hips.y` in the keys).
 */
export function moveClip(d: MoveDef): Clip {
  const S = d.startup, ACT = d.active, R = d.recovery;
  const total = S - 1 + ACT + R;
  const { shape, strength } = shapeOf(d);
  const { wind, hit, hold } = strikePoses(shape, strength);
  const start = shape === 'sweep' || shape === 'lowJab' || shape === 'lowCross' ? crouchPose() : STANCE;
  const keys: Key[] = [
    { f: 0, p: start },
    { f: Math.max(1, S - Math.max(2, Math.trunc(S / 2))), p: wind },
    { f: Math.max(2, S), p: hit },
    { f: Math.max(3, S - 1 + ACT), p: hold },
    { f: Math.max(4, total), p: start },
  ];
  // frames must not go backwards for very short moves
  for (let i = 1; i < keys.length; i++) {
    const prev = keys[i - 1] as Key;
    const cur = keys[i] as Key;
    if (cur.f < prev.f) cur.f = prev.f;
  }
  return { keys, length: total };
}

// ---- state poses --------------------------------------------------------------------------------------------------------------

/** AnimStateId constants of the fighter block (anim-states.ts) the state poses switch on. */
const A = {
  idle: 160, walkF: 161, walkB: 162, crouch: 163, crouchDown: 164, standUp: 165, preJump: 166, jumpN: 167, jumpF: 168, jumpB: 169, fall: 170, land: 171,
  dashF: 172, dashB: 173, blockStand: 174, blockCrouch: 175, hitStand: 176, hitHeavy: 177, hitCrouch: 178, hitAir: 179, knockdownFall: 180, knockdownLie: 181,
  wakeup: 182, quickRise: 183, thrown: 185, tech: 186, check: 191, checkSuccess: 192, clear: 193, rattled: 194, taunt: 195,
  intro: 196, roundWin: 197, roundLose: 198, ko: 199, slumped: 200, victory: 203, defeat: 204,
} as const;

const TAU = Math.PI * 2;
const sin = Math.sin;

/**
 * The pose of a non-move state. `t` is the frames since the state began, `phase` a free-running counter in frames (idle sway, the
 * walk cycle). The presenter calls this for states `isMoveDriven` says are not move-driven.
 */
export function statePose(anim: number, t: number, phase: number, out: Pose = blank()): Pose {
  const sway = sin((phase / 150) * TAU);
  switch (anim) {
    case A.walkF: case A.walkB: {
      const dir = anim === A.walkF ? 1 : -1;
      const c = sin((phase / 34) * TAU) * dir;
      return lerpPose(pose({
        hips: [0, -0.08 + 0.02 * Math.abs(c), 0], lLeg: [0.42 + 0.5 * c, 0, 0.12], lKnee: [-0.6 - 0.3 * Math.max(0, -c), 0, 0],
        rLeg: [-0.28 - 0.5 * c, 0, 0.12], rKnee: [-0.45 - 0.3 * Math.max(0, c), 0, 0],
      }), STANCE, 0, out);
    }
    case A.dashF: case A.dashB:
      return lerpPose(pose({ hips: [0, -0.2, 0.1 * (anim === A.dashF ? 1 : -1)], spine: [anim === A.dashF ? -0.4 : 0.25, 0, 0], lLeg: [0.9, 0, 0.1], lKnee: [-1.1, 0, 0], rLeg: [-0.6, 0, 0.1], rKnee: [-0.8, 0, 0] }), STANCE, 0, out);
    case A.crouch: case A.crouchDown: case A.blockCrouch: case A.hitCrouch: {
      const p = crouchPose();
      if (anim === A.blockCrouch) { p.lUp = [1.05, 0, 0.1]; p.lLo = [1.95, 0, 0]; p.rUp = [1.0, 0, 0.1]; p.rLo = [1.95, 0, 0]; }
      if (anim === A.hitCrouch) { p.spine = [0.15, 0, 0]; p.head = [0.35, 0, 0]; p.hips = [0, -0.4, -0.08]; }
      return lerpPose(p, p, 0, out);
    }
    case A.standUp: return lerpPose(crouchPose(), STANCE, Math.min(1, t / 3), out);
    case A.preJump: return lerpPose(STANCE, crouchPose(), Math.min(1, t / 4), out);
    case A.jumpN: case A.jumpF: case A.jumpB: case A.fall:
      return lerpPose(pose({ hips: [0, 0.05, 0], lLeg: [0.9, 0, 0.1], lKnee: [-1.3, 0, 0], rLeg: [0.4, 0, 0.15], rKnee: [-1.1, 0, 0], lUp: [1.0, 0, 0.5], rUp: [0.9, 0, 0.6], lLo: [1.2, 0, 0], rLo: [1.2, 0, 0] }), STANCE, 0, out);
    case A.land: return lerpPose(crouchPose(), STANCE, Math.min(1, t / 3), out);
    case A.blockStand:
      return lerpPose(pose({ lUp: [1.05, 0, 0.1], lLo: [1.95, 0, 0], rUp: [1.0, 0, 0.1], rLo: [1.95, 0, 0], spine: [0.05, 0, 0], head: [0.1, 0, 0] }), STANCE, 0, out);
    case A.check:
      return lerpPose(pose({ lUp: [1.45, 0, 0.1], lLo: [0.2, 0, 0], rUp: [1.4, 0, -0.1], rLo: [0.2, 0, 0], chest: [0, 0.2, 0] }), STANCE, 0, out);
    case A.checkSuccess:
      return lerpPose(pose({ lUp: [1.45, 0, 0.2], lLo: [0.2, 0, 0], rUp: [1.4, 0, -0.2], rLo: [0.2, 0, 0], spine: [-0.15, 0, 0], hips: [0, -0.08, 0.1] }), STANCE, 0, out);
    case A.clear:
      return lerpPose(pose({ lUp: [0.3, 0, 1.6], lLo: [0.4, 0, 0], rUp: [0.3, 0, 1.6], rLo: [0.4, 0, 0], spine: [0.2, 0, 0], hips: [0, 0.05, -0.1] }), STANCE, 0, out);
    case A.hitStand: case A.hitHeavy: {
      const k = Math.min(1, t / 3);
      return lerpPose(STANCE, pose({ spine: [0.35, 0, 0], head: [0.5, 0, 0], chest: [0.1, 0, 0], hips: [0, -0.06, -0.12], lUp: [0.2, 0, 0.9], lLo: [0.6, 0, 0], rUp: [0.3, 0, 0.9], rLo: [0.6, 0, 0] }), k, out);
    }
    case A.hitAir: return lerpPose(pose({ pitch: 0.7, hips: [0, 0.1, -0.1], lUp: [0.2, 0, 1.0], rUp: [0.2, 0, 1.0], lLeg: [0.5, 0, 0.2], rLeg: [0.2, 0, 0.2], lKnee: [-0.6, 0, 0], rKnee: [-0.4, 0, 0] }), STANCE, 0, out);
    case A.thrown: return lerpPose(pose({ pitch: 0.9, hips: [0, 0.2, -0.15], lUp: [0.4, 0, 1.0], rUp: [0.4, 0, 1.0] }), STANCE, 0, out);
    case A.knockdownFall: return lerpPose(pose({ pitch: 1.1, hips: [0, 0.1, -0.2] }), STANCE, 0, out);
    case A.knockdownLie: case A.ko: case A.slumped: case A.defeat: case A.roundLose: {
      const lying = pose({ pitch: 1.5, hips: [0, -0.7, -0.15], lUp: [0.2, 0, 0.7], rUp: [0.2, 0, 0.7], lLeg: [0.1, 0, 0.2], rLeg: [0.1, 0, 0.2], lKnee: [-0.2, 0, 0], rKnee: [-0.2, 0, 0] });
      if (anim === A.defeat || anim === A.roundLose) return lerpPose(pose({ spine: [0.35, 0, 0], head: [0.5, 0, 0], hips: [0, -0.15, 0], lUp: [0.1, 0, 0.2], lLo: [0.2, 0, 0], rUp: [0.1, 0, 0.2], rLo: [0.2, 0, 0], lLeg: [0.1, 0, 0.1], lKnee: [-0.1, 0, 0], rLeg: [0.05, 0, 0.1], rKnee: [-0.1, 0, 0] }), STANCE, 0, out);
      return lerpPose(lying, lying, 0, out);
    }
    case A.wakeup: case A.quickRise: {
      const lying = pose({ pitch: 1.5, hips: [0, -0.7, -0.15] });
      return lerpPose(lying, STANCE, Math.min(1, t / (anim === A.quickRise ? 12 : 18)), out);
    }
    case A.victory: case A.roundWin:
      return lerpPose(pose({ rUp: [2.9, 0, -0.2], rLo: [0.2, 0, 0], lUp: [0.5, 0, 0.5], lLo: [1.2, 0, 0], head: [-0.15, 0, 0], hips: [0, -0.04 + 0.03 * sin((phase / 24) * TAU), 0] }), STANCE, 0, out);
    case A.intro: case A.rattled: {
      const p = pose({ spine: [0.1, 0, 0], head: [0.2, 0, 0], hips: [0, -0.14, 0], lUp: [0.3, 0, 0.5], lLo: [0.9, 0, 0], rUp: [0.3, 0, 0.5], rLo: [0.9, 0, 0] });
      return lerpPose(p, p, 0, out);
    }
    default: {
      // idle: the stance with a slow breath and a bob
      return lerpPose(pose({ hips: [0, -0.08 + 0.012 * sway, 0], spine: [-0.06 + 0.02 * sway, 0, 0], lUp: [0.65 + 0.04 * sway, 0, 0.35], rUp: [0.55 - 0.04 * sway, 0, 0.45] }), STANCE, 0, out);
    }
  }
}
