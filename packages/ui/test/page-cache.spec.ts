/**
 * BD-FIX-MENU-BOOT-01: the gates and the main menu render in the task that shows them. A page whose chunk is loaded is there at once
 * (`loadedPage`); the pages a player reaches next load while the page before them is up (`PAGES_AHEAD`), so the main menu after the
 * Terms never waits for an effect (Preact runs those after the next animation frame) and a chunk fetch behind the benchmark's frames.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { loadedPage, loadPage, loadPagesAhead, PAGES_AHEAD, resetPageCache } from '../src/shell/page-cache.ts';
import { pageDef, PAGES } from '../src/shell/registry.ts';
import type { PageComponent, PageDef, PageId } from '../src/shell/types.ts';

afterEach(() => resetPageCache());

/** Registry defs whose `load` counts calls and resolves with a stub component (or fails when asked). */
function fakeDefs(fail: ReadonlySet<PageId> = new Set()): { defOf: (id: PageId) => PageDef | undefined; loads: PageId[] } {
  const loads: PageId[] = [];
  const defOf = (id: PageId): PageDef | undefined => {
    const real = pageDef(id);
    if (!real) return undefined;
    return {
      ...real,
      load: () => {
        loads.push(id);
        if (fail.has(id)) return Promise.reject(new Error(`chunk ${id} failed`));
        const page: PageComponent = () => id;
        return Promise.resolve({ default: page });
      },
    };
  };
  return { defOf, loads };
}

describe('page cache', () => {
  it('loads a chunk once; once loaded the page is there synchronously', async () => {
    const { defOf, loads } = fakeDefs();
    const def = defOf('main') as PageDef;
    expect(loadedPage('main')).toBeUndefined();
    const [a, b] = await Promise.all([loadPage(def), loadPage(def)]);
    expect(a).toBe(b);
    expect(loads).toEqual(['main']);
    expect(loadedPage('main')).toBe(a);
    await loadPage(def);
    expect(loads).toEqual(['main']);
  });

  it('a failed chunk is not kept: the next load tries again', async () => {
    const failing = fakeDefs(new Set<PageId>(['terms']));
    expect(await loadPage(failing.defOf('terms') as PageDef)).toBeNull();
    expect(loadedPage('terms')).toBeUndefined();
    const ok = fakeDefs();
    expect(await loadPage(ok.defOf('terms') as PageDef)).not.toBeNull();
    expect(loadedPage('terms')).toBeDefined();
  });

  it('the boot screen loads the gates and the main menu ahead; the Terms card has the main menu loaded', async () => {
    const { defOf, loads } = fakeDefs();
    expect(loadPagesAhead('boot', defOf)).toEqual(['title', 'age', 'terms', 'main']);
    // asked once: a second ask while they load starts nothing
    expect(loadPagesAhead('boot', defOf)).toEqual([]);
    await new Promise((r) => setTimeout(r, 0));
    for (const id of ['title', 'age', 'terms', 'main'] as const) expect(loadedPage(id)).toBeDefined();
    expect(loadPagesAhead('terms', defOf)).toEqual([]);
    expect(loads).toEqual(['title', 'age', 'terms', 'main']);
  });

  it('every gate step has its next pages ahead, and the main menu its New Game and Continue', () => {
    expect(PAGES_AHEAD.title).toEqual(expect.arrayContaining(['age', 'terms', 'main']));
    expect(PAGES_AHEAD.age).toEqual(expect.arrayContaining(['terms', 'main']));
    expect(PAGES_AHEAD.terms).toEqual(expect.arrayContaining(['main']));
    expect(PAGES_AHEAD.main).toEqual(['new', 'load']);
    const ids = new Set(PAGES.map((p) => p.id));
    for (const list of Object.values(PAGES_AHEAD)) for (const id of list ?? []) expect(ids.has(id), id).toBe(true);
  });

  it('the real registry chunks load (the main menu page is the MainPage component)', async () => {
    const page = await loadPage(pageDef('main') as PageDef);
    expect(typeof page).toBe('function');
    expect(loadedPage('main')).toBe(page);
  });
});
