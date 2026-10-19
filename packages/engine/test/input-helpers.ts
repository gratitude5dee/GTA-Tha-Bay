import type { BinderTarget } from '@dv/shared';
import { KbmBinder, type KbmOptions } from '../src/client/input/kbm.ts';
import { InputRouterImpl, type RouterOptions } from '../src/client/input/router.ts';

/** A tiny event target: no DOM library, events are plain objects (the binders read structural shapes only). */
export class FakeTarget implements BinderTarget {
  private readonly listeners = new Map<string, Set<(e: never) => void>>();

  addEventListener(type: string, listener: (event: never) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: (event: never) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, event: object = {}): void {
    for (const l of [...(this.listeners.get(type) ?? [])]) (l as (e: object) => void)({ type, ...event });
  }

  count(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

export interface Rig {
  win: FakeTarget;
  doc: FakeTarget;
  canvas: FakeTarget & { locks: unknown[]; requestPointerLock(o?: { unadjustedMovement?: boolean }): Promise<void> };
  clock: { t: number };
  state: { textFocus: boolean; locked: boolean; visibility: string };
  kbm: KbmBinder;
  router: InputRouterImpl;
  timers: { fn: () => void; ms: number; cancelled: boolean }[];
  /** Press and release a key. */
  key(code: string, down: boolean, extra?: object): void;
  tap(code: string): void;
}

/** A router with a keyboard binder on fake targets and a manual clock (milliseconds). */
export function makeRig(opts: { router?: RouterOptions; kbm?: Partial<KbmOptions> } = {}): Rig {
  const win = new FakeTarget();
  const doc = new FakeTarget();
  const locks: unknown[] = [];
  const canvas = Object.assign(new FakeTarget(), {
    locks,
    requestPointerLock(o?: { unadjustedMovement?: boolean }): Promise<void> {
      locks.push(o ?? null);
      return Promise.resolve();
    },
  });
  const clock = { t: 0 };
  const state = { textFocus: false, locked: false, visibility: 'visible' };
  const timers: Rig['timers'] = [];
  const kbm = new KbmBinder({
    isTextFocus: () => state.textFocus,
    doc,
    canvas,
    isLocked: () => state.locked,
    visibility: () => state.visibility,
    ...opts.kbm,
  });
  kbm.attach(win);
  const router = new InputRouterImpl({
    binders: [kbm],
    now: () => clock.t,
    schedule: (fn, ms) => {
      const t = { fn, ms, cancelled: false };
      timers.push(t);
      return () => {
        t.cancelled = true;
      };
    },
    ...opts.router,
  });
  return {
    win, doc, canvas, clock, state, kbm, router, timers,
    key: (code, down, extra = {}) => win.emit(down ? 'keydown' : 'keyup', { code, ...extra }),
    tap(code) {
      win.emit('keydown', { code });
      win.emit('keyup', { code });
    },
  };
}

export const CAM = { yaw: 0, pitch: 0 };
