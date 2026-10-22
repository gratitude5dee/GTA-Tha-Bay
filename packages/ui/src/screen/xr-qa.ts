/**
 * The QA test panel of the UI skeleton (M04b2, AC-11): `window.__dvBridge.ui` exists only in QA builds with an XR panels host (IWER in
 * CI). It builds a small `ScreenDef` through `UiSurface`, presses its button with a simulated ray, bumps a view-model value, and reports
 * the numbers the test checks: the distance in front of the head, the text size in degrees, the redraw count.
 */
import type { JsonValue } from '@dv/shared';
import { t } from '../i18n/index.ts';
import type { ScreenDef } from './types.ts';
import { testScreen, UiSurface, type UiPanel, type XrPanelDef, type XrPanelsPort } from './xr.ts';

/** The scene panels host with the QA readouts (`XrPanelsLite` in the engine). */
export interface QaPanelsHost extends XrPanelsPort {
  ray(id: string, hit: { u: number; v: number } | null, pressed: boolean, hand?: 'left' | 'right'): void;
  info(id: string): { visible: boolean; anchor: string; openDistanceM: number; distanceM: number; sizeM: { w: number; h: number }; pixels: { w: number; h: number }; uploads: number } | null;
}

export interface QaVm {
  subscribe(k: never, cb: (v: JsonValue | undefined) => void): () => void;
  setLocal(k: never, v: JsonValue | null): void;
  get(k: never): JsonValue | undefined;
}

export interface XrTestPanelState {
  open: boolean;
  anchor: string;
  distanceM: number;
  openDistanceM: number;
  minTextDeg: number;
  redraws: number;
  uploads: number;
  presses: number;
  counter: number;
  sizeM: { w: number; h: number };
  pixels: { w: number; h: number };
}

const KEY = 'hud.xrTest';

export interface UiQaBridge {
  open(): XrTestPanelState;
  /** A simulated ray at the centre of the button: pointer over, press, release. */
  press(): boolean;
  /** Changes the view-model value the panel shows; the panel redraws once. */
  bump(): number;
  state(): XrTestPanelState | null;
  close(): void;
}

export function createUiQaBridge(panels: QaPanelsHost, vm: QaVm): UiQaBridge {
  const surface = new UiSurface(panels);
  let panel: UiPanel | null = null;
  let presses = 0;
  let counter = 0;
  const screen = (): ScreenDef => {
    const s = testScreen();
    const text = s.children[1];
    if (text && text.k === 'text') text.params = { n: counter };
    return s;
  };
  const state = (): XrTestPanelState | null => {
    if (!panel) return null;
    const info = panels.info(panel.id);
    return {
      open: info !== null,
      anchor: info?.anchor ?? '',
      distanceM: info?.distanceM ?? 0,
      openDistanceM: info?.openDistanceM ?? 0,
      minTextDeg: panel.minTextDeg,
      redraws: panel.redraws,
      uploads: info?.uploads ?? 0,
      presses,
      counter,
      sizeM: info?.sizeM ?? { w: 0, h: 0 },
      pixels: info?.pixels ?? { w: 0, h: 0 },
    };
  };
  return {
    open() {
      panel?.dispose();
      presses = 0;
      counter = 0;
      panel = surface.panel(screen(), {
        anchor: 'world',
        id: 'xr-test-panel',
        ctx: {
          run: (a) => {
            if ('call' in a && a.call === 'xr.test.press') {
              presses++;
              panel?.update(screen());
            }
          },
        },
        vm: { source: vm as never, keys: [KEY] },
      });
      return state() as XrTestPanelState;
    },
    press() {
      if (!panel) return false;
      const at = panel.firstItemAt();
      if (!at) return false;
      const before = presses;
      panels.ray(panel.id, at, false);
      panels.ray(panel.id, at, true);
      panels.ray(panel.id, at, false);
      return presses === before + 1;
    },
    bump() {
      counter++;
      panel?.update(screen());
      vm.setLocal(KEY as never, counter);
      return counter;
    },
    state,
    close() {
      panel?.dispose();
      panel = null;
    },
  };
}

/** Label of the test panel's text, for a screenshot or a check: the localized counter line. */
export const testPanelText = (n: number): string => t('xr.test.counter', { n });

export type { XrPanelDef };
