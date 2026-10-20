/** M03c AC-5: roadblocks on the hinted edges or the predicted route, spikes only at choke points, and the tire that crosses one. */
import type { ChokePoint } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { driveToward, forwardOf } from '../../src/sim/pursuit/tactics/follow.ts';
import { planRoadblock } from '../../src/sim/pursuit/tactics/roadblock.ts';
import { crossedTires, planSpikes, tirePoint } from '../../src/sim/pursuit/tactics/spikes.ts';
import { boxInTarget } from '../../src/sim/pursuit/tactics/boxin.ts';
import { pitAllowed, pitTarget } from '../../src/sim/pursuit/tactics/pit.ts';
import { heliOrbit, heliSees, heliStep } from '../../src/sim/pursuit/tactics/heli.ts';
import type { PlayerView, UnitView } from '../../src/sim/pursuit/ports.ts';
import { FakeHost, FakeWorld, makeRig } from './fakes.ts';

const player = (over: Partial<PlayerView> = {}): PlayerView => ({ pos: [0, 0, 0], vel: [0, 0, -20], speed: 20, yaw: 0, onFoot: false, vehicleKey: 'veh:p', grappled: false, ...over });
const unit = (pos: [number, number, number], yaw = 0, speed = 0): UnitView => ({ id: 1, role: 'cruiser', pos, yaw, speed, vel: [0, 0, 0], ready: true, tires: [1, 1, 1, 1] });

/** A unit 60 m behind the player with a clear ray keeps the player in sight, so the tactics that need a known heading are used. */
function watched(r: ReturnType<typeof makeRig>): void {
  r.host.sight = () => true;
  r.run(300);
  const u = [...r.host.units.values()].find((x) => x.role !== 'heli');
  if (u) u.pos = [0, 0, 60];
  const keep = (): void => {
    const g = [...r.host.units.values()].find((x) => x.role !== 'heli');
    if (g) g.pos = [0, 0, 60];
  };
  const run = r.run.bind(r);
  r.run = (n: number): number => {
    let end = r.tick + n;
    while (r.tick < end) {
      keep();
      run(2);
    }
    return r.tick;
  };
}

describe('roadblocks (AC-5)', () => {
  it('with a route hint the block lies on a hinted edge ahead of the player', () => {
    const w = new FakeWorld();
    const behind = w.segment([-20, 400], [20, 400]);
    const tooNear = w.segment([-10, -30], [10, -30]);
    const ahead = w.segment([-20, -200], [20, -200]);
    const hinted = planRoadblock(w, player(), 'roadblock2', [behind, tooNear, ahead]);
    expect(hinted?.edge).toBe(ahead);
    expect(hinted?.pos[2]).toBeCloseTo(-200, 3);
    expect(hinted?.unitSlots).toHaveLength(2);
    expect(hinted?.barriers.length).toBe(5);
    expect(planRoadblock(w, player(), 'roadblockHeavy', [behind])).toBeNull();
    expect(planRoadblock(w, player(), 'roadblockHeavy', [ahead])?.barriers.length).toBe(7);
  });

  it('without a hint the block lies on the predicted A* route, ahead of the player', () => {
    const w = new FakeWorld();
    const e1 = w.segment([0, -5], [0, -90]);
    const e2 = w.segment([0, -90], [0, -330]);
    const e3 = w.segment([0, -330], [0, -690]);
    w.fixedRoute = { edges: [e1, e2, e3], points: [] };
    const spec = planRoadblock(w, player(), 'roadblock2', null);
    expect(spec).not.toBeNull();
    expect(spec?.edge).toBe(e2);
    const ahead = (spec?.pos[2] ?? 0) < -90;
    expect(ahead).toBe(true);
  });

  it('the director places a block on the hinted edge and holds two units there; the hint can be unset', () => {
    const r = makeRig();
    const ahead = r.world.segment([-20, -200], [20, -200]);
    r.host.p.pos = [0, 0, 0];
    r.host.p.speed = 20;
    r.host.p.vel = [0, 0, -20];
    r.director.setRouteHint([ahead]);
    r.director.forceHeat(4);
    watched(r);
    r.run(2400);
    expect(r.director.dispatch.activeBlocks.length).toBeGreaterThanOrEqual(1);
    for (const b of r.director.dispatch.activeBlocks) expect(b.edge).toBe(ahead);
    const barriers = [...r.host.props.values()].filter((p) => p.prefab === 'prop.barrier');
    expect(barriers.length).toBeGreaterThan(0);
    r.director.setRouteHint(null);
  });
});

describe('spike strips (AC-5)', () => {
  const choke = (id: string, x: number, z: number, edge = 1): ChokePoint => ({ id, x, y: 0, z, edge, widthM: 8, kind: 'bridge' });

  it('appear only at choke points ahead of the player; none without a tag', () => {
    const w = new FakeWorld();
    expect(planSpikes(w, player(), null, new Set())).toBeNull();
    w.chokes = [choke('behind', 0, 300), choke('ahead', 10, -260), choke('near', 0, -40)];
    const s = planSpikes(w, player(), null, new Set());
    expect(s?.tag).toBe('ahead');
    expect(s?.halfAcrossM).toBeGreaterThanOrEqual(3.2);
    expect(planSpikes(w, player(), null, new Set(['ahead']))).toBeNull();
  });

  it('prefers a choke point on the predicted route', () => {
    const w = new FakeWorld();
    w.chokes = [choke('off', -10, -200, 5), choke('on', 30, -300, 9)];
    expect(planSpikes(w, player(), [9], new Set())?.tag).toBe('on');
    expect(planSpikes(w, player(), [5], new Set())?.tag).toBe('off');
  });

  it('a tire on the strip is crossed; one beside it is not', () => {
    const strip = { tag: 'a', pos: [0, 0, -260] as [number, number, number], yaw: 0, halfAcrossM: 4 };
    // the front-left tire of a car whose centre is 1.33 m behind the strip is on it
    const v = { id: 5, key: 'veh:x', pos: [0.81, 0, -258.67] as [number, number, number], yaw: 0, speed: 20, police: false };
    expect(crossedTires(strip, v).length).toBeGreaterThan(0);
    expect(crossedTires(strip, { ...v, pos: [0, 0, -300] })).toEqual([]);
    expect(crossedTires(strip, { ...v, pos: [20, 0, -258.67] })).toEqual([]);
    const [x, z] = tirePoint(v, 0);
    expect(Math.hypot(x - 0, z + 260)).toBeLessThan(0.1);
  });

  it('the director sets the health of a crossed tire to 0 once, ignoring police cars', () => {
    const r = makeRig();
    r.world.chokes = [choke('c1', 0, -250)];
    r.host.p.pos = [0, 0, 0];
    r.host.p.speed = 20;
    r.host.p.vel = [0, 0, -20];
    r.director.forceHeat(4);
    watched(r);
    r.run(3000);
    const strips = r.director.dispatch.activeStrips;
    expect(strips.length).toBe(1);
    const at = strips[0]?.pos ?? [0, 0, 0];
    r.host.vehicles = [
      { id: 91, key: 'veh:a', pos: [at[0], 0, at[2]], yaw: 0, speed: 15, police: false },
      { id: 92, key: 'veh:pol', pos: [at[0], 0, at[2]], yaw: 0, speed: 15, police: true },
    ];
    r.run(4);
    r.run(4);
    const hit = r.host.tires.filter((t) => t.vehicle === 91);
    expect(hit.length).toBeGreaterThan(0);
    expect(hit.every((t) => t.health === 0)).toBe(true);
    expect(r.host.tires.some((t) => t.vehicle === 92)).toBe(false);
    const n = r.host.tires.length;
    r.run(10);
    expect(r.host.tires.length).toBe(n);
  });
});

describe('steering targets', () => {
  it('driveToward steers toward the target and brakes when too fast', () => {
    const out = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    // facing -Z; the target is to the right (+X) and ahead
    driveToward(unit([0, 0, 0], 0, 5), { x: 20, z: -20, speed: 20 }, out);
    expect(out.steer).toBeGreaterThan(0);
    expect(out.throttle).toBeGreaterThan(0);
    driveToward(unit([0, 0, 0], 0, 30), { x: -20, z: -20, speed: 10 }, out);
    expect(out.steer).toBeLessThan(0);
    expect(out.brake).toBeGreaterThan(0);
    const [fx, fz] = forwardOf(-Math.PI / 2);
    expect(fx).toBeCloseTo(1, 6);
    expect(fz).toBeCloseTo(0, 6);
  });

  it('PIT aims at the rear quarter on the side of the unit and only in its speed band', () => {
    expect(pitAllowed(player({ speed: 4 }))).toBe(false);
    expect(pitAllowed(player({ speed: 20 }))).toBe(true);
    expect(pitAllowed(player({ speed: 40 }))).toBe(false);
    const t = pitTarget(unit([6, 0, 10]), player());
    expect(t.x).toBeGreaterThan(0);
    expect(t.z).toBeGreaterThan(0);
  });

  it('box-in slots are in front and at both sides, and the target speed falls once held', () => {
    const p = player();
    const front = boxInTarget(unit([0, 0, -9]), p, 0, 0);
    expect(front.z).toBeLessThan(0);
    const left = boxInTarget(unit([-3.4, 0, -0.5]), p, 1, 0);
    const right = boxInTarget(unit([3.4, 0, -0.5]), p, 2, 0);
    expect(left.x).toBeLessThan(0);
    expect(right.x).toBeGreaterThan(0);
    const held = boxInTarget(unit([0, 0, -9]), p, 0, 360);
    expect(held.speed).toBeLessThan(front.speed);
  });

  it('the helicopter orbits at altitude and sees only with a clear ray', () => {
    const o = heliOrbit(0, [0, 0, 0], 3);
    expect(o[1]).toBe(58);
    const h = heliStep({ pos: [100, 58, 0], yaw: 0 }, o, [0, 0, 0], 2);
    expect(Math.hypot(h.pos[0] - 100, h.pos[2])).toBeLessThanOrEqual(42 * (2 / 60) + 1e-6);
    const host = new FakeHost();
    host.sight = () => true;
    expect(heliSees(host, [10, 58, 10], player())).toBe(true);
    expect(heliSees(host, [900, 58, 10], player())).toBe(false);
    host.sight = () => false;
    expect(heliSees(host, [10, 58, 10], player())).toBe(false);
  });
});
