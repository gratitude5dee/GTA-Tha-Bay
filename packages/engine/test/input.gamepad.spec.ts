import { SimButton } from '@dv/shared';
import { describe, expect, it, vi } from 'vitest';
import { GamepadBinder, type GamepadLike } from '../src/client/input/gamepad.ts';
import { createRawInputState } from '../src/client/input/raw-state.ts';
import { InputRouterImpl } from '../src/client/input/router.ts';
import { CAM } from './input-helpers.ts';

interface FakePad extends GamepadLike {
  buttons: { pressed: boolean; value: number }[];
  axes: number[];
  connected: boolean;
  mapping: string;
}

function fakePad(over: Partial<FakePad> = {}): FakePad {
  return {
    index: 0,
    id: 'Test Pad (STANDARD GAMEPAD)',
    connected: true,
    mapping: 'standard',
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    axes: [0, 0, 0, 0],
    ...over,
  };
}

const press = (pad: FakePad, i: number, down: boolean): void => {
  pad.buttons[i] = { pressed: down, value: down ? 1 : 0 };
};

function rig(pad: FakePad | null, warn = vi.fn()): { router: InputRouterImpl; binder: GamepadBinder; warn: ReturnType<typeof vi.fn>; set: (p: FakePad | null) => void } {
  let current = pad;
  const binder = new GamepadBinder({ getPads: () => [current], warn });
  const router = new InputRouterImpl({ binders: [binder], now: () => 0 });
  return { router, binder, warn, set: (p) => { current = p; } };
}

describe('gamepad binder (AC-3)', () => {
  it('standard mapping: axes [0.6, -1, 0, 0] and b0 down give moveX 76, moveY -127 and Jump held', () => {
    const pad = fakePad({ axes: [0.6, -1, 0, 0] });
    press(pad, 0, true);
    const { router, binder } = rig(pad);
    const f = router.sample(1, CAM);
    expect(f.moveX).toBe(76);
    expect(f.moveY).toBe(-127);
    expect(f.buttons & (1 << SimButton.Jump)).not.toBe(0);
    expect(f.pressed & (1 << SimButton.Jump)).not.toBe(0);
    expect(binder.connected).toBe(true);
    expect(router.active).toBe('gamepad');
    expect(f.device).toBe(1);
  });

  it('a pad with mapping "" produces no input and one warning, however often it is polled', () => {
    const pad = fakePad({ mapping: '', axes: [1, 1, 0, 0] });
    press(pad, 0, true);
    const { router, binder, warn } = rig(pad);
    for (let i = 0; i < 5; i++) {
      const f = router.sample(i, CAM);
      expect([f.buttons, f.moveX, f.moveY]).toEqual([0, 0, 0]);
    }
    expect(warn).toHaveBeenCalledTimes(1);
    expect(binder.connected).toBe(false);
  });

  it('disconnect clears all bits: a pad that vanishes, or reports connected: false, releases everything', () => {
    for (const how of ['gone', 'flag'] as const) {
      const pad = fakePad({ axes: [0.6, -1, 0, 0] });
      press(pad, 0, true);
      press(pad, 10, true);
      const r = rig(pad);
      const held = r.router.sample(1, CAM);
      expect(held.buttons).not.toBe(0);
      if (how === 'gone') r.set(null);
      else pad.connected = false;
      const f = r.router.sample(2, CAM);
      expect(f.buttons, how).toBe(0);
      expect([f.moveX, f.moveY], how).toEqual([0, 0]);
      expect(f.released & (1 << SimButton.Jump), how).not.toBe(0);
      expect(r.binder.connected, how).toBe(false);
    }
  });

  it('a stick inside the dead zone is zero; just outside it passes through unscaled', () => {
    const pad = fakePad({ axes: [0.1, -0.13, 0, 0] });
    const { router } = rig(pad);
    const f = router.sample(1, CAM);
    expect(f.moveX).toBe(0);
    expect(f.moveY).toBe(Math.round(-0.13 * 127));
  });

  it('raw state: buttons are pad:bN with analog values, axes are pad:aN, edges are latched', () => {
    const pad = fakePad({ axes: [0, 0, -0.5, 0.25] });
    pad.buttons[7] = { pressed: false, value: 0.4 };
    press(pad, 3, true);
    const binder = new GamepadBinder({ getPads: () => [pad] });
    const raw = createRawInputState();
    binder.poll(raw, 0);
    expect(raw.controls.get('pad:b3')).toBe(1);
    expect(raw.controls.get('pad:b7')).toBe(0.4);
    expect(raw.controls.get('pad:a2')).toBe(-0.5);
    expect(raw.controls.get('pad:a3')).toBe(0.25);
    expect(raw.latchedPress.has('pad:b3')).toBe(true);
    expect(raw.latchedPress.has('pad:b7')).toBe(false); // a trigger at 0.4 of travel is not a press
  });

  it('a button held across polls latches one press; releasing and pressing again latches another', () => {
    const pad = fakePad();
    const binder = new GamepadBinder({ getPads: () => [pad] });
    const raw = createRawInputState();
    press(pad, 0, true);
    binder.poll(raw, 0);
    expect(raw.latchedPress.has('pad:b0')).toBe(true);
    raw.latchedPress.clear();
    binder.poll(raw, 1);
    expect(raw.latchedPress.has('pad:b0')).toBe(false);
    press(pad, 0, false);
    binder.poll(raw, 2);
    expect(raw.controls.has('pad:b0')).toBe(false);
    press(pad, 0, true);
    binder.poll(raw, 3);
    expect(raw.latchedPress.has('pad:b0')).toBe(true);
  });

  it('of two pads, the first with the standard mapping wins', () => {
    const odd = fakePad({ index: 0, mapping: '', id: 'odd' });
    const good = fakePad({ index: 1, id: 'good', axes: [1, 0, 0, 0] });
    const binder = new GamepadBinder({ getPads: () => [odd, good], warn: () => {} });
    const raw = createRawInputState();
    binder.poll(raw, 0);
    expect(raw.controls.get('pad:a0')).toBe(1);
  });

  it('b10 is Sprint, b3 is Interact and b11 raises the camera action; b9 pauses', () => {
    const pad = fakePad();
    const { router } = rig(pad);
    const seen: number[] = [];
    router.onClientAction((a, phase) => {
      if (phase === 'pressed') seen.push(a);
    });
    press(pad, 10, true);
    press(pad, 3, true);
    press(pad, 11, true);
    press(pad, 9, true);
    const f = router.sample(1, CAM);
    expect(f.buttons & (1 << SimButton.Sprint)).not.toBe(0);
    expect(f.buttons & (1 << SimButton.Interact)).not.toBe(0);
    expect(seen).toContain(1); // ClientAction.Camera
    expect(seen).toContain(5); // ClientAction.Pause
  });
});
