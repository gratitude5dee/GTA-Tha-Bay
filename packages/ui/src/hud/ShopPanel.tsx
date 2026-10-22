/**
 * The shop panel (M05c1): `mode.story.shop { id, title, cash, items[{ id, labelKey, priceCents, enabled, hint?, hintParams? }] }` is on while the
 * player stands at a shop door. A button buys the item (`shop.buy` with a fresh idempotency key per press); Close hides the panel until the
 * player leaves the door. Prices are integer cents, shown as money. Same look as the talk panel.
 */
import type { JsonValue } from '@dv/shared';
import { useRef } from 'preact/hooks';
import { formatCents, t } from '../i18n/index.ts';
import { useShell } from '../shell/context.tsx';
import { useVm } from './widgets.tsx';

export interface ShopItemView {
  id: string;
  labelKey: string;
  priceCents: number;
  enabled: boolean;
  hint?: string;
  hintParams?: Record<string, string | number>;
}

export interface ShopView {
  id: string;
  title: string;
  cash: number;
  items: ShopItemView[];
}

export function ShopChoices(props: { shop: ShopView; onBuy(shopId: string, itemId: string): void; onClose(): void }) {
  const { shop } = props;
  return (
    <section class="dv-talk dv-shop" data-testid="shop-panel" data-shop={shop.id} role="dialog" aria-label={t(shop.title)}>
      <h2 class="dv-talk-npc">{t(shop.title)}</h2>
      <p class="dv-talk-intent" data-testid="shop-cash">{t('shop.cash', { amount: formatCents(shop.cash) })}</p>
      <ol class="dv-talk-choices">
        {shop.items.map((it) => {
          const hint = it.hint ? t(it.hint, { ...(it.hintParams ?? {}), ...(typeof it.hintParams?.['cents'] === 'number' ? { amount: formatCents(it.hintParams['cents'] as number) } : {}) }) : '';
          return (
            <li key={it.id}>
              <button
                type="button"
                class="dv-talk-choice"
                data-testid={`shop-item-${it.id}`}
                disabled={!it.enabled}
                aria-disabled={!it.enabled}
                {...(hint ? { 'aria-describedby': `shop-hint-${it.id}` } : {})}
                onClick={() => props.onBuy(shop.id, it.id)}
              >
                {t(it.labelKey)} <span class="dv-shop-price">{formatCents(it.priceCents)}</span>
              </button>
              {hint ? <span id={`shop-hint-${it.id}`} class="dv-talk-hint" data-testid={`shop-hint-${it.id}`}>{hint}</span> : null}
            </li>
          );
        })}
      </ol>
      <button type="button" class="dv-talk-choice" data-testid="shop-close" onClick={props.onClose}>{t('shop.close')}</button>
    </section>
  );
}

export function ShopPanel() {
  const { ctx } = useShell();
  const shop = useVm<JsonValue>('mode.story.shop') as unknown as ShopView | null | undefined;
  const serial = useRef(0);
  if (!shop || !Array.isArray(shop.items)) return null;
  return (
    <ShopChoices
      shop={shop}
      onBuy={(shopId, item) => {
        serial.current += 1;
        ctx.sendUi({ t: 'mode.cmd', mode: 'story', name: 'shop.buy', args: { shop: shopId, item, key: `${shopId}:${item}:${Date.now().toString(36)}:${serial.current}` } });
      }}
      onClose={() => {
        ctx.sendUi({ t: 'mode.cmd', mode: 'story', name: 'shop.close' });
      }}
    />
  );
}
