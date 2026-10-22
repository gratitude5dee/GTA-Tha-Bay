/**
 * The `GameModeUI` host (C06 1.1, M04b2): mounts a mode's UI into a root element with `{root, vm, send}` and unmounts it. A mount that
 * throws shows "This screen failed - return to menu" in the root and reports one `err.js`; the shell stays up and `onFail` lets the app
 * return to the menu. The mode UI never sees the shell, only the view-model source and the command sender.
 */
import type { GameModeUI, UiCommand, ViewModelSource } from '@dv/shared';
import { t } from '../i18n/index.ts';

export interface ModeUiHostOptions {
  vm: ViewModelSource;
  send(cmd: UiCommand): void;
  /** Reports the failure (the platform telemetry `err.js`, once). */
  report(name: 'err.js', props: { fp: string; msg: string; top: string }): void;
  /** Called after the failure panel is shown; the app returns to the menu from here (or on the panel's button). */
  onFail?(): void;
  /** Document used to build the failure panel. */
  doc?: Document;
}

export interface MountedModeUi {
  readonly failed: boolean;
  unmount(): void;
}

/** A short stable fingerprint of the failure for the telemetry event. */
function fingerprint(msg: string): string {
  let h = 2166136261;
  for (let i = 0; i < msg.length; i++) h = Math.imul(h ^ msg.charCodeAt(i), 16777619) >>> 0;
  return h.toString(16).padStart(8, '0');
}

export function mountModeUi(ui: GameModeUI, root: HTMLElement, o: ModeUiHostOptions): MountedModeUi {
  let failed = false;
  let mounted = false;
  const fail = (e: unknown): void => {
    failed = true;
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    const top = (e instanceof Error ? e.stack ?? '' : '').split('\n')[1]?.trim().slice(0, 128) ?? '';
    o.report('err.js', { fp: fingerprint(msg), msg: msg.slice(0, 128), top });
    const doc = o.doc ?? root.ownerDocument;
    root.textContent = '';
    const box = doc.createElement('div');
    box.setAttribute('role', 'alert');
    box.dataset['testid'] = 'mode-ui-failed';
    const p = doc.createElement('p');
    p.textContent = t('modeui.failed');
    const b = doc.createElement('button');
    b.type = 'button';
    b.textContent = t('modeui.backToMenu');
    b.dataset['testid'] = 'mode-ui-back';
    b.addEventListener('click', () => o.send({ t: 'mode.quit' }));
    box.append(p, b);
    root.append(box);
    o.onFail?.();
  };
  try {
    ui.mount({ root, vm: o.vm, send: o.send });
    mounted = true;
  } catch (e) {
    fail(e);
  }
  return {
    get failed() {
      return failed;
    },
    unmount() {
      if (mounted) {
        try {
          ui.unmount();
        } catch (e) {
          fail(e);
        }
        mounted = false;
      }
      if (!failed) root.textContent = '';
    },
  };
}
