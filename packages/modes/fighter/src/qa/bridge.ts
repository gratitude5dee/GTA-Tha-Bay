/**
 * `window.__dvBridge.fighter` (M08a2; QA builds only): the page-side handle on a match, for Playwright, agents and people at the
 * console. Reachable only through a dynamic import behind `import.meta.env.VITE_DV_QA === '1'` in `apps/web/src/main.ts`, so a
 * production dist has neither it nor the string `__dvBridge`.
 *
 *   await __dvBridge.fighter.start({ kind: 'versus', cpu: 2 })        // a match at once (QA start; works with the tile still locked)
 *   await __dvBridge.fighter.start({ kind: 'training', manual: true }) // Training, stepped by hand
 *   await __dvBridge.fighter.setInputs(FB.LP, 0); await __dvBridge.fighter.step(30)
 *   await __dvBridge.fighter.state()      // fighters, phase, hash, training meter
 *   await __dvBridge.fighter.hash()       // [lo, hi] of the buffer
 *   await __dvBridge.fighter.exportReplay()  // the .dvfight text of the match so far
 *   await __dvBridge.fighter.replay(text)    // plays a .dvfight in the sim worker and checks every 60-tick checkpoint
 *   await __dvBridge.fighter.reloadTuning(t) // rebuilds the frame-data pack from a tuning table
 */
import { FB } from '@dv/shared/fight';
import type { FighterEnterParams } from '../types.ts';
import type { ReplayVm } from '../sim/vm.ts';
import { VM_REPLAY, VM_VIEW } from '../sim/vm.ts';

/** The bits of `__dvBridge.engine` the fighter bridge uses (structural, so the module needs no engine import). */
interface EngineLike {
  modes: {
    call(op: string, args?: Record<string, unknown>): Promise<Record<string, unknown> | null>;
    vm(key: string): unknown;
  };
  setPlay(on: boolean): void;
}

const FB_BITS: Record<string, number> = {
  Up: FB.Up, Down: FB.Down, Left: FB.Left, Right: FB.Right, LP: FB.LP, MP: FB.MP, HP: FB.HP, LK: FB.LK, MK: FB.MK, HK: FB.HK,
  SP: FB.SP, AS: FB.AS, HY: FB.HY, TA: FB.TA, BL: FB.BL, DA: FB.DA,
};

export interface FighterBridge {
  start(params?: FighterEnterParams): Promise<Record<string, unknown> | null>;
  step(n?: number, i0?: number, i1?: number): Promise<Record<string, unknown> | null>;
  run(n: number): Promise<Record<string, unknown> | null>;
  setInputs(i0: number, i1?: number): Promise<Record<string, unknown> | null>;
  state(): Promise<Record<string, unknown> | null>;
  hash(): Promise<[number, number] | null>;
  exportReplay(build?: string): Promise<string | null>;
  reloadTuning(tuning: unknown): Promise<Record<string, unknown> | null>;
  cmd(name: string, args?: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  quit(): Promise<Record<string, unknown> | null>;
  /** Plays a `.dvfight` in the sim worker (a QA match in `replay` kind) and resolves with the progress model once every tick is played. */
  replay(text: string, timeoutMs?: number): Promise<ReplayVm | null>;
  /** The view model of the last tick (what the presenter draws), or undefined. */
  view(): unknown;
  /** The FighterInput bits, for `setInputs`. */
  FB: Record<string, number>;
}

export function installFighterBridge(): FighterBridge {
  const w = window as unknown as { __dvBridge?: Record<string, unknown> };
  const engine = (): EngineLike => {
    const e = w.__dvBridge?.['engine'] as EngineLike | undefined;
    if (!e) throw new Error('fighter bridge: __dvBridge.engine is not installed');
    return e;
  };
  const call = (op: string, args?: Record<string, unknown>): Promise<Record<string, unknown> | null> => engine().modes.call(op, args);
  const bridge: FighterBridge = {
    start: async (params = {}) => {
      engine().setPlay(true);
      return call('fighter.start', { params: params as Record<string, unknown> });
    },
    step: (n = 1, i0, i1) => call('fighter.step', { n, ...(i0 !== undefined ? { i0 } : {}), ...(i1 !== undefined ? { i1 } : {}) }),
    run: (n) => call('fighter.run', { n }),
    setInputs: (i0, i1 = 0) => call('fighter.inputs', { i0, i1 }),
    state: () => call('fighter.state'),
    hash: async () => {
      const s = (await call('fighter.state')) as { match?: { hash?: [number, number] } } | null;
      return s?.match?.hash ?? null;
    },
    exportReplay: async (build) => {
      const r = await call('fighter.replay', build ? { build } : undefined);
      return r && r['ok'] === true && typeof r['text'] === 'string' ? r['text'] : null;
    },
    reloadTuning: (tuning) => call('fighter.reload', { tuning: tuning as Record<string, unknown> }),
    cmd: (name, args) => call('fighter.cmd', { name, ...(args ? { args } : {}) }),
    quit: () => call('fighter.quit'),
    replay: async (text, timeoutMs = 60_000) => {
      const started = (await bridge.start({ kind: 'replay', replay: text })) as { ok?: boolean } | null;
      if (!started || started.ok !== true) return null;
      const deadline = Date.now() + timeoutMs;
      // The mode enters on a later tick than the one that took the start; a `run` sent before that finds no session. Wait for it.
      for (;;) {
        const s = (await bridge.state()) as { ok?: boolean } | null;
        if (s && s.ok === true) break;
        if (Date.now() > deadline) return null;
        await new Promise((r) => setTimeout(r, 25));
      }
      // total ticks of the replay: the longest of the two input streams is what the sim plays; ask the sim to run a generous number
      await bridge.run(100_000);
      for (;;) {
        const v = engine().modes.vm(VM_REPLAY as string) as ReplayVm | undefined;
        if (v?.done) return v;
        if (Date.now() > deadline) return v ?? null;
        await new Promise((r) => setTimeout(r, 25));
      }
    },
    view: () => engine().modes.vm(VM_VIEW as string),
    FB: FB_BITS,
  };
  w.__dvBridge = { ...w.__dvBridge, fighter: bridge };
  return bridge;
}
