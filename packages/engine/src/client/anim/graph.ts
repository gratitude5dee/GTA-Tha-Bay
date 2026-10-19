import { ANIM_STATE } from '@dv/shared';
import type { AnimGraphDef, AnimStateDef, ClipRef } from './types.ts';

/** Crossfade between two states (01-engine.md section 2.8, M01b2). */
export const DEFAULT_FADE_SEC = 0.2;

/** Identity of a clip in a weights map. */
export const clipKey = (c: ClipRef): string => `${c.asset}#${c.clip}`;

/**
 * Weights of a 1D blend: the two clips around `value` share the weight linearly; below the first threshold and above the last,
 * that end clip has all of it.
 */
export function blend1dWeights(points: readonly [number, ClipRef][], value: number, out: Map<string, number>, scale = 1): void {
  const n = points.length;
  if (n === 0) return;
  const add = (c: ClipRef, w: number): void => {
    if (w <= 0) return;
    const k = clipKey(c);
    out.set(k, (out.get(k) ?? 0) + w * scale);
  };
  const first = points[0] as [number, ClipRef];
  const last = points[n - 1] as [number, ClipRef];
  if (value <= first[0]) return add(first[1], 1);
  if (value >= last[0]) return add(last[1], 1);
  for (let i = 0; i < n - 1; i++) {
    const a = points[i] as [number, ClipRef];
    const b = points[i + 1] as [number, ClipRef];
    if (value >= a[0] && value <= b[0]) {
      const t = (value - a[0]) / (b[0] - a[0]);
      add(a[1], 1 - t);
      add(b[1], t);
      return;
    }
  }
}

interface Layer {
  def: AnimStateDef;
  weight: number;
}

/**
 * The runtime of an `AnimGraphDef`: it is told the current `Anim` state id and `p0`/`p1` every frame and answers with one
 * weight per clip. A change of state crossfades over the new state's `fadeInSec` (0.2 s by default): the newest state's
 * weight rises linearly and the older layers share what is left in proportion. Two states that use the same `blend1d` object
 * (the locomotion ids idle, walk, run and sprint) are one layer: moving between them changes the blend position, not the layer.
 */
export class AnimGraph {
  private layers: Layer[] = [];
  private p0 = 0;
  private p1 = 0;
  private stateId = -1;

  constructor(readonly def: AnimGraphDef) {}

  /** The Anim state id last passed to `setState`, or -1. */
  get state(): number {
    return this.stateId;
  }

  /** Layers currently contributing (1 at rest, 2 or more while crossfading). */
  get layerCount(): number {
    return this.layers.length;
  }

  stateDef(id: number): AnimStateDef | undefined {
    return this.def.states.find((s) => s.id === id);
  }

  /** The newest state's weight, 0..1 (1 when no crossfade is running). */
  get fadeWeight(): number {
    const top = this.layers[this.layers.length - 1];
    return top ? top.weight : 1;
  }

  /** Feeds the snapshot's `Anim` fields. An unknown state id falls back to state 0. */
  setState(id: number, p0: number, p1 = 0): void {
    this.p0 = p0;
    this.p1 = p1;
    if (id === this.stateId) return;
    this.stateId = id;
    const def = this.stateDef(id) ?? this.stateDef(ANIM_STATE.idle);
    if (!def) return;
    const top = this.layers[this.layers.length - 1];
    if (!top) {
      this.layers.push({ def, weight: 1 });
      return;
    }
    if (top.def === def || (top.def.blend1d !== undefined && top.def.blend1d === def.blend1d)) {
      top.def = def;
      return;
    }
    this.layers.push({ def, weight: 0 });
  }

  /** Advances the crossfade by `dtSec`. */
  update(dtSec: number): void {
    const top = this.layers[this.layers.length - 1];
    if (!top || this.layers.length === 1) {
      if (top) top.weight = 1;
      return;
    }
    const fade = Math.max(1e-6, top.def.fadeInSec);
    top.weight = Math.min(1, top.weight + Math.max(0, dtSec) / fade);
    if (top.weight >= 1) {
      this.layers = [top];
      return;
    }
    const rest = this.layers.slice(0, -1);
    const sum = rest.reduce((a, l) => a + l.weight, 0);
    const want = 1 - top.weight;
    if (sum > 0) for (const l of rest) l.weight *= want / sum;
    else rest[rest.length - 1]!.weight = want;
  }

  /** One weight per clip, the sum of the layers' contributions. The returned map is reused. */
  weights(out: Map<string, number> = new Map()): Map<string, number> {
    out.clear();
    for (const l of this.layers) {
      const d = l.def;
      if (d.clip) {
        const k = clipKey(d.clip);
        out.set(k, (out.get(k) ?? 0) + l.weight);
      } else if (d.blend1d) {
        blend1dWeights(d.blend1d.points, d.blend1d.param === 0 ? this.p0 : this.p1, out, l.weight);
      } else if (d.blend2d) {
        // Nearest-two along x as a stand-in until a graph needs strafe blending (M03a/M06).
        const pts = d.blend2d.points.map(([x, , c]) => [x, c] as [number, ClipRef]).sort((a, b) => a[0] - b[0]);
        blend1dWeights(pts, this.p0, out, l.weight);
      }
    }
    return out;
  }
}

// ---- the player graph ----------------------------------------------------------------------------------------------

/** The procedural clips of the mannequin (`placeholder-rig.ts`). Real clips arrive with M01d/M10a. */
export const PLACEHOLDER_CLIPS = ['idle', 'walk', 'run', 'jump', 'fall', 'land', 'vault'] as const;
export type PlaceholderClip = (typeof PLACEHOLDER_CLIPS)[number];
const ref = (clip: PlaceholderClip): ClipRef => ({ asset: 'anim/bay_rig_v1.proc', clip });

/** Locomotion blends on speed: idle at 0, walk at 1.6 m/s, run at 4.2 m/s and beyond (the sim's walk and run speeds). */
const LOCOMOTION: NonNullable<AnimStateDef['blend1d']> = {
  param: 0,
  points: [[0, ref('idle')], [1.6, ref('walk')], [4.2, ref('run')]],
};

/**
 * The player graph: ids 0 to 3 (idle, walk, run, sprint) share the locomotion blend; jump, fall, land and vault are single
 * clips. Every state fades in over 0.2 s.
 */
export const PLAYER_GRAPH: AnimGraphDef = {
  id: 'player.default',
  skeleton: 'bay_rig_v1',
  ik: { feet: false, hands: 'off' },
  states: [
    { id: ANIM_STATE.idle, name: 'idle', loop: true, blend1d: LOCOMOTION, fadeInSec: DEFAULT_FADE_SEC },
    { id: ANIM_STATE.walk, name: 'walk', loop: true, blend1d: LOCOMOTION, fadeInSec: DEFAULT_FADE_SEC },
    { id: ANIM_STATE.run, name: 'run', loop: true, blend1d: LOCOMOTION, fadeInSec: DEFAULT_FADE_SEC },
    { id: ANIM_STATE.sprint, name: 'sprint', loop: true, blend1d: LOCOMOTION, fadeInSec: DEFAULT_FADE_SEC },
    { id: ANIM_STATE.jump, name: 'jump', loop: false, clip: ref('jump'), fadeInSec: DEFAULT_FADE_SEC },
    { id: ANIM_STATE.fall, name: 'fall', loop: true, clip: ref('fall'), fadeInSec: DEFAULT_FADE_SEC },
    { id: ANIM_STATE.land, name: 'land', loop: false, clip: ref('land'), fadeInSec: DEFAULT_FADE_SEC },
    { id: ANIM_STATE.vault, name: 'vault', loop: false, clip: ref('vault'), fadeInSec: DEFAULT_FADE_SEC },
  ],
};
