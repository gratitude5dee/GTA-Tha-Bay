import type { DebugCommand } from '../../sim/transport/envelope.ts';
import type { EngineHandle, EngineObservation } from '../boot/boot-engine.ts';

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
}

export function installEngineBridge(engine: EngineHandle): EngineBridge {
  const bridge: EngineBridge = {
    observe: () => engine.observe(),
    act: (cmd) => engine.act(cmd),
    step: (n) => engine.step(n),
    setPaused: (p) => engine.setPaused(p),
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
  };
  window.__dvBridge = { ...window.__dvBridge, engine: bridge as EngineBridge };
}
