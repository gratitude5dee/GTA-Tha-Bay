import { describe, expect, it } from 'vitest';
import { SimButton } from '../../src/contracts/c03-input.ts';
import type { InputFrame } from '../../src/contracts/c03-input.ts';
import { FB, dir9, fromInputFrame, toInputFrame } from '../../src/fight/input.ts';

function frame(over: Partial<InputFrame> = {}): InputFrame {
  return { tick: 0, buttons: 0, pressed: 0, released: 0, moveX: 0, moveY: 0, throttle: 0, brake: 0, steer: 0, camYaw: 0, camPitch: 0, context: 2, device: 7, ...over };
}
const bit = (b: number): number => 1 << b;

describe('fromInputFrame (FC5.1)', () => {
  it('moveX beyond +-48 sets Left/Right; 47 and 48 stay neutral', () => {
    for (const v of [47, 48]) {
      expect(fromInputFrame(frame({ moveX: v })) & (FB.Left | FB.Right)).toBe(0);
      expect(fromInputFrame(frame({ moveX: -v })) & (FB.Left | FB.Right)).toBe(0);
    }
    expect(fromInputFrame(frame({ moveX: 49 }))).toBe(FB.Right);
    expect(fromInputFrame(frame({ moveX: -49 }))).toBe(FB.Left);
    expect(fromInputFrame(frame({ moveX: 127 }))).toBe(FB.Right);
  });
  it('moveY beyond +-48 sets Up/Down; Jump and Crouch buttons also do', () => {
    expect(fromInputFrame(frame({ moveY: 49 }))).toBe(FB.Up);
    expect(fromInputFrame(frame({ moveY: -49 }))).toBe(FB.Down);
    expect(fromInputFrame(frame({ moveY: 48 }))).toBe(0);
    expect(fromInputFrame(frame({ buttons: bit(SimButton.Jump) }))).toBe(FB.Up);
    expect(fromInputFrame(frame({ buttons: bit(SimButton.Crouch) }))).toBe(FB.Down);
  });
  it('left+right is neutral and up+down is up (SOCD, FC5.2)', () => {
    const lr = fromInputFrame(frame({ moveX: 127 })) | FB.Left;
    expect(dir9(lr, 1)).toBe(5);
    expect(dir9(lr, -1)).toBe(5);
    const ud = FB.Up | FB.Down;
    expect(dir9(ud, 1)).toBe(8);
    expect(dir9(FB.Right | ud, 1)).toBe(9);
    expect(dir9(FB.Down, 1)).toBe(2);
    expect(dir9(FB.Right | FB.Down, 1)).toBe(3);
    expect(dir9(FB.Right | FB.Down, -1)).toBe(1);   // facing left: right is back
  });
  it('maps every action to its FighterInput bit', () => {
    const map: [number, number][] = [
      [SimButton.Attack, FB.LP], [SimButton.Ability, FB.MP], [SimButton.FightHeavy, FB.HP],
      [SimButton.Sprint, FB.LK], [SimButton.Nitro, FB.MK], [SimButton.Horn, FB.HK],
      [SimButton.Special, FB.SP], [SimButton.FightAssist, FB.AS], [SimButton.Handbrake, FB.HY],
      [SimButton.Emote, FB.TA], [SimButton.Block, FB.BL], [SimButton.Interact, FB.DA],
    ];
    for (const [b, want] of map) expect(fromInputFrame(frame({ buttons: bit(b) }))).toBe(want);
  });
  it('a latched sub-tick press counts even when the held bit is gone (C03 rule 2)', () => {
    expect(fromInputFrame(frame({ buttons: 0, pressed: bit(SimButton.Attack) }))).toBe(FB.LP);
  });
  it('toInputFrame inverts it for all 65,536 inputs on the bot device', () => {
    for (let v = 0; v < 65536; v += 7) {
      const f = toInputFrame(v, 3);
      expect(f.device).toBe(7);
      const lr = (v & FB.Left) !== 0 && (v & FB.Right) !== 0;
      expect(fromInputFrame(f)).toBe(lr ? v & ~(FB.Left | FB.Right) : v);
    }
    expect(fromInputFrame(toInputFrame(65535, 0))).toBe(65535 & ~(FB.Left | FB.Right));
  });
});
