/**
 * `window.__dvBridge.racing` (M07a1; QA builds only): the page-side handle on a race, for Playwright, agents and people at the
 * console. Reachable only through a dynamic import behind `import.meta.env.VITE_DV_QA === '1'` in `apps/web/src/main.ts`, so a
 * production dist has neither it nor the string `__dvBridge`.
 *
 *   await __dvBridge.racing.start('sf.sprint.ferry-ocean-beach', { vehicle: 'vehicle.aurelian-sorrel' })   // real streets (sf bake)
 *   await __dvBridge.racing.demo()                                                                          // straight sprint, any world
 *   await __dvBridge.racing.state()   // phase, gate, place, timer, the event log
 *   __dvBridge.racing.hud()           // the RaceHudVm of the last frame: speed, gear, nitro, place, gate, timer
 *   await __dvBridge.racing.cmd('ready' | 'retry' | 'exit') · await __dvBridge.racing.quit()
 */
import { DEMO_RACE } from '../races.ts';
import type { RaceHudVm } from '../sim/hud-vm.ts';
import { HUD_VM_KEY } from '../sim/hud-vm.ts';
import { renderHud } from '../ui/index.ts';

export interface RacingStartOptions {
  vehicle?: string;
  difficulty?: string;
  timeLimitMs?: number;
}

/** The bits of `__dvBridge.engine` the racing bridge uses (structural, so the module needs no engine import). */
interface EngineLike {
  modes: {
    call(op: string, args?: Record<string, unknown>): Promise<Record<string, unknown> | null>;
    vm(key: string): unknown;
  };
  setPlay(on: boolean): void;
}

export interface RacingBridge {
  start(raceId?: string, opts?: RacingStartOptions): Promise<Record<string, unknown> | null>;
  demo(opts?: RacingStartOptions): Promise<Record<string, unknown> | null>;
  state(): Promise<Record<string, unknown> | null>;
  hud(): unknown;
  cmd(name: 'ready' | 'retry' | 'exit'): Promise<Record<string, unknown> | null>;
  quit(): Promise<Record<string, unknown> | null>;
  /** Puts charge in the nitro tank (QA shortcut for a drift or a perfect start). */
  fillNitro(amount?: number): Promise<Record<string, unknown> | null>;
}

const HUD_CSS = `.dv-race-hud{position:fixed;inset:0;pointer-events:none;z-index:5;font:600 16px/1.2 system-ui,sans-serif;color:#fff;text-shadow:0 1px 3px #000}
.dv-race-hud[data-phase=Loading],.dv-race-hud:empty{display:none}
.dv-race-hud .dv-race-speed{position:absolute;left:16px;bottom:16px;font-size:20px}
.dv-race-hud .dv-race-speed b{font-size:40px}.dv-race-hud span{display:block;font-size:13px;opacity:.85}
.dv-race-hud .dv-race-nitro{position:absolute;left:16px;bottom:78px;width:140px;height:8px;background:#0006;border-radius:4px;overflow:hidden}
.dv-race-hud .dv-race-nitro i{display:block;height:100%;background:#3cf}
.dv-race-hud .dv-race-time{position:absolute;left:16px;top:16px;font-size:24px}
.dv-race-hud .dv-race-count{position:absolute;inset:25% 0 auto;text-align:center;font-size:96px}
.dv-race-hud .dv-race-warn{position:absolute;inset:20% 0 auto;text-align:center;font-size:32px;color:#f55}
.dv-race-hud .dv-race-results{position:absolute;inset:30% 0 auto;text-align:center;font-size:48px}`;

/** QA: the plain DOM HUD (the real mode UI mount arrives with S10's shell, M04b2); polls the view model once per frame. */
function mountQaHud(read: () => unknown): void {
  const doc = document;
  const style = doc.createElement('style');
  style.textContent = HUD_CSS;
  const el = doc.createElement('div');
  el.className = 'dv-race-hud';
  el.setAttribute('role', 'status');
  doc.head.append(style);
  doc.body.append(el);
  let last: unknown;
  const tick = (): void => {
    const v = read();
    if (v !== last) {
      last = v;
      if (v && typeof v === 'object') renderHud(el as never, v as RaceHudVm);
      else el.innerHTML = '';
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export function installRacingBridge(): RacingBridge {
  const w = window as unknown as { __dvBridge?: Record<string, unknown> };
  const engine = (): EngineLike => {
    const e = w.__dvBridge?.['engine'] as EngineLike | undefined;
    if (!e) throw new Error('racing bridge: __dvBridge.engine is not installed');
    return e;
  };
  const bridge: RacingBridge = {
    start: async (raceId, opts = {}) => {
      const e = engine();
      e.setPlay(true);
      return e.modes.call('racing.start', { ...(raceId ? { raceId } : {}), ...opts });
    },
    demo: (opts) => bridge.start(DEMO_RACE, opts),
    state: () => engine().modes.call('racing.state'),
    hud: () => engine().modes.vm('mode.racing.hud'),
    cmd: (name) => engine().modes.call('racing.cmd', { name }),
    quit: () => engine().modes.call('racing.quit'),
    fillNitro: (amount = 50) => engine().modes.call('racing.fill', { amount }),
  };
  mountQaHud(() => w.__dvBridge && (w.__dvBridge['engine'] as EngineLike | undefined)?.modes.vm(HUD_VM_KEY));
  w.__dvBridge = { ...w.__dvBridge, racing: bridge };
  return bridge;
}
