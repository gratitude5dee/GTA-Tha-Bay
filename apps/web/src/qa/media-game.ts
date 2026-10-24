/**
 * QA builds only (M04c): the flat cutscene path on the game page. F9 plays the fixture clip over the running world (the renderer host's
 * loop stops and the sim pauses while it covers the canvas; Escape, the Skip button, a tap or gamepad B ends it); F9 again while a
 * clip plays skips it. `window.__dvBridge.media` carries `{ play, skip, state }` for scripts. The pool is the engine's own
 * `FirstGestureUnlock` (the Title's first gesture).
 */
import type { EngineHandle } from '@dv/engine/client/boot';
import type { Platform } from '@dv/engine/platform';
import { createMediaQa } from './media-assembly.ts';

export function installGameMedia(engine: EngineHandle, platform: Platform): void {
  const qa = createMediaQa({
    unlock: engine.media,
    loop: platform.host,
    sim: engine,
    tier: platform.quality.tier.id,
    dataSaver: () => platform.settings.dataSaver,
  });
  const play = async (id: string) => {
    if (!engine.media.state().unlocked) {
      // F9 is a key press, so it is a gesture itself.
      await engine.media.trigger();
    }
    return qa.player.play(id);
  };
  const state = () => ({ ...engine.media.state(), host: { visible: qa.host.visible }, simPaused: engine.paused, mediaMB: qa.budget.mediaMB() });
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'F9' || e.repeat) return;
    e.preventDefault();
    if (qa.host.visible) void qa.player.skip();
    else void play('fixture-a');
  });
  const w = window as unknown as { __dvBridge?: Record<string, unknown> };
  w.__dvBridge = { ...(w.__dvBridge ?? {}), media: { play, skip: () => qa.player.skip(), state, useCanvasSource: (on: boolean) => qa.player.useCanvasSource(on) } };
}
