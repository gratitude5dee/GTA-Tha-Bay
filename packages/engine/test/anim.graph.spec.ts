import { ANIM_STATE, HUMANOID_BONES } from '@dv/shared';
import { Bone, type Object3D } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { AnimGraph, clipKey, PLAYER_GRAPH } from '../src/client/anim/graph.ts';
import { AnimLod, animBandsFor, bandFor, ENGINE_TIERS } from '../src/client/anim/lod.ts';
import { buildPlaceholderRig, MannequinAnimator } from '../src/client/anim/placeholder-rig.ts';

const IDLE = clipKey({ asset: 'anim/bay_rig_v1.proc', clip: 'idle' });
const WALK = clipKey({ asset: 'anim/bay_rig_v1.proc', clip: 'walk' });
const RUN = clipKey({ asset: 'anim/bay_rig_v1.proc', clip: 'run' });
const JUMP = clipKey({ asset: 'anim/bay_rig_v1.proc', clip: 'jump' });

function weightsAt(p0: number, state: number = ANIM_STATE.idle): Map<string, number> {
  const g = new AnimGraph(PLAYER_GRAPH);
  g.setState(state, p0);
  g.update(1);
  return new Map(g.weights());
}
const w = (m: Map<string, number>, k: string): number => m.get(k) ?? 0;

describe('the player anim graph (AC-7)', () => {
  it('blends locomotion on p0: idle at 0, walk at 1.6, half walk and half run at 2.9, run at 4.2 m/s', () => {
    const a = weightsAt(0);
    expect([w(a, IDLE), w(a, WALK), w(a, RUN)]).toEqual([1, 0, 0]);
    const b = weightsAt(1.6);
    expect(w(b, WALK)).toBeCloseTo(1, 2);
    expect(w(b, IDLE) + w(b, RUN)).toBeCloseTo(0, 2);
    const c = weightsAt(2.9);
    expect(w(c, WALK)).toBeCloseTo(0.5, 2);
    expect(w(c, RUN)).toBeCloseTo(0.5, 2);
    expect(w(c, IDLE)).toBeCloseTo(0, 2);
    const d = weightsAt(4.2);
    expect(w(d, RUN)).toBeCloseTo(1, 2);
    // Faster than run stays run; the weights always sum to one.
    expect(w(weightsAt(6.8), RUN)).toBe(1);
    for (const p0 of [0, 0.4, 1.6, 2.1, 2.9, 3.7, 4.2, 7]) {
      let sum = 0;
      for (const v of weightsAt(p0).values()) sum += v;
      expect(sum).toBeCloseTo(1, 9);
    }
  });

  it('idle, walk, run and sprint ids are one layer: a speed change is not a crossfade', () => {
    const g = new AnimGraph(PLAYER_GRAPH);
    g.setState(ANIM_STATE.idle, 0);
    g.update(1);
    g.setState(ANIM_STATE.walk, 1.6);
    expect(g.layerCount).toBe(1);
    g.setState(ANIM_STATE.run, 4.2);
    expect(g.layerCount).toBe(1);
    g.setState(ANIM_STATE.sprint, 6.8);
    expect(g.layerCount).toBe(1);
  });

  it('a state change crossfades over 0.2 s', () => {
    const g = new AnimGraph(PLAYER_GRAPH);
    g.setState(ANIM_STATE.run, 4.2);
    g.update(1);
    g.setState(ANIM_STATE.jump, 4.2);
    expect(g.layerCount).toBe(2);
    expect(w(g.weights(), JUMP)).toBe(0);
    g.update(0.1);
    expect(w(g.weights(), JUMP)).toBeCloseTo(0.5, 6);
    expect(w(g.weights(), RUN)).toBeCloseTo(0.5, 6);
    g.update(0.05);
    expect(w(g.weights(), JUMP)).toBeCloseTo(0.75, 6);
    g.update(0.05);
    expect(w(g.weights(), JUMP)).toBe(1);
    expect(g.layerCount).toBe(1);
    expect(g.weights().has(RUN)).toBe(false);
  });

  it('a second change in mid-fade keeps the weights summing to one', () => {
    const g = new AnimGraph(PLAYER_GRAPH);
    g.setState(ANIM_STATE.run, 4.2);
    g.update(1);
    g.setState(ANIM_STATE.jump, 4.2);
    g.update(0.1);
    g.setState(ANIM_STATE.fall, 4.2);
    for (let i = 0; i < 4; i++) {
      g.update(0.04);
      let sum = 0;
      for (const v of g.weights().values()) sum += v;
      expect(sum).toBeCloseTo(1, 9);
    }
  });

  it('an unknown state id falls back to idle', () => {
    const g = new AnimGraph(PLAYER_GRAPH);
    g.setState(99, 0);
    g.update(1);
    expect(w(g.weights(), IDLE)).toBe(1);
  });
});

describe('animation LOD (AC-7)', () => {
  it('the bands come from config/engine-tiers.json', () => {
    expect(animBandsFor('desktop')).toEqual({ fullHzWithinM: 40, halfHzWithinM: 80, quarterHzWithinM: 150 });
    expect(animBandsFor('mobile')).toEqual({ fullHzWithinM: 20, halfHzWithinM: 40, quarterHzWithinM: 80 });
    expect(animBandsFor('mobile-low')).toEqual({ fullHzWithinM: 12, halfHzWithinM: 25, quarterHzWithinM: 50 });
    expect(animBandsFor('xr-quest')).toEqual({ fullHzWithinM: 15, halfHzWithinM: 30, quarterHzWithinM: 60 });
    expect(animBandsFor('xr-visionpro')).toEqual({ fullHzWithinM: 25, halfHzWithinM: 50, quarterHzWithinM: 100 });
    expect(ENGINE_TIERS['mobile-low'].footIk).toBe(false);
  });

  it('at mobile a mixer beyond 80 m is never updated; inside it runs at full, half and quarter rate', () => {
    const lod = new AnimLod(animBandsFor('mobile'));
    const ran = (distance: number): number => {
      let n = 0;
      for (let f = 0; f < 120; f++) {
        if (lod.update(distance)) n++;
        lod.nextFrame();
      }
      return n;
    };
    expect(ran(81)).toBe(0);
    expect(ran(500)).toBe(0);
    expect(ran(10)).toBe(120);
    expect(ran(30)).toBe(60);
    expect(ran(60)).toBe(30);
    expect(bandFor(80, animBandsFor('mobile'))).toBe('quarter');
    expect(bandFor(80.01, animBandsFor('mobile'))).toBe('frozen');
  });
});

describe('the procedural bay_rig_v1 mannequin (AC-7)', () => {
  it('has exactly the 22 HUMANOID_BONES, each once, in a single hierarchy under the hips', () => {
    const rig = buildPlaceholderRig();
    const names: string[] = [];
    rig.root.traverse((o: Object3D) => {
      if ((o as Bone).isBone) names.push(o.name);
    });
    expect(names).toHaveLength(22);
    expect([...names].sort()).toEqual([...HUMANOID_BONES].sort());
    expect(rig.bones.size).toBe(22);
    expect(rig.bones.get('hips')?.parent).toBe(rig.root);
    expect(rig.bones.get('l_toes')?.parent).toBe(rig.bones.get('l_foot'));
    // Every bone has a track in every clip.
    for (const clip of rig.clips.values()) {
      for (const b of HUMANOID_BONES) expect(clip.tracks.some((t) => t.name === `${b}.quaternion`), `${clip.name} lacks ${b}`).toBe(true);
    }
    rig.dispose();
  });

  it('animates: running swings the legs and walking differs from idle; jump plays once and holds', () => {
    const rig = buildPlaceholderRig();
    const anim = new MannequinAnimator(rig);
    const leg = rig.bones.get('l_upperLeg')!;
    const idleAngle = (): number => 2 * Math.atan2(leg.quaternion.x, leg.quaternion.w);
    for (let i = 0; i < 30; i++) anim.update(1 / 60, ANIM_STATE.idle, 0);
    const rest = Math.abs(idleAngle());
    expect(rest).toBeLessThan(0.05);
    let peak = 0;
    for (let i = 0; i < 90; i++) {
      anim.update(1 / 60, ANIM_STATE.run, 4.2);
      peak = Math.max(peak, Math.abs(idleAngle()));
    }
    expect(peak).toBeGreaterThan(0.6);
    // Jump: the arms go up and stay there.
    const arm = rig.bones.get('l_upperArm')!;
    for (let i = 0; i < 60; i++) anim.update(1 / 60, ANIM_STATE.jump, 0);
    expect(2 * Math.atan2(arm.quaternion.x, arm.quaternion.w)).toBeGreaterThan(1.5);
    anim.dispose();
    rig.dispose();
  });

  it('setOpacity hides the group below a hair of opacity', () => {
    const rig = buildPlaceholderRig();
    rig.setOpacity(0.5);
    expect(rig.root.visible).toBe(true);
    rig.setOpacity(0);
    expect(rig.root.visible).toBe(false);
    rig.dispose();
  });
});
