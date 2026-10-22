import v8 from 'node:v8';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { FM, NULL_SINK } from '../../src/fight/buffer.ts';
import { FightCore } from '../../src/fight/step.ts';
import { LINEUP, PACK, RULES, randomBot } from './helpers.ts';

// `gc` is not exposed to vitest workers; V8 hands it out on request (BD-M08a1-05: no separate vitest project needed).
v8.setFlagsFromString('--expose-gc');
const gc = vm.runInNewContext('gc') as () => void;

function heap(): number {
  for (let i = 0; i < 4; i++) gc();
  return process.memoryUsage().heapUsed;
}

describe('no allocation inside step (FC11 budget)', () => {
  it('a scripted 99-second match grows the heap by less than 64 KiB over 5,940 ticks after a 600-tick warm-up', () => {
    const TOTAL = 600 + 5940;
    const sim = new FightCore();
    const buf = sim.init(PACK, { ...RULES, timerFrames: 5940, roundsToWin: 3 }, 5, LINEUP);
    sim.setPhase(buf, 3);
    const a = Int32Array.from(randomBot(7, TOTAL, 1)), b = Int32Array.from(randomBot(8, TOTAL, -1));
    for (let t = 0; t < 600; t++) sim.step(buf, a[t] as number, b[t] as number, NULL_SINK);
    // V8 allocates feedback vectors and boxed doubles while hot functions tier up; four unmeasured passes let it settle
    // (BD-M08a1-05). The measured passes then show the per-tick rule: nothing allocates.
    const s0 = sim.snapshot(buf);
    for (let warm = 0; warm < 4; warm++) {
      for (let t = 600; t < TOTAL; t++) sim.step(buf, a[t] as number, b[t] as number, NULL_SINK);
      sim.restore(buf, s0);
    }
    const deltas: number[] = [];
    for (let rep = 0; rep < 5; rep++) {
      const before = heap();
      for (let t = 600; t < TOTAL; t++) sim.step(buf, a[t] as number, b[t] as number, NULL_SINK);
      deltas.push(heap() - before);
      sim.restore(buf, s0);
    }
    deltas.sort((x, y) => x - y);
    const median = deltas[2] as number;
    expect(median).toBeLessThan(64 * 1024);
    expect(buf[FM.Tick]).toBe(600);
  });
});
