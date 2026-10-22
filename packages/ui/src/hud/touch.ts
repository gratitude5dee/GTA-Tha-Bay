/**
 * Touch layouts (10-ui-hud-xr.md 2.9, M04b2): the type, the four shipped layouts (`config/input/touch/*.json`), the resolver for
 * `ControlsSettings.touch.layout` (a shipped id or `custom:<n>` from `UiPrefs.customTouchLayouts`, falling back to `default-right`), the
 * validation the unit tests and the editor share (safe area, target size, spacing, known actions, reach) and the pure editing steps.
 *
 * The numbers: targets at least 44 CSS px, at least 8 px between buttons, stick radius 58 px (C03 rule 10). The viewport and insets
 * of the checks are the design fixture `packages/ui/test/fixtures/iphone-landscape.json`, not a device fact (U-UI-10).
 */
import type { ActionId, JsonObject } from '@dv/shared';
import defaultLeft from '../../../../config/input/touch/default-left.json';
import defaultRight from '../../../../config/input/touch/default-right.json';
import compact from '../../../../config/input/touch/compact.json';
import oneHanded from '../../../../config/input/touch/one-handed.json';

export interface Rect { x: number; y: number; w: number; h: number }
export interface Anchor { corner: 'bl' | 'br' | 'tl' | 'tr'; dx: number; dy: number }
export type TouchWidget =
  | { id: string; kind: 'stick'; role: 'move' | 'steer'; zone: Rect }
  | { id: string; kind: 'lookzone'; zone: Rect }
  | { id: string; kind: 'button'; action: ActionId; at: Anchor; sizePx: number; icon: string; label?: string; toggle?: boolean }
  | { id: string; kind: 'pedal'; axis: 'throttle' | 'brake'; at: Anchor; w: number; h: number }
  | { id: string; kind: 'dpad'; at: Anchor; sizePx: number };
export interface TouchLayout {
  v: 1;
  id: string;
  nameKey: string;
  context: 'onFoot' | 'vehicle' | 'fighter';
  handed: 'right' | 'left';
  opacity?: number;
  widgets: TouchWidget[];
}
export type ButtonWidget = Extract<TouchWidget, { kind: 'button' }>;

export const MIN_TARGET_PX = 44;
export const MIN_SPACING_PX = 8;
export const SIZE_RANGE = { min: 40, max: 96 } as const;
export const OPACITY_RANGE = { min: 0.2, max: 1 } as const;
export const SNAP_PX = 8;
export const CUSTOM_SLOTS = 4;
export const DEFAULT_LAYOUT_ID = 'default-right';

export const SHIPPED_LAYOUTS: Readonly<Record<string, TouchLayout>> = {
  'default-right': defaultRight as unknown as TouchLayout,
  'default-left': defaultLeft as unknown as TouchLayout,
  compact: compact as unknown as TouchLayout,
  'one-handed': oneHanded as unknown as TouchLayout,
};
export const SHIPPED_IDS: readonly string[] = ['default-right', 'default-left', 'compact', 'one-handed'];

const SIM_ACTIONS = ['Jump', 'Sprint', 'Interact', 'Enter', 'Attack', 'Block', 'Special', 'Handbrake', 'Nitro', 'Ability', 'LookBehind', 'Horn', 'FightHeavy', 'FightAssist', 'Teleport', 'Crouch', 'Respray', 'Emote', 'PhoneQuick'] as const;
const CLIENT_ACTIONS = ['Look', 'Camera', 'ShoulderSwap', 'Map', 'Phone', 'Pause', 'SnapTurnLeft', 'SnapTurnRight', 'UiAccept', 'UiBack', 'UiUp', 'UiDown', 'UiLeft', 'UiRight', 'UiTabPrev', 'UiTabNext', 'PhotoShutter', 'DebugToggle'] as const;
/** Every C03 ActionId a button can name (the type keeps this list honest against the contract). */
export const ACTION_IDS: ReadonlySet<string> = new Set<ActionId>([
  ...SIM_ACTIONS.map((n) => `sim.${n}` as ActionId),
  ...CLIENT_ACTIONS.map((n) => `client.${n}` as ActionId),
]);

/** What an on-foot layout must offer a player who cannot reach beyond one thumb (2.9, "one-handed"). */
export const REQUIRED_ONFOOT: readonly ActionId[] = ['sim.Jump', 'sim.Enter', 'sim.Attack', 'client.Camera', 'client.Phone', 'client.Pause'];

/** One thumb at rest (CSS px from the bottom right safe-area corner) and how far it reaches. Design values. */
export const THUMB = { dx: 70, dy: 80, reachPx: 300 } as const;

export interface Fixture { viewport: { width: number; height: number }; insets: { top: number; right: number; bottom: number; left: number } }

/** The pixel rectangle of a widget in a viewport with insets. */
export function boxOf(w: TouchWidget, f: Fixture): { x: number; y: number; w: number; h: number } {
  const { width, height } = f.viewport;
  const ins = f.insets;
  if (w.kind === 'stick' || w.kind === 'lookzone') return { x: w.zone.x * width, y: w.zone.y * height, w: w.zone.w * width, h: w.zone.h * height };
  const bw = w.kind === 'pedal' ? w.w : w.sizePx;
  const bh = w.kind === 'pedal' ? w.h : w.sizePx;
  const left = w.at.corner[1] === 'l';
  const top = w.at.corner[0] === 't';
  const x = left ? ins.left + w.at.dx : width - ins.right - w.at.dx - bw;
  const y = top ? ins.top + w.at.dy : height - ins.bottom - w.at.dy - bh;
  return { x, y, w: bw, h: bh };
}

export interface Problem { widget: string; kind: 'safe-area' | 'size' | 'spacing' | 'action' | 'missing' | 'overlap' | 'reach'; detail: string }

/** Validates a layout against the fixture; an empty list means it passes (the editor shows the same list as warnings). */
export function validateLayout(l: TouchLayout, f: Fixture): Problem[] {
  const out: Problem[] = [];
  const safe = { x: f.insets.left, y: f.insets.top, w: f.viewport.width - f.insets.left - f.insets.right, h: f.viewport.height - f.insets.top - f.insets.bottom };
  const buttons = l.widgets.filter((w) => w.kind === 'button' || w.kind === 'pedal' || w.kind === 'dpad');
  for (const w of l.widgets) {
    const b = boxOf(w, f);
    const eps = 0.5;
    if (b.x < safe.x - eps || b.y < safe.y - eps || b.x + b.w > safe.x + safe.w + eps || b.y + b.h > safe.y + safe.h + eps) out.push({ widget: w.id, kind: 'safe-area', detail: `${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}x${Math.round(b.h)}` });
    if (w.kind === 'button' && (w.sizePx < MIN_TARGET_PX || !ACTION_IDS.has(w.action))) {
      if (w.sizePx < MIN_TARGET_PX) out.push({ widget: w.id, kind: 'size', detail: String(w.sizePx) });
      if (!ACTION_IDS.has(w.action)) out.push({ widget: w.id, kind: 'action', detail: w.action });
    }
    if ((w.kind === 'pedal' && (w.w < MIN_TARGET_PX || w.h < MIN_TARGET_PX)) || (w.kind === 'dpad' && w.sizePx < MIN_TARGET_PX)) out.push({ widget: w.id, kind: 'size', detail: w.kind });
  }
  for (let i = 0; i < buttons.length; i++) {
    for (let j = i + 1; j < buttons.length; j++) {
      const a = boxOf(buttons[i] as TouchWidget, f);
      const c = boxOf(buttons[j] as TouchWidget, f);
      const gapX = Math.max(c.x - (a.x + a.w), a.x - (c.x + c.w));
      const gapY = Math.max(c.y - (a.y + a.h), a.y - (c.y + c.h));
      const gap = Math.max(gapX, gapY);
      if (gap < 0) out.push({ widget: `${(buttons[i] as TouchWidget).id}+${(buttons[j] as TouchWidget).id}`, kind: 'overlap', detail: `${Math.round(gap)}` });
      else if (gap < MIN_SPACING_PX) out.push({ widget: `${(buttons[i] as TouchWidget).id}+${(buttons[j] as TouchWidget).id}`, kind: 'spacing', detail: `${Math.round(gap)}` });
    }
  }
  if (l.context === 'onFoot') {
    const have = new Set(l.widgets.filter((w): w is ButtonWidget => w.kind === 'button').map((w) => w.action));
    for (const a of REQUIRED_ONFOOT) if (!have.has(a)) out.push({ widget: a, kind: 'missing', detail: a });
  }
  return out;
}

/** Distance from the resting thumb to the centre of a button, CSS px. */
export function reachOf(w: ButtonWidget, f: Fixture): number {
  const b = boxOf(w, f);
  const rest = { x: f.viewport.width - f.insets.right - THUMB.dx, y: f.viewport.height - f.insets.bottom - THUMB.dy };
  return Math.hypot(b.x + b.w / 2 - rest.x, b.y + b.h / 2 - rest.y);
}

/** The buttons farther from the thumb than it reaches; the `one-handed` layout must have none. */
export function outOfReach(l: TouchLayout, f: Fixture): string[] {
  return l.widgets.filter((w): w is ButtonWidget => w.kind === 'button').filter((w) => reachOf(w, f) > THUMB.reachPx).map((w) => w.id);
}

// ---- resolving

const isLayout = (x: unknown): x is TouchLayout => {
  if (x === null || typeof x !== 'object') return false;
  const o = x as Partial<TouchLayout>;
  return o.v === 1 && typeof o.id === 'string' && Array.isArray(o.widgets) && o.widgets.length > 0;
};

/** The layout `ControlsSettings.touch.layout` names; a missing or broken `custom:<n>` and an unknown id give `default-right`. */
export function resolveLayout(id: string | undefined, customs: Readonly<Record<string, JsonObject>>): TouchLayout {
  if (id && SHIPPED_LAYOUTS[id]) return SHIPPED_LAYOUTS[id] as TouchLayout;
  if (id && /^custom:[1-4]$/.test(id)) {
    const c = customs[id];
    if (isLayout(c)) return c;
  }
  return SHIPPED_LAYOUTS[DEFAULT_LAYOUT_ID] as TouchLayout;
}

// ---- editing steps (pure; the editor component calls them)

const snap = (v: number): number => Math.round(v / SNAP_PX) * SNAP_PX;
const clampN = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function editButton(l: TouchLayout, id: string, patch: { dx?: number; dy?: number; sizePx?: number }): TouchLayout {
  return {
    ...l,
    widgets: l.widgets.map((w) => {
      if (w.kind !== 'button' || w.id !== id) return w;
      return {
        ...w,
        sizePx: patch.sizePx === undefined ? w.sizePx : clampN(Math.round(patch.sizePx), SIZE_RANGE.min, SIZE_RANGE.max),
        at: { ...w.at, dx: patch.dx === undefined ? w.at.dx : Math.max(0, snap(patch.dx)), dy: patch.dy === undefined ? w.at.dy : Math.max(0, snap(patch.dy)) },
      };
    }),
  };
}

export function setOpacity(l: TouchLayout, opacity: number): TouchLayout {
  return { ...l, opacity: clampN(Math.round(opacity * 100) / 100, OPACITY_RANGE.min, OPACITY_RANGE.max) };
}

/** Saves a copy as `custom:<n>` (1 to 4). */
export function asCustom(l: TouchLayout, n: number): TouchLayout {
  const slot = clampN(Math.round(n), 1, CUSTOM_SLOTS);
  return { ...structuredClone(l), id: `custom:${slot}`, nameKey: 'touch.layout.custom' };
}

/** The first free custom slot, or 1 when all four are used (the oldest is replaced). */
export function nextCustomSlot(customs: Readonly<Record<string, unknown>>): number {
  for (let n = 1; n <= CUSTOM_SLOTS; n++) if (!customs[`custom:${n}`]) return n;
  return 1;
}

/** Layout ids offered in Settings: the shipped four, then the saved customs. */
export function layoutChoices(customs: Readonly<Record<string, unknown>>): string[] {
  return [...SHIPPED_IDS, ...Object.keys(customs).filter((k) => /^custom:[1-4]$/.test(k)).sort()];
}
