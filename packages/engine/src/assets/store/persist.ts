/**
 * `navigator.storage.persist()` (11-platform-pwa.md section 5, rule 5), asked once per profile. In v1 only the first
 * standalone launch asks; story start asks from M05a1 on. Whether the answer protects OPFS on iOS is UNVERIFIED (F-010), so
 * nothing in the store depends on it: the result is logged as `storage.persist{granted}`.
 */
export type PersistReason = 'standalone' | 'story';

export const PERSIST_MARKER_KEY = 'dv-storage-persist';

export interface PersistDeps {
  storage: { persist?: () => Promise<boolean> } | null | undefined;
  /** Remembers that this profile has asked (`localStorage`); null when unavailable. */
  marker: { getItem(k: string): string | null; setItem(k: string, v: string): void } | null;
  emit: (name: 'storage.persist', props: { granted: boolean }) => void;
}

/** Returns the granted flag, or null when it did not ask (already asked, or no `persist`). */
export async function requestPersist(_reason: PersistReason, d: PersistDeps): Promise<boolean | null> {
  const persist = d.storage?.persist;
  if (typeof persist !== 'function') return null;
  try {
    if (d.marker && d.marker.getItem(PERSIST_MARKER_KEY) !== null) return null;
  } catch {
    // An unreadable marker means we ask again, which is harmless.
  }
  let granted = false;
  try {
    granted = await persist.call(d.storage);
  } catch {
    granted = false;
  }
  try {
    d.marker?.setItem(PERSIST_MARKER_KEY, granted ? '1' : '0');
  } catch {
    // Storage blocked.
  }
  d.emit('storage.persist', { granted });
  return granted;
}
