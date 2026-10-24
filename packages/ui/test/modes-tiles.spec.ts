import type { VNode } from 'preact';
import { describe, expect, it, vi } from 'vitest';
import { ListBox } from '../src/kit/widgets.tsx';
import { buildTiles, tileRows, tileState, type ModeTile, type TileEnv } from '../src/pages/modes.ts';
import { defaultPrefs, memoryPrefs } from '../src/shell/prefs.ts';
import { ShellCore, simToastToSpec } from '../src/shell/core.ts';
import type { ShellHooks, ShellProps } from '../src/shell/types.ts';

const tile = (over: Partial<ModeTile> & Pick<ModeTile, 'id'>): ModeTile => ({
  titleKey: `mode.${over.id}.title`, order: 1, art: `ui/mode-${over.id}`, status: 'available', standalone: true, unlock: null, hidden: false, xr: 'full', network: 'none', ...over,
});

// A fixture registry with ready, locked, comingSoon, unavailable and hidden modes (AC-8).
const registry: ModeTile[] = [
  tile({ id: 'story', order: 1 }),
  tile({ id: 'racing', order: 2, status: 'comingSoon', unlock: 'unlock.racing' }),
  tile({ id: 'fighter', order: 3, unlock: 'unlock.fighter' }),
  tile({ id: 'tycoon', order: 4, unlock: 'unlock.tycoon' }),
  tile({ id: 'sandbox', order: 5 }),
  tile({ id: 'secret', order: 6, unlock: 'unlock.secret', hidden: true }),
  tile({ id: 'online', order: 7, network: 'required' }),
  tile({ id: 'flat', order: 8, xr: 'none' }),
  tile({ id: 'embedded-only', order: 9, standalone: false }),
];

const env = (over: Partial<TileEnv> = {}): TileEnv => ({ unlocks: new Set(['unlock.tycoon']), online: true, headset: null, unlockAll: false, qa: false, ...over });

describe('mode tiles (AC-8)', () => {
  it('computes each state of the table', () => {
    const state = (id: string, e: TileEnv = env()) => tileState(registry.find((m) => m.id === id) as ModeTile, e);
    expect(state('story')).toBe('ready');
    expect(state('sandbox')).toBe('ready');
    expect(state('tycoon')).toBe('ready');
    expect(state('fighter')).toBe('locked');
    expect(state('racing')).toBe('comingSoon');
    expect(state('secret')).toBe('hidden');
    expect(state('secret', env({ unlocks: new Set(['unlock.secret']) }))).toBe('ready');
    expect(state('online', env({ online: false }))).toBe('unavailable');
    expect(state('online')).toBe('ready');
    expect(state('flat', env({ headset: 'quest' }))).toBe('unavailable');
    expect(state('flat')).toBe('ready');
  });

  it('renders the tiles in order, drops hidden ones and non-standalone modes, and shows NEW on an unlocked tile until it was opened', () => {
    const views = buildTiles(registry, env(), []);
    expect(views.map((v) => v.tile.id)).toEqual(['story', 'racing', 'fighter', 'tycoon', 'sandbox', 'online', 'flat']);
    expect(views.find((v) => v.tile.id === 'tycoon')?.isNew).toBe(true);
    expect(views.find((v) => v.tile.id === 'story')?.isNew).toBe(false);
    expect(views.find((v) => v.tile.id === 'racing')?.isNew).toBe(false);
    expect(buildTiles(registry, env(), ['tycoon']).find((v) => v.tile.id === 'tycoon')?.isNew).toBe(false);
  });

  it('a comingSoon tile is focusable but not activatable; a ready tile activates', () => {
    const pressed = vi.fn();
    const rows = tileRows(buildTiles(registry, env(), []));
    const list = ListBox({ id: 'modes', rows, empty: 'none', onPress: pressed }) as VNode<{ children: VNode[] }>;
    const buttons: VNode<Record<string, unknown>>[] = [];
    const find = (n: unknown): void => {
      if (Array.isArray(n)) return n.forEach(find);
      const v = n as VNode<Record<string, unknown>> | null;
      if (!v || typeof v !== 'object') return;
      if (v.type === 'button') buttons.push(v);
      find(v.props?.['children']);
    };
    find(list);
    const by = (id: string) => buttons.find((b) => b.props['data-fid'] === `row.modes.${id}`) as VNode<Record<string, () => void>>;
    expect(by('racing').props['aria-disabled']).toBe('true');
    expect(by('racing').props['tabIndex']).toBeUndefined();
    by('racing').props['onClick']!();
    by('fighter').props['onClick']!();
    expect(pressed).not.toHaveBeenCalled();
    by('story').props['onClick']!();
    expect(pressed).toHaveBeenCalledWith('story');
  });

  it('?unlockAll=1 is ignored when the build is not a QA build', () => {
    const fighter = registry.find((m) => m.id === 'fighter') as ModeTile;
    expect(tileState(fighter, env({ unlockAll: true, qa: false }))).toBe('locked');
    expect(tileState(fighter, env({ unlockAll: true, qa: true }))).toBe('ready');
  });

  it('one unlock event raises one toast', () => {
    const hooks: ShellHooks = { play: () => undefined, setPaused: () => undefined, view: () => undefined, reload: () => undefined };
    const props: ShellProps = {
      diagnostics: () => '', unsupported: false, update: null, initialPath: '/', prefs: memoryPrefs(defaultPrefs()), qa: false, qaPlay: null, unlockAllFlag: false, hooks, build: 't',
    };
    const core = new ShellCore(props);
    const rec = { id: 'unlock:unlock.racing', kind: 'unlock', text: 'unlock.racing.title', params: { source: 'mission' } };
    core.onEngineToast(rec);
    expect(core.toastStore.list.filter((x) => x.kind === 'unlock')).toHaveLength(1);
    expect(core.toastStore.list[0]).toMatchObject({ text: 'toast.unlock', params: { title: 'Racing' }, action: { label: 'toast.open' } });
    // The same id again replaces rather than stacks.
    core.onEngineToast(rec);
    expect(core.toastStore.list.filter((x) => x.kind === 'unlock')).toHaveLength(1);
    expect(simToastToSpec({ id: 'x', kind: 'warning', text: 'mode.comingSoon' }).kind).toBe('warning');
  });
});
