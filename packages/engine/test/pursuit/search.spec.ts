/** M03c AC-3: the search circle, the cooldown and the clear. */
import { describe, expect, it } from 'vitest';
import { makeRig } from './fakes.ts';

describe('search and cooldown (AC-3)', () => {
  it('opens after 2 s at the last known position, grows at 5 m/s to 400 m, and fills only outside', () => {
    const r = makeRig();
    r.host.p.pos = [0, 0, 0];
    r.director.forceHeat(3);
    expect(r.director.state().phase).toBe('pursuit');
    // a unit stands 50 m away and sees the player: line of sight on
    r.run(4);
    const first = [...r.host.units.values()][0];
    expect(first).toBeDefined();
    if (first) first.pos = [50, 0, 0];
    r.host.sight = () => true;
    r.run(60);
    expect(r.director.state().phase).toBe('pursuit');
    const seenAt = r.director.state().lastKnown;
    expect(seenAt?.pos).toEqual([0, 0, 0]);
    // sight lost
    r.host.sight = () => false;
    // the units that exist hold: they are far; the player stands still at the last known position
    r.run(100);
    expect(r.director.state().phase).toBe('pursuit');
    r.run(30);
    const open = r.director.state();
    expect(open.phase).toBe('search');
    expect(open.lastKnown?.pos).toEqual([0, 0, 0]);
    expect(open.searchRadiusM).toBeLessThan(5);
    // standing inside the circle: no cooldown
    r.run(600);
    expect(r.director.state().phase).toBe('search');
    expect(r.director.state().cooldown).toBe(0);
    expect(r.director.state().searchRadiusM).toBeGreaterThan(45);
    // the radius reaches 400 m (80 s after opening) and no further; the player drives out at once
    r.host.p.pos = [4000, 0, 0];
    r.run(60);
    expect(r.director.state().phase).toBe('cooldown');
    expect(r.director.state().cooldown).toBeGreaterThan(0);
  });

  it('the radius stops at the level maximum', () => {
    const r = makeRig();
    r.director.forceHeat(3);
    r.run(130);
    r.run(60 * 100);
    expect(r.director.state().searchRadiusM).toBe(400);
  });

  it('a completed cooldown sets phase clear and level 0; a hiding spot doubles the rate', () => {
    const slow = makeRig();
    slow.director.forceHeat(3);
    slow.run(130);
    slow.host.p.pos = [4000, 0, 0];
    const t0 = slow.tick;
    let k = 0;
    while (slow.director.state().level > 0 && k++ < 10_000) slow.run(2);
    const normal = slow.tick - t0;
    expect(slow.director.state().phase).toBe('clear');
    expect(slow.director.state().level).toBe(0);
    expect(normal).toBeGreaterThanOrEqual(35 * 60 - 2);
    expect(normal).toBeLessThanOrEqual(35 * 60 + 4);

    const fast = makeRig();
    fast.world.hiding = [{ id: 'h1', x: 4000, y: 0, z: 0, radiusM: 20, kind: 'garage' }];
    fast.director.forceHeat(3);
    fast.run(130);
    fast.host.p.pos = [4000, 0, 0];
    const t1 = fast.tick;
    k = 0;
    while (fast.director.state().level > 0 && k++ < 10_000) fast.run(2);
    const hid = fast.tick - t1;
    expect(hid).toBeGreaterThanOrEqual(Math.floor((35 * 60) / 2) - 2);
    expect(hid).toBeLessThanOrEqual(Math.floor((35 * 60) / 2) + 4);
    expect(fast.host.named('pursuit.escaped')).toHaveLength(1);
  });

  it('a sighting returns to pursuit and resets the cooldown', () => {
    const r = makeRig();
    r.director.forceHeat(2);
    r.run(130);
    r.host.p.pos = [4000, 0, 0];
    r.run(300);
    expect(r.director.state().phase).toBe('cooldown');
    expect(r.director.state().cooldown).toBeGreaterThan(0);
    // a unit regains sight: any spawned unit within 150 m with a clear ray
    const u = [...r.host.units.values()][0];
    expect(u).toBeDefined();
    if (!u) return;
    u.pos = [4020, 0, 0];
    r.host.sight = () => true;
    r.run(10);
    expect(r.director.state().phase).toBe('pursuit');
    expect(r.director.state().cooldown).toBe(0);
  });
});
