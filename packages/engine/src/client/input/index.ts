import type { InputFrame } from '@dv/shared';
import type { InputBlock } from '../../sim/transport/input-block.ts';

export * from './defaults.ts';
export * from './gamepad.ts';
export * from './gestures.ts';
export * from './kbm.ts';
export * from './quantize.ts';
export * from './raw-state.ts';
export * from './router.ts';
export * from './touch.ts';

/**
 * Writes one router frame into the input block that the worker samples once per tick. The held mask is written twice,
 * with the pressed bits added and then removed, so a tap shorter than a render frame still latches one pressed edge and
 * one released edge in the block (C03 rule 2) without leaving the button held.
 */
export function writeInputFrame(block: InputBlock, f: InputFrame): void {
  block.setHeld(f.buttons | f.pressed);
  block.setHeld(f.buttons);
  block.setAxes({ moveX: f.moveX, moveY: f.moveY, throttle: f.throttle, brake: f.brake, steer: f.steer });
  block.setContext(f.context, f.device);
  block.setLook(f.camYaw, f.camPitch);
}
