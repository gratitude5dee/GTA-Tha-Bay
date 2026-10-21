/**
 * Focus navigation (10-ui.md section 2.6). The same model for keyboard, gamepad, mouse and touch: every control is a real DOM element
 * in the tab order, and the arrow keys, a standard-mapping gamepad's D-pad and left stick move focus to the nearest control in the
 * pressed direction (bounding-box overlap first, then distance, ties in DOM order). `Escape` and `Backspace` (outside text fields)
 * and the pad's B button go back; `PageUp`/`PageDown` and the pad shoulders switch tabs; Enter, Space and the pad's A press.
 *
 * The pure part (`pickNext`) is unit-tested; the DOM part (`FocusManager`) is driven by the `@ui-menus` e2e.
 */
export type Dir = 'up' | 'down' | 'left' | 'right';
export interface Rect { x: number; y: number; w: number; h: number }
export interface Candidate { id: number; rect: Rect }

const center = (r: Rect): [number, number] => [r.x + r.w / 2, r.y + r.h / 2];

/** Length of the overlap of two intervals (0 when they do not overlap). */
const overlap = (a0: number, a1: number, b0: number, b1: number): number => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

/**
 * The id of the candidate to focus after `dir` from `from`, or null. A candidate qualifies when its centre lies strictly past the
 * current centre in the direction. Candidates whose span overlaps the current one on the cross axis win over those that do not;
 * within a class the nearest wins; equal distances keep the lower id (DOM order).
 */
export function pickNext(from: Rect, candidates: readonly Candidate[], dir: Dir): number | null {
  const [cx, cy] = center(from);
  const horizontal = dir === 'left' || dir === 'right';
  let best: { id: number; aligned: boolean; dist: number } | null = null;
  for (const c of candidates) {
    const [x, y] = center(c.rect);
    const along = horizontal ? (dir === 'right' ? x - cx : cx - x) : dir === 'down' ? y - cy : cy - y;
    if (along <= 0.5) continue;
    const cross = horizontal ? overlap(from.y, from.y + from.h, c.rect.y, c.rect.y + c.rect.h) : overlap(from.x, from.x + from.w, c.rect.x, c.rect.x + c.rect.w);
    const aligned = cross > 0;
    const across = horizontal ? Math.abs(y - cy) : Math.abs(x - cx);
    // Misalignment counts double so that a row neighbour beats a far diagonal one.
    const dist = along + across * 2;
    if (!best || (aligned && !best.aligned) || (aligned === best.aligned && (dist < best.dist || (dist === best.dist && c.id < best.id)))) {
      best = { id: c.id, aligned, dist };
    }
  }
  return best ? best.id : null;
}

const FOCUSABLE = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[role="switch"]:not([disabled])',
  '[role="radio"]:not([disabled])',
  '[role="tab"]:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function visible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none';
}

function isTextField(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'file'].includes(el.type);
  return (el as HTMLElement).isContentEditable === true;
}

/** The elements navigation may land on: inside the topmost modal when one is open, else the whole root. */
export function focusables(root: ParentNode): HTMLElement[] {
  const modals = root.querySelectorAll<HTMLElement>('[data-dv-modal]');
  const scope: ParentNode = modals.length > 0 ? (modals[modals.length - 1] as HTMLElement) : root;
  return [...scope.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest('[inert]') && visible(el));
}

export interface FocusManagerOptions {
  root: HTMLElement;
  onBack(): void;
  /** True while a tablist on the page should answer shoulder buttons. */
  gamepad?: () => readonly (Gamepad | null)[];
  /** Called when the last input device changes (`kbm`, `pad`, `pointer`), for glyphs and the focus ring. */
  onInputKind?: (kind: 'kbm' | 'pad' | 'pointer') => void;
  /** Escape goes back unless this says the Pause key belongs to the engine (the pause menu). */
  escapeBacks?: () => boolean;
  now?: () => number;
}

const STICK = 0.6;
const FIRST_REPEAT_MS = 400;
const REPEAT_MS = 130;
const REPEAT_MIN_POLLS = 8;

/** Attaches the key handlers and the gamepad poll. `dispose` removes them. */
export class FocusManager {
  private raf = 0;
  /** When each held pad control was first seen (ms) and how many polls have seen it since. */
  private readonly held = new Map<string, { at: number; polls: number }>();
  private disposed = false;
  private readonly keydown = (e: KeyboardEvent): void => this.onKey(e);
  private readonly pointer = (): void => this.kind('pointer');

  constructor(private readonly o: FocusManagerOptions) {
    document.addEventListener('keydown', this.keydown, true);
    document.addEventListener('pointerdown', this.pointer, true);
    if (typeof requestAnimationFrame === 'function') this.raf = requestAnimationFrame(() => this.poll());
  }

  dispose(): void {
    this.disposed = true;
    document.removeEventListener('keydown', this.keydown, true);
    document.removeEventListener('pointerdown', this.pointer, true);
    if (this.raf) cancelAnimationFrame(this.raf);
  }

  private kind(k: 'kbm' | 'pad' | 'pointer'): void {
    document.documentElement.dataset['dvInput'] = k;
    this.o.onInputKind?.(k);
  }

  /** Moves focus one step. Returns true when focus moved. */
  move(dir: Dir): boolean {
    const list = focusables(this.o.root);
    if (list.length === 0) return false;
    const active = document.activeElement as HTMLElement | null;
    const index = active ? list.indexOf(active) : -1;
    if (index < 0) {
      (list[0] as HTMLElement).focus();
      return true;
    }
    const rect = (el: Element): Rect => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    const next = pickNext(rect(active as HTMLElement), list.map((el, id) => ({ id, rect: rect(el) })).filter((c) => c.id !== index), dir);
    if (next === null) return false;
    const target = list[next] as HTMLElement;
    target.focus();
    target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    return true;
  }

  /** Switches the page's tabs by one; true when a tablist exists. */
  cycleTab(delta: 1 | -1): boolean {
    const scope = this.o.root.querySelectorAll<HTMLElement>('[data-dv-modal]');
    const top = scope.length > 0 ? (scope[scope.length - 1] as HTMLElement) : this.o.root;
    const tabs = [...top.querySelectorAll<HTMLElement>('[role="tab"]')].filter(visible);
    if (tabs.length === 0) return false;
    const cur = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
    const next = tabs[(Math.max(cur, 0) + delta + tabs.length) % tabs.length] as HTMLElement;
    next.click();
    return true;
  }

  accept(): void {
    (document.activeElement as HTMLElement | null)?.click();
  }

  private onKey(e: KeyboardEvent): void {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    this.kind('kbm');
    const active = document.activeElement;
    const text = isTextField(active);
    const range = active instanceof HTMLInputElement && active.type === 'range';
    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowDown':
        if (text) return;
        if (this.move(e.key === 'ArrowUp' ? 'up' : 'down')) e.preventDefault();
        return;
      case 'ArrowLeft':
      case 'ArrowRight':
        if (text || range) return;
        if (this.move(e.key === 'ArrowLeft' ? 'left' : 'right')) e.preventDefault();
        return;
      case 'PageUp':
      case 'PageDown':
        if (this.cycleTab(e.key === 'PageDown' ? 1 : -1)) e.preventDefault();
        return;
      case 'Escape':
        if (this.o.escapeBacks && !this.o.escapeBacks()) return;
        e.preventDefault();
        this.o.onBack();
        return;
      case 'Backspace':
        if (text) return;
        e.preventDefault();
        this.o.onBack();
        return;
      default:
    }
  }

  private poll(): void {
    if (this.disposed) return;
    const pads = this.o.gamepad ? this.o.gamepad() : typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    const pad = [...pads].find((p) => p && p.connected !== false) ?? null;
    if (pad) this.pad(pad);
    else this.held.clear();
    this.raf = requestAnimationFrame(() => this.poll());
  }

  private pad(p: Gamepad): void {
    const now = this.o.now ? this.o.now() : performance.now();
    const b = (i: number): boolean => p.buttons[i]?.pressed === true;
    const ax = p.axes[0] ?? 0;
    const ay = p.axes[1] ?? 0;
    const pressed: Record<string, boolean> = {
      up: b(12) || ay < -STICK,
      down: b(13) || ay > STICK,
      left: b(14) || ax < -STICK,
      right: b(15) || ax > STICK,
      accept: b(0),
      back: b(1),
      tabPrev: b(4),
      tabNext: b(5),
    };
    for (const [name, on] of Object.entries(pressed)) {
      if (!on) {
        this.held.delete(name);
        continue;
      }
      const h = this.held.get(name);
      const repeats = name === 'up' || name === 'down' || name === 'left' || name === 'right';
      if (h === undefined) {
        this.held.set(name, { at: now, polls: 1 });
        this.act(name);
      } else {
        h.polls++;
        // Auto-repeat needs a real hold: 400 ms and several polls, so one slow frame cannot turn a tap into a run.
        if (repeats && now - h.at > FIRST_REPEAT_MS && h.polls >= REPEAT_MIN_POLLS) {
          h.at = now - FIRST_REPEAT_MS + REPEAT_MS;
          this.act(name);
        }
      }
    }
  }

  /** Pad actions taken so far, mirrored to `html[data-dv-pad-acts]` so a test can wait for the poll to have seen a press. */
  private acts = 0;

  private act(name: string): void {
    this.kind('pad');
    document.documentElement.dataset['dvPadActs'] = String(++this.acts);
    if (name === 'up' || name === 'down' || name === 'left' || name === 'right') this.move(name);
    else if (name === 'accept') this.accept();
    else if (name === 'back') this.o.onBack();
    else if (name === 'tabPrev') this.cycleTab(-1);
    else if (name === 'tabNext') this.cycleTab(1);
  }
}

/** Roving tabindex for a group: one stop in the tab order (the selected or first item), the rest at -1; arrows move inside. */
export function applyRoving(group: HTMLElement, selector = '[role="tab"],[role="radio"]'): void {
  const items = [...group.querySelectorAll<HTMLElement>(selector)];
  if (items.length === 0) return;
  const current = items.find((i) => i.getAttribute('aria-selected') === 'true' || i.getAttribute('aria-checked') === 'true') ?? items[0];
  for (const i of items) i.tabIndex = i === current ? 0 : -1;
}
