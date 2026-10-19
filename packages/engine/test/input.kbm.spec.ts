import type { RawInputState } from '@dv/shared';
import { describe, expect, it, vi } from 'vitest';
import { wheelNotches } from '../src/client/input/kbm.ts';
import { createRawInputState } from '../src/client/input/raw-state.ts';
import { makeRig } from './input-helpers.ts';

const poll = (r: ReturnType<typeof makeRig>, raw: RawInputState = createRawInputState()): RawInputState => {
  r.kbm.poll(raw, 0);
  return raw;
};

describe('kbm binder (AC-2)', () => {
  it('keys are KeyboardEvent.code: down sets the control, a tap between polls is only latched', () => {
    const r = makeRig();
    const raw = createRawInputState();
    r.key('KeyW', true);
    r.tap('KeyE');
    poll(r, raw);
    expect(raw.controls.get('key:KeyW')).toBe(1);
    expect(raw.controls.has('key:KeyE')).toBe(false);
    expect([...raw.latchedPress].sort()).toEqual(['key:KeyE', 'key:KeyW']);
    expect(raw.lastActiveDevice).toBe('kbm');
    r.key('KeyW', false);
    poll(r, raw);
    expect(raw.controls.has('key:KeyW')).toBe(false);
  });

  it('mouse buttons are mouse:0 to mouse:4; other buttons are ignored', () => {
    const r = makeRig();
    const raw = createRawInputState();
    r.win.emit('mousedown', { button: 0 });
    r.win.emit('mousedown', { button: 2 });
    r.win.emit('mousedown', { button: 9 });
    poll(r, raw);
    expect(raw.controls.get('mouse:0')).toBe(1);
    expect(raw.controls.get('mouse:2')).toBe(1);
    expect([...raw.controls.keys()].filter((c) => c.startsWith('mouse:'))).toHaveLength(2);
    r.win.emit('mouseup', { button: 0 });
    poll(r, raw);
    expect(raw.controls.has('mouse:0')).toBe(false);
  });

  it('wheel notches are normalized by deltaMode: 100 px, 3 lines or 1 page per notch; up is negative deltaY', () => {
    expect(wheelNotches(100, 0)).toBe(1);
    expect(wheelNotches(-300, 0)).toBe(-3);
    expect(wheelNotches(3, 1)).toBe(1);
    expect(wheelNotches(1, 2)).toBe(1);

    const r = makeRig();
    const raw = createRawInputState();
    r.win.emit('wheel', { deltaY: -100, deltaMode: 0 });
    r.win.emit('wheel', { deltaY: -3, deltaMode: 1 });
    r.win.emit('wheel', { deltaY: 1, deltaMode: 2 });
    poll(r, raw);
    expect(raw.controls.get('mouse:wheelUp')).toBe(2);
    expect(raw.controls.get('mouse:wheelDown')).toBe(1);
    expect(raw.latchedPress.has('mouse:wheelUp')).toBe(true);
    poll(r, raw); // a pulse lasts one poll
    expect(raw.controls.has('mouse:wheelUp')).toBe(false);
    expect(raw.controls.has('mouse:wheelDown')).toBe(false);
  });

  it('a click on the canvas requests Pointer Lock with unadjustedMovement: true', () => {
    const r = makeRig();
    r.canvas.emit('click');
    expect(r.canvas.locks).toEqual([{ unadjustedMovement: true }]);
  });

  it('when unadjustedMovement is refused the lock is requested again without it, once, with a warning', async () => {
    const warn = vi.fn();
    const r = makeRig({ kbm: { warn } });
    const calls: unknown[] = [];
    r.canvas.requestPointerLock = (o?: { unadjustedMovement?: boolean }): Promise<void> => {
      calls.push(o ?? null);
      return o?.unadjustedMovement ? Promise.reject(new Error('NotSupportedError')) : Promise.resolve();
    };
    r.canvas.emit('click');
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual([{ unadjustedMovement: true }, null]);
    expect(warn).toHaveBeenCalledTimes(1);
    r.canvas.emit('click'); // remembered: no second attempt with the option
    expect(calls).toEqual([{ unadjustedMovement: true }, null, null]);
  });

  it('no lock is requested while a text field has focus', () => {
    const r = makeRig();
    r.state.textFocus = true;
    r.canvas.emit('click');
    expect(r.canvas.locks).toEqual([]);
  });

  it('mouse movement is look only under Pointer Lock; the delta accumulates until polled', () => {
    const r = makeRig();
    const raw = createRawInputState();
    r.win.emit('mousemove', { movementX: 5, movementY: 5 });
    poll(r, raw);
    expect(raw.lookDelta).toEqual([0, 0]);
    r.state.locked = true;
    r.win.emit('mousemove', { movementX: 5, movementY: -2 });
    r.win.emit('mousemove', { movementX: 3, movementY: 1 });
    poll(r, raw);
    expect(raw.lookDelta).toEqual([8, -1]);
    poll(r, raw);
    expect(raw.lookDelta).toEqual([8, -1]); // the router resets it; the binder adds only new movement
  });

  it('losing Pointer Lock while it was held raises onLockLost and releases everything (Esc exits the lock)', () => {
    const lost = vi.fn();
    const r = makeRig({ kbm: { onLockLost: lost } });
    r.key('KeyW', true);
    r.state.locked = true;
    r.doc.emit('pointerlockchange');
    expect(lost).not.toHaveBeenCalled();
    r.state.locked = false;
    r.doc.emit('pointerlockchange');
    expect(lost).toHaveBeenCalledTimes(1);
    expect(poll(r).controls.has('key:KeyW')).toBe(false);
    r.doc.emit('pointerlockchange'); // already unlocked: nothing new
    expect(lost).toHaveBeenCalledTimes(1);
  });

  it('keys the browser would act on are cancelled; letters are not', () => {
    const r = makeRig();
    const space = vi.fn();
    const letter = vi.fn();
    r.win.emit('keydown', { code: 'Space', preventDefault: space });
    r.win.emit('keydown', { code: 'KeyW', preventDefault: letter });
    expect(space).toHaveBeenCalled();
    expect(letter).not.toHaveBeenCalled();
  });

  it('detach removes every listener and releases the keys', () => {
    const r = makeRig();
    r.key('KeyW', true);
    expect(r.kbm.connected).toBe(true);
    r.kbm.detach();
    expect(r.kbm.connected).toBe(false);
    for (const t of ['keydown', 'keyup', 'mousedown', 'mouseup', 'mousemove', 'wheel', 'blur']) expect(r.win.count(t), t).toBe(0);
    expect(r.doc.count('visibilitychange')).toBe(0);
    expect(r.canvas.count('click')).toBe(0);
    expect(poll(r).controls.size).toBe(0);
  });
});
