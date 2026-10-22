import type { JsonValue } from '@dv/shared';
import { t } from '../i18n/index.ts';
import { activeTab, type ScreenCtx, type ScreenDef, type Widget } from './types.ts';

/**
 * `CanvasScreen` (10-ui.md section 3.2): the Canvas 2D renderer of a `ScreenDef`, for the XR panels (M11b1 puts it on a quad or
 * cylinder layer). It lays the same tree out in panel pixels, draws it, and answers `pick(u, v, pressed)` for controller and hand
 * rays. Its focus order must equal `DomScreen`'s (`ui-screen-parity`).
 */
export interface Rect { x: number; y: number; w: number; h: number }
export interface CanvasItem {
  fid: string;
  rect: Rect;
  widget: Widget;
  label: string;
  /** For list rows, choice options and tabs: the id or index the press acts on. */
  sub?: string | number;
  on?: boolean;
  disabled?: boolean;
}
export interface CanvasLayout { items: CanvasItem[]; height: number; text: { rect: Rect; text: string; size: number; muted: boolean }[] }

/** The slice of CanvasRenderingContext2D the renderer uses (tests pass a recorder). */
export interface Canvas2DLike {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  font: string;
  textBaseline: CanvasTextBaseline;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
}

const PAD = 24;
const ROW = 64;
const same = (a: JsonValue | undefined, b: JsonValue): boolean => JSON.stringify(a) === JSON.stringify(b);

export function layoutScreen(screen: ScreenDef, ctx: ScreenCtx, width: number): CanvasLayout {
  const items: CanvasItem[] = [];
  const text: CanvasLayout['text'] = [];
  let y = PAD;
  const inner = width - PAD * 2;

  const place = (w: Widget): void => {
    switch (w.k) {
      case 'heading':
        text.push({ rect: { x: PAD, y, w: inner, h: 56 }, text: t(w.text), size: w.level === 1 ? 40 : w.level === 2 ? 32 : 26, muted: false });
        y += 56 + 8;
        return;
      case 'text':
        text.push({ rect: { x: PAD, y, w: inner, h: 40 }, text: t(w.text, w.params as Record<string, string | number> | undefined), size: 22, muted: w.tone !== 'normal' });
        y += 40 + 8;
        return;
      case 'button':
        items.push({ fid: `button.${w.id}`, rect: { x: PAD, y, w: inner, h: ROW }, widget: w, label: t(w.label), disabled: w.disabled !== undefined });
        y += ROW + 8;
        return;
      case 'toggle':
        items.push({ fid: `toggle.${w.id}`, rect: { x: PAD, y, w: inner, h: ROW }, widget: w, label: t(w.label), on: ctx.get(w.bind) === true, disabled: w.disabled !== undefined });
        y += ROW + 8;
        return;
      case 'slider': {
        const raw = ctx.get(w.bind);
        items.push({ fid: `slider.${w.id}`, rect: { x: PAD, y, w: inner, h: ROW }, widget: w, label: `${t(w.label)} ${typeof raw === 'number' ? raw : w.min}${w.unit ?? ''}` });
        y += ROW + 8;
        return;
      }
      case 'choice': {
        const cur = ctx.get(w.bind);
        text.push({ rect: { x: PAD, y, w: inner, h: 36 }, text: t(w.label), size: 22, muted: true });
        y += 36;
        const cw = inner / w.options.length;
        w.options.forEach((o, i) => {
          items.push({ fid: `choice.${w.id}.${i}`, rect: { x: PAD + cw * i, y, w: cw - 8, h: ROW }, widget: w, label: t(o.label), sub: i, on: cur !== undefined && same(cur, o.value) });
        });
        y += ROW + 8;
        return;
      }
      case 'list':
        if (w.rows.length === 0) {
          text.push({ rect: { x: PAD, y, w: inner, h: 40 }, text: t(w.empty), size: 22, muted: true });
          y += 48;
        }
        for (const r of w.rows) {
          items.push({ fid: `row.${w.id}.${r.id}`, rect: { x: PAD, y, w: inner, h: ROW }, widget: w, label: r.badge ? `${r.text} (${r.badge})` : r.text, sub: r.id, disabled: r.disabled === true });
          y += ROW + 8;
        }
        return;
      case 'tabs': {
        const active = activeTab(w, ctx);
        const tw = inner / Math.max(1, w.tabs.length);
        w.tabs.forEach((tab, i) => {
          items.push({ fid: `tab.${w.id}.${tab.id}`, rect: { x: PAD + tw * i, y, w: tw - 8, h: ROW }, widget: w, label: t(tab.label), sub: tab.id, on: tab.id === active });
        });
        y += ROW + 8;
        for (const c of w.tabs.find((x) => x.id === active)?.children ?? []) place(c);
        return;
      }
      case 'progress':
        text.push({ rect: { x: PAD, y, w: inner * Math.max(0, Math.min(1, w.value)), h: 20 }, text: '', size: 0, muted: false });
        y += 28;
        return;
      case 'image':
        y += 120 + 8;
        return;
      case 'table':
        for (const r of w.rows) {
          text.push({ rect: { x: PAD, y, w: inner, h: 36 }, text: r.join('  '), size: 20, muted: false });
          y += 36;
        }
        return;
      case 'spacer':
        y += 8 * w.size;
        return;
    }
  };
  for (const w of screen.children) place(w);
  return { items, text, height: y + PAD };
}

export class CanvasScreen {
  layout: CanvasLayout;
  focus = 0;

  constructor(
    private readonly screen: ScreenDef,
    private readonly ctx: ScreenCtx,
    readonly width = 1024,
  ) {
    this.layout = layoutScreen(screen, ctx, width);
  }

  /** Lays the tree out again (after a setting, a tab or a list changed). */
  relayout(): void {
    this.layout = layoutScreen(this.screen, this.ctx, this.width);
    this.focus = Math.min(this.focus, Math.max(0, this.layout.items.length - 1));
  }

  /** The focusable ids in reading order, the same order `DomScreen` has. */
  focusOrder(): string[] {
    return this.layout.items.map((i) => i.fid);
  }

  get height(): number {
    return this.layout.height;
  }

  /** Moves the focus by one item (the XR menu's up/down). */
  step(delta: 1 | -1): string | null {
    const n = this.layout.items.length;
    if (n === 0) return null;
    this.focus = (this.focus + delta + n) % n;
    return (this.layout.items[this.focus] as CanvasItem).fid;
  }

  draw(g: Canvas2DLike): void {
    g.clearRect(0, 0, this.width, this.layout.height);
    g.fillStyle = '#142040';
    g.fillRect(0, 0, this.width, this.layout.height);
    g.textBaseline = 'middle';
    for (const tx of this.layout.text) {
      if (tx.size === 0) {
        g.fillStyle = '#ff7a3d';
        g.fillRect(tx.rect.x, tx.rect.y, tx.rect.w, tx.rect.h);
        continue;
      }
      g.fillStyle = tx.muted ? '#aab4cc' : '#f2f5fb';
      g.font = `${tx.size}px system-ui, sans-serif`;
      g.fillText(tx.text, tx.rect.x, tx.rect.y + tx.rect.h / 2);
    }
    this.layout.items.forEach((it, i) => {
      g.fillStyle = it.disabled ? '#24304f' : it.on ? '#ff7a3d' : '#1b2b54';
      g.fillRect(it.rect.x, it.rect.y, it.rect.w, it.rect.h);
      g.fillStyle = it.on ? '#1a0c04' : '#f2f5fb';
      g.font = '24px system-ui, sans-serif';
      g.fillText(it.label, it.rect.x + 16, it.rect.y + it.rect.h / 2);
      if (i === this.focus) {
        g.strokeStyle = '#7cc4ff';
        g.lineWidth = 4;
        g.strokeRect(it.rect.x, it.rect.y, it.rect.w, it.rect.h);
      }
    });
  }

  /** Activates the focused item (the XR menu's accept). */
  accept(): string | null {
    const it = this.layout.items[this.focus];
    if (!it) return null;
    this.press(it, 0.5);
    return it.fid;
  }

  /** A ray at panel coordinates (u, v in 0..1). Returns the item under it; a press acts on it. */
  pick(u: number, v: number, pressed: boolean): CanvasItem | null {
    const px = u * this.width;
    const py = v * this.layout.height;
    const index = this.layout.items.findIndex((i) => px >= i.rect.x && px <= i.rect.x + i.rect.w && py >= i.rect.y && py <= i.rect.y + i.rect.h);
    if (index < 0) return null;
    const it = this.layout.items[index] as CanvasItem;
    this.focus = index;
    if (pressed) this.press(it, (px - it.rect.x) / it.rect.w);
    return it;
  }

  private press(it: CanvasItem, frac: number): void {
    const w = it.widget;
    if (it.disabled) return;
    switch (w.k) {
      case 'button':
        this.ctx.run(w.onPress);
        break;
      case 'toggle':
        this.ctx.set(w.bind, !(this.ctx.get(w.bind) === true));
        break;
      case 'slider': {
        const raw = w.min + Math.max(0, Math.min(1, frac)) * (w.max - w.min);
        const stepped = Math.round(raw / w.step) * w.step;
        this.ctx.set(w.bind, Math.max(w.min, Math.min(w.max, Number(stepped.toFixed(6)))));
        break;
      }
      case 'choice': {
        const o = w.options[it.sub as number];
        if (o) this.ctx.set(w.bind, o.value);
        break;
      }
      case 'list':
        this.ctx.run(w.onPress, String(it.sub));
        break;
      case 'tabs':
        this.ctx.setTab(w.id, String(it.sub));
        break;
      default:
    }
    this.relayout();
  }
}
