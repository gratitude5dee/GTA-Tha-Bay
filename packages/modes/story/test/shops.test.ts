/**
 * M05c1 AC-7: the Act 1 shops and safehouses. Money moves through the real `EconomyImpl` with idempotency keys: a respray paid twice with
 * one key debits once, a car the wallet cannot cover is refused and changes nothing. m.a1.01 registers `sh.yard` (save point, respawn,
 * sleep) and puts the tow truck in the garage through the optional `ctx.garage` port.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { enuFromLatLng, type MissionIR, type VehicleInstance } from '@dv/shared';
import { Transform, Vehicle, VehicleDamage, Velocity } from '@dv/engine/sim';
import { describe, expect, it } from 'vitest';
import {
  COMPACT_PRICE_CENTS, MISSION_FLAT_PRICE_CENTS, RESPRAY_PRICE_CENTS, SAFEHOUSES, SHOPS, ShopService, StoryPlaces, newGarageCar, offers, safehouseDef, type ShopPorts,
} from '../src/missions/index.ts';
import { makeHarness } from './harness.ts';

const root = path.resolve(import.meta.dirname, '../../../..');
const load = (id: string): MissionIR => JSON.parse(readFileSync(path.join(root, 'assets/src/data', `mission.${id}`, 'mission.json'), 'utf8')) as MissionIR;

function shopRig(cashCents: number, opts: { garage?: VehicleInstance[]; slots?: number } = {}) {
  const h = makeHarness();
  h.story.wallet.cashCents = cashCents;
  const cars: VehicleInstance[] = opts.garage ?? [];
  const wardrobe = new Set<string>();
  const recolored: [string, number][] = [];
  const resprayed: string[] = [];
  const ports: ShopPorts = {
    economy: h.economy,
    story: () => h.story,
    garage: {
      add: (i) => (cars.some((c) => c.id === i.id) ? false : (cars.push(i), true)),
      count: () => cars.length,
      slots: () => opts.slots ?? 4,
      recolor: (k, hue) => (recolored.push([k, hue]), true),
    },
    respray: (k) => void resprayed.push(k),
    wardrobe: { has: (id) => wardrobe.has(id), add: (id) => void wardrobe.add(id) },
  };
  return { h, shop: new ShopService(ports), cars, wardrobe, recolored, resprayed };
}

describe('the shop table', () => {
  it('has the body shop, the clothing shop, the car lot and the property desk with the spec prices', () => {
    expect(SHOPS.map((s) => s.id)).toEqual(['shop.bodyshop', 'shop.clothing', 'shop.carlot', 'shop.property']);
    expect(RESPRAY_PRICE_CENTS).toBe(50_000);
    expect(COMPACT_PRICE_CENTS).toBe(800_000);
    expect(MISSION_FLAT_PRICE_CENTS).toBe(800_000);
    const lot = SHOPS.find((s) => s.id === 'shop.carlot');
    expect(lot?.items.map((i) => [i.id, i.priceCents])).toEqual([['compact', 800_000], ['sedan', 1_400_000]]);
    expect(SAFEHOUSES.map((s) => s.id)).toEqual(['sh.yard', 'sh.mission_flat']);
  });
});

describe('wallet of $600 (AC-7)', () => {
  it('a respray with the same key twice debits once; the compact car is refused for funds and nothing changes', () => {
    const { h, shop, recolored, resprayed, cars } = shopRig(60_000);
    const first = shop.buy('shop.bodyshop', 'respray', 'k1', 'veh:abc');
    const again = shop.buy('shop.bodyshop', 'respray', 'k1', 'veh:abc');
    expect(first).toMatchObject({ ok: true, cents: 50_000 });
    expect(again).toEqual(first);
    expect(h.story.wallet.cashCents).toBe(10_000);
    expect(h.economy.ledgerSince(0).filter((e) => e.cents < 0)).toHaveLength(1);
    expect(recolored).toHaveLength(1);
    expect(resprayed).toEqual(['veh:abc']);

    const car = shop.buy('shop.carlot', 'compact', 'k2');
    expect(car).toEqual({ ok: false, reason: 'funds' });
    expect(h.story.wallet.cashCents).toBe(10_000);
    expect(cars).toHaveLength(0);
  });

  it('a respray needs the car; a second respray with a new key pays again', () => {
    const { h, shop } = shopRig(120_000);
    expect(shop.buy('shop.bodyshop', 'respray', 'k1')).toEqual({ ok: false, reason: 'noVehicle' });
    expect(shop.buy('shop.bodyshop', 'respray', 'k1', 'veh:abc').ok).toBe(true);
    expect(shop.buy('shop.bodyshop', 'respray', 'k2', 'veh:abc').ok).toBe(true);
    expect(h.story.wallet.cashCents).toBe(20_000);
    expect(shop.buy('shop.nowhere', 'x', 'k3')).toEqual({ ok: false, reason: 'unknown' });
  });

  it('the view lists what can be bought now and why not', () => {
    const { shop } = shopRig(60_000);
    const view = shop.view('shop.carlot');
    expect(view.map((v) => [v.id, v.enabled, v.hint])).toEqual([['compact', false, 'shop.refuse.funds'], ['sedan', false, 'shop.refuse.funds']]);
    expect(view[0]?.hintParams).toEqual({ cents: 800_000 });
    expect(shop.view('shop.bodyshop')[0]?.enabled).toBe(true);
  });
});

describe('the car lot, the clothing shop and the flat', () => {
  it('buys a compact car into a free slot, with a stable id for the key; a full garage refuses', () => {
    const { h, shop, cars } = shopRig(2_000_000, { slots: 1 });
    const r = shop.buy('shop.carlot', 'compact', 'lot1');
    expect(r.ok).toBe(true);
    expect(cars).toHaveLength(1);
    expect(cars[0]).toMatchObject({ defId: 'vehicle.compact', source: 'bought' });
    expect(cars[0]?.id).toBe(newGarageCar({ defId: 'vehicle.compact', seed: 'lot:vehicle.compact:lot1', source: 'bought' }).id);
    expect(h.story.wallet.cashCents).toBe(1_200_000);
    expect(shop.buy('shop.carlot', 'sedan', 'lot2')).toEqual({ ok: false, reason: 'slots' });
    expect(h.story.wallet.cashCents).toBe(1_200_000);
  });

  it('clothing is bought once', () => {
    const { shop, wardrobe, h } = shopRig(10_000);
    expect(shop.buy('shop.clothing', 'hoodie', 'c1').ok).toBe(true);
    expect([...wardrobe]).toEqual(['wardrobe.hoodie-fog']);
    expect(shop.buy('shop.clothing', 'hoodie', 'c2')).toEqual({ ok: false, reason: 'owned' });
    expect(h.story.wallet.cashCents).toBe(4_000);
  });

  it('sh.mission_flat is for sale only after m.a1.06 and is owned once', () => {
    const { h, shop } = shopRig(2_000_000);
    expect(shop.buy('shop.property', 'mission_flat', 'p1')).toEqual({ ok: false, reason: 'locked' });
    h.story.missions['m.a1.06'] = { state: 'passed' };
    expect(shop.buy('shop.property', 'mission_flat', 'p1').ok).toBe(true);
    expect(h.story.property.safehouses).toEqual(['sh.mission_flat']);
    expect(h.story.wallet.cashCents).toBe(1_200_000);
    expect(shop.buy('shop.property', 'mission_flat', 'p2')).toEqual({ ok: false, reason: 'owned' });
  });
});

describe('sh.yard after m.a1.01', () => {
  it('the pass registers the Yard and puts the tow truck in the garage; the Yard offers save, respawn and sleep', () => {
    const h = makeHarness({ flags: { beats: 'instant' } });
    for (const id of ['vehicle.pickup', 'vehicle.truck', 'vehicle.van', 'vehicle.sedan']) {
      h.ecs.definePrefab({ id, components: [{ def: Transform, init: { qw: 1 } }, { def: Velocity }, { def: Vehicle }, { def: VehicleDamage, init: { body: 1, engine: 1 } }] });
    }
    const cars: VehicleInstance[] = [];
    (h.ctx as unknown as { garage: unknown }).garage = { add: (i: VehicleInstance) => (cars.push(i), true), count: () => cars.length, slots: () => 4, recolor: () => true };
    h.start(load('m.a1.01'));
    h.step(2);
    h.rt.command({ name: 'debug.pass' });
    h.step(3);
    expect(h.rt.phase).toBe('passed');
    expect(h.story.property.safehouses).toEqual(['sh.yard']);
    expect(cars.map((c) => [c.defId, c.source])).toEqual([['vehicle.pickup', 'reward']]);
    for (const s of ['save', 'respawn', 'sleep'] as const) expect(offers(h.story, 'sh.yard', s)).toBe(true);
    expect(safehouseDef('sh.yard')?.services).toContain('wardrobe');
    expect(offers(h.story, 'sh.mission_flat', 'save')).toBe(false);
  });

  it('standing in the Yard sets hud.safehouse, remembers the respawn place, and lets the player sleep and save', () => {
    const h = makeHarness();
    h.story.property.safehouses.push('sh.yard');
    let hour = -1;
    (h.ctx.clock as unknown as { setHour: (n: number) => void }).setHour = (n) => void (hour = n);
    const places = new StoryPlaces({ ctx: () => h.ctx, story: () => h.story, ports: () => ({}) });
    const yard = safehouseDef('sh.yard') as NonNullable<ReturnType<typeof safehouseDef>>;
    const p = enuFromLatLng(yard.lat, yard.lng);
    h.put(h.player, p.x + 3, p.z);
    h.tickNo.n = 3;
    places.tick(h.ctx);
    expect(h.vm.get('hud.safehouse')).toBe(true);
    expect(h.story.position.safehouse).toBe('sh.yard');
    expect(places.command(h.ctx, 'safehouse.sleep', {})).toBe(true);
    expect(hour).toBe(7);
    expect(h.calls.saves).toContain('safehouse');

    // away from home, sleeping is refused with a toast and the clock stays
    hour = -1;
    h.put(h.player, p.x + 5000, p.z);
    expect(places.command(h.ctx, 'safehouse.sleep', {})).toBe(true);
    expect(hour).toBe(-1);
    expect(h.calls.toasts.at(-1)?.text).toBe('safehouse.refuse.away');
    h.tickNo.n = 18;
    places.tick(h.ctx);
    expect(h.vm.get('hud.safehouse')).toBe(false);
  });

  it('standing at a shop door opens it; shop.buy pays through the wallet; shop.close hides it until the player leaves', () => {
    const h = makeHarness();
    h.story.wallet.cashCents = 60_000;
    const places = new StoryPlaces({ ctx: () => h.ctx, story: () => h.story, ports: () => ({}) });
    const body = SHOPS[0] as NonNullable<(typeof SHOPS)[0]>;
    const p = enuFromLatLng(body.lat, body.lng);
    h.put(h.player, p.x, p.z);
    h.tickNo.n = 3;
    places.tick(h.ctx);
    expect(h.vm.get('mode.story.shop')).toMatchObject({ id: 'shop.bodyshop', cash: 60_000 });
    places.command(h.ctx, 'shop.buy', { shop: 'shop.bodyshop', item: 'respray', key: 'ui1', vehicle: 'veh:abc' });
    expect(h.story.wallet.cashCents).toBe(10_000);
    expect(h.vm.get('mode.story.shop')).toMatchObject({ cash: 10_000 });
    places.command(h.ctx, 'shop.close', {});
    expect(h.vm.get('mode.story.shop')).toBeNull();
    h.tickNo.n = 18;
    places.tick(h.ctx);
    expect(h.vm.get('mode.story.shop')).toBeNull();
    h.put(h.player, p.x + 4000, p.z);
    h.tickNo.n = 33;
    places.tick(h.ctx);
    h.put(h.player, p.x, p.z);
    h.tickNo.n = 48;
    places.tick(h.ctx);
    expect(h.vm.get('mode.story.shop')).toMatchObject({ id: 'shop.bodyshop' });
  });
});
