/**
 * Garage frame (10-ui-pages.md section 2.10, M04b2): a grid of `core.garage` entries. The cards read a partial `VehicleInstance`
 * defensively (`key`, `prefab`, `class`, `nickname`, `plate`, `damage`, `vehicleHeat`, `impoundStrikes`) and ignore the rest. Call and
 * Set as favourite send `garage.call` / `garage.favorite` with the card's `vehicleKey`; since M05c1 the garage module (engine/sim/garage)
 * handles both and answers with a toast (DL-668 part 3). The mod shop and upgrades are M07b2.
 */
import { h } from 'preact';
import type { JsonValue, UiCommand } from '@dv/shared';
import { lk, t } from '../i18n/index.ts';
import { ScreenHost } from '../screen/dom-screen.tsx';
import type { ScreenDef, UiAction, Widget } from '../screen/types.ts';
import { useShell } from '../shell/context.tsx';
import type { PageProps } from '../shell/types.ts';

export const VEHICLE_CLASSES = ['D', 'C', 'B', 'A', 'S', 'R'] as const;
export type VehicleClass = (typeof VEHICLE_CLASSES)[number];

export interface GarageCard {
  key: string;
  /** Prefab id, shown when the instance has no nickname. */
  prefab: string;
  cls: VehicleClass | null;
  nickname: string;
  plate: string;
  /** 0..100 */
  damagePct: number;
  heat: number;
  strikes: number;
}

const num = (x: unknown, fallback = 0): number => (typeof x === 'number' && Number.isFinite(x) ? x : fallback);
const str = (x: unknown): string => (typeof x === 'string' ? x : '');

/** Cards from `core.garage`, one per entry that has a key; anything else in the array is skipped. */
export function garageCards(raw: unknown): GarageCard[] {
  if (!Array.isArray(raw)) return [];
  const out: GarageCard[] = [];
  for (const e of raw) {
    if (e === null || typeof e !== 'object') continue;
    const o = e as Record<string, unknown>;
    const key = str(o['key']);
    if (key === '') continue;
    const cls = str(o['class']).toUpperCase();
    const damage = num(o['damage']);
    out.push({
      key,
      prefab: str(o['prefab']),
      cls: (VEHICLE_CLASSES as readonly string[]).includes(cls) ? (cls as VehicleClass) : null,
      nickname: str(o['nickname']),
      plate: str(o['plate']),
      damagePct: Math.round(Math.max(0, Math.min(1, damage <= 1 ? damage : damage / 100)) * 100),
      heat: Math.max(0, Math.round(num(o['vehicleHeat']))),
      strikes: Math.max(0, Math.round(num(o['impoundStrikes']))),
    });
  }
  return out;
}

export function cardTitle(c: GarageCard): string {
  if (c.nickname) return c.nickname;
  if (c.prefab) return c.prefab.replace(/^vehicle\./, '').replace(/[._-]+/g, ' ');
  return t('garage.unnamed');
}

/**
 * The garage as a `ScreenDef`; `inWorld` shows Call (the phone app), the menu shows Set as favourite. Each card is a list with its
 * title row and one action row, so the rows are already-localized data and the same tree draws in DOM and XR.
 */
export function garageScreen(cards: readonly GarageCard[], inWorld: boolean): ScreenDef {
  const children: Widget[] = [{ k: 'heading', text: lk('nav.garage'), level: 1 }];
  if (cards.length === 0) children.push({ k: 'text', text: lk('garage.empty'), tone: 'muted' });
  for (const c of cards) {
    const detail = [
      c.cls ? t('garage.class', { cls: c.cls }) : '',
      t('garage.damage', { pct: c.damagePct }),
      c.heat > 0 ? t('garage.heat', { heat: c.heat }) : '',
      c.strikes > 0 ? t('garage.strikes', { n: c.strikes }) : '',
      c.plate,
    ].filter(Boolean).join(' \u00b7 ');
    children.push({
      k: 'list',
      id: `card-${c.key}`,
      empty: lk('garage.empty'),
      onPress: { call: 'garage.card' },
      rows: [{ id: `${inWorld ? 'call' : 'fav'}:${c.key}`, text: `${cardTitle(c)}: ${inWorld ? t('garage.call') : t('garage.favorite')}`, detail }],
    });
  }
  children.push({ k: 'button', id: 'back', label: lk('common.back'), style: 'secondary', onPress: { back: true } });
  return { id: 'garage', title: lk('nav.garage'), backTo: 'main', children };
}

/** A press on a card row: exactly one command with the card's `vehicleKey`. */
export function cardAction(rowId: string): UiCommand | null {
  const i = rowId.indexOf(':');
  if (i < 0) return null;
  const kind = rowId.slice(0, i);
  const vehicleKey = rowId.slice(i + 1);
  if (vehicleKey === '') return null;
  if (kind === 'call') return { t: 'garage.call', vehicleKey };
  if (kind === 'fav') return { t: 'garage.favorite', vehicleKey };
  return null;
}

export function GaragePage(_props: PageProps) {
  const { shell, ctx } = useShell();
  const cards = garageCards(ctx.vm<JsonValue>('sys.garage'));
  return h('main', { class: 'dv-page dv-garage', 'data-testid': 'garage' }, h(ScreenHost, {
    screen: garageScreen(cards, false),
    get: () => undefined,
    set: () => undefined,
    run: (action: UiAction, rowId?: string) => {
      if ('back' in action) shell.back();
      else if ('call' in action && rowId) {
        const cmd = cardAction(rowId);
        if (cmd) ctx.sendUi(cmd);
      }
    },
  }));
}

export default GaragePage;
