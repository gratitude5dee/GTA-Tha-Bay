/**
 * `GameModeUI` of Culture Wars (M08a2; FX9): mounts the HUD, the screens and the Training panel into the host root, subscribes to the
 * view models `mode.fighter.view`, `.menu` and `.train`, and sends commands as `mode.cmd`. The arena itself is drawn by the
 * presenter (`ui/presenter.ts`), which the page drives from the same view model. DOM code lives here on the main thread, never in `sim/`.
 */
import type { GameModeUI, JsonValue, UiCommand, ViewModelSource } from '@dv/shared';
import { VM_MENU, VM_TRAIN, VM_VIEW, type FightView, type MenuVm, type TrainVm } from '../sim/vm.ts';
import { HudView, hudModel } from './hud.ts';
import { menuCard } from './menus.ts';
import { FIGHTER_CSS } from './style.ts';
import { tt } from './text.ts';
import { TrainingPanel, type Send } from './training.ts';

const STYLE_ID = 'dvf-style';

interface Mounted {
  root: HTMLElement;
  host: HTMLElement;
  off: (() => void)[];
}

export const fighterUi: GameModeUI = (() => {
  let m: Mounted | null = null;
  return {
    inputContexts: ['fighter'],
    mount(h): void {
      const root = h.root as HTMLElement | null;
      if (!root || typeof root.ownerDocument?.createElement !== 'function') return;
      const doc = root.ownerDocument;
      if (!doc.getElementById(STYLE_ID)) {
        const style = doc.createElement('style');
        style.id = STYLE_ID;
        style.textContent = FIGHTER_CSS;
        doc.head.append(style);
      }
      const host = doc.createElement('div');
      host.className = 'dvf';
      host.dataset['testid'] = 'fighter-ui';
      host.dataset['palette'] = 'default';
      host.dataset['rm'] = '0';
      root.append(host);
      const send: Send = (name, args) => h.send({ t: 'mode.cmd', mode: 'fighter', name, ...(args ? { args } : {}) } as UiCommand);
      const hud = new HudView(doc);
      const train = new TrainingPanel(doc, send);
      const menu = doc.createElement('div');
      menu.className = 'dvf-menu';
      const dim = doc.createElement('div');
      dim.className = 'dvf-dim';
      const tools = doc.createElement('div');
      tools.className = 'dvf-tools';
      const pauseBtn = doc.createElement('button');
      pauseBtn.type = 'button';
      pauseBtn.className = 'dvf-chip';
      pauseBtn.dataset['testid'] = 'fighter-pause-btn';
      pauseBtn.textContent = tt('fighter.ui.pause');
      pauseBtn.addEventListener('click', () => send('pause', { on: true }));
      tools.append(pauseBtn);
      host.append(hud.root, train.root, tools, menu, dim);
      train.render(null);
      hud.setVisible(false);

      let lastMenu: MenuVm | null = null;
      let lastView: FightView | null = null;
      let menuSig = '';
      const drawMenu = (mv: MenuVm | undefined): void => {
        if (!mv) { menu.textContent = ''; lastMenu = null; return; }
        lastMenu = mv;
        const sig = JSON.stringify([mv.screen, mv.paused, mv.kind, mv.p1, mv.p2, mv.stage, mv.night, mv.cpu, mv.scheme, mv.rounds, mv.results, mv.fighters, mv.origin, mv.moveList.length]);
        const showHud = mv.screen === 'match' || mv.screen === 'results';
        hud.setVisible(showHud);
        tools.style.display = mv.screen === 'match' && !mv.paused ? 'block' : 'none';
        if (sig === menuSig) return;
        menuSig = sig;
        menu.textContent = '';
        const card = menuCard(doc, mv, send);
        if (card) menu.append(card);
      };
      const names = (v: FightView): [string, string] => {
        const nm = (id: string): string => {
          const f = lastMenu?.fighters.find((x) => x.id === id);
          return f ? tt(f.nameKey) : id;
        };
        return [nm(v.id[0]), nm(v.id[1])];
      };
      const drawView = (jv: JsonValue | undefined): void => {
        if (!jv || typeof jv !== 'object' || Array.isArray(jv)) { lastView = null; hud.setVisible(false); return; }
        const v = jv as unknown as FightView;
        lastView = v;
        if (lastMenu && (lastMenu.screen === 'match' || lastMenu.screen === 'results')) hud.setVisible(true);
        hud.render(hudModel(v, names(v)), v.t, v.f[0][2]);
        host.dataset['rm'] = String(v.rm);
        dim.dataset['on'] = v.rm === 1 && v.fz >= 43 ? '1' : '0';
      };
      const drawTrain = (jv: JsonValue | undefined): void => train.render(jv && typeof jv === 'object' && !Array.isArray(jv) ? (jv as unknown as TrainVm) : null);
      const vm: ViewModelSource = h.vm;
      drawMenu(vm.get<JsonValue>(VM_MENU) as unknown as MenuVm | undefined);
      drawView(vm.get<JsonValue>(VM_VIEW));
      drawTrain(vm.get<JsonValue>(VM_TRAIN));
      const off: (() => void)[] = [
        vm.subscribe(VM_MENU, (v) => drawMenu(v as unknown as MenuVm | undefined)),
        vm.subscribe(VM_VIEW, (v) => drawView(v)),
        vm.subscribe(VM_TRAIN, (v) => drawTrain(v)),
      ];
      // Accessibility: reduced motion and the HUD palette follow the profile settings (R-ENG-04).
      const applySettings = (v: JsonValue | undefined): void => {
        const acc = (v as { accessibility?: { reducedMotion?: boolean; hudPalette?: string } } | undefined)?.accessibility;
        const osReduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
        send('access', { reducedMotion: acc?.reducedMotion === true || osReduced });
        const p = acc?.hudPalette;
        host.dataset['palette'] = p === 'deutan' || p === 'protan' || p === 'tritan' ? p : 'default';
      };
      applySettings(vm.get<JsonValue>('sys.settings'));
      off.push(vm.subscribe('sys.settings', (v) => applySettings(v)));
      m = { root, host, off };
      void lastView;
    },
    unmount(): void {
      if (!m) return;
      for (const f of m.off) f();
      m.host.remove();
      m = null;
    },
    summary(slice) {
      const won = slice && typeof slice === 'object' ? Object.keys((slice as { fighterXp?: Record<string, number> }).fighterXp ?? {}).length : 0;
      return { lines: [{ label: 'fighter.ui.title', value: String(won) }] };
    },
  };
})();

export default fighterUi;
