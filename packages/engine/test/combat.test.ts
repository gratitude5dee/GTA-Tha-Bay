import { describe, expect, it } from 'vitest';
import type { EcsApi, EntityHandle, InputFrame } from '@dv/shared';
import { Control, EcsWorld, Health, LocalPlayer, Transform } from '../src/sim/index.ts';
import { CombatImpl, type HitEvent } from '../src/sim/combat/combat.ts';
import { KO_TICKS, MOVES } from '../src/sim/combat/moves.ts';
import { CONTROL_OWNER } from '../src/sim/control/states.ts';
import { UNIT_PREFAB } from './helpers.ts';

/** AC-6: the melee stub. The attacker stands at the origin facing -Z (yaw 0); the target stands 1.5 m ahead. */
function rig(opts: { player?: boolean; targetZ?: number } = {}) {
  const w = new EcsWorld();
  w.definePrefab(UNIT_PREFAB);
  w.definePrefab({ id: 'fighter', components: [{ def: Transform }, { def: Health, init: { hp: 100, max: 100 } }, { def: Control }, { def: LocalPlayer }] });
  const a = w.commands.spawn(opts.player ? 'fighter' : 'unit', {}, opts.player ? 'player:0' : 'npc:attacker');
  const t = w.commands.spawn('unit', { 'Transform.pz': opts.targetZ ?? -1.5 }, 'npc:target');
  w.flush();
  for (const h of [a, t]) {
    const id = w.resolve(h) as number;
    w.store(Transform).qw[id] = 1;
  }
  const state = { tick: 0, input: null as InputFrame | null };
  const reports: [string, [number, number, number]][] = [];
  const hits: HitEvent[] = [];
  const combat = new CombatImpl({
    ecs: w as unknown as EcsApi,
    tick: () => state.tick,
    input: () => state.input,
    report: (k, at) => void reports.push([k, at]),
  });
  combat.onHit((e) => void hits.push(e));
  const hp = (h: EntityHandle): number => w.store(Health).hp[w.resolve(h) as number] as number;
  const ko = (h: EntityHandle): number => w.store(Health).ko[w.resolve(h) as number] as number;
  const step = (n = 1): void => {
    for (let i = 0; i < n; i++) {
      combat.update();
      state.tick++;
    }
  };
  return { w, a, t, combat, state, reports, hits, hp, ko, step };
}

describe('engine/combat melee stub', () => {
  it('a jab damages the target at the first active tick, not before, and only once', () => {
    const r = rig();
    expect(r.combat.startMove(r.a, 'jab')).toBe(true);
    r.step(MOVES.jab.startup);
    expect(r.hp(r.t)).toBe(100);
    r.step(1);
    expect(r.hp(r.t)).toBe(100 - MOVES.jab.damage);
    r.step(MOVES.jab.active + MOVES.jab.recovery);
    expect(r.hp(r.t)).toBe(100 - MOVES.jab.damage);
    expect(r.hits.map((h) => h.move)).toEqual(['jab']);
    expect(r.combat.current(r.a)).toBeNull();
  });

  it('refuses a second move while one runs, an unknown move and a dead handle', () => {
    const r = rig();
    expect(r.combat.startMove(r.a, 'jab')).toBe(true);
    expect(r.combat.startMove(r.a, 'shove')).toBe(false);
    expect(r.combat.startMove(r.a, 'kick')).toBe(false);
    expect(r.combat.startMove(0 as EntityHandle, 'jab')).toBe(false);
  });

  it('a shove pushes the target along the attack heading', () => {
    const r = rig();
    r.combat.startMove(r.a, 'shove');
    r.step(MOVES.shove.startup + 1);
    const z = r.w.store(Transform).pz[r.w.resolve(r.t) as number] as number;
    expect(z).toBeCloseTo(-1.5 - MOVES.shove.pushM, 5);
    expect(r.hp(r.t)).toBe(100 - MOVES.shove.damage);
  });

  it('a takedown on an undamaged target does nothing; on a damaged target it sets ko without despawn', () => {
    const r = rig();
    r.combat.startMove(r.a, 'takedown');
    r.step(MOVES.takedown.startup + MOVES.takedown.active + MOVES.takedown.recovery);
    expect(r.hp(r.t)).toBe(100);
    expect(r.ko(r.t)).toBe(0);
    r.w.store(Health).hp[r.w.resolve(r.t) as number] = 60;
    r.combat.startMove(r.a, 'takedown');
    r.step(MOVES.takedown.startup + 1);
    expect(r.ko(r.t)).toBe(1);
    expect(r.w.resolve(r.t)).not.toBeNull();
    expect(r.hp(r.t)).toBe(60 - MOVES.takedown.damage);
    expect(r.hits[0]).toMatchObject({ move: 'takedown', ko: true });
  });

  it('a hit that would take a target to 0 leaves it at 1 hp, knocked out', () => {
    const r = rig();
    r.w.store(Health).hp[r.w.resolve(r.t) as number] = 5;
    r.combat.startMove(r.a, 'jab');
    r.step(MOVES.jab.startup + 1);
    expect(r.hp(r.t)).toBe(1);
    expect(r.ko(r.t)).toBe(1);
  });

  it('a knocked-out character wakes after KO_TICKS with a quarter of its health at least', () => {
    const r = rig();
    r.w.store(Health).hp[r.w.resolve(r.t) as number] = 5;
    r.combat.startMove(r.a, 'jab');
    r.step(MOVES.jab.startup + 1);
    const at = r.state.tick;
    r.state.tick = at + KO_TICKS - 1;
    r.step(1);
    expect(r.ko(r.t)).toBe(0);
    expect(r.hp(r.t)).toBe(25);
  });

  it('a target out of reach is not hit', () => {
    const r = rig({ targetZ: -4 });
    r.combat.startMove(r.a, 'jab');
    r.step(MOVES.jab.startup + MOVES.jab.active + MOVES.jab.recovery);
    expect(r.hp(r.t)).toBe(100);
  });

  it('each hit by the local player reports one assault infraction at the victim', () => {
    const r = rig({ player: true });
    r.combat.startMove(r.a, 'jab');
    r.step(MOVES.jab.startup + MOVES.jab.active);
    expect(r.reports).toHaveLength(1);
    expect(r.reports[0]?.[0]).toBe('assault');
    expect(r.reports[0]?.[1][2]).toBeCloseTo(-1.5 - MOVES.jab.pushM, 5);
    // the same jab never hits twice; a non-player attacker reports nothing
    const n = rig();
    n.combat.startMove(n.a, 'jab');
    n.step(MOVES.jab.startup + 1);
    expect(n.reports).toEqual([]);
  });

  it('the Attack button starts a jab on a healthy target and a takedown on a damaged one; a vehicle blocks it', () => {
    const r = rig({ player: true });
    const frame = (pressed: number, buttons = pressed): InputFrame => ({ tick: r.state.tick, buttons, pressed, released: 0, moveX: 0, moveY: 0, throttle: 0, brake: 0, steer: 0, camYaw: 0, camPitch: 0, context: 0, device: 7 });
    const ATTACK = 1 << 4;
    r.state.input = frame(ATTACK);
    r.step(1);
    expect(r.combat.current(r.a)).toMatchObject({ move: 'jab' });
    r.state.input = null;
    r.step(MOVES.jab.startup + MOVES.jab.active + MOVES.jab.recovery);
    expect(r.combat.current(r.a)).toBeNull();
    r.w.store(Health).hp[r.w.resolve(r.t) as number] = 50;
    r.state.input = frame(ATTACK);
    r.step(1);
    expect(r.combat.current(r.a)).toMatchObject({ move: 'takedown' });
    r.state.input = null;
    r.step(MOVES.takedown.startup + MOVES.takedown.active + MOVES.takedown.recovery);
    expect(r.ko(r.t)).toBe(1);
    // in a vehicle the button does not start a move
    r.w.store(Control).owner[r.w.resolve(r.a) as number] = CONTROL_OWNER.Vehicle;
    r.state.input = frame(ATTACK);
    r.step(1);
    expect(r.combat.current(r.a)).toBeNull();
  });
});
