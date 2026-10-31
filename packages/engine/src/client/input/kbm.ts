import type { Binder, BinderTarget, ControlId, DeviceKind, RawInputState } from '@dv/shared';

/** The fields of the DOM events the binder reads. Structural, so tests pass plain objects and no DOM library is needed. */
export interface KeyEventLike { type?: string; code: string; repeat?: boolean; preventDefault?: () => void }
export interface MouseEventLike {
  type?: string;
  button?: number;
  movementX?: number;
  movementY?: number;
  /** `Event.timeStamp`, milliseconds on the page's clock. */
  timeStamp?: number;
  /** Chromium's `InputDeviceCapabilities`: true on the mouse events a tap is followed by. */
  sourceCapabilities?: { firesTouchEvents?: boolean } | null;
}
/** The fields of a `pointerdown`/`pointerup`/`touchstart`/`touchend` the binder reads to recognise the mouse events a tap brings. */
export interface TouchMarkLike { type?: string; pointerType?: string; timeStamp?: number }

/**
 * A browser follows a tap with compatibility mouse events (`mousedown`, `mouseup`, `click`) unless the page cancels the touch, as the touch
 * layer does but a DOM button (Skip, the minimap) does not. Mouse buttons within this many milliseconds of a touch are those, not the
 * mouse: they neither press a game control nor make keyboard and mouse the active device (BD-FIX-MOBILE-HUD-01).
 */
export const TOUCH_COMPAT_MOUSE_MS = 1000;
export interface WheelEventLike { type?: string; deltaY: number; deltaMode: number; preventDefault?: () => void }

/** The canvas the binder asks for Pointer Lock. */
export interface PointerLockTarget extends BinderTarget {
  requestPointerLock(options?: { unadjustedMovement?: boolean }): Promise<void> | void;
}

export interface KbmOptions {
  /** True while a text field has focus: all input is released and ignored (C03 rule 4). */
  isTextFocus: () => boolean;
  /** Receives `visibilitychange` and `pointerlockchange`. Defaults to the attach target. */
  doc?: BinderTarget;
  /** `document.visibilityState`. */
  visibility?: () => string;
  /** The canvas: a click on it requests Pointer Lock with `unadjustedMovement: true`. */
  canvas?: PointerLockTarget;
  /** `document.pointerLockElement !== null`. Mouse movement counts as look only while this is true. */
  isLocked?: () => boolean;
  /** Pointer Lock ended while it was held (Esc exits the lock without a key event). The caller raises client.Pause. */
  onLockLost?: () => void;
  /** Console warnings (the one-time fallback when `unadjustedMovement` is refused). */
  warn?: (message: string) => void;
}

/** Keys the browser would otherwise act on while the game has the keyboard. */
const GAME_KEYS = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F3']);

/** Normalizes a wheel event to notches: 100 px, 3 lines or 1 page per notch (deltaMode 0, 1, 2). */
export function wheelNotches(deltaY: number, deltaMode: number): number {
  if (deltaMode === 1) return deltaY / 3;
  if (deltaMode === 2) return deltaY;
  return deltaY / 100;
}

/**
 * Keyboard and mouse binder (C03). `KeyboardEvent.code` identifies keys, so remaps follow the physical layout.
 * Everything is released on `blur` and when the page becomes hidden, and input is ignored while a text field has focus.
 * Mouse movement is look only while Pointer Lock is held; it is requested on a click on the canvas.
 */
export class KbmBinder implements Binder {
  readonly device: DeviceKind = 'kbm';
  private target: BinderTarget | null = null;
  private readonly down = new Set<ControlId>();
  private readonly pending = new Set<ControlId>();
  private readonly written = new Set<ControlId>();
  private look: [number, number] = [0, 0];
  private wheelUp = 0;
  private wheelDown = 0;
  private active = false;
  private wasLocked = false;
  private unadjustedRefused = false;
  /** `timeStamp` of the last touch contact starting or ending anywhere on the page. */
  private lastTouchMs: number | null = null;
  private readonly cleanups: (() => void)[] = [];

  constructor(private readonly opts: KbmOptions) {}

  get connected(): boolean {
    return this.target !== null;
  }

  attach(target: BinderTarget): void {
    if (this.target) this.detach();
    this.target = target;
    const doc = this.opts.doc ?? target;
    this.on(target, 'keydown', (e) => this.onKey(e as KeyEventLike, true));
    this.on(target, 'keyup', (e) => this.onKey(e as KeyEventLike, false));
    // Capture phase: a control that stops its pointer events from bubbling (the cutscene's Skip) still marks the touch.
    for (const type of ['pointerdown', 'pointerup', 'touchstart', 'touchend']) this.on(target, type, (e) => this.onTouchMark(e as TouchMarkLike), true);
    this.on(target, 'mousedown', (e) => this.onMouseButton(e as MouseEventLike, true));
    this.on(target, 'mouseup', (e) => this.onMouseButton(e as MouseEventLike, false));
    this.on(target, 'mousemove', (e) => this.onMouseMove(e as MouseEventLike));
    this.on(target, 'wheel', (e) => this.onWheel(e as WheelEventLike));
    this.on(target, 'blur', () => this.releaseAll());
    this.on(doc, 'visibilitychange', () => {
      if ((this.opts.visibility?.() ?? 'hidden') !== 'visible') this.releaseAll();
    });
    this.on(doc, 'pointerlockchange', () => this.onLockChange());
    const canvas = this.opts.canvas;
    if (canvas) this.on(canvas, 'click', () => this.requestLock());
  }

  detach(): void {
    for (const off of this.cleanups.splice(0)) off();
    this.releaseAll();
    this.target = null;
  }

  /** Asks for Pointer Lock with `unadjustedMovement`; retries without it when the browser refuses (once). */
  requestLock(): void {
    const canvas = this.opts.canvas;
    if (!canvas || this.suspended()) return;
    const retry = (): void => {
      this.unadjustedRefused = true;
      this.opts.warn?.('Pointer Lock: unadjustedMovement was refused; using adjusted mouse movement');
      void Promise.resolve(canvas.requestPointerLock()).catch(() => {});
    };
    if (this.unadjustedRefused) {
      void Promise.resolve(canvas.requestPointerLock()).catch(() => {});
      return;
    }
    try {
      const r = canvas.requestPointerLock({ unadjustedMovement: true });
      if (r && typeof (r as Promise<void>).catch === 'function') void (r as Promise<void>).catch(retry);
    } catch {
      retry();
    }
  }

  /** Drops every held control and pending edge. Called on blur, when hidden, and when a text field takes focus. */
  releaseAll(): void {
    this.down.clear();
    this.pending.clear();
    this.look[0] = 0;
    this.look[1] = 0;
    this.wheelUp = 0;
    this.wheelDown = 0;
  }

  poll(into: RawInputState, _nowMs: number): void {
    if (this.suspended()) this.releaseAll();
    // Controls released since the last poll leave the shared state.
    for (const c of [...this.written]) {
      if (!this.down.has(c) && !(c === 'mouse:wheelUp' && this.wheelUp > 0) && !(c === 'mouse:wheelDown' && this.wheelDown > 0)) {
        into.controls.delete(c);
        this.written.delete(c);
      }
    }
    for (const c of this.down) {
      into.controls.set(c, 1);
      this.written.add(c);
    }
    let activity = this.active || this.down.size > 0;
    for (const c of this.pending) {
      into.latchedPress.add(c);
      activity = true;
    }
    this.pending.clear();
    if (this.wheelUp > 0) {
      into.controls.set('mouse:wheelUp', this.wheelUp);
      into.latchedPress.add('mouse:wheelUp');
      this.written.add('mouse:wheelUp');
      this.wheelUp = 0;
      activity = true;
    }
    if (this.wheelDown > 0) {
      into.controls.set('mouse:wheelDown', this.wheelDown);
      into.latchedPress.add('mouse:wheelDown');
      this.written.add('mouse:wheelDown');
      this.wheelDown = 0;
      activity = true;
    }
    if (this.look[0] !== 0 || this.look[1] !== 0) {
      into.lookDelta[0] += this.look[0];
      into.lookDelta[1] += this.look[1];
      this.look[0] = 0;
      this.look[1] = 0;
      activity = true;
    }
    if (activity) into.lastActiveDevice = 'kbm';
    this.active = false;
  }

  // ------------------------------------------------------------------ events

  private suspended(): boolean {
    return this.opts.isTextFocus();
  }

  private on(target: BinderTarget, type: string, fn: (e: unknown) => void, capture = false): void {
    const listener = fn as (event: never) => void;
    if (capture) {
      target.addEventListener(type, listener, true);
      this.cleanups.push(() => target.removeEventListener(type, listener, true));
      return;
    }
    target.addEventListener(type, listener);
    this.cleanups.push(() => target.removeEventListener(type, listener));
  }

  private onTouchMark(e: TouchMarkLike): void {
    const touch = e.type === 'touchstart' || e.type === 'touchend' || e.pointerType === 'touch';
    if (touch && e.timeStamp !== undefined) this.lastTouchMs = e.timeStamp;
  }

  /** A compatibility mouse event that follows a tap (`TOUCH_COMPAT_MOUSE_MS`). */
  private fromTouch(e: MouseEventLike): boolean {
    if (e.sourceCapabilities?.firesTouchEvents === true) return true;
    if (this.lastTouchMs === null || e.timeStamp === undefined) return false;
    const since = e.timeStamp - this.lastTouchMs;
    return since >= 0 && since < TOUCH_COMPAT_MOUSE_MS;
  }

  private onKey(e: KeyEventLike, isDown: boolean): void {
    if (this.suspended()) {
      this.releaseAll();
      return;
    }
    const id = `key:${e.code}` as ControlId;
    if (GAME_KEYS.has(e.code)) e.preventDefault?.();
    this.active = true;
    if (isDown) {
      if (e.repeat === true || this.down.has(id)) return;
      this.down.add(id);
      this.pending.add(id);
    } else {
      this.down.delete(id);
    }
  }

  private onMouseButton(e: MouseEventLike, isDown: boolean): void {
    if (this.suspended() || this.fromTouch(e)) return;
    const b = e.button ?? 0;
    if (b < 0 || b > 4) return;
    const id = `mouse:${b}` as ControlId;
    this.active = true;
    if (isDown) {
      if (this.down.has(id)) return;
      this.down.add(id);
      this.pending.add(id);
    } else {
      this.down.delete(id);
    }
  }

  private onMouseMove(e: MouseEventLike): void {
    if (this.suspended() || !(this.opts.isLocked?.() ?? false)) return;
    this.look[0] += e.movementX ?? 0;
    this.look[1] += e.movementY ?? 0;
  }

  private onWheel(e: WheelEventLike): void {
    if (this.suspended()) return;
    e.preventDefault?.();
    const notches = wheelNotches(e.deltaY, e.deltaMode);
    // Up is a negative deltaY.
    if (notches < 0) this.wheelUp += -notches;
    else if (notches > 0) this.wheelDown += notches;
  }

  private onLockChange(): void {
    const locked = this.opts.isLocked?.() ?? false;
    if (this.wasLocked && !locked) {
      // Esc under Pointer Lock exits the lock and the key event never reaches the page.
      this.releaseAll();
      this.opts.onLockLost?.();
    }
    this.wasLocked = locked;
  }
}
