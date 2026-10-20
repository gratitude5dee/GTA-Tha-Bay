/** M03c AC-2: infraction points, witness delays, thresholds, and the scripted-only rules. */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PURSUIT_CONFIG } from '../../src/sim/pursuit/config.ts';
import { makeRig } from './fakes.ts';

const AT: [number, number, number] = [10, 0, 10];

describe('heat (AC-2)', () => {
  it('a red light seen by police, a civilian hit seen by a robotaxi and a speeding second add the config values', () => {
    const r = makeRig();
    r.director.report('redLightSeen', AT, 'police');
    expect(r.director.state().points).toBe(DEFAULT_PURSUIT_CONFIG.infractionPoints.redLightSeen);
    r.director.report('speedingSeen', AT, 'police');
    expect(r.director.state().points).toBe(10 + 5);
    // the robotaxi report lands 120 ticks after the event
    const start = r.tick;
    r.director.report('hitCivilianVehicle', AT, 'robotaxi');
    r.run(118);
    expect(r.director.state().points).toBe(15);
    r.run(2);
    expect(r.tick - start).toBe(120);
    expect(r.director.state().points).toBe(15 + 20);
  });

  it('the level follows the thresholds 100 / 300 / 700 / 1500 / 3000', () => {
    const r = makeRig();
    const seq: [number, number][] = [[99, 0], [1, 1], [200, 2], [400, 3], [800, 4], [1500, 5]];
    let total = 0;
    for (const [add, lvl] of seq) {
      total += add;
      r.director.report('assault', AT, 'police', add / 80);
      expect(r.director.state().points).toBeCloseTo(total, 6);
      expect(r.director.state().level).toBe(lvl);
    }
  });

  it('a pedestrian report lands after 3 to 6 s drawn from stream pursuit, and only when pedReports is on', () => {
    const r = makeRig();
    r.director.report('assault', AT, 'ped');
    r.run(170);
    expect(r.director.state().points).toBe(0);
    r.run(200);
    expect(r.director.state().points).toBe(80);
    const off = makeRig({ ...DEFAULT_PURSUIT_CONFIG, witness: { ...DEFAULT_PURSUIT_CONFIG.witness, pedReports: false } });
    off.director.report('assault', AT, 'ped');
    off.run(600);
    expect(off.director.state().points).toBe(0);
  });

  it('setHeat(6) without scripted is refused; with scripted it works; capHeat and clear need scripted too', () => {
    const r = makeRig();
    r.director.setHeat(6, 'test');
    expect(r.director.state().level).toBe(0);
    expect(r.director.refusals.length).toBe(1);
    r.director.setHeat(4, 'test');
    expect(r.director.state().level).toBe(4);
    r.director.capHeat(2);
    r.director.clear('nope');
    expect(r.director.state().cap).toBe(5);
    expect(r.director.state().level).toBe(4);
    r.director.setScripted(true);
    r.director.setHeat(6, 'finale');
    expect(r.director.state().level).toBe(6);
    expect(r.director.state().scripted).toBe(true);
    r.director.clear('done');
    expect(r.director.state().level).toBe(0);
  });

  it('points never earn level 6, and the cap holds the level', () => {
    const r = makeRig();
    r.director.setScripted(true);
    r.director.capHeat(3);
    r.director.report('assault', AT, 'police', 100);
    expect(r.director.state().level).toBe(3);
    r.director.setScripted(false);
    r.director.forceHeat(5);
    expect(r.director.state().level).toBe(3);
  });

  it('points below the first level decay and the level never falls by itself', () => {
    const r = makeRig();
    r.director.report('redLightSeen', AT, 'police', 5);
    expect(r.director.state().points).toBe(50);
    r.run(500);
    expect(r.director.state().points).toBe(50);
    r.run(600);
    expect(r.director.state().points).toBeLessThan(50);
    expect(r.director.state().level).toBe(0);
  });

  it('setConfig replaces the thresholds of the running director (the QA hot reload)', () => {
    const r = makeRig();
    r.director.report('redLightSeen', AT, 'police', 6);
    expect(r.director.state().points).toBe(60);
    expect(r.director.state().level).toBe(0);
    const cfg = JSON.parse(JSON.stringify(DEFAULT_PURSUIT_CONFIG)) as typeof DEFAULT_PURSUIT_CONFIG;
    cfg.levels[1].points = 50;
    r.director.setConfig(cfg);
    r.director.report('redLightSeen', AT, 'police');
    expect(r.director.state().points).toBe(70);
    expect(r.director.state().level).toBe(1);
  });

  it('the profile caps the level for a race', () => {
    const r = makeRig();
    r.director.setProfile({ kind: 'race', startHeat: 1, maxHeat: 2, success: { kind: 'evade' } });
    expect(r.director.state().level).toBe(1);
    r.director.report('assault', AT, 'police', 100);
    expect(r.director.state().level).toBe(2);
  });
});
