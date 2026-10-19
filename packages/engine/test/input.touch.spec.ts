import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SimButton, type InputFrame } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MAPS } from '../src/client/input/defaults.ts';
import { InputRouterImpl } from '../src/client/input/router.ts';
import { TouchBinder, TOUCH_MIN_HOLD_MS, type TouchLayout, type TouchVisual } from '../src/client/input/touch.ts';
import { CAM, FakeTarget } from './input-helpers.ts';

const layoutPath = fileURLToPath(new URL('../../../config/input/touch/default-right.json', import.meta.url));
const LAYOUT = JSON.parse(readFileSync(layoutPath, 'utf8')) as TouchLayout;
const VIEW = { w: 844, h: 390 };

/** A layout with six buttons, to reach the contact limit with distinct widgets. */
const BIG: TouchLayout = {
  ...LAYOUT,
  widgets: [
    ...LAYOUT.widgets,
    ...['b1', 'b2', 'b3'].map((id, i) => ({
      id, kind: 'button' as const, action: 'sim.Interact', at: { corner: 'bl' as const, dx: 10 + i * 60, dy: 10 }, sizePx: 48, icon: 'jump',
    })),
  ],
};

interface Ptr { type?: string; pointerId: number; pointerType: string; clientX: number; clientY: number; target?: unknown }

function rig(layout: TouchLayout = LAYOUT) {
  const target = new FakeTarget();
  const win = new FakeTarget();
  const clock = { t: 0 };
  const visuals: TouchVisual[] = [];
  const state = { visibility: 'visible' };
  const binder = new TouchBinder({
    layout,
    viewport: () => VIEW,
    now: () => clock.t,
    win,
    doc: win,
    visibility: () => state.visibility,
    // The test targets are plain objects carrying the button id.
    buttonAt: (t) => (t as { btn?: string } | undefined)?.btn ?? null,
    onVisual: (v) => visuals.push(v),
  });
  binder.attach(target);
  const router = new InputRouterImpl({ binders: [binder], now: () => clock.t, maps: DEFAULT_MAPS });
  const ptr = (type: string, id: number, x: number, y: number, extra: object = {}): void =>
    target.emit(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, ...extra } satisfies Ptr);
  const look = { yaw: 0, pitch: 0 };
  const sample = (tick = 1): InputFrame => {
    router.applyLook(1 / 60, look);
    return router.sample(tick, CAM);
  };
  return { target, win, clock, visuals, state, binder, router, ptr, look, sample };
}

const bit = (b: SimButton): number => 1 << b;

describe('TouchBinder with the default touch map (AC-2)', () => {
  it('a 29 px stick displacement gives |moveY| = 64 (half the 58 px radius)', () => {
    const r = rig();
    r.ptr('pointerdown', 1, 120, 300);
    r.ptr('pointermove', 1, 120, 271);
    const up = r.sample();
    expect(up.moveX).toBe(0);
    expect(Math.abs(up.moveY)).toBe(64);
    expect(up.moveY).toBeLessThan(0); // up is forward
    r.ptr('pointermove', 1, 120, 329);
    const down = r.sample(2);
    expect(down.moveY).toBe(64);
  });

  it('80 px sets Sprint and clamps the axis at 127; 70 px does not sprint', () => {
    const r = rig();
    r.ptr('pointerdown', 1, 120, 300);
    r.ptr('pointermove', 1, 120, 230);
    let f = r.sample();
    expect(f.buttons & bit(SimButton.Sprint)).toBe(0);
    expect(f.moveY).toBe(-127);
    r.ptr('pointermove', 1, 120, 220);
    f = r.sample(2);
    expect(f.buttons & bit(SimButton.Sprint)).not.toBe(0);
    expect(f.moveY).toBe(-127);
    r.ptr('pointermove', 1, 200, 300);
    f = r.sample(3);
    expect(f.moveX).toBe(127);
    // Lifting the finger stops everything.
    r.ptr('pointerup', 1, 200, 300);
    f = r.sample(4);
    expect([f.moveX, f.moveY, f.buttons & bit(SimButton.Sprint)]).toEqual([0, 0, 0]);
  });

  it('a diagonal drag keeps the magnitude at 1', () => {
    const r = rig();
    r.ptr('pointerdown', 1, 100, 300);
    r.ptr('pointermove', 1, 200, 200);
    const f = r.sample();
    expect(Math.hypot(f.moveX, f.moveY)).toBeLessThanOrEqual(127.5);
    expect(f.moveX).toBeGreaterThan(0);
    expect(f.moveY).toBeLessThan(0);
  });

  it('a 100 px look drag in the right half gives 0.75 rad of yaw (3.0 x 0.0025 rad per px)', () => {
    const r = rig();
    r.ptr('pointerdown', 2, 600, 200);
    r.ptr('pointermove', 2, 700, 200);
    r.sample(); // the binder's delta reaches the raw state here; the look applies on the next frame
    r.sample(2);
    expect(Math.abs(r.look.yaw)).toBeGreaterThan(0.749);
    expect(Math.abs(r.look.yaw)).toBeLessThan(0.751);
    expect(r.look.yaw).toBeLessThan(0); // dragging right turns right, a smaller yaw (as the mouse does)
    // The pitch follows a vertical drag.
    r.ptr('pointermove', 2, 700, 240);
    r.sample(3);
    r.sample(4);
    expect(r.look.pitch).toBeCloseTo(-(40 * 3.0 * 0.0025), 6);
  });

  it('the look delta is consumed once', () => {
    const r = rig();
    r.ptr('pointerdown', 2, 600, 200);
    r.ptr('pointermove', 2, 650, 200);
    r.sample();
    r.sample(2);
    const yaw = r.look.yaw;
    expect(yaw).toBeCloseTo(-50 * 3.0 * 0.0025, 6);
    r.sample(3);
    expect(r.look.yaw).toBe(yaw);
  });

  it('a 30 ms button tap is latched for exactly one tick and reads held for the 120 ms minimum', () => {
    const r = rig();
    r.clock.t = 1000;
    r.ptr('pointerdown', 3, 780, 340, { target: { btn: 'jump' } });
    r.clock.t = 1030;
    r.ptr('pointerup', 3, 780, 340, { target: { btn: 'jump' } });
    const f1 = r.sample(1);
    expect(f1.pressed & bit(SimButton.Jump)).not.toBe(0);
    expect(f1.buttons & bit(SimButton.Jump)).not.toBe(0); // still inside the minimum hold
    r.clock.t = 1060;
    const f2 = r.sample(2);
    expect(f2.pressed & bit(SimButton.Jump)).toBe(0); // the press edge does not repeat
    expect(f2.buttons & bit(SimButton.Jump)).not.toBe(0);
    r.clock.t = 1000 + TOUCH_MIN_HOLD_MS + 1;
    const f3 = r.sample(3);
    expect(f3.buttons & bit(SimButton.Jump)).toBe(0);
    expect(f3.released & bit(SimButton.Jump)).not.toBe(0);
  });

  it('pointercancel releases everything: stick, look, buttons and pending presses', () => {
    const r = rig();
    r.ptr('pointerdown', 1, 120, 300);
    r.ptr('pointermove', 1, 120, 220);
    r.ptr('pointerdown', 2, 600, 200);
    r.ptr('pointerdown', 3, 780, 340, { target: { btn: 'jump' } });
    expect(r.binder.contactCount).toBe(3);
    r.ptr('pointercancel', 3, 780, 340);
    expect(r.binder.contactCount).toBe(0);
    const f = r.sample();
    expect([f.moveX, f.moveY, f.buttons, f.pressed]).toEqual([0, 0, 0, 0]);
    expect(r.visuals.at(-1)).toEqual({ stick: null, pressed: [] });
  });

  it('blur and a hidden page release everything', () => {
    const r = rig();
    r.ptr('pointerdown', 1, 120, 300);
    r.ptr('pointermove', 1, 120, 220);
    r.win.emit('blur');
    expect(r.binder.contactCount).toBe(0);
    r.ptr('pointerdown', 1, 120, 300);
    r.ptr('pointermove', 1, 120, 220);
    r.state.visibility = 'hidden';
    r.win.emit('visibilitychange');
    expect(r.binder.contactCount).toBe(0);
    expect(r.sample().moveY).toBe(0);
  });

  it('tracks five contacts and ignores the sixth', () => {
    const r = rig(BIG);
    r.ptr('pointerdown', 1, 120, 300); // stick
    r.ptr('pointerdown', 2, 600, 200); // look
    r.ptr('pointerdown', 3, 780, 340, { target: { btn: 'jump' } });
    r.ptr('pointerdown', 4, 720, 260, { target: { btn: 'camera' } });
    r.ptr('pointerdown', 5, 30, 350, { target: { btn: 'b1' } });
    expect(r.binder.contactCount).toBe(5);
    r.ptr('pointerdown', 6, 90, 350, { target: { btn: 'b2' } });
    expect(r.binder.contactCount).toBe(5);
    // The sixth press never reached the raw state.
    r.sample();
    expect(r.router.raw.controls.has('touch:btn:b2')).toBe(false);
    expect(r.router.raw.controls.has('touch:btn:b1')).toBe(true);
    // After a release the sixth contact fits.
    r.ptr('pointerup', 5, 30, 350);
    r.ptr('pointerdown', 6, 90, 350, { target: { btn: 'b2' } });
    expect(r.binder.contactCount).toBe(5);
    r.sample(2);
    expect(r.router.raw.controls.has('touch:btn:b2')).toBe(true);
  });

  it('one pointer per widget: a second finger on a held button or in the stick zone is ignored', () => {
    const r = rig();
    r.ptr('pointerdown', 1, 780, 340, { target: { btn: 'jump' } });
    r.ptr('pointerdown', 2, 781, 341, { target: { btn: 'jump' } });
    expect(r.binder.contactCount).toBe(1);
    r.ptr('pointerdown', 3, 120, 300);
    r.ptr('pointerdown', 4, 200, 100);
    expect(r.binder.contactCount).toBe(2);
    // A contact outside every zone and button is not tracked either.
    r.ptr('pointerdown', 5, 10, 10, { target: { btn: 'nope' } });
    r.ptr('pointerdown', 6, 600, 200);
    r.ptr('pointerdown', 7, 650, 200);
    expect(r.binder.contactCount).toBe(3);
  });

  it('ignores mouse and pen pointers', () => {
    const r = rig();
    r.target.emit('pointerdown', { pointerId: 1, pointerType: 'mouse', clientX: 120, clientY: 300 });
    r.target.emit('pointerdown', { pointerId: 2, pointerType: 'pen', clientX: 120, clientY: 300 });
    expect(r.binder.contactCount).toBe(0);
  });

  it('accepts TouchEvents when no touch-typed pointer event has been seen, and ignores them after one', () => {
    const r = rig();
    r.target.emit('touchstart', { changedTouches: [{ identifier: 7, clientX: 120, clientY: 300 }] });
    r.target.emit('touchmove', { changedTouches: [{ identifier: 7, clientX: 120, clientY: 271 }] });
    expect(Math.abs(r.sample().moveY)).toBe(64);
    r.target.emit('touchend', { changedTouches: [{ identifier: 7, clientX: 120, clientY: 271 }] });
    expect(r.sample(2).moveY).toBe(0);
    // Once a pointer event arrives, the duplicate touch events of a real device are dropped.
    r.ptr('pointerdown', 1, 120, 300);
    r.target.emit('touchstart', { changedTouches: [{ identifier: 9, clientX: 600, clientY: 200 }] });
    expect(r.binder.contactCount).toBe(1);
  });

  it('makes touch the active device and detaches cleanly', () => {
    const r = rig();
    expect(r.router.active).toBe('kbm');
    r.ptr('pointerdown', 1, 120, 300);
    r.sample();
    expect(r.router.active).toBe('touch');
    r.binder.detach();
    expect(r.target.count('pointerdown')).toBe(0);
    expect(r.binder.connected).toBe(false);
  });

  it('Camera and Pause resolve through bindings: client actions fire from touch buttons', () => {
    const r = rig();
    const seen: string[] = [];
    r.router.onClientAction((a, phase) => seen.push(`${a}:${phase}`));
    r.ptr('pointerdown', 4, 720, 260, { target: { btn: 'camera' } });
    r.ptr('pointerdown', 5, 800, 30, { target: { btn: 'pause' } });
    r.sample();
    expect(seen).toContain('1:pressed'); // ClientAction.Camera
    expect(seen).toContain('5:pressed'); // ClientAction.Pause
  });
});
