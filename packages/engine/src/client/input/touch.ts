import type { Binder, BinderTarget, ControlId, DeviceKind, RawInputState } from '@dv/shared';

/**
 * Touch layout shapes: the engine-local structural copy of S10's `TouchLayout` v1 (10-ui-hud-xr.md section 2.9). S10 moves
 * the type into `packages/ui` in M04b2; this file keeps the engine free of that package. Zones are fractions of the viewport
 * (the S10 text leaves `Rect` open; proposal for M04b2), anchors are CSS px from the safe-area corner.
 */
export interface TouchRect { x: number; y: number; w: number; h: number }
export interface TouchAnchor { corner: 'bl' | 'br' | 'tl' | 'tr'; dx: number; dy: number }
export type TouchWidget =
  | { id: string; kind: 'stick'; role: 'move' | 'steer'; zone: TouchRect }
  | { id: string; kind: 'lookzone'; zone: TouchRect }
  | { id: string; kind: 'button'; action: string; at: TouchAnchor; sizePx: number; icon: string; label?: string; toggle?: boolean };
export interface TouchLayout {
  v: 1;
  id: string;
  nameKey: string;
  context: 'onFoot' | 'vehicle' | 'fighter';
  handed: 'right' | 'left';
  widgets: TouchWidget[];
}

/** C03 rule 10 numbers (research/repos-webport.md section 3.6). */
export const TOUCH_STICK_RADIUS_PX = 58;
export const TOUCH_KNOB_RADIUS_PX = 26;
/** The stick sprints beyond this multiple of the radius. */
export const TOUCH_SPRINT_FACTOR = 1.35;
/** Sprint switches off again below this multiple (hysteresis, so the edge of the threshold does not flicker). */
export const TOUCH_SPRINT_RELEASE_FACTOR = 1.25;
/** Look gain (C03 rule 10) times the design scale 0.0025 rad per px: radians per px of drag at sensitivity 1. */
export const TOUCH_LOOK_GAIN = 3.0;
export const TOUCH_LOOK_RAD_PER_PX = 0.0025;
export const TOUCH_LOOK_RAD_PER_DRAG_PX = TOUCH_LOOK_GAIN * TOUCH_LOOK_RAD_PER_PX;
/** A button stays down at least this long, so a tap shorter than a few ticks still reads as pressed. */
export const TOUCH_MIN_HOLD_MS = 120;
/** Simultaneous contacts (design value). */
export const TOUCH_MAX_CONTACTS = 5;

/** The analog half-axes the stick writes into the raw state; the touch map binds them like gamepad axes. */
export const STICK_CONTROLS = {
  right: 'touch:btn:moveRight',
  left: 'touch:btn:moveLeft',
  down: 'touch:btn:moveDown',
  up: 'touch:btn:moveUp',
  sprint: 'touch:btn:sprint',
  magnitude: 'touch:stick:L',
} as const satisfies Record<string, ControlId>;

/** The fields of a DOM `PointerEvent` the binder reads. Structural, so tests pass plain objects. */
export interface PointerEventLike {
  type?: string;
  pointerId: number;
  pointerType?: string;
  clientX: number;
  clientY: number;
  target?: unknown;
  preventDefault?: () => void;
}
export interface TouchPointLike { identifier: number; clientX: number; clientY: number; target?: unknown }
/** The fields of a DOM `TouchEvent` the fallback reads. */
export interface TouchEventLike {
  type?: string;
  changedTouches: ArrayLike<TouchPointLike>;
  preventDefault?: () => void;
}

/** What the overlay draws. */
export interface TouchVisual {
  stick: { originX: number; originY: number; knobX: number; knobY: number; sprint: boolean } | null;
  /** Button ids currently held. */
  pressed: readonly string[];
}

export interface TouchBinderOptions {
  layout: TouchLayout;
  /** The viewport in CSS px (the stick and look zones are fractions of it). */
  viewport: () => { w: number; h: number };
  /** The button id under a contact's target, or null. The overlay reads a `data-dv-btn` attribute. */
  buttonAt?: (target: unknown) => string | null;
  /** Milliseconds. Defaults to `performance.now`. */
  now?: () => number;
  /** `document.visibilityState`. */
  visibility?: () => string;
  /** Receives `blur`. Defaults to the attach target. */
  win?: BinderTarget;
  /** Receives `visibilitychange`. Defaults to the attach target. */
  doc?: BinderTarget;
  radiusPx?: number;
  onVisual?: (v: TouchVisual) => void;
}

type Contact =
  | { kind: 'stick'; ox: number; oy: number; x: number; y: number }
  | { kind: 'look'; x: number; y: number }
  | { kind: 'button'; id: string };

interface ButtonState { down: boolean; pressedAt: number }

function inZone(z: TouchRect, x: number, y: number, vw: number, vh: number): boolean {
  return x >= z.x * vw && x < (z.x + z.w) * vw && y >= z.y * vh && y < (z.y + z.h) * vh;
}

/** Reads the `data-dv-btn` attribute of the nearest element at or above the target (the overlay sets it on its buttons). */
export function buttonFromTarget(target: unknown): string | null {
  const t = target as { closest?: (s: string) => { getAttribute(n: string): string | null } | null } | null | undefined;
  const el = t?.closest?.('[data-dv-btn]');
  return el?.getAttribute('data-dv-btn') ?? null;
}

/**
 * Touch binder (C03, S10 section 2.9). Pointer Events with `pointerType: 'touch'` drive three kinds of widget, one contact
 * each, at most five contacts at once:
 *  - a floating left stick: its origin is the first contact in the stick zone, radius 58 px; the displacement over the
 *    radius is the axis, and beyond 1.35 x radius the sprint control goes down;
 *  - right-half look: the drag delta goes into the raw look delta in pixels, and the router turns it into radians
 *    (3.0 x 0.0025 rad per px x the touch sensitivity);
 *  - buttons: a press is latched, and the button reads as held for at least 120 ms.
 * `pointercancel`, `blur` and the page becoming hidden release everything. TouchEvents are accepted as a fallback for
 * engines whose synthetic pointer events carry no `pointerType` (M01b2 risk); once a touch-typed pointer event has been
 * seen, TouchEvents are ignored, because real devices send both for the same contact.
 */
export class TouchBinder implements Binder {
  readonly device: DeviceKind = 'touch';
  private target: BinderTarget | null = null;
  private readonly contacts = new Map<string, Contact>();
  private readonly buttons = new Map<string, ButtonState>();
  private readonly pending = new Set<ControlId>();
  private readonly written = new Set<ControlId>();
  private look: [number, number] = [0, 0];
  private active = false;
  private sprint = false;
  private usingPointer = false;
  private readonly cleanups: (() => void)[] = [];
  private readonly radius: number;
  private readonly nowFn: () => number;
  private readonly buttonAtFn: (target: unknown) => string | null;
  private buttonIds: ReadonlySet<string> = new Set();
  private stickZone: TouchRect | null = null;
  private lookZone: TouchRect | null = null;
  /** The stick is a steering arc (racing): only its horizontal half-axes are written. */
  private steerOnly = false;

  constructor(private readonly opts: TouchBinderOptions) {
    this.radius = opts.radiusPx ?? TOUCH_STICK_RADIUS_PX;
    this.nowFn = opts.now ?? ((): number => performance.now());
    this.buttonAtFn = opts.buttonAt ?? buttonFromTarget;
    this.setLayout(opts.layout);
  }

  /** Switches the widgets (a mode with its own layout, M07a1): zones and button ids change, every contact is released. */
  setLayout(layout: TouchLayout): void {
    const ids = new Set<string>();
    let stick: TouchRect | null = null;
    let steer = false;
    let lookZone: TouchRect | null = null;
    for (const w of layout.widgets) {
      if (w.kind === 'button') ids.add(w.id);
      else if (w.kind === 'stick' && !stick) {
        stick = w.zone;
        steer = w.role === 'steer';
      } else if (w.kind === 'lookzone' && !lookZone) lookZone = w.zone;
    }
    this.buttonIds = ids;
    this.stickZone = stick;
    this.steerOnly = steer;
    this.lookZone = lookZone;
    this.releaseAll();
  }

  get connected(): boolean {
    return this.target !== null;
  }

  /** Contacts currently tracked (tests and the bridge). */
  get contactCount(): number {
    return this.contacts.size;
  }

  attach(target: BinderTarget): void {
    if (this.target) this.detach();
    this.target = target;
    this.on(target, 'pointerdown', (e) => this.onPointerDown(e as PointerEventLike));
    this.on(target, 'pointermove', (e) => this.onPointerMove(e as PointerEventLike));
    this.on(target, 'pointerup', (e) => this.onPointerEnd(e as PointerEventLike));
    this.on(target, 'pointercancel', () => this.releaseAll());
    this.on(target, 'touchstart', (e) => this.onTouch(e as TouchEventLike, 'start'));
    this.on(target, 'touchmove', (e) => this.onTouch(e as TouchEventLike, 'move'));
    this.on(target, 'touchend', (e) => this.onTouch(e as TouchEventLike, 'end'));
    this.on(target, 'touchcancel', () => this.releaseAll());
    this.on(this.opts.win ?? target, 'blur', () => this.releaseAll());
    this.on(this.opts.doc ?? target, 'visibilitychange', () => {
      if ((this.opts.visibility?.() ?? 'hidden') !== 'visible') this.releaseAll();
    });
  }

  detach(): void {
    for (const off of this.cleanups.splice(0)) off();
    this.releaseAll();
    this.target = null;
  }

  /** Drops every contact, held button and pending edge (cancel, blur, hidden page, detach). */
  releaseAll(): void {
    const had = this.contacts.size > 0 || this.buttons.size > 0;
    this.contacts.clear();
    this.buttons.clear();
    this.pending.clear();
    this.look[0] = 0;
    this.look[1] = 0;
    this.sprint = false;
    if (had) this.emitVisual();
  }

  poll(into: RawInputState, nowMs: number): void {
    let activity = this.active || this.contacts.size > 0;
    // Buttons: held while down or inside the minimum hold.
    const nowHeld = new Set<ControlId>();
    for (const [id, b] of this.buttons) {
      const held = b.down || nowMs - b.pressedAt < TOUCH_MIN_HOLD_MS;
      if (held) nowHeld.add(`touch:btn:${id}` as ControlId);
      else this.buttons.delete(id);
    }
    const stick = this.stickVector();
    const writes: [ControlId, number][] = [];
    if (stick) {
      writes.push([STICK_CONTROLS.right, Math.max(0, stick.ax)], [STICK_CONTROLS.left, Math.max(0, -stick.ax)]);
      writes.push([STICK_CONTROLS.down, Math.max(0, stick.ay)], [STICK_CONTROLS.up, Math.max(0, -stick.ay)]);
      writes.push([STICK_CONTROLS.magnitude, stick.mag]);
      if (this.sprint) writes.push([STICK_CONTROLS.sprint, 1]);
    }
    const current = new Set<ControlId>(nowHeld);
    for (const [c, v] of writes) if (v > 0) current.add(c);
    for (const c of [...this.written]) {
      if (!current.has(c)) {
        into.controls.delete(c);
        this.written.delete(c);
      }
    }
    for (const c of nowHeld) {
      into.controls.set(c, 1);
      this.written.add(c);
    }
    for (const [c, v] of writes) {
      if (v > 0) {
        into.controls.set(c, v);
        this.written.add(c);
      }
    }
    for (const c of this.pending) {
      into.latchedPress.add(c);
      activity = true;
    }
    this.pending.clear();
    if (this.look[0] !== 0 || this.look[1] !== 0) {
      into.lookDelta[0] += this.look[0];
      into.lookDelta[1] += this.look[1];
      this.look[0] = 0;
      this.look[1] = 0;
      activity = true;
    }
    if (activity) into.lastActiveDevice = 'touch';
    this.active = false;
  }

  // ------------------------------------------------------------------ events

  private on(target: BinderTarget, type: string, fn: (e: unknown) => void): void {
    const listener = fn as (event: never) => void;
    target.addEventListener(type, listener);
    this.cleanups.push(() => target.removeEventListener(type, listener));
  }

  private onPointerDown(e: PointerEventLike): void {
    if (e.pointerType !== 'touch') return;
    this.usingPointer = true;
    const accepted = this.start(`p${e.pointerId}`, e.clientX, e.clientY, e.target);
    if (accepted) {
      const t = e.target as { setPointerCapture?: (id: number) => void } | null | undefined;
      try {
        t?.setPointerCapture?.(e.pointerId);
      } catch {
        // The pointer may already be gone (synthetic events have no active pointer to capture).
      }
      e.preventDefault?.();
    }
  }

  private onPointerMove(e: PointerEventLike): void {
    if (e.pointerType !== 'touch') return;
    this.move(`p${e.pointerId}`, e.clientX, e.clientY);
  }

  private onPointerEnd(e: PointerEventLike): void {
    if (e.pointerType !== 'touch') return;
    this.end(`p${e.pointerId}`);
  }

  private onTouch(e: TouchEventLike, phase: 'start' | 'move' | 'end'): void {
    if (this.usingPointer) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i] as TouchPointLike;
      const key = `t${t.identifier}`;
      if (phase === 'start') this.start(key, t.clientX, t.clientY, t.target);
      else if (phase === 'move') this.move(key, t.clientX, t.clientY);
      else this.end(key);
    }
    if (phase !== 'end') e.preventDefault?.();
  }

  // ------------------------------------------------------------------ contacts

  private start(key: string, x: number, y: number, target: unknown): boolean {
    if (this.contacts.has(key) || this.contacts.size >= TOUCH_MAX_CONTACTS) return false;
    this.active = true;
    const btn = this.buttonAtFn(target);
    if (btn && this.buttonIds.has(btn)) {
      for (const c of this.contacts.values()) if (c.kind === 'button' && c.id === btn) return false; // one pointer per widget
      this.contacts.set(key, { kind: 'button', id: btn });
      this.buttons.set(btn, { down: true, pressedAt: this.nowFn() });
      this.pending.add(`touch:btn:${btn}` as ControlId);
      this.emitVisual();
      return true;
    }
    const { w, h } = this.opts.viewport();
    if (this.stickZone && inZone(this.stickZone, x, y, w, h) && !this.hasContact('stick')) {
      this.contacts.set(key, { kind: 'stick', ox: x, oy: y, x, y });
      this.emitVisual();
      return true;
    }
    if (this.lookZone && inZone(this.lookZone, x, y, w, h) && !this.hasContact('look')) {
      this.contacts.set(key, { kind: 'look', x, y });
      return true;
    }
    return false;
  }

  private move(key: string, x: number, y: number): void {
    const c = this.contacts.get(key);
    if (!c) return;
    this.active = true;
    if (c.kind === 'stick') {
      c.x = x;
      c.y = y;
      const mag = Math.hypot(x - c.ox, y - c.oy) / this.radius;
      if (mag > TOUCH_SPRINT_FACTOR) this.sprint = true;
      else if (mag < TOUCH_SPRINT_RELEASE_FACTOR) this.sprint = false;
      this.emitVisual();
    } else if (c.kind === 'look') {
      this.look[0] += x - c.x;
      this.look[1] += y - c.y;
      c.x = x;
      c.y = y;
    }
  }

  private end(key: string): void {
    const c = this.contacts.get(key);
    if (!c) return;
    this.contacts.delete(key);
    this.active = true;
    if (c.kind === 'button') {
      const b = this.buttons.get(c.id);
      if (b) b.down = false;
    } else if (c.kind === 'stick') {
      this.sprint = false;
    }
    this.emitVisual();
  }

  private hasContact(kind: Contact['kind']): boolean {
    for (const c of this.contacts.values()) if (c.kind === kind) return true;
    return false;
  }

  /** The stick as per-axis values in [-1, 1] (magnitude capped at 1), or null with no stick contact. */
  private stickVector(): { ax: number; ay: number; mag: number } | null {
    for (const c of this.contacts.values()) {
      if (c.kind !== 'stick') continue;
      let ax = (c.x - c.ox) / this.radius;
      let ay = this.steerOnly ? 0 : (c.y - c.oy) / this.radius;
      const m = Math.hypot(ax, ay);
      if (m > 1) {
        ax /= m;
        ay /= m;
      }
      return { ax, ay, mag: Math.min(1, m) };
    }
    return null;
  }

  private emitVisual(): void {
    if (!this.opts.onVisual) return;
    let stick: TouchVisual['stick'] = null;
    for (const c of this.contacts.values()) {
      if (c.kind !== 'stick') continue;
      const dx = c.x - c.ox;
      const dy = c.y - c.oy;
      const m = Math.hypot(dx, dy);
      const k = m > this.radius ? this.radius / m : 1;
      stick = { originX: c.ox, originY: c.oy, knobX: c.ox + dx * k, knobY: c.oy + dy * k, sprint: this.sprint };
    }
    const pressed: string[] = [];
    for (const [id, b] of this.buttons) if (b.down) pressed.push(id);
    this.opts.onVisual({ stick, pressed });
  }
}
