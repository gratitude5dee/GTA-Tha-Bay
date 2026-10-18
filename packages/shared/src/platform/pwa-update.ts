/**
 * PwaUpdateController, copied from spec/domains/11-platform-pwa.md section 4 without changes.
 * The type lives here so @dv/ui (UpdateToast) and apps/web (the implementation) share it without
 * packages importing apps. Semantics fixed by the M00 Builder (decision BD-M00-05):
 * - `updateAvailable` is true while a new service worker is installed and waiting.
 * - `onChange(fn)` reports whether an update can be offered right now: `updateAvailable` and a safe point.
 */
export interface PwaUpdateController {
  readonly updateAvailable: boolean;
  markSafePoint(kind: 'menu' | 'mission-end' | 'safehouse' | 'loading'): void; // S01/S10 call
  markUnsafe(): void;
  applyNow(opts?: { force?: boolean }): Promise<void>;  // refuses while unsafe unless forced
  onChange(fn: (available: boolean) => void): () => void;
}
