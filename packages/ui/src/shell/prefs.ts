import type { PrefsStore, UiPrefs } from './types.ts';

/**
 * `UiPrefs` (10-ui-pages.md section 4.3): device-scoped, IndexedDB `dv-ui` store `prefs`, every access in try/catch with an in-memory
 * fallback. The age block lives there too, as its own key `ageBlocked`, mirrored to `localStorage['dv-ui-ageBlocked']` (also in
 * try/catch); the shell and the `/account/` island both read it before anything else. Clearing site data clears it, which is accepted.
 */
export const PREFS_DB = 'dv-ui';
export const PREFS_STORE = 'prefs';
export const BLOCK_KEY = 'ageBlocked';
export const BLOCK_MIRROR = 'dv-ui-ageBlocked';
const CURRENT = 'current';

export function defaultPrefs(): UiPrefs {
  return {
    v: 1,
    lang: null,
    uiScale: 1,
    highContrast: false,
    focusRing: 'default',
    hudScale: 1,
    hudOpacity: 1,
    hudSafeMarginPct: 0,
    units: 'mph',
    showTips: true,
    announce: true,
    showFps: false,
    soundCaptions: false,
    seenTiles: [],
    dismissed: [],
    customTouchLayouts: {},
    age: { attested: null, attestedAt: null, blocked: false },
    terms: null,
  };
}

const clamp = (n: unknown, lo: number, hi: number, fallback: number): number => (typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback);

/** Merges a stored value over the defaults; anything malformed reads as its default. */
export function normalizePrefs(raw: unknown): UiPrefs {
  const d = defaultPrefs();
  if (typeof raw !== 'object' || raw === null) return d;
  const r = raw as Partial<UiPrefs>;
  if (r.v !== 1) return d;
  const age = (r.age ?? {}) as Partial<UiPrefs['age']>;
  const terms = r.terms as Partial<NonNullable<UiPrefs['terms']>> | null | undefined;
  return {
    ...d,
    lang: typeof r.lang === 'string' ? r.lang : null,
    uiScale: clamp(r.uiScale, 0.85, 1.5, d.uiScale),
    highContrast: r.highContrast === true,
    focusRing: r.focusRing === 'thick' ? 'thick' : 'default',
    hudScale: clamp(r.hudScale, 0.8, 1.4, d.hudScale),
    hudOpacity: clamp(r.hudOpacity, 0.4, 1, d.hudOpacity),
    hudSafeMarginPct: clamp(r.hudSafeMarginPct, 0, 10, d.hudSafeMarginPct),
    units: r.units === 'kph' ? 'kph' : 'mph',
    showTips: r.showTips !== false,
    announce: r.announce !== false,
    showFps: r.showFps === true,
    soundCaptions: r.soundCaptions === true,
    seenTiles: Array.isArray(r.seenTiles) ? r.seenTiles.filter((x): x is string => typeof x === 'string').slice(0, 64) : [],
    dismissed: Array.isArray(r.dismissed) ? r.dismissed.filter((x): x is string => typeof x === 'string').slice(0, 128) : [],
    customTouchLayouts: typeof r.customTouchLayouts === 'object' && r.customTouchLayouts !== null ? r.customTouchLayouts : {},
    age: {
      attested: age.attested === '18p' ? '18p' : null,
      attestedAt: typeof age.attestedAt === 'number' ? age.attestedAt : null,
      blocked: age.blocked === true,
    },
    terms: terms && typeof terms.version === 'string' && typeof terms.acceptedAt === 'number' ? { version: terms.version, acceptedAt: terms.acceptedAt } : null,
  };
}

export interface PrefsOptions {
  /** IndexedDB factory; `null` forces the in-memory store. Default `globalThis.indexedDB`. */
  idb?: IDBFactory | null;
  /** `localStorage`-like for the block mirror; `null` for none. Default `globalThis.localStorage` (guarded). */
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
}

function guardedStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
  try {
    const s = globalThis.localStorage;
    s.getItem(BLOCK_MIRROR);
    return s;
  } catch {
    return null;
  }
}

const wrap = <T,>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB request failed'));
  });

function openDb(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = idb.open(PREFS_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(PREFS_STORE)) req.result.createObjectStore(PREFS_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
    req.onblocked = () => reject(new Error('indexedDB open blocked'));
  });
}

/** Reads the prefs and the block flag (either source blocks), then returns a store that writes through to both. */
export async function loadPrefs(o: PrefsOptions = {}): Promise<PrefsStore> {
  const storage = o.storage === undefined ? guardedStorage() : o.storage;
  const idb = o.idb === undefined ? (globalThis as { indexedDB?: IDBFactory }).indexedDB ?? null : o.idb;
  let dbPromise: Promise<IDBDatabase> | null = null;
  const db = (): Promise<IDBDatabase> => (dbPromise ??= openDb(idb as IDBFactory));
  const read = async (key: string): Promise<unknown> => {
    if (!idb) return undefined;
    try {
      return await wrap((await db()).transaction(PREFS_STORE, 'readonly').objectStore(PREFS_STORE).get(key));
    } catch {
      return undefined;
    }
  };
  const write = async (key: string, value: unknown): Promise<void> => {
    if (!idb) return;
    try {
      await wrap((await db()).transaction(PREFS_STORE, 'readwrite').objectStore(PREFS_STORE).put(value, key));
    } catch {
      // the in-memory copy stays authoritative for this session
    }
  };

  let prefs = normalizePrefs(await read(CURRENT));
  let mirrored = false;
  try {
    mirrored = storage?.getItem(BLOCK_MIRROR) === '1';
  } catch {
    mirrored = false;
  }
  const stored = (await read(BLOCK_KEY)) === true;
  if (stored || mirrored) prefs = { ...prefs, age: { ...prefs.age, blocked: true } };

  const subs = new Set<(p: UiPrefs) => void>();
  let chain: Promise<void> = Promise.resolve();
  const persist = (): void => {
    const snapshot = prefs;
    chain = chain.then(async () => {
      await write(CURRENT, snapshot);
      if (snapshot.age.blocked) {
        await write(BLOCK_KEY, true);
        try {
          storage?.setItem(BLOCK_MIRROR, '1');
        } catch {
          // storage may be blocked
        }
      }
    });
  };

  return {
    get: () => prefs,
    set(patch) {
      const next = { ...prefs, ...patch };
      // A block is sticky: nothing in this store lifts it.
      if (prefs.age.blocked) next.age = { ...next.age, blocked: true };
      prefs = next;
      persist();
      for (const cb of [...subs]) cb(prefs);
    },
    subscribe(cb) {
      subs.add(cb);
      return () => void subs.delete(cb);
    },
    flush: () => chain,
  };
}

/** An in-memory store (tests, QA bypass without persistence). */
export function memoryPrefs(initial: UiPrefs = defaultPrefs()): PrefsStore {
  let prefs = initial;
  const subs = new Set<(p: UiPrefs) => void>();
  return {
    get: () => prefs,
    set(patch) {
      prefs = { ...prefs, ...patch };
      for (const cb of [...subs]) cb(prefs);
    },
    subscribe(cb) {
      subs.add(cb);
      return () => void subs.delete(cb);
    },
    flush: () => Promise.resolve(),
  };
}
