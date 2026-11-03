import type { PageComponent, PageDef, PageId } from './types.ts';

/**
 * Page chunks, loaded once and kept (BD-FIX-MENU-BOOT-01). A page whose chunk is here renders in the same task as the state change that
 * shows it; one that is not yet here costs the effect that loads it, which Preact runs only after the next animation frame, then the
 * chunk's fetch and evaluation. On a first boot the next animation frame is a frame of the tier benchmark or of the world (seconds on a
 * software renderer), so the main menu after the Terms waited for one or more of those before it existed. The pages a player can reach
 * next from the gates and the main menu are therefore loaded ahead (`PAGES_AHEAD`), while the page before them is up.
 */
const loaded = new Map<PageId, PageComponent>();
const loading = new Map<PageId, Promise<PageComponent | null>>();

/** The component of a page whose chunk has loaded, else undefined. */
export function loadedPage(id: PageId): PageComponent | undefined {
  return loaded.get(id);
}

/** Loads a page's chunk once; resolves with its component, or null when the chunk failed (a later call tries again). */
export function loadPage(def: PageDef): Promise<PageComponent | null> {
  const have = loaded.get(def.id);
  if (have) return Promise.resolve(have);
  const pending = loading.get(def.id);
  if (pending) return pending;
  const next = def.load().then(
    (m) => {
      loading.delete(def.id);
      const page = m.default as PageComponent;
      loaded.set(def.id, page);
      return page;
    },
    (e: unknown) => {
      loading.delete(def.id);
      console.error('page chunk failed', def.id, e);
      return null;
    },
  );
  loading.set(def.id, next);
  return next;
}

/**
 * The pages loaded ahead while a page is up: the gates' next steps (Title, then the age screen, the Terms card, the main menu), and the
 * main menu's New Game and Continue. Only these: every other page loads when it is opened, as before.
 */
export const PAGES_AHEAD: Partial<Record<PageId, readonly PageId[]>> = {
  boot: ['title', 'age', 'terms', 'main'],
  title: ['age', 'terms', 'blocked', 'main'],
  age: ['terms', 'blocked', 'main'],
  terms: ['main', 'title'],
  main: ['new', 'load'],
};

/** Starts loading the chunks of the pages reachable next from `id` (`PAGES_AHEAD`); returns the ids it asked for. */
export function loadPagesAhead(id: PageId, defOf: (id: PageId) => PageDef | undefined): PageId[] {
  const asked: PageId[] = [];
  for (const next of PAGES_AHEAD[id] ?? []) {
    const def = defOf(next);
    if (!def || loaded.has(next) || loading.has(next)) continue;
    asked.push(next);
    void loadPage(def);
  }
  return asked;
}

/** Tests only: forgets every loaded chunk. */
export function resetPageCache(): void {
  loaded.clear();
  loading.clear();
}
