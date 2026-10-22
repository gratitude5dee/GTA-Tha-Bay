/**
 * The Act 1 shops (M05c1; 03-story-narrative.md B7): a body shop in Dogpatch (a respray, $500), a clothing shop in D2, a car lot in D1
 * (compact $8,000, sedan $14,000) and the property agent for `sh.mission_flat` ($8,000 after m.a1.06). All money moves through
 * `EconomyApi` with an idempotency key the caller supplies, so a repeated command with the same key debits once; a purchase that the
 * wallet cannot cover is refused and changes nothing. The car lot also needs a free garage slot (the garage never refuses a reward car,
 * but a bought one waits for room). Sim code under the C02 lint.
 */
import type { EconomyApi, StorySlice } from '@dv/shared';
import { newGarageCar } from './garage-car.ts';
import { MISSION_FLAT_PRICE_CENTS } from './safehouse.ts';
import { hash32 } from '../vm/util.ts';

export type ShopId = 'shop.bodyshop' | 'shop.clothing' | 'shop.carlot' | 'shop.property';
export type ShopKind = 'respray' | 'clothing' | 'car' | 'property';

export interface ShopItem {
  id: string;
  kind: ShopKind;
  labelKey: string;
  priceCents: number;
  /** The prefab of a car, the safehouse id of a property, the wardrobe id of a garment. */
  ref: string;
}

export interface ShopDef {
  id: ShopId;
  titleKey: string;
  /** WGS84 of the door; the shop opens when the player stands within `r` metres. */
  lat: number;
  lng: number;
  r: number;
  items: readonly ShopItem[];
}

export const RESPRAY_PRICE_CENTS = 50_000;
export const COMPACT_PRICE_CENTS = 800_000;
export const SEDAN_PRICE_CENTS = 1_400_000;

export const SHOPS: readonly ShopDef[] = [
  {
    id: 'shop.bodyshop',
    titleKey: 'shop.bodyshop',
    lat: 37.7578,
    lng: -122.388,
    r: 14,
    items: [{ id: 'respray', kind: 'respray', labelKey: 'shop.item.respray', priceCents: RESPRAY_PRICE_CENTS, ref: '' }],
  },
  {
    id: 'shop.clothing',
    titleKey: 'shop.clothing',
    lat: 37.7527,
    lng: -122.4189,
    r: 14,
    items: [
      { id: 'tee', kind: 'clothing', labelKey: 'shop.item.tee', priceCents: 2_500, ref: 'wardrobe.tee-street' },
      { id: 'hoodie', kind: 'clothing', labelKey: 'shop.item.hoodie', priceCents: 6_000, ref: 'wardrobe.hoodie-fog' },
      { id: 'jacket', kind: 'clothing', labelKey: 'shop.item.jacket', priceCents: 18_000, ref: 'wardrobe.jacket-varsity' },
    ],
  },
  {
    id: 'shop.carlot',
    titleKey: 'shop.carlot',
    lat: 37.7708,
    lng: -122.4078,
    r: 14,
    items: [
      { id: 'compact', kind: 'car', labelKey: 'shop.item.compact', priceCents: COMPACT_PRICE_CENTS, ref: 'vehicle.compact' },
      { id: 'sedan', kind: 'car', labelKey: 'shop.item.sedan', priceCents: SEDAN_PRICE_CENTS, ref: 'vehicle.sedan' },
    ],
  },
  {
    id: 'shop.property',
    titleKey: 'shop.property',
    lat: 37.7545,
    lng: -122.4172,
    r: 14,
    items: [{ id: 'mission_flat', kind: 'property', labelKey: 'shop.item.mission_flat', priceCents: MISSION_FLAT_PRICE_CENTS, ref: 'sh.mission_flat' }],
  },
];

export const shopDef = (id: string): ShopDef | undefined => SHOPS.find((s) => s.id === id);

export type ShopRefusal = 'unknown' | 'funds' | 'slots' | 'locked' | 'owned' | 'noVehicle';
export type ShopResult = { ok: true; cents: number; item: ShopItem } | { ok: false; reason: ShopRefusal };

/** The engine pieces a purchase touches; every one except the wallet is optional (a headless run has none). */
export interface ShopPorts {
  economy: EconomyApi;
  story(): StorySlice;
  /** The garage: `add` lands a car, `count` and `slots` are for the slot check, `recolor` repaints an instance. */
  garage?: { add(i: ReturnType<typeof newGarageCar>): boolean; count(): number; slots(): number; recolor?(vehicleKey: string, hue: number): boolean } | null;
  /** The pursuit director's respray: clears the car's heat (C06 `PursuitApi.respray`). */
  respray?(vehicleKey: string): void;
  wardrobe?: { has(id: string): boolean; add(id: string): void } | null;
}

export class ShopService {
  constructor(private readonly p: ShopPorts) {}

  /** The items of a shop with whether each can be bought now and why not. */
  view(shopId: string): { id: string; labelKey: string; priceCents: number; enabled: boolean; hint?: string; hintParams?: Record<string, string | number> }[] {
    const shop = shopDef(shopId);
    if (!shop) return [];
    const cash = this.p.economy.balance();
    return shop.items.map((it) => {
      const refusal = this.check(it, cash);
      const row: { id: string; labelKey: string; priceCents: number; enabled: boolean; hint?: string; hintParams?: Record<string, string | number> } = {
        id: it.id,
        labelKey: it.labelKey,
        priceCents: it.priceCents,
        enabled: refusal === null,
      };
      if (refusal) {
        row.hint = `shop.refuse.${refusal}`;
        if (refusal === 'funds') row.hintParams = { cents: it.priceCents };
      }
      return row;
    });
  }

  private check(it: ShopItem, cash: number): ShopRefusal | null {
    const story = this.p.story();
    if (it.kind === 'property') {
      if (story.property.safehouses.includes(it.ref)) return 'owned';
      if (story.missions['m.a1.06']?.state !== 'passed') return 'locked';
    }
    if (it.kind === 'clothing' && this.p.wardrobe?.has(it.ref)) return 'owned';
    if (it.kind === 'car') {
      const g = this.p.garage;
      if (g && g.count() >= g.slots()) return 'slots';
    }
    if (cash < it.priceCents) return 'funds';
    return null;
  }

  /** Keys that paid, with their answer: a repeated key is answered again and delivers nothing twice. */
  private readonly done = new Map<string, ShopResult>();

  /** Buys `itemId` at `shopId`. `key` is the idempotency key; `vehicleKey` names the car to respray. */
  buy(shopId: string, itemId: string, key: string, vehicleKey?: string): ShopResult {
    const prior = this.done.get(key);
    if (prior) return prior;
    const shop = shopDef(shopId);
    const it = shop?.items.find((x) => x.id === itemId);
    if (!shop || !it) return { ok: false, reason: 'unknown' };
    if (it.kind === 'respray' && !vehicleKey) return { ok: false, reason: 'noVehicle' };
    const refusal = this.check(it, this.p.economy.balance());
    if (refusal) return { ok: false, reason: refusal };
    if (!this.p.economy.debit(it.priceCents, `shop:${shop.id}:${it.id}`, `shop:${key}`)) return { ok: false, reason: 'funds' };
    this.deliver(it, key, vehicleKey);
    const res: ShopResult = { ok: true, cents: it.priceCents, item: it };
    this.done.set(key, res);
    return res;
  }

  private deliver(it: ShopItem, key: string, vehicleKey?: string): void {
    const story = this.p.story();
    switch (it.kind) {
      case 'respray': {
        const hue = hash32(key, vehicleKey ?? '', 'hue') % 360;
        this.p.garage?.recolor?.(vehicleKey as string, hue);
        this.p.respray?.(vehicleKey as string);
        return;
      }
      case 'clothing':
        this.p.wardrobe?.add(it.ref);
        return;
      case 'car':
        this.p.garage?.add(newGarageCar({ defId: it.ref, seed: `lot:${it.ref}:${key}`, source: 'bought' }));
        return;
      case 'property':
        if (!story.property.safehouses.includes(it.ref)) story.property.safehouses.push(it.ref);
        return;
    }
  }
}
