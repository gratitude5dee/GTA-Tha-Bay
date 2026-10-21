/**
 * Driver `lines` (M04d): replays an input line (`*.line.json`, M03a1) through the real `LinePlayer`. Params:
 *   line   the parsed or raw line file (`{ v: 1, scenario, seed, frames, ... }`), required
 *   noise  optional integer; adds a seeded steer offset in [-noise, noise] each tick from the `bot` stream (a robustness run)
 * `done()` is true once the last recorded tick has been played, with outcome `end`.
 */
import type { InputFrame } from '@dv/shared';
import { lineLength, validateLine, type LineFile } from '../../sim/lines/format.ts';
import { LinePlayer } from '../../sim/lines/player.ts';
import type { BotContext, BotDriver } from '../bots.ts';

export const LINES_DRIVER_ID = 'lines';

export function createLinesDriver(): BotDriver {
  let player: LinePlayer | null = null;
  let line: LineFile | null = null;
  let noise = 0;
  let rng: (() => number) | null = null;
  let lastTick = -1;

  return {
    id: LINES_DRIVER_ID,
    device: 'bot',
    init(ctx: BotContext, params?: Record<string, unknown>): void {
      if (!params || params['line'] === undefined) throw new Error("driver 'lines' needs params.line");
      line = validateLine(params['line']);
      player = new LinePlayer(line, 0, null);
      const n = params['noise'];
      noise = typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : 0;
      rng = noise > 0 ? ctx.rng('bot') : null;
      lastTick = -1;
    },
    frame(tick: number): InputFrame {
      if (!player) throw new Error("driver 'lines' used before init");
      lastTick = tick;
      const f = player.frame(tick);
      if (noise > 0 && rng) {
        const off = Math.round((rng() * 2 - 1) * noise);
        const steer = Math.max(-127, Math.min(127, f.steer + off));
        return { ...f, steer };
      }
      return f;
    },
    done(): { done: boolean; outcome?: string } {
      if (!line) return { done: false };
      return lastTick >= lineLength(line) - 1 ? { done: true, outcome: 'end' } : { done: false };
    },
  };
}
