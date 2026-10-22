/**
 * `UiSurface` (10-ui-hud-xr.md 2.12, M04b2 skeleton): draws a `ScreenDef` into an XR panel through `CanvasScreen`. The panel is a C13
 * `XrPanel` (`draw`, `onRay`) given to the platform's `XrPanels` (`add`, `remove`, `setVisible`). Rules built in:
 *  - `pixelsPerMetre` 1024; the minimum text size is 1.5 degrees of visual angle at `uiDistanceM` (1.2 m by default), so the layout is
 *    drawn scaled until its smallest text reaches that size (about 33 px at 1,024 px/m and 1.2 m);
 *  - the panel redraws only when a view-model value or the focus changed (dirty flag), at most 30 Hz;
 *  - rays: `onRay(hit, pressed, hand)` moves the focus and a press activates the item under the ray; a 150 ms debounce stops a double
 *    activation; nothing depends on hover (Vision Pro has none before a pinch);
 *  - head-locked panels do not exist: the anchor type has no such value.
 * The skeleton has no panel of its own for a page; M11b1 and M11b3 place the real ones. A test panel exists under IWER only (QA builds).
 */
import type { JsonValue, ViewModelSource } from '@dv/shared';
import { lk } from '../i18n/index.ts';
import { CanvasScreen, type Canvas2DLike } from './canvas-screen.ts';
import type { ScreenCtx, ScreenDef, UiAction } from './types.ts';

export type XrAnchor = 'world' | 'wrist' | 'lazy-follow';
export const UI_DISTANCE_M = 1.2;
export const PIXELS_PER_METRE = 1024;
/** Minimum text size, degrees of visual angle (S11 starting value). */
export const MIN_TEXT_DEG = 1.5;
export const MAX_REDRAW_HZ = 30;
export const PRESS_DEBOUNCE_MS = 150;

/** The canvas context the panel draws with: the 2D subset `CanvasScreen` needs, plus the transform calls. */
export interface PanelContext extends Canvas2DLike {
  save(): void;
  restore(): void;
  scale(x: number, y: number): void;
}

/** C13 `XrPanel` as `UiSurface` hands it over (a structural copy: `@dv/ui` imports no engine code). */
export interface XrPanelDef {
  id: string;
  sizeM: { w: number; h: number };
  pixels: { w: number; h: number };
  anchor: XrAnchor;
  draw(ctx: PanelContext, tSec: number): void;
  onRay(hit: { u: number; v: number } | null, pressed: boolean, hand: 'left' | 'right'): void;
  /** True when the next `draw` would change the picture. The panels host calls `draw` (and uploads the texture) only then. */
  dirty(): boolean;
  /** How far in front of the head the panel opens, metres. */
  distanceM: number;
}

/** The part of the platform's `XrPanels` that `UiSurface` uses. */
export interface XrPanelsPort {
  add(panel: XrPanelDef): void;
  remove(id: string): void;
  setVisible(id: string, visible: boolean): void;
}

/** Pixels a line of text needs to subtend `deg` degrees at `distanceM` when the panel has `ppm` pixels per metre. */
export function minTextPx(distanceM = UI_DISTANCE_M, ppm = PIXELS_PER_METRE, deg = MIN_TEXT_DEG): number {
  return 2 * distanceM * Math.tan((deg * Math.PI) / 360) * ppm;
}

/** Visual angle in degrees of a line of `textPx` on a panel with `ppm` pixels per metre seen from `distanceM`. */
export function textAngleDeg(textPx: number, distanceM = UI_DISTANCE_M, ppm = PIXELS_PER_METRE): number {
  return (2 * Math.atan(textPx / ppm / 2 / distanceM) * 180) / Math.PI;
}

/** The smallest font size `CanvasScreen` uses: its labels are 24 px and its smallest text rows 20 px. */
const SMALLEST_LAYOUT_TEXT_PX = 20;

export interface UiPanelOptions {
  anchor: XrAnchor;
  id?: string;
  pixelsPerMetre?: number;
  distanceM?: number;
  /** The screen's setting store and action runner. */
  ctx?: Partial<ScreenCtx>;
  /** View-model keys whose change marks the panel dirty (`hud.*` and so on). */
  vm?: { source: ViewModelSource; keys: readonly string[] };
  now?: () => number;
}

export interface UiPanel {
  readonly id: string;
  readonly def: XrPanelDef;
  /** How many times the panel has drawn. */
  readonly redraws: number;
  /** The smallest text in the panel, degrees of visual angle at its distance. */
  readonly minTextDeg: number;
  /** Replaces the screen (a page changed) and redraws. */
  update(screen: ScreenDef): void;
  /** Marks the panel for a redraw (a view-model value changed). */
  markDirty(): void;
  /** The centre of the first item for a simulated ray, in panel coordinates (u, v in 0..1). */
  firstItemAt(): { u: number; v: number } | null;
  dispose(): void;
}

let serial = 0;

export class UiSurface {
  private readonly panels = new Map<string, { panel: UiPanel; offs: (() => void)[] }>();

  constructor(private readonly host: XrPanelsPort) {}

  /** Creates a panel for `screen`, hands it to the panels host and returns its handle. */
  panel(screen: ScreenDef, o: UiPanelOptions): UiPanel {
    const ppm = o.pixelsPerMetre ?? PIXELS_PER_METRE;
    const distance = o.distanceM ?? UI_DISTANCE_M;
    const id = o.id ?? `ui-panel-${++serial}`;
    const now = o.now ?? (() => (typeof performance === 'undefined' ? 0 : performance.now()));
    const tabs = new Map<string, string>();
    const ctx: ScreenCtx = {
      get: o.ctx?.get ?? (() => undefined as JsonValue | undefined),
      set: (r, v) => {
        o.ctx?.set?.(r, v);
        dirty = true;
      },
      run: (a: UiAction, rowId?: string) => {
        o.ctx?.run?.(a, rowId);
        dirty = true;
      },
      tab: (tid) => tabs.get(tid),
      setTab: (tid, tab) => {
        tabs.set(tid, tab);
        dirty = true;
      },
    };
    // The text must reach 1.5 degrees: draw the layout scaled up until its smallest text does, and size the panel to the result.
    const scale = Math.max(1, minTextPx(distance, ppm) / SMALLEST_LAYOUT_TEXT_PX);
    const pxW = ppm;
    let cs = new CanvasScreen(screen, ctx, Math.round(pxW / scale));
    let dirty = true;
    let redraws = 0;
    let lastDraw = -Infinity;
    let lastPress = -Infinity;
    let pressedBefore = false;
    const size = (): { w: number; h: number } => ({ w: pxW, h: Math.ceil(cs.height * scale) });
    const def: XrPanelDef = {
      id,
      anchor: o.anchor,
      distanceM: distance,
      get pixels() {
        return size();
      },
      get sizeM() {
        const p = size();
        return { w: p.w / ppm, h: p.h / ppm };
      },
      dirty: () => dirty && now() - lastDraw >= 1000 / MAX_REDRAW_HZ,
      draw: (g) => {
        if (!dirty) return;
        const t = now();
        if (t - lastDraw < 1000 / MAX_REDRAW_HZ) return;
        lastDraw = t;
        dirty = false;
        redraws++;
        cs.relayout();
        g.save();
        g.scale(scale, scale);
        cs.draw(g);
        g.restore();
      },
      onRay: (hit, pressed) => {
        if (!hit) {
          pressedBefore = false;
          return;
        }
        const t = now();
        const rising = pressed && !pressedBefore;
        pressedBefore = pressed;
        if (rising && t - lastPress < PRESS_DEBOUNCE_MS) return;
        if (rising) lastPress = t;
        const before = cs.focus;
        const item = cs.pick(hit.u, hit.v, rising);
        if (item && (rising || cs.focus !== before)) dirty = true;
      },
    };
    const handle: UiPanel = {
      id,
      def,
      get redraws() {
        return redraws;
      },
      get minTextDeg() {
        return textAngleDeg(SMALLEST_LAYOUT_TEXT_PX * scale, distance, ppm);
      },
      update(next) {
        cs = new CanvasScreen(next, ctx, Math.round(pxW / scale));
        dirty = true;
      },
      markDirty() {
        dirty = true;
      },
      firstItemAt() {
        const it = cs.layout.items[0];
        if (!it) return null;
        return { u: (it.rect.x + it.rect.w / 2) / cs.width, v: (it.rect.y + it.rect.h / 2) / cs.height };
      },
      dispose: () => this.remove(id),
    };
    const offs: (() => void)[] = [];
    if (o.vm) for (const k of o.vm.keys) offs.push(o.vm.source.subscribe(k as never, () => (dirty = true)));
    this.panels.set(id, { panel: handle, offs });
    this.host.add(def);
    return handle;
  }

  remove(id: string): void {
    const p = this.panels.get(id);
    if (!p) return;
    for (const off of p.offs) off();
    this.panels.delete(id);
    this.host.remove(id);
  }

  get count(): number {
    return this.panels.size;
  }
}

/** The screen of the QA test panel (IWER only): a counter fed by the view model and one button. */
export function testScreen(): ScreenDef {
  return {
    id: 'xr-test-panel',
    title: lk('xr.test.title'),
    children: [
      { k: 'heading', text: lk('xr.test.title'), level: 1 },
      { k: 'text', text: lk('xr.test.counter'), params: { n: 0 } },
      { k: 'button', id: 'xr-test-press', label: lk('xr.test.press'), style: 'primary', onPress: { call: 'xr.test.press' } },
    ],
  };
}
