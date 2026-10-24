/**
 * The teleport fade (M02c1; 02-world-maps.md section 5 steps 3 and 5): a black veil over the page that the sim drives with the
 * SimEvent `world.teleport` (`s: 'out'` then `s: 'in'`). Fade-out takes at most 200 ms, which is also the time the sim waits
 * before it moves the player. If `in` never arrives (the sim worker restarted mid-teleport) the veil lifts by itself after
 * `SAFETY_MS`. With reduced motion the veil switches without a transition. DOM only; no sim code.
 */

export const FADE_OUT_MS = 200;
export const FADE_IN_MS = 200;
export const FADE_SAFETY_MS = 6000;

export type FadeState = 'clear' | 'out' | 'in';

export interface FadeHost {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export class TeleportFade {
  readonly el: HTMLElement;
  /** `out` and `in` in the order they were asked, for the QA bridge. */
  readonly log: ('out' | 'in')[] = [];
  private current: FadeState = 'clear';
  private safety: unknown = null;

  constructor(parent: HTMLElement, private readonly timers: FadeHost = globalThis as unknown as FadeHost) {
    const doc = parent.ownerDocument;
    const el = doc.createElement('div');
    el.dataset['testid'] = 'teleport-fade';
    el.setAttribute('aria-hidden', 'true');
    const reduce = doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    el.style.cssText = `position:fixed;inset:0;z-index:55;background:#000;opacity:0;pointer-events:none;transition:${reduce ? 'none' : `opacity ${FADE_OUT_MS}ms linear`}`;
    parent.append(el);
    this.el = el;
  }

  get state(): FadeState {
    return this.current;
  }

  /** Black within 200 ms. */
  out(): void {
    this.log.push('out');
    this.current = 'out';
    this.el.style.transitionDuration = `${FADE_OUT_MS}ms`;
    this.el.style.opacity = '1';
    this.arm();
  }

  /** Back to clear. */
  in(): void {
    this.log.push('in');
    this.disarm();
    this.current = 'in';
    this.el.style.transitionDuration = `${FADE_IN_MS}ms`;
    this.el.style.opacity = '0';
  }

  private arm(): void {
    this.disarm();
    this.safety = this.timers.setTimeout(() => {
      if (this.current === 'out') this.in();
    }, FADE_SAFETY_MS);
  }

  private disarm(): void {
    if (this.safety !== null) this.timers.clearTimeout(this.safety);
    this.safety = null;
  }

  dispose(): void {
    this.disarm();
    this.el.remove();
  }
}
