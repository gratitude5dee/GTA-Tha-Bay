import { useEffect, useState } from 'preact/hooks';

/**
 * Full screen for desktop browsers (R-PLAT-01, F-011): iPhone has no Fullscreen API on pages and XR never shows the control.
 * Nothing is persisted: every entry needs a gesture.
 */
export interface FullscreenDoc {
  fullscreenEnabled?: boolean;
  fullscreenElement?: unknown;
  exitFullscreen?(): Promise<void> | void;
  documentElement?: { requestFullscreen?(): Promise<void> | void };
}

export interface FullscreenState {
  available: boolean;
  active: boolean;
}

export const NO_FULLSCREEN: FullscreenState = { available: false, active: false };

export function fullscreenAvailable(doc: FullscreenDoc | null | undefined, deviceClass: 'desktop' | 'mobile' | 'xr'): boolean {
  return doc?.fullscreenEnabled === true && deviceClass !== 'xr';
}

export function fullscreenState(doc: FullscreenDoc | null | undefined, deviceClass: 'desktop' | 'mobile' | 'xr'): FullscreenState {
  if (!fullscreenAvailable(doc, deviceClass)) return NO_FULLSCREEN;
  return { available: true, active: Boolean(doc?.fullscreenElement) };
}

const isThenable = (x: unknown): x is PromiseLike<unknown> => typeof x === 'object' && x !== null && typeof (x as { then?: unknown }).then === 'function';

/**
 * Enters or leaves full screen. Runs synchronously inside the press handler (the browser wants the gesture on the call stack); `onFail`
 * runs when the browser refuses, whether it throws or rejects.
 */
export function toggleFullscreen(doc: FullscreenDoc, onFail?: () => void): void {
  const fail = (): void => onFail?.();
  try {
    const r = doc.fullscreenElement ? doc.exitFullscreen?.() : doc.documentElement?.requestFullscreen?.();
    if (isThenable(r)) r.then(undefined, fail);
  } catch {
    fail();
  }
}

/** Re-renders the caller when the document enters or leaves full screen, so the button label follows. */
export function useFullscreenTick(): void {
  const [, set] = useState(0);
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const on = (): void => set((n) => n + 1);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
}

export function currentFullscreen(deviceClass: 'desktop' | 'mobile' | 'xr'): FullscreenState {
  return fullscreenState(typeof document === 'undefined' ? null : (document as FullscreenDoc), deviceClass);
}
