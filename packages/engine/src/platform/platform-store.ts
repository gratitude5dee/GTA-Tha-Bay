import { parseTierDecision, type PlatformSettings, type TierDecision } from '@dv/shared';

/**
 * Device-scoped platform storage (11-platform.md section 4.6): IndexedDB `dv-platform`, object stores `tier-decision` and
 * `settings`. Never in C05, because cloud sync would carry a desktop tier override to an iPhone. Reads validate; anything
 * that does not match its schema reads as missing.
 */
export const DB_NAME = 'dv-platform';
const STORE_DECISION = 'tier-decision';
const STORE_SETTINGS = 'settings';
const KEY = 'current';

export const DEFAULT_SETTINGS: PlatformSettings = {
  v: 1,
  tierOverride: 'auto',
  compatibilityMode: false,
  fpsCap: 'auto',
  renderScale: 'auto',
  foveation: 'auto',
  dataSaver: false,
  // Both toggles default on with a first-run notice (DL-140).
  telemetryConsent: { diagnostics: true, analytics: true },
};

export interface PlatformStore {
  getTierDecision(): Promise<TierDecision | null>;
  putTierDecision(d: TierDecision): Promise<void>;
  getSettings(): Promise<PlatformSettings>;
  putSettings(s: PlatformSettings): Promise<void>;
}

/** Merges stored settings over the defaults; a record with the wrong version reads as the defaults. */
export function normalizeSettings(raw: unknown): PlatformSettings {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_SETTINGS;
  const r = raw as Partial<PlatformSettings>;
  if (r.v !== 1) return DEFAULT_SETTINGS;
  const consent = r.telemetryConsent;
  return {
    ...DEFAULT_SETTINGS,
    ...r,
    v: 1,
    telemetryConsent: {
      diagnostics: typeof consent?.diagnostics === 'boolean' ? consent.diagnostics : DEFAULT_SETTINGS.telemetryConsent.diagnostics,
      analytics: typeof consent?.analytics === 'boolean' ? consent.analytics : DEFAULT_SETTINGS.telemetryConsent.analytics,
    },
  };
}

export function createMemoryStore(initial?: { decision?: unknown; settings?: unknown }): PlatformStore {
  let decision: unknown = initial?.decision ?? null;
  let settings: unknown = initial?.settings ?? null;
  return {
    getTierDecision: () => Promise.resolve(parseTierDecision(decision)),
    putTierDecision: (d) => {
      decision = structuredClone(d);
      return Promise.resolve();
    },
    getSettings: () => Promise.resolve(normalizeSettings(settings)),
    putSettings: (s) => {
      settings = structuredClone(s);
      return Promise.resolve();
    },
  };
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB request failed'));
  });
}

function openDb(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = idb.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_DECISION)) db.createObjectStore(STORE_DECISION);
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) db.createObjectStore(STORE_SETTINGS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
    req.onblocked = () => reject(new Error('indexedDB open blocked'));
  });
}

/**
 * IndexedDB-backed store. When IndexedDB is missing or throws (private windows, blocked storage), the store falls back to
 * memory for the rest of the session so the platform still boots.
 */
export function createIdbStore(idb: IDBFactory | undefined = globalThis.indexedDB): PlatformStore {
  const memory = createMemoryStore();
  if (!idb) return memory;
  let dbPromise: Promise<IDBDatabase> | null = null;
  const db = (): Promise<IDBDatabase> => (dbPromise ??= openDb(idb));

  async function read(store: string): Promise<unknown> {
    const d = await db();
    return wrap(d.transaction(store, 'readonly').objectStore(store).get(KEY));
  }
  async function write(store: string, value: unknown): Promise<void> {
    const d = await db();
    await wrap(d.transaction(store, 'readwrite').objectStore(store).put(value, KEY));
  }

  return {
    async getTierDecision() {
      try {
        return parseTierDecision(await read(STORE_DECISION));
      } catch {
        return memory.getTierDecision();
      }
    },
    async putTierDecision(d) {
      try {
        await write(STORE_DECISION, d);
      } catch {
        await memory.putTierDecision(d);
      }
    },
    async getSettings() {
      try {
        return normalizeSettings(await read(STORE_SETTINGS));
      } catch {
        return memory.getSettings();
      }
    },
    async putSettings(s) {
      try {
        await write(STORE_SETTINGS, s);
      } catch {
        await memory.putSettings(s);
      }
    },
  };
}
