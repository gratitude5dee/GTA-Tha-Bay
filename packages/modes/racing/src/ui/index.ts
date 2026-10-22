/**
 * `GameModeUI` of racing (M07a1): subscribes to the HUD view model `mode.racing.hud` and draws a plain DOM HUD (speed, gear,
 * nitro, gate, timer, countdown, results card). S10's HUD kit (M04b2) replaces the look; the view model is the contract.
 * DOM code lives here on the main thread, never in `sim/`.
 */
import type { GameModeUI, JsonValue } from '@dv/shared';
import type { RaceHudVm } from '../sim/hud-vm.ts';
import { HUD_VM_KEY } from '../sim/hud-vm.ts';

const fmt = (ms: number): string => {
  const s = Math.max(0, ms) / 1000;
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(2).padStart(5, '0')}`;
};

/** Renders one view model into `el` (a plain function, so tests and the QA page can call it without a host). */
export function renderHud(el: { innerHTML: string; dataset: Record<string, string | undefined> }, vm: RaceHudVm): void {
  el.dataset['phase'] = vm.phase;
  const count = vm.phase === 'Countdown' ? Math.ceil(vm.countdown / 60) : 0;
  const center =
    vm.phase === 'Countdown' ? `<div class="dv-race-count">${count}</div>`
      : vm.phase === 'Results' ? `<div class="dv-race-results">${vm.timerMs > 0 ? fmt(vm.timerMs) : ''}<small>R retry / Esc exit</small></div>`
        : vm.wrongWay ? '<div class="dv-race-warn">WRONG WAY</div>' : '';
  el.innerHTML =
    `<div class="dv-race-speed"><b>${vm.speed}</b> ${vm.unit}<span>gear ${vm.gear}</span></div>` +
    `<div class="dv-race-nitro"><i style="width:${Math.round(vm.nitro01 * 100)}%"></i></div>` +
    `<div class="dv-race-time">${fmt(vm.timerMs)}<span>gate ${vm.gate}/${vm.gates}</span></div>` +
    center;
}

export const racingUi: GameModeUI = (() => {
  let off: (() => void) | null = null;
  let el: HTMLElement | null = null;
  return {
    inputContexts: ['vehicle'],
    mount(host): void {
      const root = host.root as HTMLElement | null;
      if (!root || typeof root.ownerDocument?.createElement !== 'function') return;
      el = root.ownerDocument.createElement('div');
      el.className = 'dv-race-hud';
      el.setAttribute('role', 'status');
      root.appendChild(el);
      const draw = (v: JsonValue | undefined): void => {
        if (el && v && typeof v === 'object' && !Array.isArray(v)) renderHud(el as never, v as unknown as RaceHudVm);
      };
      draw(host.vm.get(HUD_VM_KEY));
      off = host.vm.subscribe(HUD_VM_KEY, (v) => draw(v));
    },
    unmount(): void {
      off?.();
      off = null;
      el?.remove();
      el = null;
    },
  };
})();
