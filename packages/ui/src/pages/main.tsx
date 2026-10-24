/** The main menu (10-ui-pages.md section 2.5): items from `config/ui/nav.json`, each gated by its page. */
import navJson from '../../../../config/ui/nav.json';
import { t } from '../i18n/index.ts';
import { Banner, Button, useAsync } from '../kit/widgets.tsx';
import { Link, useShell } from '../shell/context.tsx';
import { pageDef } from '../shell/registry.ts';
import type { GateCtx, GateResult, PageId, PageProps } from '../shell/types.ts';
import { lastSaveLine, mostRecent, playtimeText, waitForProfile } from './saves.tsx';

export interface NavItem { id: string; page: PageId; labelKey: string; params?: Record<string, string>; also?: PageId[] }
export const NAV_ITEMS = (navJson as { items: NavItem[] }).items;

/** Pages whose own milestone has not landed: the menu shows them with a "Coming soon" tag. */
export const COMING_SOON_PAGES: ReadonlySet<PageId> = new Set<PageId>(['npcs', 'community', 'experiences', 'online']);

export interface NavView { item: NavItem; gate: GateResult }

/** The menu items with their gate results (hidden items are dropped). */
export function navViews(gate: GateCtx, items: readonly NavItem[] = NAV_ITEMS): NavView[] {
  const out: NavView[] = [];
  for (const item of items) {
    const g = pageDef(item.page)?.gate(gate) ?? { state: 'hidden' as const };
    if (g.state !== 'hidden') out.push({ item, gate: g });
  }
  return out;
}

/** Every page a player can reach from the main menu through `nav.json` (`also` lists the pages those open). */
export function reachablePages(gate: GateCtx, items: readonly NavItem[] = NAV_ITEMS): Set<PageId> {
  const out = new Set<PageId>(['main']);
  for (const v of navViews(gate, items)) {
    out.add(v.item.page);
    for (const p of v.item.also ?? []) out.add(p);
  }
  return out;
}

export function MainPage(_props: PageProps) {
  const { shell, ctx } = useShell();
  const profiles = useAsync(() => (ctx.saves ? ctx.saves.list() : Promise.resolve([])), [ctx.saves, ctx.profile?.id]);
  const last = mostRecent((profiles.data ?? []).filter((p) => p.lastSave !== null));
  const views = navViews(ctx.gate);
  const line = last ? lastSaveLine(last.lastSave, Date.now()) : null;
  const identityKey = `identity.${ctx.gate.identity.tier}`;
  const continueGame = async (): Promise<void> => {
    if (!last) return;
    if (ctx.profile?.id !== last.id) {
      ctx.sendUi({ t: 'save.profile', op: 'select', id: last.id });
      if (!(await waitForProfile(ctx, last.id))) return;
    }
    ctx.startMode('story', 'story:auto');
  };
  return (
    <main class="dv-page dv-main" data-testid="main">
      <header class="dv-main-head">
        <h1>{t('title.name')}</h1>
        <div class="dv-chips">
          <span class="dv-chip" data-testid="chip-profile">{ctx.profile ? ctx.profile.name : t('chip.noProfile')}</span>
          <span class="dv-chip" data-testid="chip-identity">{t(identityKey)}</span>
          {!ctx.gate.online ? <span class="dv-chip dv-chip-warn" data-testid="chip-offline">{t('chip.offline')}</span> : null}
        </div>
      </header>
      {ctx.otherTab ? <Banner id="other-tab" tone="warning" icon="!" text={t('banner.otherTab')} /> : null}
      <nav aria-label={t('nav.main')} class="dv-menu">
        {views.map(({ item, gate }) => {
          const reason =
            gate.state === 'disabled'
              ? t(gate.reason)
              : item.id === 'continue' && !last
                ? t('menu.continue.none')
                : (item.id === 'continue' || item.id === 'new') && ctx.otherTab
                  ? t('banner.otherTab.short')
                  : undefined;
          return (
            <div key={item.id} class="dv-menu-item">
              <Button
                id={`nav-${item.id}`}
                testId={`nav-${item.id}`}
                style={item.id === 'continue' ? 'primary' : 'secondary'}
                label={t(item.labelKey)}
                disabledReason={reason}
                onPress={() => {
                  if (item.id === 'continue') void continueGame();
                  else shell.navigate(item.page, item.params);
                }}
              />
              {COMING_SOON_PAGES.has(item.page) ? <span class="dv-badge">{t('common.comingSoon')}</span> : null}
              {item.id === 'continue' && last && line ? (
                <small data-testid="continue-line" class={line.ok ? '' : 'dv-warn'}>
                  {line.ok ? '' : '! '}
                  {`${last.name} - ${playtimeText(last.playtimeSec)} - ${line.text}`}
                </small>
              ) : null}
              {gate.state === 'disabled' && gate.cta ? (
                typeof gate.cta.to === 'string' ? (
                  <Link to={gate.cta.to}>{t(gate.cta.label)}</Link>
                ) : (
                  <a class="dv-link" href={gate.cta.to.href}>{t(gate.cta.label)}</a>
                )
              ) : null}
            </div>
          );
        })}
      </nav>
      <footer class="dv-main-foot">
        <small data-testid="build-id">{t('common.build', { build: ctx.props.build })}</small>
      </footer>
    </main>
  );
}
