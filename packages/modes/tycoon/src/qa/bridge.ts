/**
 * `window.__dvBridge.tycoon` (M09a1; QA builds only): the page-side handle on a Business Tycoon run, for Playwright, agents and people
 * at the console. Reachable only through a dynamic import behind `import.meta.env.VITE_DV_QA === '1'` in `apps/web/src/main.ts`
 * (`?tycoon=1`), so a production dist has neither it nor the string `__dvBridge`.
 *
 *   await __dvBridge.tycoon.start(1)                  // seeded run in the sim worker
 *   await __dvBridge.tycoon.cmd({ t: 'setAllocation', features: 60, refactor: 25, infra: 15 })
 *   await __dvBridge.tycoon.step(20)                  // 20 weeks at once
 *   __dvBridge.tycoon.view()                          // week, cash, cap table, hash ...
 *   __dvBridge.tycoon.runDet(spec.runs)               // the pure core replays recorded choices in this browser (the @tycoon-det check)
 */
import type { UiCommand } from '@dv/shared';
import { replay, type ChoiceRecord, type Command, type RunSetup } from '@dv/shared/tycoon';
import { tycoonContent } from '../sim/content.ts';
import { RUN_KEY, VIEW_KEY, type TycoonView } from '../sim/TycoonModeSim.ts';
import { mountTycoonPanel, type PanelApi } from './QaPanel.tsx';

interface EngineLike {
  modes: {
    call(op: string, args?: Record<string, unknown>): Promise<Record<string, unknown> | null>;
    send(cmd: UiCommand): boolean;
    vm(key: string): unknown;
    quit(): boolean;
  };
  setPlay(on: boolean): void;
}

export interface DetRun {
  seed: number;
  weeks: number;
  setup: RunSetup;
  choices: ChoiceRecord[];
}
export interface DetOutcome {
  seed: number;
  finalHash: string;
  endWeek: number;
  resultHash: string | null;
}

export interface TycoonBridge {
  start(seed?: number, opts?: { founder?: string; coFounder?: boolean; thesis?: string }): Promise<Record<string, unknown> | null>;
  cmd(c: Command): void;
  step(n?: number): Promise<TycoonView | null>;
  speed(n: 1 | 2 | 4): void;
  pause(on: boolean): void;
  quit(): void;
  view(): TycoonView | null;
  runJson(): string;
  /** Replays recorded runs with the pure core in this page. No engine needed. */
  runDet(runs: readonly DetRun[]): DetOutcome[];
}

/** The pure cross-browser check: the same code and the same choices as the Node golden, run by this browser's JS engine. */
export function runDet(runs: readonly DetRun[]): DetOutcome[] {
  const content = tycoonContent();
  return runs.map((r) => {
    const out = replay(r.setup, r.choices, content);
    return { seed: r.seed, finalHash: out.hash, endWeek: out.state.week, resultHash: out.result ? out.result.stateHash : null };
  });
}

export function installTycoonBridge(): TycoonBridge {
  const w = window as unknown as { __dvBridge?: Record<string, unknown> };
  const engine = (): EngineLike => {
    const e = w.__dvBridge?.['engine'] as EngineLike | undefined;
    if (!e) throw new Error('tycoon bridge: __dvBridge.engine is not installed');
    return e;
  };
  const mode = (name: string, args?: Record<string, never> | Record<string, string | number | boolean>): boolean => engine().modes.send({ t: 'mode.cmd', mode: 'tycoon', name, ...(args ? { args } : {}) });
  const view = (): TycoonView | null => (w.__dvBridge?.['engine'] ? ((engine().modes.vm(VIEW_KEY) as TycoonView | undefined) ?? null) : null);
  const tick = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  const bridge: TycoonBridge = {
    start: async (seed = 1, opts = {}) => {
      const e = engine();
      e.setPlay(true);
      const started = await e.modes.call('startQa', { id: 'tycoon', params: {} });
      // The mode is on top of the stack one host tick later; the start message needs it there.
      for (let i = 0; i < 40 && view() === null; i++) {
        mode('start', { seed, ...opts } as Record<string, string | number | boolean>);
        await tick(100);
        if (view() !== null) break;
      }
      return started;
    },
    cmd: (c) => void mode('cmd', { json: JSON.stringify(c) }),
    step: async (n = 1) => {
      for (let i = 0; i < n; i++) {
        const before = view()?.week ?? 0;
        mode('step');
        for (let k = 0; k < 60 && (view()?.week ?? 0) === before && view()?.awaiting == null && view()?.result == null; k++) await tick(25);
      }
      return view();
    },
    speed: (n) => void mode('speed', { n }),
    pause: (on) => void mode('pause', { on }),
    quit: () => void mode('abandon'),
    view,
    runJson: () => JSON.stringify(w.__dvBridge?.['engine'] ? engine().modes.vm(RUN_KEY) : null),
    runDet,
  };
  const api: PanelApi = {
    start: (seed) => void bridge.start(seed),
    cmd: bridge.cmd,
    step: (n) => void bridge.step(n),
    speed: bridge.speed,
    pause: bridge.pause,
    abandon: bridge.quit,
    view: bridge.view,
    runJson: bridge.runJson,
  };
  mountTycoonPanel(document, api);
  w.__dvBridge = { ...w.__dvBridge, tycoon: bridge };
  return bridge;
}
