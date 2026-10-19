import { Axis, ClientAction, SimButton, type ControlsSettings } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTROLS, DEFAULT_MAPS, PITCH_LIMIT } from '../src/client/input/defaults.ts';
import { GamepadBinder } from '../src/client/input/gamepad.ts';
import { pitchToI16, quantAxis, quantTrigger, u16ToYaw, yawToU16 } from '../src/client/input/quantize.ts';
import { AXES, CLIENT_ACTIONS, CONTEXT_ORDER, DEVICE_ORDER, InputRouterImpl, SIM_BITS } from '../src/client/input/router.ts';
import { writeInputFrame } from '../src/client/input/index.ts';
import { InputBlock } from '../src/sim/transport/input-block.ts';
import { CAM, makeRig } from './input-helpers.ts';

const bit = (b: SimButton): number => 1 << b;
const settings = (over: Partial<ControlsSettings>): ControlsSettings => ({ ...DEFAULT_CONTROLS, ...over });

describe('InputRouter with the kbm defaults (AC-2)', () => {
  it('a keydown and keyup between two samples set pressed on exactly one frame', () => {
    const r = makeRig();
    r.tap('KeyE');
    const a = r.router.sample(1, CAM);
    expect(a.pressed & bit(SimButton.Interact)).not.toBe(0);
    expect(a.buttons & bit(SimButton.Interact)).toBe(0); // gone before the sample
    expect(a.released & bit(SimButton.Interact)).not.toBe(0);
    const b = r.router.sample(2, CAM);
    expect(b.pressed).toBe(0);
    expect(b.released).toBe(0);
  });

  it('a held key is pressed on its first frame only, held on all, and released on one', () => {
    const r = makeRig();
    r.key('Space', true);
    const f1 = r.router.sample(1, CAM);
    const f2 = r.router.sample(2, CAM);
    r.key('Space', false);
    const f3 = r.router.sample(3, CAM);
    const f4 = r.router.sample(4, CAM);
    const j = bit(SimButton.Jump);
    expect([f1.buttons & j, f2.buttons & j, f3.buttons & j]).toEqual([j, j, 0]);
    expect([f1.pressed & j, f2.pressed & j, f3.pressed & j]).toEqual([j, 0, 0]);
    expect([f2.released & j, f3.released & j, f4.released & j]).toEqual([0, j, 0]);
  });

  it('key repeat does not press again', () => {
    const r = makeRig();
    r.key('Space', true);
    r.router.sample(1, CAM);
    r.key('Space', true, { repeat: true });
    expect(r.router.sample(2, CAM).pressed).toBe(0);
  });

  it('WASD and Shift give quantized axes and the Sprint bit; opposite keys cancel', () => {
    const r = makeRig();
    r.key('KeyW', true);
    r.key('ShiftLeft', true);
    let f = r.router.sample(1, CAM);
    expect([f.moveX, f.moveY]).toEqual([0, -127]);
    expect(f.buttons & bit(SimButton.Sprint)).not.toBe(0);
    r.key('KeyD', true);
    f = r.router.sample(2, CAM);
    expect([f.moveX, f.moveY]).toEqual([127, -127]);
    r.key('KeyA', true);
    f = r.router.sample(3, CAM);
    expect(f.moveX).toBe(0);
    r.key('KeyS', true);
    f = r.router.sample(4, CAM);
    expect(f.moveY).toBe(0);
  });

  it('a 300 ms hold fires hold; a shorter press does not', () => {
    const r = makeRig({
      router: { settings: settings({ overrides: { kbm: { onFoot: { 'sim.Special': [{ control: 'key:KeyQ', gesture: 'hold' }] } } } }) },
    });
    const special = bit(SimButton.Special);
    r.clock.t = 1000;
    r.key('KeyQ', true);
    expect(r.router.sample(1, CAM).pressed & special).toBe(0);
    r.clock.t = 1299;
    const early = r.router.sample(2, CAM);
    expect(early.pressed & special).toBe(0);
    expect(early.buttons & special).toBe(0);
    r.clock.t = 1300;
    const fired = r.router.sample(3, CAM);
    expect(fired.pressed & special).not.toBe(0);
    expect(fired.buttons & special).not.toBe(0);
    r.clock.t = 1400;
    const still = r.router.sample(4, CAM);
    expect(still.pressed & special).toBe(0);
    expect(still.buttons & special).not.toBe(0);
    r.key('KeyQ', false);
    expect(r.router.sample(5, CAM).released & special).not.toBe(0);

    // A tap of 100 ms never fires.
    r.clock.t = 2000;
    r.key('KeyQ', true);
    r.router.sample(6, CAM);
    r.clock.t = 2100;
    r.key('KeyQ', false);
    const tap = r.router.sample(7, CAM);
    expect(tap.pressed & special).toBe(0);
  });

  it('two taps 400 ms apart fire doubleTap; two taps 500 ms apart do not', () => {
    const r = makeRig({
      router: { settings: settings({ overrides: { kbm: { onFoot: { 'sim.Emote': [{ control: 'key:KeyG', gesture: 'doubleTap' }] } } } }) },
    });
    const emote = bit(SimButton.Emote);
    r.clock.t = 0;
    r.tap('KeyG');
    expect(r.router.sample(1, CAM).pressed & emote).toBe(0);
    r.clock.t = 400;
    r.tap('KeyG');
    expect(r.router.sample(2, CAM).pressed & emote).not.toBe(0);
    expect(r.router.sample(3, CAM).pressed & emote).toBe(0);

    r.clock.t = 2000;
    r.tap('KeyG');
    r.router.sample(4, CAM);
    r.clock.t = 2500;
    r.tap('KeyG');
    expect(r.router.sample(5, CAM).pressed & emote).toBe(0);
  });

  it('a chord fires only while its modifiers are held', () => {
    const r = makeRig({
      router: {
        settings: settings({ overrides: { kbm: { onFoot: { 'sim.Block': [{ control: 'key:KeyR', modifiers: ['key:ControlLeft'] }] } } } }),
      },
    });
    const block = bit(SimButton.Block);
    r.key('KeyR', true);
    expect(r.router.sample(1, CAM).buttons & block).toBe(0);
    r.key('KeyR', false);
    r.key('ControlLeft', true);
    expect(r.router.sample(2, CAM).buttons & block).toBe(0);
    r.key('KeyR', true);
    expect(r.router.sample(3, CAM).buttons & block).not.toBe(0);
    r.key('ControlLeft', false);
    expect(r.router.sample(4, CAM).buttons & block).toBe(0);
  });

  it('sim.Sprint in holdToToggle latches on a tap and unlatches on the next', () => {
    const r = makeRig({ router: { settings: settings({ holdToToggle: ['sim.Sprint'] }) } });
    const sprint = bit(SimButton.Sprint);
    r.tap('ShiftLeft');
    expect(r.router.sample(1, CAM).buttons & sprint).not.toBe(0);
    expect(r.router.sample(2, CAM).buttons & sprint).not.toBe(0);
    r.key('ShiftLeft', true);
    expect(r.router.sample(3, CAM).buttons & sprint).toBe(0);
    r.key('ShiftLeft', false);
    expect(r.router.sample(4, CAM).buttons & sprint).toBe(0);
    r.tap('ShiftLeft');
    expect(r.router.sample(5, CAM).buttons & sprint).not.toBe(0);
  });

  it('pushing the menu context drops the onFoot bits and axes; popping restores them', () => {
    const r = makeRig();
    r.key('KeyW', true);
    r.key('Space', true);
    expect(r.router.sample(1, CAM).buttons & bit(SimButton.Jump)).not.toBe(0);
    r.router.push('menu');
    expect(r.router.top()).toBe('menu');
    const m = r.router.sample(2, CAM);
    expect(m.buttons).toBe(0);
    expect(m.moveY).toBe(0);
    expect(m.context).toBe(CONTEXT_ORDER.indexOf('menu'));
    expect(m.released & bit(SimButton.Jump)).not.toBe(0); // the drop is a release
    r.router.pop('menu');
    expect(r.router.top()).toBe('onFoot');
    const back = r.router.sample(3, CAM);
    expect(back.moveY).toBe(-127);
    expect(back.buttons & bit(SimButton.Jump)).not.toBe(0);
  });

  it('menu actions fire client actions in the menu context only', () => {
    const r = makeRig();
    const seen: string[] = [];
    r.router.onClientAction((a, phase) => seen.push(`${a}:${phase}`));
    r.tap('Enter');
    r.router.sample(1, CAM);
    expect(seen).toEqual([]); // Enter is not bound on foot
    r.router.push('menu');
    r.tap('Enter');
    r.router.sample(2, CAM);
    expect(seen).toContain(`${ClientAction.UiAccept}:pressed`);
  });

  it('an override that removes Esc still pauses on Esc, in every context', () => {
    const r = makeRig({ router: { settings: settings({ overrides: { kbm: { onFoot: { 'client.Pause': [{ control: 'key:F1' }] } } } }) } });
    const seen: string[] = [];
    r.router.onClientAction((a, phase) => seen.push(`${a}:${phase}`));
    r.tap('Escape');
    r.router.sample(1, CAM);
    expect(seen).toContain(`${ClientAction.Pause}:pressed`);
    seen.length = 0;
    r.tap('F1');
    r.router.sample(2, CAM);
    expect(seen).toContain(`${ClientAction.Pause}:pressed`);
    seen.length = 0;
    r.router.push('cutscene'); // a context that binds nothing
    r.tap('Escape');
    r.router.sample(3, CAM);
    expect(seen).toContain(`${ClientAction.Pause}:pressed`);
  });

  it('client actions fire with pressed and released phases, and the unsubscribe function works', () => {
    const r = makeRig();
    const seen: string[] = [];
    const off = r.router.onClientAction((a, phase) => seen.push(`${a}:${phase}`));
    r.key('KeyV', true);
    r.router.sample(1, CAM);
    r.key('KeyV', false);
    r.router.sample(2, CAM);
    expect(seen).toEqual([`${ClientAction.Camera}:pressed`, `${ClientAction.Camera}:released`]);
    off();
    r.tap('KeyV');
    r.router.sample(3, CAM);
    expect(seen).toHaveLength(2);
  });

  it('blur and visibilitychange (hidden) clear every held bit', () => {
    for (const how of ['blur', 'hidden'] as const) {
      const r = makeRig();
      r.key('KeyW', true);
      r.key('Space', true);
      r.key('ShiftLeft', true);
      const held = r.router.sample(1, CAM);
      expect(held.buttons).not.toBe(0);
      if (how === 'blur') r.win.emit('blur');
      else {
        r.state.visibility = 'hidden';
        r.doc.emit('visibilitychange');
      }
      const gone = r.router.sample(2, CAM);
      expect(gone.buttons, how).toBe(0);
      expect(gone.moveY, how).toBe(0);
      expect(gone.released & bit(SimButton.Jump), how).not.toBe(0);
    }
  });

  it('visibilitychange to visible does not clear anything', () => {
    const r = makeRig();
    r.key('KeyW', true);
    r.state.visibility = 'visible';
    r.doc.emit('visibilitychange');
    expect(r.router.sample(1, CAM).moveY).toBe(-127);
  });

  it('input is ignored while the focus predicate reports a text field, and held keys are released', () => {
    const r = makeRig();
    r.key('KeyW', true);
    expect(r.router.sample(1, CAM).moveY).toBe(-127);
    r.state.textFocus = true;
    r.key('KeyW', true);
    r.tap('Space');
    const f = r.router.sample(2, CAM);
    expect(f.moveY).toBe(0);
    expect(f.pressed).toBe(0);
    r.state.textFocus = false;
    expect(r.router.sample(3, CAM).moveY).toBe(0); // the old press is gone; the player must press again
    r.key('KeyW', true);
    expect(r.router.sample(4, CAM).moveY).toBe(-127);
  });

  it('quantizes the view: yaw to u16, pitch to i16, context and device to their indices', () => {
    const r = makeRig();
    r.tap('KeyX');
    const f = r.router.sample(7, { yaw: Math.PI / 2, pitch: Math.PI / 4 });
    expect(f.tick).toBe(7);
    expect(f.camYaw).toBe(16384);
    expect(f.camPitch).toBe(8192);
    expect(f.context).toBe(0);
    expect(f.device).toBe(DEVICE_ORDER.indexOf('kbm'));
    expect(r.router.active).toBe('kbm');
    // Wrapping and extremes.
    expect(yawToU16(-Math.PI / 2)).toBe(49152);
    expect(yawToU16(Math.PI * 4 + Math.PI / 2)).toBe(16384);
    expect(pitchToI16(10)).toBe(16384);
    expect(pitchToI16(-10)).toBe(-16384);
    expect(u16ToYaw(32768)).toBeCloseTo(Math.PI, 12);
    expect(quantAxis(0.6)).toBe(76);
    expect(quantAxis(-1)).toBe(-127);
    expect(quantAxis(2)).toBe(127);
    expect(Object.is(quantAxis(-0.001), 0)).toBe(true);
    expect(quantTrigger(0.5)).toBe(64);
    expect(quantTrigger(-1)).toBe(0);
  });
});

describe('InputRouter: look, capture, devices', () => {
  it('mouse look: 0.0022 rad per pixel, right turns right (yaw falls), down looks down, pitch is clamped to +/- 70 degrees', () => {
    const r = makeRig();
    r.state.locked = true;
    const look = { yaw: 1, pitch: 0 };
    r.win.emit('mousemove', { movementX: 100, movementY: 50 });
    r.router.sample(0, look);
    r.router.applyLook(1 / 60, look);
    // sample() polled the binder into raw; applyLook consumed it.
    expect(look.yaw).toBeCloseTo(1 - 0.22, 9);
    expect(look.pitch).toBeCloseTo(-0.11, 9);
    r.win.emit('mousemove', { movementX: 0, movementY: -100000 });
    r.router.sample(1, look);
    r.router.applyLook(1 / 60, look);
    expect(look.pitch).toBeCloseTo(PITCH_LIMIT, 12);
    r.win.emit('mousemove', { movementX: 0, movementY: 1000000 });
    r.router.sample(2, look);
    r.router.applyLook(1 / 60, look);
    expect(look.pitch).toBeCloseTo(-PITCH_LIMIT, 12);
  });

  it('mouse movement without Pointer Lock is not look; sensitivity and invertY scale it', () => {
    const r = makeRig({ router: { settings: settings({ lookSensitivity: { kbm: 2, gamepad: 1, touch: 1 }, invertY: true }) } });
    const look = { yaw: 0, pitch: 0 };
    r.win.emit('mousemove', { movementX: 100, movementY: 100 });
    r.router.sample(0, look);
    r.router.applyLook(1 / 60, look);
    expect(look).toEqual({ yaw: 0, pitch: 0 });
    r.state.locked = true;
    r.win.emit('mousemove', { movementX: 100, movementY: 100 });
    r.router.sample(1, look);
    r.router.applyLook(1 / 60, look);
    expect(look.yaw).toBeCloseTo(-0.44, 9);
    expect(look.pitch).toBeCloseTo(0.44, 9);
  });

  it('gamepad look: 3.0 rad/s at full deflection', () => {
    const pad = {
      index: 0, id: 'test pad', connected: true, mapping: 'standard',
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
      axes: [0, 0, 1, -1],
    };
    const gp = new GamepadBinder({ getPads: () => [pad] });
    const router = new InputRouterImpl({ binders: [gp], now: () => 0 });
    const look = { yaw: 0, pitch: 0 };
    router.sample(0, look);
    router.applyLook(0.5, look);
    expect(look.yaw).toBeCloseTo(-1.5, 9); // stick right
    expect(look.pitch).toBeCloseTo(PITCH_LIMIT, 9); // stick up: +1.5 rad, clamped
  });

  it('rebindCapture resolves with the next key pressed, or null on timeout, and swallows that press', async () => {
    const r = makeRig();
    const first = r.router.rebindCapture('kbm', 5000);
    r.tap('KeyZ');
    const f = r.router.sample(1, CAM);
    expect(await first).toBe('key:KeyZ');
    expect(f.pressed).toBe(0);
    expect(r.timers[0]?.cancelled).toBe(true);

    const second = r.router.rebindCapture('kbm', 5000);
    expect(r.timers[1]?.ms).toBe(5000);
    r.timers[1]?.fn();
    expect(await second).toBeNull();
    r.tap('Space'); // capture is over: normal input again
    expect(r.router.sample(2, CAM).pressed & bit(SimButton.Jump)).not.toBe(0);
  });

  it('rebindCapture for the gamepad ignores keys', async () => {
    const r = makeRig();
    const p = r.router.rebindCapture('gamepad', 5000);
    r.tap('KeyZ');
    r.router.sample(1, CAM);
    r.timers[0]?.fn();
    expect(await p).toBeNull();
  });

  it('the last device that produced input is active', () => {
    const pad = {
      index: 0, id: 'pad', connected: true, mapping: 'standard',
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
      axes: [0, 0, 0, 0],
    };
    const win = makeRig();
    const gp = new GamepadBinder({ getPads: () => [pad] });
    const router = new InputRouterImpl({ binders: [win.kbm, gp], now: () => 0 });
    win.tap('KeyW');
    router.sample(0, CAM);
    expect(router.active).toBe('kbm');
    (pad.buttons[0] as { pressed: boolean; value: number }).pressed = true;
    (pad.buttons[0] as { pressed: boolean; value: number }).value = 1;
    const f = router.sample(1, CAM); // the pad button went down since the last poll
    expect(router.active).toBe('gamepad');
    expect(f.device).toBe(DEVICE_ORDER.indexOf('gamepad'));
  });

  it('writeInputFrame puts the frame in the input block: a one-frame tap latches one pressed and one released edge', () => {
    const r = makeRig();
    const block = InputBlock.create();
    r.tap('KeyE');
    r.key('KeyW', true);
    writeInputFrame(block, r.router.sample(1, { yaw: Math.PI, pitch: 0 }));
    const s = block.sample(1);
    expect(s.pressed & bit(SimButton.Interact)).not.toBe(0);
    expect(s.released & bit(SimButton.Interact)).not.toBe(0);
    expect(s.buttons & bit(SimButton.Interact)).toBe(0);
    expect(s.moveY).toBe(-127);
    expect(s.camYaw).toBe(32768);
    expect(block.sample(2).pressed).toBe(0);
  });
});

describe('tables and default maps', () => {
  it('the action tables match the C03 enums', () => {
    expect(Object.keys(SIM_BITS)).toHaveLength(19);
    expect(Object.keys(CLIENT_ACTIONS)).toHaveLength(18);
    expect(Object.keys(AXES)).toHaveLength(7);
    expect(SIM_BITS['Jump']).toBe(SimButton.Jump);
    expect(SIM_BITS['PhoneQuick']).toBe(SimButton.PhoneQuick);
    expect(CLIENT_ACTIONS['DebugToggle']).toBe(ClientAction.DebugToggle);
    expect(AXES['Steer']).toBe(Axis.Steer);
    expect(new Set(Object.values(SIM_BITS)).size).toBe(19);
    expect(CONTEXT_ORDER).toHaveLength(11);
    expect(DEVICE_ORDER[7]).toBe('bot');
  });

  it('every action in the default maps is a known action, with the expected on-foot bindings', () => {
    for (const map of DEFAULT_MAPS) {
      for (const [ctx, actions] of Object.entries(map.contexts)) {
        expect(CONTEXT_ORDER).toContain(ctx);
        for (const id of Object.keys(actions ?? {})) {
          const [kind, name] = id.split('.') as [string, string];
          const table = kind === 'sim' ? SIM_BITS : kind === 'client' ? CLIENT_ACTIONS : AXES;
          expect(table[name], `${map.device} ${ctx} ${id}`).toBeDefined();
        }
      }
    }
    const [kbm, pad] = DEFAULT_MAPS;
    const ctrl = (m: typeof kbm, id: string): string[] => (m?.contexts.onFoot?.[id as 'sim.Jump'] ?? []).map((b) => b.control);
    expect(ctrl(kbm, 'sim.Jump')).toEqual(['key:Space']);
    expect(ctrl(kbm, 'sim.Sprint')).toContain('key:ShiftLeft');
    expect(ctrl(kbm, 'sim.Interact')).toEqual(['key:KeyE']);
    expect(ctrl(kbm, 'sim.Enter')).toEqual(['key:KeyF']);
    expect(ctrl(kbm, 'client.Camera')).toEqual(['key:KeyV']);
    expect(ctrl(kbm, 'client.ShoulderSwap')).toEqual(['key:KeyC']);
    expect(ctrl(kbm, 'client.Pause')).toEqual(['key:Escape', 'key:KeyP']);
    expect(ctrl(pad, 'axis.MoveX')).toEqual(['pad:a0']);
    expect(ctrl(pad, 'axis.MoveY')).toEqual(['pad:a1']);
    expect(ctrl(pad, 'axis.LookX')).toEqual(['pad:a2']);
    expect(ctrl(pad, 'axis.LookY')).toEqual(['pad:a3']);
    expect(ctrl(pad, 'sim.Jump')).toEqual(['pad:b0']);
    expect(ctrl(pad, 'sim.Sprint')).toEqual(['pad:b10']);
    expect(ctrl(pad, 'sim.Interact')).toEqual(['pad:b3']);
    expect(ctrl(pad, 'client.Camera')).toEqual(['pad:b11']);
    expect(ctrl(pad, 'client.Pause')).toEqual(['pad:b9']);
    expect(ctrl(pad, 'client.Map')).toEqual(['pad:b8']);
  });
});
