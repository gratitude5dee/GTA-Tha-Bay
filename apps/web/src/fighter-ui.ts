/**
 * The page side of Culture Wars (M08a2): while the fighter runs (as the root mode or embedded in the story), mounts its DOM
 * (HUD, screens, Training panel) from `@dv/mode-fighter/ui` and shows its arena through the renderer host's menu-scene slot
 * (`@dv/mode-fighter/ui/presenter`), fed by the view models `mode.fighter.view` and `mode.fighter.train`. When the mode ends, both
 * go away and the world is drawn again. The input context and the touch layout follow the mode in the engine (`boot-engine.ts`).
 */
import type { EngineHandle } from '@dv/engine/client/boot';
import type { RendererHost } from '@dv/engine/platform/renderer-host';
import type { JsonValue } from '@dv/shared';
import type { FighterStage } from '@dv/mode-fighter/ui/presenter';
import { mountModeUi, type MountedModeUi } from '@dv/ui/host/mode-ui-host';

export interface FighterUiHandle {
  /** The presenter while the fighter is on screen, or null (QA bridge `fighterStage`). */
  stage(): FighterStage | null;
  dispose(): void;
}

interface Running {
  ui: MountedModeUi;
  root: HTMLElement;
  stage: FighterStage;
  offs: (() => void)[];
}

export function installFighterUi(opts: {
  engine: EngineHandle;
  host: RendererHost;
  report(name: 'err.js', props: { fp: string; msg: string; top: string }): void;
}): FighterUiHandle {
  const { engine, host } = opts;
  let running: Running | null = null;
  let starting = false;

  const fighting = (): boolean => {
    const v = engine.vm.get('sys.mode') as { stack?: { id: string; state: string }[] } | undefined;
    return (v?.stack ?? []).some((e) => e.id === 'fighter' && (e.state === 'Running' || e.state === 'Entering' || e.state === 'Loading'));
  };

  const start = async (): Promise<void> => {
    if (running || starting) return;
    starting = true;
    try {
      const [{ fighterUi }, { createFighterStage }] = await Promise.all([import('@dv/mode-fighter/ui'), import('@dv/mode-fighter/ui/presenter')]);
      if (!fighting()) return;
      const root = document.createElement('div');
      root.id = 'dv-fighter-ui';
      root.setAttribute('data-ui-skip', '');
      document.body.append(root);
      const ui = mountModeUi(fighterUi, root, { vm: engine.vm as never, send: (c) => void engine.sendUi(c), report: opts.report });
      const stage = createFighterStage(host);
      stage.show();
      let train: unknown = null;
      const offs: (() => void)[] = [];
      offs.push(engine.vm.subscribe('mode.fighter.train', (v: JsonValue | undefined) => { train = v ?? null; }));
      offs.push(engine.vm.subscribe('mode.fighter.view', (v: JsonValue | undefined) => stage.apply((v ?? null) as never, train as never)));
      const cur = engine.vm.get('mode.fighter.view') as JsonValue | undefined;
      if (cur) stage.apply(cur as never, null);
      let last = -1;
      offs.push(host.addFrameListener({
        before: (time: number) => {
          const dt = last < 0 ? 0 : Math.min(0.1, (time - last) / 1000);
          last = time;
          stage.frame(dt);
        },
      }));
      running = { ui, root, stage, offs };
    } finally {
      starting = false;
    }
  };

  const stop = (): void => {
    const r = running;
    if (!r) return;
    running = null;
    for (const off of r.offs) off();
    r.stage.hide();
    r.stage.dispose();
    r.ui.unmount();
    r.root.remove();
  };

  const sync = (): void => {
    if (fighting()) void start().catch((e: unknown) => console.warn('fighter ui failed', e));
    else stop();
  };
  const off = engine.vm.subscribe('sys.mode', sync);
  sync();
  return {
    stage: () => running?.stage ?? null,
    dispose: () => {
      off();
      stop();
    },
  };
}
