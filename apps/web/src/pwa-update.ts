import type { PwaUpdateController } from '@dv/shared';

/** Message the page posts to a waiting service worker to make it take over (handled in sw.ts). */
export const SKIP_WAITING_MESSAGE = 'SKIP_WAITING';

/** The slices of the service worker API the controller uses, so tests can pass mocks. */
export interface WorkerLike {
  readonly state?: string;
  postMessage(message: unknown): void;
  addEventListener?(type: 'statechange', fn: () => void): void;
}
export interface RegistrationLike {
  readonly waiting: WorkerLike | null;
  readonly installing: WorkerLike | null;
  addEventListener(type: 'updatefound', fn: () => void): void;
}
export interface ContainerLike {
  readonly controller: unknown;
  addEventListener(type: 'controllerchange', fn: () => void, opts?: { once?: boolean }): void;
}
export interface PwaUpdateDeps {
  container: ContainerLike;
  reload(): void;
}

export interface AttachablePwaUpdateController extends PwaUpdateController {
  /** Connects the controller to a service worker registration (call once registration resolves). */
  attach(reg: RegistrationLike): void;
}

/** The slices of `document` and `window` that {@link afterWindowLoad} reads. */
export interface LoadTarget {
  addEventListener(type: 'load', fn: () => void, opts?: { once?: boolean }): void;
}

/**
 * Runs `fn` once the window has loaded: at once when `load` has already fired, otherwise on `load`. The entry module awaits the stored
 * preferences at top level (M04b1), and a module's top-level await does not hold back the window's `load` event, so a plain
 * `addEventListener('load', ...)` placed after that await can be added too late and never run (BD-FIX-CI6-C01).
 */
export function afterWindowLoad(doc: { readonly readyState: string }, win: LoadTarget, fn: () => void): void {
  if (doc.readyState === 'complete') fn();
  else win.addEventListener('load', fn, { once: true });
}

/**
 * PwaUpdateController (11-platform-pwa.md section 4), prompt-style updates:
 * a new worker waits until `applyNow()`; applying is refused while the game is unsafe (mid-mission)
 * unless forced. `onChange` reports whether an update can be offered now (waiting and at a safe point).
 */
export function createPwaUpdateController(deps: PwaUpdateDeps): AttachablePwaUpdateController {
  let waiting: WorkerLike | null = null;
  let safe = true; // the app boots at a loading/menu safe point
  let lastOffer = false;
  const listeners = new Set<(available: boolean) => void>();

  const emit = (): void => {
    const offer = waiting !== null && safe;
    if (offer === lastOffer) return;
    lastOffer = offer;
    for (const fn of [...listeners]) fn(offer);
  };

  return {
    get updateAvailable() {
      return waiting !== null;
    },

    markSafePoint(_kind) {
      safe = true;
      emit();
    },

    markUnsafe() {
      safe = false;
      emit();
    },

    applyNow(opts) {
      if (waiting === null) return Promise.reject(new Error('no update is waiting'));
      if (!safe && opts?.force !== true) return Promise.reject(new Error('update refused: not at a safe point'));
      const target = waiting;
      // The new worker takes control after skipWaiting; reload once so the page runs the new build.
      deps.container.addEventListener('controllerchange', () => deps.reload(), { once: true });
      target.postMessage({ type: SKIP_WAITING_MESSAGE });
      return Promise.resolve();
    },

    onChange(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },

    attach(reg) {
      const refresh = (): void => {
        waiting = reg.waiting;
        emit();
      };
      refresh();
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        if (!worker?.addEventListener) return;
        worker.addEventListener('statechange', () => {
          // First install has no controller yet; that is not an update.
          if (worker.state === 'installed' && deps.container.controller) refresh();
        });
      });
    },
  };
}
