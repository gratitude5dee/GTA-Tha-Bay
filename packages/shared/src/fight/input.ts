// packages/shared/src/fight/input.ts — FC5.1: the C03 InputFrame -> FighterInput boundary. Pure.
import type { InputFrame } from '../contracts/c03-input.ts';
import { SimButton } from '../contracts/c03-input.ts';

export const enum FB {                       // FighterInput bits (u16); the only input the fight core reads
  Up = 1 << 0, Down = 1 << 1, Left = 1 << 2, Right = 1 << 3,       // screen-absolute; facing applied inside the core
  LP = 1 << 4, MP = 1 << 5, HP = 1 << 6, LK = 1 << 7, MK = 1 << 8, HK = 1 << 9,
  SP = 1 << 10, AS = 1 << 11, HY = 1 << 12, TA = 1 << 13, BL = 1 << 14, DA = 1 << 15,
}
export type FighterInput = number;           // u16

export const FB_DIRS = 0xf;
export const FB_PUNCH = FB.LP | FB.MP | FB.HP;
export const FB_KICK = FB.LK | FB.MK | FB.HK;
export const FB_ATTACK = FB_PUNCH | FB_KICK;
/** Stick threshold of FC5.1: an axis counts beyond +-48 (strictly; BD-M08a1-01). */
export const STICK_THRESHOLD = 48;

function bit(n: number): number { return 1 << n; }
const M_UP = bit(SimButton.Jump);
const M_DOWN = bit(SimButton.Crouch);

/** FC5.1. Held bits and the latched `pressed` edges are merged so a sub-tick tap is never lost (C03 rule 2). */
export function fromInputFrame(f: InputFrame): FighterInput {
  const b = (f.buttons | f.pressed) >>> 0;
  let o = 0;
  if (f.moveY > STICK_THRESHOLD || (b & M_UP) !== 0) o |= FB.Up;
  if (f.moveY < -STICK_THRESHOLD || (b & M_DOWN) !== 0) o |= FB.Down;
  if (f.moveX < -STICK_THRESHOLD) o |= FB.Left;
  if (f.moveX > STICK_THRESHOLD) o |= FB.Right;
  if ((b & bit(SimButton.Attack)) !== 0) o |= FB.LP;
  if ((b & bit(SimButton.Ability)) !== 0) o |= FB.MP;
  if ((b & bit(SimButton.FightHeavy)) !== 0) o |= FB.HP;
  if ((b & bit(SimButton.Sprint)) !== 0) o |= FB.LK;
  if ((b & bit(SimButton.Nitro)) !== 0) o |= FB.MK;
  if ((b & bit(SimButton.Horn)) !== 0) o |= FB.HK;
  if ((b & bit(SimButton.Special)) !== 0) o |= FB.SP;
  if ((b & bit(SimButton.FightAssist)) !== 0) o |= FB.AS;
  if ((b & bit(SimButton.Handbrake)) !== 0) o |= FB.HY;
  if ((b & bit(SimButton.Emote)) !== 0) o |= FB.TA;
  if ((b & bit(SimButton.Block)) !== 0) o |= FB.BL;
  if ((b & bit(SimButton.Interact)) !== 0) o |= FB.DA;
  return o;
}

/**
 * The inverse of `fromInputFrame` for QA drivers: an InputFrame that maps back to `fi` (left+right cancels, as SOCD does).
 * `device` is the C03 DeviceKind index (7 = 'bot'); `context` 2 = 'fighter' in the InputContextId order.
 */
export function toInputFrame(fi: FighterInput, tick: number, device = 7): InputFrame {
  let buttons = 0;
  if (fi & FB.LP) buttons |= bit(SimButton.Attack);
  if (fi & FB.MP) buttons |= bit(SimButton.Ability);
  if (fi & FB.HP) buttons |= bit(SimButton.FightHeavy);
  if (fi & FB.LK) buttons |= bit(SimButton.Sprint);
  if (fi & FB.MK) buttons |= bit(SimButton.Nitro);
  if (fi & FB.HK) buttons |= bit(SimButton.Horn);
  if (fi & FB.SP) buttons |= bit(SimButton.Special);
  if (fi & FB.AS) buttons |= bit(SimButton.FightAssist);
  if (fi & FB.HY) buttons |= bit(SimButton.Handbrake);
  if (fi & FB.TA) buttons |= bit(SimButton.Emote);
  if (fi & FB.BL) buttons |= bit(SimButton.Block);
  if (fi & FB.DA) buttons |= bit(SimButton.Interact);
  // Up and Down both survive (stick up, Crouch button for down); left+right cancels on the stick, which is what SOCD makes of it.
  const moveX = (fi & FB.Right ? 127 : 0) - (fi & FB.Left ? 127 : 0);
  const moveY = fi & FB.Up ? 127 : fi & FB.Down ? -127 : 0;
  if ((fi & FB.Up) !== 0 && (fi & FB.Down) !== 0) buttons |= bit(SimButton.Crouch);
  return {
    tick: tick >>> 0, buttons: buttons >>> 0, pressed: 0, released: 0, moveX, moveY,
    throttle: 0, brake: 0, steer: 0, camYaw: 0, camPitch: 0, context: 2, device,
  };
}

/** Facing-relative numpad direction (1..9) of a FighterInput. SOCD: left+right -> neutral; up+down -> up (FC5.2). */
export function dir9(fi: FighterInput, facing: number): number {
  let h = 0;
  if (fi & FB.Right) h += 1;
  if (fi & FB.Left) h -= 1;
  if (facing < 0) h = -h;
  const up = (fi & FB.Up) !== 0;
  const down = (fi & FB.Down) !== 0 && !up;
  return (up ? 7 : down ? 1 : 4) + (h + 1);
}
