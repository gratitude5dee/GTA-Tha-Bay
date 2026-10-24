/**
 * Mode select (10-ui-pages.md section 2.6, R-MODE-05). Tile state is computed from the registered modes (`sys.modes`) and the
 * unlock registry (`sys.unlocks`), never stored. The page is a `ScreenDef` (XR-capable): one list whose rows are the tiles.
 */
import { h } from 'preact';
import type { JsonValue } from '@dv/shared';
import { lk, t } from '../i18n/index.ts';
import { ScreenHost } from '../screen/dom-screen.tsx';
import type { ListRow, ScreenDef, UiAction } from '../screen/types.ts';
import { useShell } from '../shell/context.tsx';
import type { PageProps } from '../shell/types.ts';

/** One entry of `sys.modes`: the tile data of a registered mode. */
export interface ModeTile {
  id: string;
  titleKey: string;
  order: number;
  art: string;
  status: 'available' | 'comingSoon';
  standalone: boolean;
  unlock: string | null;
  hidden: boolean;
  xr: 'full' | 'seated' | 'panel' | 'none';
  network: 'none' | 'optional' | 'required';
}

export type TileState = 'ready' | 'locked' | 'comingSoon' | 'unavailable' | 'hidden';

export interface TileEnv {
  unlocks: ReadonlySet<string>;
  online: boolean;
  headset: 'quest' | 'visionpro' | null;
  /** `?unlockAll=1`, honoured only when `qa` is true. */
  unlockAll: boolean;
  qa: boolean;
}

/** The §2.6 table. */
export function tileState(m: ModeTile, env: TileEnv): TileState {
  const all = env.qa && env.unlockAll;
  const unlocked = m.unlock === null || env.unlocks.has(m.unlock) || all;
  if (m.hidden && !unlocked) return 'hidden';
  if (m.status === 'comingSoon') return 'comingSoon';
  if ((m.network === 'required' && !env.online) || (m.xr === 'none' && env.headset !== null)) return 'unavailable';
  if (!unlocked) return 'locked';
  return 'ready';
}

export interface TileView {
  tile: ModeTile;
  state: TileState;
  isNew: boolean;
}

/** The visible tiles in `tile.order`, standalone modes only. */
export function buildTiles(modes: readonly ModeTile[], env: TileEnv, seen: readonly string[]): TileView[] {
  return [...modes]
    .filter((m) => m.standalone)
    .sort((a, b) => a.order - b.order)
    .map((tile) => ({ tile, state: tileState(tile, env), isNew: tile.unlock !== null && !seen.includes(tile.id) }))
    .filter((v) => v.state !== 'hidden')
    .map((v) => ({ ...v, isNew: v.isNew && v.state === 'ready' }));
}

const HINT: Record<Exclude<TileState, 'ready' | 'hidden'>, string> = {
  locked: lk('modes.locked'),
  comingSoon: lk('modes.comingSoon'),
  unavailable: lk('modes.unavailable'),
};

export function tileRows(views: readonly TileView[]): ListRow[] {
  return views.map((v) => {
    const title = t(v.tile.titleKey);
    if (v.state === 'ready') {
      return { id: v.tile.id, text: title, detail: v.tile.id === 'sandbox' ? t('modes.sandbox.note') : t('modes.play'), ...(v.isNew ? { badge: t('modes.new') } : {}) };
    }
    return { id: v.tile.id, text: title, detail: t(HINT[v.state as 'locked']), disabled: true, hint: t(HINT[v.state as 'locked']) };
  });
}

export function modesScreen(rows: ListRow[], qaRibbon: boolean): ScreenDef {
  const press: UiAction = { call: 'mode.tile' };
  return {
    id: 'modes',
    title: lk('nav.modes'),
    backTo: 'main',
    children: [
      { k: 'heading', text: lk('nav.modes'), level: 1 },
      ...(qaRibbon ? [{ k: 'text' as const, text: lk('modes.qaUnlock'), tone: 'warning' as const }] : []),
      { k: 'list', id: 'modes', rows, onPress: press, empty: lk('modes.empty') },
      { k: 'button', id: 'back', label: lk('common.back'), style: 'secondary', onPress: { back: true } },
    ],
  };
}

export function ModesPage(_props: PageProps) {
  const { shell, ctx } = useShell();
  const modes = ctx.vm<JsonValue>('sys.modes');
  const list = (Array.isArray(modes) ? modes : []) as unknown as ModeTile[];
  const unlocks = new Set(((ctx.vm<JsonValue>('sys.unlocks') as string[] | undefined) ?? []).map(String));
  const qaAll = ctx.props.qa && ctx.props.unlockAllFlag;
  const views = buildTiles(list, { unlocks, online: ctx.gate.online, headset: ctx.gate.headset, unlockAll: ctx.props.unlockAllFlag, qa: ctx.props.qa }, ctx.props.prefs.get().seenTiles);
  const screen = modesScreen(tileRows(views), qaAll);
  return h(ScreenHost, {
    screen,
    get: () => undefined,
    set: () => undefined,
    run: (action: UiAction, rowId?: string) => {
      if ('back' in action) shell.back();
      else if ('call' in action && rowId) {
        const view = views.find((v) => v.tile.id === rowId);
        if (!view || view.state !== 'ready') return;
        const prefs = ctx.props.prefs;
        if (!prefs.get().seenTiles.includes(rowId)) prefs.set({ seenTiles: [...prefs.get().seenTiles, rowId] });
        ctx.startMode(rowId as never);
      }
    },
  });
}
