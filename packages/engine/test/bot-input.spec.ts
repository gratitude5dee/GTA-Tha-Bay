import { describe, expect, it } from 'vitest';
import { ScriptedBotInput, parseBotScript } from '../src/sim/input/bot-input.ts';

describe('BotInput (C03 1.1, QA only)', () => {
  const bot = new ScriptedBotInput([
    { from: 2, to: 5, buttons: 0b11, moveX: 100 },
    { from: 7, to: 9, buttons: 0b10, steer: -40 },
  ]);

  it('derives pressed and released edges from the held mask, one frame each', () => {
    const f = Array.from({ length: 10 }, (_, t) => bot.frame(t));
    expect(f.map((x) => x.buttons)).toEqual([0, 0, 3, 3, 3, 0, 0, 2, 2, 0]);
    expect(f.map((x) => x.pressed)).toEqual([0, 0, 3, 0, 0, 0, 0, 2, 0, 0]);
    expect(f.map((x) => x.released)).toEqual([0, 0, 0, 0, 0, 3, 0, 0, 0, 2]);
    expect(f[3]?.moveX).toBe(100);
    expect(f[7]?.steer).toBe(-40);
    expect(f.every((x, t) => x.tick === t && x.device === 7)).toBe(true);
  });

  it('a jump back in time (restore) recomputes edges from the previous tick', () => {
    const b = new ScriptedBotInput([{ from: 2, to: 5, buttons: 1 }]);
    b.frame(0); b.frame(1); b.frame(2); b.frame(3);
    const again = b.frame(2);
    expect(again.pressed).toBe(1);
    expect(b.frame(3).pressed).toBe(0);
  });

  it('parseBotScript accepts numbers only and requires from and to', () => {
    expect(parseBotScript([{ from: 0, to: 3, buttons: 1 }])).toEqual([{ from: 0, to: 3, buttons: 1 }]);
    expect(() => parseBotScript({})).toThrow(TypeError);
    expect(() => parseBotScript([{ from: 0 }])).toThrow(/from and to/);
    expect(() => parseBotScript([{ from: 0, to: 1, buttons: 'x' }])).toThrow(/finite number/);
    expect(() => parseBotScript([null])).toThrow(TypeError);
  });
});
