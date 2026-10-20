import type { DeviceKind } from '@dv/shared';
import {
  TOUCH_KNOB_RADIUS_PX, TOUCH_STICK_RADIUS_PX, type TouchAnchor, type TouchLayout, type TouchVisual,
} from './touch.ts';
import './touch.css';

/** English defaults until the i18n catalog carries the touch labels (M04b2 adopts the layout and the keys). */
const DEFAULT_LABELS: Readonly<Record<string, string>> = {
  'touch.jump': 'Jump',
  'touch.camera': 'Camera',
  'touch.enter': 'Enter',
  'touch.pause': 'Pause',
};

const ICONS: Readonly<Record<string, string>> = {
  jump: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l7 9h-4v7H9v-7H5z" fill="currentColor"/></svg>',
  camera: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-2h6l2 2h3v11H4zm8 2.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7z" fill="currentColor"/></svg>',
  enter: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4h8v16h-8v-3h5V7h-5zM4 11h8V8l5 4-5 4v-3H4z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/></svg>',
};

export interface TouchOverlayOptions {
  /** Where the layer goes (the body). */
  container: HTMLElement;
  layout: TouchLayout;
  labels?: Readonly<Record<string, string>>;
  /** `matchMedia('(pointer: coarse)').matches`. Overridable for tests and the `?touch=1` QA flag. */
  coarsePointer?: () => boolean;
}

function place(el: HTMLElement, at: TouchAnchor, sizePx: number): void {
  const s = el.style;
  s.inlineSize = `${sizePx}px`;
  s.blockSize = `${sizePx}px`;
  const vert = at.corner[0] === 't' ? 'top' : 'bottom';
  const horiz = at.corner[1] === 'l' ? 'left' : 'right';
  s.setProperty(vert, `calc(env(safe-area-inset-${vert}, 0px) + ${at.dy}px)`);
  s.setProperty(horiz, `calc(env(safe-area-inset-${horiz}, 0px) + ${at.dx}px)`);
}

/**
 * The touch layer (S10 section 2.9 rules 2 and 3): a DOM layer with `touch-action: none`, no text selection and no
 * long-press callout; one `<button>` per button widget placed from the safe-area corner (every target is at least 44 CSS px);
 * a floating stick drawn where the first left-half contact landed. It is shown only while the page is in play and the last
 * active device is touch or the primary pointer is coarse. The pointer handlers belong to `TouchBinder`, which attaches to
 * `root`.
 */
export class TouchOverlay {
  readonly root: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly base: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly buttons = new Map<string, HTMLElement>();
  private enabled = false;
  private device: DeviceKind = 'kbm';
  private readonly coarse: () => boolean;

  constructor(opts: TouchOverlayOptions) {
    const doc = opts.container.ownerDocument;
    this.coarse = opts.coarsePointer ?? ((): boolean => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);
    const labels = { ...DEFAULT_LABELS, ...(opts.labels ?? {}) };

    const root = doc.createElement('div');
    root.className = 'dv-touch';
    root.dataset['layout'] = opts.layout.id;
    root.hidden = true;
    this.root = root;

    this.hint = doc.createElement('div');
    this.hint.className = 'dv-touch-stick-hint';
    this.base = doc.createElement('div');
    this.base.className = 'dv-touch-stick-base';
    this.base.style.inlineSize = `${TOUCH_STICK_RADIUS_PX * 2}px`;
    this.base.style.blockSize = `${TOUCH_STICK_RADIUS_PX * 2}px`;
    this.base.hidden = true;
    this.knob = doc.createElement('div');
    this.knob.className = 'dv-touch-stick-knob';
    this.knob.style.inlineSize = `${TOUCH_KNOB_RADIUS_PX * 2}px`;
    this.knob.style.blockSize = `${TOUCH_KNOB_RADIUS_PX * 2}px`;
    this.knob.hidden = true;
    root.append(this.hint, this.base, this.knob);

    for (const w of opts.layout.widgets) {
      if (w.kind !== 'button') continue;
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = `dv-touch-btn dv-touch-btn--${w.icon}`;
      b.dataset['dvBtn'] = w.id;
      b.setAttribute('aria-label', labels[w.label ?? ''] ?? w.id);
      b.innerHTML = ICONS[w.icon] ?? '';
      place(b, w.at, w.sizePx);
      root.append(b);
      this.buttons.set(w.id, b);
    }
    opts.container.append(root);
    this.sync();
  }

  /** Play mode on or off: the layer is never shown over the title screen. */
  setEnabled(on: boolean): void {
    this.enabled = on;
    this.sync();
  }

  /** The last active device (from the router); the layer follows it. */
  setActiveDevice(d: DeviceKind): void {
    if (d === this.device) return;
    this.device = d;
    this.sync();
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  /** The binder's `onVisual` callback. */
  readonly draw = (v: TouchVisual): void => {
    if (v.stick) {
      this.base.hidden = false;
      this.knob.hidden = false;
      this.base.style.transform = `translate(${v.stick.originX - TOUCH_STICK_RADIUS_PX}px, ${v.stick.originY - TOUCH_STICK_RADIUS_PX}px)`;
      this.knob.style.transform = `translate(${v.stick.knobX - TOUCH_KNOB_RADIUS_PX}px, ${v.stick.knobY - TOUCH_KNOB_RADIUS_PX}px)`;
      this.base.classList.toggle('dv-touch-sprint', v.stick.sprint);
    } else {
      this.base.hidden = true;
      this.knob.hidden = true;
    }
    for (const [id, el] of this.buttons) el.classList.toggle('dv-touch-down', v.pressed.includes(id));
  };

  dispose(): void {
    this.root.remove();
    this.buttons.clear();
  }

  private sync(): void {
    const show = this.enabled && (this.device === 'touch' || this.coarse());
    this.root.hidden = !show;
  }
}
