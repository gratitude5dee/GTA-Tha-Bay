import type { JsonValue, UiCommand } from '@dv/shared';
import { lk, type LocKey } from '../i18n/index.ts';
import type { PageId } from '../shell/types.ts';

/**
 * `ScreenDef` (10-ui.md section 3.2): the widget vocabulary of the XR-capable pages. One tree is drawn by `DomScreen` (semantic
 * HTML) and by `CanvasScreen` (Canvas 2D, for the XR panels of M11b1), with the same focus order.
 */
export type UiAction =
  | { cmd: UiCommand }
  | { nav: PageId; params?: Record<string, string> }
  | { call: string; args?: JsonValue[] }
  | { back: true };

export type SettingRef =
  | { scope: 'profile'; path: string }
  | { scope: 'device'; path: string }
  | { scope: 'ui'; path: string };

export interface ListRow {
  id: string;
  /** Already localized text (rows are data: save slots, mode tiles). */
  text: string;
  detail?: string;
  badge?: string;
  /** Focusable but not activatable (a `comingSoon` tile, an incompatible slot). */
  disabled?: boolean;
  /** Read aloud with the row when disabled. */
  hint?: string;
}

export type Widget =
  | { k: 'heading'; text: LocKey; level: 1 | 2 | 3 }
  | { k: 'text'; text: LocKey; params?: Record<string, JsonValue>; tone?: 'normal' | 'muted' | 'warning' }
  | { k: 'button'; id: string; label: LocKey; icon?: string; style: 'primary' | 'secondary' | 'danger'; onPress: UiAction; disabled?: LocKey; disabledParams?: Record<string, JsonValue> }
  | { k: 'toggle'; id: string; label: LocKey; bind: SettingRef; hint?: LocKey; disabled?: LocKey }
  | { k: 'slider'; id: string; label: LocKey; bind: SettingRef; min: number; max: number; step: number; unit?: string }
  | { k: 'choice'; id: string; label: LocKey; bind: SettingRef; options: { value: JsonValue; label: LocKey }[]; disabled?: LocKey }
  | { k: 'list'; id: string; rows: ListRow[]; onPress: UiAction; empty: LocKey }
  | { k: 'tabs'; id: string; tabs: { id: string; label: LocKey; children: Widget[] }[] }
  | { k: 'progress'; value: number; label?: LocKey; params?: Record<string, JsonValue> }
  | { k: 'image'; asset: string; alt: LocKey }
  | { k: 'table'; columns: LocKey[]; rows: string[][] }
  | { k: 'spacer'; size: 1 | 2 | 3 };

export interface ScreenDef {
  id: string;
  title: LocKey;
  children: Widget[];
  backTo?: PageId;
  xrSizeM?: { w: number; h: number };
}

/** Everything a renderer needs besides the tree: the setting store, the action runner and the active tab of each `tabs` widget. */
export interface ScreenCtx {
  get(ref: SettingRef): JsonValue | undefined;
  set(ref: SettingRef, value: JsonValue): void;
  /** Runs an action; `rowId` is set for a `list` press. */
  run(action: UiAction, rowId?: string): void;
  tab(tabsId: string): string | undefined;
  setTab(tabsId: string, tabId: string): void;
}

export const SCOPE_KEY: Record<SettingRef['scope'], LocKey> = {
  profile: lk('scope.profile'),
  device: lk('scope.device'),
  ui: lk('scope.device'),
};

/** The active tab of a `tabs` widget: the one in the context when it exists, else the first. */
export function activeTab(w: Extract<Widget, { k: 'tabs' }>, ctx: Pick<ScreenCtx, 'tab'>): string {
  const want = ctx.tab(w.id);
  return w.tabs.find((x) => x.id === want)?.id ?? (w.tabs[0]?.id ?? '');
}
