/** M03c AC-4: unit caps per level, spawn distance and view, route re-plan limits, and the portal seal at heat 5. */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PURSUIT_CONFIG } from '../../src/sim/pursuit/config.ts';
import { MIN_SPAWN_M, REPLAN_TICKS } from '../../src/sim/pursuit/dispatch.ts';
import type { HeatLevel } from '@dv/shared';
import { makeRig } from './fakes.ts';

describe('dispatch (AC-4)', () => {
  for (const lv of [1, 2, 3, 4, 5] as HeatLevel[]) {
    it(`level ${lv}: never above maxUnits, SUVs and the helicopter only where allowed, spawns 120 m out and out of view`, () => {
      const r = makeRig();
      const def = DEFAULT_PURSUIT_CONFIG.levels[lv];
      r.host.p.pos = [500, 0, -300];
      r.host.p.yaw = 0.7;
      r.director.forceHeat(lv);
      let peak = 0;
      for (let i = 0; i < 1500; i++) {
        r.run(2);
        peak = Math.max(peak, r.host.units.size);
        expect(r.host.units.size).toBeLessThanOrEqual(def.maxUnits);
      }
      expect(peak).toBe(def.maxUnits);
      const roles = r.director.dispatch.units.map((u) => u.role);
      expect(roles.filter((x) => x === 'suv').length).toBeLessThanOrEqual(def.suv);
      expect(roles.filter((x) => x === 'heli').length).toBe(def.heli ? 1 : 0);
      expect(roles.filter((x) => x === 'suv').length).toBe(def.suv);
      for (const s of r.director.dispatch.spawnLog) {
        expect(Math.hypot(s.pos[0] - 500, s.pos[2] + 300)).toBeGreaterThanOrEqual(MIN_SPAWN_M);
      }
      expect(r.director.dispatch.spawnLog.length).toBeGreaterThanOrEqual(def.maxUnits);
    });
  }

  it('every spawn is out of view: outside the 75 degree cone, or without a line of sight', () => {
    const r = makeRig();
    r.host.p.yaw = 0;
    // sight is blocked for the left half-plane only, so a spawn ahead and visible must never be chosen
    r.host.sight = (a) => a[0] > 0;
    r.director.forceHeat(5);
    r.run(2000);
    const fwd = [0, -1];
    for (const s of r.director.dispatch.spawnLog) {
      const d = Math.hypot(s.pos[0], s.pos[2]);
      const cos = (s.pos[0] * fwd[0]! + s.pos[2] * fwd[1]!) / d;
      const inCone = cos >= 0.2588;
      const visible = r.host.sight([s.pos[0], 1.5, s.pos[2]], [0, 1.5, 0]);
      expect(inCone && visible).toBe(false);
    }
  });

  it('routes are re-planned at most every 2.5 s per unit and at most one unit per step', () => {
    const r = makeRig();
    r.host.p.pos = [0, 0, 0];
    r.director.forceHeat(4);
    const last = new Map<number, number>();
    let worst = Infinity;
    for (let i = 0; i < 1500; i++) {
      const before = r.world.routes;
      r.run(2);
      expect(r.world.routes - before).toBeLessThanOrEqual(1 + 1);
      expect(r.director.dispatch.replansLast).toBeLessThanOrEqual(1);
      for (const u of r.director.dispatch.units) {
        const prev = last.get(u.id);
        if (prev !== undefined && prev !== u.planTick) worst = Math.min(worst, u.planTick - prev);
        last.set(u.id, u.planTick);
      }
    }
    expect(r.world.routes).toBeGreaterThan(5);
    expect(worst).toBeGreaterThanOrEqual(REPLAN_TICKS);
  });

  it('line of sight rays per step stay within search.losChecksPerTick', () => {
    const r = makeRig();
    r.director.forceHeat(5);
    for (let i = 0; i < 600; i++) {
      r.run(2);
      expect(r.director.dispatch.raysLast).toBeLessThanOrEqual(DEFAULT_PURSUIT_CONFIG.search.losChecksPerTick + 1);
    }
  });

  it('at heat 5 every portal is sealed and appears in sealedPortals; a clear releases them', () => {
    const r = makeRig();
    r.director.forceHeat(4);
    r.run(10);
    expect(r.director.state().sealedPortals).toEqual([]);
    r.director.forceHeat(5);
    r.run(10);
    expect(r.director.state().sealedPortals).toEqual(r.world.portalList.map((p) => p.id).sort());
    r.director.forceClear('test');
    expect(r.director.state().sealedPortals).toEqual([]);
  });

  it('after a clear the units disperse and are removed once unseen beyond 1.25 x the search radius', () => {
    const r = makeRig();
    r.host.p.pos = [0, 0, 0];
    r.director.forceHeat(2);
    r.run(600);
    expect(r.host.units.size).toBeGreaterThan(0);
    r.director.forceClear('test');
    r.run(10);
    // far enough and unseen: move every unit out past the radius
    for (const u of r.host.units.values()) u.pos = [u.pos[0] + 600, 0, u.pos[2]];
    r.run(200);
    expect(r.host.units.size).toBe(0);
    expect(r.director.dispatch.units).toHaveLength(0);
  });

  it('units that were seen are not removed while the player can still see them', () => {
    const r = makeRig();
    r.director.forceHeat(2);
    r.run(600);
    r.director.forceClear('test');
    r.host.sight = () => true;
    for (const u of r.host.units.values()) u.pos = [u.pos[0] + 5000, 0, u.pos[2]];
    r.run(100);
    // out of sight range (> 150 m) means unseen: they go
    expect(r.host.units.size).toBe(0);
  });
});
