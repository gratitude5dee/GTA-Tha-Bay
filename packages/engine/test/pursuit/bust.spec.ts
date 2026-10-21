/** M03c AC-6: the bust rule, the fine, the wallet and the impound strikes. */
import { describe, expect, it } from 'vitest';
import { fineCents } from '../../src/sim/pursuit/bust.ts';
import { DEFAULT_PURSUIT_CONFIG } from '../../src/sim/pursuit/config.ts';
import { makeRig, type Rig } from './fakes.ts';

/** A stopped player with two units next to the car. */
function surround(r: Rig): void {
  r.host.p.pos = [0, 0, 0];
  r.host.p.speed = 0;
  r.host.p.vel = [0, 0, 0];
  r.host.sight = () => true;
  r.run(300);
  const ground = [...r.host.units.values()].filter((u) => u.role !== 'heli').slice(0, 2);
  expect(ground.length).toBe(2);
  ground[0]!.pos = [3, 0, 0];
  ground[1]!.pos = [-4, 0, 2];
}

describe('bust (AC-6)', () => {
  it('the fine is max(25,000, 5 % cash + heat x 50,000)', () => {
    expect(fineCents(DEFAULT_PURSUIT_CONFIG, 1_000_000, 3)).toBe(50_000 + 150_000);
    expect(fineCents(DEFAULT_PURSUIT_CONFIG, 100, 0)).toBe(25_000);
    expect(fineCents(DEFAULT_PURSUIT_CONFIG, 0, 1)).toBe(50_000);
  });

  it('a stopped car with 2 units within 8 m for 180 ticks is busted, debited once, and takes a strike', () => {
    const r = makeRig();
    r.director.forceHeat(3);
    surround(r);
    expect(r.director.state().phase).not.toBe('busted');
    const before = r.wallet.balance;
    r.run(170);
    expect(r.director.state().phase).not.toBe('busted');
    r.run(14);
    expect(r.director.state().phase).toBe('busted');
    const fine = Math.max(25_000, Math.floor(before * 0.05) + 3 * 50_000);
    expect(r.wallet.balance).toBe(before - fine);
    expect(r.wallet.log).toHaveLength(1);
    expect(r.host.named('pursuit.busted')[0]?.n).toBe(fine);
    expect(r.director.vehicleHeat('veh:player0')).toBeGreaterThanOrEqual(0);
    // the bust shows for 3 s, then the pursuit resets
    r.run(200);
    expect(r.director.state().phase).toBe('clear');
    expect(r.director.state().level).toBe(0);
    expect(r.wallet.log).toHaveLength(1);
  });

  it('moving faster than 2 m/s or having one unit resets the timer', () => {
    const r = makeRig();
    r.director.forceHeat(3);
    surround(r);
    r.run(120);
    r.host.p.speed = 5;
    r.run(2);
    r.host.p.speed = 0;
    r.run(120);
    expect(r.director.state().phase).not.toBe('busted');
    const u = [...r.host.units.values()].filter((x) => x.role !== 'heli')[1];
    if (u) u.pos = [100, 0, 100];
    r.run(400);
    expect(r.director.state().phase).not.toBe('busted');
  });

  it('on foot, a grapple of 2 s busts', () => {
    const r = makeRig();
    r.director.forceHeat(2);
    r.host.p.onFoot = true;
    r.host.p.grappled = true;
    r.host.p.vehicleKey = null;
    r.run(100);
    expect(r.director.state().phase).not.toBe('busted');
    r.run(30);
    expect(r.director.state().phase).toBe('busted');
  });

  it('the third strike impounds the vehicle', () => {
    const r = makeRig();
    for (let n = 1; n <= 3; n++) {
      r.director.forceHeat(2);
      surround(r);
      r.run(200);
      expect(r.director.state().phase).toBe('busted');
      r.run(200);
      expect(r.director.state().phase).toBe('clear');
      expect(r.director.vheat.strikesOf('veh:player0')).toBe(n);
      expect(r.host.impounded.length).toBe(n === 3 ? 1 : 0);
      for (const u of [...r.host.units.keys()]) r.host.units.delete(u);
      r.director.dispatch.units.length = 0;
    }
    expect(r.director.vheat.isImpounded('veh:player0')).toBe(true);
    expect(r.host.named('pursuit.impounded')).toHaveLength(1);
  });

  it('a wallet that cannot pay the whole fine is emptied', () => {
    const r = makeRig();
    r.wallet.balance = 10_000;
    r.director.forceHeat(1);
    surround(r);
    r.run(200);
    expect(r.director.state().phase).toBe('busted');
    expect(r.wallet.balance).toBe(0);
  });
});
