/**
 * QA builds only (M05b2): `window.__dvBridge.cutscene = { state(), log(), stall(), skip(), subtitle(), aiChip() }` for Playwright and
 * coding agents. `state()` says what the player and the host are doing; `log()` lists the requests, the commands sent to the sim,
 * the `cut.done` events and the `cutscene.play` telemetry, oldest first; `stall()` freezes the clip on screen so that the mid-play
 * stall watch fires.
 */
import type { EngineHandle } from '@dv/engine/client/boot';
import type { CutsceneGlue } from '../cutscene.ts';

export function installCutsceneBridge(glue: CutsceneGlue, engine: EngineHandle): void {
  const bridge = {
    state: () => ({
      playing: glue.player.playing,
      host: { visible: glue.host.visible, cues: glue.host.cues, held: glue.host.held },
      /** Flat frames not drawn so far because a cutscene hid the world (BD-FIX-CI10-R01). */
      heldFrames: glue.heldFrames(),
      simPaused: engine.paused,
      media: engine.media.state(),
    }),
    log: () => glue.log().map((e) => ({ ...e })),
    stall: () => glue.player.qaStall(),
    skip: () => {
      for (const id of glue.player.playing) glue.player.skip(id);
    },
    /** Text of the subtitle line on screen now ('' when none). */
    subtitle: () => document.querySelector('[data-testid="cutscene-subtitle"]')?.textContent ?? '',
    aiChip: () => document.querySelector('[data-testid="cutscene-ai-chip"]') !== null,
    hasVideo: () => document.querySelector('.dv-cutscene-host video') !== null,
    stillSrc: () => document.querySelector('.dv-cutscene-host img')?.getAttribute('src') ?? null,
  };
  const w = window as unknown as { __dvBridge?: Record<string, unknown> };
  w.__dvBridge = { ...(w.__dvBridge ?? {}), cutscene: bridge };
}
