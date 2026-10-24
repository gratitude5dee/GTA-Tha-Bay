/** M04d AC-3: the driver registry. */
import { afterEach, describe, expect, it } from 'vitest';
import type { InputFrame } from '@dv/shared';
import { getBot, registerBot, registeredBots, unregisterBot, type BotDriver } from '../../src/qa/bots.ts';
import { createLinesDriver } from '../../src/qa/drivers/lines.ts';
import { createCanonicalRunner, ensureBuiltinDrivers } from '../../src/qa/runner.ts';
import { readFixturePacks } from '../../src/qa/node.ts';
import { spec } from './helpers.ts';

const never = (id: string): BotDriver => ({
  id,
  device: 'bot',
  init: () => undefined,
  frame: (tick) => ({ tick, buttons: 0, pressed: 0, released: 0, moveX: 0, moveY: 0, throttle: 0, brake: 0, steer: 0, camYaw: 0, camPitch: 0, context: 0, device: 7 }) as InputFrame,
  done: () => ({ done: false }),
});

describe('BotDriver registry', () => {
  afterEach(() => unregisterBot('never'));

  it('a second driver with id lines throws', () => {
    ensureBuiltinDrivers();
    expect(registeredBots()).toContain('lines');
    expect(() => registerBot('lines', createLinesDriver)).toThrow(/already registered/);
  });

  it('an unknown driver fails and the message lists lines', async () => {
    ensureBuiltinDrivers();
    expect(() => getBot('nope')).toThrow(/lines/);
    const runner = createCanonicalRunner({ packs: readFixturePacks(), processEnv: {} });
    await expect(runner.run({ ...spec(), bot: { driver: 'nope' } })).rejects.toThrow(/unknown bot driver 'nope'.*lines/);
  });

  it('a registered driver that never finishes runs to maxTicks', async () => {
    registerBot('never', () => never('never'));
    const runner = createCanonicalRunner({ packs: readFixturePacks(), processEnv: {} });
    const t = await runner.run({ ...spec(), maxTicks: 120, bot: { driver: 'never' } });
    expect(t.end.outcome).toBe('timeout');
    expect(t.end.tick).toBe(120);
  }, 60_000);

  it('the lines driver needs its line, replays frames and reports end', () => {
    const d = createLinesDriver();
    expect(() => d.init({ observe: () => ({}), rng: () => () => 0 })).toThrow(/params.line/);
    d.init({ observe: () => ({}), rng: () => () => 0 }, { line: spec().bot.params?.['line'] });
    expect(d.done().done).toBe(false);
    const f = d.frame(30);
    expect(f.throttle).toBe(100);
    expect(f.device).toBe(7);
    d.frame(750);
    d.frame(811);
    expect(d.done()).toEqual({ done: true, outcome: 'end' });
  });
});
