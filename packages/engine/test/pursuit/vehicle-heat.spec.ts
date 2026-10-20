/** M03c AC-7: per-vehicle heat, respray, and switching cars. */
import { describe, expect, it } from 'vitest';
import { makeRig } from './fakes.ts';

const AT: [number, number, number] = [0, 0, 0];

describe('vehicle heat (AC-7)', () => {
  it('respray clears the car, not the player; switching cars keeps the old car hot', () => {
    const r = makeRig();
    r.host.p.vehicleKey = 'veh:a';
    r.director.step(2);
    r.director.report('assault', AT, 'police', 2);
    r.director.report('hitPoliceVehicle', AT, 'police');
    expect(r.director.vehicleHeat('veh:a')).toBe(160 + 60);
    const player = r.director.state().points;
    r.director.respray('veh:a');
    expect(r.director.vehicleHeat('veh:a')).toBe(0);
    expect(r.director.state().points).toBe(player);

    r.director.report('assault', AT, 'police');
    expect(r.director.vehicleHeat('veh:a')).toBe(80);
    r.host.p.vehicleKey = 'veh:b';
    r.run(2);
    r.director.report('redLightSeen', AT, 'police');
    expect(r.director.vehicleHeat('veh:b')).toBe(10);
    expect(r.director.vehicleHeat('veh:a')).toBe(80);
    expect(r.director.vehicleHeat('veh:nobody')).toBe(0);
  });
});
