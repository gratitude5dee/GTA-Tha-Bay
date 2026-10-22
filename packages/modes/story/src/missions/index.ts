/**
 * The places of the story world (M05c1): safehouses and shops. `StoryPlaces` looks at where the player stands a few times a second and
 *  - sets `hud.safehouse` while the player is inside an owned safehouse (the Pause menu then enables Save), remembers the respawn place in
 *    `StorySlice.position.safehouse`, and takes the `safehouse.sleep` and `safehouse.save` commands there;
 *  - opens the shop whose door the player stands at (`mode.story.shop`, the HUD draws it like the talk panel) and takes `shop.buy`;
 *  - puts a blip on the map for each shop and each owned safehouse.
 * Commands arrive as `UiCommand mode.cmd {mode: 'story'}` through the story controller. Sim code under the C02 lint.
 */
import type { JsonValue, ModeContext, StorySlice } from '@dv/shared';
import { Actors } from '../vm/actors.ts';
import { SAFEHOUSES, ownedSafehouses, safehouseAt, type SafehouseDef } from './safehouse.ts';
import { SHOPS, ShopService, shopDef, type ShopPorts, type ShopRefusal } from './shops.ts';

export { SAFEHOUSES, SHOPS, ShopService };
export * from './safehouse.ts';
export * from './shops.ts';
export { newGarageCar, carIdOf } from './garage-car.ts';

const EVERY = 15;
const SLEEP_WAKE_HOUR = 7;

type Xz = [number, number];

export class StoryPlaces {
  private readonly pos = new Map<string, Xz>();
  private hudSafehouse: boolean | null = null;
  private openShop: string | null = null;
  private dismissed: string | null = null;
  private shopJson = '';
  private blips = new Set<string>();
  private service: ShopService | null = null;

  constructor(private readonly get: { ctx(): ModeContext; story(): StorySlice; ports(ctx: ModeContext): Omit<ShopPorts, 'economy' | 'story'> }) {}

  private shops(ctx: ModeContext): ShopService {
    this.service ??= new ShopService({ economy: ctx.economy, story: () => this.get.story(), ...this.get.ports(ctx) });
    return this.service;
  }

  private xz(ctx: ModeContext, id: string, lat: number, lng: number): Xz {
    let p = this.pos.get(id);
    if (!p) {
      const e = ctx.world.resolver.toEnu({ lat, lng });
      p = [e[0], e[2]];
      this.pos.set(id, p);
    }
    return p;
  }

  /** Forget the cached door positions and open panels (a new world). */
  reset(): void {
    this.pos.clear();
    this.hudSafehouse = null;
    this.openShop = null;
    this.dismissed = null;
    this.shopJson = '';
    this.blips.clear();
    this.service = null;
  }

  tick(ctx: ModeContext): void {
    if (ctx.tick % EVERY !== 3) return;
    const story = this.get.story();
    const player = new Actors(() => ctx, () => '').pos('player');
    this.syncBlips(ctx, story);
    if (!player) return;
    const px = player[0];
    const pz = player[2];

    const owned = ownedSafehouses(story).map((def) => {
      const [x, z] = this.xz(ctx, def.id, def.lat, def.lng);
      return { def, x, z };
    });
    const here = safehouseAt(owned, px, pz);
    if (this.hudSafehouse !== (here !== null)) {
      this.hudSafehouse = here !== null;
      ctx.ui.patch('hud.safehouse', here !== null);
    }
    if (here && story.position.safehouse !== here.id) story.position.safehouse = here.id;

    let inShop: string | null = null;
    for (const s of SHOPS) {
      const [x, z] = this.xz(ctx, s.id, s.lat, s.lng);
      if ((px - x) * (px - x) + (pz - z) * (pz - z) <= s.r * s.r) {
        inShop = s.id;
        break;
      }
    }
    if (inShop !== this.dismissed) this.dismissed = null;
    this.publishShop(ctx, inShop !== null && inShop !== this.dismissed ? inShop : null);
  }

  private publishShop(ctx: ModeContext, id: string | null): void {
    let json = '';
    let value: JsonValue = null;
    if (id) {
      const def = shopDef(id);
      if (def) {
        value = { id, title: def.titleKey, cash: ctx.economy.balance(), items: this.shops(ctx).view(id) } as unknown as JsonValue;
        json = JSON.stringify(value);
      }
    }
    this.openShop = id;
    if (json !== this.shopJson) {
      this.shopJson = json;
      ctx.ui.patch('mode.story.shop', value);
    }
  }

  private syncBlips(ctx: ModeContext, story: StorySlice): void {
    const want = new Map<string, { x: number; z: number; kind: 'shop' | 'property'; shape: 'bag' | 'house'; labelKey: string }>();
    for (const s of SHOPS) {
      const [x, z] = this.xz(ctx, s.id, s.lat, s.lng);
      want.set(`story:${s.id}`, { x, z, kind: 'shop', shape: 'bag', labelKey: s.titleKey });
    }
    for (const sh of SAFEHOUSES) {
      if (!story.property.safehouses.includes(sh.id)) continue;
      const [x, z] = this.xz(ctx, sh.id, sh.lat, sh.lng);
      want.set(`story:${sh.id}`, { x, z, kind: 'property', shape: 'house', labelKey: sh.titleKey });
    }
    try {
      for (const [id, b] of want) {
        if (this.blips.has(id)) continue;
        ctx.world.map.setBlip({ id, kind: b.kind, shape: b.shape, colorToken: b.kind, x: b.x, z: b.z, priority: 4, labelKey: b.labelKey });
        this.blips.add(id);
      }
    } catch {
      // a world without a map layer
    }
  }

  /** `shop.buy {shop, item, key, vehicle?}`, `shop.close`, `safehouse.sleep`, `safehouse.save`. True when the name was one of these. */
  command(ctx: ModeContext, name: string, a: Record<string, unknown>): boolean {
    switch (name) {
      case 'shop.close':
        this.dismissed = this.openShop;
        this.publishShop(ctx, null);
        return true;
      case 'shop.buy': {
        if (typeof a['shop'] !== 'string' || typeof a['item'] !== 'string' || typeof a['key'] !== 'string') return true;
        const vehicle = typeof a['vehicle'] === 'string' ? a['vehicle'] : this.currentVehicleKey(ctx);
        const res = this.shops(ctx).buy(a['shop'], a['item'], a['key'], vehicle);
        if (res.ok) ctx.ui.toast({ id: `shop:${a['key']}`, kind: 'info', text: 'shop.bought', params: { item: res.item.labelKey } });
        else ctx.ui.toast({ id: `shop:${a['key']}`, kind: 'warning', text: `shop.toast.${res.reason satisfies ShopRefusal}` });
        this.shopJson = '';
        this.publishShop(ctx, this.openShop);
        return true;
      }
      case 'safehouse.sleep': {
        const here = this.hereOwned(ctx);
        if (!here || !here.services.includes('sleep')) {
          ctx.ui.toast({ id: 'safehouse:sleep', kind: 'warning', text: 'safehouse.refuse.away' });
          return true;
        }
        ctx.clock.setHour(SLEEP_WAKE_HOUR);
        ctx.save.request('safehouse');
        ctx.ui.toast({ id: 'safehouse:sleep', kind: 'info', text: 'safehouse.slept' });
        return true;
      }
      case 'safehouse.save': {
        const here = this.hereOwned(ctx);
        if (!here || !here.services.includes('save')) {
          ctx.ui.toast({ id: 'safehouse:save', kind: 'warning', text: 'safehouse.refuse.away' });
          return true;
        }
        ctx.save.request('safehouse');
        return true;
      }
      default:
        return false;
    }
  }

  private hereOwned(ctx: ModeContext): SafehouseDef | null {
    const player = new Actors(() => ctx, () => '').pos('player');
    if (!player) return null;
    const owned = ownedSafehouses(this.get.story()).map((def) => {
      const [x, z] = this.xz(ctx, def.id, def.lat, def.lng);
      return { def, x, z };
    });
    return safehouseAt(owned, player[0], player[2]);
  }

  private currentVehicleKey(ctx: ModeContext): string | undefined {
    const actors = new Actors(() => ctx, () => '');
    const v = actors.playerVehicle();
    if (v === null) return undefined;
    const key = ctx.ecs.keyOf?.(v);
    return typeof key === 'string' ? key : undefined;
  }
}
