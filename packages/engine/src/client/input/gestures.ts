import type { Binding } from '@dv/shared';

/** C03 defaults: a hold fires after 300 ms, two taps count as a double tap within 450 ms [research/repos-modding.md §3.5]. */
export const DEFAULT_HOLD_MS = 300;
export const DEFAULT_DOUBLE_TAP_MS = 450;

/** What one binding produced this sample. `pressed` and `released` are one-sample edges. */
export interface GestureResult {
  held: boolean;
  pressed: boolean;
  released: boolean;
}

/**
 * Resolves one binding's gesture (press, hold, doubleTap, release) from the control's level and its latched press.
 * One tracker per binding; the router calls `update` once per sample with the injected clock's time.
 *
 *  - press: the control's level; a tap shorter than a sample is `pressed` and `released` with `held` false.
 *  - hold: `pressed` once the control has been down for `holdMs`; `held` from then until release.
 *  - doubleTap: `pressed` on the second press that starts within `doubleTapMs` of the first; `held` until release.
 *  - release: a one-sample `pressed` when the control is let go.
 */
export class GestureTracker {
  private prevDown = false;
  private downSince = 0;
  private holdFired = false;
  private doubleFired = false;
  private lastTapAt = Number.NEGATIVE_INFINITY;
  private prevHeld = false;

  update(binding: Binding, down: boolean, latched: boolean, nowMs: number): GestureResult {
    const pressedEdge = latched || (down && !this.prevDown);
    const releasedEdge = (this.prevDown && !down) || (latched && !down);
    if (pressedEdge) {
      this.downSince = nowMs;
      this.holdFired = false;
      this.doubleFired = false;
    }
    let held: boolean;
    let pressed: boolean;
    switch (binding.gesture ?? 'press') {
      case 'hold': {
        const holdMs = binding.holdMs ?? DEFAULT_HOLD_MS;
        pressed = false;
        if (down && !this.holdFired && nowMs - this.downSince >= holdMs) {
          this.holdFired = true;
          pressed = true;
        }
        held = down && this.holdFired;
        break;
      }
      case 'doubleTap': {
        const window = binding.doubleTapMs ?? DEFAULT_DOUBLE_TAP_MS;
        pressed = false;
        if (pressedEdge) {
          if (nowMs - this.lastTapAt <= window) {
            this.doubleFired = true;
            this.lastTapAt = Number.NEGATIVE_INFINITY;
            pressed = true;
          } else {
            this.lastTapAt = nowMs;
          }
        }
        held = down && this.doubleFired;
        break;
      }
      case 'release':
        pressed = releasedEdge;
        held = false;
        break;
      default:
        pressed = pressedEdge;
        held = down;
    }
    this.prevDown = down;
    // A release follows a hold. A tap shorter than one sample presses and releases inside the same sample.
    const released = this.prevHeld && !held ? true : (binding.gesture ?? 'press') !== 'release' && releasedEdge && pressed;
    this.prevHeld = held;
    return { held, pressed, released };
  }
}
