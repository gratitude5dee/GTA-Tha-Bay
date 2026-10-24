/**
 * Live autoplay (M05a2; QA builds only): `window.__dvBridge.mission.autoplay(true)` makes the story autoplayer play the running
 * mission in the browser. It is the canonical-run bot put on the sim worker's input source (`SimRuntime.bot`), so it writes
 * player 0's `InputFrame` and nothing else. It is not an oracle: a live session runs the `local` profile, whose physics differs from
 * the `canonical` runs that `check:missions` and `@determinism` hold to a hash. Reached only through a dynamic import behind
 * `import.meta.env.VITE_DV_QA === '1'` in `mode.ts`. Sim code under the C02 lint.
 */
import type { BotInput, ModeContext } from '@dv/shared';
import type { MissionRuntime } from '../vm/runtime.ts';
import { createStoryAutoplayer } from './driver.ts';
import { observeMission } from './observe.ts';

export interface LiveHost {
  ctx(): ModeContext | null;
  rt(): MissionRuntime | null;
  /** Installs (or, with null, removes) the sim worker's bot input source. */
  setBot(bot: BotInput | null): void;
}

/** Starts the autoplayer on the current mission; returns false when there is no mission to play. */
export function startLiveAutoplay(host: LiveHost): boolean {
  const ctx = host.ctx();
  if (!ctx || !host.rt()) return false;
  const driver = createStoryAutoplayer();
  const stream = ctx.rng('bot');
  driver.init(
    {
      observe: () => {
        const rt = host.rt();
        const c = host.ctx();
        return (rt && c ? observeMission(rt, c) : { phase: 'none' }) as unknown as Readonly<Record<string, unknown>>;
      },
      rng: () => () => stream.nextFloat(),
    },
    {},
  );
  host.setBot({ device: 'bot', frame: (tick) => driver.frame(tick) });
  return true;
}

export function stopLiveAutoplay(host: LiveHost): void {
  host.setBot(null);
}
