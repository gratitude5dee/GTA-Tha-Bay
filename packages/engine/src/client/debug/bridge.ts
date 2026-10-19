import type { DebugCommand } from '../../sim/transport/envelope.ts';
import type { EngineHandle, EngineObservation } from '../boot/boot-engine.ts';
import { createSaveBridge, type SaveBridge } from './save-bridge.ts';

/**
 * `window.__dvBridge.engine` (QA builds only; 01-engine.md section 2.11): JSON-friendly observation and debug commands
 * for Playwright and agents. This module is reachable only through a dynamic import behind `VITE_DV_QA === '1'`, so a
 * production dist contains neither it nor the string "__dvBridge" (apps/web/scripts/verify-dist.mjs).
 */
export interface EngineBridge {
  observe(): EngineObservation;
  act(cmd: DebugCommand): boolean;
  /** Run `n` ticks while paused. */
  step(n: number): boolean;
  setPaused(paused: boolean): void;
  /** Results published by QA pages (determinism run), by name. */
  qa: Record<string, unknown>;
  /** Input reaches the game (true) or the world is a title backdrop (false). */
  setPlay(on: boolean): void;
  /** Ends the XR smoke session, if one runs. */
  endXr(): Promise<void>;
  /** C05 SaveService on the real database: list, write, load, kill (M04a1). */
  save: SaveBridge;
}

export function installEngineBridge(engine: EngineHandle): EngineBridge {
  const bridge: EngineBridge = {
    observe: () => engine.observe(),
    act: (cmd) => engine.act(cmd),
    step: (n) => engine.step(n),
    setPaused: (p) => engine.setPaused(p),
    setPlay: (on) => engine.setPlay(on),
    endXr: () => engine.endXr(),
    save: createSaveBridge(),
    get qa() {
      return engine.qaResults();
    },
  };
  window.__dvBridge = { ...window.__dvBridge, engine: bridge };
  return bridge;
}

/** For pages that run no sim (the determinism page): publish results under the same `engine.qa` key. */
export function installQaBridge(results: () => Record<string, unknown>): void {
  const bridge: Partial<EngineBridge> = {
    get qa() {
      return results();
    },
    save: createSaveBridge(),
  };
  window.__dvBridge = { ...window.__dvBridge, engine: bridge as EngineBridge };
}
