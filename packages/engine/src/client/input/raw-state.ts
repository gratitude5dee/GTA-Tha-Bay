import type { ControlId, RawInputState } from '@dv/shared';

/**
 * A fresh `RawInputState` (C03): the controls currently down or deflected, the controls pressed since the last
 * `sample()` (latched, so a tap shorter than a frame is never lost), the look delta accumulated since then, and the
 * device that produced input last.
 */
export function createRawInputState(): RawInputState {
  return { controls: new Map<ControlId, number>(), latchedPress: new Set<ControlId>(), lookDelta: [0, 0], lastActiveDevice: 'kbm' };
}

/** True when the control is down: digital 1, or an analog value past half travel. */
export function isDown(raw: RawInputState, control: ControlId): boolean {
  return (raw.controls.get(control) ?? 0) > 0.5;
}
